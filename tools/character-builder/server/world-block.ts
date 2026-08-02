/**
 * Blocos do mundo — bancada do /create-isometric-tile (+ /create-character-v3,
 * + /animate-with-text-v3).
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
 * ## As três técnicas (`technique`)
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
 * - **`texture` — cubo animado (ADR 0032).** UM cubo pixel-art nasce do molde
 *   (`cube-mould.ts` como `init_image` forte 480) via `/create-isometric-tile`,
 *   com o prompt pedindo para respeitar a forma e o tamanho exatos da
 *   referência; a ação da animação vem de LLM (ou fallback determinístico); o
 *   cubo vira o `first_frame` do `/animate-with-text-v3`, que anima todos os
 *   frames num job só (não por direção). A spritesheet empacota os frames e o
 *   manifesto é v3. 1 tile + 1 animate-with-text-v3.
 *
 * As três existem para o mesmo bloco poder ser comprado nas três técnicas e
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
 *   - POST /animate-with-text-v3. required = first_frame + action; frame_count
 *     4–16 par, budget de pixels width×height×frame_count ≤ 524288; todos os
 *     frames num job só (não por direção). ASSÍNCRONO mas responde 200 com
 *     {background_job_id}; os frames moram em `last_response.images[]`.
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
import { encodePngFromRgba, isPng } from './png.ts';
import { BLOCK_GEOMETRY, apiImageSize, blockImageSize, mouldBase64 } from './cube-mould.ts';
import { waitForCharacterRotations } from './character-detail.ts';
import {
  alphaBBox,
  decode,
  resampleNearest,
  unionRect,
  type Rect,
} from './frame-fit.ts';
import {
  ANIMATION_FRAME_COUNTS,
  BLOCK_FACINGS,
  BLOCK_TECHNIQUES,
  DEFAULT_BLOCK_ANIMATION_FPS,
  DIRECTIONS,
  FACING_LABELS,
  TILE_SHAPES,
  TILE_OUTLINES,
  TILE_SHADINGS,
  TILE_DETAILS,
  TILE_UNIT_SIZES,
  type AnimationFrameCount,
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
  /** Como derivar a arte do bloco. Default 'chained'. */
  readonly technique?: BlockTechnique;
  /** `init_image_strength` do spec, 1–999. Omitido usa o default deste módulo. */
  readonly initImageStrength?: number;
  /**
   * Número de frames da animação (técnica 'texture' apenas).
   * 4, 8 ou 16. Default 8. Tem que ser par — é o que o /animate-with-text-v3 aceita.
   */
  readonly frameCount?: AnimationFrameCount;
  /**
   * Frames por segundo para playback no editor.
   * Post-processing apenas — nunca custa nada. Default 8.
   */
  readonly fps?: number;
  /**
   * Ação da animação (técnica 'texture' apenas).
   * Texto livre descrevendo o movimento, ex.: "water rippling gently".
   * Ausente: gerado via LLM a partir de `description`.
   */
  readonly action?: string;
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
  | 'init-strength-range'
  | 'frame-count-enum'
  | 'fps-range';

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
  if (
    config.frameCount !== undefined &&
    !(ANIMATION_FRAME_COUNTS as readonly number[]).includes(config.frameCount)
  ) {
    throw new WorldBlockValidationError(
      'frame-count-enum',
      `frameCount inválido: ${String(config.frameCount)}. O spec aceita ${ANIMATION_FRAME_COUNTS.join(', ')}.`,
    );
  }
  if (
    config.fps !== undefined &&
    (!Number.isInteger(config.fps) || config.fps < 1 || config.fps > 60)
  ) {
    throw new WorldBlockValidationError(
      'fps-range',
      `fps fora da faixa: inteiro entre 1 e 60 (recebido ${String(config.fps)}).`,
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

/**
 * Prompt do cubo base da técnica 'texture'.
 *
 * O `/create-isometric-tile` não tem parâmetro de orientação nem de vista (ver
 * o header do módulo) — o que descreve a forma são as palavras. O molde entra
 * como `init_image`, a referência de forma e tamanho, e o prompt pede
 * explicitamente para respeitá-la, na vista do projeto ('low top-down',
 * ADR 0005/0015) — nunca a 'high top-down' do default do endpoint.
 */
export function cubePrompt(description: string): string {
  return `${description}, pixel art cube, isometric block, matching the exact shape and proportions of the reference image, low top-down view`;
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
  const technique = config.technique ?? 'chained';
  const h = createHash('sha256');
  h.update(`desc=${config.description}`);
  h.update(`|technique=${technique}`);
  h.update(`|seed=${config.seed ?? ''}`);
  h.update(`|geom=${geom.tileWidth}x${geom.tileHeight}x${geom.cubeHeight}`);

  if (technique === 'texture') {
    // A técnica 'texture' inclui frameCount, fps e action — o que define a
    // animação. O cubo base também vem do /create-isometric-tile, mas com
    // shape 'block' FIXO e nenhum campo de estilo: mandar outline/shading/
    // detail/guidance variaria o artefato sem mudar o hash — proibido.
    h.update(`|frameCount=${config.frameCount ?? 8}`);
    h.update(`|fps=${config.fps ?? DEFAULT_BLOCK_ANIMATION_FPS}`);
    h.update(`|action=${config.action ?? ''}`);
    h.update('|views=1');
  } else {
    h.update(`|shape=${config.shape ?? 'block'}`);
    h.update(`|tileUnit=${config.tileUnitSize ?? 16}`);
    h.update(`|outline=${config.outline ?? ''}`);
    h.update(`|shading=${config.shading ?? ''}`);
    h.update(`|detail=${config.detail ?? ''}`);
    h.update(`|guidance=${config.textGuidanceScale ?? 8}`);
    h.update(`|initStrength=${config.initImageStrength ?? DEFAULT_INIT_IMAGE_STRENGTH}`);
    h.update('|views=4');
  }
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

// ---- paths da técnica 'texture' (ADR 0032)

/** O cubo base (pixel-art, 48×53 canônico) que vai ser animado. */
function baseImagePath(assetsDir: string, hash: string): string {
  return join(blockDir(assetsDir, hash), 'base.png');
}

/** Spritesheet empacotada dos frames da animação. */
function spritesheetPath(assetsDir: string, hash: string): string {
  return join(blockDir(assetsDir, hash), 'spritesheet.png');
}

/** Atlas JSON (formato TexturePacker/PixiJS) para a spritesheet. */
function atlasPath(assetsDir: string, hash: string): string {
  return join(blockDir(assetsDir, hash), 'spritesheet.json');
}

/** Sidecar com metadados da animação (fps, frameCount, action). */
function animSidecarPath(assetsDir: string, hash: string): string {
  return join(blockDir(assetsDir, hash), 'animation.json');
}

/** Stub da submissão do animate-with-text-v3. */
function animStubPath(assetsDir: string, hash: string): string {
  return join(blockDir(assetsDir, hash), 'animation.pending.json');
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
interface WorldBlockManifestV2 {
  readonly version: 2;
  readonly hash: string;
  readonly technique: 'chained' | 'rotated';
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

/**
 * Manifesto v3 — técnica 'texture' (ADR 0032).
 *
 * UMA textura animada, sem faces por vista. A spritesheet contém todos os
 * frames; o sidecar `animation.json` tem fps e frameCount.
 */
interface WorldBlockManifestV3 {
  readonly version: 3;
  readonly hash: string;
  readonly technique: 'texture';
  readonly description: string;
  readonly geometry: ManifestGeometry;
  /** Ação da animação — o texto que foi enviado ao /animate-with-text-v3. */
  readonly action: string;
  /** Texto gerado pelo LLM (quando `action` não foi fornecido). */
  readonly llmGenerated?: boolean;
  /** Número de frames. */
  readonly frameCount: number;
  /** Frames por segundo. */
  readonly fps: number;
  /** O cubo base (pixel-art) que serviu de first_frame. */
  readonly base?: {
    readonly seed: number;
    readonly usage?: ManifestUsage;
  };
  /** A submissão do animate-with-text-v3. */
  readonly animation?: {
    readonly jobId?: string;
    readonly seed: number;
    readonly usage?: ManifestUsage;
  };
}

type WorldBlockManifest = WorldBlockManifestV2 | WorldBlockManifestV3;

async function readManifestFile(
  assetsDir: string,
  hash: string,
): Promise<WorldBlockManifest | null> {
  const path = manifestPath(assetsDir, hash);
  if (!existsSync(path)) return null;
  try {
    const manifest = JSON.parse(await readFile(path, 'utf8')) as WorldBlockManifest;
    if (!((manifest.version === 2 || manifest.version === 3) && manifest.hash === hash)) return null;
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
  if (!manifest) return null;

  // v3: textura animada — faces ficam vazias, a spritesheet é o artefato.
  if (manifest.version === 3 && manifest.technique === 'texture') {
    if (!existsSync(spritesheetPath(assetsDir, hash))) return null;
    return {
      hash,
      technique: 'texture',
      faces: [],
      fromCache: true,
      generated: 0,
    };
  }

  // v2: 4 faces
  if (manifest.version === 2 && Array.isArray(manifest.faces)) {
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

  return null;
}

/** Uma entrada do catálogo lido por GET /api/world-blocks. */
export interface WorldBlockSummary {
  readonly hash: string;
  readonly description: string;
  readonly shape: TileShape;
  readonly technique: BlockTechnique;
  /** Projeção em que o bloco está desenhado. */
  readonly geometry: ManifestGeometry;
  /** Face → caminho público (v2: 4 faces). Ausente em v3 (texture). */
  readonly faceUrls?: Readonly<Record<BlockFacing, string>>;
  /** Caminho da spritesheet (v3: texture). Ausente em v2. */
  readonly spritesheetUrl?: string;
  /** Caminho do sidecar de animação (v3: texture). */
  readonly animationUrl?: string;
  /** Número de frames (v3: texture). */
  readonly frameCount?: number;
  /** FPS da animação (v3: texture). */
  readonly fps?: number;
}

/**
 * Catálogo dos blocos completos em disco — é daqui que o map-builder monta a
 * paleta. Só entram blocos com manifesto completo: v2 com as 4 faces ou v3 com
 * a spritesheet.
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

    if (manifest.version === 3 && manifest.technique === 'texture') {
      if (!existsSync(spritesheetPath(assetsDir, hash))) continue;
      out.push({
        hash,
        description: manifest.description,
        shape: 'block', // o cubo base da textura animada é sempre 'block'
        technique: 'texture',
        geometry: MANIFEST_GEOMETRY,
        spritesheetUrl: `/world-blocks/${hash}/spritesheet.png`,
        animationUrl: `/world-blocks/${hash}/animation.json`,
        frameCount: manifest.frameCount,
        fps: manifest.fps,
      });
      continue;
    }

    if (manifest.version === 2) {
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
  }

  // Ordem estável: o hash é determinístico, então a paleta não dança entre
  // recargas por causa da ordem do sistema de arquivos.
  return out.sort((a, b) => a.hash.localeCompare(b.hash));
}

// ---- canvas da API × quadro canônico

interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Acolchoa um PNG no canvas da API e devolve os pixels como **RGBA CRU** em
 * base64 — colunas centradas, conteúdo assentado na BASE, linhas extras como
 * céu transparente no topo.
 *
 * RGBA cru porque é o que o backend consome: o traceback de um job falho
 * (2026-08-01) mostra `Image.frombytes(mode="RGBA", size=image_size)` direto
 * sobre o base64 do `init_image` — "Expected image of size 48x56 but got
 * another size" é um PNG sendo lido como bytes crus. O endpoint de tile é
 * RGBA cru nas DUAS direções (a saída já era, ver png.ts); nenhuma geração
 * bem-sucedida jamais tinha mandado `init_image`, então o contrato de entrada
 * nunca tinha sido exercitado. O spec (`Base64Image`) não diz nada disso.
 */
export function padPngToApiCanvas(pngB64: string, api: ImageSize): string {
  const img = decode(Buffer.from(pngB64, 'base64'));
  if (img.width > api.width || img.height > api.height) {
    throw new Error(
      `imagem ${img.width}×${img.height} não cabe no canvas da API ${api.width}×${api.height}.`,
    );
  }
  const out = Buffer.alloc(api.width * api.height * 4);
  const offX = Math.floor((api.width - img.width) / 2);
  const offY = api.height - img.height;
  for (let y = 0; y < img.height; y += 1) {
    const src = y * img.width * 4;
    img.rgba.copy(out, ((y + offY) * api.width + offX) * 4, src, src + img.width * 4);
  }
  return out.toString('base64');
}

/**
 * A volta: recorta os bytes vindos da API para o quadro canônico — a inversa
 * exata do acolchoamento (mesmo offset de base e de centro).
 *
 * O endpoint devolve pixels RGBA CRUS no canvas da API (ver png.ts). Um PNG
 * de outro tamanho passa direto, como sempre passou: recortar só faz sentido
 * sobre o canvas que nós mesmos acolchoamos.
 */
export function apiBytesToCanonicalPng(
  bruto: Buffer,
  api: ImageSize,
  frame: ImageSize,
): Buffer {
  let img: { width: number; height: number; rgba: Buffer };
  if (isPng(bruto)) {
    const d = decode(bruto);
    if (d.width !== api.width || d.height !== api.height) return bruto;
    img = d;
  } else {
    if (bruto.length !== api.width * api.height * 4) {
      // Não é PNG nem RGBA do canvas pedido: deixa o codificador canônico
      // levantar o erro nomeado de tamanho (RgbaSizeError), com a conta certa.
      return encodePngFromRgba(bruto, api.width, api.height);
    }
    img = { width: api.width, height: api.height, rgba: bruto };
  }
  if (img.width === frame.width && img.height === frame.height) {
    return encodePngFromRgba(img.rgba, frame.width, frame.height);
  }
  const offX = Math.floor((img.width - frame.width) / 2);
  const offY = img.height - frame.height;
  const out = Buffer.alloc(frame.width * frame.height * 4);
  for (let y = 0; y < frame.height; y += 1) {
    const src = ((y + offY) * img.width + offX) * 4;
    img.rgba.copy(out, y * frame.width * 4, src, src + frame.width * 4);
  }
  return encodePngFromRgba(out, frame.width, frame.height);
}

// ---- recuperação do PNG do tile (as duas formas de resposta)

interface BackgroundJobStatus {
  readonly status?: string;
  readonly last_response?: { readonly detail?: string } | null;
}

/**
 * Busca o PNG de um tile JÁ PAGO por id — o caminho de volta gratuito.
 * 423 = ainda processando (do spec); qualquer outro erro sobe.
 *
 * Com `jobId`, cada 423 é acompanhado de um GET (grátis) do job: um tile cujo
 * job FALHOU responde 423 para sempre, e sondar às cegas custava 2 minutos de
 * espera e uma resubmissão sem diagnóstico. Foi assim que o 48×53 queimou três
 * submissões antes de alguém ler o `detail` do job (2026-08-01).
 */
async function fetchTilePngById(
  client: PixelLabClient,
  tileId: string,
  onLog?: (m: string) => void,
  jobId?: string | null,
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
    if (jobId) {
      const job = await client.request<BackgroundJobStatus>(
        'GET',
        `/background-jobs/${encodeURIComponent(jobId)}`,
      );
      if (job.data?.status === 'failed') {
        const detail = job.data.last_response?.detail;
        throw new Error(
          `o job do tile ${tileId} FALHOU no fornecedor` +
            (detail ? `: ${detail}` : ' (sem detail)') +
            '. Jobs falhos reportam usd 0 — submeter de novo não repaga este.',
        );
      }
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

  return { b64: await fetchTilePngById(client, tileId, onLog, jobId), tileId };
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

// ---- geração de ação da animação (técnica 'texture')

/**
 * Mapeamento de palavras-chave para ações de animação — fallback quando o LLM
 * não está disponível.
 *
 * É heurística, declarada como tal. A ação gerada é o que vai no campo `action`
 * do /animate-with-text-v3.
 */
const ACTION_FALLBACK: ReadonlyArray<[RegExp, string]> = [
  [/\b(water|sea|ocean|river|lake|pond|stream)\b/i, 'water rippling and flowing gently with subtle light reflections'],
  [/\b(lava|magma|fire|flame|burning)\b/i, 'lava bubbling and glowing with slow viscous movement and flickering embers'],
  [/\b(grass|turf|lawn|meadow|field)\b/i, 'grass swaying softly in a gentle breeze with subtle color variations'],
  [/\b(leaves|leaf|foliage|bush|hedge|tree)\b/i, 'leaves rustling and swaying gently with dappled light'],
  [/\b(stone|rock|cobble|granite|brick|wall)\b/i, 'stone surface with subtle shimmer of mineral veins and gentle light play'],
  [/\b(wood|plank|timber|log|crate)\b/i, 'wood grain with subtle shifting highlights and gentle warm tones'],
  [/\b(metal|iron|steel|copper|gold|silver)\b/i, 'metallic surface gleaming with subtle reflected light and gentle sheen'],
  [/\b(ice|frost|frozen|crystal)\b/i, 'ice crystals shimmering with slow subtle light refraction and cold mist'],
  [/\b(sand|desert|dune)\b/i, 'sand shifting subtly with tiny grain movements and warm light variations'],
  [/\b(dirt|soil|mud|earth)\b/i, 'earth surface with subtle texture variations and small particles shifting'],
  [/\b(cloud|sky|mist|fog)\b/i, 'clouds drifting slowly with soft wisps of vapor and gentle light changes'],
  [/\b(magic|arcane|spell|enchanted)\b/i, 'magical energy pulsating gently with subtle sparkles and ethereal glow'],
  [/\b(snow|winter)\b/i, 'snow sparkling gently with subtle light reflection and soft drifting particles'],
];

function fallbackAction(description: string): string {
  for (const [re, action] of ACTION_FALLBACK) {
    if (re.test(description)) return action;
  }
  return 'subtle ambient motion with gentle light variations and soft texture shimmer';
}

/**
 * Gera o texto de ação da animação via LLM.
 *
 * Chama a Anthropic API com uma chave do ambiente (`ANTHROPIC_API_KEY`).
 * Em caso de falha (sem chave, sem rede, erro da API), cai no fallback
 * determinístico — a ação de fallback entra no hash do bloco, então o
 * cache é separado e o bloco pode ser regerado com LLM quando disponível.
 */
async function generateActionViaLlm(
  description: string,
  onLog?: (m: string) => void,
): Promise<{ action: string; llmGenerated: boolean }> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    onLog?.('[world-block] ANTHROPIC_API_KEY não definida — usando fallback para ação da animação.');
    return { action: fallbackAction(description), llmGenerated: false };
  }

  try {
    const prompt = [
      'Given a block described as:',
      `"${description}"`,
      '',
      'Write a short animation action for a pixel-art sprite animation API.',
      'Describe subtle ambient motion appropriate for this material.',
      'Keep it under 200 characters.',
      'Respond with ONLY the action text, no explanation, no quotes.',
    ].join('\n');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      onLog?.(`[world-block] LLM respondeu ${res.status} — usando fallback. ${errText.slice(0, 120)}`);
      return { action: fallbackAction(description), llmGenerated: false };
    }

    const body = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = body.content?.find((c) => c.type === 'text')?.text?.trim();
    if (!text || text.length === 0) {
      onLog?.('[world-block] LLM devolveu resposta vazia — usando fallback.');
      return { action: fallbackAction(description), llmGenerated: false };
    }

    // Limpa formatação residual que o LLM possa ter incluído
    const clean = text.replace(/^["']|["']$/g, '').replace(/\n+/g, ' ').trim();
    onLog?.(`[world-block] ação gerada por LLM: "${clean.slice(0, 80)}${clean.length > 80 ? '…' : ''}"`);
    return { action: clean.slice(0, 500), llmGenerated: true };
  } catch (err) {
    onLog?.(
      `[world-block] falha ao chamar LLM: ${err instanceof Error ? err.message : String(err)} — usando fallback.`,
    );
    return { action: fallbackAction(description), llmGenerated: false };
  }
}

// ---- geração do cubo base (tile, técnica 'texture')

/**
 * Gera o cubo pixel-art do material via /create-isometric-tile.
 *
 * O molde do cubo (cube-mould.ts) entra como `init_image` com força alta
 * (DEFAULT_INIT_IMAGE_STRENGTH): o endpoint não tem parâmetro de proporção,
 * então a referência é a única alavanca de forma. O prompt (cubePrompt) pede
 * para respeitar a forma e o tamanho exatos do molde, na vista 'low top-down'
 * do projeto (ADR 0005).
 *
 * O endpoint devolve PIXELS RGBA CRUS no canvas da API (48×56, múltiplo de 4)
 * — apiBytesToCanonicalPng() recorta para o quadro canônico 48×53 antes de
 * tocar o disco.
 *
 * O `init_image` do /create-isometric-tile está QUEBRADO no fornecedor
 * (verificado 2026-08-01, spec "dev"): a validação Pydantic exige PNG e o
 * worker exige RGBA cru — nenhum payload satisfaz os dois estágios. O 422 é
 * SÍNCRONO e custa $0: quando recusada, resubmete SEM o molde, e a forma fica
 * por conta do prompt. Quando o fornecedor consertar, a primeira tentativa
 * volta a valer e o fallback nunca dispara.
 *
 * Só entram no request os campos que participam do hash da técnica: o shape
 * é 'block' FIXO e nenhum campo de estilo (outline/shading/detail) é mandado —
 * mandá-los variaria o artefato sem mudar o hash.
 */
async function generateBaseImage(
  client: PixelLabClient,
  description: string,
  seed: number,
  basePath: string,
  apiSize: ImageSize,
  frameSize: ImageSize,
  onLog?: (m: string) => void,
): Promise<{
  readonly b64: string;
  readonly tileId?: string;
  readonly jobId?: string;
  readonly usage?: Usage | null;
  /** true quando o cubo veio do stub (retomada) — nenhuma submissão, nenhum gasto. */
  readonly resumed: boolean;
}> {
  const stubPath = tileStubPath(basePath);

  // Retomada: cubo já pago, PNG nunca gravado. GET por id não custa nada.
  if (existsSync(stubPath)) {
    let stub: TileStub | null = null;
    try {
      stub = JSON.parse(await readFile(stubPath, 'utf8')) as TileStub;
    } catch {
      stub = null;
    }
    if (stub?.tileId) {
      onLog?.(
        `[world-block] retomando cubo base já pago ${stub.tileId} — nenhuma submissão nova.`,
      );
      try {
        const b64 = await fetchTilePngById(client, stub.tileId, onLog, stub.jobId);
        const bruto = Buffer.from(b64, 'base64');
        const png = apiBytesToCanonicalPng(bruto, apiSize, frameSize);
        await writeFile(basePath, png);
        await unlink(stubPath);
        return { b64: png.toString('base64'), tileId: stub.tileId, resumed: true };
      } catch (err) {
        onLog?.(
          `[world-block] o cubo pendente ${stub.tileId} não pôde ser recuperado ` +
            `(${err instanceof Error ? err.message : String(err)}). Submetendo de novo.`,
        );
      }
    }
    await unlink(stubPath).catch(() => {});
  }

  const params: Record<string, unknown> = {
    description: cubePrompt(description),
    image_size: apiSize,
    isometric_tile_shape: 'block',
    init_image: asBase64Image(padPngToApiCanvas(mouldBase64(), apiSize)),
    init_image_strength: DEFAULT_INIT_IMAGE_STRENGTH,
    seed,
  };

  /**
   * Mesmo aviso de generateTile: o init_image está quebrado no fornecedor, e
   * a primeira tentativa é barata porque o 422 é síncrono e custa $0.
   */
  let res: Awaited<ReturnType<typeof client.submit<IsometricTileResponse>>>;
  try {
    res = await client.submit<IsometricTileResponse>('create-isometric-tile', params);
  } catch (err) {
    const rejectedImages =
      err instanceof PixelLabError &&
      err.status === 422 &&
      /init_image|color_image/.test(err.body) &&
      'init_image' in params;
    if (!rejectedImages) throw err;
    onLog?.(
      '[world-block] AVISO: o fornecedor recusou o molde como init_image (validação pede ' +
        'PNG, worker exige RGBA cru — incompatíveis hoje). Gerando o cubo SEM a ' +
        'referência: a forma fica por conta do prompt.',
    );
    delete params['init_image'];
    delete params['init_image_strength'];
    res = await client.submit<IsometricTileResponse>('create-isometric-tile', params);
  }

  // O dinheiro sai na submissão: tracking e stub ANTES de resolver o PNG.
  if (typeof res.usage?.usd === 'number') trackSpend(res.usage.usd);
  const usage = res.usage;
  const stub: TileStub = {
    tileId: res.data?.tile_id ?? null,
    jobId: res.data?.background_job_id ?? null,
    seed,
  };
  await writeFile(stubPath, `${JSON.stringify(stub)}\n`);

  const { b64, tileId } = await resolveTilePng(client, res, onLog);
  const bruto = Buffer.from(b64, 'base64');
  const png = apiBytesToCanonicalPng(bruto, apiSize, frameSize);
  await writeFile(basePath, png);
  await unlink(stubPath).catch(() => {});
  onLog?.(
    `[world-block] cubo base → ${basePath} (seed ${seed}, ${png.length} bytes PNG, ` +
      `${frameSize.width}×${frameSize.height} canônico)`,
  );

  return {
    b64: png.toString('base64'),
    ...(tileId ? { tileId } : {}),
    ...(res.data?.background_job_id ? { jobId: res.data.background_job_id } : {}),
    ...(usage ? { usage } : {}),
    resumed: false,
  };
}

// ---- empacotamento de spritesheet (técnica 'texture')

interface AnimSidecar {
  readonly fps: number;
  readonly frameCount: number;
  readonly action: string;
  readonly llmGenerated?: boolean;
}

/**
 * Escreve os frames de animação como PNGs individuais e um atlas JSON no
 * formato PixiJS (TexturePacker-compatible).
 *
 * Sem dependência de sharp: os frames já chegam como PNGs prontos da API.
 * A "spritesheet" é uma tira horizontal montada copiando os buffers PNG
 * decodificados como RGBA cru.
 */
async function packSpritesheet(
  assetsDir: string,
  hash: string,
  frames: readonly Buffer[],
  sidecar: AnimSidecar,
  onLog?: (m: string) => void,
): Promise<void> {
  if (frames.length === 0) throw new Error('sem frames para empacotar');

  // Salva frames individuais
  const framesDir = join(blockDir(assetsDir, hash), 'frames');
  await mkdir(framesDir, { recursive: true });

  const frameWidth = 48;
  const frameHeight = 48;

  // Decodifica frames para RGBA cru (são PNGs)
  const decoded: Array<{ width: number; height: number; rgba: Buffer }> = [];
  for (let i = 0; i < frames.length; i++) {
    const png = frames[i]!;
    await writeFile(join(framesDir, `frame_${String(i).toString().padStart(3, '0')}.png`), png);
    try {
      const img = decode(png);
      decoded.push(img);
    } catch {
      // Fallback: frame não é PNG válido, tenta como RGBA cru
      if (png.length === frameWidth * frameHeight * 4) {
        decoded.push({ width: frameWidth, height: frameHeight, rgba: png });
      } else {
        throw new Error(`frame ${i} não é PNG nem RGBA cru de ${frameWidth}×${frameHeight}`);
      }
    }
  }

  // Monta tira horizontal como RGBA cru
  const totalWidth = frameWidth * frames.length;
  const totalHeight = frameHeight;
  const sheetRgba = Buffer.alloc(totalWidth * totalHeight * 4);

  for (let i = 0; i < decoded.length; i++) {
    const img = decoded[i]!;
    for (let y = 0; y < frameHeight; y++) {
      const srcOff = y * frameWidth * 4;
      const dstOff = (y * totalWidth + i * frameWidth) * 4;
      img.rgba.copy(sheetRgba, dstOff, srcOff, srcOff + frameWidth * 4);
    }
  }

  // Codifica a spritesheet como PNG
  const sheetPng = encodePngFromRgba(sheetRgba, totalWidth, totalHeight);
  await writeFile(spritesheetPath(assetsDir, hash), sheetPng);

  // Atlas JSON (formato TexturePacker)
  const atlasFrames: Record<string, {
    frame: { x: number; y: number; w: number; h: number };
    rotated: boolean;
    trimmed: boolean;
    spriteSourceSize: { x: number; y: number; w: number; h: number };
    sourceSize: { w: number; h: number };
  }> = {};

  const animFrames: string[] = [];
  for (let i = 0; i < frames.length; i++) {
    const name = `frame_${String(i).toString().padStart(3, '0')}`;
    animFrames.push(name);
    atlasFrames[name] = {
      frame: { x: i * frameWidth, y: 0, w: frameWidth, h: frameHeight },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: frameWidth, h: frameHeight },
      sourceSize: { w: frameWidth, h: frameHeight },
    };
  }

  const atlas = {
    frames: atlasFrames,
    meta: {
      app: 'isometric-maker',
      version: '1.0',
      image: 'spritesheet.png',
      format: 'RGBA8888',
      size: { w: totalWidth, h: totalHeight },
      scale: '1',
    },
    animations: {
      anim: animFrames,
    },
  };

  await writeFile(atlasPath(assetsDir, hash), `${JSON.stringify(atlas, null, 2)}\n`);
  await writeFile(
    animSidecarPath(assetsDir, hash),
    `${JSON.stringify(sidecar, null, 2)}\n`,
  );

  onLog?.(
    `[world-block] spritesheet empacotada: ${totalWidth}×${totalHeight}, ` +
      `${frames.length} frames, ${sidecar.fps} fps`,
  );
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
  // DOIS canvas, de propósito. O quadro canônico (48×53, bounding box exato
  // do cubo) é o contrato do DISCO e do map-builder. O canvas da API é o
  // canônico arredondado a múltiplos de 4 (48×56): a GPU da PixelLab recusa
  // outro — `code 3006`, restrição fora do spec, verificada em 2026-08-01.
  // Toda submissão acolchoa o topo na ida e recorta na volta.
  const imageSize = blockImageSize();
  const apiSize = apiImageSize();

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
          const b64 = await fetchTilePngById(client, stub.tileId, opts.onLog, stub.jobId);
          const bruto = Buffer.from(b64, 'base64');
          const png = apiBytesToCanonicalPng(bruto, apiSize, imageSize);
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
      image_size: apiSize,
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
      params['init_image'] = asBase64Image(padPngToApiCanvas(init.b64, apiSize));
      params['init_image_strength'] = init.strength;
    }
    if (colorImageB64 !== undefined) {
      params['color_image'] = asBase64Image(padPngToApiCanvas(colorImageB64, apiSize));
    }

    /**
     * O init_image do /create-isometric-tile está QUEBRADO no fornecedor
     * (verificado 2026-08-01, spec "dev"): a validação Pydantic exige um
     * arquivo que o Pillow abra ("Send PNG…"), e o worker
     * (generate_pixelart_flux → get_image_from_byte) faz
     * `Image.frombytes(mode="RGBA", size=image_size)` — que só aceita RGBA
     * cru. PNG passa na validação e morre no worker ("Expected image of size
     * 48x56"); RGBA cru morre na validação (422). Nenhum payload satisfaz os
     * dois estágios.
     *
     * O 422 é SÍNCRONO e custa $0, então a tentativa com imagem é barata:
     * quando recusada, resubmete SEM referência de imagem — o modo em que os
     * cinco blocos da era uniforme foram gerados com sucesso — e avisa alto.
     * Quando o fornecedor consertar, a primeira tentativa volta a valer e o
     * fallback nunca dispara.
     */
    let res: Awaited<ReturnType<typeof client.submit<IsometricTileResponse>>>;
    try {
      res = await client.submit<IsometricTileResponse>('create-isometric-tile', params);
    } catch (err) {
      const rejectedImages =
        err instanceof PixelLabError &&
        err.status === 422 &&
        /init_image|color_image/.test(err.body) &&
        ('init_image' in params || 'color_image' in params);
      if (!rejectedImages) throw err;
      opts.onLog?.(
        '[world-block] AVISO: o fornecedor recusou init_image/color_image (validação pede ' +
          'PNG, worker exige RGBA cru — incompatíveis hoje). Gerando SEM referência de ' +
          'imagem: a forma fica por conta do prompt, como na era uniforme.',
      );
      delete params['init_image'];
      delete params['init_image_strength'];
      delete params['color_image'];
      res = await client.submit<IsometricTileResponse>('create-isometric-tile', params);
    }
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
    // — e a geração já foi paga. Ver server/png.ts. O recorte devolve o canvas
    // da API ao quadro canônico antes de tocar o disco.
    const bruto = Buffer.from(b64, 'base64');
    const png = apiBytesToCanonicalPng(bruto, apiSize, imageSize);
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
    apiSize.width * apiSize.height,
  );

  let faces: WorldBlockFace[];
  let sourceRecord: WorldBlockManifestV2['source'];
  let characterRecord: WorldBlockManifestV2['character'];
  let manifestDirty = false;
  // Técnica 'texture': variáveis usadas no manifesto v3.
  let textureBaseUsage: Usage | null | undefined;
  let textureAnimJobId: string | undefined;
  let textureAnimUsage: Usage | null | undefined;
  let textureActualFrameCount = 0;

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
  } else if (technique === 'texture') {
    // ---- textura animada: 1 cubo (tile) + LLM + 1 animate-with-text-v3 (ADR 0032).
    const frameCount = config.frameCount ?? 8;
    const fps = config.fps ?? DEFAULT_BLOCK_ANIMATION_FPS;
    const basePath = baseImagePath(opts.assetsDir, hash);
    const sheetPath = spritesheetPath(opts.assetsDir, hash);
    const stubPath = animStubPath(opts.assetsDir, hash);

    interface AnimStub {
      readonly jobId: string;
      readonly seed: number;
      readonly frameCount: number;
    }

    let baseSeedNum = base + 1;
    let actionText: string;
    let llmGenerated = false;

    // 1. Cubo base (create-isometric-tile, molde como init_image) — ou cache.
    if (!existsSync(basePath)) {
      logGuard(
        'create-isometric-tile (1× cubo base pixel-art, molde como referência; preço estimado)',
        guardFor(tileEstimate, tileEstimate.point),
        opts.onLog,
      );

      const baseImg = await generateBaseImage(
        client,
        config.description,
        baseSeedNum,
        basePath,
        apiSize,
        imageSize,
        opts.onLog,
      );
      if (baseImg.resumed) {
        opts.onLog?.('[world-block] cubo base retomado do tile pago — nenhum gasto novo.');
      } else {
        textureBaseUsage = baseImg.usage;
        generated += 1;
        manifestDirty = true;

        appendLedger(opts.ledgerPath, {
          at: new Date().toISOString(),
          endpoint: 'create-isometric-tile',
          lab: true,
          kind: 'world-block',
          hash,
          technique,
          seed: baseSeedNum,
          tileId: baseImg.tileId ?? null,
          jobId: baseImg.jobId ?? null,
          usd: baseImg.usage?.usd ?? null,
          generations: baseImg.usage?.generations ?? null,
          unit: baseImg.usage?.type ?? 'unknown',
        });
      }
    } else {
      opts.onLog?.('[world-block] imagem base já existe. Sem chamada.');
    }

    // 2. Ação da animação — LLM ou config explícita.
    if (config.action !== undefined && config.action.trim().length > 0) {
      actionText = config.action.trim();
      llmGenerated = false;
    } else {
      const result = await generateActionViaLlm(config.description, opts.onLog);
      actionText = result.action;
      llmGenerated = result.llmGenerated;
    }

    // 3. Animação (animate-with-text-v3) — ou retomada.
    if (!existsSync(sheetPath)) {
      let animStub: AnimStub | null = null;
      if (existsSync(stubPath)) {
        try {
          animStub = JSON.parse(await readFile(stubPath, 'utf8')) as AnimStub;
        } catch { animStub = null; }
      }

      if (animStub?.jobId) {
        opts.onLog?.(
          `[world-block] retomando animação já paga job=${animStub.jobId} — nenhuma submissão nova.`,
        );
        textureAnimJobId = animStub.jobId;
        baseSeedNum = animStub.seed;
      } else {
        const animEstimate = estimateByArea(
          COST_TABLE['animate-with-text-v3'],
          48 * 48,
        );
        logGuard(
          `animate-with-text-v3 (${frameCount} frames; preço estimado)`,
          guardFor(animEstimate, animEstimate.point),
          opts.onLog,
        );

        const baseB64 = (await readFile(basePath)).toString('base64');
        const animSeed = baseSeedNum + 1;
        const animParams: Record<string, unknown> = {
          first_frame: asBase64Image(baseB64),
          action: actionText,
          frame_count: frameCount,
          seed: animSeed,
        };

        const res = await client.submit<{ background_job_id?: string; usage?: Usage | null }>(
          'animate-with-text-v3',
          animParams,
        );
        generated += 1;

        if (typeof res.usage?.usd === 'number') trackSpend(res.usage.usd);
        textureAnimUsage = res.usage;
        const jobId = res.data?.background_job_id;
        if (!jobId) throw new Error('animate-with-text-v3 não devolveu background_job_id');
        textureAnimJobId = jobId;
        baseSeedNum = animSeed;
        manifestDirty = true;

        appendLedger(opts.ledgerPath, {
          at: new Date().toISOString(),
          endpoint: 'animate-with-text-v3',
          lab: true,
          kind: 'world-block',
          hash,
          technique,
          seed: animSeed,
          jobId,
          usd: res.usage?.usd ?? null,
          generations: res.usage?.generations ?? null,
          unit: res.usage?.type ?? 'unknown',
        });

        const stub: AnimStub = { jobId, seed: animSeed, frameCount };
        await writeFile(stubPath, `${JSON.stringify(stub)}\n`);
      }

      // Poll + download frames
      const jobIdForPoll = textureAnimJobId;
      if (!jobIdForPoll) throw new Error('animate-with-text-v3: jobId ausente');
      const polled = await pollJob(client, jobIdForPoll, { timeoutMs: 600_000 });
      if (!polled.ok) {
        throw new Error(
          polled.reason === 'timeout'
            ? 'tempo esgotado aguardando animate-with-text-v3'
            : (polled.detail ?? 'animate-with-text-v3 falhou'),
        );
      }

      const lastResp = polled.job.last_response as
        | { images?: Array<{ base64?: string }> }
        | undefined;
      const images = lastResp?.images;
      if (!images || images.length === 0) {
        throw new Error('animate-with-text-v3 concluiu mas não devolveu frames');
      }

      const frames: Buffer[] = [];
      for (const img of images) {
        const fb64 = img.base64;
        if (!fb64) continue;
        frames.push(Buffer.from(fb64, 'base64'));
      }

      if (frames.length === 0) {
        throw new Error('animate-with-text-v3: nenhum frame com base64');
      }

      opts.onLog?.(`[world-block] ${frames.length} frames baixados da animação.`);

      textureActualFrameCount = frames.length;

      await packSpritesheet(opts.assetsDir, hash, frames, {
        fps,
        frameCount: frames.length,
        action: actionText,
        llmGenerated,
      }, opts.onLog);

      await unlink(stubPath).catch(() => {});
    } else {
      opts.onLog?.('[world-block] spritesheet já existe. Sem chamada.');
    }

    faces = [];
    sourceRecord = undefined;
    characterRecord = undefined;
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
    const prevV2 = prev?.version === 2 ? (prev as WorldBlockManifestV2) : null;
    const mappingChanged = prevV2 !== null && prevV2.v3Mapping !== V3_MAPPING_ID;
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
    if (v3Stub === null && prevV2?.character?.id) {
      v3Stub = {
        characterId: prevV2.character.id,
        jobId: prevV2.character.jobId ?? null,
        seed: prevV2.character.seed,
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
        apiSize.width * apiSize.height,
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
          // O canvas da API, nunca o canônico: se a regra do múltiplo de 4
          // valer também aqui, 48×53 falharia do mesmo jeito que o tile.
          image_size: { width: apiSize.width, height: apiSize.height },
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
        prevV2?.character?.id === characterId ? prevV2.character.usage : undefined;
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
  // interrompida" para readWorldBlockResult.
  if (!fromCache || manifestDirty || prev === null) {
    if (technique === 'texture') {
      // Manifesto v3 — textura animada (ADR 0032).
      const frameCount = textureActualFrameCount || (config.frameCount ?? 8);
      const fps = config.fps ?? DEFAULT_BLOCK_ANIMATION_FPS;

      // Recupera action/llmGenerated do sidecar se a spritesheet já existia.
      let actionText = config.action ?? '';
      let llmGenerated = false;
      if (existsSync(animSidecarPath(opts.assetsDir, hash))) {
        try {
          const sc = JSON.parse(await readFile(animSidecarPath(opts.assetsDir, hash), 'utf8')) as AnimSidecar;
          actionText = sc.action;
          llmGenerated = sc.llmGenerated ?? false;
        } catch { /* mantém defaults */ }
      }

      // Recupera usage da base image do ledger — o manifesto anterior.
      const prevV3 = prev?.version === 3 && prev.technique === 'texture' ? prev : null;

      const manifestV3: WorldBlockManifestV3 = {
        version: 3,
        hash,
        technique: 'texture',
        description: config.description,
        geometry: MANIFEST_GEOMETRY,
        action: actionText,
        ...(llmGenerated ? { llmGenerated } : {}),
        frameCount,
        fps,
        ...(textureBaseUsage || prevV3?.base?.usage
          ? { base: { seed: base + 1, ...(textureBaseUsage ? { usage: textureBaseUsage } : {}), ...(prevV3?.base?.usage && !textureBaseUsage ? { usage: prevV3.base.usage } : {}) } }
          : {}),
        ...(textureAnimJobId || prevV3?.animation?.jobId
          ? {
              animation: {
                ...(textureAnimJobId ? { jobId: textureAnimJobId } : {}),
                ...(prevV3?.animation?.jobId && !textureAnimJobId ? { jobId: prevV3.animation.jobId } : {}),
                seed: base + 2,
                ...(textureAnimUsage ? { usage: textureAnimUsage } : {}),
                ...(prevV3?.animation?.usage && !textureAnimUsage ? { usage: prevV3.animation.usage } : {}),
              },
            }
          : {}),
      };
      await writeFile(
        manifestPath(opts.assetsDir, hash),
        `${JSON.stringify(manifestV3, null, 2)}\n`,
      );
    } else {
      // Manifesto v2 — 4 faces (ADR 0029). FUNDE com o manifesto anterior.
      const mergedFaces: ManifestFace[] = faces.map((f) => {
        const prevFace = (prev as WorldBlockManifestV2 | null)?.faces?.find?.((p) => p.facing === f.facing);
        if (!fresh.has(f.facing) && prevFace) return prevFace;
        return {
          facing: f.facing,
          seed: f.seed,
          ...(f.tileId ? { tileId: f.tileId } : {}),
          ...(f.usage ? { usage: f.usage } : {}),
        };
      });
      const mergedSource = sourceRecord ?? (prev as WorldBlockManifestV2 | null)?.source;
      const mergedCharacter = characterRecord ?? (prev as WorldBlockManifestV2 | null)?.character;
      const manifestV2: WorldBlockManifestV2 = {
        version: 2,
        hash,
        technique: technique as 'chained' | 'rotated',
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
        `${JSON.stringify(manifestV2, null, 2)}\n`,
      );
    }
  }

  return { hash, technique, faces, fromCache, generated };
}
