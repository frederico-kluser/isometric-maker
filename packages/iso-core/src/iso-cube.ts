/**
 * Geometria canônica do cubo isométrico — a única fonte da forma.
 *
 * Tudo que desenha, gera, ancora ou empilha um bloco lê daqui: o molde mandado
 * à PixelLab, a arte de reserva do editor, o cubo de preview, o passo de altura
 * da câmera e o validador de referência do usuário. Uma segunda definição da
 * mesma forma é como o preview passa a mentir sobre onde a peça vai cair.
 *
 * ## A conta que estava faltando
 *
 * A projeção deste projeto é a dimétrica 2:1 do gênero:
 *
 * ```text
 * sx = (x − y) · W/2
 * sy = (x + y) · H/2 − z · d
 * ```
 *
 * Ela é uma projeção ortográfica **de verdade** — não uma estilização — se, e
 * somente se, as duas linhas da matriz forem ortogonais e de mesmo módulo:
 *
 * ```text
 * linha_x = ( W/2, −W/2,  0 )
 * linha_y = ( H/2,  H/2, −d )
 *
 * linha_x · linha_y = 0                    (vale para qualquer W, H, d)
 * |linha_x|² = |linha_y|²  ⟹  W²/2 = H²/2 + d²
 * ```
 *
 * Isolando:
 *
 * ```text
 * d = sqrt((W² − H²) / 2)
 * ```
 *
 * Com a razão 2:1 (`H = W/2`) isso vira **d = W · √6 / 4 ≈ 0,6124 · W**.
 *
 * É esse `d` que faz o bloco ser um CUBO — mesma medida em largura, profundidade
 * e altura no mundo. Qualquer outro valor desenha uma caixa: `d = W/2` (o
 * "sprite quadrado", o palpite mais comum) dá um bloco com 81,6 % da altura de
 * um cubo; o `zStep = 16` que este editor usava com `W = 64` dava **40,8 %** —
 * uma laje.
 *
 * ## Por que arredondar é obrigatório, e por que não faz mal
 *
 * `d` inteiro exigiria `3W²/8` ser quadrado perfeito, o que pede `W = 2m√6` —
 * irracional para todo `m` inteiro. **Não existe largura de tile inteira em 2:1
 * com aresta vertical inteira exata.** Arredondar é a única saída, e é inócua:
 * `d` é uma constante única aplicada igual em todos os níveis, então não há erro
 * acumulado ao empilhar — só o cubo inteiro fica uma fração de por cento fora.
 *
 * ## O contrato de pixel
 *
 * O sprite tem exatamente o bounding box do cubo: `W × (H + d)`. Sem margem,
 * sem sobra, sem enfeite estourando para fora. Isso não é economia de bytes: o
 * formato de mapa proíbe sprite multi-célula (ADR 0013) justamente porque
 * oclusão cíclica não tem ordem linear correta, e arte que vaza da célula é
 * sprite multi-célula com outro nome.
 *
 * O pixel `(W/2, 0)` do sprite — o vértice superior do losango do topo — é o que
 * pousa sobre `(sx, sy)` da projeção. É a âncora, e ela é declarada, não
 * adivinhada a partir do bbox da arte.
 *
 * ```text
 *            (W/2, 0)
 *            /      \            topo:     losango W × H
 *      (0,H/2)      (W,H/2)      esquerda: paralelogramo, aresta vertical d
 *        |   \      /   |        direita:  espelho da esquerda
 *        |  (W/2, H)    |
 *        |      |       |        d = altura do cubo em px = zStep
 *   (0,H/2+d)   |   (W,H/2+d)
 *            \  |  /
 *          (W/2, H+d)
 * ```
 */

// ---------------------------------------------------------------- tipos

/** Uma face visível do cubo. São três, sempre — o gênero não mostra mais. */
export type CubeFace = 'top' | 'left' | 'right';

/** As três faces, na ordem de desenho (fundo para a frente). */
export const CUBE_FACES: readonly CubeFace[] = ['top', 'left', 'right'] as const;

export interface IsoCubeGeometry {
  /** Largura do losango do chão, em px. Par e múltiplo de 4. */
  readonly tileWidth: number;
  /** Altura do losango do chão, em px. Exatamente `tileWidth / 2`. */
  readonly tileHeight: number;
  /**
   * Aresta vertical do cubo, em px. É também o `zStep` da câmera: empilhar um
   * bloco sobe exatamente isto. Arredondado de {@link exactCubeHeight}.
   */
  readonly cubeHeight: number;
  /** Largura do sprite = `tileWidth`. */
  readonly spriteWidth: number;
  /** Altura do sprite = `tileHeight + cubeHeight`. */
  readonly spriteHeight: number;
  /** Coluna do sprite que pousa em `sx`. É `tileWidth / 2`. */
  readonly anchorX: number;
  /** Linha do sprite que pousa em `sy`. É `0` — o vértice superior do losango. */
  readonly anchorY: number;
}

// ---------------------------------------------------------------- a fórmula

/**
 * Aresta vertical EXATA (fracionária) de um cubo perfeito nesta projeção.
 *
 * `d = sqrt((W² − H²) / 2)`. Ver o cabeçalho para a derivação.
 */
export function exactCubeHeight(tileWidth: number, tileHeight: number): number {
  const inner = (tileWidth * tileWidth - tileHeight * tileHeight) / 2;
  if (inner <= 0) {
    throw new Error(
      `geometria impossível: tileWidth (${tileWidth}) precisa ser maior que ` +
        `tileHeight (${tileHeight}) — senão a câmera estaria abaixo do horizonte.`,
    );
  }
  return Math.sqrt(inner);
}

/**
 * Quanto o cubo arredondado se afasta do cubo exato, em fração.
 *
 * `0` seria exato; `0.0134` é 1,34 % mais baixo que um cubo. Existe para ser
 * declarado na documentação em vez de virar folclore.
 */
export function cubeHeightError(geom: IsoCubeGeometry): number {
  const exact = exactCubeHeight(geom.tileWidth, geom.tileHeight);
  return Math.abs(geom.cubeHeight - exact) / exact;
}

// ---------------------------------------------------------------- fábrica

/** Faixa de `image_size` do `/create-isometric-tile` (spec vendorizado). */
export const PIXELLAB_TILE_MIN = 16;
export const PIXELLAB_TILE_MAX = 64;

export class IsoCubeGeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IsoCubeGeometryError';
  }
}

/**
 * Constrói a geometria a partir da largura do tile.
 *
 * `tileWidth` precisa ser múltiplo de 4: `tileHeight = W/2` tem de ser par para
 * o losango ter meia-altura inteira, e é a meia-altura que a rasterização de
 * duas linhas por degrau usa. Largura ímpar produz um losango sem centro, que
 * é onde nascem as costuras de um pixel.
 */
export function makeIsoCubeGeometry(tileWidth: number): IsoCubeGeometry {
  if (!Number.isInteger(tileWidth) || tileWidth <= 0) {
    throw new IsoCubeGeometryError(
      `tileWidth precisa ser inteiro positivo (recebido ${String(tileWidth)}).`,
    );
  }
  if (tileWidth % 4 !== 0) {
    throw new IsoCubeGeometryError(
      `tileWidth precisa ser múltiplo de 4 (recebido ${tileWidth}): ` +
        'com W/4 fracionário o losango 2:1 não tem meia-altura inteira e a ' +
        'costura entre células abre um pixel.',
    );
  }

  const tileHeight = tileWidth / 2;
  const cubeHeight = Math.round(exactCubeHeight(tileWidth, tileHeight));

  return Object.freeze({
    tileWidth,
    tileHeight,
    cubeHeight,
    spriteWidth: tileWidth,
    spriteHeight: tileHeight + cubeHeight,
    anchorX: tileWidth / 2,
    anchorY: 0,
  });
}

/**
 * Recusa a geometria se o sprite não couber no `image_size` do endpoint.
 *
 * Chamado antes de qualquer geração: descobrir que o molde não cabe DEPOIS de
 * pagar é a definição de custo surpresa.
 */
export function assertFitsPixelLab(geom: IsoCubeGeometry): void {
  const fails: string[] = [];
  if (geom.spriteWidth < PIXELLAB_TILE_MIN || geom.spriteWidth > PIXELLAB_TILE_MAX) {
    fails.push(`largura ${geom.spriteWidth}`);
  }
  if (geom.spriteHeight < PIXELLAB_TILE_MIN || geom.spriteHeight > PIXELLAB_TILE_MAX) {
    fails.push(`altura ${geom.spriteHeight}`);
  }
  if (fails.length > 0) {
    throw new IsoCubeGeometryError(
      `o sprite ${geom.spriteWidth}×${geom.spriteHeight} não cabe no image_size do ` +
        `/create-isometric-tile (${PIXELLAB_TILE_MIN}–${PIXELLAB_TILE_MAX} por lado): ` +
        `${fails.join(', ')}. Reduza tileWidth.`,
    );
  }
}

/**
 * A geometria canônica do projeto: tile de 48 px.
 *
 * Por que 48 e não outra coisa:
 *
 *   - O sprite fica 48×53, e as duas medidas cabem na faixa 16–64 do
 *     `/create-isometric-tile`. Em 2:1 o sprite mede `1,1124 · W`, então
 *     `W = 56` (56×62) é o maior que cabe e `W = 64` (64×71) **não cabe**.
 *   - 48 é múltiplo de 4 — meia-altura do losango inteira (12 px).
 *   - Bem acima dos 24 px que o próprio spec recomenda como piso de qualidade.
 *   - É o tamanho dos blocos já pagos: `48` mantém a arte existente na mesma
 *     escala, mesmo que a aresta vertical mude.
 *
 * O cubo exato pediria 29,3939 px de aresta; usamos 29 — **1,34 % mais baixo
 * que um cubo perfeito**, ou 0,39 px no sprite inteiro. Declarado aqui porque
 * documentação que finge exatidão é pior que documentação ausente.
 */
export const CANONICAL_CUBE: IsoCubeGeometry = makeIsoCubeGeometry(48);

// ---------------------------------------------------------------- rasterização

/** Extensão horizontal de uma linha do sprite. `width === 0` é linha vazia. */
export interface RowSpan {
  readonly start: number;
  readonly width: number;
}

/**
 * Linhas do losango do topo, isoladamente.
 *
 * Rasterização clássica de dois pixels por degrau: cada linha é 4 px mais larga
 * que a anterior (2 de cada lado), o que dá exatamente a inclinação 1:2 da
 * aresta. As duas linhas do meio ficam na largura cheia — é assim que um
 * losango de altura par fecha simétrico.
 */
export function diamondRow(y: number, geom: IsoCubeGeometry): RowSpan {
  const { tileWidth: w, tileHeight: h } = geom;
  if (y < 0 || y >= h) return { start: 0, width: 0 };
  const half = h / 2;
  const width = y < half ? 4 * (y + 1) : 4 * (h - y);
  return { start: (w - width) / 2, width };
}

/**
 * Linhas da silhueta do cubo inteiro (topo + as duas laterais).
 *
 * Três trechos: a metade de cima do losango, o corpo de largura cheia — que tem
 * `cubeHeight + 1` linhas, não `cubeHeight` — e a metade de baixo do losango
 * deslocada de `cubeHeight`.
 */
export function silhouetteRow(y: number, geom: IsoCubeGeometry): RowSpan {
  const { tileWidth: w, tileHeight: h, cubeHeight: d, spriteHeight } = geom;
  if (y < 0 || y >= spriteHeight) return { start: 0, width: 0 };
  const half = h / 2;
  if (y < half) return diamondRow(y, geom);
  if (y < half + d) return { start: 0, width: w };
  return diamondRow(y - d, geom);
}

/** Faixa vertical ocupada por uma coluna de pixels do sprite. */
export interface ColumnBounds {
  /** Primeira linha do losango do topo nesta coluna. */
  readonly topStart: number;
  /** Última linha do losango do topo nesta coluna (inclusive). */
  readonly topEnd: number;
  /** Primeira linha de face lateral nesta coluna. */
  readonly sideStart: number;
  /** Última linha de face lateral nesta coluna (inclusive). */
  readonly sideEnd: number;
}

/**
 * Limites verticais de uma coluna do sprite.
 *
 * Por coluna, e não por linha, porque a face lateral é um paralelogramo de
 * aresta vertical: em cada coluna ela ocupa exatamente `cubeHeight` linhas,
 * logo abaixo do losango. Isso torna o desenho e a verificação a mesma conta.
 */
export function columnBounds(x: number, geom: IsoCubeGeometry): ColumnBounds | null {
  const { tileWidth: w, tileHeight: h, cubeHeight: d } = geom;
  if (x < 0 || x >= w) return null;
  const mirrored = Math.min(x, w - 1 - x);
  const half = h / 2;
  const topStart = half - 1 - Math.floor(mirrored / 2);
  const topEnd = h - 1 - topStart;
  return { topStart, topEnd, sideStart: topEnd + 1, sideEnd: topEnd + d };
}

/**
 * Qual face ocupa o pixel `(x, y)` do sprite, ou `null` fora da silhueta.
 *
 * É a primitiva única: quem PINTA o molde usa isto, e quem VERIFICA um sprite
 * gerado usa o mesmo. Duas implementações da mesma pergunta é como o validador
 * passa a aprovar o que o pintor não desenha.
 */
export function faceAtPixel(
  x: number,
  y: number,
  geom: IsoCubeGeometry,
): CubeFace | null {
  const b = columnBounds(x, geom);
  if (b === null) return null;
  if (y < b.topStart || y > b.sideEnd) return null;
  if (y <= b.topEnd) return 'top';
  return x < geom.tileWidth / 2 ? 'left' : 'right';
}

/** Quantos pixels a silhueta ocupa. Útil para tolerância de validação. */
export function silhouetteArea(geom: IsoCubeGeometry): number {
  let total = 0;
  for (let y = 0; y < geom.spriteHeight; y += 1) total += silhouetteRow(y, geom).width;
  return total;
}

