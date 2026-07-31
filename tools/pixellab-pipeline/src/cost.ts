/**
 * Cost model and budget guard.
 *
 * Every number here was read from https://www.pixellab.ai/pixellab-api on
 * 2026-07-29. PixelLab labels the column "Estimated Price* (USD)" with the note
 * that prices "vary because of variation in the GPU processing time", so treat
 * these as estimates and re-check with `pixellab calibrate`.
 *
 * Two accounting units coexist and must never be mixed:
 *   - credits: prepaid, 1 credit = US$ 1.00
 *   - generations: subscription quota
 * The API reports which one it charged in `usage.type`.
 */
import type { EndpointId } from './endpoints.ts';

export interface CostPoint {
  /** width * height of the output frame. */
  readonly area: number;
  readonly usd: number;
}

export interface CostRule {
  readonly points: readonly CostPoint[];
  /** True when the endpoint returns 202 + background_job_id. */
  readonly async: boolean;
  /** Slots consumed in the concurrency semaphore. Heavy jobs count more. */
  readonly concurrencyWeight: number;
  /** Set when the remote artifact self-destructs. `/map-objects` = 8h. */
  readonly ephemeralTtlHours?: number;
  /** Whether a lost local artifact can be re-fetched for free from the API. */
  readonly remoteCacheable: boolean;
  /** Observed latency [p50, p95] in seconds. Drives wall-clock estimates. */
  readonly latencySec: readonly [number, number];
  /** Subscription generations charged, [min, max]. For the danger warnings. */
  readonly generations?: readonly [number, number];
  /** Populated when this endpoint bills per animated direction, not per call. */
  readonly billsPerDirection?: boolean;
}

/**
 * Latency note: the MCP docs state "typically 2-5 minutes" for most creations,
 * "~2-4 min" for animation and "~15-30s" for a 1-direction map object.
 * We use 210s as the async p50 because that is the midpoint of 2-5 minutes.
 */
const ASYNC_LATENCY = [210, 300] as const;

export const COST_TABLE: Readonly<Record<EndpointId, CostRule>> = {
  // ---- characters -------------------------------------------------------
  'create-character-with-4-directions': {
    points: [{ area: 48 * 48, usd: 0.0105 }, { area: 64 * 64, usd: 0.0122 }],
    async: true, concurrencyWeight: 2, remoteCacheable: true,
    latencySec: ASYNC_LATENCY, generations: [1, 1],
  },
  // The best value in the whole API: 1 generation, all 8 directions at once.
  'create-character-with-8-directions': {
    points: [{ area: 48 * 48, usd: 0.0133 }, { area: 64 * 64, usd: 0.0173 }],
    async: true, concurrencyWeight: 3, remoteCacheable: true,
    latencySec: ASYNC_LATENCY, generations: [1, 1],
  },
  'create-character-v3': {
    points: [
      { area: 64 * 64, usd: 0.041 },
      { area: 128 * 128, usd: 0.042 },
      { area: 168 * 168, usd: 0.045 },
    ],
    async: true, concurrencyWeight: 3, remoteCacheable: true,
    latencySec: ASYNC_LATENCY, generations: [2, 9],
  },
  'create-character-pro': {
    points: [
      { area: 85 * 85, usd: 0.095 },
      { area: 113 * 113, usd: 0.125 },
      { area: 168 * 168, usd: 0.185 },
    ],
    async: true, concurrencyWeight: 6, remoteCacheable: true,
    latencySec: ASYNC_LATENCY, generations: [20, 40],
  },
  // Applies one text edit consistently across all 8 rotations. This is how we
  // build armour variants without regenerating the body.
  'create-character-state': {
    points: [
      { area: 85 * 85, usd: 0.095 },
      { area: 113 * 113, usd: 0.125 },
      { area: 168 * 168, usd: 0.185 },
    ],
    async: true, concurrencyWeight: 6, remoteCacheable: true,
    latencySec: ASYNC_LATENCY, generations: [20, 40],
  },

  // ---- animation --------------------------------------------------------
  // Billed PER DIRECTION and queued as one background job per direction.
  // mode='template' is 1 generation/direction; mode='pro' is 20-40/direction
  // (160-320 for a full 8-direction set) and the API's own docs say it is also
  // worse. `guard.ts` refuses 'pro' without an explicit override.
  'animate-character': {
    points: [{ area: 64 * 64, usd: 0.01433 }, { area: 128 * 128, usd: 0.0145 }],
    async: true, concurrencyWeight: 2, remoteCacheable: true,
    latencySec: [150, 240], generations: [1, 40], billsPerDirection: true,
  },
  'animate-with-skeleton': {
    points: [
      { area: 32 * 32, usd: 0.0136 },
      { area: 64 * 64, usd: 0.01433 },
      { area: 128 * 128, usd: 0.01572 },
    ],
    async: false, concurrencyWeight: 1, remoteCacheable: false,
    latencySec: [20, 45],
  },
  'animate-with-text-v3': {
    points: [{ area: 64 * 64, usd: 0.0221 }, { area: 128 * 128, usd: 0.0424 }],
    async: true, concurrencyWeight: 2, remoteCacheable: false,
    latencySec: [150, 240],
  },
  'estimate-skeleton': {
    points: [{ area: 64 * 64, usd: 0.0051 }],
    async: false, concurrencyWeight: 1, remoteCacheable: false,
    latencySec: [5, 12],
  },

  // ---- rotation ---------------------------------------------------------
  'generate-8-rotations-v3': {
    points: [
      { area: 32 * 32, usd: 0.0293 },
      { area: 64 * 64, usd: 0.0337 },
      { area: 128 * 128, usd: 0.0345 },
      { area: 256 * 256, usd: 0.0377 },
    ],
    async: true, concurrencyWeight: 3, remoteCacheable: false,
    latencySec: ASYNC_LATENCY,
  },
  'rotate': {
    points: [{ area: 64 * 64, usd: 0.0106 }, { area: 128 * 128, usd: 0.0109 }],
    async: false, concurrencyWeight: 1, remoteCacheable: false,
    latencySec: [15, 40],
  },

  // ---- images -----------------------------------------------------------
  'create-image-pixflux': {
    points: [{ area: 64 * 64, usd: 0.0079 }, { area: 400 * 400, usd: 0.0132 }],
    async: false, concurrencyWeight: 1, remoteCacheable: false,
    latencySec: [8, 20],
  },
  'create-image-bitforge': {
    points: [
      { area: 32 * 32, usd: 0.0071 },
      { area: 64 * 64, usd: 0.0072 },
      { area: 128 * 128, usd: 0.008 },
      { area: 200 * 200, usd: 0.0112 },
    ],
    async: false, concurrencyWeight: 1, remoteCacheable: false,
    latencySec: [8, 22],
  },
  'create-image-pixen': {
    points: [{ area: 32 * 32, usd: 0.007 }, { area: 512 * 512, usd: 0.0169 }],
    async: false, concurrencyWeight: 1, remoteCacheable: false,
    latencySec: [10, 25],
  },
  'image-to-pixelart': {
    points: [
      { area: 64 * 64, usd: 0.006 },
      { area: 128 * 128, usd: 0.00666 },
      { area: 256 * 256, usd: 0.01164 },
    ],
    async: false, concurrencyWeight: 1, remoteCacheable: false,
    latencySec: [8, 20],
  },
  'inpaint-v3': {
    points: [{ area: 64 * 64, usd: 0.0072 }, { area: 200 * 200, usd: 0.0112 }],
    async: true, concurrencyWeight: 2, remoteCacheable: false,
    latencySec: [60, 150],
  },
  'remove-background': {
    points: [{ area: 64 * 64, usd: 0.00554 }, { area: 400 * 400, usd: 0.00593 }],
    async: false, concurrencyWeight: 1, remoteCacheable: false,
    latencySec: [5, 12],
  },

  // ---- terrain and props ------------------------------------------------
  'create-tileset': {
    points: [{ area: 16 * 16, usd: 0.0079 }, { area: 32 * 32, usd: 0.0099 }],
    async: true, concurrencyWeight: 2, remoteCacheable: true,
    latencySec: ASYNC_LATENCY,
  },
  'create-isometric-tile': {
    points: [{ area: 32 * 32, usd: 0.0156 }, { area: 64 * 64, usd: 0.0166 }],
    async: true, concurrencyWeight: 2, remoteCacheable: true,
    latencySec: ASYNC_LATENCY,
  },
  // The cheap path for props. Auto-deletes 8h after creation, so `remoteCacheable`
  // is false: the only trustworthy copy is the one on our disk.
  'map-objects': {
    points: [{ area: 128 * 128, usd: 0.0099 }],
    async: true, concurrencyWeight: 1, ephemeralTtlHours: 8,
    remoteCacheable: false, latencySec: [22, 30],
  },
  // 20-40 generations PER CALL. Use `map-objects` unless 8 angles are required.
  'create-8-direction-object': {
    points: [
      { area: 85 * 85, usd: 0.095 },
      { area: 113 * 113, usd: 0.125 },
      { area: 168 * 168, usd: 0.185 },
    ],
    async: true, concurrencyWeight: 6, remoteCacheable: true,
    latencySec: ASYNC_LATENCY, generations: [20, 40],
  },

  // ---- UI ---------------------------------------------------------------
  'create-ui-asset': {
    points: [{ area: 256 * 256, usd: 0.02 }, { area: 512 * 512, usd: 0.03 }],
    async: true, concurrencyWeight: 2, remoteCacheable: true,
    latencySec: ASYNC_LATENCY,
  },
};

export type Confidence = 'measured' | 'interpolated' | 'extrapolated';

export interface CostEstimate {
  readonly low: number;
  readonly point: number;
  readonly high: number;
  readonly confidence: Confidence;
}

/**
 * Interpolates cost by output area between measured points.
 *
 * Below the smallest and above the largest measured point we clamp rather than
 * extrapolate, but flag it — inventing a number outside the measured range and
 * presenting it as fact is how budgets get blown.
 */
export function estimateByArea(rule: CostRule, area: number): CostEstimate {
  const pts = [...rule.points].sort((a, b) => a.area - b.area);
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (!first || !last) throw new Error('cost rule has no points');

  const spread = (usd: number, confidence: Confidence): CostEstimate => ({
    low: usd * 0.85,
    point: usd,
    high: usd * 1.3,
    confidence,
  });

  if (area <= first.area) {
    return spread(first.usd, area === first.area ? 'measured' : 'extrapolated');
  }
  if (area >= last.area) {
    return spread(last.usd, area === last.area ? 'measured' : 'extrapolated');
  }

  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (area === a.area) return spread(a.usd, 'measured');
    if (area > a.area && area < b.area) {
      const t = (area - a.area) / (b.area - a.area);
      return spread(a.usd + t * (b.usd - a.usd), 'interpolated');
    }
  }
  return spread(last.usd, 'extrapolated');
}

export function sumEstimates(list: readonly CostEstimate[]): CostEstimate {
  const worst: Confidence[] = ['measured', 'interpolated', 'extrapolated'];
  let confidence: Confidence = 'measured';
  let low = 0;
  let point = 0;
  let high = 0;
  for (const e of list) {
    low += e.low;
    point += e.point;
    high += e.high;
    if (worst.indexOf(e.confidence) > worst.indexOf(confidence)) confidence = e.confidence;
  }
  return { low, point, high, confidence };
}

/** Concurrency ceiling per subscription tier. t3 documents "up to 20 concurrent jobs". */
export const TIER_CONCURRENCY = { free: 1, t1: 2, t2: 4, t3: 20 } as const;
export type Tier = keyof typeof TIER_CONCURRENCY;

/** Thresholds that trigger warnings. Same numbers as before, different meaning. */
export interface BudgetThresholds {
  /** Warn when a single run's worst-case estimate passes this. */
  readonly maxRunUsd: number;
  /** Warn when any single asset passes this — catches an accidental `mode: 'pro'`. */
  readonly maxAssetUsd: number;
  /** Warn when the point estimate passes this. */
  readonly promptAboveUsd: number;
  /** Warn when the month (ledger + this run) would pass this. */
  readonly hardCapMonthlyUsd: number;
}

export const DEFAULT_THRESHOLDS: BudgetThresholds = {
  maxRunUsd: 15,
  maxAssetUsd: 0.3,
  promptAboveUsd: 5,
  hardCapMonthlyUsd: 60,
};

export type WarningCode = 'asset-cap' | 'run-cap' | 'monthly-cap' | 'balance';

export interface Aviso {
  readonly code: WarningCode;
  readonly measured: number;
  readonly threshold: number;
  readonly text: string;
}

interface BudgetReportBase {
  readonly estimate: CostEstimate;
  /** Total from the local ledger for this CLI session. */
  readonly sessionSpentUsd: number;
  /** Total from the local ledger for the current month. */
  readonly monthSpentUsd: number;
  /**
   * Remaining account balance, or undefined when unreadable.
   *
   * Treated as an opaque number: under a subscription the unit may be
   * generations rather than USD, so we only ever compare it loosely and never
   * let it be the sole gate. `hardCapMonthlyUsd` is the real defence.
   */
  readonly balanceUsd: number | undefined;
}

/**
 * A report, never a decision. The guard informs; the human decides.
 *
 * The discriminated union on the literal `requiresConfirmation` is load-bearing:
 * it forces every call site to handle both branches, and a new code path that
 * forgets to ask for confirmation does not compile.
 */
export type BudgetReport =
  & BudgetReportBase
  & (
    | { readonly avisos: readonly Aviso[]; readonly requiresConfirmation: true }
    | { readonly avisos: readonly Aviso[]; readonly requiresConfirmation: false }
  );

export interface GuardInput {
  readonly estimate: CostEstimate;
  /** Highest single-asset point estimate in the run. */
  readonly maxSingleAssetUsd: number;
  /** Sum from the local ledger for the current month. */
  readonly spentThisMonthUsd: number;
  /** Sum from the local ledger for this CLI session. */
  readonly spentThisSessionUsd: number;
  /**
   * Remaining account balance, or undefined when unreadable.
   *
   * Treated as an opaque number: under a subscription the unit may be
   * generations rather than USD, so we only ever compare it loosely and never
   * let it be the sole gate. `hardCapMonthlyUsd` is the real defence.
   */
  readonly balanceUsd: number | undefined;
}

export function checkBudget(
  input: GuardInput,
  thresholds: BudgetThresholds = DEFAULT_THRESHOLDS,
): BudgetReport {
  const { estimate, maxSingleAssetUsd, spentThisMonthUsd, spentThisSessionUsd, balanceUsd } = input;

  const avisos: Aviso[] = [];

  if (maxSingleAssetUsd > thresholds.maxAssetUsd) {
    avisos.push({
      code: 'asset-cap',
      measured: maxSingleAssetUsd,
      threshold: thresholds.maxAssetUsd,
      text:
        `um asset custa ${maxSingleAssetUsd.toFixed(4)} USD, acima do limiar por asset ` +
        `(${thresholds.maxAssetUsd.toFixed(2)}). Isso quase sempre é um mode='pro' acidental.`,
    });
  }

  if (estimate.high > thresholds.maxRunUsd) {
    avisos.push({
      code: 'run-cap',
      measured: estimate.high,
      threshold: thresholds.maxRunUsd,
      text:
        `pior caso do run é ${estimate.high.toFixed(2)} USD, acima do limiar de ` +
        `${thresholds.maxRunUsd.toFixed(2)}.`,
    });
  }

  if (spentThisMonthUsd + estimate.point > thresholds.hardCapMonthlyUsd) {
    avisos.push({
      code: 'monthly-cap',
      measured: spentThisMonthUsd + estimate.point,
      threshold: thresholds.hardCapMonthlyUsd,
      text:
        `o mês já gastou ${spentThisMonthUsd.toFixed(2)} USD; somando ` +
        `${estimate.point.toFixed(2)} passa do limiar mensal de ${thresholds.hardCapMonthlyUsd.toFixed(2)}.`,
    });
  }

  if (balanceUsd !== undefined && estimate.point > balanceUsd * 0.9) {
    avisos.push({
      code: 'balance',
      measured: estimate.point,
      threshold: balanceUsd * 0.9,
      text:
        `estimativa ${estimate.point.toFixed(2)} USD consome mais de 90% do saldo ` +
        `(${balanceUsd.toFixed(2)}).`,
    });
  }

  const base: BudgetReportBase = {
    estimate,
    sessionSpentUsd: spentThisSessionUsd,
    monthSpentUsd: spentThisMonthUsd,
    balanceUsd,
  };

  // Confirmation is required on every generation. The guard informs; the human decides.
  return { ...base, avisos, requiresConfirmation: true as const };
}
