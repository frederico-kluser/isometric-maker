/**
 * Testes da chave de profundidade x+y+z (F2-03).
 *
 * Cobre:
 *   1. Células: chave = x+y+z, ordenação correcta.
 *   2. Paredes a meia-célula: N/L +0.5, S/O −0.5.
 *   3. Consistência de arestas partilhadas: mesma chave vista dos dois lados.
 *   4. Empate resolvido por y, depois x, depois z.
 *   5. Demonstração da falha do sprite alto (limitação conhecida).
 *
 * Execute com: node --test src/depth.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  depthKey,
  depthKeyForEdge,
  compareDepth,
  sortByDepth,
  type DepthCell,
  type DepthEdge,
  type DepthItem,
} from './depth.ts';

// ------------------------------------------------------------------ helpers

function cell(x: number, y: number, z: number): DepthItem {
  return { kind: 'cell', x, y, z };
}

function edge(x: number, y: number, z: number, lado: 'N' | 'L' | 'S' | 'O'): DepthItem {
  return { kind: 'edge', x, y, z, lado };
}

const EPS = 1e-9;

// ------------------------------------------------------------------ depthKey (células)

describe('depthKey — células', () => {
  it('origem (0,0,0) → 0', () => {
    assert.strictEqual(depthKey({ x: 0, y: 0, z: 0 }), 0);
  });

  it('(1,2,3) → 6', () => {
    assert.strictEqual(depthKey({ x: 1, y: 2, z: 3 }), 6);
  });

  it('(+1 em x) → +1 na chave', () => {
    assert.strictEqual(
      depthKey({ x: 1, y: 0, z: 0 }) - depthKey({ x: 0, y: 0, z: 0 }),
      1,
    );
  });

  it('(+1 em y) → +1 na chave', () => {
    assert.strictEqual(
      depthKey({ x: 0, y: 1, z: 0 }) - depthKey({ x: 0, y: 0, z: 0 }),
      1,
    );
  });

  it('(+1 em z) → +1 na chave', () => {
    assert.strictEqual(
      depthKey({ x: 0, y: 0, z: 1 }) - depthKey({ x: 0, y: 0, z: 0 }),
      1,
    );
  });

  it('células na mesma diagonal de ecrã têm a mesma chave', () => {
    // worldToScreen: +x é (+halfW,+halfH), +y é (-halfW,+halfH).
    // Células com mesmo x+y têm mesma coordenada sy (linha de ecrã).
    assert.strictEqual(depthKey({ x: 3, y: 1, z: 0 }), 4);
    assert.strictEqual(depthKey({ x: 2, y: 2, z: 0 }), 4);
    assert.strictEqual(depthKey({ x: 1, y: 3, z: 0 }), 4);
    assert.strictEqual(depthKey({ x: 0, y: 4, z: 0 }), 4);
  });
});

// ------------------------------------------------------------------ depthKeyForEdge (paredes)

describe('depthKeyForEdge — paredes a meia-célula', () => {
  it('N (norte) → +0.5', () => {
    const k = depthKeyForEdge({ x: 0, y: 0, z: 0, lado: 'N' });
    assert.ok(Math.abs(k - 0.5) < EPS, `esperado 0.5, obtido ${k}`);
  });

  it('L (leste) → +0.5', () => {
    const k = depthKeyForEdge({ x: 0, y: 0, z: 0, lado: 'L' });
    assert.ok(Math.abs(k - 0.5) < EPS, `esperado 0.5, obtido ${k}`);
  });

  it('S (sul) → −0.5', () => {
    const k = depthKeyForEdge({ x: 0, y: 0, z: 0, lado: 'S' });
    assert.ok(Math.abs(k - (-0.5)) < EPS, `esperado -0.5, obtido ${k}`);
  });

  it('O (oeste) → −0.5', () => {
    const k = depthKeyForEdge({ x: 0, y: 0, z: 0, lado: 'O' });
    assert.ok(Math.abs(k - (-0.5)) < EPS, `esperado -0.5, obtido ${k}`);
  });

  it('z afecta a chave da parede', () => {
    const k0 = depthKeyForEdge({ x: 0, y: 0, z: 0, lado: 'N' });
    const k1 = depthKeyForEdge({ x: 0, y: 0, z: 1, lado: 'N' });
    assert.ok(Math.abs(k1 - k0 - 1) < EPS);
  });
});

// ------------------------------------------------------------------ consistência de arestas partilhadas

describe('consistência de arestas partilhadas', () => {
  it('norte de (0,0,0) ≡ sul de (0,1,0)', () => {
    const kn = depthKeyForEdge({ x: 0, y: 0, z: 0, lado: 'N' });
    const ks = depthKeyForEdge({ x: 0, y: 1, z: 0, lado: 'S' });
    assert.ok(Math.abs(kn - ks) < EPS, `norte=${kn}, sul=${ks}`);
  });

  it('leste de (0,0,0) ≡ oeste de (1,0,0)', () => {
    const kl = depthKeyForEdge({ x: 0, y: 0, z: 0, lado: 'L' });
    const ko = depthKeyForEdge({ x: 1, y: 0, z: 0, lado: 'O' });
    assert.ok(Math.abs(kl - ko) < EPS, `leste=${kl}, oeste=${ko}`);
  });

  it('consistência com z > 0', () => {
    const kn = depthKeyForEdge({ x: 3, y: 5, z: 2, lado: 'N' });
    const ks = depthKeyForEdge({ x: 3, y: 6, z: 2, lado: 'S' });
    assert.ok(Math.abs(kn - ks) < EPS);
  });

  it('consistência em todas as combinações num grid 3×3', () => {
    for (let x = 0; x < 3; x++) {
      for (let y = 0; y < 3; y++) {
        for (let z = 0; z < 2; z++) {
          // N ↔ S do vizinho +y
          const kn = depthKeyForEdge({ x, y, z, lado: 'N' });
          const ks = depthKeyForEdge({ x, y: y + 1, z, lado: 'S' });
          assert.ok(Math.abs(kn - ks) < EPS, `N(${x},${y},${z}) vs S(${x},${y + 1},${z})`);

          // L ↔ O do vizinho +x
          const kl = depthKeyForEdge({ x, y, z, lado: 'L' });
          const ko = depthKeyForEdge({ x: x + 1, y, z, lado: 'O' });
          assert.ok(Math.abs(kl - ko) < EPS, `L(${x},${y},${z}) vs O(${x + 1},${y},${z})`);
        }
      }
    }
  });
});

// ------------------------------------------------------------------ ordenação

describe('sortByDepth — ordenação de desenho', () => {
  it('ordena células por x+y+z crescente', () => {
    const items: DepthItem[] = [
      cell(2, 0, 0), // 2
      cell(0, 0, 0), // 0
      cell(1, 0, 0), // 1
    ];
    const sorted = sortByDepth(items);
    assert.deepStrictEqual(sorted, [
      cell(0, 0, 0),
      cell(1, 0, 0),
      cell(2, 0, 0),
    ]);
  });

  it('parede N é desenhada depois da célula dona', () => {
    const items: DepthItem[] = [
      edge(0, 0, 0, 'N'), // 0.5
      cell(0, 0, 0),       // 0
    ];
    const sorted = sortByDepth(items);
    assert.deepStrictEqual(sorted, [
      cell(0, 0, 0),
      edge(0, 0, 0, 'N'),
    ]);
  });

  it('parede S é desenhada antes da célula dona', () => {
    const items: DepthItem[] = [
      cell(0, 0, 0),       // 0
      edge(0, 0, 0, 'S'), // -0.5
    ];
    const sorted = sortByDepth(items);
    assert.deepStrictEqual(sorted, [
      edge(0, 0, 0, 'S'),
      cell(0, 0, 0),
    ]);
  });

  it('ordenação completa: células + paredes', () => {
    const items: DepthItem[] = [
      cell(2, 0, 0),        // 2
      cell(0, 0, 0),        // 0
      edge(0, 0, 0, 'N'),  // 0.5
      cell(1, 0, 0),        // 1
      edge(1, 0, 0, 'S'),  // 0.5
      edge(0, 0, 0, 'S'),  // -0.5
    ];
    const sorted = sortByDepth(items);
    const keys = sorted.map((s) => {
      if (s.kind === 'cell') return depthKey(s);
      return depthKeyForEdge(s);
    });
    // Deve ser não-decrescente
    for (let i = 1; i < keys.length; i++) {
      assert.ok(
        keys[i]! >= keys[i - 1]!,
        `ordem inválida na posição ${i}: ${keys[i]!} < ${keys[i - 1]!}`,
      );
    }
  });
});

// ------------------------------------------------------------------ empate (tie-breaking)

describe('tie-breaking — empate resolve por y, x, z', () => {
  it('mesma chave, y diferentes → menor y primeiro', () => {
    // x+y+z = 0+2+0 = 2, e 2+0+0 = 2
    const a = cell(0, 2, 0);
    const b = cell(2, 0, 0);
    assert.strictEqual(depthKey(a), depthKey(b));

    const sorted = sortByDepth([b, a]);
    assert.deepStrictEqual(sorted, [b, a]); // b.y=0 < a.y=2
  });

  it('mesma chave, mesmo y, x diferentes → menor x primeiro', () => {
    // 1+1+0 = 2, 2+0+0 = 2, mas y=0 < y=1 → o de y=0 vem primeiro
    // Para isolar x: mesma chave e mesmo y
    // 1+2+0 = 3, 2+1+0 = 3 — y diferentes
    // Mesma chave e mesmo y: 0+3+0 = 3, 1+2+0 = 3 mas y diferentes
    // Hmm: para ter mesma chave e mesmo y, x tem que ser igual.
    // A única forma é com z diferente: 0+1+1=2, 1+1+0=2
    const a = cell(0, 1, 1); // y=1, key=2
    const b = cell(1, 1, 0); // y=1, key=2
    assert.strictEqual(depthKey(a), depthKey(b));
    assert.strictEqual(a.y, b.y);

    const sorted = sortByDepth([b, a]);
    // a.x=0 < b.x=1 → a primeiro
    assert.deepStrictEqual(sorted, [a, b]);
  });

  it('mesma chave, mesmo y e x, z diferentes → menor z primeiro', () => {
    // 0+0+2=2, 0+0+1=1 — chaves diferentes
    // Para ter mesma chave com mesmo y e x: impossível, z seria diferente e
    // a chave também seria diferente.
    // A regra de z no tie-breaker é para o caso de termos dois itens
    // estruturalmente idênticos (ex.: duas paredes no mesmo sítio).
    const a = edge(0, 0, 0, 'N');
    const b = edge(0, 0, 0, 'N');
    const sorted = sortByDepth([b, a]);
    assert.deepStrictEqual(sorted, [b, a]); // ordem relativa mantida (estável)
  });

  it('ordenação estável: itens idênticos mantêm posição relativa', () => {
    const a = cell(1, 2, 3);
    const b = cell(1, 2, 3);
    const sorted = sortByDepth([b, a]);
    // A ordenação é estável: b (índice 0) antes de a (índice 1)
    assert.strictEqual(sorted[0], b);
    assert.strictEqual(sorted[1], a);
  });
});

// ------------------------------------------------------------------ sprite alto (limitação conhecida)

describe('sprite alto — limitação conhecida', () => {
  /**
   * Um sprite que ocupa 3 níveis visuais (ex.: árvore alta) está ancorado
   * na célula (0,0,0).  A chave de profundidade é 0.
   *
   * Uma célula em (0,0,1) — um bloco no nível acima, directamente atrás
   * no ecrã — tem chave 1 e seria desenhada DEPOIS do sprite (por cima).
   * Mas o topo do sprite ESTÁ acima de z=1 e devia tapar o bloco.
   *
   * A chave x+y+z não consegue exprimir isto porque o sprite ocupa uma
   * só célula mas visualmente estende-se por várias.
   *
   * Este teste NÃO é um bug a corrigir — é a demonstração da limitação.
   */
  it('DEMONSTRAÇÃO: sprite de 3 níveis em (0,0,0) ordena ANTES de bloco em (0,0,1)', () => {
    const sprite = cell(0, 0, 0); // base da árvore
    const blocoAcima = cell(0, 0, 1); // bloco no nível +1

    const sorted = sortByDepth([blocoAcima, sprite]);

    // O sprite (chave 0) vem antes do bloco (chave 1) → o bloco é
    // desenhado por cima.  Isto está errado para o topo da árvore.
    assert.deepStrictEqual(sorted, [sprite, blocoAcima]);

    // NOTA: Esta é a limitação conhecida.  A correcção requer que o
    // renderer saiba a altura visual do sprite e a use para ajustar a
    // chave de profundidade.  Este módulo só vê coordenadas de grid.
    console.log(
      '⚠ Limitação conhecida: sprite alto em (0,0,0) ordena antes de (0,0,1). ' +
        'O topo do sprite deveria tapar o bloco, mas a chave x+y+z não vê a altura visual.',
    );
  });

  it('sprite de 2 níveis ainda falha para o bloco imediatamente acima', () => {
    const sprite = cell(0, 0, 0); // ocupa visualmente z=0 e z=1
    const bloco = cell(0, 0, 1);  // devia ficar atrás do topo do sprite

    const sorted = sortByDepth([bloco, sprite]);
    // Errado: bloco desenhado depois do sprite
    assert.deepStrictEqual(sorted, [sprite, bloco]);
  });

  it('sprite de 1 nível (altura = célula) funciona correctamente', () => {
    // Um sprite que ocupa exactamente 1 nível (z=0) deve ser tapado
    // por um bloco em (0,0,1) — isto está correcto.
    const sprite = cell(0, 0, 0);
    const bloco = cell(0, 0, 1);

    const sorted = sortByDepth([bloco, sprite]);
    assert.deepStrictEqual(sorted, [sprite, bloco]);
    // Correcto: sprite (chave 0) antes do bloco (chave 1).
  });
});
