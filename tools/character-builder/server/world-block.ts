/**
 * Blocos do mundo — bancada do /create-isometric-tile.
 *
 * Gera as peças de terreno do editor: cubos isométricos já desenhados na
 * projeção do gênero (topo + duas faces laterais em diagonal), prontos para
 * assentar no grid do map-builder sem pós-processamento.
 *
 * Decisões de API confirmadas no spec vendorizado
 * (tools/pixellab-pipeline/openapi/openapi-v2.json, capturado 2026-07-29):
 *   - POST /create-isometric-tile. required = description + image_size.
 *     image_size.width/height inteiros 16–64 (o próprio spec observa que
 *     "acima de 24px costuma dar melhor resultado").
 *   - isometric_tile_shape enum [thick tile|thin tile|block], default 'block'.
 *     O spec descreve a altura ocupada: thin ~15% do canvas, thick ~25%,
 *     block ~50%. 'block' é o cubo — o default desta bancada.
 *   - isometric_tile_size enum [16|32], default 16.
 *   - outline default 'lineless'; shading default 'basic shading';
 *     detail default 'medium detail'; text_guidance_scale 1–20, default 8.
 *   - color_image (Base64Image) força a paleta. É o mecanismo que mantém as
 *     quatro vistas do MESMO bloco coerentes entre si.
 *   - A resposta tem DUAS formas documentadas: 200 com {image: {base64}} e
 *     202 com {background_job_id, tile_id}. O código trata as duas — o
 *     status HTTP não diz se a chamada é assíncrona.
 *   - GET /isometric-tiles/{tile_id} devolve {image} e responde 423 enquanto
 *     ainda está processando.
 *
 * ## O que a API NÃO oferece, e como isto contorna
 *
 * **`/create-isometric-tile` não tem parâmetro de orientação.** Não existe
 * `facing`, `direction` nem `rotation` no schema. Portanto as quatro vistas
 * de um bloco não saem de uma chamada só: ou o bloco é UNIFORME e a mesma
 * arte serve as quatro vistas da câmera, ou ele é ORIENTADO e cada vista é
 * uma geração própria, guiada por texto.
 *
 * Isso é convenção deste repositório, não capacidade verificada do endpoint.
 * O modo uniforme é o default porque custa 1 geração em vez de 4 — e para
 * grama, terra e pedra as quatro vistas são visualmente a mesma peça.
 *
 * ## Regras que valem para todo o módulo
 *   - Validação TOTAL antes de gastar (WorldBlockValidationError, zero API).
 *   - PNG em disco ANTES de qualquer outra coisa: o dinheiro sai na submissão.
 *   - Guard de orçamento (ADR 0012): estima, loga, nunca recusa.
 *   - Idempotência por face: PNG existente = aquela face não chama a API.
 *   - Seeds determinísticas: base = seed informada ou derivada do hash;
 *     face i = base + i.
 *   - tile_id no ledger e no manifesto: é o caminho de volta ao artefato pago.
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { PixelLabClient, Usage } from '../../pixellab-pipeline/src/api.ts';
import { PixelLabError, pollJob } from '../../pixellab-pipeline/src/api.ts';
import { sleep } from '../../pixellab-pipeline/src/util.ts';
import {
  COST_TABLE, estimateByArea, checkBudget,
  type BudgetReport, type CostEstimate,
} from '../../pixellab-pipeline/src/cost.ts';
import { asBase64Image, extractBase64 } from './base64-image.ts';
import { trackSpend } from './estimate.ts';
import { toPngBytes } from './png.ts';
import {
  BLOCK_FACINGS,
  FACING_LABELS,
  TILE_SHAPES,
  TILE_OUTLINES,
  TILE_SHADINGS,
  TILE_DETAILS,
  TILE_UNIT_SIZES,
  BLOCK_SIZE_PRESETS,
  DEFAULT_BLOCK_SIZE,
  FACING_MODES,
  type BlockFacing,
  type TileShape,
  type TileOutline,
  type TileShading,
  type TileDetail,
  type TileUnitSize,
  type FacingMode,
} from './model.ts';


// O vocabulário do endpoint mora em ./model.ts — módulo puro, que a tela
// também importa (world-block.ts arrasta node:crypto e node:fs).
export {
  BLOCK_FACINGS,
  FACING_LABELS,
  TILE_SHAPES,
  TILE_OUTLINES,
  TILE_SHADINGS,
  TILE_DETAILS,
  TILE_UNIT_SIZES,
  BLOCK_SIZE_PRESETS,
  DEFAULT_BLOCK_SIZE,
  FACING_MODES,
} from './model.ts';
export type {
  BlockFacing,
  TileShape,
  TileOutline,
  TileShading,
  TileDetail,
  TileUnitSize,
  FacingMode,
} from './model.ts';

// ---- contrato

export interface WorldBlockConfig {
  /** Prompt do bloco. Obrigatória. */
  readonly description: string;
  /** Lado do frame quadrado, inteiro 16–64 (ImageSize do endpoint). */
  readonly size: number;
  /** Altura ocupada no canvas. Default 'block' (o cubo). */
  readonly shape?: TileShape;
  /** isometric_tile_size do spec. Omitido usa o default do endpoint (16). */
  readonly tileUnitSize?: TileUnitSize;
  readonly outline?: TileOutline;
  readonly shading?: TileShading;
  readonly detail?: TileDetail;
  /** text_guidance_scale, 1–20. Omitido usa o default do endpoint (8). */
  readonly textGuidanceScale?: number;
  /** Seed base; ausente, deriva do hash. Face i = base + i. */
  readonly seed?: number;
  /** Default 'uniform' — 1 geração em vez de 4. */
  readonly facingMode?: FacingMode;
  /**
   * Só vale em modo 'oriented'. Trava a paleta das faces seguintes na
   * primeira gerada, via color_image. Default true: sem isso as quatro
   * vistas do mesmo bloco derivam de cor e param de parecer o mesmo bloco.
   */
  readonly lockPalette?: boolean;
}

export interface WorldBlockFace {
  readonly facing: BlockFacing;
  /** Seed efetiva desta face. */
  readonly seed: number;
  /** PNG da face, b64 puro. */
  readonly pngB64: string;
  /** tile_id da PixelLab, quando a resposta foi assíncrona. */
  readonly tileId?: string;
  /**
   * true quando esta face reusa a arte de outra (modo uniforme). Nenhuma
   * chamada saiu para ela.
   */
  readonly reused: boolean;
  readonly usage?: {
    readonly type: string;
    readonly usd?: number | null;
    readonly generations?: number | null;
  };
}

export interface WorldBlockResult {
  readonly hash: string;
  /** Sempre as 4 faces, na ordem de BLOCK_FACINGS. */
  readonly faces: readonly WorldBlockFace[];
  /** true quando NENHUMA submissão saiu — tudo veio do disco. */
  readonly fromCache: boolean;
  /** Quantas gerações foram efetivamente submetidas nesta execução. */
  readonly generated: number;
}

interface IsometricTileResponse {
  readonly image?: unknown;
  readonly background_job_id?: string;
  readonly tile_id?: string;
  readonly usage?: Usage | null;
}

// ---- erros nomeados (api.ts mapeia para HTTP 400)

export type WorldBlockErrorCode =
  | 'description-required'
  | 'description-too-long'
  | 'size-range'
  | 'shape-enum'
  | 'tile-unit-size-enum'
  | 'outline-enum'
  | 'shading-enum'
  | 'detail-enum'
  | 'guidance-range'
  | 'seed-range'
  | 'facing-mode-enum';

export class WorldBlockValidationError extends Error {
  readonly code: WorldBlockErrorCode;

  constructor(code: WorldBlockErrorCode, message: string) {
    super(message);
    this.name = 'WorldBlockValidationError';
    this.code = code;
  }
}

// ---- validação (SEMPRE antes de gastar)

function inEnum(value: unknown, options: readonly string[]): boolean {
  return typeof value === 'string' && options.includes(value);
}

function validate(config: WorldBlockConfig): void {
  const rawDesc: unknown = config.description;
  if (typeof rawDesc !== 'string' || rawDesc.trim().length === 0) {
    throw new WorldBlockValidationError(
      'description-required',
      'description é obrigatória: o create-isometric-tile não gera sem prompt.',
    );
  }
  if (rawDesc.length > 2000) {
    throw new WorldBlockValidationError(
      'description-too-long',
      `description tem ${rawDesc.length} caracteres; o teto adotado é 2000.`,
    );
  }

  const rawSize: unknown = config.size;
  if (
    typeof rawSize !== 'number' || !Number.isInteger(rawSize) || rawSize < 16 || rawSize > 64
  ) {
    throw new WorldBlockValidationError(
      'size-range',
      `size fora da faixa do create-isometric-tile: inteiro entre 16 e 64 (recebido ${String(rawSize)}).`,
    );
  }

  if (config.shape !== undefined && !inEnum(config.shape, TILE_SHAPES)) {
    throw new WorldBlockValidationError(
      'shape-enum',
      `shape inválido: "${String(config.shape)}". O spec aceita: ${TILE_SHAPES.join(', ')}.`,
    );
  }
  if (
    config.tileUnitSize !== undefined &&
    !(TILE_UNIT_SIZES as readonly number[]).includes(config.tileUnitSize)
  ) {
    throw new WorldBlockValidationError(
      'tile-unit-size-enum',
      `tileUnitSize inválido: ${String(config.tileUnitSize)}. O spec aceita ${TILE_UNIT_SIZES.join(' ou ')}.`,
    );
  }
  if (config.outline !== undefined && !inEnum(config.outline, TILE_OUTLINES)) {
    throw new WorldBlockValidationError(
      'outline-enum',
      `outline inválido: "${String(config.outline)}". Opções: ${TILE_OUTLINES.join(', ')}.`,
    );
  }
  if (config.shading !== undefined && !inEnum(config.shading, TILE_SHADINGS)) {
    throw new WorldBlockValidationError(
      'shading-enum',
      `shading inválido: "${String(config.shading)}". Opções: ${TILE_SHADINGS.join(', ')}.`,
    );
  }
  if (config.detail !== undefined && !inEnum(config.detail, TILE_DETAILS)) {
    throw new WorldBlockValidationError(
      'detail-enum',
      `detail inválido: "${String(config.detail)}". Opções: ${TILE_DETAILS.join(', ')}.`,
    );
  }
  if (
    config.textGuidanceScale !== undefined &&
    (typeof config.textGuidanceScale !== 'number' ||
      !Number.isFinite(config.textGuidanceScale) ||
      config.textGuidanceScale < 1 ||
      config.textGuidanceScale > 20)
  ) {
    throw new WorldBlockValidationError(
      'guidance-range',
      `textGuidanceScale fora da faixa do spec: número entre 1 e 20 (recebido ${String(config.textGuidanceScale)}).`,
    );
  }
  if (
    config.seed !== undefined &&
    (!Number.isInteger(config.seed) || config.seed < 0)
  ) {
    throw new WorldBlockValidationError(
      'seed-range',
      `seed fora da faixa: inteiro >= 0 (recebido ${String(config.seed)}).`,
    );
  }
  if (config.facingMode !== undefined && !inEnum(config.facingMode, FACING_MODES)) {
    throw new WorldBlockValidationError(
      'facing-mode-enum',
      `facingMode inválido: "${String(config.facingMode)}". Opções: ${FACING_MODES.join(', ')}.`,
    );
  }
}

/** Costura de integração para a rota POST /api/world-block. */
export function validateWorldBlockConfig(config: WorldBlockConfig): void {
  validate(config);
}

// ---- prompt por face

/**
 * Sufixo que descreve QUAL lado do bloco está de frente para a câmera.
 *
 * Guia de texto, não parâmetro de API: o endpoint não tem orientação, então
 * a única alavanca é a descrição. Por isso o modo orientado só vale a pena
 * quando o bloco TEM um lado distinto (uma porta, uma quina, um brasão) —
 * para material uniforme ele gasta 4× por nada.
 */
export function facingPrompt(description: string, facing: BlockFacing): string {
  const hint: Record<BlockFacing, string> = {
    north: 'seen with its north side facing the camera',
    east: 'seen with its east side facing the camera',
    south: 'seen with its south side facing the camera',
    west: 'seen with its west side facing the camera',
  };
  return `${description}, ${hint[facing]}`;
}

// ---- idempotência

/** sha256 de TODA a config — inclusive o modo de face. */
function inputHash(config: WorldBlockConfig): string {
  const h = createHash('sha256');
  h.update(`desc=${config.description}`);
  h.update(`|size=${config.size}`);
  h.update(`|shape=${config.shape ?? 'block'}`);
  h.update(`|tileUnit=${config.tileUnitSize ?? ''}`);
  h.update(`|outline=${config.outline ?? ''}`);
  h.update(`|shading=${config.shading ?? ''}`);
  h.update(`|detail=${config.detail ?? ''}`);
  h.update(`|guidance=${config.textGuidanceScale ?? ''}`);
  h.update(`|seed=${config.seed ?? ''}`);
  h.update(`|facingMode=${config.facingMode ?? 'uniform'}`);
  h.update(`|lockPalette=${config.lockPalette ?? true}`);
  return h.digest('hex').slice(0, 16);
}

/** O MESMO hash que runWorldBlock usa — a rota monta a chave do job com ele. */
export function worldBlockHash(config: WorldBlockConfig): string {
  return inputHash(config);
}

function baseSeed(config: WorldBlockConfig, hash: string): number {
  return config.seed ?? Number.parseInt(hash.slice(0, 8), 16);
}

// ---- paths

function blockDir(assetsDir: string, hash: string): string {
  return join(assetsDir, 'world-blocks', hash);
}

function facePngPath(assetsDir: string, hash: string, facing: BlockFacing): string {
  return join(blockDir(assetsDir, hash), `${facing}.png`);
}

function manifestPath(assetsDir: string, hash: string): string {
  return join(blockDir(assetsDir, hash), 'block.json');
}

// ---- ledger e guard

function appendLedger(path: string, line: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(line)}\n`);
}

function logGuard(
  label: string,
  report: BudgetReport,
  onLog?: (msg: string) => void,
): void {
  const e = report.estimate;
  onLog?.(
    `[guard] ${label}: ${e.point.toFixed(4)} USD ` +
      `(faixa ${e.low.toFixed(4)}–${e.high.toFixed(4)}, confiança ${e.confidence})`,
  );
  for (const a of report.avisos) onLog?.(`[guard]   aviso [${a.code}]: ${a.text}`);
}

function guardFor(estimate: CostEstimate, maxSingleAssetUsd: number): BudgetReport {
  return checkBudget({
    estimate,
    maxSingleAssetUsd,
    spentThisMonthUsd: 0,
    spentThisSessionUsd: 0,
    balanceUsd: undefined,
  });
}

// ---- manifesto

interface WorldBlockManifest {
  readonly version: 1;
  readonly hash: string;
  readonly facingMode: FacingMode;
  readonly size: number;
  readonly shape: TileShape;
  readonly description: string;
  readonly faces: ReadonlyArray<{
    readonly facing: BlockFacing;
    readonly seed: number;
    readonly tileId?: string;
    readonly reused: boolean;
    readonly usage?: WorldBlockFace['usage'];
  }>;
}

/**
 * Lê o bloco persistido de uma execução anterior, ou null quando não existe
 * (ou está incompleto). Os bytes vêm dos PNGs em disco.
 */
export async function readWorldBlockResult(
  hash: string,
  assetsDir: string,
): Promise<WorldBlockResult | null> {
  const path = manifestPath(assetsDir, hash);
  if (!existsSync(path)) return null;

  let manifest: WorldBlockManifest;
  try {
    manifest = JSON.parse(await readFile(path, 'utf8')) as WorldBlockManifest;
  } catch {
    return null;
  }
  if (manifest.hash !== hash || !Array.isArray(manifest.faces)) return null;

  const faces: WorldBlockFace[] = [];
  for (const f of manifest.faces) {
    const png = facePngPath(assetsDir, hash, f.facing);
    if (!existsSync(png)) return null;
    faces.push({
      facing: f.facing,
      seed: f.seed,
      reused: f.reused,
      pngB64: (await readFile(png)).toString('base64'),
      ...(f.tileId ? { tileId: f.tileId } : {}),
      ...(f.usage ? { usage: f.usage } : {}),
    });
  }
  if (faces.length !== BLOCK_FACINGS.length) return null;
  return { hash, faces, fromCache: true, generated: 0 };
}

/** Uma entrada do catálogo lido por GET /api/world-blocks. */
export interface WorldBlockSummary {
  readonly hash: string;
  readonly description: string;
  readonly size: number;
  readonly shape: TileShape;
  readonly facingMode: FacingMode;
  /** Face → caminho público servido pelo Vite (publicDir = assets/). */
  readonly faceUrls: Readonly<Record<BlockFacing, string>>;
}

/**
 * Catálogo dos blocos completos em disco — é daqui que o map-builder monta a
 * paleta. Só entram blocos com manifesto E as quatro faces gravadas: um bloco
 * pela metade na paleta seria uma peça que falha ao ser colocada.
 */
export async function listWorldBlocks(assetsDir: string): Promise<WorldBlockSummary[]> {
  const root = join(assetsDir, 'world-blocks');
  if (!existsSync(root)) return [];

  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(root, { withFileTypes: true });
  const out: WorldBlockSummary[] = [];

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const hash = e.name;
    const mPath = manifestPath(assetsDir, hash);
    if (!existsSync(mPath)) continue;
    let manifest: WorldBlockManifest;
    try {
      manifest = JSON.parse(await readFile(mPath, 'utf8')) as WorldBlockManifest;
    } catch {
      continue;
    }
    if (manifest.hash !== hash) continue;
    if (!BLOCK_FACINGS.every((f) => existsSync(facePngPath(assetsDir, hash, f)))) continue;

    const faceUrls = Object.fromEntries(
      BLOCK_FACINGS.map((f) => [f, `/world-blocks/${hash}/${f}.png`]),
    ) as Record<BlockFacing, string>;

    out.push({
      hash,
      description: manifest.description,
      size: manifest.size,
      shape: manifest.shape,
      facingMode: manifest.facingMode,
      faceUrls,
    });
  }

  // Ordem estável: o hash é determinístico, então a paleta não dança entre
  // recargas por causa da ordem do sistema de arquivos.
  return out.sort((a, b) => a.hash.localeCompare(b.hash));
}

// ---- recuperação do PNG (as duas formas de resposta)

/**
 * Extrai o PNG de uma resposta do /create-isometric-tile.
 *
 * O spec documenta DUAS formas para o mesmo endpoint: 200 com o `image`
 * embutido e 202 com `{background_job_id, tile_id}`. O status HTTP não
 * decide — quem decide é o corpo. Tratar só uma delas é como o
 * create-character-v3 ficou quebrado por 14 submissões pagas.
 */
async function resolveTilePng(
  client: PixelLabClient,
  res: { readonly data: IsometricTileResponse },
  onLog?: (m: string) => void,
): Promise<{ b64: string; tileId?: string }> {
  const direct = extractBase64(res.data?.image);
  if (direct !== '') return { b64: direct };

  const tileId = res.data?.tile_id;
  const jobId = res.data?.background_job_id;
  if (!jobId || !tileId) {
    throw new Error(
      'a resposta do create-isometric-tile não trouxe nem image nem background_job_id + tile_id',
    );
  }

  const polled = await pollJob(client, jobId, { timeoutMs: 600_000 });
  if (!polled.ok) {
    throw new Error(
      polled.reason === 'timeout' ? 'tempo esgotado' : (polled.detail ?? 'falhou'),
    );
  }

  // O job concluído pode já trazer a imagem; se não, o tile é a fonte.
  const fromJob = extractBase64(
    (polled.job.last_response as IsometricTileResponse | undefined)?.image,
  );
  if (fromJob !== '') return { b64: fromJob, tileId };

  // GET /isometric-tiles/{id}: 423 = ainda processando (do spec).
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const tile = await client.request<IsometricTileResponse>(
        'GET',
        `/isometric-tiles/${encodeURIComponent(tileId)}`,
      );
      const b64 = extractBase64(tile.data?.image);
      if (b64 !== '') return { b64, tileId };
    } catch (err) {
      if (!(err instanceof PixelLabError) || err.status !== 423) throw err;
    }
    onLog?.(`[world-block] tile ${tileId} ainda processando — nova sondagem em 3s.`);
    await sleep(3_000);
  }
  throw new Error(
    `o tile ${tileId} não ficou disponível a tempo. A geração foi paga e o artefato existe: ` +
      'gerar de novo com a mesma configuração reaproveita sem cobrar.',
  );
}

// ---- execução

/**
 * Gera as quatro vistas de um bloco do mundo.
 *
 * Modo 'uniform': UMA chamada, e as quatro faces apontam para a mesma arte
 * (gravada quatro vezes em disco para que o map-builder não precise saber do
 * modo). Modo 'oriented': a face norte primeiro — o PNG dela vira
 * `color_image` das outras três, que então saem em paralelo. A ordem existe
 * por causa da paleta: sem uma primeira face pronta não há o que travar.
 */
export async function runWorldBlock(
  client: PixelLabClient,
  config: WorldBlockConfig,
  opts: {
    readonly assetsDir: string;
    readonly ledgerPath: string;
    readonly onLog?: ((m: string) => void) | undefined;
  },
): Promise<WorldBlockResult> {
  validate(config);

  const hash = inputHash(config);
  const base = baseSeed(config, hash);
  const shape = config.shape ?? 'block';
  const mode: FacingMode = config.facingMode ?? 'uniform';
  const lockPalette = config.lockPalette ?? true;

  const missing = BLOCK_FACINGS.filter(
    (f) => !existsSync(facePngPath(opts.assetsDir, hash, f)),
  );

  if (missing.length === 0) {
    opts.onLog?.(`[world-block] as 4 faces já estão em disco para hash=${hash}. Sem chamada à API.`);
  } else {
    // Uniforme paga UMA geração mesmo faltando as quatro faces.
    const calls = mode === 'uniform' ? 1 : missing.length;
    const single = estimateByArea(COST_TABLE['create-isometric-tile'], config.size * config.size);
    const estimate: CostEstimate = {
      low: single.low * calls,
      point: single.point * calls,
      high: single.high * calls,
      confidence: single.confidence,
    };
    logGuard(
      `create-isometric-tile (${calls}× world-block, modo ${mode}; preço estimado)`,
      guardFor(estimate, single.point),
      opts.onLog,
    );
  }

  await mkdir(blockDir(opts.assetsDir, hash), { recursive: true });

  let generated = 0;

  /** Uma submissão + gravação em disco. Devolve o b64 gravado. */
  const generateFace = async (
    facing: BlockFacing,
    seed: number,
    colorImageB64?: string,
  ): Promise<WorldBlockFace> => {
    const path = facePngPath(opts.assetsDir, hash, facing);
    if (existsSync(path)) {
      opts.onLog?.(`[world-block] face ${facing} já existe (${path}). Sem chamada.`);
      return {
        facing,
        seed,
        reused: false,
        pngB64: (await readFile(path)).toString('base64'),
      };
    }

    // Do spec: required = description + image_size. Todo o resto só entra
    // no request quando informado.
    const params: Record<string, unknown> = {
      description: mode === 'oriented' ? facingPrompt(config.description, facing) : config.description,
      image_size: { width: config.size, height: config.size },
      isometric_tile_shape: shape,
      seed,
    };
    if (config.tileUnitSize !== undefined) params['isometric_tile_size'] = config.tileUnitSize;
    if (config.outline !== undefined) params['outline'] = config.outline;
    if (config.shading !== undefined) params['shading'] = config.shading;
    if (config.detail !== undefined) params['detail'] = config.detail;
    if (config.textGuidanceScale !== undefined) {
      params['text_guidance_scale'] = config.textGuidanceScale;
    }
    if (colorImageB64 !== undefined) params['color_image'] = asBase64Image(colorImageB64);

    const res = await client.submit<IsometricTileResponse>('create-isometric-tile', params);
    generated += 1;

    // O dinheiro sai na submissão: tracking e ledger ANTES de resolver o PNG.
    if (typeof res.usage?.usd === 'number') trackSpend(res.usage.usd);
    const usage = res.usage;
    appendLedger(opts.ledgerPath, {
      at: new Date().toISOString(),
      endpoint: 'create-isometric-tile',
      lab: true,
      kind: 'world-block',
      hash,
      facing,
      mode,
      tileId: res.data?.tile_id ?? null,
      jobId: res.data?.background_job_id ?? null,
      usd: usage?.usd ?? null,
      generations: usage?.generations ?? null,
      unit: usage?.type ?? 'unknown',
    });

    const { b64, tileId } = await resolveTilePng(client, res, opts.onLog);
    // O /create-isometric-tile devolve PIXELS RGBA CRUS, não um arquivo PNG
    // (verificado contra a API em 2026-08-01: 48×48 chega com exatos 9216
    // bytes). Gravar isso como `.png` produz arquivo que nenhum navegador abre
    // — e a geração já foi paga. Ver server/png.ts.
    const png = toPngBytes(Buffer.from(b64, 'base64'), config.size, config.size);
    await writeFile(path, png);
    opts.onLog?.(`[world-block] face ${facing} → ${path} (seed ${seed}, ${png.length} bytes PNG)`);

    return {
      facing,
      seed,
      reused: false,
      pngB64: png.toString('base64'),
      ...(tileId ? { tileId } : {}),
      ...(usage
        ? {
            usage: {
              type: usage.type,
              usd: usage.usd ?? null,
              generations: usage.generations ?? null,
            },
          }
        : {}),
    };
  };

  let faces: WorldBlockFace[];

  if (mode === 'uniform') {
    // Uma arte, quatro vistas. A face norte é a canônica; as outras três são
    // cópias em disco para que o consumidor nunca precise saber do modo.
    const north = await generateFace('north', base);
    faces = [north];
    for (const facing of BLOCK_FACINGS.slice(1) as readonly BlockFacing[]) {
      const path = facePngPath(opts.assetsDir, hash, facing);
      if (!existsSync(path)) {
        await writeFile(path, Buffer.from(north.pngB64, 'base64'));
      }
      faces.push({
        facing,
        seed: north.seed,
        reused: true,
        pngB64: north.pngB64,
        ...(north.tileId ? { tileId: north.tileId } : {}),
      });
    }
  } else {
    // Orientado: norte primeiro (é dela que sai a paleta), depois as três em
    // paralelo. Sequenciar as três também seria correto e três vezes mais lento.
    const north = await generateFace('north', base);
    const palette = lockPalette ? north.pngB64 : undefined;
    const rest = await Promise.all(
      (BLOCK_FACINGS.slice(1) as readonly BlockFacing[]).map((facing, i) =>
        generateFace(facing, base + i + 1, palette),
      ),
    );
    faces = [north, ...rest];
  }

  const fromCache = generated === 0;

  // Manifesto por último: é ele que distingue "bloco completo" de "execução
  // interrompida" para readWorldBlockResult.
  if (!fromCache || !existsSync(manifestPath(opts.assetsDir, hash))) {
    const manifest: WorldBlockManifest = {
      version: 1,
      hash,
      facingMode: mode,
      size: config.size,
      shape,
      description: config.description,
      faces: faces.map((f) => ({
        facing: f.facing,
        seed: f.seed,
        reused: f.reused,
        ...(f.tileId ? { tileId: f.tileId } : {}),
        ...(f.usage ? { usage: f.usage } : {}),
      })),
    };
    await writeFile(
      manifestPath(opts.assetsDir, hash),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }

  return { hash, faces, fromCache, generated };
}
