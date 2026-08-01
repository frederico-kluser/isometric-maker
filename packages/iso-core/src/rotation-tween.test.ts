/**
 * Teste da rotação contínua da câmera.
 *
 * A propriedade que tudo depende: **nos inteiros, a rotação contínua tem de dar
 * exatamente o mesmo que a discreta**. Se divergirem, o giro termina numa pose
 * que não é a vista de destino, e o mapa fica meio grau torto para sempre —
 * um erro que só aparece depois de girar, e que ninguém liga ao tween.
 *
 * Execute com: node --test src/rotation-tween.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROTATIONS, rotatePoint, rotatedDepthKey, type Rotation } from './rotation.ts';
import {
  ROTATION_DURATION_MS,
  continuousDepthKey,
  easeInOutCubic,
  facingBlend,
  rotatePointContinuous,
  sampleTween,
  shortestTurn,
  startTween,
} from './rotation-tween.ts';

// ------------------------------------------------------------------ suavização

test('a suavização vai de 0 a 1, é monótona e simétrica no meio', () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  assert.equal(easeInOutCubic(0.5), 0.5);
  let anterior = -1;
  for (let i = 0; i <= 100; i += 1) {
    const v = easeInOutCubic(i / 100);
    assert.ok(v >= anterior, `não monótona em ${i / 100}`);
    anterior = v;
  }
  // Simetria: f(t) + f(1−t) = 1.
  for (const t of [0.1, 0.25, 0.4, 0.73]) {
    assert.ok(Math.abs(easeInOutCubic(t) + easeInOutCubic(1 - t) - 1) < 1e-12);
  }
});

test('a suavização recorta fora de 0–1 — quadro atrasado não passa do destino', () => {
  assert.equal(easeInOutCubic(-3), 0);
  assert.equal(easeInOutCubic(4.2), 1);
});

// ------------------------------------------------------------------ caminho curto

test('o giro escolhe sempre o caminho curto', () => {
  assert.equal(shortestTurn(0, 1), 1);
  assert.equal(shortestTurn(3, 0), 1, 'de 3 para 0 é +1, não −3');
  assert.equal(shortestTurn(0, 3), -1, 'de 0 para 3 é −1');
  assert.equal(shortestTurn(1, 0), -1);
  assert.equal(shortestTurn(2, 2), 0);
});

test('meia-volta desempata pelo horário, de forma determinística', () => {
  for (const r of ROTATIONS) {
    const oposta = ((r + 2) % 4) as Rotation;
    assert.equal(shortestTurn(r, oposta), 2, `de ${r} para ${oposta}`);
  }
});

// ------------------------------------------------------------------ concordância

test('a rotação contínua concorda EXATAMENTE com a discreta nos inteiros', () => {
  for (let x = -4; x <= 4; x += 1) {
    for (let y = -4; y <= 4; y += 1) {
      for (const r of ROTATIONS) {
        const d = rotatePoint(x, y, r);
        const c = rotatePointContinuous(x, y, r);
        assert.ok(Math.abs(c.x - d.x) < 1e-9, `x em (${x},${y}) vista ${r}: ${c.x} ≠ ${d.x}`);
        assert.ok(Math.abs(c.y - d.y) < 1e-9, `y em (${x},${y}) vista ${r}: ${c.y} ≠ ${d.y}`);
      }
    }
  }
});

test('a chave de profundidade contínua concorda com a discreta nos inteiros', () => {
  for (let x = -3; x <= 3; x += 1) {
    for (let y = -3; y <= 3; y += 1) {
      for (const z of [0, 1, 4]) {
        for (const r of ROTATIONS) {
          const a = rotatedDepthKey({ x, y, z }, r);
          const b = continuousDepthKey({ x, y, z }, r);
          assert.ok(Math.abs(a - b) < 1e-9, `(${x},${y},${z}) vista ${r}`);
        }
      }
    }
  }
});

test('a rotação contínua preserva a distância à origem', () => {
  for (const turn of [0, 0.13, 0.5, 1.7, 2.25, -0.4]) {
    const r = rotatePointContinuous(3, 4, turn);
    assert.ok(Math.abs(Math.hypot(r.x, r.y) - 5) < 1e-9, `turn ${turn}`);
  }
});

test('nada de zero negativo — a comparação de célula depende disso', () => {
  const r = rotatePointContinuous(0, 0, 1);
  assert.ok(Object.is(r.x, 0), 'x é +0');
  assert.ok(Object.is(r.y, 0), 'y é +0');
});

// ------------------------------------------------------------------ o tween

test('o giro começa na vista de origem e TERMINA na de destino', () => {
  const tween = startTween(0, 1, 1000);
  const inicio = sampleTween(tween, 1000);
  assert.equal(inicio.turn, 0);
  assert.equal(inicio.t, 0);
  assert.equal(inicio.done, false);

  const fim = sampleTween(tween, 1000 + ROTATION_DURATION_MS);
  assert.equal(fim.turn, 1);
  assert.equal(fim.t, 1);
  assert.equal(fim.done, true);
});

test('depois do fim o giro continua parado no destino, não segue girando', () => {
  const tween = startTween(2, 3, 0);
  const muito = sampleTween(tween, 10_000);
  assert.equal(muito.turn, 3);
  assert.equal(muito.done, true);
});

test('de 3 para 0 o giro passa por 3,5 — e não volta por 2, 1', () => {
  const tween = startTween(3, 0, 0);
  const meio = sampleTween(tween, ROTATION_DURATION_MS / 2);
  assert.equal(meio.turn, 3.5);
  const fim = sampleTween(tween, ROTATION_DURATION_MS);
  assert.equal(fim.turn, 4, 'termina em 4, que é a vista 0 sem normalizar');
});

test('girar para a mesma vista termina imediatamente', () => {
  const s = sampleTween(startTween(1, 1, 0), 0);
  assert.equal(s.turn, 1);
  assert.equal(s.done, true);
  assert.equal(s.t, 1);
});

test('duração zero termina no primeiro quadro — é como se desliga a animação', () => {
  const s = sampleTween(startTween(0, 2, 0, 0), 0);
  assert.equal(s.done, true);
  assert.equal(s.turn, 2);
});

test('o progresso é monótono ao longo do giro', () => {
  const tween = startTween(0, 1, 0);
  let anterior = -1;
  for (let ms = 0; ms <= ROTATION_DURATION_MS; ms += 8) {
    const s = sampleTween(tween, ms);
    assert.ok(s.turn >= anterior, `retrocedeu em ${ms} ms`);
    anterior = s.turn;
  }
});

// ------------------------------------------------------------------ cross-fade

test('o cross-fade nomeia as duas vistas e usa o progresso suavizado', () => {
  const tween = startTween(3, 0, 0);
  const meio = sampleTween(tween, ROTATION_DURATION_MS / 2);
  const b = facingBlend(tween, meio);
  assert.equal(b.fromRotation, 3);
  assert.equal(b.toRotation, 0);
  assert.equal(b.alpha, 0.5);

  const fim = facingBlend(tween, sampleTween(tween, ROTATION_DURATION_MS));
  assert.equal(fim.alpha, 1, 'no fim só a vista de destino aparece');
});
