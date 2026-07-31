/**
 * Teste do módulo de pulo (F3-04).
 *
 * Verifica:
 *   1. createJump inicializa com progresso 0.
 *   2. effectiveZ devolve zOrigin quando progresso < 0.5.
 *   3. effectiveZ devolve zDest quando progresso ≥ 0.5.
 *   4. effectiveZ é SEMPRE inteiro.
 *   5. visualOffsetY é uma parábola simétrica com pico no meio.
 *   6. advanceJump avança correctamente e para em 1.0.
 *   7. isJumpComplete.
 *   8. isJumpTransitioning detecta o cruzamento de 0.5.
 *   9. Invariante de inteiro: percorre a transição inteira e asserta
 *      Number.isInteger(z) em todos os passos.
 *  10. Colisão: declara a regra e testa que z usado para colisão é sempre
 *      zOrigin ou zDest, nunca um valor intermédio.
 *
 * Execute com: node --test src/jump.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createJump,
  effectiveZ,
  visualOffsetY,
  advanceJump,
  isJumpComplete,
  isJumpTransitioning,
  NO_JUMP,
} from './jump.ts';

// ------------------------------------------------------------------ createJump

test('createJump inicializa com progresso 0', () => {
  const j = createJump(0, 2);
  assert.equal(j.zOrigin, 0);
  assert.equal(j.zDest, 2);
  assert.equal(j.progress, 0.0);
});

// ------------------------------------------------------------------ effectiveZ

test('effectiveZ — progresso < 0.5 → zOrigin', () => {
  const j = createJump(1, 3);
  const states = [
    { ...j, progress: 0.0 },
    { ...j, progress: 0.25 },
    { ...j, progress: 0.49 },
  ];
  for (const s of states) {
    assert.equal(effectiveZ(s), 1, `progresso ${s.progress} deveria estar em zOrigin=1`);
  }
});

test('effectiveZ — progresso ≥ 0.5 → zDest', () => {
  const j = createJump(1, 3);
  const states = [
    { ...j, progress: 0.5 },
    { ...j, progress: 0.75 },
    { ...j, progress: 1.0 },
  ];
  for (const s of states) {
    assert.equal(effectiveZ(s), 3, `progresso ${s.progress} deveria estar em zDest=3`);
  }
});

test('effectiveZ — zOrigin pode ser maior que zDest (salto para baixo)', () => {
  const j = createJump(5, 2);
  // progresso < 0.5 → zOrigin = 5
  assert.equal(effectiveZ({ ...j, progress: 0.3 }), 5);
  // progresso ≥ 0.5 → zDest = 2
  assert.equal(effectiveZ({ ...j, progress: 0.7 }), 2);
});

// ------------------------------------------------------------------ invariante de inteiro

test('INVARIANTE: effectiveZ é SEMPRE inteiro', () => {
  // Percorre a transição inteira de 0.0 a 1.0 em passos pequenos.
  const j = createJump(0, 3);
  for (let p = 0.0; p <= 1.0; p += 0.01) {
    const z = effectiveZ({ ...j, progress: p });
    assert.ok(
      Number.isInteger(z),
      `z deveria ser inteiro em progresso=${p.toFixed(2)}, mas é ${z}`,
    );
  }
  console.log('✓ invariante: Number.isInteger(z) em todos os 101 passos');
});

test('INVARIANTE: mesmos valores de z para zOrigin e zDest iguais', () => {
  // Pulo "no lugar" — z não muda.
  const j = createJump(2, 2);
  for (let p = 0.0; p <= 1.0; p += 0.01) {
    const z = effectiveZ({ ...j, progress: p });
    assert.equal(z, 2, `z deveria ser 2 em progresso=${p.toFixed(2)}, mas é ${z}`);
    assert.ok(Number.isInteger(z));
  }
});

// ------------------------------------------------------------------ visualOffsetY

test('visualOffsetY — começa em 0, pico no meio, termina em 0', () => {
  const h = 48; // píxeis

  // -0 é zero para todos os efeitos; Object.is distingue -0 de 0 mas
  // para este teste o que interessa é que o valor é zero.
  assert.ok(visualOffsetY(0.0, h) === 0 || Object.is(visualOffsetY(0.0, h), 0), 'offset no início deve ser 0');
  assert.ok(visualOffsetY(1.0, h) === 0 || Object.is(visualOffsetY(1.0, h), 0), 'offset no fim deve ser 0');

  const mid = visualOffsetY(0.5, h);
  assert.ok(mid < 0, `pico deve ser negativo (para cima), mas é ${mid}`);
  assert.equal(mid, -h, `pico deve ser -${h}, mas é ${mid}`);
});

test('visualOffsetY — simetria', () => {
  const h = 64;
  // offset em 0.25 deve ser igual ao offset em 0.75
  const a = visualOffsetY(0.25, h);
  const b = visualOffsetY(0.75, h);
  assert.equal(a, b, `parábola deve ser simétrica: offset(0.25)=${a} deve igualar offset(0.75)=${b}`);
});

test('visualOffsetY — proporcional à altura', () => {
  // Dobrar a altura dobra o offset em qualquer ponto.
  const a = visualOffsetY(0.5, 32);
  const b = visualOffsetY(0.5, 64);
  assert.equal(b, a * 2, 'dobrar altura deve dobrar offset');
});

// ------------------------------------------------------------------ advanceJump

test('advanceJump avança o progresso', () => {
  const j = createJump(0, 2);
  const r = advanceJump(j, 0.1, 0.4); // dt=0.1, duration=0.4 → step=0.25

  assert.equal(r.progress, 0.25);
  assert.equal(r.zOrigin, 0);
  assert.equal(r.zDest, 2);
});

test('advanceJump não ultrapassa 1.0', () => {
  const j = createJump(0, 2);
  const r = advanceJump(j, 10.0, 1.0); // dt enorme

  assert.equal(r.progress, 1.0, 'progresso não deve ultrapassar 1.0');
});

test('advanceJump é no-op quando progresso já é 1.0', () => {
  const done: typeof NO_JUMP = { ...NO_JUMP, zOrigin: 1, zDest: 3 };
  const r = advanceJump(done, 0.1, 0.4);
  assert.equal(r.progress, 1.0);
});

// ------------------------------------------------------------------ isJumpComplete / isJumpTransitioning

test('isJumpComplete — true apenas quando progresso ≥ 1.0', () => {
  assert.equal(isJumpComplete(NO_JUMP), true);
  assert.equal(isJumpComplete(createJump(0, 2)), false);

  const almost = { ...createJump(0, 2), progress: 0.99 };
  assert.equal(isJumpComplete(almost), false);

  const done = { ...createJump(0, 2), progress: 1.0 };
  assert.equal(isJumpComplete(done), true);
});

test('isJumpTransitioning — detecta cruzamento de 0.5', () => {
  // progresso anterior < 0.5, novo ≥ 0.5 → transição
  assert.equal(isJumpTransitioning({ zOrigin: 0, zDest: 2, progress: 0.55 }, 0.45), true);

  // Ambos < 0.5: sem transição
  assert.equal(isJumpTransitioning({ zOrigin: 0, zDest: 2, progress: 0.4 }, 0.3), false);

  // Ambos ≥ 0.5: sem transição
  assert.equal(isJumpTransitioning({ zOrigin: 0, zDest: 2, progress: 0.7 }, 0.6), false);

  // Já estava em 0.5: sem transição
  assert.equal(isJumpTransitioning({ zOrigin: 0, zDest: 2, progress: 0.5 }, 0.5), false);
});

// ------------------------------------------------------------------ colisão

test('colisão durante pulo — z para colisão é sempre zOrigin ou zDest', () => {
  // A regra de colisão usa effectiveZ, que é sempre zOrigin ou zDest.
  // Verificamos que em qualquer progresso, effectiveZ é um desses dois valores.
  const j = createJump(1, 4);
  for (let p = 0.0; p <= 1.0; p += 0.01) {
    const z = effectiveZ({ ...j, progress: p });
    assert.ok(
      z === 1 || z === 4,
      `z deveria ser zOrigin=1 ou zDest=4, mas é ${z} em progresso=${p.toFixed(2)}`,
    );
  }
  console.log('✓ colisão: effectiveZ ∈ {zOrigin, zDest} em todos os passos');
});

test('colisão — z nunca é um valor fraccionário ou intermédio', () => {
  const j = createJump(0, 5);
  for (let p = 0.0; p <= 1.0; p += 0.001) {
    const z = effectiveZ({ ...j, progress: p });
    assert.ok(Number.isInteger(z), `z=${z} não é inteiro em p=${p}`);
    assert.ok(z === 0 || z === 5, `z=${z} não é zOrigin=0 nem zDest=5 em p=${p}`);
  }
  console.log('✓ colisão: z SEMPRE inteiro e ∈ {zOrigin, zDest} (1001 passos)');
});

// ------------------------------------------------------------------ visualOffsetY nunca interfere no modelo

test('visualOffsetY é independente do modelo — não altera z', () => {
  // O visualOffsetY é uma função pura que não toca no estado do pulo.
  // Verificamos que chamá-la não muda o estado.
  const j = createJump(2, 5);
  const jBefore = { ...j };
  void visualOffsetY(0.5, 64);
  assert.deepEqual(j, jBefore, 'visualOffsetY não deve alterar o estado do pulo');
});

// ------------------------------------------------------------------ jumpHeight de 0

test('visualOffsetY com altura 0 é sempre 0', () => {
  for (let p = 0.0; p <= 1.0; p += 0.1) {
    const v = visualOffsetY(p, 0);
    assert.ok(v === 0 || Object.is(v, 0), `offset com altura 0 deve ser 0 em p=${p.toFixed(1)}, mas é ${v}`);
  }
});

// ------------------------------------------------------------------ negative jump (zDest < zOrigin)

test('effectiveZ em pulo para baixo respeita a mesma regra', () => {
  const j = createJump(7, 3);
  // progresso < 0.5: zOrigin = 7
  assert.equal(effectiveZ({ ...j, progress: 0.2 }), 7);
  // progresso ≥ 0.5: zDest = 3
  assert.equal(effectiveZ({ ...j, progress: 0.8 }), 3);

  // Invariante de inteiro para pulo para baixo
  for (let p = 0.0; p <= 1.0; p += 0.01) {
    assert.ok(Number.isInteger(effectiveZ({ ...j, progress: p })));
  }
  console.log('✓ pulo para baixo: invariante de inteiro mantido');
});
