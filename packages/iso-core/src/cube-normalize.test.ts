/**
 * Teste da normalização do sprite de bloco.
 *
 * O caso que importa não é o feliz: é a arte que voltou deslocada, mais baixa
 * que o molde e com enfeite estourando para fora. Os testes abaixo constroem
 * exatamente isso a partir do molde canônico, porque um caso sintético que eu
 * mesmo desenhei não prova nada sobre o que a API devolve — mas um molde
 * deliberadamente estragado prova que a correção reverte o estrago.
 *
 * Execute com: node --test src/cube-normalize.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_CUBE, columnBounds, faceAtPixel } from './iso-cube.ts';
import { MOULD_PALETTE, rasterizeCube, type RgbaImage } from './cube-raster.ts';
import { alphaBounds, normalizeCubeSprite } from './cube-normalize.ts';

const G = CANONICAL_CUBE;

const alphaAt = (img: RgbaImage, x: number, y: number): number =>
  img.data[(y * img.width + x) * 4 + 3]!;

/** Cópia da imagem num canvas maior, deslocada — simula a arte fora do lugar. */
function shift(src: RgbaImage, dx: number, dy: number, w: number, h: number): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;
      const si = (y * src.width + x) * 4;
      const di = (ty * w + tx) * 4;
      data[di] = src.data[si]!;
      data[di + 1] = src.data[si + 1]!;
      data[di + 2] = src.data[si + 2]!;
      data[di + 3] = src.data[si + 3]!;
    }
  }
  return { width: w, height: h, data };
}

/** Pinta um pixel opaco — usado para simular tufos de grama fora da silhueta. */
function poke(img: RgbaImage, x: number, y: number): void {
  const i = (y * img.width + x) * 4;
  img.data[i] = 0;
  img.data[i + 1] = 200;
  img.data[i + 2] = 0;
  img.data[i + 3] = 255;
}

// ------------------------------------------------------------------ bbox

test('alphaBounds acha a caixa e devolve null em imagem vazia', () => {
  const vazio: RgbaImage = { width: 4, height: 4, data: new Uint8ClampedArray(64) };
  assert.equal(alphaBounds(vazio), null);
  poke(vazio, 1, 2);
  poke(vazio, 3, 3);
  assert.deepEqual(alphaBounds(vazio), { minX: 1, minY: 2, maxX: 3, maxY: 3 });
});

// ------------------------------------------------------------------ identidade

test('o molde canônico normaliza para si mesmo, sem deslocamento', () => {
  const molde = rasterizeCube(MOULD_PALETTE, G);
  const r = normalizeCubeSprite(molde, G);
  assert.equal(r.offsetX, 0);
  assert.equal(r.offsetY, 0);
  assert.equal(r.landmark, 'cintura');
  assert.equal(r.clipped, 0);
  assert.equal(r.extended, 0);
  assert.equal(r.coverage, 1);
  assert.deepEqual(r.avisos, []);
  assert.deepEqual(Array.from(r.image.data), Array.from(molde.data));
});

// ------------------------------------------------------------------ deslocamento

test('arte deslocada volta ao lugar, pixel a pixel', () => {
  const molde = rasterizeCube(MOULD_PALETTE, G);
  // Deslocamentos que mantêm a arte INTEIRA dentro da tela: truncar a arte
  // muda a resposta certa, e aí o teste mediria o corte, não o alinhamento.
  for (const [dx, dy] of [
    [3, 2],
    [8, 5],
    [0, 9],
  ] as const) {
    const torto = shift(molde, dx, dy, 64, 64);
    const r = normalizeCubeSprite(torto, G);
    assert.equal(r.offsetX, -dx + 0, `offsetX para (${dx}, ${dy})`);
    assert.equal(r.offsetY, -dy + 0, `offsetY para (${dx}, ${dy})`);
    assert.equal(r.coverage, 1, `cobertura para (${dx}, ${dy})`);
    assert.deepEqual(
      Array.from(r.image.data),
      Array.from(molde.data),
      `pixels para (${dx}, ${dy})`,
    );
  }
});

test('a saída tem sempre o tamanho canônico, venha do que vier', () => {
  const molde = rasterizeCube(MOULD_PALETTE, G);
  for (const [w, h] of [
    [64, 64],
    [40, 40],
    [48, 48],
  ] as const) {
    const r = normalizeCubeSprite(shift(molde, 2, 2, w, h), G);
    assert.equal(r.image.width, G.spriteWidth);
    assert.equal(r.image.height, G.spriteHeight);
  }
});

// ------------------------------------------------------------------ recorte

test('enfeite fora da silhueta é recortado e contado', () => {
  const molde = rasterizeCube(MOULD_PALETTE, G);
  const comGrama = shift(molde, 0, 6, 48, 64);
  // Seis tufos na altura do vértice do topo mas DESLOCADOS para a lateral: ali
  // a silhueta tem 8 px de largura, então x = 10..15 cai fora dela.
  for (let i = 0; i < 6; i += 1) poke(comGrama, 10 + i, 7);
  const r = normalizeCubeSprite(comGrama, G);
  assert.equal(r.clipped, 6);
  assert.match(r.avisos.join(' '), /recortados/);
  for (let y = 0; y < r.image.height; y += 1) {
    for (let x = 0; x < r.image.width; x += 1) {
      if (faceAtPixel(x, y, G) === null) assert.equal(alphaAt(r.image, x, y), 0);
    }
  }
});

// ------------------------------------------------------------------ altura

test('bloco mais baixo que o molde tem a base completada', () => {
  // Um cubo com aresta 21 em vez de 29 — foi o que a API entregou nos blocos já
  // pagos deste projeto.
  const baixo = rasterizeCube(MOULD_PALETTE, { ...G, cubeHeight: 21, spriteHeight: 45 });
  const r = normalizeCubeSprite(baixo, G, { extendSides: true });
  assert.ok(r.extended > 0, 'nada foi completado');
  assert.equal(r.coverage, 1, 'a base ficou fechada');
  // Cada coluna precisa chegar até a última linha da sua face lateral.
  for (let x = 0; x < G.tileWidth; x += 1) {
    const b = columnBounds(x, G)!;
    assert.ok(alphaAt(r.image, x, b.sideEnd) > 0, `coluna ${x} vazia na base`);
  }
});

test('sem completar a base, a cobertura cai e o aviso aparece', () => {
  const baixo = rasterizeCube(MOULD_PALETTE, { ...G, cubeHeight: 21, spriteHeight: 45 });
  const r = normalizeCubeSprite(baixo, G, { extendSides: false });
  assert.equal(r.extended, 0);
  assert.ok(r.coverage < 1, `cobertura ${r.coverage}`);
  assert.match(r.avisos.join(' '), /preenche/);
});

// ------------------------------------------------------------------ degenerados

test('imagem vazia devolve sprite vazio com aviso, sem explodir', () => {
  const vazio: RgbaImage = { width: 48, height: 53, data: new Uint8ClampedArray(48 * 53 * 4) };
  const r = normalizeCubeSprite(vazio, G);
  assert.equal(r.coverage, 0);
  assert.match(r.avisos.join(' '), /transparente/);
});

test('arte que nunca atinge a largura do tile cai no bbox e avisa', () => {
  const pequeno = rasterizeCube(MOULD_PALETTE, {
    ...G,
    tileWidth: 24,
    tileHeight: 12,
    cubeHeight: 15,
    spriteWidth: 24,
    spriteHeight: 27,
    anchorX: 12,
  });
  const r = normalizeCubeSprite(shift(pequeno, 12, 12, 48, 53), G);
  assert.equal(r.landmark, 'bbox');
  assert.match(r.avisos.join(' '), /caixa delimitadora/);
});
