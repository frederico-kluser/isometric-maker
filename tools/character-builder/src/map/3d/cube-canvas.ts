/**
 * Cubo isométrico no navegador — a mesma forma do molde, em canvas.
 *
 * Antes morava em `map/cube.ts`, que era a ponte para o DOM usada pela cena
 * PixiJS do editor 2D. Com o fim do 2D (onda 2), os únicos consumidores
 * restantes são os materiais procedurais do editor 3D (`cube3d.ts`), então a
 * ponte veio para junto deles.
 *
 * A forma vem inteira de `packages/iso-core/src/cube-raster.ts` — o mesmo
 * código que gera o PNG do molde mandado à PixelLab. O que sobra aqui é
 * `Uint8ClampedArray` → `ImageData` → `<canvas>` → textura.
 *
 * **Dois usos, uma forma**
 *
 *   1. **Arte de reserva.** Um bloco sem sprite gerado precisa aparecer. Sem
 *      isso o editor só é utilizável DEPOIS de gastar dinheiro na API.
 *   2. **Cubo de preview.** O cursor de colocação é um cubo semitransparente, e
 *      ele nunca poderia vir de arte gerada: precisa ser translúcido, colorido
 *      pelo estado e existir mesmo sobre o vazio.
 */
import {
  CANONICAL_CUBE,
  type IsoCubeGeometry,
} from '../../../../../packages/iso-core/src/iso-cube.ts';
import {
  materialShader,
  paletteFromHue,
  rasterizeCube,
  type CubePalette,
  type RgbaImage,
} from '../../../../../packages/iso-core/src/cube-raster.ts';

/** Buffer RGBA → canvas, com suavização desligada. */
function toCanvas(img: RgbaImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('canvas 2d indisponível');
  ctx.imageSmoothingEnabled = false;
  // `createImageData` + `set` em vez do construtor de `ImageData`: o construtor
  // exige um `Uint8ClampedArray` cujo buffer o TypeScript sabe não ser
  // compartilhado, e o buffer que vem do iso-core é genérico. Copiar aqui custa
  // um sprite — que é desenhado uma vez por peça, não por quadro.
  const data = ctx.createImageData(img.width, img.height);
  data.data.set(img.data);
  ctx.putImageData(data, 0, 0);
  return canvas;
}

/**
 * Canvas com o cubo desenhado, pronto para virar textura.
 *
 * O canvas tem exatamente o bounding box do cubo — `spriteWidth × spriteHeight`
 * —, então o sprite ancora no mesmo ponto que a projeção calcula, sem offset
 * mágico em lugar nenhum.
 */
function makeCubeCanvas(
  palette: CubePalette,
  geom: IsoCubeGeometry = CANONICAL_CUBE,
  alpha = 1,
): HTMLCanvasElement {
  return toCanvas(rasterizeCube(palette, geom, { alpha, outline: true }));
}

/** Cubo a partir de um matiz — o caminho curto para a arte de reserva. */
export function makeCubeCanvasFromHue(
  hue: number,
  geom: IsoCubeGeometry = CANONICAL_CUBE,
  alpha = 1,
  saturation = 0.45,
): HTMLCanvasElement {
  return makeCubeCanvas(paletteFromHue(hue, saturation), geom, alpha);
}

/**
 * As QUATRO vistas de um cubo procedural.
 *
 * Mesmo tom de face nas quatro — a luz é presa à câmera — e desenho de material
 * diferente em cada. É o que faz girar a câmera ler como volume: o bloco mostra
 * outro pedaço de si, não a mesma figura deslizando.
 */
export function makeCubeViewsFromHue(
  hue: number,
  geom: IsoCubeGeometry = CANONICAL_CUBE,
  saturation = 0.45,
): HTMLCanvasElement[] {
  return [0, 1, 2, 3].map((view) =>
    toCanvas(
      rasterizeCube(paletteFromHue(hue, saturation), geom, {
        outline: true,
        shader: materialShader(hue, view, saturation),
      }),
    ),
  );
}
