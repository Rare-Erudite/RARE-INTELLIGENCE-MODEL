/**
 * RARE-INTELLIGENCE — Job queue + engine route tests
 *
 * These use Node's built-in test runner (`node --test --experimental-strip-types`)
 * so no new devDependency is required. Everything is driven synchronously:
 * the queue takes an injected clock and the worker is awaited directly, so
 * nothing here waits on a real timer.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { JobQueue, JobWorker } from './jobQueue.ts';
import {
  isEngineFeatureEnabled,
  normaliseIdempotencyKey,
  validateGoal,
} from '../integration/engine_route.ts';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rare-jobs-'));
}

describe('JobQueue persistence', () => {
  it('writes a job file and reads it back', () => {
    const dir = tmpDir();
    const q = new JobQueue({ dir });
    const job = q.enqueue({ goal: 'do the thing' });
    assert.equal(job.status, 'pending');

    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, `${job.id}.json`), 'utf-8'));
    assert.equal(onDisk.goal, 'do the thing');
    assert.equal(onDisk.attempts, 0);

    const reloaded = new JobQueue({ dir });
    assert.equal(reloaded.get(job.id)?.goal, 'do the thing');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('leaves no .tmp files behind', () => {
    const dir = tmpDir();
    const q = new JobQueue({ dir });
    q.enqueue({ goal: 'a' });
    q.enqueue({ goal: 'b' });
    const junk = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(junk, []);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('skips a corrupt job file instead of crashing', () => {
    const dir = tmpDir();
    const q = new JobQueue({ dir });
    const good = q.enqueue({ goal: 'good' });
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json');

    const reloaded = new JobQueue({ dir });
    const jobs = reloaded.load();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, good.id);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Idempotency', () => {
  it('returns the same job for a repeated idempotency key', () => {
    const dir = tmpDir();
    const q = new JobQueue({ dir });
    const a = q.enqueue({ goal: 'charge card', idempotencyKey: 'k1' });
    const b = q.enqueue({ goal: 'charge card', idempotencyKey: 'k1' });
    assert.equal(a.id, b.id);
    assert.equal(q.list().length, 1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('survives a restart — the key still matches on a fresh instance', () => {
    const dir = tmpDir();
    const a = new JobQueue({ dir }).enqueue({ goal: 'charge card', idempotencyKey: 'k2' });

    // New process simulation: brand new instance, no shared memory.
    const reloaded = new JobQueue({ dir });
    const b = reloaded.enqueue({ goal: 'charge card', idempotencyKey: 'k2' });
    assert.equal(a.id, b.id);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('different keys create different jobs', () => {
    const dir = tmpDir();
    const q = new JobQueue({ dir });
    const a = q.enqueue({ goal: 'x', idempotencyKey: 'k1' });
    const b = q.enqueue({ goal: 'x', idempotencyKey: 'k2' });
    assert.notEqual(a.id, b.id);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('scopes idempotency keys to the owning client', () => {
    const dir = tmpDir();
    const q = new JobQueue({ dir });
    const developer = q.enqueue({
      goal: 'private developer task',
      idempotencyKey: 'shared-key',
      ownerId: 'developer_admin',
    });
    const client = q.enqueue({
      goal: 'client task',
      idempotencyKey: 'shared-key',
      ownerId: 'rare_the_sixth_client',
    });

    assert.notEqual(developer.id, client.id);
    assert.equal(q.findByIdempotencyKey('shared-key')?.id, developer.id);
    assert.equal(q.findByIdempotencyKey('shared-key', 'rare_the_sixth_client')?.id, client.id);
    assert.equal(q.getOwned(developer.id, 'rare_the_sixth_client'), null);
    assert.equal(q.getOwned(client.id, 'rare_the_sixth_client')?.goal, 'client task');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a repeated key with a different request for the same owner', () => {
    const dir = tmpDir();
    const q = new JobQueue({ dir });
    q.enqueue({ goal: 'first goal', idempotencyKey: 'same-owner-key', ownerId: 'client_a' });

    assert.throws(
      () =>
        q.enqueue({
          goal: 'different goal',
          idempotencyKey: 'same-owner-key',
          ownerId: 'client_a',
        }),
      /different request/,
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a repeated key with changed metadata for the same owner', () => {
    const dir = tmpDir();
    const q = new JobQueue({ dir });
    q.enqueue({
      goal: 'same goal',
      idempotencyKey: 'same-metadata-key',
      ownerId: 'client_a',
      metadata: { source: 'first' },
    });

    assert.throws(
      () =>
        q.enqueue({
          goal: 'same goal',
          idempotencyKey: 'same-metadata-key',
          ownerId: 'client_a',
          metadata: { source: 'second' },
        }),
      /different request/,
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Crash recovery', () => {
  it('requeues a job left running by a dead process', () => {
    const dir = tmpDir();
    const q = new JobQueue({ dir });
    const job = q.enqueue({ goal: 'interrupted' });
    q.claim(job.id); // attempts -> 1, status running
    assert.equal(q.get(job.id)?.status, 'running');

    // Process dies here. New instance on restart:
    const reloaded = new JobQueue({ dir });
    const outcome = reloaded.recover();
    assert.equal(outcome.requeued, 1);
    assert.equal(outcome.exhausted, 0);
    assert.equal(reloaded.get(job.id)?.status, 'pending');
    // Attempt count is preserved so a poison job cannot loop forever.
    assert.equal(reloaded.get(job.id)?.attempts, 1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('marks an interrupted job failed once attempts are exhausted', () => {
    const dir = tmpDir();
    const q = new JobQueue({ dir });
    const job = q.enqueue({ goal: 'poison', maxAttempts: 1 });
    q.claim(job.id);
    assert.equal(q.get(job.id)?.attempts, 1);

    const reloaded = new JobQueue({ dir });
    const outcome = reloaded.recover();
    assert.equal(outcome.exhausted, 1);
    assert.equal(reloaded.get(job.id)?.status, 'failed');
    assert.equal(reloaded.get(job.id)?.errorCode, 'INTERRUPTED');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('does not touch pending or done jobs', () => {
    const dir = tmpDir();
    const q = new JobQueue({ dir });
    const pending = q.enqueue({ goal: 'untouched' });
    const done = q.enqueue({ goal: 'finished' });
    q.claim(done.id);
    q.complete(done.id, 'ok');

    const outcome = new JobQueue({ dir }).recover();
    assert.equal(outcome.requeued, 0);
    assert.equal(q.get(pending.id)?.status, 'pending');
  });
});

describe('JobWorker', () => {
  it('runs pending jobs and records the result', async () => {
    const dir = tmpDir();
    const q = new JobQueue({ dir });
    const job = q.enqueue({ goal: 'compute' });
    const worker = new JobWorker(q, async () => ({ result: 'computed', engineTaskId: 't1' }));
    const outcome = await worker.drain();

    assert.equal(outcome.completed, 1);
    assert.equal(q.get(job.id)?.status, 'done');
    assert.equal(q.get(job.id)?.result, 'computed');
    assert.equal(q.get(job.id)?.engineTaskId, 't1');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('retries a transient failure and succeeds on the next attempt', async () => {
    const dir = tmpDir();
    const q = new JobQueue({ dir });
    const job = q.enqueue({ goal: 'flaky' });
    let calls = 0;
    const worker = new JobWorker(q, async () => {
      calls += 1;
      if (calls === 1) {
        const err: any = new Error('engine down');
        err.status = 503;
        err.code = 'SERVICE_UNAVAILABLE';
        throw err;
      }
      return { result: 'ok' };
    });

    // drain() loops until the queue is empty, so a retryable failure is
    // retried inside the SAME drain. That is the intended behaviour: the
    // worker keeps going rather than waiting for the next timer tick.
    const outcome = await worker.drain();
    assert.equal(outcome.completed, 1);
    assert.equal(q.get(job.id)?.status, 'done');
    assert.equal(calls, 2);
    assert.equal(q.get(job.id)?.attempts, 2);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('does not retry a 4xx — a bad request is not transient', async () => {
    const dir = tmpDir();
    const q = new JobQueue({ dir });
    const job = q.enqueue({ goal: 'bad' });
    const worker = new JobWorker(q, async () => {
      const err: any = new Error('goal is invalid');
      err.status = 400;
      err.code = 'VALIDATION_FAILED';
      throw err;
    });
    await worker.drain();
    assert.equal(q.get(job.id)?.status, 'failed');
    assert.equal(q.get(job.id)?.attempts, 1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('stops after maxAttempts instead of looping forever', async () => {
    const dir = tmpDir();
    const q = new JobQueue({ dir });
    const job = q.enqueue({ goal: 'always fails', maxAttempts: 2 });
    let calls = 0;
    const worker = new JobWorker(q, async () => {
      calls += 1;
      const err: any = new Error('500');
      err.status = 500;
      throw err;
    });

    await worker.drain();
    await worker.drain();
    await worker.drain(); // nothing pending any more

    assert.equal(calls, 2);
    assert.equal(q.get(job.id)?.status, 'failed');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('recovers then runs an interrupted job in one drain', async () => {
    const dir = tmpDir();
    const q = new JobQueue({ dir });
    const job = q.enqueue({ goal: 'resume me' });
    q.claim(job.id);

    let seenAttempt = 0;
    const worker = new JobWorker(q, async (j) => {
      seenAttempt = j.attempts;
      return { result: 'recovered' };
    });
    const outcome = await worker.drain();

    assert.equal(outcome.completed, 1);
    assert.equal(seenAttempt, 2); // 1 from the dead process + 1 here
    assert.equal(q.get(job.id)?.status, 'done');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Ownership', () => {
  it('hides a job from a different owner', () => {
    const dir = tmpDir();
    const q = new JobQueue({ dir });
    const job = q.enqueue({ goal: 'private', ownerId: 'client_a' });

    assert.ok(q.getOwned(job.id, 'client_a'));
    assert.equal(q.getOwned(job.id, 'client_b'), null);
    assert.equal(q.getOwned(job.id, null), null);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Validation', () => {
  it('rejects a missing, empty, non-string or oversized goal', () => {
    assert.throws(() => validateGoal({}), /must be a string/);
    assert.throws(() => validateGoal({ goal: 42 }), /must be a string/);
    assert.throws(() => validateGoal({ goal: '   ' }), /must not be empty/);
    assert.throws(() => validateGoal({ goal: 'x'.repeat(8001) }), /exceeds/);
    assert.throws(() => validateGoal(null), /JSON object/);
  });

  it('trims an otherwise valid goal', () => {
    assert.equal(validateGoal({ goal: '  hello  ' }), 'hello');
  });

  it('normalises idempotency keys and rejects non-strings', () => {
    assert.equal(normaliseIdempotencyKey(undefined), null);
    assert.equal(normaliseIdempotencyKey(''), null);
    assert.equal(normaliseIdempotencyKey('  k1 '), 'k1');
    assert.throws(() => normaliseIdempotencyKey(7), /must be a string/);
    assert.throws(() => normaliseIdempotencyKey('x'.repeat(201)), /exceeds/);
  });
});

describe('Feature flag', () => {
  const original = process.env.ENGINE_FEATURE_ENABLED;
  after(() => {
    if (original === undefined) delete process.env.ENGINE_FEATURE_ENABLED;
    else process.env.ENGINE_FEATURE_ENABLED = original;
  });

  it('is off unless the env var is exactly "true"', () => {
    delete process.env.ENGINE_FEATURE_ENABLED;
    assert.equal(isEngineFeatureEnabled(), false);
    process.env.ENGINE_FEATURE_ENABLED = '1';
    assert.equal(isEngineFeatureEnabled(), false);
    process.env.ENGINE_FEATURE_ENABLED = 'TRUE';
    assert.equal(isEngineFeatureEnabled(), false);
    process.env.ENGINE_FEATURE_ENABLED = 'true';
    assert.equal(isEngineFeatureEnabled(), true);
  });
});
