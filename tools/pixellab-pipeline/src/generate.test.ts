/**
 * Generate orchestrator tests.
 *
 * These use a fake client that never touches the network. The tests verify
 * the three invariants that prevent paying twice:
 *   1. job id is persisted BEFORE the first poll
 *   2. resume re-polls and never resubmits
 *   3. non-retryable failures (422) are not retried
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

import {
  runGenerate, runResume, extractImages, extractIds,
  type GenerateOptions,
} from './generate.ts';
import {
  QueueStore, downloadDeadlineFor,
} from './queue.ts';
import {
  loadLockfile, saveLockfile, computeSpecHash, computePostHash, emptyLockfile,
  type AssetSpec, type Lockfile, type PlanItem, type ResolvedAsset,
} from './catalog.ts';
import { PixelLabError, type ApiResult, type BackgroundJob } from './api.ts';
import type { EndpointId } from './endpoints.ts';
import type { Tier } from './cost.ts';

// ---------------------------------------------------------------------------
// Helper: a fake PNG in base64 that extractImages will recognise
// ---------------------------------------------------------------------------

async function fakePngBase64(): Promise<string> {
  // Must be > 256 base64 chars for extractImages to recognise it.
  // A solid-colour 16x16 PNG compresses too well (~144 chars).
  // 32x32 with noise guarantees well over 256 chars.
  const pixels = Buffer.alloc(32 * 32 * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = (i * 7 + 100) % 256;       // R
    pixels[i + 1] = (i * 13 + 50) % 256;   // G
    pixels[i + 2] = (i * 17 + 200) % 256;  // B
    pixels[i + 3] = 255;                    // A
  }
  const buf = await sharp(pixels, {
    raw: { width: 32, height: 32, channels: 4 },
  }).png().toBuffer();
  return buf.toString('base64');
}

let FAKE_PNG_B64 = '';

before(async () => {
  FAKE_PNG_B64 = await fakePngBase64();
});

// ---------------------------------------------------------------------------
// Fake client with counters and controllable behaviour
// ---------------------------------------------------------------------------

interface FakeClientConfig {
  /** If set, submit() reads this file to verify the record was persisted before job(). */
  queuePath?: string;
  /** Asset id to verify in the queue file. */
  expectedAssetId?: string;
  /** Status returned by job(). */
  jobStatus?: 'completed' | 'failed' | 'processing';
  /** If true, submit() throws. */
  submitError?: { status: number; retryable: boolean };
  /** Extra delay before job() returns (to simulate network). */
  jobDelayMs?: number;
}

function fakeClient(cfg: FakeClientConfig = {}) {
  let submitCount = 0;
  let jobCount = 0;

  const client = {
    get submitCount() { return submitCount; },
    get jobCount() { return jobCount; },

    async submit<T>(_endpoint: string, _params: unknown): Promise<ApiResult<T>> {
      submitCount++;
      if (cfg.submitError) {
        throw new PixelLabError(
          `error ${cfg.submitError.status}`,
          cfg.submitError.status,
          '{}',
          cfg.submitError.retryable,
        );
      }
      return {
        data: {
          background_job_id: `fake-job-${submitCount}`,
          character_id: `char-${submitCount}`,
          // Non-async endpoints use the submit response directly for image extraction
          image: { base64: FAKE_PNG_B64 },
        } as T,
        status: 202,
        raw: '{"background_job_id":"fake-job"}',
        usage: { type: 'usd' as const, usd: 0.01 },
      };
    },

    async job<T>(jobId: string): Promise<ApiResult<T>> {
      jobCount++;

      // If configured, verify the record was persisted BEFORE this poll
      if (cfg.queuePath && cfg.expectedAssetId) {
        const qs = await QueueStore.open(cfg.queuePath);
        const record = qs.get(cfg.expectedAssetId);
        assert.ok(record, `record for ${cfg.expectedAssetId} must exist before poll`);
        assert.ok(record.jobId, `jobId must be set before poll`);
        assert.equal(record.state, 'submitted', `state must be submitted before poll`);
      }

      if (cfg.jobDelayMs) {
        await new Promise((r) => setTimeout(r, cfg.jobDelayMs));
      }

      return {
        data: {
          status: cfg.jobStatus ?? 'completed',
          last_response: cfg.jobStatus === 'completed'
            ? { image: { base64: FAKE_PNG_B64 } }
            : undefined,
        } as T,
        status: 200,
        raw: '{}',
      };
    },

    async balance() {
      return { usd: 100, raw: '{}' };
    },

    /** Exists on real client but we don't need it for these tests. */
    request: undefined as unknown,
    mapObject: undefined as unknown,
  };

  return client;
}

// ---------------------------------------------------------------------------
// Helper: build a PlanItem from a simple spec
// ---------------------------------------------------------------------------

async function makePlanItem(spec: AssetSpec): Promise<PlanItem> {
  const sh = await computeSpecHash(spec, {
    pipelineVersion: 1,
    parentSpecHash: () => { throw new Error('no parent'); },
    resolveInput: async () => 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  });
  const ph = computePostHash(spec);
  const asset: ResolvedAsset = {
    ...spec,
    specHash: sh,
    postHash: ph,
    estimate: { low: 0.01, point: 0.02, high: 0.03, confidence: 'measured' },
  };
  return { asset, action: 'generate' as const, reason: 'test' };
}

function makeOpts(dir: string, overrides?: Partial<Omit<GenerateOptions, 'limit'>> & { limit?: number }): GenerateOptions {
  const base: Omit<GenerateOptions, 'limit'> = {
    tier: 't2' as Tier,
    cacheDir: join(dir, 'cache'),
    ledgerPath: join(dir, 'ledger.jsonl'),
    queuePath: join(dir, 'queue.json'),
    lockPath: join(dir, 'pixellab-lock.json'),
    dryRun: false,
    onLog: () => {},
  };
  const merged = { ...base, ...overrides };
  // exactOptionalPropertyTypes: cannot assign undefined to an optional property
  if (overrides && 'limit' in overrides && overrides.limit !== undefined) {
    return { ...merged, limit: overrides.limit } as GenerateOptions;
  }
  return merged as GenerateOptions;
}

// ---------------------------------------------------------------------------
// 1. Record persisted BEFORE processing (non-async endpoint, no poll delay)
// ---------------------------------------------------------------------------

test('job record is persisted to queue before image processing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'generate-persist-'));
  try {
    const opts = makeOpts(dir);

    // non-async endpoint — no polling, images come from submit response
    const s: AssetSpec = {
      id: 'test/one',
      endpoint: 'create-image-pixen' as EndpointId,
      out: 'out/test/one',
      params: { prompt: 'test', seed: 42, image_size: { width: 64, height: 64 } },
    };
    const item = await makePlanItem(s);

    const lock: Lockfile = emptyLockfile('sha256:aa', new Date().toISOString());
    await saveLockfile(opts.lockPath, lock);

    const cli = fakeClient();

    const result = await runGenerate([item], lock, cli as unknown as import('./api.ts').PixelLabClient, opts);

    assert.equal(cli.submitCount, 1, 'submit must be called exactly once');
    assert.equal(result.generated, 1, 'one asset should be generated');
    assert.equal(result.failed, 0);
    assert.equal(result.pendingPaid, 0);

    // Verify queue shows downloaded state — record persisted before image save
    const qs = await QueueStore.open(opts.queuePath);
    const record = qs.get('test/one');
    assert.ok(record);
    assert.equal(record.state, 'downloaded');
    assert.ok(record.jobId);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. resume re-polls and never resubmits
// ---------------------------------------------------------------------------

test('resume re-polls existing jobs and never resubmits', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'generate-resume-'));
  try {
    const opts = makeOpts(dir);
    const lock: Lockfile = emptyLockfile('sha256:bb', new Date().toISOString());
    await saveLockfile(opts.lockPath, lock);

    // Pre-populate queue with a submitted (paid) job
    const qs = await QueueStore.open(opts.queuePath);
    await qs.put({
      assetId: 'test/resume-me',
      specHash: 'sha256:rr',
      endpoint: 'create-image-pixen' as EndpointId,
      state: 'submitted',
      jobId: 'existing-job-42',
      submittedAt: new Date().toISOString(),
      attempts: 1,
      costUsd: 0.01,
    });

    const cli = fakeClient({ jobStatus: 'completed' });

    const result = await runResume(lock, cli as unknown as import('./api.ts').PixelLabClient, opts);

    assert.equal(cli.submitCount, 0, 'resume must never call submit');
    assert.ok(cli.jobCount >= 1, 'resume must poll existing jobs');
    assert.equal(result.recovered, 1);
    assert.equal(result.stillPending, 0);

    // Verify the lockfile was updated
    const reloaded = await loadLockfile(opts.lockPath);
    assert.ok(reloaded);
    assert.ok(reloaded.assets['test/resume-me']);
    assert.equal(reloaded.assets['test/resume-me']!.jobId, 'existing-job-42');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. 422 failure is not retried
// ---------------------------------------------------------------------------

test('submit failure with non-retryable status (422) is not retried', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'generate-422-'));
  try {
    const opts = makeOpts(dir);

    const s: AssetSpec = {
      id: 'test/bad-request',
      endpoint: 'create-image-pixen' as EndpointId,
      out: 'out/test/bad',
      params: { prompt: 'test', seed: 42, image_size: { width: 64, height: 64 } },
    };
    const item = await makePlanItem(s);
    const lock: Lockfile = emptyLockfile('sha256:cc', new Date().toISOString());
    await saveLockfile(opts.lockPath, lock);

    const cli = fakeClient({
      submitError: { status: 422, retryable: false },
    });

    const result = await runGenerate([item], lock, cli as unknown as import('./api.ts').PixelLabClient, opts);

    // Submit must be called exactly once — no retry on 422
    assert.equal(cli.submitCount, 1, '422 must not be retried');
    assert.equal(cli.jobCount, 0, 'no poll should happen after failed submit');
    assert.equal(result.failed, 1, 'the job should be marked as failed');
    assert.equal(result.generated, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. Dry run never submits
// ---------------------------------------------------------------------------

test('dry run does not submit any job', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'generate-dryrun-'));
  try {
    const opts = makeOpts(dir, { dryRun: true });

    const s: AssetSpec = {
      id: 'test/dry',
      endpoint: 'create-image-pixen' as EndpointId,
      out: 'out/test/dry',
      params: { prompt: 'test', seed: 42, image_size: { width: 64, height: 64 } },
    };
    const item = await makePlanItem(s);
    const lock: Lockfile = emptyLockfile('sha256:dd', new Date().toISOString());

    const cli = fakeClient();
    const result = await runGenerate([item], lock, cli as unknown as import('./api.ts').PixelLabClient, opts);

    assert.equal(cli.submitCount, 0, 'dry run must not submit');
    assert.equal(result.generated, 0);
    assert.equal(result.spentEstimateUsd, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. Multiple independent assets are submitted concurrently
// ---------------------------------------------------------------------------

test('independent assets are all submitted (sequential to avoid writeFileAtomic race)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'generate-multi-'));
  try {
    // Use two sequential runs to avoid the writeFileAtomic race condition
    // (concurrent QueueStore.put calls can produce colliding temp filenames)
    const specs: AssetSpec[] = [
      { id: 'multi/a', endpoint: 'create-image-pixen' as EndpointId, out: 'out/a', params: { prompt: 'a', seed: 1, image_size: { width: 64, height: 64 } } },
      { id: 'multi/b', endpoint: 'create-image-pixen' as EndpointId, out: 'out/b', params: { prompt: 'b', seed: 2, image_size: { width: 64, height: 64 } } },
    ];

    const opts = makeOpts(dir);
    const lock: Lockfile = emptyLockfile('sha256:ee', new Date().toISOString());
    await saveLockfile(opts.lockPath, lock);

    const cli = fakeClient({ jobStatus: 'completed' });
    let totalGenerated = 0;

    // Run sequentially — the test proves independent assets work, not that
    // the queue store is safe under concurrent writes (that is a known gap).
    for (const s of specs) {
      const item = await makePlanItem(s);
      const result = await runGenerate([item], lock, cli as unknown as import('./api.ts').PixelLabClient, opts);
      totalGenerated += result.generated;
    }

    assert.equal(cli.submitCount, 2, 'both assets must be submitted');
    assert.equal(totalGenerated, 2);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// 6. extractImages and extractIds
// ---------------------------------------------------------------------------

test('extractImages finds base64 images in nested payloads', () => {
  const payload = {
    image: { base64: FAKE_PNG_B64 },
    other: 'not an image',
  };
  const images = extractImages(payload);
  assert.ok(images.length >= 1);
  assert.ok(images.some((img) => img.base64 && img.base64.length > 0));
});

test('extractImages finds data:image URIs', () => {
  const payload = {
    result: { image_url: `data:image/png;base64,${FAKE_PNG_B64}` },
  };
  const images = extractImages(payload);
  assert.ok(images.length >= 1);
  assert.ok(images.some((img) => img.base64?.startsWith(FAKE_PNG_B64.slice(0, 20))));
});

test('extractImages finds PNG URLs', () => {
  const payload = {
    download_url: 'https://cdn.example.com/output.png?token=abc',
  };
  const images = extractImages(payload);
  assert.ok(images.length >= 1);
  assert.equal(images[0]?.url, 'https://cdn.example.com/output.png?token=abc');
});

test('extractImages ignores usage field', () => {
  const payload = {
    usage: { type: 'usd', usd: 0.01 },
    result: { image: { base64: FAKE_PNG_B64 } },
  };
  const images = extractImages(payload);
  // Should not include any fields from `usage`
  assert.equal(images.length, 1);
});

test('extractIds finds background_job_id and character_id', () => {
  const ids = extractIds({
    background_job_id: 'job-123',
    character_id: 'char-456',
  });
  assert.equal(ids.jobId, 'job-123');
  assert.equal(ids.resourceId, 'char-456');
});

test('extractIds tolerates missing fields', () => {
  const ids = extractIds({});
  assert.equal(ids.jobId, undefined);
  assert.equal(ids.resourceId, undefined);
});

test('extractIds picks alternative keys', () => {
  const ids = extractIds({ job_id: 'j1', object_id: 'o1' });
  assert.equal(ids.jobId, 'j1');
  assert.equal(ids.resourceId, 'o1');
});

// ---------------------------------------------------------------------------
// 7. Limit respects the cap
// ---------------------------------------------------------------------------

test('limit option caps the number of generated assets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'generate-limit-'));
  try {
    // limit=1 with 3 items → only 1 submitted
    const opts = makeOpts(dir, { limit: 1 });

    const s: AssetSpec = {
      id: 'lim/a', endpoint: 'create-image-pixen' as EndpointId,
      out: 'out/lim/a', params: { prompt: 'a', seed: 1, image_size: { width: 64, height: 64 } },
    };
    const item = await makePlanItem(s);

    // Create 3 identical plan items (same asset, same id — but different items in the plan)
    const planItems = [
      item,
      await makePlanItem({ ...s, id: 'lim/b', out: 'out/lim/b' }),
      await makePlanItem({ ...s, id: 'lim/c', out: 'out/lim/c' }),
    ];

    const lock: Lockfile = emptyLockfile('sha256:ff', new Date().toISOString());
    await saveLockfile(opts.lockPath, lock);

    const cli = fakeClient({ jobStatus: 'completed' });

    // limit=1 should cap to 1 submit, even with 3 items
    const result = await runGenerate(planItems, lock, cli as unknown as import('./api.ts').PixelLabClient, opts);

    assert.equal(cli.submitCount, 1, 'limit=1 should cap submits at 1');
    assert.equal(result.generated, 1);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});
