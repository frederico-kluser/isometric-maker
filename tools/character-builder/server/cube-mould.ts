/**
 * O molde do cubo — a referência que acompanha toda geração de bloco.
 *
 * ## Por que mandar uma referência
 *
 * O `/create-isometric-tile` não tem parâmetro de proporção. Tem
 * `isometric_tile_shape` com três degraus (`thin tile`, `thick tile`, `block`)
 * descritos no spec como "~15 %, ~25 %, ~50 % da altura do canvas" — uma
 * indicação grosseira, não uma geometria. Medido nos cinco blocos já pagos deste
 * projeto, todos com `shape='block'` e canvas 48×48: o losango do topo saiu 2:1
 * nos cinco, mas a aresta vertical veio **entre 20 e 22 px** conforme o bloco.
 * Sem referência, cada geração escolhe sua própria altura, e blocos que não
 * compartilham altura não empilham.
 *
 * O que o endpoint TEM é `init_image` + `init_image_strength` (1–999, default
 * 300). É esse o canal: o molde entra como imagem inicial e leva a FORMA junto.
 *
 * ## Por que o molde é cinza
 *
 * `init_image` carrega forma **e** cor. Um molde colorido puxaria a paleta de
 * toda geração para a cor do molde — e aí todo bloco nasceria da mesma cor,
 * independentemente do prompt. Acromático é a única escolha que transporta
 * geometria sem contrabandear paleta.
 *
 * ## O que NÃO foi verificado
 *
 * Que a PixelLab respeite a proporção do `init_image` com fidelidade de pixel.
 * O spec não promete isso e não há como saber sem gastar. É por isso que existe
 * a normalização (`normalizeBlockRgba`): ela conserta o que a referência apenas
 * sugeriu, sem custo e de forma determinística.
 */
import {
  CANONICAL_CUBE,
  assertFitsPixelLab,
  checkReferenceProportion,
  type IsoCubeGeometry,
} from '../../../packages/iso-core/src/iso-cube.ts';
import {
  MOULD_PALETTE,
  rasterizeCube,
  type RgbaImage,
} from '../../../packages/iso-core/src/cube-raster.ts';
import {
  normalizeCubeSprite,
  type NormalizeResult,
} from '../../../packages/iso-core/src/cube-normalize.ts';
import { decodePngToRgba, encodePngFromRgba, readPngHeader } from './png.ts';

// ---------------------------------------------------------------- geometria

/** A geometria que este projeto usa para bloco. Uma só, em todo lugar. */
export const BLOCK_GEOMETRY: IsoCubeGeometry = CANONICAL_CUBE;

/** `image_size` a mandar ao endpoint: o bounding box exato do cubo. */
export function blockImageSize(geom: IsoCubeGeometry = BLOCK_GEOMETRY): {
  width: number;
  height: number;
} {
  assertFitsPixelLab(geom);
  return { width: geom.spriteWidth, height: geom.spriteHeight };
}

// ---------------------------------------------------------------- o molde

let cached: Buffer | null = null;

/**
 * PNG do molde, desenhado por código.
 *
 * Memoizado porque é sempre o mesmo arquivo e ele entra em toda submissão: um
 * bloco de quatro faces orientadas manda a mesma referência quatro vezes.
 */
export function renderMouldPng(geom: IsoCubeGeometry = BLOCK_GEOMETRY): Buffer {
  if (geom === BLOCK_GEOMETRY && cached !== null) return cached;
  const img = rasterizeCube(MOULD_PALETTE, geom, { outline: true });
  const png = encodePngFromRgba(Buffer.from(img.data.buffer.slice(0)), img.width, img.height);
  if (geom === BLOCK_GEOMETRY) cached = png;
  return png;
}

export function mouldBase64(geom: IsoCubeGeometry = BLOCK_GEOMETRY): string {
  return renderMouldPng(geom).toString('base64');
}

// ---------------------------------------------------------------- referência

export type ReferenceSource = 'molde' | 'usuario';

export interface ResolvedReference {
  /** Base64 puro do PNG que vai como `init_image`. */
  readonly base64: string;
  readonly source: ReferenceSource;
  /** Dimensões da referência efetivamente escolhida. */
  readonly width: number;
  readonly height: number;
  /** Motivo pt-BR quando a referência do usuário foi recusada. Vazio se não houve. */
  readonly recusa: string;
}

/**
 * Escolhe a referência: a do usuário se ela tiver a proporção canônica, senão o
 * molde.
 *
 * A regra é a que o usuário pediu, e ela é a certa: uma referência em outra
 * proporção não é "outro estilo", é outra projeção — e outra projeção não
 * encaixa no mesmo grid. Recusar é mais barato que descobrir depois de pagar.
 *
 * A checagem é sobre a RAZÃO, não sobre o tamanho: uma referência de 96×106 é o
 * mesmo molde em dobro e passa.
 */
export function resolveReference(
  userPng?: Buffer | undefined,
  geom: IsoCubeGeometry = BLOCK_GEOMETRY,
): ResolvedReference {
  const fallback = (recusa: string): ResolvedReference => ({
    base64: mouldBase64(geom),
    source: 'molde',
    width: geom.spriteWidth,
    height: geom.spriteHeight,
    recusa,
  });

  if (!userPng || userPng.length === 0) return fallback('');

  let head;
  try {
    head = readPngHeader(userPng);
  } catch (err) {
    return fallback(
      `A referência não pôde ser lida como PNG (${err instanceof Error ? err.message : String(err)}). ` +
        'O molde do projeto foi usado no lugar.',
    );
  }

  const check = checkReferenceProportion(head.width, head.height, geom);
  if (!check.ok) return fallback(`${check.motivo} O molde do projeto foi usado no lugar.`);

  return {
    base64: userPng.toString('base64'),
    source: 'usuario',
    width: head.width,
    height: head.height,
    recusa: '',
  };
}

// ---------------------------------------------------------------- normalização

export interface NormalizedBlock {
  /** PNG já alinhado ao molde, no tamanho canônico. */
  readonly png: Buffer;
  readonly report: NormalizeResult;
}

function toRgbaImage(data: Buffer, width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(data) };
}

function fromRgbaImage(img: RgbaImage): Buffer {
  return encodePngFromRgba(Buffer.from(img.data.buffer.slice(0)), img.width, img.height);
}

/**
 * Alinha ao molde os pixels RGBA crus que o endpoint devolveu.
 *
 * O `/create-isometric-tile` devolve pixels crus, não arquivo PNG (verificado
 * contra a API em 2026-08-01). Normalizar ANTES de codificar evita uma volta
 * desnecessária pelo compressor.
 */
export function normalizeBlockRgba(
  rgba: Buffer,
  width: number,
  height: number,
  geom: IsoCubeGeometry = BLOCK_GEOMETRY,
): NormalizedBlock {
  const report = normalizeCubeSprite(toRgbaImage(rgba, width, height), geom);
  return { png: fromRgbaImage(report.image), report };
}

/**
 * Alinha ao molde um PNG que já está em disco.
 *
 * É o caminho que conserta arte **já paga** sem gerar de novo. Nenhum pixel do
 * arquivo original é tocado: quem chama grava o resultado ao lado, e o original
 * continua sendo o artefato pago.
 */
export function normalizeBlockPng(
  png: Buffer,
  geom: IsoCubeGeometry = BLOCK_GEOMETRY,
): NormalizedBlock {
  const decoded = decodePngToRgba(png);
  const report = normalizeCubeSprite(
    toRgbaImage(decoded.data, decoded.width, decoded.height),
    geom,
  );
  return { png: fromRgbaImage(report.image), report };
}
