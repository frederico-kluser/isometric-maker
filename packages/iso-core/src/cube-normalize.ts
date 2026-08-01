/**
 * Normalização do sprite de bloco para a âncora canônica.
 *
 * ## Por que isto existe
 *
 * O molde vai como referência, mas modelo generativo não é régua: a arte volta
 * com a forma certa e o **posicionamento aproximado**. Medido nos cinco blocos
 * já pagos deste projeto (48×48, `/create-isometric-tile`), o losango do topo
 * saiu 2:1 nos cinco — mas a aresta vertical veio 22 px num e 20 px noutro, e o
 * vértice superior variou entre a linha 2 e a linha 4 conforme o bloco tinha ou
 * não tufos de grama estourando para cima.
 *
 * Dois pixels de deslocamento não parecem nada até o mapa ter mil células: aí
 * viram uma costura visível em cada aresta, e o erro é atribuído à projeção, que
 * está certa.
 *
 * ## O ponto de referência é a CINTURA do losango, não o bbox
 *
 * O bbox da arte inclui o que estoura para fora — grama, neve, uma quina de
 * telhado. Alinhar por ele é alinhar pelo enfeite. O marco estável é a **linha
 * mais alta em que a arte atinge a largura cheia**: geometricamente é onde ficam
 * os vértices esquerdo e direito do losango do topo, e ela existe em qualquer
 * bloco que respeite a projeção, com ou sem enfeite.
 *
 * Se nem essa linha existir — arte que nunca chega à largura do tile —, o
 * fallback é o bbox, e o resultado diz qual dos dois foi usado. Um alinhamento
 * silenciosamente pior é o tipo de coisa que só aparece três semanas depois.
 *
 * ## O recorte não é opcional
 *
 * Depois de alinhar, tudo que cai fora da silhueta canônica é apagado. Não é
 * zelo estético: o formato de mapa proíbe sprite multi-célula (ADR 0013) porque
 * oclusão cíclica não tem ordem linear correta, e arte que transborda a célula é
 * sprite multi-célula com outro nome.
 */
import {
  CANONICAL_CUBE,
  columnBounds,
  faceAtPixel,
  silhouetteArea,
  silhouetteRow,
  type IsoCubeGeometry,
} from './iso-cube.ts';
import type { RgbaImage } from './cube-raster.ts';

// ---------------------------------------------------------------- leitura

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Alpha acima do qual um pixel conta como desenhado. */
const OPAQUE = 8;

/** Caixa dos pixels desenhados, ou `null` se a imagem está inteira vazia. */
export function alphaBounds(img: RgbaImage): Bounds | null {
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (img.data[(y * img.width + x) * 4 + 3]! > OPAQUE) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

/** Primeiro e último pixel desenhado de uma linha. `null` se a linha é vazia. */
function rowExtent(img: RgbaImage, y: number): { first: number; last: number } | null {
  let first = -1;
  let last = -1;
  for (let x = 0; x < img.width; x += 1) {
    if (img.data[(y * img.width + x) * 4 + 3]! > OPAQUE) {
      if (first < 0) first = x;
      last = x;
    }
  }
  return first < 0 ? null : { first, last };
}

// ---------------------------------------------------------------- marcos

export type Landmark = 'cintura' | 'bbox';

interface Anchor {
  readonly landmark: Landmark;
  /** Linha da imagem de origem que corresponde à cintura do losango. */
  readonly waistY: number;
  /** Coluna central da arte na origem (pode ser fracionária). */
  readonly centerX: number;
}

/**
 * Encontra a cintura: a PRIMEIRA linha em que a arte atinge sua largura máxima.
 *
 * A busca é pelo máximo observado, não pela largura nominal do tile. Procurar
 * "linha com largura ≥ W" erra por um pixel na hora em que a arte perde uma
 * ponta — e a linha imediatamente acima da cintura é 4 px mais estreita, então
 * um limiar fixo cai nela e desloca o bloco inteiro. O máximo observado não tem
 * esse problema: seja a arte de largura cheia ou não, a cintura continua sendo
 * onde ela é mais larga.
 *
 * A folga de 1 px absorve a ponta perdida sem alcançar a linha anterior.
 */
function findAnchor(img: RgbaImage, geom: IsoCubeGeometry): Anchor | null {
  let maxWidth = 0;
  const extents: Array<{ first: number; last: number } | null> = [];
  for (let y = 0; y < img.height; y += 1) {
    const ext = rowExtent(img, y);
    extents.push(ext);
    if (ext) maxWidth = Math.max(maxWidth, ext.last - ext.first + 1);
  }

  // Arte larga o bastante para ser o bloco: a cintura é confiável.
  if (maxWidth >= geom.tileWidth - 4) {
    for (let y = 0; y < extents.length; y += 1) {
      const ext = extents[y];
      if (ext && ext.last - ext.first + 1 >= maxWidth - 1) {
        return { landmark: 'cintura', waistY: y, centerX: (ext.first + ext.last) / 2 };
      }
    }
  }

  const b = alphaBounds(img);
  if (b === null) return null;
  // Sem largura de bloco: o melhor palpite é que o bbox É o cubo, em escala.
  const height = b.maxY - b.minY + 1;
  const ratio = (geom.tileHeight / 2 - 1) / geom.spriteHeight;
  return {
    landmark: 'bbox',
    waistY: b.minY + Math.round(height * ratio),
    centerX: (b.minX + b.maxX) / 2,
  };
}

// ---------------------------------------------------------------- resultado

export interface NormalizeResult {
  /** Sprite do tamanho canônico exato, alinhado e recortado. */
  readonly image: RgbaImage;
  /** Deslocamento aplicado à arte de origem. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Qual marco foi usado para alinhar. */
  readonly landmark: Landmark;
  /** Fração da silhueta canônica que ficou preenchida, 0–1. */
  readonly coverage: number;
  /** Quantos pixels foram apagados por caírem fora da silhueta. */
  readonly clipped: number;
  /** Quantas linhas de face lateral foram repetidas para fechar o vão. */
  readonly extended: number;
  /** Avisos em pt-BR, prontos para a UI. Vazio quando nada chamou atenção. */
  readonly avisos: readonly string[];
}

export interface NormalizeOptions {
  /**
   * Repetir a última linha de cada face lateral para fechar o vão quando a arte
   * veio mais baixa que o molde. Default `true`.
   *
   * Sem isso, um bloco gerado 7 px mais baixo que o molde fica com uma fatia
   * transparente na base — e no mapa isso se lê como buraco no chão, não como
   * bloco mais baixo. Com isso, o material estica verticalmente na base, que é
   * justamente a parte que o bloco de baixo cobre quando se empilha.
   */
  readonly extendSides?: boolean;
  /** Abaixo desta cobertura entra aviso. Default 0,90. */
  readonly minCoverage?: number;
}

// ---------------------------------------------------------------- normalização

/**
 * Alinha, recorta e completa um sprite de bloco para o molde canônico.
 *
 * Determinística: a mesma entrada dá exatamente a mesma saída, sempre. É o que
 * permite normalizar um asset já pago sem gerar de novo.
 */
export function normalizeCubeSprite(
  source: RgbaImage,
  geom: IsoCubeGeometry = CANONICAL_CUBE,
  options: NormalizeOptions = {},
): NormalizeResult {
  const extendSides = options.extendSides ?? true;
  const minCoverage = options.minCoverage ?? 0.9;
  const w = geom.spriteWidth;
  const h = geom.spriteHeight;
  const out = new Uint8ClampedArray(w * h * 4);
  const image: RgbaImage = { width: w, height: h, data: out };
  const avisos: string[] = [];

  const anchor = findAnchor(source, geom);
  if (anchor === null) {
    return {
      image,
      offsetX: 0,
      offsetY: 0,
      landmark: 'bbox',
      coverage: 0,
      clipped: 0,
      extended: 0,
      avisos: ['A imagem recebida está inteiramente transparente.'],
    };
  }

  // A cintura canônica é a última linha da metade de cima do losango.
  const canonicalWaist = geom.tileHeight / 2 - 1;
  // `+ 0` normaliza o zero negativo: `Math.round(-0.2)` é `-0`, e `-0` passa
  // despercebido até `deepStrictEqual` reprovar um deslocamento que era nulo.
  const offsetY = canonicalWaist - anchor.waistY + 0;
  const offsetX = Math.round((w - 1) / 2 - anchor.centerX) + 0;

  if (anchor.landmark === 'bbox') {
    avisos.push(
      'A arte nunca atinge a largura do tile, então o alinhamento usou a caixa ' +
        'delimitadora em vez da cintura do losango. Confira a peça no mapa antes de usá-la.',
    );
  }

  // --- transferência com recorte pela silhueta ---
  let clipped = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const sx = x - offsetX;
      const sy = y - offsetY;
      if (sx < 0 || sx >= source.width || sy < 0 || sy >= source.height) continue;
      const si = (sy * source.width + sx) * 4;
      if (source.data[si + 3]! <= OPAQUE) continue;
      if (faceAtPixel(x, y, geom) === null) {
        clipped += 1;
        continue;
      }
      const di = (y * w + x) * 4;
      out[di] = source.data[si]!;
      out[di + 1] = source.data[si + 1]!;
      out[di + 2] = source.data[si + 2]!;
      out[di + 3] = source.data[si + 3]!;
    }
  }

  // --- completa a base das faces laterais ---
  let extended = 0;
  if (extendSides) {
    for (let x = 0; x < w; x += 1) {
      const b = columnBounds(x, geom);
      if (b === null) continue;
      let lastFilled = -1;
      for (let y = b.sideStart; y <= b.sideEnd; y += 1) {
        if (out[(y * w + x) * 4 + 3]! > OPAQUE) lastFilled = y;
      }
      if (lastFilled < 0 || lastFilled >= b.sideEnd) continue;
      const si = (lastFilled * w + x) * 4;
      for (let y = lastFilled + 1; y <= b.sideEnd; y += 1) {
        const di = (y * w + x) * 4;
        out[di] = out[si]!;
        out[di + 1] = out[si + 1]!;
        out[di + 2] = out[si + 2]!;
        out[di + 3] = out[si + 3]!;
        extended += 1;
      }
    }
  }

  // --- cobertura ---
  let filled = 0;
  for (let y = 0; y < h; y += 1) {
    const span = silhouetteRow(y, geom);
    for (let x = span.start; x < span.start + span.width; x += 1) {
      if (out[(y * w + x) * 4 + 3]! > OPAQUE) filled += 1;
    }
  }
  const coverage = filled / silhouetteArea(geom);

  if (coverage < minCoverage) {
    avisos.push(
      `A arte preenche ${(coverage * 100).toFixed(0)} % do molde ` +
        `(mínimo esperado ${(minCoverage * 100).toFixed(0)} %). ` +
        'O bloco vai aparecer com falhas no mapa — vale gerar de novo com o molde como referência.',
    );
  }
  if (clipped > 0) {
    avisos.push(
      `${clipped} pixels caíam fora da silhueta do cubo e foram recortados. ` +
        'Arte que transborda a célula quebra a ordem de desenho (ADR 0013).',
    );
  }

  return { image, offsetX, offsetY, landmark: anchor.landmark, coverage, clipped, extended, avisos };
}
