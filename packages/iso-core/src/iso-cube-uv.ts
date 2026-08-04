/**
 * UV: a sprite isométrica esticada sobre as três faces do cubo 3D.
 *
 * Uma sprite só, a mesma que o editor 2D desenharia inteira na célula, vira a
 * textura das três faces visíveis do `BoxGeometry`. Nada é recortado em três
 * imagens: o que muda é o UV de cada face, que passa a apontar para a região da
 * sprite que aquela face ocupa na projeção.
 *
 * ## Por que isto é exato, e não uma aproximação
 *
 * A câmera do editor 3D é ortográfica, com yaw 45° e elevação 30°. Nessa
 * posição, um passo em X na tela anda `cos45` para a direita e `sin30·sin45`
 * para baixo — razão exatamente **2:1**, a mesma da projeção que
 * {@link file://./iso-cube.ts} define:
 *
 * ```text
 * sx = (x − y) · W/2
 * sy = (x + y) · H/2 − z · d
 * ```
 *
 * Ou seja: a câmera 3D **é** a projeção da sprite. Cada face do cubo projeta
 * num paralelogramo da sprite — o topo no losango, as laterais nos dois
 * paralelogramos de aresta vertical — e um paralelogramo é a imagem afim de um
 * quadrado. Mapear canto-com-canto é portanto exato nos dois triângulos da
 * face, sem deformação e sem costura na diagonal do quad.
 *
 * A conta abaixo é a projeção acima com dois ajustes de origem: o cubo local do
 * three.js vai de 0 a 1 em cada eixo (`cx`, `cy`, `cz`), e a sprite ancora o
 * vértice superior do losango em `(anchorX, 0)` — daí o `+ anchorX` em x e o
 * `+ (1 − cy)·cubeHeight` em y, que troca "z para cima a partir do chão" por
 * "linha da imagem para baixo a partir do topo".
 *
 * ## O que o mapeamento NÃO conserta
 *
 * A arte é esticada sobre um cubo de aresta 1. Se a sprite não tiver a
 * proporção canônica (`spriteHeight = tileWidth/2 + 0,6124·tileWidth`), a arte
 * aparece esticada ou achatada na vertical — o cubo continua cúbico, a arte é
 * que se acomoda. Isso é o comportamento pedido ("ela vai se esticar"), não um
 * defeito, mas é bom saber de onde vem quando um bloco parece alto demais.
 *
 * ## Convenção de `v`
 *
 * As texturas do editor são carregadas com `flipY` no default do three.js
 * (`true`), então `v = 1` é a **primeira linha** da imagem e `v = 0` a última.
 * É por isso que `v` sai como `1 − y/spriteHeight` e não `y/spriteHeight`.
 */
import { type IsoCubeGeometry } from './iso-cube.ts';

// ---------------------------------------------------------------- tipos

/**
 * Um canto do cubo unitário, no sistema do three.js: `x` e `z` no chão, `y`
 * para cima. Cada componente é 0 ou 1 — são os 8 cantos do `BoxGeometry(1,1,1)`
 * depois de deslocado do centro para o canto.
 */
export interface CubeCorner {
  readonly cx: 0 | 1;
  readonly cy: 0 | 1;
  readonly cz: 0 | 1;
}

/** Um ponto na sprite, em pixels, com origem no canto superior esquerdo. */
export interface SpritePixel {
  readonly x: number;
  readonly y: number;
}

/** Coordenada de textura, já na convenção `flipY = true` do three.js. */
export interface SpriteUv {
  readonly u: number;
  readonly v: number;
}

// ---------------------------------------------------------------- projeção

/**
 * Onde um canto do cubo cai na sprite, em pixels.
 *
 * É a projeção 2:1 do iso-core escrita para o cubo unitário do three.js. Os
 * oito cantos, na geometria canônica 48×53:
 *
 * ```text
 * (0,1,0) → (24, 0)   vértice de trás do losango  (o mais alto da tela)
 * (1,1,0) → (48,12)   vértice direito do losango
 * (1,1,1) → (24,24)   vértice da frente do losango — o vinco entre as laterais
 * (0,1,1) → ( 0,12)   vértice esquerdo do losango
 * (1,0,0) → (48,41)   base da aresta direita
 * (1,0,1) → (24,53)   base do vinco  (o mais baixo da tela)
 * (0,0,1) → ( 0,41)   base da aresta esquerda
 * (0,0,0) → (24,29)   canto de trás, embaixo — o único invisível
 * ```
 */
export function cornerSpritePixel(
  corner: CubeCorner,
  geom: IsoCubeGeometry,
): SpritePixel {
  const { cx, cy, cz } = corner;
  return {
    x: geom.anchorX + (cx - cz) * (geom.tileWidth / 2),
    y: (cx + cz) * (geom.tileHeight / 2) + (1 - cy) * geom.cubeHeight,
  };
}

/**
 * O mesmo ponto, normalizado em UV para o three.js.
 *
 * Este é o valor que vai no atributo `uv` do vértice. Escrever o UV a partir da
 * POSIÇÃO do vértice — e não transformando o UV default do `BoxGeometry` — é
 * deliberado: o UV default depende da ordem em que o three.js emite os
 * vértices de cada face, que é detalhe interno da biblioteca, enquanto a
 * posição é a geometria e não muda entre versões.
 */
export function cornerSpriteUv(
  corner: CubeCorner,
  geom: IsoCubeGeometry,
): SpriteUv {
  const px = cornerSpritePixel(corner, geom);
  return {
    u: px.x / geom.spriteWidth,
    v: 1 - px.y / geom.spriteHeight,
  };
}

/**
 * Converte a posição local de um vértice do `BoxGeometry(1,1,1)` no canto
 * correspondente.
 *
 * O `BoxGeometry` nasce centrado na origem: cada coordenada é −0,5 ou +0,5. O
 * sinal decide o bit. O `>= 0` (e não `> 0`) é o que garante resposta para
 * geometrias que alguém tenha centrado de outro jeito — nunca devolve `null`,
 * porque um vértice sem UV é um triângulo preto na tela.
 */
export function cornerOfLocalPosition(
  x: number,
  y: number,
  z: number,
): CubeCorner {
  return {
    cx: x >= 0 ? 1 : 0,
    cy: y >= 0 ? 1 : 0,
    cz: z >= 0 ? 1 : 0,
  };
}

// ---------------------------------------------------------------- geometria a partir da imagem

/**
 * Deduz a geometria isométrica de uma imagem qualquer.
 *
 * A sprite canônica tem largura `tileWidth` e altura `tileHeight + cubeHeight`,
 * com `tileHeight = tileWidth / 2`. Invertendo: a largura da imagem É o
 * `tileWidth`, e o que sobra de altura depois da metade superior do losango é a
 * aresta vertical.
 *
 * Existe porque a arte não vem sempre no 48×53 canônico: um bloco gerado com
 * outro `image_size`, ou uma sprite que o usuário desenhou à mão, tem de
 * funcionar sem regerar nada. Devolve `null` quando as proporções não podem ser
 * um cubo isométrico — imagem mais baixa que o losango do topo não tem lateral
 * nenhuma, e esticar isso sobre um cubo daria arte espelhada nas faces.
 *
 * Diferente de `makeIsoCubeGeometry`, aqui **não** se exige `tileWidth`
 * múltiplo de 4: aquela regra existe para RASTERIZAR sem costura de um pixel, e
 * este caminho só LÊ arte pronta. Recusar uma sprite 50×55 por causa de uma
 * regra do rasterizador seria recusar arte que desenha perfeitamente bem.
 */
export function spriteGeometryFromImage(
  width: number,
  height: number,
): IsoCubeGeometry | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width < 2 || height < 2) return null;
  const tileHeight = width / 2;
  const cubeHeight = height - tileHeight;
  // Sem aresta vertical não há cubo: é um losango solto, ou uma textura plana.
  if (cubeHeight <= 0) return null;
  return Object.freeze({
    tileWidth: width,
    tileHeight,
    cubeHeight,
    spriteWidth: width,
    spriteHeight: height,
    anchorX: width / 2,
    anchorY: 0,
  });
}

/**
 * Quanto a proporção da sprite se afasta do cubo perfeito, em fração.
 *
 * `0` é o cubo exato (`cubeHeight = tileWidth·√6/4`); `0,5` seria uma arte com
 * metade da altura que um cubo pede, e ela apareceria esticada ao dobro na
 * vertical. Serve para AVISAR, nunca para recusar — a arte do usuário manda.
 */
export function spriteStretchError(geom: IsoCubeGeometry): number {
  const exact = Math.sqrt(
    (geom.tileWidth * geom.tileWidth - geom.tileHeight * geom.tileHeight) / 2,
  );
  if (!(exact > 0)) return 0;
  return Math.abs(geom.cubeHeight - exact) / exact;
}
