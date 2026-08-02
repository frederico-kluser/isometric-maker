/**
 * Blocos do mundo — bancada do /create-isometric-tile (+ /create-character-v3).
 *
 * Gera as peças de terreno do editor: cubos isométricos já desenhados na
 * projeção do gênero, prontos para assentar no grid do map-builder.
 *
 * **Toda geração produz as QUATRO vistas da câmera** — norte, leste, sul e
 * oeste, cada uma com arte própria (ADR 0029). É o que faz a rotação do mundo
 * mostrar perspectivas diferentes do mesmo bloco: o map-builder escolhe a face
 * com `(facing + rotation) mod 4`, e quatro artes iguais fariam o giro parecer
 * a mesma figura deslizando.
 *
 * ## As duas técnicas (`technique`)
 *
 * - **`chained` — molde encadeado.** A norte nasce do molde do cubo
 *   (`cube-mould.ts`) como `init_image`; o RESULTADO dela vira o molde
 *   (`init_image` + `color_image`) das outras três, geradas com sufixo de
 *   face no prompt. 4 gerações de tile.
 * - **`rotated` — rotate via v3.** A mesma norte de tile vira `source.png` e
 *   vai como `reference_image` do `/create-character-v3`, que rotaciona para
 *   as 8 direções. Os pixels vêm de `GET /characters/{character_id}` — campo
 *   `rotation_urls`, 8 PNGs SEPARADOS, lidos por chave (não há o que extrair
 *   de GIF). As 8 ficam em `v3/`; as 4 vistas saem de `FACING_TO_V3_DIRECTION`
 *   e são reamostradas JUNTAS para o quadro canônico 48×53 (o v3 infla o
 *   canvas ~2× "for animation room", ADR 0028). 1 tile + 1 v3.
 *
 * As duas existem para o mesmo bloco poder ser comprado nas duas técnicas e
 * comparado lado a lado no catálogo.
 *
 * Decisões de API confirmadas no spec vendorizado
 * (tools/pixellab-pipeline/openapi/openapi-v2.json, capturado 2026-08-01):
 *   - POST /create-isometric-tile. required = description + image_size
 *     (16–64 por lado). isometric_tile_shape enum [thick tile|thin tile|block]
 *     (thin ~15% do canvas, thick ~25%, block ~50%); isometric_tile_size
 *     enum [16|32], default 16; text_guidance_scale default 8; init_image +
 *     init_image_strength (1–999, default 300); color_image força a paleta.
 *     A resposta tem DUAS formas: 200 com {image: {base64}} e 202 com
 *     {background_job_id, tile_id} — o status HTTP não diz se a chamada é
 *     assíncrona. GET /isometric-tiles/{tile_id} responde 423 enquanto
 *     processa, e é o caminho de volta GRATUITO a um tile já pago.
 *   - POST /create-character-v3. required = description; reference_image é
 *     Base64Image; image_size (V3OutputImageSize, 32–256, advisory); view
 *     enum [low top-down|high top-down|side]. ASSÍNCRONO: o job devolve só
 *     metadado — os pixels moram em GET /characters/{character_id}
 *     .rotation_urls, que é null até status 'completed' (character-detail.ts).
 *
 * ## O que a API NÃO oferece, e como isto contorna
 *
 * **`/create-isometric-tile` não tem parâmetro de orientação.** Não existe
 * `facing`, `direction` nem `rotation` no schema. Na técnica `chained` a
 * orientação é guiada por texto + o encadeamento do init_image; na `rotated`
 * ela vem do v3. Que qualquer das duas produza vistas coerentes é convenção
 * deste repositório, não capacidade verificada dos endpoints. O que é
 * verificado é o custo, e o guard informa antes de cada execução.
 *
 * ## Regras que valem para todo o módulo
 *   - Validação TOTAL antes de gastar (WorldBlockValidationError, zero API).
 *   - PNG em disco ANTES de qualquer outra coisa: o dinheiro sai na submissão.
 *   - Guard de orçamento (ADR 0012): estima, loga, nunca recusa.
 *   - Idempotência por artefato: arquivo existente = nenhuma chamada por ele.
 *     Derivar faces de `v3/` já baixado é de graça e não toca a rede.
 *   - Retomada NUNCA repaga o que já foi submetido: logo após cada submissão
 *     um stub com tile_id/character_id vai para o disco, e a re-execução
 *     tenta o caminho gratuito (GET do tile / do personagem) antes de
 *     submeter de novo (ADR 0023).
 *   - Seeds determinísticas: base = seed informada ou derivada do hash.
 *   - tile_id/character_id no ledger e no manifesto: o caminho de volta ao
 *     artefato pago (ADR 0023).
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
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
import { encodePngFromRgba, toPngBytes } from './png.ts';
import { BLOCK_GEOMETRY, blockImageSize, mouldBase64 } from './cube-mould.ts';
import { waitForCharacterRotations } from './character-detail.ts';
import {
  alphaBBox,
  decode,
  resampleNearest,
  unionRect,
  type Rect,
} from './frame-fit.ts';
import {
  BLOCK_FACINGS,
  BLOCK_TECHNIQUES,
  DIRECTIONS,
  FACING_LABELS,
  TILE_SHAPES,
  TILE_OUTLINES,
  TILE_SHADINGS,
  TILE_DETAILS,
  TILE_UNIT_SIZES,
  type BlockFacing,
  type BlockTechnique,
  type Direction,
  type TileShape,
  type TileOutline,
  type TileShading,
  type TileDetail,
  type TileUnitSize,
} from './model.ts';


// O vocabulário do endpoint mora em ./model.ts — módulo puro, que a tela
// também importa (world-block.ts arrasta node:crypto e node:fs).
export {
  BLOCK_FACINGS,
  BLOCK_TECHNIQUES,
  FACING_LABELS,
  TILE_SHAPES,
  TILE_OUTLINES,
  TILE_SHADINGS,
  TILE_DETAILS,
  TILE_UNIT_SIZES,
} from './model.ts';
export type {
  BlockFacing,
  BlockTechnique,
  TileShape,
  TileOutline,
  TileShading,
  TileDetail,
  TileUnitSize,
} from './model.ts';

// ---- contrato

export interface WorldBlockConfig {
  /** Prompt do bloco. Obrigatória. */
  readonly description: string;
  /** Altura ocupada no canvas. Default 'block' (o cubo). */
  readonly shape?: TileShape;
  /** isometric_tile_size do spec. Omitido usa o default do endpoint (16). */
  readonly tileUnitSize?: TileUnitSize;
  readonly outline?: TileOutline;
  readonly shading?: TileShading;
  readonly detail?: TileDetail;
  /** text_guidance_scale, 1–20. Omitido usa o default do endpoint (8). */
  readonly textGuidanceScale?: number;
  /** Seed base; ausente, deriva do hash. */
  readonly seed?: number;
  /** Como derivar as 4 vistas. Default 'chained'. */
  readonly technique?: BlockTechnique;
  /** `init_image_strength` do spec, 1–999. Omitido usa o default deste módulo. */
  readonly initImageStrength?: number;
}

/**
 * Força do `init_image` na geração de bloco.
 *
 * O default do endpoint é 300 numa faixa de 1 a 999. Aqui vai mais alto: o
 * molde (e depois a norte) precisa mandar na FORMA, e o prompt no material.
 * Com 300 o modelo trata a referência como sugestão e a aresta vertical volta
 * a variar de face para face.
 *
 * **Não verificado:** qual valor a PixelLab considera "forte". 480 é escolha
 * deste projeto, ajustável por configuração, não número lido de documentação.
 */
export const DEFAULT_INIT_IMAGE_STRENGTH = 480;

/**
 * Que direção do v3 mostra cada face do bloco.
 *
 * `north → south` é fixo: o `reference_image` do v3 é lido como a vista SUL
 * (sujeito de frente para a câmera), e a face norte do bloco é exatamente o
 * lado virado para a câmera na vista 0.
 *
 * O sentido leste/oeste é CONVENÇÃO NÃO VERIFICADA — as skills de rotação
 * avisam que o sinal do giro só se confirma olhando o resultado. Se as vistas
 * girarem ao contrário no mapa, trocar leste↔oeste AQUI corrige tudo: o
 * mapeamento fica gravado no manifesto (`v3Mapping`), e um POST com o
 * mapeamento novo rederiva as faces de `v3/` sem nenhuma chamada paga.
 */
export const FACING_TO_V3_DIRECTION: Readonly<Record<BlockFacing, Direction>> = {
  north: 'south',
  east: 'east',
  south: 'north',
  west: 'west',
};

/** Identidade do mapeamento vigente — comparada com a gravada no manifesto. */
const V3_MAPPING_ID = BLOCK_FACINGS.map((f) => FACING_TO_V3_DIRECTION[f]).join(',');

export interface WorldBlockFace {
  readonly facing: BlockFacing;
  /** Seed da chamada que produziu esta face. */
  readonly seed: number;
  /** PNG da face, b64 puro. */
  readonly pngB64: string;
  /** tile_id da PixelLab, quando a face veio de um tile assíncrono. */
  readonly tileId?: string;
  readonly usage?: {
    readonly type: string;
    readonly usd?: number | null;
    readonly generations?: number | null;
  };
}

export interface WorldBlockResult {
  readonly hash: string;
  readonly technique: BlockTechnique;
  /** Sempre as 4 faces, na ordem de BLOCK_FACINGS. */
  readonly faces: readonly WorldBlockFace[];
  /** true quando NENHUMA submissão saiu — tudo veio do disco. */
  readonly fromCache: boolean;
  /** Quantas submissões pagas saíram nesta execução (tiles + v3). */
  readonly generated: number;
}

interface IsometricTileResponse {
  readonly image?: unknown;
  readonly background_job_id?: string;
  readonly tile_id?: string;
  readonly usage?: Usage | null;
}

interface CreateCharacterV3Response {
  readonly background_job_id?: string;
  readonly character_id?: string;
}

// ---- erros nomeados (api.ts mapeia para HTTP 400)

export type WorldBlockErrorCode =
  | 'description-required'
  | 'description-too-long'
  | 'shape-enum'
  | 'tile-unit-size-enum'
  | 'outline-enum'
  | 'shading-enum'
  | 'detail-enum'
  | 'guidance-range'
  | 'seed-range'
  | 'technique-enum'
  | 'init-strength-range';

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
  if (config.technique !== undefined && !inEnum(config.technique, BLOCK_TECHNIQUES)) {
    throw new WorldBlockValidationError(
      'technique-enum',
      `technique inválida: "${String(config.technique)}". Opções: ${BLOCK_TECHNIQUES.join(', ')}.`,
    );
  }
  if (
    config.initImageStrength !== undefined &&
    (!Number.isInteger(config.initImageStrength) ||
      config.initImageStrength < 1 ||
      config.initImageStrength > 999)
  ) {
    throw new WorldBlockValidationError(
      'init-strength-range',
      `initImageStrength fora da faixa do spec: inteiro entre 1 e 999 ` +
        `(recebido ${String(config.initImageStrength)}).`,
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
 * as alavancas da técnica `chained` são a descrição e o encadeamento do
 * `init_image` da norte.
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

/**
 * sha256 de TODA a config.
 *
 * O marcador `views=4` distingue este formato do anterior (que tinha
 * `facingMode` e modos de geometria): um hash novo nunca colide com um cache
 * do formato antigo, e os blocos arquivados ficam arquivados. A técnica entra
 * no hash porque `chained` e `rotated` são artefatos diferentes do MESMO
 * prompt — é o que permite comprar os dois e comparar.
 *
 * `tileUnitSize` e `textGuidanceScale` são normalizados para os defaults do
 * endpoint (16 e 8, do spec): mandar o default explícito produz a MESMA arte
 * que omitir, e dois hashes para o mesmo artefato seria pagar duas vezes.
 */
function inputHash(config: WorldBlockConfig): string {
  const geom = BLOCK_GEOMETRY;
  const h = createHash('sha256');
  h.update(`desc=${config.description}`);
  h.update(`|shape=${config.shape ?? 'block'}`);
  h.update(`|tileUnit=${config.tileUnitSize ?? 16}`);
  h.update(`|outline=${config.outline ?? ''}`);
  h.update(`|shading=${config.shading ?? ''}`);
  h.update(`|detail=${config.detail ?? ''}`);
  h.update(`|guidance=${config.textGuidanceScale ?? 8}`);
  h.update(`|seed=${config.seed ?? ''}`);
  h.update(`|technique=${config.technique ?? 'chained'}`);
  h.update(`|initStrength=${config.initImageStrength ?? DEFAULT_INIT_IMAGE_STRENGTH}`);
  h.update(`|geom=${geom.tileWidth}x${geom.tileHeight}x${geom.cubeHeight}`);
  h.update('|views=4');
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

/** A norte de tile da técnica `rotated` — a fonte que o v3 rotaciona. */
function sourcePngPath(assetsDir: string, hash: string): string {
  return join(blockDir(assetsDir, hash), 'source.png');
}

/** Onde moram as 8 direções baixadas do v3. Rederivar as faces daqui é grátis. */
function v3PngPath(assetsDir: string, hash: string, direction: Direction): string {
  return join(blockDir(assetsDir, hash), 'v3', `${direction}.png`);
}

/**
 * Stub gravado logo após a submissão do v3 — o caminho de volta quando o
 * download falha DEPOIS de o dinheiro ter saído. A retomada lê daqui e busca
 * o personagem de graça em vez de submeter outro.
 */
function v3StubPath(assetsDir: string, hash: string): string {
  return join(blockDir(assetsDir, hash), 'v3', 'character.json');
}

/** Stub por tile pendente, pelo mesmo motivo. Apagado quando o PNG chega. */
function tileStubPath(pngPath: string): string {
  return `${pngPath}.pending.json`;
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

function scaleEstimate(single: CostEstimate, calls: number): CostEstimate {
  return {
    low: single.low * calls,
    point: single.point * calls,
    high: single.high * calls,
    confidence: single.confidence,
  };
}

// ---- manifesto

interface ManifestGeometry {
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly cubeHeight: number;
  readonly spriteWidth: number;
  readonly spriteHeight: number;
}

const MANIFEST_GEOMETRY: ManifestGeometry = {
  tileWidth: BLOCK_GEOMETRY.tileWidth,
  tileHeight: BLOCK_GEOMETRY.tileHeight,
  cubeHeight: BLOCK_GEOMETRY.cubeHeight,
  spriteWidth: BLOCK_GEOMETRY.spriteWidth,
  spriteHeight: BLOCK_GEOMETRY.spriteHeight,
};

interface ManifestUsage {
  readonly type: string;
  readonly usd?: number | null;
  readonly generations?: number | null;
}

interface ManifestFace {
  readonly facing: BlockFacing;
  readonly seed: number;
  readonly tileId?: string;
  readonly usage?: ManifestUsage;
}

/**
 * `version: 2` é o formato das quatro vistas sempre distintas. Manifesto de
 * versão anterior (blocos uniformes, canonização) não é lido: aquele catálogo
 * foi arquivado junto com a feature que o produzia.
 */
interface WorldBlockManifest {
  readonly version: 2;
  readonly hash: string;
  readonly technique: BlockTechnique;
  readonly shape: TileShape;
  readonly description: string;
  readonly geometry: ManifestGeometry;
  readonly faces: ReadonlyArray<ManifestFace>;
  /** Técnica `rotated`: a norte de tile que serviu de reference_image. */
  readonly source?: {
    readonly seed: number;
    readonly tileId?: string;
    readonly usage?: ManifestUsage;
  };
  /** Técnica `rotated`: o personagem v3 de onde saíram as 8 direções. */
  readonly character?: {
    readonly id: string;
    readonly jobId?: string;
    readonly seed: number;
    readonly usage?: ManifestUsage;
  };
  /** Técnica `rotated`: com que mapeamento facing→direção as faces foram derivadas. */
  readonly v3Mapping?: string;
}

async function readManifestFile(
  assetsDir: string,
  hash: string,
): Promise<WorldBlockManifest | null> {
  const path = manifestPath(assetsDir, hash);
  if (!existsSync(path)) return null;
  try {
    const manifest = JSON.parse(await readFile(path, 'utf8')) as WorldBlockManifest;
    if (manifest.version !== 2 || manifest.hash !== hash) return null;
    return manifest;
  } catch {
    return null;
  }
}

/**
 * Lê o bloco persistido de uma execução anterior, ou null quando não existe
 * (ou está incompleto). Os bytes vêm dos PNGs em disco.
 *
 * Bloco `rotated` cujo manifesto registra OUTRO mapeamento facing→direção é
 * tratado como incompleto de propósito: a rota então cai em runWorldBlock,
 * que rederiva as faces de `v3/` sem custo.
 */
export async function readWorldBlockResult(
  hash: string,
  assetsDir: string,
): Promise<WorldBlockResult | null> {
  const manifest = await readManifestFile(assetsDir, hash);
  if (!manifest || !Array.isArray(manifest.faces)) return null;
  if (manifest.technique === 'rotated' && manifest.v3Mapping !== V3_MAPPING_ID) return null;

  const faces: WorldBlockFace[] = [];
  for (const f of manifest.faces) {
    const png = facePngPath(assetsDir, hash, f.facing);
    if (!existsSync(png)) return null;
    faces.push({
      facing: f.facing,
      seed: f.seed,
      pngB64: (await readFile(png)).toString('base64'),
      ...(f.tileId ? { tileId: f.tileId } : {}),
      ...(f.usage ? { usage: f.usage } : {}),
    });
  }
  if (faces.length !== BLOCK_FACINGS.length) return null;
  return { hash, technique: manifest.technique, faces, fromCache: true, generated: 0 };
}

/** Uma entrada do catálogo lido por GET /api/world-blocks. */
export interface WorldBlockSummary {
  readonly hash: string;
  readonly description: string;
  readonly shape: TileShape;
  readonly technique: BlockTechnique;
  /** Projeção em que o bloco está desenhado. */
  readonly geometry: ManifestGeometry;
  /** Face → caminho público servido pela API do estúdio. */
  readonly faceUrls: Readonly<Record<BlockFacing, string>>;
}

/**
 * Catálogo dos blocos completos em disco — é daqui que o map-builder monta a
 * paleta. Só entram blocos com manifesto v2 E as quatro faces gravadas: um
 * bloco pela metade na paleta seria uma peça que falha ao ser colocada.
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
    const manifest = await readManifestFile(assetsDir, hash);
    if (!manifest) continue;
    if (!BLOCK_FACINGS.every((f) => existsSync(facePngPath(assetsDir, hash, f)))) continue;

    const faceUrls = Object.fromEntries(
      BLOCK_FACINGS.map((f) => [f, `/world-blocks/${hash}/${f}.png`]),
    ) as Record<BlockFacing, string>;

    out.push({
      hash,
      description: manifest.description,
      shape: manifest.shape,
      technique: manifest.technique,
      geometry: manifest.geometry ?? MANIFEST_GEOMETRY,
      faceUrls,
    });
  }

  // Ordem estável: o hash é determinístico, então a paleta não dança entre
  // recargas por causa da ordem do sistema de arquivos.
  return out.sort((a, b) => a.hash.localeCompare(b.hash));
}

// ---- recuperação do PNG do tile (as duas formas de resposta)

/**
 * Busca o PNG de um tile JÁ PAGO por id — o caminho de volta gratuito.
 * 423 = ainda processando (do spec); qualquer outro erro sobe.
 */
async function fetchTilePngById(
  client: PixelLabClient,
  tileId: string,
  onLog?: (m: string) => void,
): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const tile = await client.request<IsometricTileResponse>(
        'GET',
        `/isometric-tiles/${encodeURIComponent(tileId)}`,
      );
      const b64 = extractBase64(tile.data?.image);
      if (b64 !== '') return b64;
    } catch (err) {
      if (!(err instanceof PixelLabError) || err.status !== 423) throw err;
    }
    onLog?.(`[world-block] tile ${tileId} ainda processando — nova sondagem em 3s.`);
    await sleep(3_000);
  }
  throw new Error(
    `o tile ${tileId} não ficou disponível a tempo. A geração foi paga e o artefato existe: ` +
      'gerar de novo com a mesma configuração retoma por este tile_id, sem cobrar.',
  );
}

/**
 * Extrai o PNG de uma resposta do /create-isometric-tile.
 *
 * O spec documenta DUAS formas para o mesmo endpoint: 200 com o `image`
 * embutido e 202 com {background_job_id, tile_id}. O status HTTP não
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

  return { b64: await fetchTilePngById(client, tileId, onLog), tileId };
}

// ---- derivação das faces a partir de v3/

/**
 * Reamostra as 4 direções do v3 para o quadro CANÔNICO 48×53.
 *
 * O quadro é o mesmo contrato de pixel das faces `chained` (o bounding box do
 * cubo, iso-cube.ts) — um quadro quadrado de 53 desenharia o bloco a ~90 % da
 * célula no map-builder, que escala a textura por `tileWidth / textureWidth`.
 *
 * Recorte COMUM às quatro (escala igual entre vistas), fator UNIFORME (nunca
 * distorce), centrado na horizontal e assentado na BASE — é onde a silhueta
 * do cubo termina, e é o que faz a pilha alinhar.
 */
function deriveFacesFromV3(pngs: readonly Buffer[]): Buffer[] {
  const w = BLOCK_GEOMETRY.spriteWidth;
  const h = BLOCK_GEOMETRY.spriteHeight;
  const decoded = pngs.map((p) => decode(p));
  const boxes = decoded
    .map((img) => alphaBBox(img))
    .filter((r): r is Rect => r !== null);
  if (boxes.length === 0) {
    return decoded.map(() => encodePngFromRgba(Buffer.alloc(w * h * 4), w, h));
  }
  const rect = unionRect(boxes);
  const fit = Math.min(w / rect.width, h / rect.height);
  const innerW = Math.max(1, Math.round(rect.width * fit));
  const innerH = Math.max(1, Math.round(rect.height * fit));
  const offX = Math.floor((w - innerW) / 2);
  const offY = h - innerH;

  return decoded.map((img) => {
    const scaled = resampleNearest(img, rect, innerW, innerH);
    const out = Buffer.alloc(w * h * 4);
    for (let y = 0; y < innerH; y += 1) {
      for (let x = 0; x < innerW; x += 1) {
        scaled.rgba.copy(
          out,
          ((y + offY) * w + (x + offX)) * 4,
          (y * innerW + x) * 4,
          (y * innerW + x) * 4 + 4,
        );
      }
    }
    return encodePngFromRgba(out, w, h);
  });
}

// ---- execução

interface RunOpts {
  readonly assetsDir: string;
  readonly ledgerPath: string;
  readonly onLog?: ((m: string) => void) | undefined;
}

interface TileArtifact {
  readonly pngB64: string;
  readonly tileId?: string;
  readonly usage?: ManifestUsage;
}

interface TileStub {
  readonly tileId?: string | null;
  readonly jobId?: string | null;
  readonly seed: number;
}

interface V3Stub {
  readonly characterId: string;
  readonly jobId?: string | null;
  readonly seed: number;
}

/**
 * Gera as quatro vistas de um bloco do mundo, pela técnica configurada.
 * Ver o comentário do módulo para as duas cadeias.
 */
export async function runWorldBlock(
  client: PixelLabClient,
  config: WorldBlockConfig,
  opts: RunOpts,
): Promise<WorldBlockResult> {
  validate(config);

  const hash = inputHash(config);
  const base = baseSeed(config, hash);
  const shape = config.shape ?? 'block';
  const technique: BlockTechnique = config.technique ?? 'chained';
  const strength = config.initImageStrength ?? DEFAULT_INIT_IMAGE_STRENGTH;
  // Canvas do tile: o bounding box EXATO do cubo (48×53). O spec permite
  // width e height independentes de 16 a 64, e é o tamanho do molde que vai
  // como init_image — pedir outro canvas seria pedir para a referência não
  // caber.
  const imageSize = blockImageSize();

  // O manifesto anterior (se houver) é fundido no final: uma retomada parcial
  // não pode apagar tile_id/usage/character de artefatos que ela NÃO tocou —
  // é o caminho de volta ao artefato pago (ADR 0023).
  const prev = await readManifestFile(opts.assetsDir, hash);

  let generated = 0;
  /** Faces efetivamente reescritas nesta execução (as demais herdam do manifesto). */
  const fresh = new Set<BlockFacing>();

  /**
   * UMA submissão de tile + gravação em disco — com stub de retomada.
   *
   * O stub (`<face>.png.pending.json`) nasce logo após a submissão, com o
   * tile_id; se o processo morrer entre a cobrança e o writeFile, a próxima
   * execução encontra o stub e busca o tile de graça em vez de pagar outro.
   */
  const generateTile = async (
    path: string,
    prompt: string,
    seed: number,
    init: { readonly b64: string; readonly strength: number } | null,
    colorImageB64?: string,
  ): Promise<TileArtifact> => {
    const stubPath = tileStubPath(path);

    // Retomada: tile já pago, PNG nunca gravado. GET por id não custa nada.
    if (existsSync(stubPath)) {
      let stub: TileStub | null = null;
      try {
        stub = JSON.parse(await readFile(stubPath, 'utf8')) as TileStub;
      } catch {
        stub = null;
      }
      if (stub?.tileId) {
        opts.onLog?.(
          `[world-block] retomando tile já pago ${stub.tileId} — nenhuma submissão nova.`,
        );
        try {
          const b64 = await fetchTilePngById(client, stub.tileId, opts.onLog);
          const bruto = Buffer.from(b64, 'base64');
          const png = toPngBytes(bruto, imageSize.width, imageSize.height);
          await writeFile(path, png);
          await unlink(stubPath);
          return { pngB64: png.toString('base64'), tileId: stub.tileId };
        } catch (err) {
          opts.onLog?.(
            `[world-block] o tile pendente ${stub.tileId} não pôde ser recuperado ` +
              `(${err instanceof Error ? err.message : String(err)}). Submetendo de novo.`,
          );
        }
      }
      await unlink(stubPath).catch(() => {});
    }

    // Do spec: required = description + image_size. Todo o resto só entra
    // no request quando informado.
    const params: Record<string, unknown> = {
      description: prompt,
      image_size: imageSize,
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
    if (init !== null) {
      params['init_image'] = asBase64Image(init.b64);
      params['init_image_strength'] = init.strength;
    }
    if (colorImageB64 !== undefined) params['color_image'] = asBase64Image(colorImageB64);

    const res = await client.submit<IsometricTileResponse>('create-isometric-tile', params);
    generated += 1;

    // O dinheiro sai na submissão: tracking, ledger e stub ANTES de resolver
    // o PNG.
    if (typeof res.usage?.usd === 'number') trackSpend(res.usage.usd);
    const usage = res.usage;
    appendLedger(opts.ledgerPath, {
      at: new Date().toISOString(),
      endpoint: 'create-isometric-tile',
      lab: true,
      kind: 'world-block',
      hash,
      technique,
      seed,
      tileId: res.data?.tile_id ?? null,
      jobId: res.data?.background_job_id ?? null,
      usd: usage?.usd ?? null,
      generations: usage?.generations ?? null,
      unit: usage?.type ?? 'unknown',
    });
    const stub: TileStub = {
      tileId: res.data?.tile_id ?? null,
      jobId: res.data?.background_job_id ?? null,
      seed,
    };
    await writeFile(stubPath, `${JSON.stringify(stub)}\n`);

    const { b64, tileId } = await resolveTilePng(client, res, opts.onLog);
    // O /create-isometric-tile devolve PIXELS RGBA CRUS, não um arquivo PNG
    // (verificado contra a API em 2026-08-01: 48×48 chega com exatos 9216
    // bytes). Gravar isso como `.png` produz arquivo que nenhum navegador abre
    // — e a geração já foi paga. Ver server/png.ts.
    const bruto = Buffer.from(b64, 'base64');
    const png = toPngBytes(bruto, imageSize.width, imageSize.height);
    await writeFile(path, png);
    await unlink(stubPath).catch(() => {});
    opts.onLog?.(`[world-block] tile → ${path} (seed ${seed}, ${png.length} bytes PNG)`);

    return {
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

  await mkdir(blockDir(opts.assetsDir, hash), { recursive: true });

  const missingFaces = BLOCK_FACINGS.filter(
    (f) => !existsSync(facePngPath(opts.assetsDir, hash, f)),
  );

  const tileEstimate = estimateByArea(
    COST_TABLE['create-isometric-tile'],
    imageSize.width * imageSize.height,
  );

  let faces: WorldBlockFace[];
  let sourceRecord: WorldBlockManifest['source'];
  let characterRecord: WorldBlockManifest['character'];
  let manifestDirty = false;

  if (technique === 'chained') {
    // ---- molde encadeado: norte nasce do molde; o resultado é o molde das outras.
    const northPath = facePngPath(opts.assetsDir, hash, 'north');
    const sisters = BLOCK_FACINGS.slice(1) as readonly BlockFacing[];

    if (missingFaces.length === 0) {
      opts.onLog?.(
        `[world-block] as 4 faces já estão em disco para hash=${hash}. Sem chamada à API.`,
      );
    } else {
      logGuard(
        `create-isometric-tile (${missingFaces.length}× world-block, molde encadeado; preço estimado)`,
        guardFor(scaleEstimate(tileEstimate, missingFaces.length), tileEstimate.point),
        opts.onLog,
      );
      if (
        !existsSync(northPath) &&
        sisters.some((f) => existsSync(facePngPath(opts.assetsDir, hash, f)))
      ) {
        // Regenerar as irmãs junto custaria 3 gerações sem ninguém pedir —
        // dinheiro não sai por decisão implícita. Fica o aviso.
        opts.onLog?.(
          '[world-block] aviso: north.png sumiu mas há irmãs em disco. A norte será ' +
            'regenerada e as irmãs continuam encadeadas à norte ANTERIOR — o bloco pode ' +
            'ficar incoerente. Para refazê-lo por inteiro, apague as quatro faces.',
        );
      }
    }

    const readFace = async (facing: BlockFacing, seed: number): Promise<WorldBlockFace> => ({
      facing,
      seed,
      pngB64: (await readFile(facePngPath(opts.assetsDir, hash, facing))).toString('base64'),
    });

    // Norte primeiro: é ela que vira o molde das outras três.
    let north: WorldBlockFace;
    if (existsSync(northPath)) {
      opts.onLog?.(`[world-block] face norte já existe. Sem chamada.`);
      north = await readFace('north', base);
    } else {
      const art = await generateTile(
        northPath,
        facingPrompt(config.description, 'north'),
        base,
        { b64: mouldBase64(), strength },
      );
      fresh.add('north');
      north = {
        facing: 'north',
        seed: base,
        pngB64: art.pngB64,
        ...(art.tileId ? { tileId: art.tileId } : {}),
        ...(art.usage ? { usage: art.usage } : {}),
      };
    }

    // As outras três em paralelo, com a NORTE como init_image e color_image.
    // Sequenciar também seria correto e três vezes mais lento.
    const rest = await Promise.all(
      sisters.map(async (facing, i): Promise<WorldBlockFace> => {
        const seed = base + i + 1;
        const path = facePngPath(opts.assetsDir, hash, facing);
        if (existsSync(path)) {
          opts.onLog?.(`[world-block] face ${FACING_LABELS[facing]} já existe. Sem chamada.`);
          return readFace(facing, seed);
        }
        const art = await generateTile(
          path,
          facingPrompt(config.description, facing),
          seed,
          { b64: north.pngB64, strength },
          north.pngB64,
        );
        fresh.add(facing);
        return {
          facing,
          seed,
          pngB64: art.pngB64,
          ...(art.tileId ? { tileId: art.tileId } : {}),
          ...(art.usage ? { usage: art.usage } : {}),
        };
      }),
    );
    faces = [north, ...rest];
  } else {
    // ---- rotate via v3: 1 tile (source) + 1 v3 (8 direções) + derivação local.
    const sourcePath = sourcePngPath(opts.assetsDir, hash);
    const stubPath = v3StubPath(opts.assetsDir, hash);
    const neededDirections = BLOCK_FACINGS.map((f) => FACING_TO_V3_DIRECTION[f]);
    const missingV3 = neededDirections.filter(
      (d) => !existsSync(v3PngPath(opts.assetsDir, hash, d)),
    );

    // Rederivar também quando o mapeamento mudou desde a última derivação —
    // é o que torna real a promessa de "trocar leste↔oeste corrige tudo".
    const mappingChanged = prev !== null && prev.v3Mapping !== V3_MAPPING_ID;
    const needDerive = missingFaces.length > 0 || mappingChanged;

    let v3Stub: V3Stub | null = null;
    if (existsSync(stubPath)) {
      try {
        const parsed = JSON.parse(await readFile(stubPath, 'utf8')) as V3Stub;
        if (typeof parsed.characterId === 'string' && parsed.characterId !== '') {
          v3Stub = parsed;
        }
      } catch {
        v3Stub = null;
      }
    }
    // O manifesto anterior também é caminho de volta: um personagem já pago
    // reentrega rotation_urls de graça, mesmo sem stub.
    if (v3Stub === null && prev?.character?.id) {
      v3Stub = {
        characterId: prev.character.id,
        jobId: prev.character.jobId ?? null,
        seed: prev.character.seed,
      };
    }

    const needFetchV3 = needDerive && missingV3.length > 0;
    // Submissão NOVA só quando não há personagem pago para retomar.
    const needSubmitV3 = needFetchV3 && v3Stub === null;
    // A source só existe para alimentar uma submissão nova do v3. Gerar uma
    // source que ninguém vai consumir seria custo surpresa.
    const needTile = needSubmitV3 && !existsSync(sourcePath);

    if (needTile) {
      logGuard(
        'create-isometric-tile (1× world-block source; preço estimado)',
        guardFor(tileEstimate, tileEstimate.point),
        opts.onLog,
      );
    }
    if (needSubmitV3) {
      const v3Estimate = estimateByArea(
        COST_TABLE['create-character-v3'],
        imageSize.width * imageSize.height,
      );
      logGuard(
        'create-character-v3 (8 direções a partir da source; preço estimado)',
        guardFor(v3Estimate, v3Estimate.point),
        opts.onLog,
      );
    }
    if (!needDerive) {
      opts.onLog?.(
        `[world-block] as 4 faces já estão em disco para hash=${hash}. Sem chamada à API.`,
      );
    }

    const v3Seed = v3Stub?.seed ?? base + 1;

    if (needFetchV3) {
      let characterId: string;
      let jobId: string | null | undefined;
      let usage: Usage | null | undefined;

      if (needSubmitV3) {
        // 1. A source: a norte de tile, com o molde como init_image.
        let sourceB64: string;
        if (needTile) {
          const art = await generateTile(
            sourcePath,
            facingPrompt(config.description, 'north'),
            base,
            { b64: mouldBase64(), strength },
          );
          sourceB64 = art.pngB64;
          sourceRecord = {
            seed: base,
            ...(art.tileId ? { tileId: art.tileId } : {}),
            ...(art.usage ? { usage: art.usage } : {}),
          };
          manifestDirty = true;
        } else {
          opts.onLog?.('[world-block] source de tile já existe. Sem chamada.');
          sourceB64 = (await readFile(sourcePath)).toString('base64');
        }

        // 2. As 8 direções do v3, submetidas UMA vez.
        const body: Record<string, unknown> = {
          description: config.description,
          reference_image: asBase64Image(sourceB64),
          // Padrão do projeto (ADR 0005/0015): terreno e personagens na MESMA
          // perspectiva. O default do endpoint é outro — omitir mudaria a vista.
          view: 'low top-down',
          no_background: true,
          seed: v3Seed,
          image_size: { width: imageSize.width, height: imageSize.height },
        };
        const res = await client.submit<CreateCharacterV3Response>('create-character-v3', body);
        generated += 1;

        if (typeof res.usage?.usd === 'number') trackSpend(res.usage.usd);
        usage = res.usage;
        const cid = res.data?.character_id;
        jobId = res.data?.background_job_id;
        // Identificadores remotos no ledger E num stub em disco ANTES do poll:
        // sem eles, uma geração cobrada cujo download falhou é irrecuperável —
        // e a retomada pagaria outra.
        appendLedger(opts.ledgerPath, {
          at: new Date().toISOString(),
          endpoint: 'create-character-v3',
          lab: true,
          kind: 'world-block',
          hash,
          technique,
          seed: v3Seed,
          remoteId: cid ?? null,
          jobId: jobId ?? null,
          usd: usage?.usd ?? null,
          generations: usage?.generations ?? null,
          unit: usage?.type ?? 'unknown',
        });

        if (!jobId) throw new Error('o create-character-v3 não devolveu background_job_id');
        if (!cid) throw new Error('o create-character-v3 não devolveu character_id');
        characterId = cid;

        await mkdir(join(blockDir(opts.assetsDir, hash), 'v3'), { recursive: true });
        const stub: V3Stub = { characterId, jobId, seed: v3Seed };
        await writeFile(stubPath, `${JSON.stringify(stub)}\n`);

        const polled = await pollJob(client, jobId, { timeoutMs: 900_000 });
        if (!polled.ok) {
          throw new Error(
            polled.reason === 'timeout' ? 'tempo esgotado' : (polled.detail ?? 'falhou'),
          );
        }
      } else {
        // Retomada: o v3 já foi pago; buscar o personagem não custa nada.
        characterId = v3Stub!.characterId;
        jobId = v3Stub!.jobId;
        opts.onLog?.(
          `[world-block] retomando personagem já pago ${characterId} — nenhuma submissão nova.`,
        );
      }

      // O job concluído do v3 traz só metadado; os pixels moram em
      // GET /characters/{character_id}.rotation_urls (character-detail.ts).
      const detail = await waitForCharacterRotations(client, characterId, {
        onLog: opts.onLog,
      });
      const urls = detail.rotation_urls ?? {};

      // Leitura POR CHAVE, nunca por índice: três ordenações de direção
      // convivem no spec (ver server/frames.ts). Chave desconhecida é erro.
      for (const key of Object.keys(urls)) {
        if (!(DIRECTIONS as readonly string[]).includes(key)) {
          throw new Error(
            `direção desconhecida em rotation_urls: "${key}". Válidas: ${DIRECTIONS.join(', ')}.`,
          );
        }
      }

      // As 4 vistas são obrigatórias. As outras 4 são pagas do mesmo jeito e
      // ficam em disco quando vierem — mas uma falha NELAS não derruba a
      // execução: derrubar aqui jogaria fora o v3 inteiro por uma direção que
      // as vistas nem usam.
      await mkdir(join(blockDir(opts.assetsDir, hash), 'v3'), { recursive: true });
      for (const direction of DIRECTIONS) {
        const needed = neededDirections.includes(direction);
        const url = urls[direction];
        if (typeof url !== 'string' || url === '') {
          if (needed) {
            throw new Error(
              `a direção "${direction}" está ausente de rotation_urls e é uma das 4 vistas do bloco.`,
            );
          }
          opts.onLog?.(
            `[world-block] aviso: direção ${direction} ausente de rotation_urls (não é usada nas vistas).`,
          );
          continue;
        }
        try {
          const download = await fetch(url);
          if (!download.ok) throw new Error(`HTTP ${download.status}`);
          await writeFile(
            v3PngPath(opts.assetsDir, hash, direction),
            Buffer.from(await download.arrayBuffer()),
          );
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          if (needed) {
            throw new Error(`download da direção ${direction} falhou: ${reason}`);
          }
          opts.onLog?.(
            `[world-block] aviso: download da direção ${direction} falhou (${reason}) — ` +
              'ela não é usada nas vistas; seguindo.',
          );
        }
      }
      opts.onLog?.(`[world-block] direções do personagem ${characterId} em v3/.`);
      // Na retomada o usage da submissão original mora no manifesto anterior —
      // sobrescrevê-lo com um registro sem usage apagaria o que foi pago.
      const prevUsage =
        prev?.character?.id === characterId ? prev.character.usage : undefined;
      characterRecord = {
        id: characterId,
        ...(jobId ? { jobId } : {}),
        seed: v3Seed,
        ...(usage
          ? {
              usage: {
                type: usage.type,
                usd: usage.usd ?? null,
                generations: usage.generations ?? null,
              },
            }
          : prevUsage
            ? { usage: prevUsage }
            : {}),
      };
      manifestDirty = true;
      // O stub cumpriu o papel: as 8 direções (ou as 4 necessárias) estão em
      // disco e o manifesto vai registrar o personagem.
      await unlink(stubPath).catch(() => {});
    }

    // 3. Derivação local (grátis): as 4 vistas saem de v3/, reamostradas
    //    JUNTAS para o quadro canônico 48×53.
    if (needDerive) {
      if (mappingChanged) {
        opts.onLog?.(
          '[world-block] o mapeamento facing→direção mudou — rederivando as 4 faces de v3/, sem custo.',
        );
      }
      const pngs = await Promise.all(
        neededDirections.map((d) => readFile(v3PngPath(opts.assetsDir, hash, d))),
      );
      const derived = deriveFacesFromV3(pngs);
      await Promise.all(
        BLOCK_FACINGS.map((facing, i) =>
          writeFile(facePngPath(opts.assetsDir, hash, facing), derived[i]!),
        ),
      );
      for (const facing of BLOCK_FACINGS) fresh.add(facing);
      manifestDirty = true;
      opts.onLog?.(
        `[world-block] 4 faces derivadas de v3/ (quadro ${BLOCK_GEOMETRY.spriteWidth}×${BLOCK_GEOMETRY.spriteHeight}, recorte comum).`,
      );
    }

    faces = await Promise.all(
      BLOCK_FACINGS.map(async (facing): Promise<WorldBlockFace> => ({
        facing,
        seed: v3Seed,
        pngB64: (await readFile(facePngPath(opts.assetsDir, hash, facing))).toString('base64'),
      })),
    );
  }

  const fromCache = generated === 0;

  // Manifesto por último: é ele que distingue "bloco completo" de "execução
  // interrompida" para readWorldBlockResult. A escrita FUNDE com o manifesto
  // anterior: face que esta execução não regenerou herda tileId/usage/seed de
  // antes, e source/character nunca somem por uma retomada parcial.
  if (!fromCache || manifestDirty || prev === null) {
    const mergedFaces: ManifestFace[] = faces.map((f) => {
      const prevFace = prev?.faces?.find?.((p) => p.facing === f.facing);
      if (!fresh.has(f.facing) && prevFace) return prevFace;
      return {
        facing: f.facing,
        seed: f.seed,
        ...(f.tileId ? { tileId: f.tileId } : {}),
        ...(f.usage ? { usage: f.usage } : {}),
      };
    });
    const mergedSource = sourceRecord ?? prev?.source;
    const mergedCharacter = characterRecord ?? prev?.character;
    const manifest: WorldBlockManifest = {
      version: 2,
      hash,
      technique,
      shape,
      description: config.description,
      geometry: MANIFEST_GEOMETRY,
      faces: mergedFaces,
      ...(mergedSource ? { source: mergedSource } : {}),
      ...(mergedCharacter ? { character: mergedCharacter } : {}),
      ...(technique === 'rotated' ? { v3Mapping: V3_MAPPING_ID } : {}),
    };
    await writeFile(
      manifestPath(opts.assetsDir, hash),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }

  return { hash, technique, faces, fromCache, generated };
}
