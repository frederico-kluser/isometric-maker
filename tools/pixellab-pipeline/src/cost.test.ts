/**
 * Cost model and budget guard tests.
 *
 * The guard INFORMS and NEVER REFUSES. Every test verifies a property of the
 * estimate, the interpolation, or the warning behaviour. No network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  estimateByArea, sumEstimates, checkBudget,
  COST_TABLE, DEFAULT_THRESHOLDS,
  type CostRule, type CostEstimate, type Confidence, type Aviso,
} from './cost.ts';
import type { EndpointId } from './endpoints.ts';

// ---------------------------------------------------------------------------
// estimateByArea
// ---------------------------------------------------------------------------

test('estimateByArea — measured confidence at exact point', () => {
  const rule: CostRule = {
    points: [
      { area: 32 * 32, usd: 0.010 },
      { area: 64 * 64, usd: 0.020 },
    ],
    async: false, concurrencyWeight: 1, remoteCacheable: false, latencySec: [5, 10],
  };
  const est = estimateByArea(rule, 32 * 32);
  assert.equal(est.confidence, 'measured');
  assert.equal(est.point, 0.010);
  assert.equal(est.low, 0.010 * 0.85);
  assert.equal(est.high, 0.010 * 1.3);
});

test('estimateByArea — interpolated confidence between measured points', () => {
  const rule: CostRule = {
    points: [
      { area: 32 * 32, usd: 0.010 },
      { area: 64 * 64, usd: 0.020 },
    ],
    async: false, concurrencyWeight: 1, remoteCacheable: false, latencySec: [5, 10],
  };
  // Halfway between 1024 and 4096 in area terms
  const midArea = 48 * 48; // 2304
  const est = estimateByArea(rule, midArea);
  assert.equal(est.confidence, 'interpolated');
  assert.ok(est.point > 0.010 && est.point < 0.020,
    `interpolated point ${est.point} should be between 0.01 and 0.02`);
});

test('estimateByArea — extrapolated confidence below smallest point', () => {
  const rule: CostRule = {
    points: [
      { area: 64 * 64, usd: 0.020 },
      { area: 128 * 128, usd: 0.030 },
    ],
    async: false, concurrencyWeight: 1, remoteCacheable: false, latencySec: [5, 10],
  };
  const est = estimateByArea(rule, 16 * 16); // way below
  assert.equal(est.confidence, 'extrapolated');
  assert.equal(est.point, 0.020); // clamped to first point
});

test('estimateByArea — extrapolated confidence above largest point', () => {
  const rule: CostRule = {
    points: [
      { area: 32 * 32, usd: 0.010 },
      { area: 64 * 64, usd: 0.020 },
    ],
    async: false, concurrencyWeight: 1, remoteCacheable: false, latencySec: [5, 10],
  };
  const est = estimateByArea(rule, 256 * 256); // way above
  assert.equal(est.confidence, 'extrapolated');
  assert.equal(est.point, 0.020); // clamped to last point
});

test('estimateByArea — measured at upper boundary exact point', () => {
  const rule: CostRule = {
    points: [
      { area: 32 * 32, usd: 0.010 },
      { area: 64 * 64, usd: 0.020 },
    ],
    async: false, concurrencyWeight: 1, remoteCacheable: false, latencySec: [5, 10],
  };
  const est = estimateByArea(rule, 64 * 64);
  assert.equal(est.confidence, 'measured');
  assert.equal(est.point, 0.020);
});

// ---------------------------------------------------------------------------
// sumEstimates
// ---------------------------------------------------------------------------

test('sumEstimates — empty list returns measured zero', () => {
  const sum = sumEstimates([]);
  assert.equal(sum.point, 0);
  assert.equal(sum.low, 0);
  assert.equal(sum.high, 0);
  assert.equal(sum.confidence, 'measured');
});

test('sumEstimates — sums point/low/high correctly', () => {
  const a: CostEstimate = { low: 1, point: 2, high: 3, confidence: 'measured' };
  const b: CostEstimate = { low: 4, point: 5, high: 6, confidence: 'measured' };
  const sum = sumEstimates([a, b]);
  assert.equal(sum.low, 5);
  assert.equal(sum.point, 7);
  assert.equal(sum.high, 9);
});

test('sumEstimates — propagates worst confidence', () => {
  const measured: CostEstimate   = { low: 1, point: 1, high: 1, confidence: 'measured' };
  const interpolated: CostEstimate = { low: 1, point: 1, high: 1, confidence: 'interpolated' };
  const extrapolated: CostEstimate = { low: 1, point: 1, high: 1, confidence: 'extrapolated' };

  assert.equal(sumEstimates([measured, measured]).confidence, 'measured');
  assert.equal(sumEstimates([measured, interpolated]).confidence, 'interpolated');
  assert.equal(sumEstimates([measured, extrapolated]).confidence, 'extrapolated');
  assert.equal(sumEstimates([interpolated, extrapolated]).confidence, 'extrapolated');
});

// ---------------------------------------------------------------------------
// checkBudget — avisos for each threshold
// ---------------------------------------------------------------------------

test('checkBudget — no avisos when everything under threshold', () => {
  const report = checkBudget({
    estimate: { low: 0.01, point: 0.02, high: 0.03, confidence: 'measured' },
    maxSingleAssetUsd: 0.02,
    spentThisMonthUsd: 0,
    spentThisSessionUsd: 0,
    balanceUsd: 100,
  });
  // Even with no warnings, confirmation is still required
  assert.equal(report.requiresConfirmation, true);
  assert.equal(report.avisos.length, 0);
  assert.equal(report.estimate.point, 0.02);
});

test('checkBudget — produces asset-cap aviso when single asset exceeds threshold', () => {
  const report = checkBudget({
    estimate: { low: 0.01, point: 0.02, high: 0.03, confidence: 'measured' },
    maxSingleAssetUsd: 0.5, // above DEFAULT_THRESHOLDS.maxAssetUsd = 0.30
    spentThisMonthUsd: 0,
    spentThisSessionUsd: 0,
    balanceUsd: 100,
  });
  assert.equal(report.requiresConfirmation, true);
  assert.ok(report.avisos.some((a) => a.code === 'asset-cap'),
    'must produce asset-cap warning');
  const aviso = report.avisos.find((a) => a.code === 'asset-cap')!;
  assert.equal(aviso.measured, 0.5);
  assert.equal(aviso.threshold, DEFAULT_THRESHOLDS.maxAssetUsd);
  assert.ok(aviso.text.includes('mode'));
});

test('checkBudget — produces run-cap aviso when high estimate exceeds run threshold', () => {
  const report = checkBudget({
    estimate: { low: 0, point: 8, high: 16, confidence: 'measured' },
    maxSingleAssetUsd: 0.05,
    spentThisMonthUsd: 0,
    spentThisSessionUsd: 0,
    balanceUsd: 100,
  });
  // high=16 > DEFAULT_THRESHOLDS.maxRunUsd=15
  assert.ok(report.avisos.some((a) => a.code === 'run-cap'),
    'must produce run-cap warning');
  const aviso = report.avisos.find((a) => a.code === 'run-cap')!;
  assert.equal(aviso.measured, 16);
  assert.equal(aviso.threshold, DEFAULT_THRESHOLDS.maxRunUsd);
});

test('checkBudget — produces monthly-cap aviso when month + estimate exceeds cap', () => {
  const report = checkBudget({
    estimate: { low: 0, point: 20, high: 25, confidence: 'measured' },
    maxSingleAssetUsd: 0.05,
    spentThisMonthUsd: 50, // 50 + 20 > 60
    spentThisSessionUsd: 0,
    balanceUsd: 100,
  });
  assert.ok(report.avisos.some((a) => a.code === 'monthly-cap'),
    'must produce monthly-cap warning');
  const aviso = report.avisos.find((a) => a.code === 'monthly-cap')!;
  assert.equal(aviso.measured, 70);
  assert.equal(aviso.threshold, DEFAULT_THRESHOLDS.hardCapMonthlyUsd);
});

test('checkBudget — produces balance aviso when estimate > 90% of balance', () => {
  const report = checkBudget({
    estimate: { low: 0, point: 9.5, high: 12, confidence: 'measured' },
    maxSingleAssetUsd: 0.05,
    spentThisMonthUsd: 0,
    spentThisSessionUsd: 0,
    balanceUsd: 10, // 9.5 > 9 (90% of 10)
  });
  assert.ok(report.avisos.some((a) => a.code === 'balance'),
    'must produce balance warning');
  const aviso = report.avisos.find((a) => a.code === 'balance')!;
  assert.equal(aviso.threshold, 9); // 10 * 0.9
});

test('checkBudget — no balance aviso when balance is undefined', () => {
  const report = checkBudget({
    estimate: { low: 0, point: 50, high: 100, confidence: 'measured' },
    maxSingleAssetUsd: 0.05,
    spentThisMonthUsd: 0,
    spentThisSessionUsd: 0,
    balanceUsd: undefined,
  });
  assert.ok(!report.avisos.some((a) => a.code === 'balance'),
    'balance aviso must not fire when balance is undefined');
});

test('checkBudget — requiresConfirmation is always true', () => {
  // The guard informs; the human decides. Even with zero estimate.
  const report = checkBudget({
    estimate: { low: 0, point: 0, high: 0, confidence: 'measured' },
    maxSingleAssetUsd: 0,
    spentThisMonthUsd: 0,
    spentThisSessionUsd: 0,
    balanceUsd: 100,
  });
  assert.equal(report.requiresConfirmation, true,
    'requiresConfirmation must be true even for zero-cost generation');
});

test('checkBudget — sessionSpentUsd appears in report', () => {
  const report = checkBudget({
    estimate: { low: 0, point: 1, high: 2, confidence: 'measured' },
    maxSingleAssetUsd: 0.1,
    spentThisMonthUsd: 10,
    spentThisSessionUsd: 3,
    balanceUsd: 100,
  });
  assert.equal(report.sessionSpentUsd, 3);
  assert.equal(report.monthSpentUsd, 10);
  assert.equal(report.balanceUsd, 100);
});

test('checkBudget — multiple simultaneous avisos', () => {
  const report = checkBudget({
    estimate: { low: 0, point: 30, high: 50, confidence: 'extrapolated' },
    maxSingleAssetUsd: 0.5,
    spentThisMonthUsd: 50,
    spentThisSessionUsd: 5,
    balanceUsd: 30,
  });
  // Should trigger asset-cap (0.5 > 0.3), run-cap (50 > 15), monthly-cap (80 > 60), balance (30 > 27)
  const codes = report.avisos.map((a) => a.code);
  assert.ok(codes.includes('asset-cap'));
  assert.ok(codes.includes('run-cap'));
  assert.ok(codes.includes('monthly-cap'));
  assert.ok(codes.includes('balance'));
  assert.ok(report.avisos.length >= 4);
});

test('checkBudget — custom thresholds', () => {
  const custom = { maxRunUsd: 5, maxAssetUsd: 0.1, promptAboveUsd: 1, hardCapMonthlyUsd: 20 };
  const report = checkBudget({
    estimate: { low: 0, point: 3, high: 6, confidence: 'measured' },
    maxSingleAssetUsd: 0.15,
    spentThisMonthUsd: 0,
    spentThisSessionUsd: 0,
    balanceUsd: 100,
  }, custom);
  assert.ok(report.avisos.some((a) => a.code === 'asset-cap'));
  assert.ok(report.avisos.some((a) => a.code === 'run-cap'));
});

// ---------------------------------------------------------------------------
// COST_TABLE structure
// ---------------------------------------------------------------------------

test('COST_TABLE has at least one entry for each modelled endpoint', () => {
  // Spot-check: the endpoints used by the demo catalog must be priced
  assert.ok(COST_TABLE['create-character-with-8-directions']);
  assert.ok(COST_TABLE['animate-character']);
  assert.ok(COST_TABLE['create-tileset']);
  assert.ok(COST_TABLE['map-objects']);
});

test('COST_TABLE entries have required fields', () => {
  for (const [id, rule] of Object.entries(COST_TABLE)) {
    assert.ok(Array.isArray(rule.points) && rule.points.length > 0,
      `${id}: must have points`);
    assert.ok(typeof rule.concurrencyWeight === 'number' && rule.concurrencyWeight > 0,
      `${id}: must have positive concurrencyWeight`);
    assert.ok(Array.isArray(rule.latencySec) && rule.latencySec.length === 2,
      `${id}: latencySec must be [p50, p95]`);
  }
});

// ---------------------------------------------------------------------------
// DEFAULT_THRESHOLDS
// ---------------------------------------------------------------------------

test('DEFAULT_THRESHOLDS has the four documented values', () => {
  assert.equal(DEFAULT_THRESHOLDS.maxAssetUsd, 0.30);
  assert.equal(DEFAULT_THRESHOLDS.maxRunUsd, 15);
  assert.equal(DEFAULT_THRESHOLDS.promptAboveUsd, 5);
  assert.equal(DEFAULT_THRESHOLDS.hardCapMonthlyUsd, 60);
});
