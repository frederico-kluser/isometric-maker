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
 * - **`texture` — cubo animado (ADR 0032).** A descrição do usuário é
 *   normalizada para o MATERIAL em inglês pixel-art (LLM, com fallback
 *   determinístico); UM cubo pixel-art nasce do molde (`cube-mould.ts` como
 *   `init_image` na força 300 do spec) via `/create-isometric-tile` — e a
 *   frase que manda casar com a referência só entra no prompt quando o molde
 *   entra no request; a ação da animação vem de LLM (ou fallback
 *   determinístico) e carrega o material dentro dela, porque `action` é o
 *   único texto que o `/animate-with-text-v3` recebe; o
 *   cubo vira o `first_frame` do `/animate-with-text-v3`, que anima todos os
 *   frames num job só (não por direção). Frames com fundo transparente
 *   (`no_background`) e ação expandida pela própria API (`enhance_prompt`, com
 *   custo à parte — `enhanced_prompt` na resposta). `frameCount: 0` pula a
 *   animação e gera só o cubo base. A spritesheet empacota os frames e o
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
 *     4–16 par, budget de pixels width×height×frame_count ≤ 524288; aceita
 *     `no_background` (fundo transparente) e `enhance_prompt` (boolean; a API
 *     expande a ação — a resposta traz `enhanced_prompt` e cobra
 *     `enhance_usage` à parte). ASSÍNCRONO mas responde 200 com
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
import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import type { PixelLabClient, Usage } from '../../pixellab-pipeline/src/api.ts';
import { PixelLabError, pollJob } from '../../pixellab-pipeline/src/api.ts';
import { sleep } from '../../pixellab-pipeline/src/util.ts';
import {
  COST_TABLE, estimateByArea, checkBudget,
  type BudgetReport, type CostEstimate,
} from '../../pixellab-pipeline/src/cost.ts';
import { asBase64Image, extractBase64 } from './base64-image.ts';
import { trackSpend } from './estimate.ts';
import { encodePngFromRgba, isPng, readPngHeader } from './png.ts';
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
   * 0 = sem animação (só o cubo base, sem animate-with-text-v3). 4, 8 ou 16
   * são os valores que o /animate-with-text-v3 aceita. Default 8.
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
  /**
   * Ping-pong (vai-e-volta) na reprodução (técnica 'texture' apenas):
   * 0→1→2→3→2→1→0… em vez de resetar (0→1→2→3→0→…). Post-processing do
   * editor — nunca custa nada. Default true.
   */
  readonly pingPong?: boolean;
  /**
   * `enhance_prompt` do /animate-with-text-v3 (técnica 'texture' apenas):
   * a própria API expande `action` numa descrição de movimento mais rica e
   * devolve o texto em `enhanced_prompt` (cobrando `enhance_usage` à parte).
   * É camada ADICIONAL — o gerador de ação por LLM continua existindo.
   * Default true.
   */
  readonly enhancePrompt?: boolean;
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
 * Força do `init_image` no cubo base da técnica 'texture' — o default do spec.
 *
 * **Decisão de 2026-08-04, com justificativa, porque manter 480 aqui era
 * escolha por inércia.** O molde é um cubo cinza CHAPADO, e `init_image`
 * carrega forma *e* cor: 480 numa faixa de 1 a 999, contra o default 300 do
 * endpoint, empurra a geração para o cinza sólido do molde e disputa
 * diretamente com o material que o usuário pediu — exatamente o defeito que
 * esta correção existe para consertar. Na técnica `chained` a força alta se
 * paga (é o encadeamento que fixa a aresta vertical entre as quatro faces);
 * aqui não há quatro faces para casar, há UM cubo que precisa parecer o
 * material.
 *
 * Na prática o valor é quase decorativo: o fornecedor recusa o molde com 422
 * (verificado 2026-08-01) e `generateBaseImage` resubmete sem `init_image`.
 * Ele volta a valer no dia em que a PixelLab consertar o `init_image` — e é
 * para esse dia que o número tem de estar certo.
 *
 * `DEFAULT_INIT_IMAGE_STRENGTH` (480) fica intocado: ele governa `chained` e
 * `rotated`, entra no hash dessas duas técnicas, e mexer nele cobraria
 * regeração de blocos que esta tarefa não tem motivo para tocar.
 */
export const TEXTURE_INIT_IMAGE_STRENGTH = 300;

/**
 * Defaults do `/create-isometric-tile` como o spec vendorizado os declara
 * (`CreateIsometricTileRequest`, capturado 2026-08-01).
 *
 * Existem para uma coisa só: decidir o que entra no hash. Mandar o default
 * explícito produz a MESMA arte que omitir o campo, então os dois casos têm de
 * hashear igual — senão o mesmo artefato é pago duas vezes.
 */
export const TILE_DEFAULT_TEXT_GUIDANCE = 8;
export const TILE_DEFAULT_OUTLINE: TileOutline = 'lineless';
export const TILE_DEFAULT_SHADING: TileShading = 'basic shading';
export const TILE_DEFAULT_DETAIL: TileDetail = 'medium detail';

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
  | 'fps-range'
  | 'ping-pong-type'
  | 'enhance-prompt-type'
  | 'hash-format';

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
      `frameCount inválido: ${String(config.frameCount)}. Use 0 (sem animação) ou um dos ` +
        `valores do spec: ${ANIMATION_FRAME_COUNTS.filter((n) => n > 0).join(', ')}.`,
    );
  }
  if (config.pingPong !== undefined && typeof config.pingPong !== 'boolean') {
    throw new WorldBlockValidationError(
      'ping-pong-type',
      `pingPong precisa ser booleano (recebido ${String(config.pingPong)}).`,
    );
  }
  if (config.enhancePrompt !== undefined && typeof config.enhancePrompt !== 'boolean') {
    throw new WorldBlockValidationError(
      'enhance-prompt-type',
      `enhancePrompt precisa ser booleano (recebido ${String(config.enhancePrompt)}).`,
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
 * o header do módulo) — o que descreve a forma são as palavras. A vista é a do
 * projeto ('low top-down', ADR 0005/0015), nunca a 'high top-down' do default
 * do endpoint.
 *
 * **`hasReference` não é enfeite.** A frase "matching the exact shape and
 * proportions of the reference image" só faz sentido quando um `init_image` vai
 * JUNTO no mesmo request. Hoje o fornecedor recusa o molde com 422 e o código o
 * remove (ver `generateBaseImage`) — e antes desta correção a frase continuava
 * no prompt, pendurada, sem referente algum, competindo por atenção com o
 * material que o usuário pediu. Quem monta o request decide: manda `true` na
 * tentativa COM molde e `false` na resubmissão sem ele.
 *
 * A literal `pixel art cube` é contrato de teste: o `FakeClient` de
 * `world-block.test.ts` ramifica nela para decidir se devolve RGBA cru (como o
 * endpoint real do tile) ou PNG. Trocar essas três palavras quebra o fake, não
 * só as asserções.
 */
export function cubePrompt(
  description: string,
  opts: { readonly hasReference?: boolean } = {},
): string {
  const parts = [description, 'pixel art cube', 'isometric block'];
  if (opts.hasReference === true) {
    parts.push('matching the exact shape and proportions of the reference image');
  }
  parts.push('low top-down view');
  return parts.join(', ');
}

// ---- normalização da descrição (pt-BR conversacional → inglês pixel-art)

/**
 * Teto do material normalizado, em caracteres.
 *
 * O `description` cru aceita 2000 (ver `validateWorldBlockConfig`), mas o que
 * sai da normalização é uma FRASE NOMINAL de material. O caminho do LLM já
 * cortava em 200 e o determinístico não cortava em nada — a MESMA descrição
 * rendia prompts de tamanhos diferentes conforme houvesse ou não
 * `ANTHROPIC_API_KEY` no ambiente. As duas pontas cortam no mesmo lugar.
 */
export const MATERIAL_MAX_LEN = 200;

/**
 * Dobra diacríticos preservando o comprimento: 'á' → 'a', 'ç' → 'c', 'ã' → 'a'.
 *
 * **É este helper que faz o glossário funcionar.** Em JavaScript `\w` — e
 * portanto `\b` — é `[A-Za-z0-9_]` mesmo com a flag `u`. Numa string que
 * COMEÇA com 'á' não existe fronteira de palavra antes do 'á', então um padrão
 * como `/\b[áa]gua\b/` nunca casa a alternativa acentuada. Medido em
 * 2026-08-04, contra o código anterior: `/\b[áa]gua\b/i.test('água') === false`
 * e `fallbackMaterial('água')` devolvia `'água'` em vez de `'water'` — logo a
 * ação da animação caía na string-coringa, porque nenhuma regex inglesa de
 * `ACTION_FALLBACK` casa com "água". `água` é a palavra que a própria UI usa
 * de exemplo (`src/strings/blocos.ts`).
 *
 * Havia duas saídas: fronteira explícita por classe Unicode
 * (`(?<!\p{L})…(?!\p{L})` com flag `u`) em cada padrão, ou dobrar os
 * diacríticos e casar sem acento. **Esta é a segunda**, por três motivos: o
 * glossário perde metade dos padrões (some todo `[áa]`, `[ãa]`, `[çc]`), a
 * regra passa a valer para QUALQUER entrada futura sem que quem a escreve
 * precise lembrar de nada, e o `\b` volta a ser correto porque o texto que ele
 * vê é ASCII.
 *
 * O casamento é no texto dobrado; o recorte e a substituição são no texto
 * ORIGINAL (ver `replaceFolded`) — o que não está no glossário sai daqui com
 * os acentos que o usuário digitou. Por isso a dobra é 1 caractere por 1: se a
 * decomposição não render exatamente um caractere, o original é mantido, e os
 * índices das duas strings continuam alinhados.
 */
function foldDiacritics(text: string): string {
  let out = '';
  for (const ch of text) {
    const folded = ch.normalize('NFD').replace(/\p{M}/gu, '');
    out += ch.length === 1 && folded.length === 1 ? folded : ch;
  }
  return out;
}

/**
 * Casa `re` no texto DOBRADO e substitui no texto ORIGINAL, na mesma posição.
 *
 * `re` não pode ser global nem sticky: o casamento é o primeiro, como o
 * `String.prototype.replace` sem `/g` que este código usava antes.
 */
function replaceFolded(text: string, re: RegExp, replacement: string): string {
  const m = re.exec(foldDiacritics(text));
  if (!m) return text;
  return text.slice(0, m.index) + replacement + text.slice(m.index + m[0].length);
}

/**
 * Conectivos ingleses que denunciam uma descrição JÁ em inglês.
 *
 * Existe por causa de "tile of grass": a regra que remove a palavra da forma
 * ("bloco", "cubo", "tile") sozinha via o "tile " inicial e devolvia
 * "of grass". `tile` é palavra dos dois idiomas, e em inglês ela é o SUJEITO
 * da frase, não um rodeio a descartar.
 */
const EN_CONNECTORS = 'of|with|on|in|and|from|for|over|under|made|that|which';

/**
 * Verbos de pedido e rodeios que o usuário escreve e o fornecedor não entende.
 *
 * O usuário deste editor escreve em português e conversando: os dois blocos
 * pagos em disco têm descrição `"bloco de gero"` e `"quero um cubo de ossos"` —
 * o segundo carrega o PEDIDO ("quero um"), não só o material. Isso ia inteiro
 * para o `description` do `/create-isometric-tile`, e o modelo tinha de
 * adivinhar o que "quero" desenha.
 *
 * A ordem importa: as frases mais longas vêm primeiro, para que "um bloco de"
 * seja consumido antes de "bloco de".
 *
 * Os padrões são escritos SEM acento porque quem casa é o texto dobrado por
 * `foldDiacritics` — "me dê" chega aqui como "me de", "faça" como "faca".
 */
const MATERIAL_REQUEST_PREFIXES: readonly RegExp[] = [
  /^\s*(por\s+favor\s*,?\s*)/i,
  /^\s*(eu\s+)?(quero|queria|gostaria\s+de|preciso\s+de|preciso|me\s+de|me\s+da|manda|mande)\s+/i,
  /^\s*(gera|gere|gerar|cria|crie|criar|faz|faca|fazer|desenha|desenhe|desenhar|monta|monte|montar)\s+/i,
  /^\s*(um|uma|o|a|uns|umas|os|as)\s+/i,
  /^\s*(bloco|cubo|tijolo|textura|tile|pedaco|material)\s+(de|do|da|dos|das|em)\s+/i,
  new RegExp(
    `^\\s*(bloco|cubo|tijolo|textura|tile|material)\\s+(?!(?:${EN_CONNECTORS})\\b)`,
    'i',
  ),
  /^\s*(feito\s+de|feita\s+de|com)\s+/i,
];

/**
 * Adjetivos pt→en, aplicados ANTES do glossário de substantivos.
 *
 * Existem separados por causa da ORDEM: em português o adjetivo vem depois do
 * substantivo ("pedra musgosa"), em inglês vem antes ("mossy stone"). Antes
 * desta correção `musgos[oa]s?` estava no glossário de substantivos e virava
 * "moss", produzindo `"stone moss"` — que em inglês é líquen, não pedra com
 * musgo. Traduzir o adjetivo COMO adjetivo e depois movê-lo para a frente
 * (`frontAdjectives`) é o que conserta a frase.
 *
 * A lista é curta de propósito: só entra o que é inequivocamente adjetivo. Não
 * é um tradutor de português — é o piso de quem não tem `ANTHROPIC_API_KEY`.
 */
const MATERIAL_ADJECTIVES: ReadonlyArray<[RegExp, string]> = [
  [/\bmusgos[oa]s?\b/i, 'mossy'],
  [/\brachad[oa]s?\b|\btrincad[oa]s?\b/i, 'cracked'],
  [/\bquebrad[oa]s?\b|\bpartid[oa]s?\b/i, 'broken'],
  [/\bmolhad[oa]s?\b|\bumid[oa]s?\b/i, 'wet'],
  [/\bsec[oa]s?\b/i, 'dry'],
  [/\bescur[oa]s?\b/i, 'dark'],
  [/\bclar[oa]s?\b/i, 'light'],
  [/\bvelh[oa]s?\b|\bantig[oa]s?\b/i, 'old'],
  [/\bgast[oa]s?\b|\bdesgastad[oa]s?\b/i, 'worn'],
  [/\bpolid[oa]s?\b/i, 'polished'],
  [/\bbrilhantes?\b/i, 'shiny'],
  [/\blis[oa]s?\b/i, 'smooth'],
];

/**
 * Glossário mínimo pt→en dos materiais que este editor gera.
 *
 * É heurística declarada, não tradução: cobre o vocabulário de terreno de um
 * jogo isométrico e nada além disso. Sem `ANTHROPIC_API_KEY` é isto que separa
 * "ossos" (que o fornecedor lê como ruído) de "bone" (que ele desenha). Com
 * chave, quem traduz é o LLM e este mapa nunca é consultado.
 *
 * **Escreva os padrões SEM acento.** O texto contra o qual eles casam passa por
 * `foldDiacritics` primeiro: "água" chega como "agua", "mármore" como
 * "marmore". Escrever `[áa]` aqui não é só redundante — era o defeito, porque
 * `\b` é ASCII e a alternativa acentuada nunca casava no início da string.
 */
const MATERIAL_GLOSSARY: ReadonlyArray<[RegExp, string]> = [
  [/\boss(o|os)\b|\bcaveiras?\b|\besqueletos?\b/i, 'bone'],
  [/\bgrama\b|\bcapim\b|\brelva\b/i, 'grass'],
  [/\bterra\b|\bsolo\b|\bchao\b/i, 'dirt'],
  [/\blama\b|\bbarro\b/i, 'mud'],
  [/\bpedras?\b|\brochas?\b/i, 'stone'],
  [/\bpedregulhos?\b|\bparalelepipedos?\b/i, 'cobblestone'],
  [/\bgranitos?\b/i, 'granite'],
  [/\bmarmores?\b/i, 'marble'],
  [/\btijolos?\b|\balvenarias?\b/i, 'brick'],
  [/\bmadeiras?\b|\btabuas?\b|\btoras?\b/i, 'wood'],
  [/\bfolhas?\b|\bfolhagens?\b|\bmatos?\b|\barbustos?\b/i, 'leaves'],
  [/\barvores?\b|\btroncos?\b/i, 'tree bark'],
  [/\bagua\b|\bmar\b|\brio\b|\blago\b/i, 'water'],
  [/\blavas?\b|\bmagmas?\b/i, 'lava'],
  [/\bfogo\b|\bchamas?\b/i, 'fire'],
  [/\bgelo\b|\bcongelad[oa]s?\b/i, 'ice'],
  [/\bneves?\b/i, 'snow'],
  [/\bareias?\b|\bdesertos?\b|\bdunas?\b/i, 'sand'],
  [/\bmetais?\b|\bmetalic[oa]s?\b/i, 'metal'],
  [/\bferros?\b/i, 'iron'],
  [/\bacos?\b/i, 'steel'],
  [/\bcobres?\b/i, 'copper'],
  [/\bouros?\b|\bdourad[oa]s?\b/i, 'gold'],
  [/\bpratas?\b|\bpratead[oa]s?\b/i, 'silver'],
  [/\bcristais?\b|\bcristal\b/i, 'crystal'],
  [/\bvidros?\b/i, 'glass'],
  [/\bmusgos?\b/i, 'moss'],
  [/\bnuvens?\b|\bnevoas?\b|\bneblinas?\b/i, 'cloud'],
  [/\bmagic[oa]s?\b|\barcan[oa]s?\b|\bencantad[oa]s?\b/i, 'magic'],
  [/\bpalhas?\b|\bfenos?\b/i, 'straw'],
  [/\bcarvao\b/i, 'coal'],
  [/\bcaix(a|as)\b|\bengradados?\b/i, 'wooden crate'],
];

/**
 * Palavras que sobram quando o pedido não trazia material nenhum.
 *
 * A forma ("bloco", "cubo") e os conectivos ("de", "um") são exatamente o que
 * os prefixos existem para remover. Se, depois de removê-los, TUDO que sobrou
 * está nesta lista, o usuário não descreveu material — e mandar o resíduo ao
 * fornecedor é pior que mandar o texto original. Era o que acontecia com
 * `"um bloco de"`, que saía daqui como a preposição `"de"` e virava o
 * `description` do request.
 *
 * Sem acento: a comparação é contra a palavra dobrada.
 */
const RESIDUE_WORDS: ReadonlySet<string> = new Set([
  'bloco', 'blocos', 'cubo', 'cubos', 'tijolo', 'textura', 'texturas',
  'tile', 'tiles', 'material', 'materiais', 'pedaco', 'pedacos',
  'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'com',
  'feito', 'feita', 'um', 'uma', 'uns', 'umas', 'o', 'a', 'os', 'as', 'e',
]);

/**
 * Move para a frente os adjetivos que ESTE módulo produziu.
 *
 * Só mexe em palavras que saíram de `MATERIAL_ADJECTIVES` nesta execução —
 * texto que o usuário escreveu em inglês nunca é reordenado, porque nenhuma
 * palavra dele está na lista de aplicados. É reordenação de saída própria, não
 * análise sintática: "stone mossy" → "mossy stone", e "grass on top of dirt"
 * passa intacto.
 */
function frontAdjectives(text: string, applied: readonly string[]): string {
  if (applied.length === 0) return text;
  const set = new Set(applied);
  const words = text.split(/\s+/).filter((w) => w !== '');
  const adj = words.filter((w) => set.has(w.toLowerCase()));
  if (adj.length === 0 || adj.length === words.length) return text;
  const rest = words.filter((w) => !set.has(w.toLowerCase()));
  return [...adj, ...rest].join(' ');
}

/**
 * Fallback determinístico da normalização da descrição. NUNCA toca a rede.
 *
 * Faz quatro coisas, nesta ordem: tira os verbos de pedido do começo, traduz
 * os adjetivos, traduz os substantivos do glossário e põe os adjetivos antes
 * do substantivo, como o inglês exige. Se sobrar vazio (o usuário só escreveu
 * "quero um") ou só resíduo de forma e preposição, devolve a descrição
 * original aparada — perder o pedido inteiro seria pior que mandá-lo.
 *
 * Não é tradutor: uma frase em português que não esteja no glossário passa
 * quase intacta, com os acentos que o usuário digitou. O caminho bom é o LLM;
 * isto é o piso.
 *
 * O corte em `MATERIAL_MAX_LEN` é o mesmo do caminho do LLM: as duas pontas
 * produzem um material do mesmo tamanho máximo.
 */
export function fallbackMaterial(description: string): string {
  const original = description.trim().slice(0, MATERIAL_MAX_LEN).trim();
  let text = description.trim();

  // Verbos de pedido: aplica repetidamente, porque "quero um cubo de ossos"
  // precisa de três passadas (quero → um → cubo de).
  for (let round = 0; round < MATERIAL_REQUEST_PREFIXES.length; round += 1) {
    let changed = false;
    for (const re of MATERIAL_REQUEST_PREFIXES) {
      const next = replaceFolded(text, re, '');
      if (next !== text) {
        text = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  text = text.trim().replace(/[.!?]+$/, '').trim();

  // Sobrou vazio, ou sobrou só palavra de forma, artigo e preposição ("quero
  // um bloco", "um bloco de"): não há material nenhum no pedido. Devolver a
  // descrição original é pior prompt e ainda assim melhor que mandar "bloco"
  // ou "de" — pelo menos o usuário reconhece o que escreveu quando o resultado
  // sair errado.
  const words = foldDiacritics(text)
    .split(/\s+/)
    .filter((w) => w !== '');
  if (words.length === 0 || words.every((w) => RESIDUE_WORDS.has(w.toLowerCase()))) {
    return original;
  }

  const applied: string[] = [];
  for (const [re, en] of MATERIAL_ADJECTIVES) {
    const next = replaceFolded(text, re, en);
    if (next !== text) {
      text = next;
      applied.push(en);
    }
  }
  for (const [re, en] of MATERIAL_GLOSSARY) text = replaceFolded(text, re, en);
  text = frontAdjectives(text, applied);

  return text.trim().slice(0, MATERIAL_MAX_LEN).trim();
}

/**
 * Normaliza a descrição do usuário para o inglês de prompt de pixel art.
 *
 * Mesmo desenho de `generateActionViaLlm`: Claude Haiku pela `ANTHROPIC_API_KEY`
 * do ambiente, e fallback determinístico quando a chave falta, a rede cai ou a
 * API erra. O fallback NUNCA chama rede — é o que permite rodar a suíte inteira
 * sem chave e sem sair da máquina.
 *
 * A temperatura é 0 de propósito: aqui não se quer criatividade, se quer a
 * MESMA tradução para a mesma entrada. (A ação da animação usa 0.7 porque ali
 * variação é o produto.)
 *
 * **O resultado NÃO entra no hash do bloco** — quem entra é a descrição crua do
 * usuário. Se entrasse, o mesmo pedido hashearia diferente conforme houvesse ou
 * não chave de LLM no ambiente, e o cache de um bloco já pago viraria uma
 * segunda cobrança por mudança de variável de ambiente.
 */
async function normalizeMaterialViaLlm(
  description: string,
  onLog?: (m: string) => void,
): Promise<{ material: string; llmGenerated: boolean }> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    const material = fallbackMaterial(description);
    onLog?.(
      `[world-block] ANTHROPIC_API_KEY não definida — descrição normalizada por regra: "${material}".`,
    );
    return { material, llmGenerated: false };
  }

  try {
    const prompt = [
      'A user of a pixel-art game editor typed this block description,',
      'usually in Brazilian Portuguese and often phrased as a request:',
      `"${description}"`,
      '',
      'Extract ONLY the MATERIAL or terrain being asked for and write it in',
      'English, as a short noun phrase suitable for a pixel-art image prompt.',
      'Drop request verbs ("quero um", "gera um"), drop the words block/cube —',
      'the shape is fixed by the pipeline, you only describe the material.',
      'Keep any colour, wear or texture adjectives the user gave.',
      'Keep it under 100 characters.',
      'Respond with ONLY the phrase, no explanation, no quotes.',
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
        max_tokens: 100,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      onLog?.(
        `[world-block] LLM respondeu ${res.status} na normalização — usando regra. ${errText.slice(0, 120)}`,
      );
      return { material: fallbackMaterial(description), llmGenerated: false };
    }

    const body = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = body.content?.find((c) => c.type === 'text')?.text?.trim();
    if (!text || text.length === 0) {
      onLog?.('[world-block] LLM devolveu normalização vazia — usando regra.');
      return { material: fallbackMaterial(description), llmGenerated: false };
    }

    // O mesmo teto do fallback (`MATERIAL_MAX_LEN`): o tamanho do material não
    // pode depender de haver ou não chave de LLM no ambiente.
    const clean = text
      .replace(/^["']|["']$/g, '')
      .replace(/\n+/g, ' ')
      .trim()
      .slice(0, MATERIAL_MAX_LEN)
      .trim();
    onLog?.(`[world-block] descrição normalizada por LLM: "${description}" → "${clean}"`);
    return { material: clean, llmGenerated: true };
  } catch (err) {
    onLog?.(
      `[world-block] falha ao normalizar via LLM: ${err instanceof Error ? err.message : String(err)} — usando regra.`,
    );
    return { material: fallbackMaterial(description), llmGenerated: false };
  }
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
    // A técnica 'texture' inclui frameCount, fps, action, pingPong e
    // enhancePrompt — o que define a animação e o request. O cubo base
    // também vem do /create-isometric-tile, com shape 'block' FIXO.
    h.update(`|frameCount=${config.frameCount ?? 8}`);
    h.update(`|fps=${config.fps ?? DEFAULT_BLOCK_ANIMATION_FPS}`);
    h.update(`|action=${config.action ?? ''}`);
    h.update(`|pingPong=${config.pingPong ?? true}`);
    h.update(`|enhancePrompt=${config.enhancePrompt ?? true}`);
    if ((config.frameCount ?? 8) === 0) h.update('|animated=false');
    h.update('|views=1');
    // A CADEIA DE PROMPT entra no hash pela versão, não pelo texto: o texto
    // que chega ao fornecedor depende de haver ou não ANTHROPIC_API_KEY no
    // ambiente, e hashear isso faria uma variável de ambiente cobrar de novo
    // por um bloco já pago. O marcador sobe quando a cadeia muda de verdade.
    //
    // v2 (2026-08-04): a descrição passa a ser normalizada para inglês
    // pixel-art; a frase da imagem de referência sai do prompt quando o molde
    // não vai no request; o material entra no `action`. É outro artefato do
    // mesmo pedido, e o hash tem de dizer isso.
    //
    // CUSTO CONTADO ANTES DE MUDAR: existem exatamente 2 blocos pagos em
    // disco (assets/world-blocks/a880b32d82456c4e e df00c6479810988c, ambos
    // technique 'texture'). Eles continuam em disco, continuam no catálogo e
    // continuam renderizando — o hash novo não apaga nada e não regera nada
    // sozinho. O teto do prejuízo é 2 regerações, e só se o usuário pedir de
    // novo, de propósito, as MESMAS duas descrições.
    h.update('|prompt=2');
    // Os knobs de estilo do tile passaram a ser enviados no caminho 'texture'.
    // Só entram no hash quando DIVERGEM do default do endpoint (spec
    // vendorizado): mandar o default explícito produz a mesma arte que omitir,
    // e dois hashes para o mesmo artefato é pagar duas vezes. Bloco que não
    // mexe nos knobs hasheia hoje igual ao que hashearia antes deste bloco de
    // código — é por isso que a mudança acima é a ÚNICA invalidação.
    const guidance = config.textGuidanceScale ?? TILE_DEFAULT_TEXT_GUIDANCE;
    if (guidance !== TILE_DEFAULT_TEXT_GUIDANCE) h.update(`|guidance=${guidance}`);
    if (config.outline !== undefined && config.outline !== TILE_DEFAULT_OUTLINE) {
      h.update(`|outline=${config.outline}`);
    }
    if (config.shading !== undefined && config.shading !== TILE_DEFAULT_SHADING) {
      h.update(`|shading=${config.shading}`);
    }
    if (config.detail !== undefined && config.detail !== TILE_DEFAULT_DETAIL) {
      h.update(`|detail=${config.detail}`);
    }
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

/**
 * Teto de pixels do `/animate-with-text-v3`, do spec vendorizado.
 *
 * Texto literal (`openapi/openapi-v2.json`, capturado 2026-08-01):
 * "**Size Limits:** - Maximum image dimension: 256x256 pixels - Total pixel
 * budget: width × height × frame_count ≤ 524,288".
 */
export const ANIMATION_PIXEL_BUDGET = 524_288;

/**
 * A área que o `/animate-with-text-v3` de fato trabalha: `width × height ×
 * frame_count`.
 *
 * **Corrige uma estimativa que errava sempre para baixo.** Até 2026-08-04 o
 * guard chamava `estimateByArea(COST_TABLE['animate-with-text-v3'], 48 * 48)` —
 * a área de UM quadro, e ainda por cima de um quadro que este pipeline não usa
 * (o canônico é 48×53). O log saía `0.0221 USD` idêntico para `frameCount` 4, 8
 * e 16, quando o único parâmetro que multiplica o trabalho é justamente o
 * `frame_count`. Num repositório cuja regra dura é "nada de custo surpresa",
 * uma estimativa que não se move com o multiplicador não é estimativa.
 *
 * Duas armadilhas medidas, e vale registrar as duas:
 *
 * 1. **O literal `48*48` não mudava o número** — 2304 e 2544 caem os dois abaixo
 *    do primeiro ponto medido da `COST_TABLE` (64×64 = 4096) e `estimateByArea`
 *    prende no piso. Estava mascarado pelo clamp, e voltaria a importar no dia
 *    em que a tabela ganhasse um ponto menor. Corrigido junto, de propósito.
 * 2. **O que subestimava era ignorar o `frame_count`.** Com a área real de 8
 *    quadros de 48×53 (20 352) a conta passa do último ponto medido
 *    (128×128 = 16 384) e prende no teto: `0.0424 USD` de preço estimado,
 *    quase o dobro do que era logado.
 *
 * O orçamento é o do endpoint, não uma invenção deste módulo: o próprio spec
 * define o limite como `width × height × frame_count`. Preço **estimado** — a
 * PixelLab rotula a coluna como `Estimated Price* (USD)` e avisa que varia com
 * o tempo de GPU.
 */
export function animationPixelBudget(
  width: number,
  height: number,
  frameCount: number,
): number {
  const frames = Number.isFinite(frameCount) && frameCount > 0 ? frameCount : 1;
  return width * height * frames;
}

/**
 * O tamanho do PNG em disco, ou o quadro canônico quando ele não se deixa ler.
 *
 * Degradar para a constante é melhor que estourar: a estimativa é um AVISO
 * (ADR 0012, o guard informa e nunca recusa), e derrubar uma geração porque o
 * cabeçalho de um PNG não abriu seria transformar informação em bloqueio.
 */
function pngSizeOrCanonical(bytes: Buffer): { width: number; height: number } {
  try {
    const head = readPngHeader(bytes);
    if (head.width > 0 && head.height > 0) {
      return { width: head.width, height: head.height };
    }
  } catch {
    // segue para o canônico
  }
  return {
    width: BLOCK_GEOMETRY.spriteWidth,
    height: BLOCK_GEOMETRY.spriteHeight,
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
  /**
   * O material em inglês que a `description` do usuário virou — o texto que
   * de fato chegou ao fornecedor. `description` guarda o que foi digitado;
   * este campo, o que foi pedido.
   */
  readonly material?: string;
  /** Texto gerado pelo LLM (quando `action` não foi fornecido). */
  readonly llmGenerated?: boolean;
  /** true = textura animada; false = só o cubo base (frameCount 0). */
  readonly animated: boolean;
  /** Ping-pong (vai-e-volta) na reprodução. Default true. */
  readonly pingPong?: boolean;
  /** Texto expandido pela API via `enhance_prompt` (quando habilitado). */
  readonly enhancedPrompt?: string;
  /** Número de frames. 0 = sem animação. */
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

/**
 * Técnicas v3 que gravaram VISTAS numeradas em disco.
 *
 * Nenhum código atual as produz — o gerador que as escreveu não existe mais no
 * repositório. Elas estão declaradas porque seis blocos PAGOS existem assim em
 * `assets/world-blocks/`, e um catálogo que não os reconhece transforma arte
 * comprada em arquivo morto. Ler o disco é sempre mais barato que regerar.
 */
const VIEW_TECHNIQUES = ['rotate8-mould', 'rotate8-prompt'] as const;
type ViewTechnique = (typeof VIEW_TECHNIQUES)[number];

/**
 * Manifesto v3 com vistas numeradas (`view-0.png` … `view-7.png`).
 *
 * O campo que importa é o que ele NÃO garante: `frameKeying` vale
 * `"assumed-canonical-order"`, ou seja, ninguém verificou qual índice é a
 * vista isométrica de três faces. Por isso o catálogo entrega a lista inteira e
 * a escolha é medida no editor, não assumida aqui.
 */
interface WorldBlockManifestV3Views {
  readonly version: 3;
  readonly hash: string;
  readonly technique: ViewTechnique;
  readonly description: string;
  readonly geometry?: ManifestGeometry;
  /** Quantas vistas foram gravadas. */
  readonly views?: number;
  /** Rótulos das vistas, na ordem ASSUMIDA. Informativo, não confiável. */
  readonly view8Mapping?: string;
}

type WorldBlockManifest =
  | WorldBlockManifestV2
  | WorldBlockManifestV3
  | WorldBlockManifestV3Views;

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

  // v3: textura — faces ficam vazias. Animada: a spritesheet é o artefato;
  // estática (animated false, frameCount 0): o cubo base.
  if (manifest.version === 3 && manifest.technique === 'texture') {
    // Manifestos antigos (sem `animated`) são animados por definição.
    const animated = manifest.animated ?? true;
    const artifact = animated ? spritesheetPath(assetsDir, hash) : baseImagePath(assetsDir, hash);
    if (!existsSync(artifact)) return null;
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

/**
 * Como o catálogo classifica o que achou em disco.
 *
 * Não é o enum de GERAÇÃO (`BLOCK_TECHNIQUES`): aquele valida o que o POST
 * aceita produzir, e nada mais pode ser adicionado a ele sem uma ADR. `'views'`
 * descreve arte que EXISTE em disco, gravada por um gerador anterior, com
 * várias vistas numeradas e nenhuma delas declarada canônica. Misturar os dois
 * enums criaria uma técnica que o servidor lista mas não sabe gerar.
 */
export type CatalogTechnique = BlockTechnique | 'views';

/** Uma entrada do catálogo lido por GET /api/world-blocks. */
export interface WorldBlockSummary {
  readonly hash: string;
  readonly description: string;
  readonly shape: TileShape;
  readonly technique: CatalogTechnique;
  /** Projeção em que o bloco está desenhado. */
  readonly geometry: ManifestGeometry;
  /** Face → caminho público (v2: 4 faces). Ausente em v3 (texture). */
  readonly faceUrls?: Readonly<Record<BlockFacing, string>>;
  /** Caminho da spritesheet (v3: texture animada). Ausente nos demais. */
  readonly spritesheetUrl?: string;
  /** Caminho do sidecar de animação (v3: texture animada). */
  readonly animationUrl?: string;
  /** Caminho do cubo base (v3: texture SEM animação, frameCount 0). */
  readonly baseUrl?: string;
  /** true = textura animada; false = só o cubo base (v3: texture). */
  readonly animated?: boolean;
  /** Ping-pong (vai-e-volta) na reprodução (v3: texture animada). Default true. */
  readonly pingPong?: boolean;
  /** Número de frames (v3: texture). 0 = sem animação. */
  readonly frameCount?: number;
  /** FPS da animação (v3: texture animada). */
  readonly fps?: number;
  /**
   * Vistas gravadas em disco, quando há mais de uma e nenhuma é declarada
   * canônica (`technique: 'views'`).
   *
   * É uma LISTA, e não uma URL, de propósito: o manifesto desses blocos grava
   * `frameKeying: "assumed-canonical-order"` — a ordem das vistas é assumida e
   * nunca foi verificada. Quem escolhe é o editor, medindo a silhueta de cada
   * candidata contra a forma canônica do cubo. Entregar aqui um índice
   * adivinhado seria transformar uma incerteza declarada num número que parece
   * certeza.
   */
  readonly spriteUrls?: readonly string[];
}

/**
 * Vistas numeradas de um bloco em disco (`view-0.png`, `view-1.png`, …).
 *
 * Blocos gravados por gerações anteriores usam esse formato. Nenhum código
 * atual o PRODUZ — mas seis blocos pagos existem assim em disco, e enquanto o
 * catálogo não os reconhecia eles simplesmente não apareciam na paleta. Ler o
 * que já foi pago é sempre mais barato que regerar.
 *
 * Ordena por número, não por nome: `view-10` vem depois de `view-9`.
 */
async function readViewUrls(
  assetsDir: string,
  hash: string,
): Promise<readonly string[]> {
  const dir = blockDir(assetsDir, hash);
  if (!existsSync(dir)) return [];
  try {
    const files = await readdir(dir);
    return files
      .map((name) => /^view-(\d+)\.png$/.exec(name))
      .filter((m): m is RegExpExecArray => m !== null)
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .map((m) => `/world-blocks/${hash}/${m[0]}`);
  } catch {
    return [];
  }
}

/**
 * Catálogo dos blocos completos em disco — é daqui que o map-builder monta a
 * paleta. Só entram blocos com manifesto completo: v2 com as 4 faces ou v3 com
 * a spritesheet.
 *
 * **É aqui que a folha de um bloco animado é conferida contra os frames**
 * (`repackSpritesheetIfStale`), porque é o único ponto por onde todo bloco passa
 * antes de o editor tentar desenhá-lo. Custa a leitura de um JSON e do CABEÇALHO
 * de alguns PNGs — os pixels só são inflados quando a folha vai mesmo ser
 * reescrita. Só escreve quando a folha está de fato errada, e nunca chama a API.
 */
export async function listWorldBlocks(
  assetsDir: string,
  onLog?: (m: string) => void,
): Promise<WorldBlockSummary[]> {
  const root = join(assetsDir, 'world-blocks');
  if (!existsSync(root)) return [];

  // readdir vem do import estático do topo (antes era import dinâmico aqui;
  // com `deleteWorldBlock` usando o mesmo símbolo, dois caminhos para a mesma
  // função só criariam sombra de escopo).
  const entries = await readdir(root, { withFileTypes: true });
  const out: WorldBlockSummary[] = [];

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const hash = e.name;
    const manifest = await readManifestFile(assetsDir, hash);
    if (!manifest) continue;

    if (manifest.version === 3 && manifest.technique === 'texture') {
      // Manifestos antigos (sem `animated`) são animados por definição.
      const animated = manifest.animated ?? true;
      if (animated) {
        if (!existsSync(spritesheetPath(assetsDir, hash))) continue;
        // Folha legada (gravada com o quadro fixo antigo) volta a bater com os
        // frames aqui, de graça. Idempotente: na segunda passada não faz nada.
        await repackSpritesheetIfStale(assetsDir, hash, onLog);
        out.push({
          hash,
          description: manifest.description,
          shape: 'block', // o cubo base da textura animada é sempre 'block'
          technique: 'texture',
          // A geometria GRAVADA manda; a constante é só o piso de um manifesto
          // antigo que não a tenha. Publicar a constante por cima do manifesto
          // (como este ramo fazia até 2026-08-04, enquanto os ramos `views` e
          // v2 já liam o disco) é invisível só enquanto as duas coincidem: no
          // dia em que a geometria do projeto mudar, os blocos PAGOS com a
          // antiga passariam a ser publicados com a nova e o editor desenharia
          // arte comprada na projeção errada, sem nada reclamar.
          geometry: manifest.geometry ?? MANIFEST_GEOMETRY,
          animated: true,
          spritesheetUrl: `/world-blocks/${hash}/spritesheet.png`,
          animationUrl: `/world-blocks/${hash}/animation.json`,
          // O cubo base existe mesmo quando há animação, e é ELE que o editor
          // 3D usa como sprite do bloco — a spritesheet é uma tira plana de
          // quadros do mesmo tamanho do frame que a API devolveu (o do cubo
          // base), e nenhum deles descreve o volume. Declarar a URL aqui evita
          // que o cliente a adivinhe a partir do hash.
          ...(existsSync(baseImagePath(assetsDir, hash))
            ? { baseUrl: `/world-blocks/${hash}/base.png` }
            : {}),
          frameCount: manifest.frameCount,
          fps: manifest.fps,
          pingPong: manifest.pingPong ?? true,
        });
      } else {
        // frameCount 0 — sem animação: o cubo base é o artefato.
        if (!existsSync(baseImagePath(assetsDir, hash))) continue;
        out.push({
          hash,
          description: manifest.description,
          shape: 'block',
          technique: 'texture',
          // Mesma correção do ramo animado, logo acima.
          geometry: manifest.geometry ?? MANIFEST_GEOMETRY,
          animated: false,
          baseUrl: `/world-blocks/${hash}/base.png`,
          frameCount: 0,
        });
      }
      continue;
    }

    if (manifest.version === 3) {
      // v3 que NÃO é 'texture': arte de um gerador anterior, gravada como
      // vistas numeradas. Entra no catálogo como 'views' — a paleta mostra, o
      // editor escolhe a vista canônica medindo a silhueta.
      const spriteUrls = await readViewUrls(assetsDir, hash);
      if (spriteUrls.length === 0) continue;
      out.push({
        hash,
        description: manifest.description,
        shape: 'block',
        technique: 'views',
        geometry: manifest.geometry ?? MANIFEST_GEOMETRY,
        spriteUrls,
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

// ---- remoção

/**
 * Formato do hash de bloco: 16 hexadecimais, exatamente o que
 * `worldBlockHash` produz. A mesma regra que `GET /api/world-block/{hash}`
 * usa, repetida aqui de propósito — `deleteWorldBlock` é chamável fora do
 * HTTP e não pode depender de quem chama ter validado. Uma remoção que aceite
 * caminho arbitrário apaga a árvore inteira do usuário.
 *
 * Em JavaScript, `$` sem a flag `m` casa só o fim REAL da string (não aceita
 * `\n` final como Perl e Python), então isto também recusa hash com quebra de
 * linha grudada.
 */
const BLOCK_HASH_PATTERN = /^[a-f0-9]{16}$/i;

/** true quando `value` é um hash de bloco (16 hexadecimais) e nada mais. */
export function isWorldBlockHash(value: unknown): value is string {
  return typeof value === 'string' && BLOCK_HASH_PATTERN.test(value);
}

/** O que a remoção de um bloco encontrou e desfez. */
export interface WorldBlockDeletion {
  readonly hash: string;
  /**
   * true quando o diretório existia antes desta chamada. false NÃO é erro:
   * a remoção é idempotente, apagar duas vezes responde igual.
   */
  readonly existed: boolean;
  /** Quantos arquivos havia no diretório (recursivo). 0 quando não existia. */
  readonly removedFiles: number;
  /**
   * Havia stub de trabalho JÁ PAGO esperando retomada — `*.pending.json` (o
   * tile e a animação) ou `v3/character.json` — e ele foi embora junto. Quem
   * chama tem que dizer isso ao usuário: aquele stub era o caminho de volta
   * GRATUITO a um artefato que a PixelLab já cobrou.
   */
  readonly pendingDiscarded: boolean;
}

/** Lista recursiva dos arquivos de um diretório. Diretório ilegível conta zero. */
async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(current, e.name);
      if (e.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

const PENDING_STUB_SUFFIX = '.pending.json';

/**
 * Apaga o diretório inteiro de um bloco: `block.json`, `base.png`, `frames/`,
 * `spritesheet.png`/`.json`, `animation.json`, as faces do formato v2
 * (`north.png` … `west.png`, `source.png`, `v3/`) e qualquer outro arquivo que
 * esteja lá dentro — inclusive de formatos antigos que este código não conhece
 * mais.
 *
 * **Irreversível, e o dinheiro da geração não volta.** Não há lixeira: a
 * decisão de confirmar é de quem chama (a tela usa pressionar-e-segurar).
 *
 * **Idempotente:** apagar um bloco que já não existe devolve
 * `existed: false` e não é erro — a segunda tentativa de uma rota DELETE não
 * pode falhar só por chegar depois da primeira.
 *
 * **Parcialidade:** remover uma árvore não é atômico. Por isso o manifesto sai
 * PRIMEIRO e sozinho: `listWorldBlocks` e `readWorldBlockResult` só enxergam
 * bloco com `block.json` válido, então uma falha no meio da remoção deixa
 * restos invisíveis ao catálogo em vez de um bloco listado cujos PNGs sumiram.
 * A ordem é o que impede a parcialidade de virar peça quebrada na paleta.
 */
export async function deleteWorldBlock(
  assetsDir: string,
  hash: string,
): Promise<WorldBlockDeletion> {
  if (!isWorldBlockHash(hash)) {
    throw new WorldBlockValidationError(
      'hash-format',
      `"${String(hash)}" não é hash de bloco: são 16 caracteres hexadecimais. Nada foi apagado.`,
    );
  }

  const dir = blockDir(assetsDir, hash);
  // Cinto e suspensório. O hash já foi validado, mas a remoção só acontece
  // DENTRO de world-blocks/ — a regex pode ser afrouxada um dia, e este
  // recorte é a última linha antes de um `rm -rf` na árvore do usuário.
  const root = resolve(join(assetsDir, 'world-blocks'));
  if (!resolve(dir).startsWith(`${root}${sep}`)) {
    throw new WorldBlockValidationError(
      'hash-format',
      `o caminho do bloco "${hash}" cai fora de world-blocks/. Nada foi apagado.`,
    );
  }

  if (!existsSync(dir)) {
    return { hash, existed: false, removedFiles: 0, pendingDiscarded: false };
  }

  const files = await listFilesRecursive(dir);
  const pendingDiscarded = files.some(
    (f) => f.endsWith(PENDING_STUB_SUFFIX) || f === v3StubPath(assetsDir, hash),
  );

  const manifest = manifestPath(assetsDir, hash);
  if (existsSync(manifest)) await unlink(manifest);
  await rm(dir, { recursive: true, force: true });

  return { hash, existed: true, removedFiles: files.length, pendingDiscarded };
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
  [/\b(bone|skull|skeleton|ivory)\b/i, 'bone surface with subtle pale shimmer and slow shifting shadows in the crevices'],
];

function fallbackAction(description: string): string {
  for (const [re, action] of ACTION_FALLBACK) {
    if (re.test(description)) return action;
  }
  return 'subtle ambient motion with gentle light variations and soft texture shimmer';
}

/**
 * Costura o material dentro da ação da animação.
 *
 * **`action` é o ÚNICO texto que o `/animate-with-text-v3` recebe** — o
 * required do endpoint é `first_frame` + `action`, e mais nada carrega a
 * descrição do bloco. Antes desta correção o material morria no estágio do
 * tile: a animação via só um movimento genérico, e o resultado prova. O bloco
 * pago `df00c6479810988c` foi pedido como "quero um cubo de ossos", recebeu a
 * ação-coringa `"subtle ambient motion…"` e voltou com um `enhanced_prompt`
 * que fala de "cubic stone structure" — pedra, não osso. A API expandiu o que
 * ela recebeu, e o que ela recebeu não dizia osso em lugar nenhum.
 *
 * Se a ação já nomeia o material (o caso comum quando o LLM a escreveu), não
 * repete: prompt com o mesmo substantivo duas vezes não guia melhor.
 */
export function actionWithMaterial(action: string, material: string): string {
  const act = action.trim();
  const mat = material.trim();
  if (mat === '') return act;
  const alreadyNamed = new RegExp(
    `\\b${mat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
    'i',
  ).test(act);
  const composed = alreadyNamed ? act : `${act}, on a pixel art cube made of ${mat}`;
  return composed.slice(0, 500);
}

/**
 * Gera o texto de ação da animação via LLM.
 *
 * Chama a Anthropic API com uma chave do ambiente (`ANTHROPIC_API_KEY`).
 * Em caso de falha (sem chave, sem rede, erro da API), cai no fallback
 * determinístico.
 *
 * **Recebe o MATERIAL normalizado, não a descrição crua.** A tabela de
 * `ACTION_FALLBACK` é toda de regexes em inglês: contra "quero um cubo de
 * ossos" nenhuma das treze casava e todo bloco caía na mesma string-coringa.
 * Contra "bone" a tabela funciona — a normalização conserta o fallback de
 * graça, além de consertar o prompt.
 */
async function generateActionViaLlm(
  material: string,
  onLog?: (m: string) => void,
): Promise<{ action: string; llmGenerated: boolean }> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    onLog?.('[world-block] ANTHROPIC_API_KEY não definida — usando fallback para ação da animação.');
    return { action: fallbackAction(material), llmGenerated: false };
  }

  try {
    const prompt = [
      'Given an isometric pixel-art block made of:',
      `"${material}"`,
      '',
      'Write a short animation action for a pixel-art sprite animation API.',
      'Describe subtle ambient motion appropriate for this material,',
      'and name the material explicitly — the animation endpoint receives the',
      'action text and nothing else about the block.',
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
      return { action: fallbackAction(material), llmGenerated: false };
    }

    const body = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = body.content?.find((c) => c.type === 'text')?.text?.trim();
    if (!text || text.length === 0) {
      onLog?.('[world-block] LLM devolveu resposta vazia — usando fallback.');
      return { action: fallbackAction(material), llmGenerated: false };
    }

    // Limpa formatação residual que o LLM possa ter incluído
    const clean = text.replace(/^["']|["']$/g, '').replace(/\n+/g, ' ').trim();
    onLog?.(`[world-block] ação gerada por LLM: "${clean.slice(0, 80)}${clean.length > 80 ? '…' : ''}"`);
    return { action: clean.slice(0, 500), llmGenerated: true };
  } catch (err) {
    onLog?.(
      `[world-block] falha ao chamar LLM: ${err instanceof Error ? err.message : String(err)} — usando fallback.`,
    );
    return { action: fallbackAction(material), llmGenerated: false };
  }
}

// ---- geração do cubo base (tile, técnica 'texture')

/**
 * Gera o cubo pixel-art do material via /create-isometric-tile.
 *
 * O `description` que chega aqui é o MATERIAL já normalizado para inglês
 * pixel-art (`normalizeMaterialViaLlm`), nunca o texto cru do usuário: o
 * fornecedor não sabe o que desenhar com "quero um cubo de ossos".
 *
 * O molde do cubo (cube-mould.ts) entra como `init_image` na força do spec
 * (TEXTURE_INIT_IMAGE_STRENGTH): o endpoint não tem parâmetro de proporção,
 * então a referência é a alavanca de forma que existe. A vista é a
 * 'low top-down' do projeto (ADR 0005).
 *
 * O endpoint devolve PIXELS RGBA CRUS no canvas da API (48×56, múltiplo de 4)
 * — apiBytesToCanonicalPng() recorta para o quadro canônico 48×53 antes de
 * tocar o disco.
 *
 * O `init_image` do /create-isometric-tile está QUEBRADO no fornecedor
 * (verificado 2026-08-01, spec "dev"): a validação Pydantic exige PNG e o
 * worker exige RGBA cru — nenhum payload satisfaz os dois estágios. O 422 é
 * SÍNCRONO e custa $0: quando recusada, resubmete SEM o molde — **e o prompt é
 * reescrito junto**, sem a frase que manda casar com a referência. Antes desta
 * correção a frase ficava pendurada num request que não levava imagem alguma,
 * competindo com o material pedido. Quando o fornecedor consertar, a primeira
 * tentativa volta a valer e o fallback nunca dispara.
 *
 * Os knobs de estilo do tile vão quando configurados, e o `text_guidance_scale`
 * vai SEMPRE: é ele que decide "how closely to follow the text description", e
 * deixá-lo implícito era metade do problema desta bancada. Cada um entra no
 * hash só quando diverge do default do endpoint (ver `inputHash`). O shape
 * continua 'block' FIXO.
 */
async function generateBaseImage(
  client: PixelLabClient,
  description: string,
  seed: number,
  basePath: string,
  apiSize: ImageSize,
  frameSize: ImageSize,
  config: WorldBlockConfig,
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
    description: cubePrompt(description, { hasReference: true }),
    image_size: apiSize,
    isometric_tile_shape: 'block',
    // "How closely to follow the text description" (spec). Vai sempre.
    text_guidance_scale: config.textGuidanceScale ?? TILE_DEFAULT_TEXT_GUIDANCE,
    ...(config.outline !== undefined ? { outline: config.outline } : {}),
    ...(config.shading !== undefined ? { shading: config.shading } : {}),
    ...(config.detail !== undefined ? { detail: config.detail } : {}),
    init_image: asBase64Image(padPngToApiCanvas(mouldBase64(), apiSize)),
    init_image_strength: TEXTURE_INIT_IMAGE_STRENGTH,
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
    // Sem molde, a frase que manda casar com a referência sai do prompt junto
    // com a referência. Deixá-la é pedir ao modelo que copie uma imagem que
    // ninguém mandou.
    params['description'] = cubePrompt(description);
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
  /**
   * O material em inglês que a descrição do usuário virou — o texto que de
   * fato foi para o fornecedor. Gravado porque, quando o bloco sai errado, a
   * primeira pergunta é "o que exatamente foi pedido?", e até 2026-08-04 a
   * resposta não existia em lugar nenhum.
   */
  readonly material?: string;
  readonly llmGenerated?: boolean;
  /** Ping-pong (vai-e-volta) na reprodução. Default true. */
  readonly pingPong?: boolean;
  /** `enhance_prompt` enviado ao /animate-with-text-v3. Default true. */
  readonly enhancePrompt?: boolean;
  /** Texto expandido devolvido pela API no `enhanced_prompt` (quando habilitado). */
  readonly enhancedPrompt?: string;
}

/**
 * Grava por arquivo temporário + `rename`.
 *
 * **Não é zelo: é o conserto de uma corrupção medida.** `spritesheet.png` e
 * `spritesheet.json` são reescritos DENTRO de `listWorldBlocks`, que atende
 * `GET /api/world-blocks`, enquanto `GET /world-blocks/<hash>/spritesheet.png`
 * serve o mesmo arquivo com um `readFile` simples. Com `writeFile` puro, um
 * leitor concorrente enxerga a janela do `O_TRUNC` (0 byte) e as escritas
 * parciais no meio do caminho — 153 de 1372 leituras concorrentes vieram
 * truncadas numa medição de 40 rodadas, com tamanhos 0, 7965 e 8192 para um
 * arquivo final de 8296. O navegador recebe corpo cortado, `img.onerror`
 * dispara, e o bloco animado degrada para quadro parado justamente na primeira
 * carga, que é quando o re-empacotamento acontece.
 *
 * `rename` dentro do mesmo sistema de arquivos é atômico no POSIX: o leitor vê
 * o arquivo antigo INTEIRO ou o novo INTEIRO, nunca uma mistura.
 *
 * O sufixo é aleatório, e não derivado de pid+relógio, pelo mesmo motivo que o
 * `writeStudioFile` de `api.ts` documenta: dois saves nunca podem dividir o
 * mesmo caminho temporário. Aqui é defesa em profundidade — `withSheetLock` já
 * serializa —, e defesa em profundidade é o que sobra quando a serialização for
 * refatorada por alguém que não leu este comentário.
 */
async function writeFileAtomically(path: string, data: Buffer | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, path);
  } catch (err) {
    // O temporário nunca pode virar lixo permanente ao lado da arte paga.
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Uma corrente de promessas por bloco, para serializar quem escreve a folha.
 *
 * A chave é `assetsDir` + hash porque o mesmo hash pode existir em dois
 * catálogos (os testes usam um diretório temporário por caso) e travar por hash
 * puro faria um teste esperar pelo outro sem necessidade.
 */
const sheetLocks = new Map<string, Promise<unknown>>();

function sheetLockKey(assetsDir: string, hash: string): string {
  return `${assetsDir} ${hash}`;
}

/**
 * Serializa, por bloco, tudo o que lê-decide-e-reescreve a folha.
 *
 * **Sem isto, a atomicidade do `rename` não basta.** Dois `GET
 * /api/world-blocks` sobrepostos — duas abas, ou o poll de 3 s do painel de
 * blocos cruzando com o `loadPalette()` do editor de mapa — leem os mesmos
 * `frames/`, chegam os dois à conclusão de que a folha está obsoleta e
 * re-empacotam em cima um do outro. Com o lock, o segundo espera, relê o atlas
 * JÁ corrigido pelo primeiro e não faz nada: é assim que a idempotência
 * declarada em `repackSpritesheetIfStale` continua valendo sob concorrência, e
 * não só quando as chamadas vêm em fila.
 *
 * A corrente nunca trava: o erro vai para o chamador, mas o elo seguinte roda.
 * A entrada sai do mapa quando ninguém mais está atrás dela, então o mapa não
 * cresce com o catálogo.
 */
function withSheetLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const prev = sheetLocks.get(key) ?? Promise.resolve();
  const run = prev.then(work);
  const tail = run.then(
    () => {},
    () => {},
  );
  sheetLocks.set(key, tail);
  void tail.then(() => {
    if (sheetLocks.get(key) === tail) sheetLocks.delete(key);
  });
  return run;
}

/**
 * Escreve os frames de animação como PNGs individuais e um atlas JSON no
 * formato PixiJS (TexturePacker-compatible).
 *
 * Sem dependência de sharp: os frames já chegam como PNGs prontos da API.
 * A "spritesheet" é uma tira horizontal montada copiando os buffers PNG
 * decodificados como RGBA cru.
 *
 * **O quadro sai do frame decodificado, nunca de um número fixo.** Até
 * 2026-08-04 este código assumia 48×48; o `first_frame` que ele mesmo manda é
 * o cubo canônico 48×53, e o `/animate-with-text-v3` devolve frames do tamanho
 * do primeiro. Os dois blocos pagos em disco provam o estrago: os PNGs em
 * `frames/` são 48×53 e as folhas gravadas ficaram 432×48 e 240×48 — as cinco
 * linhas da base do cubo, já pagas, foram cortadas de toda a spritesheet. Pior
 * ainda seria um frame de largura diferente: o laço copiava com passo
 * `y * 48 * 4` sobre um buffer de outra largura e cisalharia a folha inteira.
 * Agora o passo é a largura REAL de cada frame, e o recorte é o mínimo entre
 * frame e quadro.
 */
async function packSpritesheet(
  assetsDir: string,
  hash: string,
  frames: readonly Buffer[],
  sidecar: AnimSidecar,
  onLog?: (m: string) => void,
): Promise<void> {
  if (frames.length === 0) throw new Error('sem frames para empacotar');

  // Sob o MESMO lock do re-empacotamento: um `GET /api/world-blocks` que caia
  // no meio da gravação dos frames veria uma pasta `frames/` incompleta ao lado
  // de uma folha antiga e concluiria, com razão aparente, que precisa
  // re-empacotar — reescrevendo a folha com metade dos quadros.
  return withSheetLock(sheetLockKey(assetsDir, hash), async () => {
    // Salva frames individuais
    const framesDir = join(blockDir(assetsDir, hash), 'frames');
    await mkdir(framesDir, { recursive: true });

    const decoded: DecodedFrame[] = [];
    for (let i = 0; i < frames.length; i++) {
      const png = frames[i]!;
      await writeFileAtomically(
        join(framesDir, `frame_${String(i).toString().padStart(3, '0')}.png`),
        png,
      );
      decoded.push(decodeFrame(png, i));
    }

    await writeSheet(assetsDir, hash, decoded, onLog);
    await writeFileAtomically(
      animSidecarPath(assetsDir, hash),
      `${JSON.stringify(sidecar, null, 2)}\n`,
    );

    onLog?.(
      `[world-block] spritesheet empacotada: ${decoded.length} frames, ${sidecar.fps} fps`,
    );
  });
}

/** Um frame já decodificado em RGBA cru. */
interface DecodedFrame {
  readonly width: number;
  readonly height: number;
  readonly rgba: Buffer;
}

/**
 * Decodifica UM frame, aceitando PNG e RGBA cru.
 *
 * Fallback de decodificação: só entra em cena se o fornecedor mandar RGBA cru
 * em vez de PNG, como o /create-isometric-tile faz (ver png.ts).
 *
 * São DUAS formas aceitas, e não uma. A canônica é o cubo 48×53, o tamanho do
 * `first_frame` que este código manda. A outra é a quadrada 48×48, que era a
 * única aceita até 2026-08-04 — e não há evidência nenhuma de que ela tenha
 * deixado de poder ocorrer: o `/animate-with-text-v3` não documenta o tamanho
 * do frame que devolve, e blocos gerados antes daquela correção existem em
 * disco. Estreitar o aceite sem prova transformaria em exceção um frame JÁ PAGO
 * que hoje é gravado sem reclamação. Um buffer cru só casa uma das duas formas
 * (9216 ≠ 10176 bytes), então aceitar as duas não é ambíguo.
 */
function decodeFrame(bytes: Buffer, index: number): DecodedFrame {
  try {
    return decode(bytes);
  } catch {
    const shape = rawFrameShape(bytes.length);
    if (shape) return { width: shape[0], height: shape[1], rgba: bytes };
    throw new Error(notAFrameMessage(index, bytes.length));
  }
}

/** As duas formas de RGBA cru aceitas, na ordem em que são testadas. */
function rawFrameShapes(): ReadonlyArray<readonly [number, number]> {
  const canonW = BLOCK_GEOMETRY.spriteWidth;
  const canonH = BLOCK_GEOMETRY.spriteHeight;
  return [
    [canonW, canonH],
    [canonW, canonW],
  ];
}

function rawFrameShape(byteLength: number): readonly [number, number] | undefined {
  return rawFrameShapes().find(([w, h]) => byteLength === w * h * 4);
}

function notAFrameMessage(index: number, byteLength: number): string {
  return (
    `frame ${index} não é PNG nem RGBA cru de ` +
    rawFrameShapes()
      .map(([w, h]) => `${w}×${h}`)
      .join(' ou ') +
    ` (${byteLength} bytes)`
  );
}

/**
 * O tamanho de um frame lendo só o CABEÇALHO — sem inflar os pixels.
 *
 * **Conserta uma regressão medida, não uma micro-otimização.** A decisão de
 * re-empacotar (`sheetNeedsRepack`) precisa de `width` e `height` e de mais
 * nada, mas até 2026-08-04 `repackSpritesheetIfStale` chamava `decodeFrame` em
 * TODOS os quadros antes de decidir — inflate + unfilter completos, a cada
 * `GET /api/world-blocks`, mesmo quando não havia nada a fazer. Com 50 blocos
 * de 9 quadros o catálogo saiu de 8,7–13,4 ms para 130–147 ms; dos 450 quadros,
 * `decodePngToRgba` custava 89 ms contra 2,5 ms de `readPngHeader`. Com os dois
 * blocos que existem hoje em disco a diferença é de ~5 ms e some no ruído — o
 * que é exatamente o motivo de a regressão ter passado.
 *
 * Aceita as mesmas duas formas que `decodeFrame`: um buffer de RGBA cru não tem
 * cabeçalho, e a forma sai do tamanho em bytes.
 *
 * Ler o cabeçalho é metade do conserto; a outra metade é ler MENOS arquivos —
 * ver `FramesOnDisk`. Na mesma bancada de 50 blocos × 9 quadros, com o catálogo
 * já correto, o `listWorldBlocks` mediu 83,5–112,8 ms decodificando tudo contra
 * 16,1–30,9 ms lendo só o que a decisão consome, com o `main` (que não conferia
 * nada) em 3,5–16,0 ms. Com os 2 blocos reais em disco: 3,1–7,5 ms contra
 * 0,7–2,0 ms, com o `main` em 0,2–4,9 ms.
 */
function frameHeaderSize(bytes: Buffer, index: number): { width: number; height: number } {
  try {
    const head = readPngHeader(bytes);
    if (head.width > 0 && head.height > 0) {
      return { width: head.width, height: head.height };
    }
  } catch {
    // segue para o RGBA cru
  }
  const shape = rawFrameShape(bytes.length);
  if (shape) return { width: shape[0], height: shape[1] };
  throw new Error(notAFrameMessage(index, bytes.length));
}

/**
 * Monta a tira horizontal e o atlas a partir dos frames decodificados, e grava
 * os dois. **Não** toca no sidecar nem nos PNGs de `frames/`.
 *
 * Separado de `packSpritesheet` porque o re-empacotamento das folhas legadas
 * (`repackSpritesheetIfStale`) precisa exatamente disto e de mais nada: os
 * frames já estão em disco, íntegros, e o sidecar já está certo — o que está
 * errado é só a folha.
 *
 * **A ordem PNG-antes-do-atlas é deliberada, não acidente.** Os dois arquivos
 * vão para o disco atomicamente, um de cada vez; entre um `rename` e o outro há
 * uma janela em que a folha é a nova e o atlas ainda é o velho. Gravar nesta
 * ordem faz dessa janela um estado que se AUTODENUNCIA: o atlas antigo declara
 * dimensões que não são as da folha nova, `sheetNeedsRepack` acusa na leitura
 * seguinte e o conserto se completa sozinho, de graça. Na ordem inversa o atlas
 * novo descreveria a folha velha — coerente com os frames, mentindo sobre os
 * pixels, e invisível para sempre. Não assuma que dá na mesma.
 *
 * Não toma o lock: quem chama já está dentro dele (`packSpritesheet` e
 * `repackSpritesheetIfStale`), e reentrar travaria de vez.
 */
async function writeSheet(
  assetsDir: string,
  hash: string,
  decoded: readonly DecodedFrame[],
  onLog?: (m: string) => void,
): Promise<void> {
  // O quadro da folha é o do PRIMEIRO frame decodificado — é o tamanho que a
  // API devolveu, que é o tamanho do first_frame que mandamos.
  const first = decoded[0]!;
  const frameWidth = first.width;
  const frameHeight = first.height;
  const ragged = decoded.some((d) => d.width !== frameWidth || d.height !== frameHeight);
  if (ragged) {
    onLog?.(
      `[world-block] AVISO: os frames não têm todos ${frameWidth}×${frameHeight}. ` +
        'A folha usa o quadro do primeiro e recorta o resto — nada é cisalhado, ' +
        'mas pode faltar borda em algum frame.',
    );
  }

  // Monta tira horizontal como RGBA cru
  const totalWidth = frameWidth * decoded.length;
  const totalHeight = frameHeight;
  const sheetRgba = Buffer.alloc(totalWidth * totalHeight * 4);

  for (let i = 0; i < decoded.length; i++) {
    const img = decoded[i]!;
    const rows = Math.min(img.height, frameHeight);
    const cols = Math.min(img.width, frameWidth);
    for (let y = 0; y < rows; y++) {
      // O passo da ORIGEM é a largura do próprio frame; o do DESTINO é a folha.
      const srcOff = y * img.width * 4;
      const dstOff = (y * totalWidth + i * frameWidth) * 4;
      img.rgba.copy(sheetRgba, dstOff, srcOff, srcOff + cols * 4);
    }
  }

  // Codifica a spritesheet como PNG
  const sheetPng = encodePngFromRgba(sheetRgba, totalWidth, totalHeight);
  await writeFileAtomically(spritesheetPath(assetsDir, hash), sheetPng);

  // Atlas JSON (formato TexturePacker)
  const atlasFrames: Record<string, {
    frame: { x: number; y: number; w: number; h: number };
    rotated: boolean;
    trimmed: boolean;
    spriteSourceSize: { x: number; y: number; w: number; h: number };
    sourceSize: { w: number; h: number };
  }> = {};

  const animFrames: string[] = [];
  for (let i = 0; i < decoded.length; i++) {
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

  await writeFileAtomically(atlasPath(assetsDir, hash), `${JSON.stringify(atlas, null, 2)}\n`);

  onLog?.(
    `[world-block] folha gravada: ${totalWidth}×${totalHeight}, ` +
      `${decoded.length} quadros de ${frameWidth}×${frameHeight}`,
  );
}

// ---- coexistência de folhas antigas e novas

/** O que o `spritesheet.json` em disco declara sobre a folha. */
export interface SheetDeclaration {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly frameCount: number;
  readonly sheetWidth: number;
  readonly sheetHeight: number;
}

/**
 * O que `frames/` tem, do ponto de vista de quem decide re-empacotar.
 *
 * **É a lista INTEIRA que não é preciso ler, e o tipo existe para dizer isso.**
 * A decisão consome exatamente duas coisas: quantos PNGs há — o `readdir` já
 * entrega de graça — e o quadro do PRIMEIRO, que é o quadro que `writeSheet`
 * impõe à folha inteira. Passar um array de tamanhos convidava a lê-los todos,
 * e foi assim que a checagem passou a inflar 450 PNGs a cada leitura do
 * catálogo (ver `frameHeaderSize`). Com este tipo, ler mais do que isto vira
 * trabalho visivelmente inútil em vez de descuido invisível.
 *
 * Frames desiguais entre si continuam não sendo detectados aqui — nunca foram.
 * Quem avisa é `writeSheet`, na hora de escrever, onde os tamanhos de verdade
 * já estão em mãos.
 */
export interface FramesOnDisk {
  /** Quantos PNGs `frame_NNN.png` existem em `frames/`. */
  readonly count: number;
  /** O quadro do primeiro frame. `null` quando não há frame legível. */
  readonly first: { readonly width: number; readonly height: number } | null;
}

/**
 * A folha declarada bate com os frames que estão ao lado dela?
 *
 * **Pura, e é o coração da coexistência.** `packSpritesheet` foi corrigido numa
 * onda anterior para usar a dimensão REAL do quadro, mas as duas folhas já
 * gravadas ficaram com o antigo 48×48 fixo: `a880b32d82456c4e` é 432×48 (9
 * quadros) e `df00c6479810988c` é 240×48 (5), enquanto os `frames/*.png` e o
 * `base.png` correspondentes estão íntegros em 48×53. Ou seja: o
 * `spritesheet.json` desses dois CONTRADIZ os PNGs ao lado.
 *
 * Enquanto ninguém lia a folha, isso era inofensivo. O editor 3D passou a ler.
 *
 * Devolve `null` quando está tudo certo (ou quando não há como decidir), e o
 * motivo em português quando a folha precisa ser reescrita. Nunca é uma migração
 * de mão única: a decisão é por CONTEÚDO, então re-empacotar duas vezes dá o
 * mesmo resultado e a segunda vez não faz nada.
 *
 * `sheet` é o cabeçalho REAL do `spritesheet.png` — `null` quando os bytes não
 * se deixam ler como PNG, `undefined` quando o chamador não quis olhar. Até
 * 2026-08-04 esta função só comparava o `.json` com os frames, e uma folha com
 * os pixels corrompidos ao lado de um atlas coerente era invisível para sempre:
 * o editor recusava a folha e nada nunca a reescrevia. Ler o cabeçalho custa o
 * mesmo que já se paga por cada frame.
 */
export function sheetNeedsRepack(
  declared: SheetDeclaration | null,
  frames: FramesOnDisk,
  sheet?: { readonly width: number; readonly height: number } | null,
): string | null {
  // Sem frames em disco não há de onde re-empacotar. Refazer a folha a partir
  // dela mesma seria trocar seis por meia dúzia — e apagar arte paga.
  const first = frames.first;
  if (frames.count === 0 || first === null) return null;
  if (!declared) return 'não há spritesheet.json legível ao lado dos frames';

  if (sheet === null) return 'o spritesheet.png não se deixa ler como PNG';
  if (
    sheet !== undefined &&
    (sheet.width !== declared.sheetWidth || sheet.height !== declared.sheetHeight)
  ) {
    return (
      `o spritesheet.png em disco é ${sheet.width}×${sheet.height} e o atlas ` +
      `declara ${declared.sheetWidth}×${declared.sheetHeight}`
    );
  }

  if (declared.frameCount !== frames.count) {
    return (
      `a folha declara ${declared.frameCount} quadros e há ${frames.count} ` +
      'PNGs em frames/'
    );
  }
  if (declared.frameWidth !== first.width || declared.frameHeight !== first.height) {
    return (
      `o quadro da folha (${declared.frameWidth}×${declared.frameHeight}) não bate ` +
      `com o dos frames (${first.width}×${first.height})`
    );
  }
  if (
    declared.sheetWidth !== first.width * frames.count ||
    declared.sheetHeight !== first.height
  ) {
    return (
      `a folha ${declared.sheetWidth}×${declared.sheetHeight} não é a tira de ` +
      `${frames.count}×${first.width}×${first.height}`
    );
  }
  return null;
}

/** Lê o `spritesheet.json` e resume o que ele declara. `null` se não der. */
async function readSheetDeclaration(
  assetsDir: string,
  hash: string,
): Promise<SheetDeclaration | null> {
  const path = atlasPath(assetsDir, hash);
  if (!existsSync(path)) return null;
  try {
    const atlas = JSON.parse(await readFile(path, 'utf8')) as {
      frames?: Record<string, { frame?: { w?: number; h?: number } }>;
      meta?: { size?: { w?: number; h?: number } };
    };
    const entries = Object.values(atlas.frames ?? {});
    const first = entries[0]?.frame;
    const size = atlas.meta?.size;
    if (
      entries.length === 0 ||
      typeof first?.w !== 'number' ||
      typeof first?.h !== 'number' ||
      typeof size?.w !== 'number' ||
      typeof size?.h !== 'number'
    ) {
      return null;
    }
    return {
      frameWidth: first.w,
      frameHeight: first.h,
      frameCount: entries.length,
      sheetWidth: size.w,
      sheetHeight: size.h,
    };
  } catch {
    return null;
  }
}

/** Os PNGs de `frames/`, em ordem numérica. Vazio quando não há pasta. */
async function readFrameFiles(assetsDir: string, hash: string): Promise<string[]> {
  const dir = join(blockDir(assetsDir, hash), 'frames');
  if (!existsSync(dir)) return [];
  try {
    const files = await readdir(dir);
    return files
      .map((name) => /^frame_(\d+)\.png$/.exec(name))
      .filter((m): m is RegExpExecArray => m !== null)
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .map((m) => join(dir, m[0]));
  } catch {
    return [];
  }
}

/**
 * Quantos quadros o `animation.json` diz que a animação tem. `null` quando o
 * sidecar não existe, não abre, ou não declara um número utilizável.
 *
 * Existe porque a contagem em `frames/` é o que o `readdir` encontrar, e isso
 * não é a mesma coisa. Um `frame_009.png` órfão — deixado por uma execução
 * interrompida — faria a folha nascer com 10 quadros enquanto o sidecar declara
 * 9; o editor recusaria a folha no `checkSheet` e o bloco pararia de animar. O
 * sidecar é escrito junto com os frames pela mesma função, então ele é a
 * autoridade sobre quantos quadros foram pagos.
 */
async function readSidecarFrameCount(
  assetsDir: string,
  hash: string,
): Promise<number | null> {
  const path = animSidecarPath(assetsDir, hash);
  if (!existsSync(path)) return null;
  try {
    const sc = JSON.parse(await readFile(path, 'utf8')) as { frameCount?: unknown };
    const n = sc.frameCount;
    if (typeof n === 'number' && Number.isInteger(n) && n > 0) return n;
    return null;
  } catch {
    return null;
  }
}

/** O cabeçalho do `spritesheet.png`. `null` quando não há PNG legível ali. */
async function readSheetHeader(
  assetsDir: string,
  hash: string,
): Promise<{ width: number; height: number } | null> {
  try {
    const head = readPngHeader(await readFile(spritesheetPath(assetsDir, hash)));
    if (head.width > 0 && head.height > 0) return { width: head.width, height: head.height };
    return null;
  } catch {
    return null;
  }
}

/**
 * Re-empacota a folha a partir de `frames/` quando ela discorda deles.
 *
 * **Custo zero: nenhuma chamada à API, nenhum pixel novo.** Os frames em disco
 * já foram pagos e estão íntegros; o que se reescreve é a tira derivada deles e
 * o `spritesheet.json`. `animation.json` (fps, ação, ping-pong) e os próprios
 * PNGs de `frames/` não são tocados.
 *
 * É chamada na leitura do catálogo, e isso é decisão: é o único ponto por onde
 * TODO bloco passa antes de o editor tentar desenhá-lo. A checagem custa a
 * leitura de um JSON pequeno e do CABEÇALHO de alguns PNGs — os pixels só são
 * inflados quando a folha vai mesmo ser reescrita (ver `frameHeaderSize`, que
 * documenta a medição da regressão em que não era assim). Detecta por CONTEÚDO,
 * então rodar de novo não faz nada — não é migração de mão única e não há flag
 * de "já migrei" para ficar mentindo.
 *
 * Serializada por bloco (`withSheetLock`): dois `GET /api/world-blocks`
 * sobrepostos não decidem em cima do mesmo estado obsoleto.
 *
 * Falha em silêncio (com log): uma folha que não dá para reescrever não pode
 * derrubar a paleta inteira. O editor degrada esse bloco para o quadro parado.
 *
 * **Loga por `console.warn` além do `onLog`, e isso é de propósito.** Reescrever
 * a folha é raro e mexe num artefato derivado de arte PAGA; até 2026-08-04 o
 * único rastro era o `onLog`, e o servidor chama `listWorldBlocks` sem passar
 * um — o "Falha em silêncio (com log)" desta mesma doc era falso em produção.
 * `console.warn` sai por stderr, que é fd separado do protocolo do
 * `node --test`, então não corrompe o transporte de resultados dos testes.
 */
export async function repackSpritesheetIfStale(
  assetsDir: string,
  hash: string,
  onLog?: (m: string) => void,
): Promise<boolean> {
  return withSheetLock(sheetLockKey(assetsDir, hash), () =>
    repackSpritesheetIfStaleLocked(assetsDir, hash, onLog),
  );
}

/** Grita no `onLog` E no stderr. Só para o que precisa ser visto sem editor. */
function warnRepack(message: string, onLog?: (m: string) => void): void {
  onLog?.(message);
  console.warn(message);
}

async function repackSpritesheetIfStaleLocked(
  assetsDir: string,
  hash: string,
  onLog?: (m: string) => void,
): Promise<boolean> {
  let framePaths = await readFrameFiles(assetsDir, hash);
  if (framePaths.length === 0) return false;

  // Três leituras por bloco, em paralelo, e nenhum pixel inflado: o cabeçalho
  // do PRIMEIRO frame, o atlas e o cabeçalho da folha. É tudo o que a decisão
  // consome. Só a primeira pode falhar — as outras duas engolem o próprio erro
  // e devolvem `null`, que já é uma resposta válida para `sheetNeedsRepack`.
  let first: { width: number; height: number };
  let declared: SheetDeclaration | null;
  let sheetHead: { width: number; height: number } | null;
  try {
    [first, declared, sheetHead] = await Promise.all([
      readFile(framePaths[0]!).then((b) => frameHeaderSize(b, 0)),
      readSheetDeclaration(assetsDir, hash),
      readSheetHeader(assetsDir, hash),
    ]);
  } catch (err) {
    warnRepack(
      `[world-block] ${hash}: não deu para ler os frames para conferir a folha ` +
        `(${err instanceof Error ? err.message : String(err)}).`,
      onLog,
    );
    return false;
  }

  let reason = sheetNeedsRepack(declared, { count: framePaths.length, first }, sheetHead);

  if (reason !== null) {
    // Antes de reescrever, conferir a contagem com o sidecar — e SÓ aqui, que é
    // o caminho raro. Ver `readSidecarFrameCount`: um `frame_009.png` órfão faria
    // a folha nascer com 10 quadros contra os 9 do `animation.json`, e o editor
    // recusaria a animação inteira por causa dele. Se o órfão era o único
    // motivo da divergência, a folha já estava certa e nada é reescrito.
    const declaredFrames = await readSidecarFrameCount(assetsDir, hash);
    if (declaredFrames !== null && declaredFrames < framePaths.length) {
      warnRepack(
        `[world-block] ${hash}: há ${framePaths.length} PNGs em frames/ e o ` +
          `animation.json declara ${declaredFrames} quadros. A folha usa os ` +
          `${declaredFrames} primeiros; os PNGs sobrando ficam em disco (arte paga ` +
          'não se apaga por conta própria).',
        onLog,
      );
      framePaths = framePaths.slice(0, declaredFrames);
      reason = sheetNeedsRepack(declared, { count: framePaths.length, first }, sheetHead);
    }
  }
  if (reason === null) return false;

  // Só AGORA os pixels são inflados — este é o caminho raro.
  let decoded: DecodedFrame[];
  try {
    const buffers = await Promise.all(framePaths.map((p) => readFile(p)));
    decoded = buffers.map((b, i) => decodeFrame(b, i));
  } catch (err) {
    warnRepack(
      `[world-block] ${hash}: a folha discorda dos frames (${reason}) e os frames ` +
        `não se deixam decodificar (${err instanceof Error ? err.message : String(err)}). ` +
        'O editor vai desenhar o quadro parado.',
      onLog,
    );
    return false;
  }

  try {
    await writeSheet(assetsDir, hash, decoded, onLog);
    warnRepack(
      `[world-block] ${hash}: folha re-empacotada a partir de frames/ — ${reason}. ` +
        'Nenhuma chamada à API: os quadros já estavam pagos e em disco.',
      onLog,
    );
    return true;
  } catch (err) {
    warnRepack(
      `[world-block] ${hash}: a folha discorda dos frames (${reason}) e o ` +
        `re-empacotamento falhou (${err instanceof Error ? err.message : String(err)}). ` +
        'O editor vai desenhar o quadro parado.',
      onLog,
    );
    return false;
  }
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
  /** `enhanced_prompt` devolvido pelo fornecedor (POST ou `last_response` do job). */
  let textureEnhancedPrompt: string | undefined;
  /** O material normalizado desta execução — vai ao manifesto v3. */
  let textureMaterial: string | undefined;

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
    // ---- textura: 1 cubo (tile) + LLM + 1 animate-with-text-v3 (ADR 0032).
    // frameCount 0 = sem animação: o cubo base é o artefato final.
    const frameCount = config.frameCount ?? 8;
    const animated = frameCount > 0;
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

    /**
     * O MATERIAL em inglês pixel-art, derivado da descrição do usuário.
     *
     * Calculado UMA vez e só quando alguma etapa vai realmente submeter: com o
     * bloco inteiro em disco não há prompt a montar, e uma chamada de LLM por
     * execução em cache seria custo (de latência e de token) sem produto.
     *
     * Não entra no hash — quem entra é `config.description`, o texto cru. Ver
     * o comentário em `inputHash`.
     */
    let materialCache: { material: string; llmGenerated: boolean } | null = null;
    const materialOf = async (): Promise<string> => {
      materialCache ??= await normalizeMaterialViaLlm(config.description, opts.onLog);
      textureMaterial = materialCache.material;
      return materialCache.material;
    };

    // 1. Cubo base (create-isometric-tile, molde como init_image) — ou cache.
    //    Existe nas DUAS variantes: animada e estática (frameCount 0).
    if (!existsSync(basePath)) {
      logGuard(
        'create-isometric-tile (1× cubo base pixel-art, molde como referência; preço estimado)',
        guardFor(tileEstimate, tileEstimate.point),
        opts.onLog,
      );

      const baseImg = await generateBaseImage(
        client,
        await materialOf(),
        baseSeedNum,
        basePath,
        apiSize,
        imageSize,
        config,
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

    // 2+3 só existem na variante animada — frameCount 0 pula LLM e
    // animate-with-text-v3: o cubo base é o artefato final.
    if (animated) {
      // 2+3. Ação da animação e a submissão — só quando falta a spritesheet.
      //      Com a folha em disco não há prompt a montar, e montá-lo assim
      //      mesmo era uma ida ao LLM por execução em cache.
      if (!existsSync(sheetPath)) {
        // A ação nasce do LLM ou da config, e em ambos os casos o MATERIAL é
        // costurado dentro: `action` é o único texto que o
        // /animate-with-text-v3 vê (ver actionWithMaterial).
        const materialForAction = await materialOf();
        if (config.action !== undefined && config.action.trim().length > 0) {
          actionText = actionWithMaterial(config.action.trim(), materialForAction);
          llmGenerated = false;
        } else {
          const result = await generateActionViaLlm(materialForAction, opts.onLog);
          actionText = actionWithMaterial(result.action, materialForAction);
          llmGenerated = result.llmGenerated;
        }

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
          // O `first_frame` é o cubo base que ESTE código acabou de gravar —
          // o tamanho dele é o tamanho do trabalho, e é ele que entra no
          // orçamento de pixels do endpoint. Ler o cabeçalho do PNG evita tanto
          // o literal errado quanto a suposição de que o canônico sempre valeu.
          const baseBytes = await readFile(basePath);
          const frameSize = pngSizeOrCanonical(baseBytes);
          const pixelBudget = animationPixelBudget(
            frameSize.width,
            frameSize.height,
            frameCount,
          );
          // O teto é do endpoint, não deste módulo. Com o cubo canônico 48×53 e
          // os 16 quadros do maior `frameCount` dá 40 704 — folgadíssimo. O
          // aviso existe porque o tamanho do `first_frame` vem do FORNECEDOR:
          // se um dia ele devolver o tile maior, a submissão seria recusada e o
          // erro chegaria como um 4xx opaco, sem dizer que o problema é este.
          if (pixelBudget > ANIMATION_PIXEL_BUDGET) {
            opts.onLog?.(
              `[world-block] AVISO: ${frameCount} quadros de ${frameSize.width}×` +
                `${frameSize.height} somam ${pixelBudget} pixels, acima do teto de ` +
                `${ANIMATION_PIXEL_BUDGET} do /animate-with-text-v3 (spec vendorizado, ` +
                'width × height × frame_count). A submissão segue — quem decide é o ' +
                'fornecedor —, mas espere recusa.',
            );
          }
          const animEstimate = estimateByArea(
            COST_TABLE['animate-with-text-v3'],
            pixelBudget,
          );
          logGuard(
            `animate-with-text-v3 (${frameCount} frames de ${frameSize.width}×${frameSize.height}; ` +
              'preço estimado)',
            guardFor(animEstimate, animEstimate.point),
            opts.onLog,
          );

          const baseB64 = baseBytes.toString('base64');
          const animSeed = baseSeedNum + 1;
          const animParams: Record<string, unknown> = {
            first_frame: asBase64Image(baseB64),
            action: actionText,
            frame_count: frameCount,
            seed: animSeed,
            // Fundo transparente nos frames — mesmo contrato do tile
            // (o /create-isometric-tile não tem o parâmetro; tiles já
            // nascem transparentes). Confirmado no spec vendorizado.
            no_background: true,
            // A API expande a ação numa descrição de movimento mais rica e
            // devolve o texto em `enhanced_prompt` (cobrando `enhance_usage`
            // à parte). Camada ADICIONAL ao LLM gerador da ação-base.
            enhance_prompt: config.enhancePrompt ?? true,
          };

          const res = await client.submit<{
            background_job_id?: string;
            usage?: Usage | null;
            enhanced_prompt?: string;
          }>('animate-with-text-v3', animParams);
          generated += 1;

          if (typeof res.usage?.usd === 'number') trackSpend(res.usage.usd);
          textureAnimUsage = res.usage;
          textureEnhancedPrompt = res.data?.enhanced_prompt;
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
          | { images?: Array<{ base64?: string }>; enhanced_prompt?: string }
          | undefined;
        // O `enhanced_prompt` vem no POST (garantido pelo spec); o job é um
        // objeto aberto que pode repeti-lo — a preferência é do job.
        textureEnhancedPrompt = lastResp?.enhanced_prompt ?? textureEnhancedPrompt;
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
          material: materialForAction,
          llmGenerated,
          pingPong: config.pingPong ?? true,
          enhancePrompt: config.enhancePrompt ?? true,
          ...(textureEnhancedPrompt ? { enhancedPrompt: textureEnhancedPrompt } : {}),
        }, opts.onLog);

        await unlink(stubPath).catch(() => {});
      } else {
        opts.onLog?.('[world-block] spritesheet já existe. Sem chamada.');
      }
    } else {
      opts.onLog?.(
        '[world-block] frameCount=0 — bloco SEM animação: só o cubo base, nenhum ' +
          'animate-with-text-v3.',
      );
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

      // Recupera action/llmGenerated/enhancedPrompt do sidecar se a
      // spritesheet já existia (execuções anteriores ou retomadas).
      let actionText = config.action ?? '';
      let llmGenerated = false;
      let enhancedPromptFromSidecar: string | undefined;
      let materialFromSidecar: string | undefined;
      if (existsSync(animSidecarPath(opts.assetsDir, hash))) {
        try {
          const sc = JSON.parse(await readFile(animSidecarPath(opts.assetsDir, hash), 'utf8')) as AnimSidecar;
          actionText = sc.action;
          llmGenerated = sc.llmGenerated ?? false;
          enhancedPromptFromSidecar = sc.enhancedPrompt;
          materialFromSidecar = sc.material;
        } catch { /* mantém defaults */ }
      }

      // Recupera usage da base image do ledger — o manifesto anterior.
      const prevV3 = prev?.version === 3 && prev.technique === 'texture' ? prev : null;
      // O enhanced_prompt desta execução tem precedência sobre o do sidecar.
      const manifestEnhancedPrompt = textureEnhancedPrompt ?? enhancedPromptFromSidecar;

      const manifestV3: WorldBlockManifestV3 = {
        version: 3,
        hash,
        technique: 'texture',
        description: config.description,
        geometry: MANIFEST_GEOMETRY,
        action: actionText,
        // O material sobrevive à retomada pelo sidecar; o manifesto anterior é
        // o último recurso, para um bloco estático (frameCount 0) que não tem
        // sidecar nenhum.
        ...((): { material?: string } => {
          const material = textureMaterial ?? materialFromSidecar ?? prevV3?.material;
          return material ? { material } : {};
        })(),
        ...(llmGenerated ? { llmGenerated } : {}),
        animated: frameCount > 0,
        ...(frameCount > 0 ? { pingPong: config.pingPong ?? true } : {}),
        frameCount,
        fps,
        ...(manifestEnhancedPrompt ? { enhancedPrompt: manifestEnhancedPrompt } : {}),
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
