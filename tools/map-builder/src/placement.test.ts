/**
 * Teste do posicionamento do sprite.
 *
 * Este arquivo existe por causa de um bug específico: a cena escalava a textura
 * 1,333× na horizontal e 1,0× na vertical, o losango da arte deixava de ser 2:1
 * e os blocos paravam de encaixar no grid. Os testes abaixo travam as duas
 * propriedades que impedem esse bug de voltar — **escala uniforme** e **âncora
 * declarada** — e uma terceira, que é a consequência: **losangos vizinhos
 * compartilham aresta, exatamente**.
 *
 * Execute com: node --test src/placement.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_CUBE } from '@isometric-maker/iso-core/iso-cube';
import { ROTATIONS, type Rotation } from '@isometric-maker/iso-core/rotation';
import { DEFAULT_GEOMETRY, cellToScreen, type Camera } from './camera.ts';
import { spriteBox } from './placement.ts';

const G = CANONICAL_CUBE;
const GEOM = DEFAULT_GEOMETRY;

function cam(rotation: Rotation, zoom = 1, panX = 0, panY = 0): Camera {
  return { rotation, turn: rotation, zoom, panX, panY };
}

function box(
  cell: { x: number; y: number; z: number },
  camera: Camera,
  textureWidth = G.spriteWidth,
) {
  const p = cellToScreen(cell, camera, GEOM);
  return spriteBox({
    screenX: p.x,
    screenY: p.y,
    textureWidth,
    tileWidth: GEOM.tileWidth,
    zoom: camera.zoom,
    anchorX: G.anchorX,
    anchorY: G.anchorY,
  });
}

// ------------------------------------------------------------------ escala

test('a escala é UM número — nunca diferente em x e em y', () => {
  const b = spriteBox({
    screenX: 0,
    screenY: 0,
    textureWidth: 48,
    tileWidth: 48,
    zoom: 3,
    anchorX: 24,
    anchorY: 0,
  });
  assert.equal(b.scale, 3);
  // A assinatura não OFERECE escala por eixo. Se um dia oferecer, este teste
  // deixa de compilar — que é o ponto.
  assert.equal(typeof b.scale, 'number');
});

test('arte canônica desenha 1:1 vezes o zoom', () => {
  for (const zoom of [1, 2, 3, 4]) {
    const b = box({ x: 0, y: 0, z: 0 }, cam(0, zoom));
    assert.equal(b.scale, zoom, `zoom ${zoom}`);
  }
});

test('arte fora do tamanho canônico escala uniformemente para a largura do tile', () => {
  // Uma arte de 96 px de largura num tile de 48: fator 0,5, nos DOIS eixos.
  const b = box({ x: 0, y: 0, z: 0 }, cam(0, 2), 96);
  assert.equal(b.scale, 1, '0,5 de ajuste × 2 de zoom');
});

test('textura ainda não carregada não explode a conta', () => {
  const b = spriteBox({
    screenX: 10,
    screenY: 20,
    textureWidth: 0,
    tileWidth: 48,
    zoom: 2,
    anchorX: 24,
    anchorY: 0,
  });
  assert.equal(b.scale, 2);
  assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
});

// ------------------------------------------------------------------ âncora

test('a âncora pousa exatamente sobre o ponto da projeção', () => {
  for (const zoom of [1, 2, 4]) {
    const camera = cam(0, zoom, 137, -49);
    const p = cellToScreen({ x: 2, y: -3, z: 1 }, camera, GEOM);
    const b = box({ x: 2, y: -3, z: 1 }, camera);
    assert.equal(b.x + G.anchorX * b.scale, p.x, `x com zoom ${zoom}`);
    assert.equal(b.y + G.anchorY * b.scale, p.y, `y com zoom ${zoom}`);
  }
});

test('o sprite NÃO começa no ponto da projeção — meia largura à esquerda', () => {
  const camera = cam(0, 2);
  const p = cellToScreen({ x: 0, y: 0, z: 0 }, camera, GEOM);
  const b = box({ x: 0, y: 0, z: 0 }, camera);
  assert.equal(b.x, p.x - (GEOM.tileWidth / 2) * 2);
  assert.equal(b.y, p.y, 'o topo do losango é a primeira linha do sprite');
});

// ------------------------------------------------------------------ costura

/** Os quatro vértices do losango do topo, na tela. */
function diamante(b: { x: number; y: number; scale: number }) {
  const w = G.tileWidth * b.scale;
  const h = G.tileHeight * b.scale;
  return {
    topo: { x: b.x + w / 2, y: b.y },
    direita: { x: b.x + w, y: b.y + h / 2 },
    baixo: { x: b.x + w / 2, y: b.y + h },
    esquerda: { x: b.x, y: b.y + h / 2 },
  };
}

test('losangos vizinhos compartilham vértice — a costura fecha nas 4 vistas', () => {
  for (const r of ROTATIONS) {
    for (const zoom of [1, 2, 3]) {
      const camera = cam(r, zoom, 400, 300);
      const a = diamante(box({ x: 0, y: 0, z: 0 }, camera));
      const emX = diamante(box({ x: 1, y: 0, z: 0 }, camera));
      const emY = diamante(box({ x: 0, y: 1, z: 0 }, camera));

      // A célula (1,0) encosta em (0,0) por uma aresta; qual delas depende da
      // vista, mas ALGUM par de vértices tem que coincidir exatamente.
      const vertsA = Object.values(a);
      const encosta = (outro: ReturnType<typeof diamante>): boolean =>
        Object.values(outro).some((v) =>
          vertsA.some((w) => Math.abs(v.x - w.x) < 1e-9 && Math.abs(v.y - w.y) < 1e-9),
        );

      assert.ok(encosta(emX), `vista ${r}, zoom ${zoom}: (1,0) não encostou em (0,0)`);
      assert.ok(encosta(emY), `vista ${r}, zoom ${zoom}: (0,1) não encostou em (0,0)`);
    }
  }
});

test('empilhar sobe exatamente a aresta do cubo — sem vão e sem sobreposição', () => {
  const camera = cam(0, 2);
  const base = box({ x: 0, y: 0, z: 0 }, camera);
  const acima = box({ x: 0, y: 0, z: 1 }, camera);
  assert.equal(base.y - acima.y, G.cubeHeight * 2, 'o passo é a aresta vertical × zoom');
  assert.equal(base.x, acima.x, 'empilhar não desloca na horizontal');

  // A base do sprite de cima cai exatamente no topo do losango do de baixo.
  const alturaSprite = G.spriteHeight * 2;
  assert.equal(acima.y + alturaSprite, base.y + G.tileHeight * 2, 'as faces se encontram');
});

test('subir um nível NÃO é o mesmo que recuar uma diagonal', () => {
  // A armadilha do sprite quadrado: com aresta vertical igual à altura do
  // losango, (x,y,z+1) cairia no MESMO pixel que (x−1,y−1,z), e "em cima"
  // ficaria indistinguível de "atrás". A aresta canônica desfaz o empate.
  const camera = cam(0, 1);
  const acima = box({ x: 0, y: 0, z: 1 }, camera);
  const atras = box({ x: -1, y: -1, z: 0 }, camera);
  assert.notEqual(acima.y, atras.y, 'a ambiguidade voltou — confira cubeHeight');
  assert.equal(acima.y - atras.y, GEOM.tileHeight - G.cubeHeight);
});
