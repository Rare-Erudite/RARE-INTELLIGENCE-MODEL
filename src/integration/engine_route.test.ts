/**
 * RARE-INTELLIGENCE — Engine route HTTP tests
 *
 * Exercises the real Express router over a real socket, so middleware order,
 * status codes and the centralized error handler are all covered. The Python
 * engine is stubbed at the client boundary — these tests are about the
 * TypeScript surface, not about the engine's behaviour.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import express from 'express';
import { AppError } from '../engine/errors/app-error.ts';
import { authManager } from '../engine/security/auth.ts';
import { createEngineRouter, startJobWorker } from '../integration/engine_route.ts';
import { JobQueue } from '../jobs/jobQueue.ts';

interface Harness {
  url: string;
  close: () => Promise<void>;
  queue: JobQueue;
}

async function startApp(options: {
  enabled: boolean;
  client?: any;
  queue: JobQueue;
}): Promise<Harness> {
  process.env.ENGINE_FEATURE_ENABLED = options.enabled ? 'true' : 'false';

  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1/engine',
    createEngineRouter({ client: options.client ?? null, queue: options.queue }),
  );
  // Mirror server.ts's centralized error handler so AppError status codes are
  // asserted against the real formatting path.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json(err.toResponse());
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR' } });
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as any;
  return {
    url: `http://127.0.0.1:${addr.port}`,
    queue: options.queue,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rare-route-'));
}

const DEV_KEY = () => authManager.getDeveloperKey();
const CLIENT_KEY = () => authManager.getClientKey();

describe('Engine route — feature flag', () => {
  let h: Harness;
  let dir: string;

  before(async () => {
    dir = tmpDir();
    h = await startApp({ enabled: false, queue: new JobQueue({ dir }) });
  });
  after(async () => {
    await h.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns 404 when the flag is off, even with a valid key', async () => {
    const res = await fetch(`${h.url}/api/v1/engine/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEV_KEY()}` },
      body: JSON.stringify({ goal: 'anything' }),
    });
    assert.equal(res.status, 404);
    const body: any = await res.json();
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  it('enqueues nothing when the flag is off', async () => {
    assert.equal(h.queue.list().length, 0);
  });
});

describe('Engine worker — retry idempotency', () => {
  it('sends the stable queue job id to Python on every retry', async () => {
    const dir = tmpDir();
    const queue = new JobQueue({ dir });
    const job = queue.enqueue({ goal: 'perform one bounded task' });
    const taskIds: Array<string | undefined> = [];
    let calls = 0;
    const client = {
      runTask: async (_goal: string, options: { taskId?: string }) => {
        taskIds.push(options.taskId);
        calls += 1;
        if (calls === 1) {
          const err: any = new Error('temporary timeout');
          err.status = 0;
          err.code = 'TIMEOUT';
          throw err;
        }
        return {
          status: 'succeeded',
          taskId: options.taskId!,
          result: 'done',
          error: null,
          errorCode: null,
        };
      },
    };
    const worker = startJobWorker(queue, client as any, 60_000);

    try {
      await worker.drain();
      assert.deepEqual(taskIds, [job.id, job.id]);
      assert.equal(queue.get(job.id)?.status, 'done');
    } finally {
      worker.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Engine route — authentication', () => {
  let h: Harness;
  let dir: string;

  before(async () => {
    dir = tmpDir();
    h = await startApp({ enabled: true, queue: new JobQueue({ dir }) });
  });
  after(async () => {
    await h.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a wrong key with 401', async () => {
    const res = await fetch(`${h.url}/api/v1/engine/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-a-real-key' },
      body: JSON.stringify({ goal: 'anything' }),
    });
    assert.equal(res.status, 401);
  });

  /**
   * NOTE — pre-existing behaviour, documented rather than "fixed" here.
   *
   * AuthManager.resolveRole() grants the `developer` role to any caller whose
   * req.ip is 127.0.0.1/::1, or that presents a same-origin Host/Origin pair.
   * That is deliberate for the local dashboard, but it means a request with NO
   * credentials from loopback is authenticated. This test asserts the actual
   * behaviour so the assumption is visible; it is NOT a claim that the route
   * is safe to expose on a public interface without a reverse proxy that
   * rewrites the client IP. Recorded in DEPLOYMENT.md.
   */
  it('treats a credential-less loopback caller as developer (documented app behaviour)', async () => {
    const res = await fetch(`${h.url}/api/v1/engine/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: 'loopback caller' }),
    });
    // 503 = auth passed, no engine configured. Not 401.
    assert.equal(res.status, 503);
  });

  it('accepts a valid client key', async () => {
    const res = await fetch(`${h.url}/api/v1/engine/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CLIENT_KEY()}` },
      body: JSON.stringify({ goal: 'valid goal' }),
    });
    // 503 because no engine client is configured — but auth passed, which is
    // what this test is about.
    assert.equal(res.status, 503);
  });
});

describe('Engine route — validation', () => {
  let h: Harness;
  let dir: string;

  before(async () => {
    dir = tmpDir();
    h = await startApp({ enabled: true, queue: new JobQueue({ dir }) });
  });
  after(async () => {
    await h.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a missing goal with 400', async () => {
    const res = await fetch(`${h.url}/api/v1/engine/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEV_KEY()}` },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  it('rejects an oversized goal with 400', async () => {
    const res = await fetch(`${h.url}/api/v1/engine/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEV_KEY()}` },
      body: JSON.stringify({ goal: 'x'.repeat(8001) }),
    });
    assert.equal(res.status, 400);
  });
});

describe('Engine route — engine unavailable', () => {
  let h: Harness;
  let dir: string;

  before(async () => {
    dir = tmpDir();
    // A client whose every call fails, standing in for a dead Python service.
    const deadClient = {
      health: async () => {
        throw new Error('ECONNREFUSED');
      },
      runTask: async () => {
        throw new Error('ECONNREFUSED');
      },
    };
    h = await startApp({ enabled: true, client: deadClient, queue: new JobQueue({ dir }) });
  });
  after(async () => {
    await h.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns 202 and records the job even when the engine is down', async () => {
    const res = await fetch(`${h.url}/api/v1/engine/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEV_KEY()}` },
      body: JSON.stringify({ goal: 'survive an outage' }),
    });
    assert.equal(res.status, 202);
    const body: any = await res.json();
    assert.equal(body.job.status, 'pending');
    // The job is durable: it is on disk, so it survives the outage.
    assert.equal(h.queue.list().length, 1);
  });

  it('reports engine health failure without crashing the app', async () => {
    const res = await fetch(`${h.url}/api/v1/engine/health`, {
      headers: { Authorization: `Bearer ${DEV_KEY()}` },
    });
    // The stub throws a plain Error, so the centralized handler returns 500.
    // The important assertion is that the process is still serving.
    assert.ok(res.status >= 500);
    const after = await fetch(`${h.url}/api/v1/engine/jobs`, {
      headers: { Authorization: `Bearer ${DEV_KEY()}` },
    });
    assert.equal(after.status, 200);
  });
});

describe('Engine route — idempotency and ownership', () => {
  let h: Harness;
  let dir: string;

  before(async () => {
    dir = tmpDir();
    const okClient = {
      health: async () => ({ ok: true }),
      runTask: async () => ({ taskId: 't1', status: 'succeeded', result: 'done' }),
    };
    h = await startApp({ enabled: true, client: okClient, queue: new JobQueue({ dir }) });
  });
  after(async () => {
    await h.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns the same job for a repeated idempotency key', async () => {
    const post = () =>
      fetch(`${h.url}/api/v1/engine/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEV_KEY()}` },
        body: JSON.stringify({ goal: 'idempotent work', idempotencyKey: 'route-k1' }),
      });

    const first: any = await (await post()).json();
    const second: any = await (await post()).json();
    assert.equal(first.job.id, second.job.id);
    assert.equal(h.queue.list().length, 1);
  });

  it('does not expose another owner’s job when an idempotency key is reused', async () => {
    const post = (key: string, goal: string) =>
      fetch(`${h.url}/api/v1/engine/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ goal, idempotencyKey: 'shared-owner-key' }),
      });

    const developer = (await (await post(DEV_KEY(), 'private developer goal')).json()) as any;
    const client = (await (await post(CLIENT_KEY(), 'client-owned goal')).json()) as any;

    assert.notEqual(developer.job.id, client.job.id);
    assert.equal(client.job.goal, 'client-owned goal');
  });

  it('returns 409 when an owner reuses a key for a different goal', async () => {
    const post = (goal: string) =>
      fetch(`${h.url}/api/v1/engine/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEV_KEY()}` },
        body: JSON.stringify({ goal, idempotencyKey: 'changed-payload-key' }),
      });

    assert.equal((await post('first goal')).status, 202);
    const conflict = await post('different goal');
    assert.equal(conflict.status, 409);
    const body: any = await conflict.json();
    assert.equal(body.error.code, 'IDEMPOTENCY_CONFLICT');
  });

  it('does not leak a job to a different client', async () => {
    const created: any = await (
      await fetch(`${h.url}/api/v1/engine/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEV_KEY()}` },
        body: JSON.stringify({ goal: 'developer only' }),
      })
    ).json();

    // The client key resolves to a different clientId, so it must not see it.
    const res = await fetch(`${h.url}/api/v1/engine/jobs/${created.job.id}`, {
      headers: { Authorization: `Bearer ${CLIENT_KEY()}` },
    });
    assert.equal(res.status, 404);
  });

  it('lets the owner read its own job', async () => {
    const created: any = await (
      await fetch(`${h.url}/api/v1/engine/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEV_KEY()}` },
        body: JSON.stringify({ goal: 'mine' }),
      })
    ).json();

    const res = await fetch(`${h.url}/api/v1/engine/jobs/${created.job.id}`, {
      headers: { Authorization: `Bearer ${DEV_KEY()}` },
    });
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(body.job.goal, 'mine');
  });
});
