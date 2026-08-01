/**
 * Teste do rasterizador do cubo.
 *
 * A propriedade central é uma só: **o que o rasterizador pinta é exatamente a
 * silhueta que a geometria descreve** — nem um pixel a mais, nem um a menos. É
 * ela que garante que o molde mandado à PixelLab, a arte de reserva e o cubo de
 * preview sejam a mesma forma, e não três aproximações da mesma ideia.
 *
 * Execute com: node --test src/cube-raster.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_CUBE, faceAtPixel, silhouetteArea } from './iso-cube.ts';
import {
  MOULD_PALETTE,
  hsl,
  materialShader,
  paletteFromHue,
  rasterizeCube,
  rasterizeDiamond,
  type RgbaImage,
} from './cube-raster.ts';

const G = CANONICAL_CUBE;

const alphaAt = (img: RgbaImage, x: number, y: number): number =>
  img.data[(y * img.width + x) * 4 + 3]!;

const rgbAt = (img: RgbaImage, x: number, y: number): string =>
  [0, 1, 2].map((k) => img.data[(y * img.width + x) * 4 + k]!).join(',');

// ------------------------------------------------------------------ forma

test('o buffer tem exatamente o tamanho do sprite canônico', () => {
  const img = rasterizeCube(MOULD_PALETTE, G);
  assert.equal(img.width, 48);
  assert.equal(img.height, 53);
  assert.equal(img.data.length, 48 * 53 * 4);
});

test('pinta a silhueta inteira e nada fora dela', () => {
  const img = rasterizeCube(MOULD_PALETTE, G, { outline: false });
  let pintados = 0;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const dentro = faceAtPixel(x, y, G) !== null;
      const opaco = alphaAt(img, x, y) > 0;
      assert.equal(opaco, dentro, `divergência em (${x}, ${y})`);
      if (opaco) pintados += 1;
    }
  }
  assert.equal(pintados, silhouetteArea(G));
});

test('o contorno não vaza da silhueta', () => {
  const img = rasterizeCube(MOULD_PALETTE, G, { outline: true });
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (faceAtPixel(x, y, G) === null) {
        assert.equal(alphaAt(img, x, y), 0, `contorno vazou em (${x}, ${y})`);
      }
    }
  }
});

test('nada é desenhado abaixo do cubo — não há sombra projetada', () => {
  const img = rasterizeCube(MOULD_PALETTE, G);
  // A última linha do sprite é o vértice inferior do cubo. Se houvesse sombra,
  // a coluna 0 (fora do vértice) estaria pintada lá embaixo.
  assert.equal(alphaAt(img, 0, img.height - 1), 0);
  assert.equal(alphaAt(img, img.width - 1, img.height - 1), 0);
  assert.ok(alphaAt(img, img.width / 2, img.height - 1) > 0, 'o vértice existe');
});

// ------------------------------------------------------------------ tons

test('as três faces saem em três tons distintos', () => {
  const img = rasterizeCube(MOULD_PALETTE, G, { outline: false });
  const topo = rgbAt(img, 24, 2);
  const esquerda = rgbAt(img, 4, 20);
  const direita = rgbAt(img, 44, 20);
  assert.equal(faceAtPixel(24, 2, G), 'top');
  assert.equal(faceAtPixel(4, 20, G), 'left');
  assert.equal(faceAtPixel(44, 20, G), 'right');
  assert.notEqual(topo, esquerda);
  assert.notEqual(topo, direita);
  assert.notEqual(esquerda, direita);
});

test('o topo é o tom mais claro e a esquerda o mais escuro', () => {
  const lum = (c: { r: number; g: number; b: number }): number =>
    0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const p = paletteFromHue(105);
  assert.ok(lum(p.top) > lum(p.right));
  assert.ok(lum(p.right) > lum(p.left));
});

test('a paleta do molde é acromática — o molde carrega forma, não cor', () => {
  for (const face of [MOULD_PALETTE.top, MOULD_PALETTE.left, MOULD_PALETTE.right]) {
    assert.equal(face.r, face.g);
    assert.equal(face.g, face.b);
  }
});

test('hsl bate com os valores conhecidos', () => {
  assert.deepEqual(hsl(0, 1, 0.5), { r: 255, g: 0, b: 0, a: 255 });
  assert.deepEqual(hsl(120, 1, 0.5), { r: 0, g: 255, b: 0, a: 255 });
  assert.deepEqual(hsl(240, 1, 0.5), { r: 0, g: 0, b: 255, a: 255 });
  assert.deepEqual(hsl(0, 0, 0.5), { r: 128, g: 128, b: 128, a: 255 });
  // Matiz negativo e acima de 360 normalizam.
  assert.deepEqual(hsl(-120, 1, 0.5), hsl(240, 1, 0.5));
  assert.deepEqual(hsl(480, 1, 0.5), hsl(120, 1, 0.5));
});

// ------------------------------------------------------------------ opções

test('alpha escala a opacidade sem mexer na forma', () => {
  const cheio = rasterizeCube(MOULD_PALETTE, G, { outline: false });
  const meio = rasterizeCube(MOULD_PALETTE, G, { alpha: 0.45, outline: false });
  for (let y = 0; y < cheio.height; y += 1) {
    for (let x = 0; x < cheio.width; x += 1) {
      const a = alphaAt(cheio, x, y);
      const b = alphaAt(meio, x, y);
      assert.equal(b > 0, a > 0, `forma mudou em (${x}, ${y})`);
      if (a > 0) assert.equal(b, Math.round(a * 0.45));
    }
  }
});

test('o shader substitui a cor chapada e recebe a face certa', () => {
  const vistas = new Set<string>();
  const img = rasterizeCube(MOULD_PALETTE, G, {
    outline: false,
    shader: (face, x, y) => {
      vistas.add(face);
      return { r: x, g: y, b: face === 'top' ? 255 : 0, a: 255 };
    },
  });
  assert.deepEqual([...vistas].sort(), ['left', 'right', 'top']);
  assert.equal(rgbAt(img, 24, 2), '24,2,255');
  assert.equal(rgbAt(img, 4, 20), '4,20,0');
});

// ------------------------------------------------------------------ losango

test('o losango da malha tem o tamanho do tile e é oco', () => {
  const stroke = { r: 255, g: 255, b: 255, a: 255 };
  const img = rasterizeDiamond(G, stroke);
  assert.equal(img.width, 48);
  assert.equal(img.height, 24);
  // O centro do losango fica vazio: é malha, não preenchimento.
  assert.equal(alphaAt(img, 24, 12), 0);
  // As bordas existem.
  assert.ok(alphaAt(img, 0, 12) > 0);
  assert.ok(alphaAt(img, 47, 12) > 0);
});

test('o losango preenchido cobre a mesma área que a face do topo', () => {
  const stroke = { r: 255, g: 255, b: 255, a: 255 };
  const img = rasterizeDiamond(G, stroke, { r: 0, g: 0, b: 255, a: 128 });
  let pintados = 0;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) if (alphaAt(img, x, y) > 0) pintados += 1;
  }
  assert.equal(pintados, G.tileHeight * (G.tileHeight + 2));
});

// ------------------------------------------------------------------ vistas

test('as quatro vistas procedurais são DIFERENTES entre si', () => {
  const vistas = [0, 1, 2, 3].map((v) =>
    rasterizeCube(paletteFromHue(105), G, { outline: false, shader: materialShader(105, v) }),
  );
  for (let a = 0; a < 4; a += 1) {
    for (let b = a + 1; b < 4; b += 1) {
      assert.notDeepEqual(
        Array.from(vistas[a]!.data),
        Array.from(vistas[b]!.data),
        `vistas ${a} e ${b} saíram idênticas — girar não mostraria nada novo`,
      );
    }
  }
});

test('a vista muda o DESENHO, nunca o tom médio da face', () => {
  const media = (view: number, face: 'top' | 'left' | 'right'): number => {
    const img = rasterizeCube(paletteFromHue(105), G, {
      outline: false,
      shader: materialShader(105, view),
    });
    let soma = 0;
    let n = 0;
    for (let y = 0; y < img.height; y += 1) {
      for (let x = 0; x < img.width; x += 1) {
        if (faceAtPixel(x, y, G) !== face) continue;
        soma += img.data[(y * img.width + x) * 4 + 1]!;
        n += 1;
      }
    }
    return soma / n;
  };
  for (const face of ['top', 'left', 'right'] as const) {
    const base = media(0, face);
    for (const v of [1, 2, 3]) {
      // A luz é presa à câmera: girar não pode clarear nem escurecer a face.
      assert.ok(Math.abs(media(v, face) - base) < 1, `face ${face}, vista ${v}`);
    }
  }
});

test('o shader de material é determinístico', () => {
  const a = rasterizeCube(paletteFromHue(210), G, { shader: materialShader(210, 2) });
  const b = rasterizeCube(paletteFromHue(210), G, { shader: materialShader(210, 2) });
  assert.deepEqual(Array.from(a.data), Array.from(b.data));
});

test('o grão do material não vaza da silhueta', () => {
  const img = rasterizeCube(paletteFromHue(30), G, { shader: materialShader(30, 1) });
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (faceAtPixel(x, y, G) === null) assert.equal(alphaAt(img, x, y), 0);
    }
  }
});
