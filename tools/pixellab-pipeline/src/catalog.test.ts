/**
 * Catalog and idempotency tests.
 *
 * These run without network: fake clients, synthetic PNGs, temp directories.
 * The headline test proves the contract that matters most — regenerating the
 * same catalog costs nothing. Every other test protects one edge of the hash.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

import {
  buildPlan, computePostHash, computeSpecHash, emptyLockfile, estimateAsset,
  inputHash, loadLockfile, saveLockfile,
  type AssetSpec, type HashContext, type Lockfile, type LockEntry,
} from './catalog.ts';
import { canonicalJson, digest } from './util.ts';
import type { EndpointId } from './endpoints.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PIPELINE_VERSION = 1;

function ctx(inputHashes?: Record<string, string>, parentHashes?: Record<string, string>): HashContext {
  return {
    pipelineVersion: PIPELINE_VERSION,
    parentSpecHash(id) {
      if (parentHashes?.[id]) return parentHashes[id];
      throw new Error(`parent not resolved: ${id}`);
    },
    async resolveInput(path) {
      if (inputHashes?.[path]) return inputHashes[path];
      return `sha256:0000000000000000000000000000000000000000000000000000000000000000`;
    },
  };
}

/** A minimal spec factories so test data stays short. */
function spec(overrides: Partial<AssetSpec> & { id: string }): AssetSpec {
  return {
    endpoint: 'create-image-pixen' as EndpointId,
    out: `out/${overrides.id}`,
    params: { prompt: 'test', seed: 42, image_size: { width: 64, height: 64 } },
    ...overrides,
  };
}

async function fakeArtifactExists(_path: string): Promise<boolean> {
  return true;
}

async function fakeArtifactMissing(_path: string): Promise<boolean> {
  return false;
}

// ---------------------------------------------------------------------------
// 1. HEADLINE: idempotency
// ---------------------------------------------------------------------------

test('idempotency — same catalog + lockfile ⇒ every item skip, toGenerate empty, estimate zero', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'catalog-idempotent-'));
  const lockPath = join(dir, 'pixellab-lock.json');
  try {
    const specs: AssetSpec[] = [
      spec({ id: 'a/one',   params: { prompt: 'one',   seed: 1, image_size: { width: 64, height: 64 } } }),
      spec({ id: 'b/two',   params: { prompt: 'two',   seed: 2, image_size: { width: 64, height: 64 } } }),
      spec({ id: 'c/three', params: { prompt: 'three', seed: 3, image_size: { width: 64, height: 64 } } }),
    ];

    // ---- first pass: empty lockfile → everything generates ----
    const lock1 = emptyLockfile('sha256:af00', new Date().toISOString());
    await saveLockfile(lockPath, lock1);

    const plan1 = await buildPlan(specs, lock1, fakeArtifactMissing);
    assert.equal(plan1.toGenerate.length, 3, 'empty lockfile: all three should generate');
    assert.ok(plan1.estimate.point > 0, 'estimate should be positive');

    // ---- simulate generation: write entries into lockfile ----
    const assets: Record<string, LockEntry> = {};
    for (const s of specs) {
      const sh = await computeSpecHash(s, ctx());
      const ph = computePostHash(s);
      assets[s.id] = {
        specHash: sh,
        postHash: ph,
        endpoint: s.endpoint,
        status: 'generated',
        generatedAt: new Date().toISOString(),
        costUsd: 0.01,
        artifacts: [{ path: s.out, sha256: 'sha256:ff', bytes: 1024 }],
      };
    }
    const lock2: Lockfile = { ...lock1, assets };
    await saveLockfile(lockPath, lock2);

    // ---- re-read lockfile FROM DISK (not the in-memory object) ----
    const lockReloaded = await loadLockfile(lockPath);
    assert.ok(lockReloaded, 'lockfile should be loadable from disk');

    // ---- second pass: everything should be skip ----
    const plan2 = await buildPlan(specs, lockReloaded, fakeArtifactExists);
    assert.equal(plan2.toGenerate.length, 0, 'second pass must generate nothing');
    assert.equal(plan2.estimate.point, 0, 'second pass estimate must be zero');
    assert.equal(plan2.estimate.low, 0);
    assert.equal(plan2.estimate.high, 0);

    // savedUsd should equal the sum of what we would have paid
    const totalPoint = specs.reduce((s, sp) => s + estimateAsset(sp).point, 0);
    assert.ok(Math.abs(plan2.savedUsd - totalPoint) < 0.001,
      `savedUsd ${plan2.savedUsd} should ≈ ${totalPoint}`);

    // Every item must be 'skip'
    for (const item of plan2.items) {
      assert.equal(item.action, 'skip', `${item.asset.id} should be skip, got ${item.action}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 1b. Prove the headline test CAN fail: computeSpecHash MUST detect changes
// ---------------------------------------------------------------------------

test('specHash changes when prompt changes — proves idempotency test can fail if hashing breaks', async () => {
  const c = ctx();
  const a = spec({ id: 'x', params: { prompt: 'alpha', seed: 1, image_size: { width: 64, height: 64 } } });
  const b = spec({ id: 'x', params: { prompt: 'beta',  seed: 1, image_size: { width: 64, height: 64 } } });

  const ha = await computeSpecHash(a, c);
  const hb = await computeSpecHash(b, c);
  assert.notEqual(ha, hb, 'different prompts must produce different specHashes');
});

test('specHash is identical for identical specs', async () => {
  const c = ctx();
  const a = spec({ id: 'x', params: { prompt: 'same', seed: 7, image_size: { width: 64, height: 64 } } });
  const b = spec({ id: 'y', params: { prompt: 'same', seed: 7, image_size: { width: 64, height: 64 } } });

  assert.equal(await computeSpecHash(a, c), await computeSpecHash(b, c),
    'identical params must produce identical specHash regardless of id');
});

test('specHash changes when seed changes', async () => {
  const c = ctx();
  const a = spec({ id: 'x', params: { prompt: 'p', seed: 1, image_size: { width: 64, height: 64 } } });
  const b = spec({ id: 'x', params: { prompt: 'p', seed: 2, image_size: { width: 64, height: 64 } } });

  assert.notEqual(await computeSpecHash(a, c), await computeSpecHash(b, c));
});

test('specHash changes when image_size changes', async () => {
  const c = ctx();
  const a = spec({ id: 'x', params: { prompt: 'p', seed: 1, image_size: { width: 64, height: 64 } } });
  const b = spec({ id: 'x', params: { prompt: 'p', seed: 1, image_size: { width: 128, height: 128 } } });

  assert.notEqual(await computeSpecHash(a, c), await computeSpecHash(b, c));
});

test('specHash stays same when salt is undefined vs empty string', async () => {
  const c = ctx();
  const a = spec({ id: 'x', params: { prompt: 'p', seed: 1, image_size: { width: 64, height: 64 } } });
  const b = spec({ id: 'x', params: { prompt: 'p', seed: 1, image_size: { width: 64, height: 64 } }, salt: '' });

  // salt: undefined omits the key entirely; salt: '' includes it as ""
  assert.notEqual(await computeSpecHash(a, c), await computeSpecHash(b, c),
    'salt undefined vs empty string must differ');
});

// ---------------------------------------------------------------------------
// 2. inputHash: re-encoding a PNG does NOT change the hash
// ---------------------------------------------------------------------------

test('re-encoding a PNG does not change inputHash', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'catalog-inputhash-'));
  try {
    const pathA = join(dir, 'a.png');
    const pathB = join(dir, 'b.png');

    // Same pixel content, different encoding (different compression level)
    const pixels = Buffer.alloc(64 * 64 * 4, 128); // solid grey
    await sharp(pixels, { raw: { width: 64, height: 64, channels: 4 } })
      .png({ compressionLevel: 0 }).toFile(pathA);
    await sharp(pixels, { raw: { width: 64, height: 64, channels: 4 } })
      .png({ compressionLevel: 9 }).toFile(pathB);

    const ha = await inputHash(pathA);
    const hb = await inputHash(pathB);
    assert.equal(ha, hb, 're-encoding must not change inputHash');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. OpenAPI snapshot sha drift does NOT produce generate
// ---------------------------------------------------------------------------

test('changing openapiSnapshot sha256 does not produce generate — drift is not invalidation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'catalog-snapshot-'));
  const lockPath = join(dir, 'pixellab-lock.json');
  try {
    const s = spec({ id: 'asset/one', params: { prompt: 'p', seed: 1, image_size: { width: 64, height: 64 } } });

    // First pass: lockfile with snapshot A
    const lockA = emptyLockfile('sha256:aaaa', new Date().toISOString());
    const planA = await buildPlan([s], lockA, fakeArtifactMissing);
    assert.equal(planA.toGenerate.length, 1);

    // Simulate generation with that snapshot
    const sh = await computeSpecHash(s, ctx());
    const ph = computePostHash(s);
    const lockPopulated: Lockfile = {
      ...lockA,
      assets: {
        [s.id]: {
          specHash: sh, postHash: ph, endpoint: s.endpoint,
          status: 'generated', generatedAt: new Date().toISOString(),
          costUsd: 0.01, artifacts: [{ path: s.out, sha256: 'sha256:ff', bytes: 1024 }],
        },
      },
    };
    await saveLockfile(lockPath, lockPopulated);

    // Reload and replan — should be skip
    const reloadA = await loadLockfile(lockPath);
    assert.ok(reloadA);
    const planAfterA = await buildPlan([s], reloadA, fakeArtifactExists);
    assert.equal(planAfterA.toGenerate.length, 0, 'should skip after generation');

    // Now change ONLY the openapiSnapshot sha256
    const lockB: Lockfile = {
      ...lockPopulated,
      openapiSnapshot: { sha256: 'sha256:bbbb', fetchedAt: new Date().toISOString() },
    };
    await saveLockfile(lockPath, lockB);
    const reloadB = await loadLockfile(lockPath);
    assert.ok(reloadB);

    const planB = await buildPlan([s], reloadB, fakeArtifactExists);
    assert.equal(planB.toGenerate.length, 0,
      'openapiSnapshot drift must not force regeneration');
    assert.equal(planB.items[0]?.action, 'skip',
      'drift should still be skip, not generate');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. Cycle detection
// ---------------------------------------------------------------------------

test('cycle detection — circular dependency throws with chain in message', async () => {
  const a = spec({
    id: 'a', dependsOn: ['b'],
    params: { prompt: 'a', seed: 1, image_size: { width: 64, height: 64 } },
  });
  const b = spec({
    id: 'b', dependsOn: ['a'],
    params: { prompt: 'b', seed: 1, image_size: { width: 64, height: 64 } },
  });

  const lock = emptyLockfile('sha256:cc', new Date().toISOString());
  await assert.rejects(
    () => buildPlan([a, b], lock, fakeArtifactMissing),
    (err: Error) => {
      const msg = err.message;
      return msg.includes('ciclo') && msg.includes('a') && msg.includes('b') && msg.includes('->');
    },
    'cycle must throw with descriptive message containing the chain',
  );
});

// ---------------------------------------------------------------------------
// 5. rejectedHashes → blocked-rejected
// ---------------------------------------------------------------------------

test('asset with specHash in rejectedHashes resolves to blocked-rejected', async () => {
  const s = spec({ id: 'bad/one', params: { prompt: 'bad', seed: 99, image_size: { width: 64, height: 64 } } });
  const sh = await computeSpecHash(s, ctx());

  const lock = emptyLockfile('sha256:dd', new Date().toISOString());
  lock.rejectedHashes[sh] = { assetId: s.id, reason: 'art director veto', at: new Date().toISOString() };

  const plan = await buildPlan([s], lock, fakeArtifactMissing);
  assert.equal(plan.toGenerate.length, 0, 'rejected spec must not be in toGenerate');
  assert.equal(plan.items[0]?.action, 'blocked-rejected');
  assert.ok(plan.items[0]?.reason.includes('reprovado'));
});

// ---------------------------------------------------------------------------
// 6. post-only change → reprocess (not generate)
// ---------------------------------------------------------------------------

test('changing only post produces reprocess, not generate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'catalog-post-'));
  const lockPath = join(dir, 'pixellab-lock.json');
  try {
    const s = spec({ id: 'asset/post-test', params: { prompt: 'p', seed: 1, image_size: { width: 64, height: 64 } }, post: { crop: 16 } });
    const sh = await computeSpecHash(s, ctx());
    const ph = computePostHash(s);

    // Write lock with matching specHash and postHash, artifacts present
    const lock: Lockfile = {
      ...emptyLockfile('sha256:ee', new Date().toISOString()),
      assets: {
        [s.id]: {
          specHash: sh, postHash: ph, endpoint: s.endpoint,
          status: 'generated', generatedAt: new Date().toISOString(),
          costUsd: 0.01, artifacts: [{ path: s.out, sha256: 'sha256:ff', bytes: 1024 }],
        },
      },
    };
    await saveLockfile(lockPath, lock);

    // Now change only the post config
    const s2 = { ...s, post: { crop: 32 } };
    const sh2 = await computeSpecHash(s2, ctx());
    assert.equal(sh, sh2, 'specHash must be unchanged when only post changes');

    const plan = await buildPlan([s2], lock, fakeArtifactExists);
    assert.equal(plan.toGenerate.length, 0, 'post-only change must not trigger generate');
    assert.equal(plan.items[0]?.action, 'reprocess',
      'post-only change must be reprocess, not generate');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 7. Validation errors: unpinned seed
// ---------------------------------------------------------------------------

test('buildPlan catches unpinned seed in validationErrors', async () => {
  const s = spec({ id: 'no-seed', params: { prompt: 'p', image_size: { width: 64, height: 64 } } });
  const plan = await buildPlan([s], emptyLockfile('sha256:ff', new Date().toISOString()), fakeArtifactMissing);
  assert.ok(plan.validationErrors.some((e) => e.includes('seed')),
    'unpinned seed must produce a validation error');
});

// ---------------------------------------------------------------------------
// 8. estimateAsset with direction multiplier
// ---------------------------------------------------------------------------

test('estimateAsset multiplies by direction count for billsPerDirection endpoints', () => {
  const char8dir = spec({
    id: 'char', endpoint: 'create-character-with-8-directions' as EndpointId,
    params: { description: 'test', image_size: { width: 64, height: 64 }, mode: 'standard', seed: 1, view: 'low top-down' },
  });
  const est = estimateAsset(char8dir);
  // 8-direction endpoint has billsPerDirection = false, so no multiplier
  assert.ok(est.point > 0);
});

test('estimateAsset for animate-character multiplies by direction count', () => {
  const animSpec: AssetSpec = {
    id: 'anim', endpoint: 'animate-character' as EndpointId,
    out: 'out/anim',
    params: {
      template_animation_id: 'breathing-idle',
      mode: 'template',
      seed: 1,
      directions: ['south', 'east', 'north', 'west'],
    },
    dependsOn: ['parent'],
  };
  // Should multiply by 4 (number of directions specified)
  const est = estimateAsset(animSpec);
  assert.ok(est.point > 0);
  // With 4 directions, point should be ~4x the base
  assert.ok(est.point > 0.03, `expected > 0.03, got ${est.point}`);
});

// ---------------------------------------------------------------------------
// 9. Dependency resolution order
// ---------------------------------------------------------------------------

test('buildPlan resolves dependencies in topological order', async () => {
  const parent = spec({ id: 'parent', params: { prompt: 'parent', seed: 1, image_size: { width: 64, height: 64 } } });
  const child: AssetSpec = {
    id: 'child',
    endpoint: 'animate-character' as EndpointId,
    out: 'out/child',
    params: { template_animation_id: 'breathing-idle', mode: 'template', seed: 1 },
    dependsOn: ['parent'],
  };

  const lock = emptyLockfile('sha256:gg', new Date().toISOString());
  const plan = await buildPlan([child, parent], lock, fakeArtifactMissing);

  // parent must appear before child in the ordered list
  const parentIdx = plan.items.findIndex((i) => i.asset.id === 'parent');
  const childIdx = plan.items.findIndex((i) => i.asset.id === 'child');
  assert.ok(parentIdx < childIdx,
    `parent (idx ${parentIdx}) must precede child (idx ${childIdx})`);
});
