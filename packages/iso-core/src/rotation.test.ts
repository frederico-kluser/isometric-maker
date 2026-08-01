/**
 * Teste da rotação da câmera isométrica.
 *
 * As propriedades aqui são o que impede a rotação de virar "quase certo": ela
 * tem que ser uma involução de ordem 4, `z` tem que sair intacto, a inversa tem
 * que fechar o ciclo (senão o clique cai na célula errada fora da vista 0), e a
 * chave de profundidade tem que continuar concordando com a projeção depois do
 * giro.
 *
 * Execute com: node --test src/rotation.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROTATIONS,
  normalizeRotation,
  turn,
  rotatePoint,
  unrotatePoint,
  rotateCell,
  unrotateCell,
  rotatedDepthKey,
  rotateDirectionIndex,
  rotateEdgeSide,
  type Rotation,
} from './rotation.ts';
import { worldToScreen } from './geometry.ts';

const GEOM = { tileWidth: 64, tileHeight: 32, zStep: 16 };

/** Grade de teste que inclui negativos — é lá que `% 4` erraria. */
const SAMPLE: ReadonlyArray<{ x: number; y: number; z: number }> = (() => {
  const out: Array<{ x: number; y: number; z: number }> = [];
  for (let x = -3; x <= 3; x += 1) {
    for (let y = -3; y <= 3; y += 1) {
      for (const z of [0, 1, 5]) out.push({ x, y, z });
    }
  }
  return out;
})();

// ------------------------------------------------------------------ normalização

test('normalizeRotation trata negativo como o motor de referência (-1 → 3)', () => {
  assert.equal(normalizeRotation(0), 0);
  assert.equal(normalizeRotation(4), 0);
  assert.equal(normalizeRotation(5), 1);
  assert.equal(normalizeRotation(-1), 3, 'anti-horário cai do complemento de dois');
  assert.equal(normalizeRotation(-4), 0);
  assert.equal(normalizeRotation(-5), 3);
});

test('turn gira nos dois sentidos e sempre fecha em quatro passos', () => {
  let r: Rotation = 0;
  for (let i = 0; i < 4; i += 1) r = turn(r, 1);
  assert.equal(r, 0, 'quatro giros horários voltam à vista inicial');

  for (let i = 0; i < 4; i += 1) r = turn(r, -1);
  assert.equal(r, 0, 'quatro giros anti-horários também');

  assert.equal(turn(0, -1), 3);
  assert.equal(turn(3, 1), 0);
});

// ------------------------------------------------------------------ transformação

test('as quatro vistas batem com a tabela do motor de referência', () => {
  assert.deepEqual(rotatePoint(2, 5, 0), { x: 2, y: 5 });
  assert.deepEqual(rotatePoint(2, 5, 1), { x: 5, y: -2 });
  assert.deepEqual(rotatePoint(2, 5, 2), { x: -2, y: -5 });
  assert.deepEqual(rotatePoint(2, 5, 3), { x: -5, y: 2 });
});

test('rotacionar quatro vezes devolve o ponto original (ordem 4)', () => {
  for (const c of SAMPLE) {
    let p = { x: c.x, y: c.y };
    for (let i = 0; i < 4; i += 1) p = rotatePoint(p.x, p.y, 1);
    assert.deepEqual(p, { x: c.x, y: c.y }, `ciclo quebrou em (${c.x},${c.y})`);
  }
});

test('unrotatePoint é a inversa exata em todas as vistas', () => {
  for (const c of SAMPLE) {
    for (const r of ROTATIONS) {
      const fwd = rotatePoint(c.x, c.y, r);
      assert.deepEqual(
        unrotatePoint(fwd.x, fwd.y, r),
        { x: c.x, y: c.y },
        `ida e volta falhou em (${c.x},${c.y}) vista ${r} — o picking cairia na célula errada`,
      );
    }
  }
});

test('z é INVARIANTE — nunca entra na rotação', () => {
  for (const c of SAMPLE) {
    for (const r of ROTATIONS) {
      assert.equal(rotateCell(c, r).z, c.z, 'z rotacionado é o bug clássico de copiar o padrão pela metade');
      assert.equal(unrotateCell(c, r).z, c.z);
    }
  }
});

// ------------------------------------------------------------------ profundidade

test('rotatedDepthKey é equivalente às quatro expressões em coordenadas armazenadas', () => {
  // As formas que a literatura materializa, aqui usadas só como oráculo:
  // rot0: x+y · rot1: y−x · rot2: −(x+y) · rot3: x−y.
  const oracle = (x: number, y: number, r: Rotation): number =>
    r === 0 ? x + y : r === 1 ? y - x : r === 2 ? -(x + y) : x - y;

  for (const c of SAMPLE) {
    for (const r of ROTATIONS) {
      assert.equal(
        rotatedDepthKey(c, r),
        oracle(c.x, c.y, r) + c.z,
        `chave divergiu em (${c.x},${c.y},${c.z}) vista ${r}`,
      );
    }
  }
});

test('a chave rotacionada concorda com a projeção: maior chave desenha depois', () => {
  // A propriedade que importa de verdade: em qualquer vista, se A tem chave
  // maior que B, então A está mais perto da câmera — e na projeção isso é
  // exatamente ter sy maior no mesmo z.
  for (const r of ROTATIONS) {
    for (const a of SAMPLE) {
      for (const b of SAMPLE) {
        if (a.z !== b.z) continue;
        const ka = rotatedDepthKey(a, r);
        const kb = rotatedDepthKey(b, r);
        if (ka === kb) continue;
        const ra = rotatePoint(a.x, a.y, r);
        const rb = rotatePoint(b.x, b.y, r);
        const sa = worldToScreen(ra.x, ra.y, a.z, GEOM).sy;
        const sb = worldToScreen(rb.x, rb.y, b.z, GEOM).sy;
        assert.equal(
          ka > kb,
          sa > sb,
          `vista ${r}: chave e projeção discordaram entre ` +
            `(${a.x},${a.y},${a.z}) e (${b.x},${b.y},${b.z})`,
        );
      }
    }
  }
});

// ------------------------------------------------------------------ sprites direcionais

test('8 direções avançam 2 índices por giro; 4 faces avançam 1', () => {
  assert.equal(rotateDirectionIndex(0, 8, 1), 2);
  assert.equal(rotateDirectionIndex(0, 8, 2), 4);
  assert.equal(rotateDirectionIndex(7, 8, 1), 1, 'tem que dar a volta');
  assert.equal(rotateDirectionIndex(0, 4, 1), 1);
  assert.equal(rotateDirectionIndex(3, 4, 1), 0);
});

test('reindexar direção também é ordem 4', () => {
  for (const count of [4, 8]) {
    for (let i = 0; i < count; i += 1) {
      let v = i;
      for (let k = 0; k < 4; k += 1) v = rotateDirectionIndex(v, count, 1);
      assert.equal(v, i, `direção ${i} de ${count} não voltou ao início`);
    }
  }
});

test('directionCount que não é múltiplo de 4 é erro explícito', () => {
  // Com 6 direções um giro de 90° cairia entre duas — melhor recusar do que
  // arredondar em silêncio.
  assert.throws(() => rotateDirectionIndex(0, 6, 1), /múltiplo positivo de 4/);
  assert.throws(() => rotateDirectionIndex(0, 0, 1), /múltiplo positivo de 4/);
});

// ------------------------------------------------------------------ arestas

test('lado de parede reindexa junto com a vista', () => {
  assert.equal(rotateEdgeSide('N', 0), 'N');
  assert.equal(rotateEdgeSide('N', 1), 'L');
  assert.equal(rotateEdgeSide('N', 2), 'S');
  assert.equal(rotateEdgeSide('N', 3), 'O');
  assert.equal(rotateEdgeSide('O', 1), 'N', 'tem que dar a volta');
});

test('lado desconhecido é erro nomeado', () => {
  assert.throws(() => rotateEdgeSide('X' as never, 1), /lado de aresta desconhecido/);
});

// ------------------------------------------------------------------ zero negativo

test('nenhuma vista devolve -0 (Object.is(-0, 0) é false e quebra comparação de célula)', () => {
  for (const r of ROTATIONS) {
    for (const c of SAMPLE) {
      const p = rotatePoint(c.x, c.y, r);
      assert.ok(!Object.is(p.x, -0), `vista ${r}: x virou -0 em (${c.x},${c.y})`);
      assert.ok(!Object.is(p.y, -0), `vista ${r}: y virou -0 em (${c.x},${c.y})`);
      const u = unrotatePoint(c.x, c.y, r);
      assert.ok(!Object.is(u.x, -0) && !Object.is(u.y, -0), 'a inversa também');
    }
  }
  // O caso que provocou: (1,0) girado 180° dá x=-1, y=-0 sem normalização.
  assert.deepEqual(rotatePoint(1, 0, 2), { x: -1, y: 0 });
});
