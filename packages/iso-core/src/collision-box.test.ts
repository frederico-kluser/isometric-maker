/**
 * Testes da colisão sólida AABB (`collision-box.ts`).
 *
 * O que estes testes travam:
 *   - a caixa da entidade está no espaço do GRID, meio-aberta em cima;
 *   - a varredura por eixo clampa a face no primeiro sólido (swept AABB);
 *   - uma caixa embutida num sólido não anda — quem resolve é o push-out;
 *   - o sliding é por eixo: bloquear X não trava Y, e a quina não se corta;
 *   - `solidAt` honra o catálogo: água não barra, `hasBlock` booleano sim;
 *   - o push-out (MTV) empurra para fora da célula no eixo de menor
 *     penetração, e o editor não deixa o personagem dentro do bloco colocado.
 *
 * Execute com: node --test src/collision-box.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_CATALOG } from './block-catalog.ts';
import {
  entityAabb,
  PLAYER_HALF,
  pressedCells,
  pushOut,
  pushOutOf,
  pushPlayerOutOfCell,
  resolveMovement,
  solidAtFromBlocks,
  sweepX,
  sweepY,
  type EntityBox,
} from './collision-box.ts';
import type { CollisionMap } from './collision.ts';
import type { MapData } from './map.ts';
import { enumerateBlocks } from './map-instances.ts';

// ------------------------------------------------------------------ mapa de teste

/**
 * Duplo de teste com `hasBlock` e `solidAt` separados: `addSolid` barra para
 * ambos; `addNonSolid` existe em `hasBlock` mas não barra — o caso água/lava,
 * que o booleano histórico confundia.
 */
class FakeBoxMap implements CollisionMap {
  readonly #solid = new Set<string>();
  readonly #nonSolid = new Set<string>();

  hasBlock(x: number, y: number, z: number): boolean {
    return this.#solid.has(`${x}:${y}:${z}`) || this.#nonSolid.has(`${x}:${y}:${z}`);
  }

  hasEdge(): boolean {
    return false;
  }

  solidAt(x: number, y: number, z: number): boolean {
    return this.#solid.has(`${x}:${y}:${z}`);
  }

  addSolid(x: number, y: number, z: number): this {
    this.#solid.add(`${x}:${y}:${z}`);
    return this;
  }

  addNonSolid(x: number, y: number, z: number): this {
    this.#nonSolid.add(`${x}:${y}:${z}`);
    return this;
  }
}

// ------------------------------------------------------------------ helpers

function boxAt(cx: number, cy: number, z: number, half = PLAYER_HALF): EntityBox {
  return { cx, cy, z, half };
}

const VAZIO = new FakeBoxMap();

// ------------------------------------------------------------------ AABB

describe('entityAabb', () => {
  it('devolve a caixa no espaço do GRID, meio-aberta em cima', () => {
    assert.deepEqual(entityAabb(boxAt(0.5, 0.5, 1)), {
      minX: 0.175,
      minY: 0.175,
      minZ: 1,
      maxX: 0.825,
      maxY: 0.825,
      maxZ: 2,
    });
  });
});

// ------------------------------------------------------------------ varredura

describe('sweepX — varredura por eixo', () => {
  it('sem obstáculo, devolve o dx pedido', () => {
    const box = boxAt(0.5, 0.5, 1);
    assert.equal(sweepX(VAZIO, box, 0.7), 0.7);
    assert.equal(sweepX(VAZIO, box, -0.4), -0.4);
    assert.equal(sweepX(VAZIO, box, 0), 0);
  });

  it('clampa na face do primeiro sólido à frente (+x)', () => {
    const map = new FakeBoxMap().addSolid(1, 0, 1);
    const box = boxAt(0.5, 0.5, 1);
    // Face maxX = 0,825; o bloco em [1,2) → clampa a face em 1,0 → cx = 0,675.
    assert.ok(Math.abs(sweepX(map, box, 0.7) - 0.175) < 1e-9);
    assert.ok(Math.abs(sweepX(map, box, 9) - 0.175) < 1e-9, 'clampa mesmo com dx grande');
  });

  it('clampa na face do primeiro sólido à frente (-x)', () => {
    const map = new FakeBoxMap().addSolid(0, 0, 1);
    const box = boxAt(1.5, 0.5, 1);
    // Face minX = 1,175; o bloco em [0,1) → clampa a face em 1,0 → cx = 1,325.
    assert.ok(Math.abs(sweepX(map, box, -0.7) - -0.175) < 1e-9);
  });

  it('uma caixa já embutida num sólido não anda', () => {
    const map = new FakeBoxMap().addSolid(0, 0, 1);
    const box = boxAt(0.5, 0.5, 1); // já intersecta (0,0,1)
    assert.equal(sweepX(map, box, 0.7), 0, 'não aprofunda no sólido');
    assert.equal(sweepX(map, box, -0.7), 0, 'não sai sozinha — é o pushOut que resolve');
  });

  it('encostar na fronteira não é bloquear: o movimento que termina exatamente na face é aceite', () => {
    const map = new FakeBoxMap().addSolid(1, 0, 1);
    const box = boxAt(0.5, 0.5, 1);
    // dx = 0,175 leva a face exactamente a 1,0 (encostada, meio-aberta em cima).
    assert.ok(Math.abs(sweepX(map, box, 0.175) - 0.175) < 1e-9);
  });
});

describe('sweepY — varredura por eixo', () => {
  it('clampa na face do primeiro sólido à frente (+y)', () => {
    const map = new FakeBoxMap().addSolid(0, 1, 1);
    const box = boxAt(0.5, 0.5, 1);
    assert.ok(Math.abs(sweepY(map, box, 0.7) - 0.175) < 1e-9, 'cy vai a 0,675');
  });

  it('não bloqueia o eixo perpendicular ao sólido', () => {
    const map = new FakeBoxMap().addSolid(0, 1, 1);
    const box = boxAt(0.5, 0.5, 1);
    assert.equal(sweepX(map, box, 0.7), 0.7, 'o bloco em y=1 não está no percurso de x');
  });
});

// ------------------------------------------------------------------ resolveMovement

describe('resolveMovement — movimento por eixo com sliding', () => {
  it('sem obstáculo, move tudo e nada bloqueia', () => {
    const box = boxAt(0.5, 0.5, 1);
    const r = resolveMovement(VAZIO, box, 0.7, 0.3);
    assert.deepEqual(r, { x: 1.2, y: 0.8, blockedX: false, blockedY: false });
  });

  it('bloquear X não trava Y — o sliding natural de parede', () => {
    const map = new FakeBoxMap().addSolid(2, 0, 1);
    const box = boxAt(0.5, 0.5, 1);
    const r = resolveMovement(map, box, 1.5, 0.3);
    assert.deepEqual(r, { x: 1.675, y: 0.8, blockedX: true, blockedY: false });
  });

  it('a quina não se corta: o segundo eixo vê a célula do canto', () => {
    const map = new FakeBoxMap().addSolid(1, 1, 1);
    const box = boxAt(0.5, 0.5, 1);
    // X passa livre pela linha 0; o Y varre com a caixa já em x=1,4 e vê o
    // bloco no canto (1,1) → desliza pela face sul dele.
    const r = resolveMovement(map, box, 0.9, 0.9);
    assert.deepEqual(r, { x: 1.4, y: 0.675, blockedX: false, blockedY: true });
  });

  it('dx = 0 não é bloqueio', () => {
    const map = new FakeBoxMap().addSolid(2, 0, 1);
    const box = boxAt(0.5, 0.5, 1);
    const r = resolveMovement(map, box, 0, 0.3);
    assert.deepEqual(r, { x: 0.5, y: 0.8, blockedX: false, blockedY: false });
  });
});

// ------------------------------------------------------------------ solidAt

describe('solidAt honra o catálogo', () => {
  it('água (solid: false) não barra, mesmo com hasBlock verdadeiro', () => {
    const map = new FakeBoxMap().addNonSolid(1, 0, 1);
    const box = boxAt(0.5, 0.5, 1);
    assert.equal(map.hasBlock(1, 0, 1), true, 'o booleano histórico diria que barra');
    assert.equal(sweepX(map, box, 0.7), 0.7, 'a caixa atravessa a água');
  });

  it('sem solidAt no mapa, o padrão cai para hasBlock — o comportamento histórico', () => {
    // Duplo antigo: só conhece hasBlock (todo bloco barra).
    class MapBooleano implements CollisionMap {
      hasBlock(x: number, y: number, z: number): boolean {
        return x === 1 && y === 0 && z === 1;
      }
      hasEdge(): boolean {
        return false;
      }
    }
    const box = boxAt(0.5, 0.5, 1);
    assert.ok(Math.abs(sweepX(new MapBooleano(), box, 0.7) - 0.175) < 1e-9);
  });

  it('solidAtFromBlocks resolve o mapa real: água não barra, pedra barra', () => {
    const mapa: MapData = {
      blocks: { '1:0': [{ block: 'agua', count: 1 }], '2:0': [{ block: 'pedra', count: 1 }] },
      edges: [],
    };
    const solidAt = solidAtFromBlocks(enumerateBlocks(mapa, DEFAULT_CATALOG));
    assert.equal(solidAt(1, 0, 0), false, 'água é liquid, solid: false');
    assert.equal(solidAt(2, 0, 0), true, 'pedra é sólida');
    assert.equal(solidAt(1, 0, 1), false, 'ar não barra');
    assert.equal(solidAt(9, 9, 9), false, 'coluna ausente não barra');
  });
});

// ------------------------------------------------------------------ pressedCells

describe('pressedCells — a célula da face bloqueada', () => {
  it('devolve a célula à frente da face +x', () => {
    const box = boxAt(0.5, 0.5, 1);
    const moved = { x: 0.675, y: 0.5, blockedX: true, blockedY: false };
    assert.deepEqual(pressedCells(box, moved, 0.7, 0), [{ x: 1, y: 0 }]);
  });

  it('devolve a célula à frente da face -y', () => {
    const box = boxAt(0.5, 1.5, 1);
    const moved = { x: 0.5, y: 1.325, blockedX: false, blockedY: true };
    assert.deepEqual(pressedCells(box, moved, 0, -0.7), [{ x: 0, y: 0 }]);
  });

  it('sem bloqueio, não há célula pressionada', () => {
    const box = boxAt(0.5, 0.5, 1);
    assert.deepEqual(pressedCells(box, { x: 1.2, y: 0.8, blockedX: false, blockedY: false }, 0.7, 0.3), []);
  });
});

// ------------------------------------------------------------------ pushOut

describe('pushOut — MTV, eixo de menor penetração', () => {
  it('caixa livre devolve null', () => {
    assert.equal(pushOut(VAZIO, boxAt(0.5, 0.5, 1)), null);
  });

  it('caixa embutida numa célula sólida é empurrada para fora no eixo de menor penetração', () => {
    const map = new FakeBoxMap().addSolid(0, 0, 1);
    const pushed = pushOut(map, boxAt(0.5, 0.5, 1));
    assert.ok(pushed, 'devia empurrar');
    // Penetração 0,65 nos dois eixos; o MTV escolhe x e empurra para leste
    // (centro 0,5 não é menor que 0,5): caixa [1,0, 1,65] encosta no bloco.
    assert.ok(Math.abs(pushed!.cx - 1.325) < 1e-9);
    assert.equal(pushed!.cy, 0.5);
  });

  it('sólido não-sólido (água) não empurra', () => {
    const map = new FakeBoxMap().addNonSolid(0, 0, 1);
    assert.equal(pushOut(map, boxAt(0.5, 0.5, 1)), null);
  });

  it('penetração além de MAX_PUSH não é resolvida', () => {
    const map = new FakeBoxMap().addSolid(0, 0, 1);
    // half=0,9 → caixa de 1,8 numa célula de 1,0: penetração 1,0 > 0,9.
    assert.equal(pushOut(map, boxAt(0.5, 0.5, 1, 0.9)), null);
  });

  it('pushOutOf é o núcleo sem mapa: mesma semântica', () => {
    const map = new FakeBoxMap().addSolid(0, 0, 1);
    const box = boxAt(0.5, 0.5, 1);
    const viaMap = pushOut(map, box);
    const viaNucleo = pushOutOf((x, y, z) => map.solidAt(x, y, z), box);
    assert.deepEqual(viaNucleo, viaMap);
  });
});

// ------------------------------------------------------------------ editor

describe('pushPlayerOutOfCell — colocar bloco sobre o personagem', () => {
  const BASE: MapData = { blocks: { '0:0': [{ block: 'grama', count: 1 }] }, edges: [] };
  const comPedra: MapData = {
    blocks: { '0:0': [{ block: 'grama', count: 1 }, { block: 'pedra', count: 1 }] },
    edges: [],
  };
  const comAgua: MapData = {
    blocks: { '0:0': [{ block: 'grama', count: 1 }, { block: 'agua', count: 1 }] },
    edges: [],
  };

  it('personagem no chão com um bloco sólido colocado na própria célula é empurrado para fora', () => {
    const pushed = pushPlayerOutOfCell(comPedra, DEFAULT_CATALOG, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
    assert.deepEqual(pushed, { x: 1, y: 0, z: 1 }, 'empurrado para leste, mesma cota');
  });

  it('água na célula do personagem não empurra (não é sólida)', () => {
    assert.equal(pushPlayerOutOfCell(comAgua, DEFAULT_CATALOG, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }), null);
  });

  it('bloco fora da célula do personagem não empurra', () => {
    assert.equal(pushPlayerOutOfCell(comPedra, DEFAULT_CATALOG, { x: 2, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }), null);
  });

  it('bloco no nível de cima (tecto) não empurra — a caixa é meio-aberta em cima', () => {
    const mapa: MapData = {
      blocks: {
        '0:0': [{ block: 'grama', count: 1 }, { block: '', count: 1 }, { block: 'pedra', count: 1 }],
      },
      edges: [],
    };
    assert.equal(pushPlayerOutOfCell(mapa, DEFAULT_CATALOG, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 2 }), null);
  });

  it('o mapa sem o bloco não tem o que empurrar', () => {
    assert.equal(pushPlayerOutOfCell(BASE, DEFAULT_CATALOG, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }), null);
  });
});
