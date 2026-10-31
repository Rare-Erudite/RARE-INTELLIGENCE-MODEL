/**
 * RARE-INTELLIGENCE — Python Engine Route
 *
 * One gated surface between the TypeScript app and the Python engine.
 *
 * Design constraints that shaped this file:
 *
 * 1. The Python engine is a SEPARATE SERVICE, not something Vercel can host.
 *    Vercel serverless has no long-running process (tasks here run up to
 *    900s), no persistent disk (`.rare/` task state lives there) and a
 *    250 MB bundle limit against a 379 MB GGUF. See DEPLOYMENT.md.
 *
 * 2. Requests must not block. `/v1/engine/tasks` enqueues and returns 202 with
 *    a job id; the client polls `/v1/engine/jobs/:id`. server.ts enforces a
 *    35s response bound, and a real task can far exceed that.
 *
 * 3. When the engine is unreachable the app must NOT break. The route returns
 *    a safe 503 and everything else in the app keeps working — this feature is
 *    additive, never on a critical path.
 */

import crypto from 'crypto';
import express from 'express';
import { AppError } from '../engine/errors/app-error.js';
import { authManager, type AuthenticatedRequest } from '../engine/security/auth.js';
import { EngineClientError, PythonEngineClient } from '../integration/python_engine_client.js';
import {
  JobIdempotencyConflictError,
  JobQueue,
  JobWorker,
  type JobRecord,
} from '../jobs/jobQueue.js';

export const FEATURE_FLAG_ENV = 'ENGINE_FEATURE_ENABLED';

/** The Python engine's own ceiling is 900s; ours is deliberately lower. */
const ENGINE_TIMEOUT_MS = parseInt(process.env.ENGINE_TIMEOUT_MS || '900000', 10);

const MAX_GOAL_LENGTH = 8000;

export function isEngineFeatureEnabled(): boolean {
  return process.env[FEATURE_FLAG_ENV] === 'true';
}

export interface EngineRouteOptions {
  /** Injected for tests; defaults to the real client from env config. */
  client?: PythonEngineClient | null;
  queue?: JobQueue;
  /** Injected for tests so the worker can run synchronously. */
  autoDrain?: boolean;
}

function buildClientFromEnv(): PythonEngineClient | null {
  const baseUrl = process.env.RARE_ENGINE_BASE_URL;
  const token = process.env.RARE_SERVICE_TOKEN;
  if (!baseUrl || !token) return null;
  return new PythonEngineClient({ baseUrl, token, timeoutMs: ENGINE_TIMEOUT_MS });
}

function serializeJob(job: JobRecord) {
  return {
    id: job.id,
    status: job.status,
    goal: job.goal,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    result: job.result ?? null,
    error: job.error ?? null,
    errorCode: job.errorCode ?? null,
    engineTaskId: job.engineTaskId ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

/**
 * Validates the request body before anything touches the engine or the queue.
 * Returns a normalised goal or throws an AppError with a 400.
 */
export function validateGoal(body: unknown): string {
  if (!body || typeof body !== 'object') {
    throw new AppError({ code: 'VALIDATION_FAILED', message: 'Request body must be a JSON object.' });
  }
  const goal = (body as { goal?: unknown }).goal;
  if (typeof goal !== 'string') {
    throw new AppError({ code: 'VALIDATION_FAILED', message: '"goal" must be a string.' });
  }
  const trimmed = goal.trim();
  if (trimmed.length === 0) {
    throw new AppError({ code: 'VALIDATION_FAILED', message: '"goal" must not be empty.' });
  }
  if (trimmed.length > MAX_GOAL_LENGTH) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      message: `"goal" exceeds ${MAX_GOAL_LENGTH} characters.`,
    });
  }
  return trimmed;
}

/** Normalises the optional client idempotency key, rejecting junk. */
export function normaliseIdempotencyKey(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      message: '"idempotencyKey" must be a string when provided.',
    });
  }
  const key = raw.trim();
  if (key.length === 0) return null;
  if (key.length > 200) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      message: '"idempotencyKey" exceeds 200 characters.',
    });
  }
  return key;
}

export function createEngineRouter(options: EngineRouteOptions = {}): express.Router {
  const router = express.Router();
  const queue = options.queue ?? new JobQueue();

  // Gate first: with the flag off the surface does not exist at all, which is
  // a smaller attack surface than a route that authenticates then refuses.
  router.use((_req, res, next) => {
    if (!isEngineFeatureEnabled()) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Python engine integration is disabled.',
          statusCode: 404,
          timestamp: Date.now(),
          isTransient: false,
        },
      });
      return;
    }
    next();
  });

  router.use(authManager.authenticateMiddleware());
  // authenticateMiddleware only RESOLVES a role — it never blocks. Without an
  // explicit role requirement an anonymous caller resolves to 'public' and
  // would otherwise reach every handler below.
  router.use(authManager.requireRole(['client', 'developer']));

  /** Liveness of the engine itself, relayed so the UI can show a status dot. */
  router.get('/health', async (_req, res, next) => {
    const client = options.client ?? buildClientFromEnv();
    if (!client) {
      res.status(503).json({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Python engine is not configured (RARE_ENGINE_BASE_URL / RARE_SERVICE_TOKEN).',
          statusCode: 503,
          timestamp: Date.now(),
          isTransient: true,
        },
      });
      return;
    }
    try {
      const health = await client.health();
      res.json({ success: true, health });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Submit a task. 202 Accepted — the work happens in the worker, not here.
   * A repeat submission with the same idempotencyKey returns the SAME job and
   * enqueues nothing new, so a client retry after a dropped connection cannot
   * double-execute side effects.
   */
  router.post('/tasks', async (req, res, next) => {
    try {
      const goal = validateGoal(req.body);
      const idempotencyKey = normaliseIdempotencyKey(
        (req.body as { idempotencyKey?: unknown }).idempotencyKey,
      );
      const auth = req as AuthenticatedRequest;
      const ownerId = (auth as any).clientId ?? null;

      let job: JobRecord;
      try {
        job = queue.enqueue({ goal, idempotencyKey, ownerId });
      } catch (err) {
        if (err instanceof JobIdempotencyConflictError) {
          throw new AppError({
            code: 'IDEMPOTENCY_CONFLICT',
            message: err.message,
            statusCode: 409,
          });
        }
        throw err;
      }

      const client = options.client ?? buildClientFromEnv();
      if (!client) {
        // Enqueue succeeded, engine is not configured. Surface that honestly
        // rather than pretending the job will run.
        res.status(503).json({
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Python engine is not configured; job recorded but cannot run.',
            statusCode: 503,
            timestamp: Date.now(),
            isTransient: true,
            details: { jobId: job.id },
          },
        });
        return;
      }

      res.status(202).json({ success: true, job: serializeJob(job) });
    } catch (err) {
      next(err);
    }
  });

  /** Poll one job. Ownership enforced: no cross-client reads. */
  router.get('/jobs/:id', (req, res, next) => {
    try {
      const auth = req as AuthenticatedRequest;
      const ownerId = (auth as any).clientId ?? null;
      const job = queue.getOwned(req.params.id, ownerId);
      if (!job) {
        throw new AppError({
          code: 'NOT_FOUND',
          message: `No job ${req.params.id}.`,
          statusCode: 404,
        });
      }
      res.json({ success: true, job: serializeJob(job) });
    } catch (err) {
      next(err);
    }
  });

  /** List the caller's own jobs, newest first. */
  router.get('/jobs', (req, res, next) => {
    try {
      const auth = req as AuthenticatedRequest;
      const ownerId = (auth as any).clientId ?? null;
      const limit = Math.min(parseInt(String(req.query.limit ?? '25'), 10) || 25, 100);
      const jobs = queue
        .list()
        .filter((j) => (j.ownerId ?? null) === ownerId)
        .slice(0, limit)
        .map(serializeJob);
      res.json({ success: true, jobs });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Run the queue once. Exposed as a route in development so a single-process
   * deployment can drain without a separate worker loop; production runs the
   * worker on a timer from server.ts.
   */
  router.post('/jobs/drain', authManager.requireRole(['developer']), async (_req, res, next) => {
    try {
      const client = options.client ?? buildClientFromEnv();
      if (!client) {
        throw new AppError({
          code: 'SERVICE_UNAVAILABLE',
          message: 'Python engine is not configured.',
          statusCode: 503,
          isTransient: true,
        });
      }
      const worker = new JobWorker(queue, async (job) => {
        const run = await client.runTask(job.goal, {
          metadata: { jobId: job.id },
          taskId: job.id,
        });
        if (run.status !== 'succeeded') {
          throw new EngineClientError(
            run.errorCode || 'TASK_FAILED',
            run.error || `task ${run.taskId} ended ${run.status}`,
            ['failed', 'cancelled', 'timed_out'].includes(run.status) ? 422 : 502,
          );
        }
        return { result: run.result ?? '', engineTaskId: run.taskId };
      });
      const outcome = await worker.drain();
      res.json({ success: true, outcome });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/**
 * Starts the background drain loop. Separate from the router so tests can
 * drive `drain()` directly instead of waiting on a timer.
 */
export function startJobWorker(queue: JobQueue, client: PythonEngineClient, intervalMs = 2000) {
  const worker = new JobWorker(queue, async (job) => {
    const run = await client.runTask(job.goal, {
      metadata: { jobId: job.id },
      taskId: job.id,
    });
    if (run.status !== 'succeeded') {
      throw new EngineClientError(
        run.errorCode || 'TASK_FAILED',
        run.error || `task ${run.taskId} ended ${run.status}`,
        ['failed', 'cancelled', 'timed_out'].includes(run.status) ? 422 : 502,
      );
    }
    return { result: run.result ?? '', engineTaskId: run.taskId };
  });

  // Crash recovery happens on the first tick, so a job that was `running` when
  // the process died is picked up automatically.
  let timer: NodeJS.Timeout | null = setInterval(() => {
    worker.drain().catch(() => {
      /* drain never throws; belt and braces */
    });
  }, intervalMs);
  if (typeof (timer as any).unref === 'function') (timer as any).unref();

  return {
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    drain: () => worker.drain(),
  };
}

/** Exported for tests that need a deterministic id without crypto mocking. */
export function makeJobIdForTest(): string {
  return 'job_' + crypto.randomBytes(4).toString('hex');
}
