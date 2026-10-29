/**
 * RARE-INTELLIGENCE — Durable Job Queue
 *
 * Why this exists: the Python engine's `/v1/tasks` endpoint is synchronous and
 * a task can legitimately take minutes. An Express request cannot wait for
 * that (server.ts enforces a 35s response bound), and an in-process
 * `setTimeout`/promise is NOT durable — if the process dies mid-task the job
 * is lost with no record that it ever existed.
 *
 * So state lives on disk: one JSON file per job under `data/jobs/`. Every
 * write is atomic (temp file + rename) because a partially written job file
 * is worse than no job file — it cannot be parsed and cannot be recovered.
 *
 * Durability here means: a job that was running when the process died is
 * still on disk afterwards, is found by `recover()`, and is retried with its
 * attempt count intact so a poison job cannot loop forever.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface JobRecord {
  id: string;
  status: JobStatus;
  goal: string;
  attempts: number;
  maxAttempts: number;
  idempotencyKey: string | null;
  createdAt: number;
  updatedAt: number;
  result?: string | null;
  error?: string | null;
  errorCode?: string | null;
  engineTaskId?: string | null;
  metadata?: Record<string, unknown>;
  /** Caller identity that owns this job. Null = anonymous/system job. */
  ownerId?: string | null;
}

export interface EnqueueOptions {
  goal: string;
  idempotencyKey?: string | null;
  maxAttempts?: number;
  metadata?: Record<string, unknown>;
  ownerId?: string | null;
}

export interface JobQueueOptions {
  dir?: string;
  /** Injected clock so tests do not rely on wall time. */
  now?: () => number;
}

const DEFAULT_MAX_ATTEMPTS = 3;

export class JobQueue {
  private readonly dir: string;
  private readonly now: () => number;
  private index: Map<string, JobRecord> | null = null;

  constructor(options: JobQueueOptions = {}) {
    this.dir = options.dir
      ? path.resolve(options.dir)
      : path.resolve(process.cwd(), 'data', 'jobs');
    this.now = options.now ?? (() => Date.now());
  }

  public get directory(): string {
    return this.dir;
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  private pathFor(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  /**
   * Atomic write: a reader never observes a half-written job file.
   * `wx` on the temp name would collide between concurrent writers, so the
   * temp name carries randomness and the rename is the only atomic step.
   */
  private writeAtomic(record: JobRecord): void {
    this.ensureDir();
    const target = this.pathFor(record.id);
    const tmp = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    const payload = JSON.stringify(record, null, 2);
    let fd: number | null = null;
    try {
      fd = fs.openSync(tmp, 'w');
      fs.writeSync(fd, payload);
      // fsync before rename: on a crash the rename could otherwise point at
      // an empty inode on some filesystems.
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;
      fs.renameSync(tmp, target);
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          /* already closed */
        }
      }
      if (fs.existsSync(tmp)) {
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* best effort */
        }
      }
    }
    if (this.index) this.index.set(record.id, record);
  }

  private parseFile(filePath: string): JobRecord | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.id !== 'string' || typeof parsed.status !== 'string') {
        return null;
      }
      return parsed as JobRecord;
    } catch {
      // A corrupt job file must never take the queue down with it.
      return null;
    }
  }

  /** Load every job file. Corrupt files are skipped, not fatal. */
  public load(): JobRecord[] {
    this.ensureDir();
    this.index = new Map();
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const record = this.parseFile(path.join(this.dir, file));
      if (record) this.index.set(record.id, record);
    }
    return [...this.index.values()];
  }

  public list(): JobRecord[] {
    if (!this.index) this.load();
    return [...(this.index as Map<string, JobRecord>).values()].sort(
      (a, b) => b.createdAt - a.createdAt,
    );
  }

  public get(id: string): JobRecord | null {
    if (!this.index) this.load();
    return (this.index as Map<string, JobRecord>).get(id) ?? null;
  }

  /**
   * Ownership check. A caller may only observe jobs it enqueued; without this
   * any authenticated client could read another client's task output.
   */
  public getOwned(id: string, ownerId: string | null): JobRecord | null {
    const job = this.get(id);
    if (!job) return null;
    if ((job.ownerId ?? null) !== (ownerId ?? null)) return null;
    return job;
  }

  public findByIdempotencyKey(key: string): JobRecord | null {
    if (!this.index) this.load();
    for (const job of (this.index as Map<string, JobRecord>).values()) {
      if (job.idempotencyKey === key) return job;
    }
    return null;
  }

  /**
   * Enqueue a job. When `idempotencyKey` was already used, the existing job is
   * returned untouched — this is what stops a client retry (after a dropped
   * connection) from running the same side effects twice.
   */
  public enqueue(options: EnqueueOptions): JobRecord {
    if (options.idempotencyKey) {
      const existing = this.findByIdempotencyKey(options.idempotencyKey);
      if (existing) return existing;
    }

    const ts = this.now();
    const record: JobRecord = {
      id: 'job_' + crypto.randomBytes(8).toString('hex'),
      status: 'pending',
      goal: options.goal,
      attempts: 0,
      maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      idempotencyKey: options.idempotencyKey ?? null,
      createdAt: ts,
      updatedAt: ts,
      result: null,
      error: null,
      errorCode: null,
      engineTaskId: null,
      metadata: options.metadata ?? {},
      ownerId: options.ownerId ?? null,
    };
    this.writeAtomic(record);
    return record;
  }

  /** Claim a job for execution. Returns null when it is already taken. */
  public claim(id: string): JobRecord | null {
    const job = this.get(id);
    if (!job || job.status !== 'pending') return null;
    const updated: JobRecord = {
      ...job,
      status: 'running',
      attempts: job.attempts + 1,
      updatedAt: this.now(),
    };
    this.writeAtomic(updated);
    return updated;
  }

  public complete(id: string, result: string, engineTaskId?: string | null): JobRecord | null {
    const job = this.get(id);
    if (!job) return null;
    const updated: JobRecord = {
      ...job,
      status: 'done',
      result,
      error: null,
      errorCode: null,
      engineTaskId: engineTaskId ?? job.engineTaskId ?? null,
      updatedAt: this.now(),
    };
    this.writeAtomic(updated);
    return updated;
  }

  /**
   * Record a failure. Retry while attempts < maxAttempts, otherwise fail
   * permanently — a job that always throws must not be retried forever.
   */
  public fail(
    id: string,
    error: string,
    errorCode: string | null = null,
    retryable = true,
  ): JobRecord | null {
    const job = this.get(id);
    if (!job) return null;
    const exhausted = !retryable || job.attempts >= job.maxAttempts;
    const updated: JobRecord = {
      ...job,
      status: exhausted ? 'failed' : 'pending',
      error,
      errorCode,
      updatedAt: this.now(),
    };
    this.writeAtomic(updated);
    return updated;
  }

  /**
   * Crash recovery. Any job still marked `running` belongs to a process that
   * no longer exists — nothing else can be holding it, because the whole
   * point of the on-disk claim is that the claim dies with its process.
   * Those jobs go back to `pending` (attempt count preserved) so they are
   * retried, or to `failed` if their attempts are already exhausted.
   */
  public recover(): { requeued: number; exhausted: number } {
    if (!this.index) this.load();
    let requeued = 0;
    let exhausted = 0;
    for (const job of [...(this.index as Map<string, JobRecord>).values()]) {
      if (job.status !== 'running') continue;
      if (job.attempts >= job.maxAttempts) {
        this.writeAtomic({
          ...job,
          status: 'failed',
          error: job.error ?? 'interrupted: attempts exhausted after restart',
          errorCode: job.errorCode ?? 'INTERRUPTED',
          updatedAt: this.now(),
        });
        exhausted += 1;
      } else {
        this.writeAtomic({
          ...job,
          status: 'pending',
          error: job.error ?? 'interrupted by restart',
          errorCode: job.errorCode ?? 'INTERRUPTED',
          updatedAt: this.now(),
        });
        requeued += 1;
      }
    }
    return { requeued, exhausted };
  }

  public pending(): JobRecord[] {
    return this.list().filter((j) => j.status === 'pending');
  }
}

export type JobRunner = (job: JobRecord) => Promise<{ result: string; engineTaskId?: string }>;

/**
 * Drains the queue. Single-flight by design: one worker, one job at a time.
 * Concurrency against a single-process Python engine would only queue
 * requests inside it anyway, while making the retry story much harder to
 * reason about.
 */
export class JobWorker {
  private running = false;

  constructor(
    private readonly queue: JobQueue,
    private readonly runner: JobRunner,
  ) {}

  public async drain(): Promise<{ processed: number; completed: number; failed: number }> {
    if (this.running) return { processed: 0, completed: 0, failed: 0 };
    this.running = true;
    let processed = 0;
    let completed = 0;
    let failed = 0;

    try {
      this.queue.recover();
      // Re-read each pass: a job requeued by `fail()` must be picked up.
      for (;;) {
        const next = this.queue.pending()[0];
        if (!next) break;
        const claimed = this.queue.claim(next.id);
        if (!claimed) break;
        processed += 1;
        try {
          const outcome = await this.runner(claimed);
          this.queue.complete(claimed.id, outcome.result, outcome.engineTaskId ?? null);
          completed += 1;
        } catch (err: any) {
          const code = typeof err?.code === 'string' ? err.code : null;
          // A 4xx from the engine is a bad request, not a transient fault:
          // retrying it would just burn attempts.
          const retryable =
            typeof err?.status === 'number' ? err.status === 0 || err.status >= 500 : true;
          const updated = this.queue.fail(
            claimed.id,
            err?.message ? String(err.message) : 'unknown error',
            code,
            retryable,
          );
          if (updated?.status === 'failed') failed += 1;
        }
      }
    } finally {
      this.running = false;
    }

    return { processed, completed, failed };
  }
}
