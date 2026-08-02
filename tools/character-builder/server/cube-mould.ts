/**
 * O molde do cubo — a referência que abre toda geração de bloco.
 *
 * ## Por que mandar uma referência
 *
 * O `/create-isometric-tile` não tem parâmetro de proporção. Tem
 * `isometric_tile_shape` com três degraus (`thin tile`, `thick tile`, `block`)
 * descritos no spec como "~15 %, ~25 %, ~50 % da altura do canvas" — uma
 * indicação grosseira, não uma geometria. Medido nos cinco blocos pagos da
 * era uniforme, todos com `shape='block'` e canvas 48×48: o losango do topo
 * saiu 2:1 nos cinco, mas a aresta vertical veio **entre 20 e 22 px** conforme
 * o bloco. Sem referência, cada geração escolhe sua própria altura, e blocos
 * que não compartilham altura não empilham.
 *
 * O que o endpoint TEM é `init_image` + `init_image_strength` (1–999, default
 * 300). É esse o canal: o molde entra como imagem inicial da PRIMEIRA face, e
 * o resultado dela vira o molde das demais (ADR 0029 — o encadeamento).
 *
 * ## Por que o molde é cinza
 *
 * `init_image` carrega forma **e** cor. Um molde colorido puxaria a paleta de
 * toda geração para a cor do molde — e aí todo bloco nasceria da mesma cor,
 * independentemente do prompt. Acromático é a única escolha que transporta
 * geometria sem contrabandear paleta. (As faces seguintes recebem a norte como
 * init_image de propósito: aí a paleta é justamente o que se quer carregar.)
 *
 * ## O que NÃO foi verificado
 *
 * Que a PixelLab respeite a proporção do `init_image` com fidelidade de pixel.
 * O spec não promete isso e não há como saber sem gastar. Não há mais
 * pós-processamento de alinhamento — foi decisão remover o "ajuste ao molde";
 * a força alta do init_image (480) é a única alavanca de forma.
 */
import {
  CANONICAL_CUBE,
  assertFitsPixelLab,
  type IsoCubeGeometry,
} from '../../../packages/iso-core/src/iso-cube.ts';
import {
  MOULD_PALETTE,
  rasterizeCube,
} from '../../../packages/iso-core/src/cube-raster.ts';
import { encodePngFromRgba } from './png.ts';

// ---------------------------------------------------------------- geometria

/** A geometria que este projeto usa para bloco. Uma só, em todo lugar. */
export const BLOCK_GEOMETRY: IsoCubeGeometry = CANONICAL_CUBE;

/** O quadro CANÔNICO em disco: o bounding box exato do cubo. */
export function blockImageSize(geom: IsoCubeGeometry = BLOCK_GEOMETRY): {
  width: number;
  height: number;
} {
  assertFitsPixelLab(geom);
  return { width: geom.spriteWidth, height: geom.spriteHeight };
}

/**
 * `image_size` a mandar ao endpoint: o bounding box arredondado PARA CIMA ao
 * múltiplo de 4.
 *
 * A GPU da PixelLab recusa canvas cujo lado não seja múltiplo de 4 — o job
 * assíncrono falha com `code 3006: "Canvas width and height must be divisible
 * by 4 (got 48x53)"`. Verificado contra jobs reais em 2026-08-01; a restrição
 * NÃO está no spec vendorizado, cujo schema só diz 16–64 por lado. A falha é
 * pós-submissão e reporta `usd: 0` — não cobra, mas também nunca entrega.
 *
 * O disco continua no quadro canônico ({@link blockImageSize}): quem gera
 * acolchoa o topo na ida e recorta na volta (`world-block.ts`).
 */
export function apiImageSize(geom: IsoCubeGeometry = BLOCK_GEOMETRY): {
  width: number;
  height: number;
} {
  const box = blockImageSize(geom);
  return {
    width: Math.ceil(box.width / 4) * 4,
    height: Math.ceil(box.height / 4) * 4,
  };
}

// ---------------------------------------------------------------- o molde

let cached: Buffer | null = null;

/**
 * PNG do molde, desenhado por código.
 *
 * Memoizado porque é sempre o mesmo arquivo: ele abre toda geração de bloco
 * (é o init_image da primeira face das duas técnicas).
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
