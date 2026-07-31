import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProjectGeometry } from './project.ts';
import {
  screenToCell,
  screenToWorld,
  worldToScreen,
} from './geometry.ts';

// ---------------------------------------------------------------------------
// Geometrias de teste
// ---------------------------------------------------------------------------

/** Geometria padrão da ADR 0013. */
const GEOM_PADRAO: ProjectGeometry = {
  tileWidth: 64,
  tileHeight: 32,
  zStep: 16,
} as const;

/** Geometria onde zStep == tileHeight (diagonal desloca (1,1)). */
const GEOM_ZSTEP_EQ_TILEHEIGHT: ProjectGeometry = {
  tileWidth: 128,
  tileHeight: 64,
  zStep: 64,
} as const;

/** Geometria grande para testar a generalidade. */
const GEOM_GRANDE: ProjectGeometry = {
  tileWidth: 256,
  tileHeight: 128,
  zStep: 32,
} as const;

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

/** Tolerância para comparações de vírgula flutuante. */
const EPS = 1e-9;

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < EPS;
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('worldToScreen', () => {
  it('origem (0,0,0) mapeia para (0,0)', () => {
    const s = worldToScreen(0, 0, 0, GEOM_PADRAO);
    assert.strictEqual(s.sx, 0);
    assert.strictEqual(s.sy, 0);
  });

  it('+1 em x desloca (+halfW, +halfH) no ecrã', () => {
    const a = worldToScreen(0, 0, 0, GEOM_PADRAO);
    const b = worldToScreen(1, 0, 0, GEOM_PADRAO);
    assert.strictEqual(b.sx, a.sx + 32);
    assert.strictEqual(b.sy, a.sy + 16);
  });

  it('+1 em y desloca (-halfW, +halfH) no ecrã', () => {
    const a = worldToScreen(0, 0, 0, GEOM_PADRAO);
    const b = worldToScreen(0, 1, 0, GEOM_PADRAO);
    assert.strictEqual(b.sx, a.sx - 32);
    assert.strictEqual(b.sy, a.sy + 16);
  });

  it('+1 em z desloca (0, -zStep) no ecrã', () => {
    const a = worldToScreen(0, 0, 0, GEOM_PADRAO);
    const b = worldToScreen(0, 0, 1, GEOM_PADRAO);
    assert.strictEqual(b.sx, a.sx);
    assert.strictEqual(b.sy, a.sy - 16);
  });

  it('funciona com valores negativos', () => {
    const s = worldToScreen(-3, 5, 2, GEOM_PADRAO);
    // sx = (-3 - 5) * 32 = -256, sy = (-3 + 5) * 16 - 2*16 = 32 - 32 = 0
    assert.strictEqual(s.sx, -256);
    assert.strictEqual(s.sy, 0);
  });

  it('é linear nas três coordenadas', () => {
    const a = worldToScreen(2, 3, 1, GEOM_PADRAO);
    const b = worldToScreen(5, 7, 4, GEOM_PADRAO);
    const s = worldToScreen(7, 10, 5, GEOM_PADRAO);
    assert.ok(approxEqual(s.sx, a.sx + b.sx));
    assert.ok(approxEqual(s.sy, a.sy + b.sy));
  });

  it('funciona com qualquer geometria válida', () => {
    const geom: ProjectGeometry = { tileWidth: 200, tileHeight: 100, zStep: 25 };
    const s = worldToScreen(3, 1, 2, geom);
    // sx = (3-1)*100 = 200, sy = (3+1)*50 - 2*25 = 200 - 50 = 150
    assert.strictEqual(s.sx, 200);
    assert.strictEqual(s.sy, 150);
  });
});

describe('screenToWorld', () => {
  it('origem do ecrã (0,0) com z=0 mapeia para (0,0)', () => {
    const w = screenToWorld(0, 0, 0, GEOM_PADRAO);
    assert.ok(approxEqual(w.x, 0));
    assert.ok(approxEqual(w.y, 0));
  });

  it('desloca em x: ponto (halfW, halfH) é (1,0)', () => {
    const w = screenToWorld(32, 16, 0, GEOM_PADRAO);
    assert.ok(approxEqual(w.x, 1));
    assert.ok(approxEqual(w.y, 0));
  });

  it('desloca em y: ponto (-halfW, halfH) é (0,1)', () => {
    const w = screenToWorld(-32, 16, 0, GEOM_PADRAO);
    assert.ok(approxEqual(w.x, 0));
    assert.ok(approxEqual(w.y, 1));
  });

  it('centro do diamante (0, halfH) é (0.5, 0.5)', () => {
    const w = screenToWorld(0, 16, 0, GEOM_PADRAO);
    assert.ok(approxEqual(w.x, 0.5));
    assert.ok(approxEqual(w.y, 0.5));
  });

  it('z empurra o mundo para baixo (sy maior → maior x,y)', () => {
    const w0 = screenToWorld(0, 0, 0, GEOM_PADRAO);
    const w1 = screenToWorld(0, 16, 0, GEOM_PADRAO);
    // Com z=1, sy=0 mapeia como se sy=16 com z=0
    const w2 = screenToWorld(0, 0, 1, GEOM_PADRAO);
    assert.ok(approxEqual(w2.x, w1.x));
    assert.ok(approxEqual(w2.y, w1.y));
  });

  it('funciona com geometria grande', () => {
    const w = screenToWorld(256, 64, 1, GEOM_GRANDE);
    // halfW = 128, halfH = 64, zStep = 32
    // a = 256/128 = 2, b = (64+32)/64 = 1.5
    // x = (1.5+2)/2 = 1.75, y = (1.5-2)/2 = -0.25
    assert.ok(approxEqual(w.x, 1.75));
    assert.ok(approxEqual(w.y, -0.25));
  });
});

describe('round-trip (ida e volta)', () => {
  /** Células de teste e níveis de Z. */
  const CASOS: ReadonlyArray<{ x: number; y: number; z: number }> = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 5, y: 3, z: 0 },
    { x: -2, y: 7, z: 0 },
    { x: 10, y: -4, z: 0 },
    { x: 1, y: 1, z: 3 },
    { x: -5, y: -5, z: 2 },
    { x: 0, y: 0, z: 10 },
    { x: 100, y: 200, z: 5 },
  ];

  for (const { x, y, z } of CASOS) {
    it(`(x=${x}, y=${y}, z=${z}) → ecrã → mundo devolve o original`, () => {
      const s = worldToScreen(x, y, z, GEOM_PADRAO);
      const w = screenToWorld(s.sx, s.sy, z, GEOM_PADRAO);
      assert.ok(
        approxEqual(w.x, x),
        `x: esperado ${x}, obtido ${w.x}`,
      );
      assert.ok(
        approxEqual(w.y, y),
        `y: esperado ${y}, obtido ${w.y}`,
      );
    });

    it(`(x=${x}, y=${y}, z=${z}) → ecrã → célula = (x,y)`, () => {
      const s = worldToScreen(x, y, z, GEOM_PADRAO);
      const c = screenToCell(s.sx, s.sy, z, GEOM_PADRAO);
      assert.strictEqual(c.x, x);
      assert.strictEqual(c.y, y);
    });
  }

  it('round-trip com geometria não-padrão', () => {
    const geom: ProjectGeometry = { tileWidth: 200, tileHeight: 100, zStep: 25 };
    const s = worldToScreen(7, 3, 4, geom);
    const w = screenToWorld(s.sx, s.sy, 4, geom);
    assert.ok(approxEqual(w.x, 7));
    assert.ok(approxEqual(w.y, 3));
  });

  it('round-trip com geometria onde zStep == tileHeight', () => {
    const s = worldToScreen(3, 5, 2, GEOM_ZSTEP_EQ_TILEHEIGHT);
    const w = screenToWorld(s.sx, s.sy, 2, GEOM_ZSTEP_EQ_TILEHEIGHT);
    assert.ok(approxEqual(w.x, 3));
    assert.ok(approxEqual(w.y, 5));
  });
});

describe('propriedade da diagonal', () => {
  /**
   * A propriedade geral: screenToWorld(sx, sy, z+1, geom)
   *   ≡ screenToWorld(sx, sy, z, geom) + (zStep/tileHeight, zStep/tileHeight)
   *
   * No caso particular zStep == tileHeight, o deslocamento é (1, 1).
   */

  const PONTOS_ECRA: ReadonlyArray<{ sx: number; sy: number }> = [
    { sx: 0, sy: 0 },
    { sx: 32, sy: 16 },
    { sx: -64, sy: 48 },
    { sx: 128, sy: -32 },
    { sx: 100, sy: 200 },
    { sx: -7, sy: -13 },
  ];

  for (const { sx, sy } of PONTOS_ECRA) {
    it(`diagonal geral: z→z+1 desloca (zStep/tileH, zStep/tileH) — ponto (${sx},${sy})`, () => {
      const w0 = screenToWorld(sx, sy, 0, GEOM_PADRAO);
      const w1 = screenToWorld(sx, sy, 1, GEOM_PADRAO);
      const deltaEsperado = GEOM_PADRAO.zStep / GEOM_PADRAO.tileHeight; // 0.5
      assert.ok(approxEqual(w1.x, w0.x + deltaEsperado));
      assert.ok(approxEqual(w1.y, w0.y + deltaEsperado));
    });
  }

  it('diagonal (1,1) quando zStep == tileHeight', () => {
    const w0 = screenToWorld(50, 30, 0, GEOM_ZSTEP_EQ_TILEHEIGHT);
    const w1 = screenToWorld(50, 30, 1, GEOM_ZSTEP_EQ_TILEHEIGHT);
    // zStep/tileHeight = 64/64 = 1
    assert.ok(approxEqual(w1.x, w0.x + 1));
    assert.ok(approxEqual(w1.y, w0.y + 1));
  });

  it('diagonal preservada com geometria grande (zStep != tileHeight)', () => {
    const w0 = screenToWorld(100, 200, 3, GEOM_GRANDE);
    const w1 = screenToWorld(100, 200, 4, GEOM_GRANDE);
    const delta = GEOM_GRANDE.zStep / GEOM_GRANDE.tileHeight; // 32/128 = 0.25
    assert.ok(approxEqual(w1.x, w0.x + delta));
    assert.ok(approxEqual(w1.y, w0.y + delta));
  });

  it('dois níveis de z com geometria padrão avançam uma célula inteira', () => {
    // zStep/tileHeight = 0.5, logo z→z+2 desloca (1, 1)
    const w0 = screenToWorld(17, 42, 0, GEOM_PADRAO);
    const w2 = screenToWorld(17, 42, 2, GEOM_PADRAO);
    assert.ok(approxEqual(w2.x, w0.x + 1));
    assert.ok(approxEqual(w2.y, w0.y + 1));
  });
});

describe('screenToCell — regra de arredondamento', () => {
  it('centro do diamante (0,0) pertence à célula (0,0)', () => {
    const c = screenToCell(0, 16, 0, GEOM_PADRAO);
    // screenToWorld(0,16,0) = (0.5, 0.5), floor → (0,0)
    assert.strictEqual(c.x, 0);
    assert.strictEqual(c.y, 0);
  });

  it('canto direito de (0,0) pertence a (1,0)', () => {
    // worldToScreen(1,0,0) = (32, 16) — canto direito de (0,0), topo de (1,0)
    const c = screenToCell(32, 16, 0, GEOM_PADRAO);
    assert.strictEqual(c.x, 1);
    assert.strictEqual(c.y, 0);
  });

  it('canto inferior de (0,0) pertence a (1,1)', () => {
    // worldToScreen(1,1,0) = (0, 32)
    const c = screenToCell(0, 32, 0, GEOM_PADRAO);
    assert.strictEqual(c.x, 1);
    assert.strictEqual(c.y, 1);
  });

  it('canto esquerdo de (0,0) pertence a (0,1)', () => {
    // worldToScreen(0,1,0) = (-32, 16)
    const c = screenToCell(-32, 16, 0, GEOM_PADRAO);
    assert.strictEqual(c.x, 0);
    assert.strictEqual(c.y, 1);
  });

  it('ponto ligeiramente dentro do diamante (0,0) pertence a (0,0)', () => {
    // worldToScreen(0.4, 0.4, 0) = (0, 12.8)
    const c = screenToCell(0, 12, 0, GEOM_PADRAO);
    assert.strictEqual(c.x, 0);
    assert.strictEqual(c.y, 0);
  });
});

describe('bordas consistentes', () => {
  /**
   * Cada ponto do ecrã pertence a exactamente uma célula.
   * Verificamos percorrendo a aresta partilhada entre duas células:
   * todos os pontos (excepto o extremo exacto) pertencem à mesma célula.
   */

  it('aresta direita de (0,0): pontos interiores pertencem a (0,0)', () => {
    // Aresta de (0,0) para (32,16): worldToScreen(t, 0, 0) com t ∈ [0,1)
    for (let i = 0; i <= 9; i++) {
      const t = i / 10; // 0.0, 0.1, ..., 0.9
      const s = worldToScreen(t, 0, 0, GEOM_PADRAO);
      const c = screenToCell(s.sx, s.sy, 0, GEOM_PADRAO);
      assert.strictEqual(c.x, 0, `t=${t}: esperado x=0, obtido x=${c.x}`);
      assert.strictEqual(c.y, 0, `t=${t}: esperado y=0, obtido y=${c.y}`);
    }
  });

  it('aresta esquerda de (0,0): pontos interiores pertencem a (0,0)', () => {
    // Aresta de (0,0) para (-32,16): worldToScreen(0, t, 0) com t ∈ [0,1)
    for (let i = 0; i <= 9; i++) {
      const t = i / 10; // 0.0, 0.1, ..., 0.9
      const s = worldToScreen(0, t, 0, GEOM_PADRAO);
      const c = screenToCell(s.sx, s.sy, 0, GEOM_PADRAO);
      assert.strictEqual(c.x, 0, `t=${t}: esperado x=0, obtido x=${c.x}`);
      assert.strictEqual(c.y, 0, `t=${t}: esperado y=0, obtido y=${c.y}`);
    }
  });

  it('aresta inferior de (1,0): pontos interiores pertencem a (1,0)', () => {
    // (1,0) aresta inferior: worldToScreen(1, t, 0) com t ∈ [0,1)
    // Usamos décimos exactos para evitar o canto partilhado em t ≈ 1.0.
    for (let i = 0; i <= 9; i++) {
      const t = i / 10; // 0.0, 0.1, ..., 0.9
      const s = worldToScreen(1, t, 0, GEOM_PADRAO);
      const c = screenToCell(s.sx, s.sy, 0, GEOM_PADRAO);
      assert.strictEqual(c.x, 1, `t=${t}: esperado x=1, obtido x=${c.x}`);
      assert.strictEqual(c.y, 0, `t=${t}: esperado y=0, obtido y=${c.y}`);
    }
  });

  it('sem saltos: vizinhança de cada ponto mapeia para a mesma célula ou adjacente', () => {
    // Testa que screenToCell é estável: pequenos deslocamentos no ecrã
    // não saltam mais do que uma célula.
    const centros: ReadonlyArray<{ sx: number; sy: number }> = [
      { sx: 0, sy: 16 },    // centro de (0,0)
      { sx: 32, sy: 48 },   // centro de (1,0) — worldToScreen(1,0,0)+(0,32) = (32,48)
      { sx: -32, sy: 48 },  // centro de (0,1)
      { sx: 64, sy: 32 },   // centro de (2,0)
    ];
    for (const { sx, sy } of centros) {
      const cRef = screenToCell(sx, sy, 0, GEOM_PADRAO);
      // Pequeno deslocamento em várias direcções
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1]] as [number, number][]) {
        const c = screenToCell(sx + dx, sy + dy, 0, GEOM_PADRAO);
        const dist = Math.max(Math.abs(c.x - cRef.x), Math.abs(c.y - cRef.y));
        assert.ok(
          dist <= 1,
          `centro (${sx},${sy}) → (${cRef.x},${cRef.y}); ` +
            `deslocamento (${dx},${dy}) → (${c.x},${c.y}); distância ${dist}`,
        );
      }
    }
  });
});

describe('rejeição de geometria inválida', () => {
  it('tileHeight == tileWidth/2 é aceite', () => {
    // Não deve lançar
    worldToScreen(0, 0, 0, { tileWidth: 100, tileHeight: 50, zStep: 25 });
    screenToWorld(0, 0, 0, { tileWidth: 100, tileHeight: 50, zStep: 25 });
  });

  it('tileHeight != tileWidth/2 lança', () => {
    const geom: ProjectGeometry = { tileWidth: 100, tileHeight: 60, zStep: 30 };

    assert.throws(
      () => worldToScreen(0, 0, 0, geom),
      (err: unknown) =>
        err instanceof Error && err.message.includes('tileHeight'),
    );

    assert.throws(
      () => screenToWorld(0, 0, 0, geom),
      (err: unknown) =>
        err instanceof Error && err.message.includes('tileHeight'),
    );

    assert.throws(
      () => screenToCell(0, 0, 0, geom),
      (err: unknown) =>
        err instanceof Error && err.message.includes('tileHeight'),
    );
  });

  it('mensagem de erro menciona os valores', () => {
    const geom: ProjectGeometry = { tileWidth: 100, tileHeight: 60, zStep: 30 };
    assert.throws(
      () => worldToScreen(0, 0, 0, geom),
      (err: unknown) => {
        if (!(err instanceof Error)) return false;
        return (
          err.message.includes('60') &&
          err.message.includes('50') &&
          err.message.includes('100')
        );
      },
    );
  });

  it('tileHeight == 0 também é rejeitado (divisão por zero)', () => {
    // tileHeight=0 implica tileWidth=0 pela razão 2:1, logo halfW=0 também
    // — mas a validação rejeita antes de chegar à divisão.
    const geom: ProjectGeometry = { tileWidth: 0, tileHeight: 0, zStep: 0 };
    assert.throws(() => worldToScreen(0, 0, 0, geom));
  });
});
