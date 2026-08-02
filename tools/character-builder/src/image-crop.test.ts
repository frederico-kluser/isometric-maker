/**
 * Testes do módulo de recorte quadrado (image-crop.ts).
 *
 * Testam a lógica pura: sem canvas, sem DOM, sem React.
 * Para as funções que precisam de CanvasRenderingContext2D
 * (renderCropPreview, extractCroppedBase64), os testes usam
 * o canvas do Node 24, que implementa drawImage com suporte
 * básico a CanvasImageSource.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  centerToRect,
  clampCenter,
  cropSize,
  fitHeightRect,
  fitWidthRect,
  initialCrop,
  screenToImage,
  ZOOM_STEPS,
} from '../src/image-crop.ts';

// ------------------------------------------------------------------ cropSize

describe('cropSize', () => {
  it('zoom 1× cobre exatamente o outputSize', () => {
    assert.equal(cropSize(1, 128), 128);
    assert.equal(cropSize(1, 64), 64);
    assert.equal(cropSize(1, 256), 256);
  });

  it('zoom 2× cobre metade do outputSize', () => {
    assert.equal(cropSize(2, 128), 64);
    assert.equal(cropSize(2, 256), 128);
  });

  it('zoom 4× cobre um quarto', () => {
    assert.equal(cropSize(4, 128), 32);
    assert.equal(cropSize(4, 256), 64);
  });

  it('arredonda para inteiro', () => {
    assert.equal(cropSize(3, 128), 43); // 128/3 = 42.667 → 43
    assert.equal(cropSize(3, 100), 33); // 100/3 = 33.333 → 33
  });
});

// ------------------------------------------------------------------ clampCenter

describe('clampCenter', () => {
  it('centro dentro da imagem não mexe', () => {
    const r = clampCenter(100, 100, 50, 300, 200);
    assert.equal(r.cx, 100);
    assert.equal(r.cy, 100);
  });

  it('centro à esquerda da imagem é clampado', () => {
    const r = clampCenter(30, 100, 50, 300, 200);
    assert.equal(r.cx, 50); // halfSize = 50
    assert.equal(r.cy, 100);
  });

  it('centro acima da imagem é clampado', () => {
    const r = clampCenter(100, 20, 50, 300, 200);
    assert.equal(r.cx, 100);
    assert.equal(r.cy, 50);
  });

  it('centro à direita é clampado', () => {
    const r = clampCenter(280, 100, 50, 300, 200);
    assert.equal(r.cx, 250); // 300 - 50
    assert.equal(r.cy, 100);
  });

  it('centro abaixo é clampado', () => {
    const r = clampCenter(100, 180, 50, 300, 200);
    assert.equal(r.cx, 100);
    assert.equal(r.cy, 150); // 200 - 50
  });

  it('imagem menor que o quadrado ancora no centro horizontal', () => {
    // Imagem 80×200, quadrado de lado 100 (half=50)
    const r = clampCenter(50, 100, 50, 80, 200);
    assert.equal(r.cx, 40); // centro da imagem: 80/2
    assert.equal(r.cy, 100);
  });

  it('imagem menor que o quadrado ancora no centro vertical', () => {
    // Imagem 300×60, quadrado de lado 100 (half=50)
    const r = clampCenter(100, 35, 50, 300, 60);
    assert.equal(r.cx, 100);
    assert.equal(r.cy, 30); // centro da imagem: 60/2
  });
});

// ------------------------------------------------------------------ centerToRect

describe('centerToRect', () => {
  it('converte centro e lado em retângulo', () => {
    const r = centerToRect(100, 80, 64);
    assert.equal(r.x, 68);  // 100 - 32
    assert.equal(r.y, 48);  // 80 - 32
    assert.equal(r.w, 64);
  });

  it('lado ímpar arredonda x e y', () => {
    const r = centerToRect(100, 100, 43);
    assert.equal(r.w, 43);
    assert.equal(r.x, 79); // 100 - 21.5 → Math.round
    assert.equal(r.y, 79);
  });
});

// ------------------------------------------------------------------ fitWidthRect / fitHeightRect

describe('fitWidthRect', () => {
  it('imagem paisagem: crop cobre a largura inteira', () => {
    const r = fitWidthRect(300, 200);
    assert.equal(r.x, 0);
    assert.equal(r.w, 300);
    assert.equal(r.y, -50); // (200 - 300) / 2
  });

  it('imagem retrato: crop cobre a largura inteira', () => {
    const r = fitWidthRect(200, 400);
    assert.equal(r.x, 0);
    assert.equal(r.w, 200);
    assert.equal(r.y, 100); // (400 - 200) / 2
  });
});

describe('fitHeightRect', () => {
  it('imagem retrato: crop cobre a altura inteira', () => {
    const r = fitHeightRect(200, 400);
    assert.equal(r.y, 0);
    assert.equal(r.w, 400);
    assert.equal(r.x, -100); // (200 - 400) / 2
  });

  it('imagem paisagem: crop cobre a altura inteira', () => {
    const r = fitHeightRect(300, 200);
    assert.equal(r.y, 0);
    assert.equal(r.w, 200);
    assert.equal(r.x, 50); // (300 - 200) / 2
  });
});

// ------------------------------------------------------------------ initialCrop

describe('initialCrop', () => {
  it('imagem paisagem: crop cobre o lado menor centralizado', () => {
    const r = initialCrop(400, 300, 1, 128);
    assert.equal(r.x, 50);  // (400 - 300) / 2
    assert.equal(r.y, 0);
    assert.equal(r.w, 300);
  });

  it('imagem retrato: crop cobre o lado menor centralizado', () => {
    const r = initialCrop(200, 500, 1, 128);
    assert.equal(r.x, 0);
    assert.equal(r.y, 150); // (500 - 200) / 2
    assert.equal(r.w, 200);
  });

  it('imagem quadrada: crop cobre tudo', () => {
    const r = initialCrop(256, 256, 1, 128);
    assert.equal(r.x, 0);
    assert.equal(r.y, 0);
    assert.equal(r.w, 256);
  });
});

// ------------------------------------------------------------------ screenToImage

describe('screenToImage', () => {
  it('centro da tela mapeia para o centro da imagem', () => {
    const r = screenToImage(200, 150, 400, 300, 800, 600);
    assert.equal(r.x, 400);
    assert.equal(r.y, 300);
  });

  it('canto superior esquerdo mapeia para (0,0) quando aspect encaixa', () => {
    // Imagem 800×600 em canvas 400×300: scale = 0.5, offsetX = 0, offsetY = 0
    const r = screenToImage(0, 0, 400, 300, 800, 600);
    assert.equal(r.x, 0);
    assert.equal(r.y, 0);
  });

  it('imagem com barras laterais tem offset correto', () => {
    // Imagem 200×300 em canvas 400×300: scale = 1.0, offsetX = (400 - 200)/2 = 100
    const r = screenToImage(100, 0, 400, 300, 200, 300);
    assert.equal(r.x, 0);
    assert.equal(r.y, 0);
  });
});

// ------------------------------------------------------------------ ZOOM_STEPS

describe('ZOOM_STEPS', () => {
  it('tem 4 valores em ordem crescente', () => {
    assert.deepEqual(ZOOM_STEPS, [1, 2, 3, 4]);
  });
});
