/**
 * Teste da geometria canônica do cubo isométrico.
 *
 * O que estes testes travam é a única coisa que não pode ser "quase certa": a
 * relação entre a largura do tile e a aresta vertical. Errar aqui não produz um
 * bug visível — produz um mapa inteiro em perspectiva errada, que é o tipo de
 * erro que se atribui à arte.
 *
 * Execute com: node --test src/iso-cube.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_CUBE,
  CUBE_FACES,
  IsoCubeGeometryError,
  PIXELLAB_TILE_MAX,
  assertFitsPixelLab,
  columnBounds,
  cubeHeightError,
  diamondRow,
  exactCubeHeight,
  faceAtPixel,
  makeIsoCubeGeometry,
  silhouetteArea,
  silhouetteRow,
} from './iso-cube.ts';

const G = CANONICAL_CUBE;

// ------------------------------------------------------------------ a fórmula

test('a aresta vertical satisfaz d² = (W² − H²)/2', () => {
  for (const w of [16, 32, 36, 48, 52, 56]) {
    const d = exactCubeHeight(w, w / 2);
    assert.ok(
      Math.abs(d * d - (w * w - (w / 2) * (w / 2)) / 2) < 1e-9,
      `falhou para W=${w}`,
    );
  }
});

test('em 2:1 a aresta exata é W·√6/4', () => {
  for (const w of [16, 32, 48, 64]) {
    assert.ok(Math.abs(exactCubeHeight(w, w / 2) - (w * Math.sqrt(6)) / 4) < 1e-9);
  }
});

test('a projeção do cubo canônico é ortográfica: as duas linhas têm o mesmo módulo', () => {
  const { tileWidth: w, tileHeight: h, cubeHeight: d } = G;
  const linhaX = [w / 2, -w / 2, 0];
  const linhaY = [h / 2, h / 2, -d];
  const dot = linhaX[0]! * linhaY[0]! + linhaX[1]! * linhaY[1]! + linhaX[2]! * linhaY[2]!;
  assert.equal(dot, 0, 'as linhas precisam ser ortogonais');
  const modX = Math.hypot(...linhaX);
  const modY = Math.hypot(...linhaY);
  // Arredondar `d` desiguala os módulos. O desvio resultante é MENOR que o erro
  // do próprio arredondamento, porque a raiz quadrada amortece: 1,00 % contra
  // 1,34 %. Amarrar os dois é o que impede o teste de virar um número mágico.
  const desvio = Math.abs(modX - modY) / modX;
  assert.ok(desvio < cubeHeightError(G), `desvio ${desvio} vs erro ${cubeHeightError(G)}`);
  assert.ok(desvio < 0.011, `desvio ${desvio}`);
});

test('nenhuma largura inteira em 2:1 dá aresta vertical inteira', () => {
  for (let w = 4; w <= 512; w += 4) {
    const d = exactCubeHeight(w, w / 2);
    assert.notEqual(d, Math.round(d), `W=${w} teria d inteiro, o que contradiz a prova`);
  }
});

// ------------------------------------------------------------------ canônica

test('a geometria canônica é 48 × 24 com aresta 29 e sprite 48×53', () => {
  assert.deepEqual(
    { ...G },
    {
      tileWidth: 48,
      tileHeight: 24,
      cubeHeight: 29,
      spriteWidth: 48,
      spriteHeight: 53,
      anchorX: 24,
      anchorY: 0,
    },
  );
});

test('o erro do arredondamento canônico fica abaixo de 1,5 %', () => {
  const err = cubeHeightError(G);
  assert.ok(err < 0.015, `erro ${err}`);
  assert.ok(err > 0, 'se fosse zero a prova acima estaria errada');
});

test('o sprite canônico cabe no image_size do endpoint, e o de 64 não', () => {
  assert.doesNotThrow(() => assertFitsPixelLab(G));
  const grande = makeIsoCubeGeometry(64);
  assert.ok(grande.spriteHeight > PIXELLAB_TILE_MAX);
  assert.throws(() => assertFitsPixelLab(grande), IsoCubeGeometryError);
});

test('largura fora do múltiplo de 4 é recusada com o motivo', () => {
  assert.throws(() => makeIsoCubeGeometry(50), /múltiplo de 4/);
  assert.throws(() => makeIsoCubeGeometry(0), /inteiro positivo/);
});

test('a geometria é congelada — ninguém remenda a forma em tempo de execução', () => {
  assert.ok(Object.isFrozen(G));
});

// ------------------------------------------------------------------ losango

test('o losango tem inclinação 1:2 — 4 px a mais por linha', () => {
  for (let y = 1; y < G.tileHeight / 2; y += 1) {
    assert.equal(diamondRow(y, G).width - diamondRow(y - 1, G).width, 4);
  }
});

test('o losango é simétrico e fecha', () => {
  for (let y = 0; y < G.tileHeight; y += 1) {
    const a = diamondRow(y, G);
    const b = diamondRow(G.tileHeight - 1 - y, G);
    assert.equal(a.width, b.width, `linha ${y}`);
    assert.equal(a.start + a.width, G.tileWidth - a.start, 'centrado');
  }
  assert.equal(diamondRow(-1, G).width, 0);
  assert.equal(diamondRow(G.tileHeight, G).width, 0);
});

test('a área rasterizada do losango é H·(H+2), não W·H/2', () => {
  // O losango de pixel art não tem a área do losango ideal: os degraus de dois
  // pixels fazem a cintura ter DUAS linhas de largura cheia em vez de um vértice
  // de altura zero. A diferença é exatamente uma linha de largura W.
  let area = 0;
  for (let y = 0; y < G.tileHeight; y += 1) area += diamondRow(y, G).width;
  assert.equal(area, G.tileHeight * (G.tileHeight + 2));
  assert.equal(area - (G.tileWidth * G.tileHeight) / 2, G.tileWidth);
});

// ------------------------------------------------------------------ silhueta

test('a silhueta tem cubeHeight + 2 linhas de largura cheia', () => {
  // cubeHeight linhas de face lateral MAIS as duas linhas da cintura do losango.
  let cheias = 0;
  for (let y = 0; y < G.spriteHeight; y += 1) {
    if (silhouetteRow(y, G).width === G.tileWidth) cheias += 1;
  }
  assert.equal(cheias, G.cubeHeight + 2);
});

test('a silhueta ocupa toda a altura do sprite e nada além', () => {
  assert.ok(silhouetteRow(0, G).width > 0);
  assert.ok(silhouetteRow(G.spriteHeight - 1, G).width > 0);
  assert.equal(silhouetteRow(G.spriteHeight, G).width, 0);
  assert.equal(silhouetteRow(-1, G).width, 0);
});

test('cada coluna tem exatamente cubeHeight linhas de face lateral', () => {
  for (let x = 0; x < G.tileWidth; x += 1) {
    const b = columnBounds(x, G)!;
    assert.equal(b.sideEnd - b.sideStart + 1, G.cubeHeight, `coluna ${x}`);
    assert.equal(b.topEnd - b.topStart + 1, G.tileHeight - 2 * b.topStart, `topo ${x}`);
  }
  assert.equal(columnBounds(-1, G), null);
  assert.equal(columnBounds(G.tileWidth, G), null);
});

test('faceAtPixel e silhouetteRow descrevem a MESMA forma', () => {
  for (let y = 0; y < G.spriteHeight; y += 1) {
    const span = silhouetteRow(y, G);
    for (let x = 0; x < G.spriteWidth; x += 1) {
      const dentroDaLinha = x >= span.start && x < span.start + span.width;
      const face = faceAtPixel(x, y, G);
      assert.equal(
        face !== null,
        dentroDaLinha,
        `divergência em (${x}, ${y}): face=${String(face)} linha=${dentroDaLinha}`,
      );
    }
  }
});

test('as três faces existem e ocupam áreas plausíveis', () => {
  const conta: Record<string, number> = { top: 0, left: 0, right: 0 };
  for (let y = 0; y < G.spriteHeight; y += 1) {
    for (let x = 0; x < G.spriteWidth; x += 1) {
      const f = faceAtPixel(x, y, G);
      if (f) conta[f] = (conta[f] ?? 0) + 1;
    }
  }
  for (const f of CUBE_FACES) assert.ok(conta[f]! > 0, `face ${f} vazia`);
  assert.equal(conta['left'], conta['right'], 'as laterais são espelho uma da outra');
  assert.equal(conta['top'], G.tileHeight * (G.tileHeight + 2), 'o topo é o losango inteiro');
  assert.equal(conta['left'], (G.tileWidth / 2) * G.cubeHeight, 'meia largura × a aresta');
  assert.equal(conta['top']! + conta['left']! + conta['right']!, silhouetteArea(G));
});
