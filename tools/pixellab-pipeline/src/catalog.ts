/**
 * The asset catalog: identity, idempotency and the lockfile.
 *
 * This module decides when we spend money. Get it wrong in one direction and we
 * re-pay for assets we already have; wrong in the other and a changed prompt
 * silently keeps the stale image.
 */
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { ENDPOINTS, validateSize, type EndpointId, type ImageSize } from './endpoints.ts';
import { COST_TABLE, estimateByArea, sumEstimates, type CostEstimate } from './cost.ts';
import { canonicalJson, digest, readJsonIfExists, writeFileAtomic } from './util.ts';

/** Bump to force a full regeneration. This is a budget decision, not a refactor. */
export const PIPELINE_VERSION = 1;

export type AssetId = string;

export interface AssetSpec {
  readonly id: AssetId;
  readonly endpoint: EndpointId;
  /** Output path, relative to the atlas root. Not part of identity. */
  readonly out: string;
  /** Exactly the body sent to the API, after defaults are applied. */
  readonly params: Record<string, unknown>;
  /** Local files fed to the request (style refs, init images, masks). */
  readonly inputs?: readonly string[];
  /** Assets that must exist first. Regenerating a parent cascades to children. */
  readonly dependsOn?: readonly AssetId[];
  /** Free-form grouping for budget reporting. Not part of identity. */
  readonly budgetGroup?: string;
  /** Post-processing config. Changing it rebuilds locally, at zero API cost. */
  readonly post?: Record<string, unknown>;
  /** Bump to force regeneration of just this asset without lying about params. */
  readonly salt?: string;
}

export interface ResolvedAsset extends AssetSpec {
  readonly specHash: string;
  readonly postHash: string;
  readonly estimate: CostEstimate;
}

export interface LockEntry {
  readonly specHash: string;
  readonly postHash: string;
  readonly endpoint: EndpointId;
  readonly status: 'generated' | 'approved' | 'rejected';
  readonly jobId?: string;
  readonly remote?: { readonly kind: string; readonly id: string; readonly ephemeral: boolean };
  readonly generatedAt: string;
  readonly costUsd: number;
  readonly artifacts: readonly { readonly path: string; readonly sha256: string; readonly bytes: number }[];
  readonly requestSnapshot?: Record<string, unknown>;
  readonly history?: readonly { readonly specHash: string; readonly replacedAt: string; readonly reason: string }[];
}

export interface Lockfile {
  readonly lockfileVersion: 1;
  readonly pipelineVersion: number;
  readonly openapiSnapshot: { readonly sha256: string; readonly fetchedAt: string };
  readonly assets: Record<AssetId, LockEntry>;
  /** specHashes an art director rejected. Never spend on these again. */
  readonly rejectedHashes: Record<string, { readonly assetId: AssetId; readonly reason: string; readonly at: string }>;
}

export function emptyLockfile(openapiSha: string, fetchedAt: string): Lockfile {
  return {
    lockfileVersion: 1,
    pipelineVersion: PIPELINE_VERSION,
    openapiSnapshot: { sha256: openapiSha, fetchedAt },
    assets: {},
    rejectedHashes: {},
  };
}

export async function loadLockfile(path: string): Promise<Lockfile | undefined> {
  return readJsonIfExists<Lockfile>(path);
}

export async function saveLockfile(path: string, lock: Lockfile): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(lock, null, 2)}\n`);
}

/**
 * Hash of the *decoded pixels*, not the file bytes.
 *
 * This distinction is load-bearing. Re-encoding a PNG with a different
 * compressor, or a fresh git-lfs checkout, changes the bytes while leaving the
 * image identical. Hashing bytes would invalidate the cache and charge us again
 * for nothing.
 */
export async function inputHash(path: string): Promise<string> {
  const { data, info } = await sharp(await readFile(path)).raw().toBuffer({ resolveWithObject: true });
  return digest(`${info.width}x${info.height}x${info.channels}:${digest(data)}`);
}

export interface HashContext {
  readonly pipelineVersion: number;
  /** specHash of an already-resolved dependency. */
  parentSpecHash(id: AssetId): string;
  resolveInput(path: string): Promise<string>;
}

/**
 * Identity of a paid API call.
 *
 * Deliberately EXCLUDES the OpenAPI schema hash. If PixelLab edits a field we
 * do not even use, including it would invalidate every asset and produce a bill
 * of hundreds of dollars for zero benefit. Schema drift is reported by
 * `doctor`, never treated as cache invalidation.
 */
export async function computeSpecHash(spec: AssetSpec, ctx: HashContext): Promise<string> {
  const inputs: Record<string, string> = {};
  for (const p of spec.inputs ?? []) inputs[p] = await ctx.resolveInput(p);

  const parents: Record<string, string> = {};
  for (const id of spec.dependsOn ?? []) parents[id] = ctx.parentSpecHash(id);

  return digest(
    canonicalJson({
      endpoint: spec.endpoint,
      params: spec.params,
      inputs,
      parents,
      pipelineVersion: ctx.pipelineVersion,
      ...(spec.salt === undefined ? {} : { salt: spec.salt }),
    }),
  );
}

/** Identity of local post-processing. Changing it costs nothing. */
export function computePostHash(spec: AssetSpec): string {
  return digest(canonicalJson({ post: spec.post ?? {}, out: spec.out }));
}

function outputArea(spec: AssetSpec): number {
  const size = spec.params['image_size'] as ImageSize | undefined;
  if (size?.width && size?.height) return size.width * size.height;
  const tile = spec.params['tile_size'] as ImageSize | undefined;
  if (tile?.width && tile?.height) return tile.width * tile.height;
  return 64 * 64;
}

/** Directions actually animated — animation bills per direction. */
function directionCount(spec: AssetSpec): number {
  const dirs = spec.params['directions'];
  if (Array.isArray(dirs)) return Math.max(1, dirs.length);
  return COST_TABLE[spec.endpoint].billsPerDirection ? 8 : 1;
}

export function estimateAsset(spec: AssetSpec): CostEstimate {
  const rule = COST_TABLE[spec.endpoint];
  const per = estimateByArea(rule, outputArea(spec));
  const n = directionCount(spec);
  if (n === 1) return per;
  return { low: per.low * n, point: per.point * n, high: per.high * n, confidence: per.confidence };
}

export type PlanAction = 'skip' | 'reprocess' | 'redownload' | 'generate' | 'blocked-rejected';

export interface PlanItem {
  readonly asset: ResolvedAsset;
  readonly action: PlanAction;
  readonly reason: string;
}

export interface RunPlan {
  readonly items: readonly PlanItem[];
  readonly toGenerate: readonly PlanItem[];
  readonly estimate: CostEstimate;
  readonly savedUsd: number;
  readonly maxSingleAssetUsd: number;
  readonly validationErrors: readonly string[];
}

/**
 * Resolves specs into a plan, in dependency order.
 *
 * Validation runs before anything is submitted, because a 422 arrives after the
 * charge. Cycles are a hard error rather than a hang.
 */
export async function buildPlan(
  specs: readonly AssetSpec[],
  lock: Lockfile,
  artifactExists: (path: string) => Promise<boolean>,
): Promise<RunPlan> {
  const ordered = topologicalSort(specs);
  const resolved = new Map<AssetId, ResolvedAsset>();
  const items: PlanItem[] = [];
  const validationErrors: string[] = [];

  const ctx: HashContext = {
    pipelineVersion: PIPELINE_VERSION,
    parentSpecHash: (id) => {
      const parent = resolved.get(id);
      if (!parent) throw new Error(`dependência não resolvida: ${id}`);
      return parent.specHash;
    },
    resolveInput: inputHash,
  };

  for (const spec of ordered) {
    const size = spec.params['image_size'] as ImageSize | undefined;
    if (size) {
      for (const problem of validateSize(spec.endpoint, size)) {
        validationErrors.push(`${spec.id}: ${problem}`);
      }
    }
    if (spec.params['seed'] === undefined || spec.params['seed'] === null) {
      validationErrors.push(
        `${spec.id}: seed não travado — sem seed a geração não é reprodutível`,
      );
    }

    const specHash = await computeSpecHash(spec, ctx);
    const postHash = computePostHash(spec);
    const asset: ResolvedAsset = { ...spec, specHash, postHash, estimate: estimateAsset(spec) };
    resolved.set(spec.id, asset);

    items.push({ asset, ...(await decide(asset, lock, artifactExists)) });
  }

  const toGenerate = items.filter((i) => i.action === 'generate');
  const estimate = sumEstimates(toGenerate.map((i) => i.asset.estimate));
  const savedUsd = items
    .filter((i) => i.action === 'skip' || i.action === 'reprocess' || i.action === 'redownload')
    .reduce((sum, i) => sum + i.asset.estimate.point, 0);
  const maxSingleAssetUsd = toGenerate.reduce((m, i) => Math.max(m, i.asset.estimate.point), 0);

  return { items, toGenerate, estimate, savedUsd, maxSingleAssetUsd, validationErrors };
}

async function decide(
  asset: ResolvedAsset,
  lock: Lockfile,
  artifactExists: (path: string) => Promise<boolean>,
): Promise<{ action: PlanAction; reason: string }> {
  const rejected = lock.rejectedHashes[asset.specHash];
  if (rejected) {
    return {
      action: 'blocked-rejected',
      reason: `este specHash já foi reprovado (${rejected.reason}) — não gerar de novo`,
    };
  }

  const entry = lock.assets[asset.id];
  if (!entry) return { action: 'generate', reason: 'asset novo' };

  if (entry.specHash !== asset.specHash) {
    return { action: 'generate', reason: 'spec mudou (params, input, seed ou dependência)' };
  }

  let allPresent = true;
  for (const a of entry.artifacts) {
    if (!(await artifactExists(a.path))) { allPresent = false; break; }
  }

  if (allPresent) {
    return entry.postHash === asset.postHash
      ? { action: 'skip', reason: 'já existe e nada mudou' }
      : { action: 'reprocess', reason: 'só o pós-processamento mudou — custo zero' };
  }

  const rule = COST_TABLE[asset.endpoint];
  if (rule.remoteCacheable && entry.remote && !entry.remote.ephemeral) {
    return { action: 'redownload', reason: 'artefato local perdido, recurso remoto vivo — grátis' };
  }
  return {
    action: 'generate',
    reason: rule.ephemeralTtlHours
      ? `artefato perdido e o recurso expira em ${rule.ephemeralTtlHours}h — regerar (pago)`
      : 'artefato perdido e não há cópia remota — regerar (pago)',
  };
}

function topologicalSort(specs: readonly AssetSpec[]): AssetSpec[] {
  const byId = new Map(specs.map((s) => [s.id, s]));
  const state = new Map<AssetId, 'visiting' | 'done'>();
  const out: AssetSpec[] = [];

  const visit = (spec: AssetSpec, trail: AssetId[]): void => {
    const seen = state.get(spec.id);
    if (seen === 'done') return;
    if (seen === 'visiting') {
      throw new Error(`ciclo de dependência: ${[...trail, spec.id].join(' -> ')}`);
    }
    state.set(spec.id, 'visiting');
    for (const dep of spec.dependsOn ?? []) {
      const parent = byId.get(dep);
      if (!parent) throw new Error(`${spec.id} depende de ${dep}, que não existe no catálogo`);
      visit(parent, [...trail, spec.id]);
    }
    state.set(spec.id, 'done');
    out.push(spec);
  };

  for (const spec of specs) visit(spec, []);
  return out;
}

/** Helpers used by the catalog files, so specs stay declarative and typed. */
export function character8dir(args: {
  id: AssetId; out: string; description: string; size: number; seed: number;
  budgetGroup?: string; inputs?: readonly string[];
}): AssetSpec {
  return {
    id: args.id,
    endpoint: 'create-character-with-8-directions',
    out: args.out,
    params: {
      description: args.description,
      image_size: { width: args.size, height: args.size },
      view: 'low top-down',
      mode: 'standard',
      seed: args.seed,
    },
    ...(args.inputs ? { inputs: args.inputs } : {}),
    ...(args.budgetGroup ? { budgetGroup: args.budgetGroup } : {}),
  };
}

export function animateCharacter(args: {
  id: AssetId; out: string; dependsOn: AssetId; templateAnimationId: string;
  seed: number; budgetGroup?: string;
}): AssetSpec {
  return {
    id: args.id,
    endpoint: 'animate-character',
    out: args.out,
    dependsOn: [args.dependsOn],
    params: {
      // character_id is resolved from the lockfile at submit time.
      template_animation_id: args.templateAnimationId,
      mode: 'template',
      seed: args.seed,
    },
    ...(args.budgetGroup ? { budgetGroup: args.budgetGroup } : {}),
  };
}

export function mapObject(args: {
  id: AssetId; out: string; description: string; size: number; seed: number; budgetGroup?: string;
}): AssetSpec {
  return {
    id: args.id,
    endpoint: 'map-objects',
    out: args.out,
    params: {
      description: args.description,
      image_size: { width: args.size, height: args.size },
      view: 'low top-down',
      seed: args.seed,
    },
    ...(args.budgetGroup ? { budgetGroup: args.budgetGroup } : {}),
  };
}

export function tileset(args: {
  id: AssetId; out: string; lower: string; upper: string; tile: 16 | 32;
  seed: number; transition?: string; budgetGroup?: string;
}): AssetSpec {
  return {
    id: args.id,
    endpoint: 'create-tileset',
    out: args.out,
    params: {
      lower_description: args.lower,
      upper_description: args.upper,
      ...(args.transition ? { transition_description: args.transition } : {}),
      tile_size: { width: args.tile, height: args.tile },
      // Must be set explicitly: the API default is 'high top-down', but our
      // characters are 'low top-down' and terrain has to match.
      view: 'low top-down',
      mode: 'standard',
      seed: args.seed,
    },
    ...(args.budgetGroup ? { budgetGroup: args.budgetGroup } : {}),
  };
}

export { ENDPOINTS };
