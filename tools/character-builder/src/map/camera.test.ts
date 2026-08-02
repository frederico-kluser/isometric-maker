/**
 * Teste da câmera e do picking com rotação.
 *
 * A propriedade que decide se a rotação está certa não é o desenho — é o
 * CURSOR. Se `screenToCell(cellToScreen(c)) !== c` em qualquer vista, o clique
 * acerta a célula errada, e isso só aparece depois de girar. Todo teste aqui
 * varre as quatro vistas de propósito.
 *
 * Execute com: node --test src/camera.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROTATIONS, type Rotation } from '../../../../packages/iso-core/src/rotation.ts';
import type { MapData } from '../../../../packages/iso-core/src/map.ts';
import {
  DEFAULT_GEOMETRY,
  cellToScreen,
  centerOn,
  depthAt,
  framedCamera,
  screenToCell,
  viewToWorldPx,
  type Camera,
} from './camera.ts';
import { blockAt, columnHeight, maxOccupiedZ, pick3d, pickColumnTop } from './pick3d.ts';

const GEOM = DEFAULT_GEOMETRY;

function cam(rotation: Rotation, zoom = 1, panX = 0, panY = 0): Camera {
  // Parada: a rotação contínua coincide com a discreta.
  return { rotation, turn: rotation, zoom, panX, panY };
}

/** Centro do losango da célula, em pixels de tela — é onde um clique "óbvio" cai. */
function centerOfCell(
  c: { x: number; y: number; z: number },
  camera: Camera,
): { x: number; y: number } {
  const p = cellToScreen(c, camera, GEOM);
  return { x: p.x, y: p.y + (GEOM.tileHeight / 2) * camera.zoom };
}

const CELLS: ReadonlyArray<{ x: number; y: number; z: number }> = (() => {
  const out: Array<{ x: number; y: number; z: number }> = [];
  for (let x = -2; x <= 3; x += 1) {
    for (let y = -2; y <= 3; y += 1) {
      for (const z of [0, 2]) out.push({ x, y, z });
    }
  }
  return out;
})();

// ------------------------------------------------------------------ ida e volta

test('tela → célula é a inversa de célula → tela nas QUATRO vistas', () => {
  for (const r of ROTATIONS) {
    const camera = cam(r, 2, 400, 300);
    for (const c of CELLS) {
      const p = centerOfCell(c, camera);
      const back = screenToCell(p.x, p.y, c.z, camera, GEOM);
      assert.deepEqual(
        back,
        { x: c.x, y: c.y },
        `vista ${r}: clique no centro de (${c.x},${c.y},${c.z}) caiu em (${back.x},${back.y})`,
      );
    }
  }
});

test('zoom e pan não deslocam a célula sob o cursor', () => {
  const c = { x: 2, y: -1, z: 1 };
  for (const r of ROTATIONS) {
    for (const zoom of [1, 2, 3, 4]) {
      for (const [px, py] of [
        [0, 0],
        [137, -49],
        [-800, 620],
      ] as const) {
        const camera = cam(r, zoom, px, py);
        const p = centerOfCell(c, camera);
        assert.deepEqual(
          screenToCell(p.x, p.y, c.z, camera, GEOM),
          { x: c.x, y: c.y },
          `vista ${r}, zoom ${zoom}, pan (${px},${py})`,
        );
      }
    }
  }
});

test('a projeção continua sendo UMA fórmula: a vista 0 é a de sempre', () => {
  // Se isto quebrar, a rotação passou a ter variante de projeção por vista —
  // exatamente o que o desenho deste módulo evita.
  for (const c of CELLS) {
    const p = cellToScreen(c, cam(0), GEOM);
    const direct = viewToWorldPx(c.x, c.y, c.z, GEOM);
    assert.deepEqual(p, { x: direct.x, y: direct.y });
  }
});

// ------------------------------------------------------------------ profundidade

test('em qualquer vista, chave maior é o que a tela mostra mais à frente', () => {
  for (const r of ROTATIONS) {
    const camera = cam(r);
    for (const a of CELLS) {
      for (const b of CELLS) {
        if (a.z !== b.z) continue;
        const ka = depthAt(a, camera);
        const kb = depthAt(b, camera);
        if (ka === kb) continue;
        const sa = cellToScreen(a, camera, GEOM).y;
        const sb = cellToScreen(b, camera, GEOM).y;
        assert.equal(ka > kb, sa > sb, `vista ${r} discordou entre ${JSON.stringify(a)} e ${JSON.stringify(b)}`);
      }
    }
  }
});

// ------------------------------------------------------------------ enquadramento

test('centerOn põe o conteúdo no centro do viewport em todas as vistas', () => {
  const cells = [
    { x: 0, y: 0, z: 0 },
    { x: 5, y: 5, z: 0 },
    { x: 5, y: 0, z: 3 },
  ];
  for (const r of ROTATIONS) {
    const camera = framedCamera(cells, r, 800, 600, 2, GEOM);
    const xs = cells.map((c) => cellToScreen(c, camera, GEOM).x);
    const ys = cells.map((c) => cellToScreen(c, camera, GEOM).y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    assert.ok(Math.abs(cx - 400) < 1, `vista ${r}: centro x em ${cx}, esperado ~400`);
    // O centro vertical carrega meia altura de losango — ver centerOn.
    assert.ok(Math.abs(cy - (300 - GEOM.tileHeight)) < 1, `vista ${r}: centro y em ${cy}`);
    assert.equal(camera.rotation, r);
  }
});

test('centerOn com mapa vazio ainda devolve uma câmera utilizável', () => {
  assert.deepEqual(centerOn([], 1, 800, 600, 2, GEOM), { panX: 400, panY: 300 });
  assert.deepEqual(framedCamera([], 1, 800, 600, 2, GEOM), {
    rotation: 1,
    turn: 1,
    panX: 400,
    panY: 300,
    zoom: 2,
  });
});

// ------------------------------------------------------------------ picking

const MAP: MapData = {
  blocks: {
    '0:0': [{ block: 'grass', count: 1 }],
    '1:0': [{ block: 'stone', count: 3 }],
    '2:2': [
      { block: 'dirt', count: 2 },
      { block: '', count: 1 },
      { block: 'grass', count: 1 },
    ],
  },
  edges: [],
};

test('blockAt lê o RLE, inclusive o vão de ar no meio da coluna', () => {
  assert.equal(blockAt(MAP, 0, 0, 0), 'grass');
  assert.equal(blockAt(MAP, 0, 0, 1), undefined);
  assert.equal(blockAt(MAP, 1, 0, 2), 'stone');
  assert.equal(blockAt(MAP, 2, 2, 1), 'dirt');
  assert.equal(blockAt(MAP, 2, 2, 2), undefined, 'o run de ar tem que continuar sendo ar');
  assert.equal(blockAt(MAP, 2, 2, 3), 'grass');
  assert.equal(blockAt(MAP, 9, 9, 0), undefined);
});

test('columnHeight e maxOccupiedZ ignoram o ar do topo', () => {
  assert.equal(columnHeight(MAP, 0, 0), 1);
  assert.equal(columnHeight(MAP, 1, 0), 3);
  assert.equal(columnHeight(MAP, 2, 2), 4);
  assert.equal(columnHeight(MAP, 9, 9), 0);
  assert.equal(maxOccupiedZ(MAP), 3);
});

test('pick3d acerta o bloco sob o cursor nas QUATRO vistas', () => {
  for (const r of ROTATIONS) {
    const camera = cam(r, 2, 500, 400);
    const p = centerOfCell({ x: 1, y: 0, z: 2 }, camera);
    const got = pick3d(p.x, p.y, MAP, camera, GEOM);
    assert.deepEqual(
      got.hit,
      { x: 1, y: 0, z: 2, block: 'stone' },
      `vista ${r} errou o topo da torre`,
    );
    assert.deepEqual(
      got.placement,
      { x: 1, y: 0, z: 3 },
      'a peça nova assenta em cima do que foi atingido',
    );
  }
});

test('cursor no vazio → sem acerto, e o alvo cai no piso z=0', () => {
  for (const r of ROTATIONS) {
    const camera = cam(r, 2, 500, 400);
    const p = centerOfCell({ x: 7, y: 7, z: 0 }, camera);
    const got = pick3d(p.x, p.y, MAP, camera, GEOM);
    assert.equal(got.hit, null, `vista ${r} inventou um acerto no vazio`);
    assert.deepEqual(
      got.placement,
      { x: 7, y: 7, z: 0 },
      'um mapa vazio ainda tem que aceitar a primeira peça',
    );
  }
});

test('pickColumnTop assenta no TOPO da coluna, não encostado no meio dela', () => {
  for (const r of ROTATIONS) {
    const camera = cam(r, 2, 500, 400);
    // Mira o bloco do MEIO da torre.
    const p = centerOfCell({ x: 1, y: 0, z: 1 }, camera);
    const meio = pick3d(p.x, p.y, MAP, camera, GEOM);
    const topo = pickColumnTop(p.x, p.y, MAP, camera, GEOM);
    assert.deepEqual(meio.hit, topo.hit, 'as duas leem o mesmo acerto');
    assert.deepEqual(topo.placement, { x: 1, y: 0, z: 3 }, `vista ${r}: topo da coluna`);
    assert.notDeepEqual(topo.placement, meio.placement, 'as duas ferramentas são mesmo diferentes');
  }
});

test('pickColumnTop no vazio se comporta como pick3d', () => {
  const camera = cam(0, 2, 500, 400);
  const p = centerOfCell({ x: 7, y: 7, z: 0 }, camera);
  assert.deepEqual(
    pickColumnTop(p.x, p.y, MAP, camera, GEOM),
    pick3d(p.x, p.y, MAP, camera, GEOM),
  );
});

test('mapa totalmente vazio ainda responde com alvo de piso', () => {
  const empty: MapData = { blocks: {}, edges: [] };
  const camera = cam(3, 2, 300, 200);
  const got = pick3d(300, 200 + GEOM.tileHeight, empty, camera, GEOM);
  assert.equal(got.hit, null);
  assert.equal(got.placement.z, 0);
});
