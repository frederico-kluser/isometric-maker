/**
 * Teste do UV da sprite isométrica sobre o cubo 3D.
 *
 * O que trava aqui é a única coisa que não dá para conferir de olho: se um
 * canto do cubo cai no pixel errado da sprite, a arte não some — ela fica
 * *quase* certa, cisalhada de um jeito que se atribui à geração e não ao
 * mapeamento. Os oito cantos são verificados contra os vértices que a projeção
 * 2:1 do iso-core prevê, um por um.
 *
 * Execute com: node --test src/iso-cube-uv.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_CUBE, faceAtPixel, silhouetteMatch } from './iso-cube.ts';
import {
  cornerOfLocalPosition,
  cornerSpritePixel,
  cornerSpriteUv,
  spriteGeometryFromImage,
  spriteStretchError,
  type CubeCorner,
} from './iso-cube-uv.ts';

const G = CANONICAL_CUBE; // 48×53: tile 48×24, aresta 29

function corner(cx: 0 | 1, cy: 0 | 1, cz: 0 | 1): CubeCorner {
  return { cx, cy, cz };
}

// ------------------------------------------------------------------ os oito cantos

test('os oito cantos caem nos vértices previstos pela projeção 2:1', () => {
  const esperado: ReadonlyArray<[CubeCorner, number, number]> = [
    [corner(0, 1, 0), 24, 0], // vértice de trás do losango — o mais alto
    [corner(1, 1, 0), 48, 12], // vértice direito
    [corner(1, 1, 1), 24, 24], // vértice da frente = vinco entre as laterais
    [corner(0, 1, 1), 0, 12], // vértice esquerdo
    [corner(1, 0, 0), 48, 41], // base da aresta direita
    [corner(1, 0, 1), 24, 53], // base do vinco — o mais baixo
    [corner(0, 0, 1), 0, 41], // base da aresta esquerda
    [corner(0, 0, 0), 24, 29], // canto de trás embaixo — invisível
  ];
  for (const [c, x, y] of esperado) {
    const px = cornerSpritePixel(c, G);
    assert.deepEqual(
      { x: px.x, y: px.y },
      { x, y },
      `canto (${c.cx},${c.cy},${c.cz})`,
    );
  }
});

test('todo canto visível cai dentro da silhueta do cubo', () => {
  // O canto (0,0,0) é o único invisível — está no meio da sprite, atrás.
  const visiveis: readonly CubeCorner[] = [
    corner(0, 1, 0), corner(1, 1, 0), corner(1, 1, 1), corner(0, 1, 1),
    corner(1, 0, 0), corner(1, 0, 1), corner(0, 0, 1),
  ];
  for (const c of visiveis) {
    const px = cornerSpritePixel(c, G);
    // Os vértices ficam na BORDA da silhueta; um pixel para dentro tem de estar
    // coberto. Sem o recuo, o vértice (48,·) cairia na coluna 48, que não existe.
    const x = Math.min(Math.max(px.x, 0), G.spriteWidth - 1);
    const y = Math.min(Math.max(px.y, 0), G.spriteHeight - 1);
    const dentroX = x < G.tileWidth / 2 ? x + 1 : x - 1;
    assert.notEqual(
      faceAtPixel(dentroX, Math.min(y, G.spriteHeight - 2), G),
      null,
      `canto (${c.cx},${c.cy},${c.cz}) caiu fora da silhueta`,
    );
  }
});

// ------------------------------------------------------------------ as três faces

test('a face do topo cobre o losango inteiro, e só ele', () => {
  // Os quatro cantos com cy = 1 são exatamente os quatro vértices do losango.
  const topo = [corner(0, 1, 0), corner(1, 1, 0), corner(1, 1, 1), corner(0, 1, 1)]
    .map((c) => cornerSpritePixel(c, G));
  const ys = topo.map((p) => p.y);
  assert.equal(Math.min(...ys), 0, 'o losango começa na linha 0');
  assert.equal(Math.max(...ys), G.tileHeight, 'e termina na linha tileHeight');
  const xs = topo.map((p) => p.x);
  assert.equal(Math.min(...xs), 0);
  assert.equal(Math.max(...xs), G.spriteWidth);
});

test('a face +X pega a metade direita e a +Z a esquerda', () => {
  // +X: cx = 1 nos quatro cantos. +Z: cz = 1.
  const faceX = [corner(1, 1, 0), corner(1, 1, 1), corner(1, 0, 0), corner(1, 0, 1)]
    .map((c) => cornerSpritePixel(c, G).x);
  const faceZ = [corner(0, 1, 1), corner(1, 1, 1), corner(0, 0, 1), corner(1, 0, 1)]
    .map((c) => cornerSpritePixel(c, G).x);
  assert.equal(Math.min(...faceX), G.anchorX, '+X começa no vinco');
  assert.equal(Math.max(...faceX), G.spriteWidth, 'e vai até a borda direita');
  assert.equal(Math.min(...faceZ), 0, '+Z começa na borda esquerda');
  assert.equal(Math.max(...faceZ), G.anchorX, 'e vai até o vinco');
});

test('as laterais são paralelogramos de aresta vertical, não retângulos', () => {
  // A prova de que o mapeamento antigo (retângulos alinhados aos eixos) estava
  // errado: os dois cantos de cima da face +X estão em linhas DIFERENTES.
  const cimaFrente = cornerSpritePixel(corner(1, 1, 1), G).y;
  const cimaFundo = cornerSpritePixel(corner(1, 1, 0), G).y;
  assert.notEqual(cimaFrente, cimaFundo);
  assert.equal(cimaFrente - cimaFundo, G.tileHeight / 2);
  // E a aresta vertical mede exatamente cubeHeight em qualquer coluna.
  const baixoFrente = cornerSpritePixel(corner(1, 0, 1), G).y;
  assert.equal(baixoFrente - cimaFrente, G.cubeHeight);
});

// ------------------------------------------------------------------ UV normalizado

test('o UV inverte v — flipY do three.js põe a linha 0 em v = 1', () => {
  const topoFundo = cornerSpriteUv(corner(0, 1, 0), G);
  assert.equal(topoFundo.v, 1, 'a linha 0 da imagem é v = 1');
  assert.equal(topoFundo.u, 0.5);
  const baseVinco = cornerSpriteUv(corner(1, 0, 1), G);
  assert.equal(baseVinco.v, 0, 'a última linha é v = 0');
});

test('todo UV fica dentro de [0,1] — nada sampleia fora da textura', () => {
  for (const cx of [0, 1] as const) {
    for (const cy of [0, 1] as const) {
      for (const cz of [0, 1] as const) {
        const { u, v } = cornerSpriteUv(corner(cx, cy, cz), G);
        assert.ok(u >= 0 && u <= 1, `u fora de faixa em (${cx},${cy},${cz}): ${u}`);
        assert.ok(v >= 0 && v <= 1, `v fora de faixa em (${cx},${cy},${cz}): ${v}`);
      }
    }
  }
});

test('a posição local do BoxGeometry vira o canto certo', () => {
  assert.deepEqual(cornerOfLocalPosition(-0.5, 0.5, -0.5), corner(0, 1, 0));
  assert.deepEqual(cornerOfLocalPosition(0.5, -0.5, 0.5), corner(1, 0, 1));
  assert.deepEqual(cornerOfLocalPosition(0, 0, 0), corner(1, 1, 1));
});

// ------------------------------------------------------------------ geometria da imagem

test('a geometria sai da imagem, e o 48×53 volta a ser o canônico', () => {
  const g = spriteGeometryFromImage(48, 53);
  assert.notEqual(g, null);
  assert.deepEqual(
    { w: g!.tileWidth, h: g!.tileHeight, d: g!.cubeHeight },
    { w: 48, h: 24, d: 29 },
  );
  assert.equal(g!.anchorX, CANONICAL_CUBE.anchorX);
});

test('imagem sem lateral não é cubo — devolve null em vez de espelhar arte', () => {
  assert.equal(spriteGeometryFromImage(48, 24), null, 'só o losango');
  assert.equal(spriteGeometryFromImage(48, 12), null, 'mais baixa que o losango');
  assert.notEqual(spriteGeometryFromImage(48, 48), null, '48×48 ainda tem 24 de aresta');
  assert.equal(spriteGeometryFromImage(0, 10), null);
  assert.equal(spriteGeometryFromImage(48, Number.NaN), null);
});

test('o desvio de proporção é declarado, não recusado', () => {
  assert.ok(spriteStretchError(CANONICAL_CUBE) < 0.02, 'o canônico é quase exato');
  const achatado = spriteGeometryFromImage(48, 24 + 15)!;
  assert.ok(spriteStretchError(achatado) > 0.4, 'metade da aresta = metade do cubo');
});

// ------------------------------------------------------------------ casamento de silhueta

/** Alfa de uma silhueta perfeita do cubo canônico. */
function alfaCanonico(): Uint8Array {
  const a = new Uint8Array(G.spriteWidth * G.spriteHeight);
  for (let y = 0; y < G.spriteHeight; y += 1) {
    for (let x = 0; x < G.spriteWidth; x += 1) {
      if (faceAtPixel(x, y, G) !== null) a[y * G.spriteWidth + x] = 255;
    }
  }
  return a;
}

test('a silhueta exata tem score 1', () => {
  const m = silhouetteMatch(alfaCanonico(), G.spriteWidth, G.spriteHeight, G);
  assert.equal(m.score, 1);
  assert.equal(m.outside, 0);
  assert.equal(m.holes, 0);
});

test('imagem cheia perde pontos pelos cantos que vazam', () => {
  const cheia = new Uint8Array(G.spriteWidth * G.spriteHeight).fill(255);
  const m = silhouetteMatch(cheia, G.spriteWidth, G.spriteHeight, G);
  assert.ok(m.outside > 0, 'os cantos transparentes do losango contam como vazamento');
  assert.ok(m.score < 1);
});

test('imagem vazia tem score negativo — tudo é buraco', () => {
  const vazia = new Uint8Array(G.spriteWidth * G.spriteHeight);
  const m = silhouetteMatch(vazia, G.spriteWidth, G.spriteHeight, G);
  assert.equal(m.inside, 0);
  assert.equal(m.score, -1);
});

test('tamanho diferente da geometria é recusado, não acomodado', () => {
  const a = new Uint8Array(10 * 10);
  assert.throws(() => silhouetteMatch(a, 10, 10, G), /não tem o tamanho/);
});
