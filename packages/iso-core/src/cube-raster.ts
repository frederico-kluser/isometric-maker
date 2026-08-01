/**
 * Rasterizador do cubo isométrico — um só, para os dois consumidores.
 *
 * O Node usa para gravar o PNG do molde que vai como referência à PixelLab; o
 * navegador usa o MESMO código para a arte de reserva e para o cubo de preview.
 * Duas implementações da mesma forma é como o molde e o preview começam a
 * discordar sobre onde a peça assenta.
 *
 * Sai um buffer RGBA cru (`Uint8ClampedArray`, linha a linha, do topo). Quem
 * transforma em PNG ou em `ImageData` é de fora — este módulo não conhece nem
 * `node:zlib` nem `document`.
 *
 * ## Sem sombra projetada, por decisão
 *
 * Nenhuma função daqui desenha sombra no chão. Numa cena com câmera girável a
 * sombra teria de girar junto, e sprite pré-renderizado não gira: a sombra
 * ficaria apontando para o lado errado em três das quatro vistas. O volume vem
 * só do degradê das três faces, que é o que o gênero faz.
 *
 * ## A luz é presa à CÂMERA, não ao mundo
 *
 * Topo mais claro, direita intermediária, esquerda mais escura — sempre, nas
 * quatro vistas. É a convenção dos motores isométricos de quatro vistas: prender
 * a luz ao mundo exigiria quatro artes só para o sombreamento, e ainda faria a
 * mesma peça mudar de cor ao girar a câmera, o que se lê como bug e não como
 * iluminação. O que muda entre as vistas é o DESENHO do material, não o tom das
 * faces.
 */
import {
  CANONICAL_CUBE,
  columnBounds,
  type CubeFace,
  type IsoCubeGeometry,
} from './iso-cube.ts';

// ---------------------------------------------------------------- cor

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface CubePalette {
  readonly top: Rgba;
  readonly left: Rgba;
  readonly right: Rgba;
  /** Contorno da silhueta e das três arestas internas. Ausente = sem contorno. */
  readonly edge?: Rgba | undefined;
}

/** HSL → RGB. `h` em graus, `s` e `l` em 0–1. */
export function hsl(h: number, s: number, l: number, a = 255): Rgba {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
    a,
  };
}

/**
 * Os três tons de uma face a partir de um matiz.
 *
 * Os multiplicadores de luminosidade — topo 62 %, direita 47 %, esquerda 34 % —
 * são a razão ~1 : 0,76 : 0,55 que a pixel art isométrica usa para separar as
 * três faces. Mais perto que isso e o cubo achata; mais longe e as faces param
 * de parecer o mesmo material.
 */
export function paletteFromHue(hue: number, saturation = 0.45): CubePalette {
  return {
    top: hsl(hue, saturation, 0.62),
    right: hsl(hue, saturation, 0.47),
    left: hsl(hue, saturation, 0.34),
    edge: hsl(hue, saturation, 0.2),
  };
}

/**
 * Paleta neutra do MOLDE.
 *
 * Cinza de propósito: o molde vai como `init_image` e sua função é carregar a
 * FORMA, não a cor. Um molde colorido puxa a paleta da geração para o próprio
 * cinza — e aí todo bloco nasce cinza, independentemente do prompt.
 */
export const MOULD_PALETTE: CubePalette = {
  top: { r: 214, g: 214, b: 214, a: 255 },
  right: { r: 160, g: 160, b: 160, a: 255 },
  left: { r: 112, g: 112, b: 112, a: 255 },
  edge: { r: 64, g: 64, b: 64, a: 255 },
};

// ---------------------------------------------------------------- saída

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** `width × height × 4` bytes, ordem R, G, B, A, linha a linha do topo. */
  readonly data: Uint8ClampedArray;
}

/** Cor por pixel. Recebe a face e a coordenada LOCAL do sprite. */
export type Shader = (face: CubeFace, x: number, y: number) => Rgba;

export interface RasterOptions {
  /** Opacidade global, 0–1. O cubo de preview usa 0,45. */
  readonly alpha?: number;
  /** Desenha o contorno da silhueta e as três arestas internas. Default true. */
  readonly outline?: boolean;
  /** Substitui a cor chapada por face. Útil para textura procedural. */
  readonly shader?: Shader | undefined;
}

// ---------------------------------------------------------------- desenho

/**
 * Rasteriza o cubo canônico num buffer RGBA.
 *
 * O laço é por COLUNA, não por linha, porque a face lateral é um paralelogramo
 * de aresta vertical: em cada coluna ela ocupa exatamente `cubeHeight` linhas
 * logo abaixo do losango. Assim a forma sai da mesma conta que
 * `columnBounds` — e não de uma segunda aritmética que precisaria bater com
 * aquela por coincidência.
 */
export function rasterizeCube(
  palette: CubePalette,
  geom: IsoCubeGeometry = CANONICAL_CUBE,
  options: RasterOptions = {},
): RgbaImage {
  const { spriteWidth: w, spriteHeight: h, tileWidth, tileHeight } = geom;
  const alpha = options.alpha ?? 1;
  const outline = options.outline ?? true;
  const data = new Uint8ClampedArray(w * h * 4);

  const put = (x: number, y: number, c: Rgba): void => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const i = (y * w + x) * 4;
    data[i] = c.r;
    data[i + 1] = c.g;
    data[i + 2] = c.b;
    data[i + 3] = Math.round(c.a * alpha);
  };

  const colorOf = (face: CubeFace, x: number, y: number): Rgba => {
    if (options.shader) return options.shader(face, x, y);
    return face === 'top' ? palette.top : face === 'left' ? palette.left : palette.right;
  };

  const half = tileWidth / 2;

  for (let x = 0; x < w; x += 1) {
    const b = columnBounds(x, geom);
    if (b === null) continue;
    for (let y = b.topStart; y <= b.topEnd; y += 1) put(x, y, colorOf('top', x, y));
    const side: CubeFace = x < half ? 'left' : 'right';
    for (let y = b.sideStart; y <= b.sideEnd; y += 1) put(x, y, colorOf(side, x, y));
  }

  if (outline && palette.edge) {
    drawOutline(put, geom, palette.edge);
  }

  return { width: w, height: h, data };
}

/**
 * Contorno: a silhueta por fora e as três arestas internas que separam as faces.
 *
 * As internas não são enfeite — sem a aresta vertical do meio, as duas laterais
 * viram um plano só e o cubo perde a quina. É o traço que faz o olho ler
 * volume.
 */
function drawOutline(
  put: (x: number, y: number, c: Rgba) => void,
  geom: IsoCubeGeometry,
  edge: Rgba,
): void {
  const { tileWidth: w, tileHeight: hh, cubeHeight: d } = geom;
  const half = w / 2;

  for (let x = 0; x < w; x += 1) {
    const b = columnBounds(x, geom);
    if (b === null) continue;
    // Borda de cima e de baixo da silhueta, nesta coluna.
    put(x, b.topStart, edge);
    put(x, b.sideEnd, edge);
    // Aresta interna: onde o losango encontra a face lateral.
    if (x !== half - 1 && x !== half) put(x, b.topEnd, edge);
  }

  // Laterais verticais da silhueta e a quina do meio.
  for (let y = hh / 2; y <= hh / 2 + d; y += 1) {
    put(0, y, edge);
    put(w - 1, y, edge);
  }
  for (let y = hh; y <= hh + d; y += 1) {
    put(half - 1, y, edge);
    put(half, y, edge);
  }
}

/**
 * Textura procedural de material, variando por VISTA da câmera.
 *
 * ## O que muda entre as vistas, e o que não
 *
 * O **tom** de cada face é o mesmo nas quatro vistas: topo claro, direita
 * média, esquerda escura, sempre. A luz é presa à câmera (ver o cabeçalho deste
 * arquivo), e mudar o tom ao girar se leria como bug, não como iluminação.
 *
 * O que muda é o **desenho do material**. Girar 90° mostra outra face do cubo,
 * e outra face tem outro pedaço de granito, outra fiada de tijolos, outro tufo
 * de grama. É isso que faz o giro ler como volume em vez de "a mesma figura
 * deslizando".
 *
 * O padrão é uma função determinística de `(face, x, y, vista)` — sem
 * aleatoriedade, sem estado. A mesma peça na mesma vista sai idêntica em
 * qualquer execução, o que é o que permite cachear a textura.
 *
 * **Isto vale para a arte PROCEDURAL.** Um bloco gerado no modo `uniform` tem
 * uma arte só, reusada nas quatro vistas — é o que significa uniforme, e é o
 * que faz ele custar uma geração em vez de quatro. Quatro vistas realmente
 * distintas de arte gerada exigem o modo `oriented`, com quatro gerações.
 */
export function materialShader(hue: number, view: number, saturation = 0.45): Shader {
  const palette = paletteFromHue(hue, saturation);
  const base: Record<CubeFace, Rgba> = {
    top: palette.top,
    left: palette.left,
    right: palette.right,
  };

  // Hash inteiro barato e determinístico. Mistura a vista para que cada uma
  // tenha o próprio grão sem mexer no tom.
  const grain = (face: CubeFace, x: number, y: number): number => {
    const f = face === 'top' ? 17 : face === 'left' ? 31 : 47;
    let h = (x * 73856093) ^ (y * 19349663) ^ (f * 83492791) ^ (view * 2654435761);
    h = (h ^ (h >>> 13)) >>> 0;
    return (h % 1000) / 1000;
  };

  return (face, x, y) => {
    const c = base[face];
    // ±6 níveis de brilho. O suficiente para o olho ler textura, longe demais
    // do salto que faria a face parecer outro material.
    const d = Math.round((grain(face, x, y) - 0.5) * 12);
    return { r: c.r + d, g: c.g + d, b: c.b + d, a: c.a };
  };
}

/**
 * Só o losango do chão — a malha do editor.
 *
 * Um mapa vazio sem malha é uma tela preta: não há onde clicar com intenção.
 */
export function rasterizeDiamond(
  geom: IsoCubeGeometry,
  stroke: Rgba,
  fill?: Rgba,
): RgbaImage {
  const { tileWidth: w, tileHeight: h } = geom;
  const data = new Uint8ClampedArray(w * h * 4);
  const put = (x: number, y: number, c: Rgba): void => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const i = (y * w + x) * 4;
    data[i] = c.r;
    data[i + 1] = c.g;
    data[i + 2] = c.b;
    data[i + 3] = c.a;
  };

  for (let y = 0; y < h; y += 1) {
    const half = h / 2;
    const width = y < half ? 4 * (y + 1) : 4 * (h - y);
    const start = (w - width) / 2;
    if (fill) for (let x = start; x < start + width; x += 1) put(x, y, fill);
    for (let x = start; x < start + 2; x += 1) put(x, y, stroke);
    for (let x = start + width - 2; x < start + width; x += 1) put(x, y, stroke);
  }
  return { width: w, height: h, data };
}
