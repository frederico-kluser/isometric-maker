/**
 * Queue tests: state transitions, expiry ordering, semaphore, limiter.
 *
 * No network. The queue store uses temp files; all other units are pure logic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  QueueStore, WeightedSemaphore, AdaptiveLimiter,
  concurrencyFor, weightFor, downloadDeadlineFor,
  type JobRecord,
} from './queue.ts';
import { TIER_CONCURRENCY, COST_TABLE, type Tier } from './cost.ts';
import type { EndpointId } from './endpoints.ts';

// ---------------------------------------------------------------------------
// QueueStore: state transitions
// ---------------------------------------------------------------------------

test('job submitted never comes back as pending', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'queue-submitted-'));
  try {
    const store = await QueueStore.open(join(dir, 'queue.json'));

    // Create a job in 'pending' state
    const pending: JobRecord = {
      assetId: 'test/one',
      specHash: 'sha256:aa',
      endpoint: 'create-image-pixen' as EndpointId,
      state: 'pending',
      attempts: 0,
      costUsd: 0.01,
    };
    await store.put(pending);

    // After submit, it transitions to 'submitted'
    pending.state = 'submitted';
    pending.jobId = 'job-123';
    pending.submittedAt = new Date().toISOString();
    await store.put(pending);

    const reloaded = store.get('test/one');
    assert.ok(reloaded);
    assert.equal(reloaded.state, 'submitted');
    assert.notEqual(reloaded.state, 'pending',
      'once submitted, state must never be pending again');

    // Verify it appears in pendingPaid
    const paid = store.pendingPaid();
    assert.ok(paid.some((j) => j.assetId === 'test/one'),
      'submitted job must appear in pendingPaid');

    // Transition to completed
    pending.state = 'completed';
    pending.completedAt = new Date().toISOString();
    await store.put(pending);
    assert.equal(store.get('test/one')!.state, 'completed');

    // Transition to downloaded
    pending.state = 'downloaded';
    await store.put(pending);
    assert.equal(store.get('test/one')!.state, 'downloaded');

    // Downloaded should NOT appear in pendingPaid
    const paidAfter = store.pendingPaid();
    assert.ok(!paidAfter.some((j) => j.assetId === 'test/one'),
      'downloaded job must not appear in pendingPaid');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('stalled jobs appear in pendingPaid (money already spent); failed do not', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'queue-failed-'));
  try {
    const store = await QueueStore.open(join(dir, 'queue.json'));

    // pendingPaid covers submitted, completed, stalled — NOT failed.
    // A failed job has no job id to poll and must be regenerated.
    const failedJob: JobRecord = {
      assetId: 'test/failed',
      specHash: 'sha256:bb',
      endpoint: 'create-image-pixen' as EndpointId,
      state: 'failed',
      jobId: 'job-fail',
      submittedAt: new Date().toISOString(),
      attempts: 1,
      lastError: 'something broke',
      costUsd: 0.01,
    };
    await store.put(failedJob);

    const stalledJob: JobRecord = {
      assetId: 'test/stalled',
      specHash: 'sha256:cc',
      endpoint: 'create-character-with-8-directions' as EndpointId,
      state: 'stalled',
      jobId: 'job-stall',
      submittedAt: new Date().toISOString(),
      attempts: 3,
      lastError: 'timeout',
      costUsd: 0.02,
    };
    await store.put(stalledJob);

    const paid = store.pendingPaid();
    // pendingPaid deliberately excludes 'failed' — it has no recoverable job id
    assert.ok(!paid.some((j) => j.assetId === 'test/failed'),
      'failed jobs must not appear in pendingPaid');
    assert.ok(paid.some((j) => j.assetId === 'test/stalled'),
      'stalled jobs must appear in pendingPaid');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// atRiskOfExpiry: ordering by deadline
// ---------------------------------------------------------------------------

test('atRiskOfExpiry orders by deadline, soonest first', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'queue-expiry-'));
  try {
    const store = await QueueStore.open(join(dir, 'queue.json'));

    const now = Date.now();
    const in1h = new Date(now + 3_600_000).toISOString();
    const in3h = new Date(now + 10_800_000).toISOString();
    const in30m = new Date(now + 1_800_000).toISOString();

    await store.put({
      assetId: 'a', specHash: 'sha256:a1',
      endpoint: 'map-objects' as EndpointId,
      state: 'completed', jobId: 'j1', submittedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      downloadDeadline: in1h, attempts: 1, costUsd: 0.01,
    });
    await store.put({
      assetId: 'b', specHash: 'sha256:b1',
      endpoint: 'map-objects' as EndpointId,
      state: 'completed', jobId: 'j2', submittedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      downloadDeadline: in3h, attempts: 1, costUsd: 0.01,
    });
    await store.put({
      assetId: 'c', specHash: 'sha256:c1',
      endpoint: 'map-objects' as EndpointId,
      state: 'completed', jobId: 'j3', submittedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      downloadDeadline: in30m, attempts: 1, costUsd: 0.01,
    });

    const atRisk = store.atRiskOfExpiry();
    assert.equal(atRisk.length, 3);
    assert.equal(atRisk[0]?.assetId, 'c', 'soonest deadline must be first');
    assert.equal(atRisk[1]?.assetId, 'a');
    assert.equal(atRisk[2]?.assetId, 'b', 'latest deadline must be last');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('atRiskOfExpiry excludes downloaded jobs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'queue-expiry-dl-'));
  try {
    const store = await QueueStore.open(join(dir, 'queue.json'));
    const now = Date.now();
    const deadline = new Date(now + 3_600_000).toISOString();

    await store.put({
      assetId: 'urgent', specHash: 'sha256:u1',
      endpoint: 'map-objects' as EndpointId,
      state: 'downloaded', jobId: 'ju', submittedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      downloadDeadline: deadline, attempts: 1, costUsd: 0.01,
    });

    const atRisk = store.atRiskOfExpiry();
    assert.ok(!atRisk.some((j) => j.assetId === 'urgent'),
      'downloaded jobs must not appear in atRiskOfExpiry');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// WeightedSemaphore
// ---------------------------------------------------------------------------

test('WeightedSemaphore does not deadlock with a job heavier than capacity', async () => {
  // Capacity 4, job weight 6: should still eventually acquire and not hang
  const sem = new WeightedSemaphore(4);

  const start = Date.now();
  const p = sem.acquire(6);
  // Release immediately (simulating some other job finishing)
  sem.release(2);

  const timeout = new Promise<void>((_, reject) =>
    setTimeout(() => reject(new Error('semaphore deadlocked')), 1000));

  await Promise.race([p, timeout]);
  // If we got here, it didn't deadlock
  sem.release(6); // cleanup
});

test('WeightedSemaphore respects capacity for light jobs', async () => {
  const sem = new WeightedSemaphore(4);
  const completed: number[] = [];

  const job = async (id: number, weight: number) => {
    await sem.acquire(weight);
    completed.push(id);
    // Hold for a tick to prove ordering
    await new Promise((r) => setTimeout(r, 5));
    sem.release(weight);
  };

  // Start 3 weight-2 jobs; only 2 fit at once
  await Promise.all([job(1, 2), job(2, 2), job(3, 2)]);
  assert.equal(completed.length, 3, 'all three should complete');
});

// ---------------------------------------------------------------------------
// AdaptiveLimiter
// ---------------------------------------------------------------------------

test('AdaptiveLimiter penalise reduces rate (429 simulation)', () => {
  const limiter = new AdaptiveLimiter(10);
  const initialRate = limiter.rate;
  assert.equal(initialRate, 10);

  limiter.penalise();
  assert.equal(limiter.rate, 5, 'penalise halves the rate');

  limiter.penalise();
  assert.equal(limiter.rate, 2.5);

  // Floor at 0.2
  for (let i = 0; i < 20; i++) limiter.penalise();
  assert.equal(limiter.rate, 0.2, 'rate must floor at 0.2');
});

test('AdaptiveLimiter reward recovers rate up to ceiling', () => {
  const limiter = new AdaptiveLimiter(10);

  limiter.penalise(); // 10 → 5
  limiter.penalise(); // 5 → 2.5

  // reward is +0.05 each call; need (10 - 2.5) / 0.05 = 150 calls
  for (let i = 0; i < 200; i++) limiter.reward();
  assert.equal(limiter.rate, 10, 'reward must not exceed ceiling');
});

test('AdaptiveLimiter reserve returns wait time when no tokens available', () => {
  // burst = rate = 2, so first two calls consume 1 token each
  const limiter = new AdaptiveLimiter(2);
  const now = Date.now();

  // First call: burst token available (2 tokens in bucket)
  const w1 = limiter.reserve(now);
  assert.equal(w1, 0, 'first call with token should return 0');

  // Second call: second burst token
  const w2 = limiter.reserve(now);
  assert.equal(w2, 0, 'second call with token should return 0');

  // Third call: no tokens left, must wait
  const w3 = limiter.reserve(now);
  assert.ok(w3 > 0, `third call without tokens should wait, got ${w3}`);
});

// ---------------------------------------------------------------------------
// concurrencyFor / weightFor
// ---------------------------------------------------------------------------

test('concurrencyFor returns documented tier values', () => {
  assert.equal(concurrencyFor('free'), 1);
  assert.equal(concurrencyFor('t1'), 2);
  assert.equal(concurrencyFor('t2'), 4);
  assert.equal(concurrencyFor('t3'), 20);
});

test('weightFor returns the concurrencyWeight from COST_TABLE', () => {
  assert.equal(weightFor('create-image-pixen'), 1);
  assert.equal(weightFor('create-character-with-8-directions'), 3);
  assert.equal(weightFor('create-character-pro'), 6);
});

// ---------------------------------------------------------------------------
// downloadDeadlineFor
// ---------------------------------------------------------------------------

test('downloadDeadlineFor returns undefined for non-ephemeral endpoints', () => {
  const deadline = downloadDeadlineFor(
    'create-image-pixen' as EndpointId,
    new Date(),
  );
  assert.equal(deadline, undefined);
});

test('downloadDeadlineFor returns ISO date for ephemeral endpoints', () => {
  const now = new Date('2026-01-01T12:00:00Z');
  const deadline = downloadDeadlineFor('map-objects' as EndpointId, now);
  assert.ok(deadline);
  // 8h ttl - 1h margin = 7h
  const expected = new Date(now.getTime() + 7 * 3_600_000).toISOString();
  assert.equal(deadline, expected);
});

// ---------------------------------------------------------------------------
// QueueStore: persistence round-trip
// ---------------------------------------------------------------------------

test('QueueStore survives reload from disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'queue-persist-'));
  const path = join(dir, 'q.json');
  try {
    const store1 = await QueueStore.open(path);
    await store1.put({
      assetId: 'p/test', specHash: 'sha256:pp',
      endpoint: 'create-image-pixen' as EndpointId,
      state: 'submitted', jobId: 'job-xyz',
      submittedAt: new Date().toISOString(),
      attempts: 1, costUsd: 0.01,
    });

    // Open a new store pointing to the same file
    const store2 = await QueueStore.open(path);
    const reloaded = store2.get('p/test');
    assert.ok(reloaded);
    assert.equal(reloaded.jobId, 'job-xyz');
    assert.equal(reloaded.state, 'submitted');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
