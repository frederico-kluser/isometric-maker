/**
 * Lógica pura de recorte quadrado de imagem.
 *
 * Sem React, sem DOM, sem PixiJS — testável com `node --test`.
 *
 * ## O que este módulo resolve
 *
 * A PixelLab exige que `style_image` tenha as mesmas dimensões que `image_size`
 * no `/create-image-bitforge`. O usuário sobe uma imagem qualquer (ex.: 1393×860)
 * e precisa escolher que parte quadrada usar. Este módulo calcula o retângulo de
 * crop, aplica zoom e produz o PNG cropado em `size×size`.
 *
 * ## Três modos
 *
 * - **crop**: quadrado livre arrastável sobre a imagem.
 * - **fitWidth**: centraliza horizontalmente, completa topo/base com transparência.
 * - **fitHeight**: centraliza verticalmente, completa laterais com transparência.
 *
 * ## Zoom
 *
 * Inteiro (1–4), mesma política do editor de mapa. Com zoom 1×, o quadrado cobre
 * exatamente `size` pixels da imagem original. Com zoom 2×, cobre `size/2` (mais
 * detalhe, menos área).
 *
 * ## Preview
 *
 * Nearest-neighbor — a mesma amostragem que o resto do projeto usa para pixel art.
 * `imageSmoothingEnabled = false` no canvas.
 */

// ------------------------------------------------------------------ tipos

export type CropZoom = 1 | 2 | 3 | 4;

/** Modo de enquadramento. */
export type CropMode = 'crop' | 'fitWidth' | 'fitHeight';

/** Retângulo de crop na imagem original, sempre quadrado. */
export interface CropRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
}

/** Estado do crop arrastável. */
export interface CropCenter {
  cx: number;
  cy: number;
}

// ------------------------------------------------------------------ constantes

export const ZOOM_STEPS: readonly CropZoom[] = [1, 2, 3, 4] as const;

/** Tamanho máximo de output — o maior `image_size` que o PixelLab aceita. */
export const MAX_OUTPUT_SIZE = 256;

// ------------------------------------------------------------------ tamanho do quadrado

/**
 * Lado do quadrado de crop na imagem original, dado o zoom e o tamanho de saída.
 *
 * Com zoom 1×, cobre exatamente `outputSize` px da original.
 * Com zoom 2×, cobre `outputSize/2` px (vê mais detalhe, seleciona menos área).
 */
export function cropSize(zoom: CropZoom, outputSize: number): number {
  return Math.round(outputSize / zoom);
}

// ------------------------------------------------------------------ clamp

/**
 * Mantém o centro do quadrado dentro da imagem.
 *
 * O quadrado NUNCA sai da imagem: `cx ± halfSize` é clampado para `[0, width]`
 * e `[0, height]`. Se a imagem for menor que o quadrado (ex.: zoom 1× numa imagem
 * 100px com outputSize 128), o centro é fixado no meio e o preview completa com
 * transparência.
 */
export function clampCenter(
  cx: number,
  cy: number,
  halfSize: number,
  imgW: number,
  imgH: number,
): CropCenter {
  // Se a imagem é menor que o quadrado, ancora no centro da imagem.
  if (imgW <= halfSize * 2) {
    return { cx: imgW / 2, cy: Math.min(Math.max(cy, halfSize), imgH - halfSize) };
  }
  if (imgH <= halfSize * 2) {
    return { cx: Math.min(Math.max(cx, halfSize), imgW - halfSize), cy: imgH / 2 };
  }
  return {
    cx: Math.min(Math.max(cx, halfSize), imgW - halfSize),
    cy: Math.min(Math.max(cy, halfSize), imgH - halfSize),
  };
}

// ------------------------------------------------------------------ retângulo

/**
 * Converte centro + lado em CropRect.
 */
export function centerToRect(cx: number, cy: number, side: number): CropRect {
  return {
    x: Math.round(cx - side / 2),
    y: Math.round(cy - side / 2),
    w: side,
  };
}

// ------------------------------------------------------------------ modos de fit

/**
 * Crop que cobre toda a largura da imagem, centralizado verticalmente.
 *
 * Se a imagem é mais larga que `outputSize`, o crop é mais largo que o output e
 * o preview vai encolher a imagem para caber. Se é mais estreita, completa as
 * laterais com transparência.
 */
export function fitWidthRect(imgW: number, imgH: number): CropRect {
  return { x: 0, y: Math.round((imgH - imgW) / 2), w: imgW };
}

/**
 * Crop que cobre toda a altura da imagem, centralizado horizontalmente.
 */
export function fitHeightRect(imgW: number, imgH: number): CropRect {
  return { x: Math.round((imgW - imgH) / 2), y: 0, w: imgH };
}

/**
 * Crop inicial: centralizado na imagem, cobrindo o maior quadrado possível
 * (o lado menor da imagem).
 */
export function initialCrop(imgW: number, imgH: number, zoom: CropZoom, outputSize: number): CropRect {
  const side = Math.min(imgW, imgH);
  return {
    x: Math.round((imgW - side) / 2),
    y: Math.round((imgH - side) / 2),
    w: side,
  };
}

// ------------------------------------------------------------------ preview

/**
 * Desenha o preview do crop num canvas de destino (`outputSize × outputSize`).
 *
 * Nearest-neighbor de propósito: o usuário vê exatamente o que a PixelLab vai
 * receber, pixel por pixel.
 *
 * Se o crop cai fora da imagem (ex.: fit com transparência), as áreas vazias
 * ficam transparentes — o canvas é limpo antes de desenhar.
 */
export function renderCropPreview(
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  crop: CropRect,
  outputSize: number,
  destCtx: CanvasRenderingContext2D,
): void {
  destCtx.imageSmoothingEnabled = false;
  destCtx.clearRect(0, 0, outputSize, outputSize);

  if (crop.w <= 0 || outputSize <= 0) return;

  // Interseção do crop com a imagem.
  const srcX = Math.max(0, crop.x);
  const srcY = Math.max(0, crop.y);
  const srcW = Math.max(0, Math.min(crop.w, sourceW - srcX));
  const srcH = Math.max(0, Math.min(crop.w, sourceH - srcY));

  if (srcW <= 0 || srcH <= 0) return;

  // Mapeia para o canvas de output: a região do crop vai para o canvas inteiro.
  // Se o crop começa antes da imagem (crop.x < 0), a origem no canvas é deslocada.
  const dstX = crop.x < 0 ? Math.round((-crop.x / crop.w) * outputSize) : 0;
  const dstY = crop.y < 0 ? Math.round((-crop.y / crop.w) * outputSize) : 0;
  const dstW = Math.round((srcW / crop.w) * outputSize);
  const dstH = Math.round((srcH / crop.w) * outputSize);

  destCtx.drawImage(source, srcX, srcY, srcW, srcH, dstX, dstY, dstW, dstH);
}

// ------------------------------------------------------------------ extração

/**
 * Extrai o PNG cropado como string base64 (sem prefixo `data:`).
 *
 * Cria um canvas temporário, renderiza o preview e devolve o base64.
 */
export function extractCroppedBase64(
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  crop: CropRect,
  outputSize: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d')!;
  renderCropPreview(source, sourceW, sourceH, crop, outputSize, ctx);
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

// ------------------------------------------------------------------ eventos de ponteiro

/**
 * Converte coordenadas de tela (clientX/Y relativo ao canvas) para coordenadas
 * da imagem original, considerando o offset e a escala de exibição.
 *
 * @param clientX  Posição X relativa ao canvas.
 * @param clientY  Posição Y relativa ao canvas.
 * @param displayW Largura do canvas de exibição em px.
 * @param displayH Altura do canvas de exibição em px.
 * @param imgW     Largura da imagem original.
 * @param imgH     Altura da imagem original.
 */
export function screenToImage(
  clientX: number,
  clientY: number,
  displayW: number,
  displayH: number,
  imgW: number,
  imgH: number,
): { x: number; y: number } {
  // A imagem é desenhada para caber no canvas mantendo aspecto.
  const scale = Math.min(displayW / imgW, displayH / imgH);
  const offsetX = (displayW - imgW * scale) / 2;
  const offsetY = (displayH - imgH * scale) / 2;
  return {
    x: (clientX - offsetX) / scale,
    y: (clientY - offsetY) / scale,
  };
}
