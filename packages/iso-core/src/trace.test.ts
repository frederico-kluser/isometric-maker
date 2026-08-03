/**
 * Teste headless de traço de entrada — F3-05.
 *
 * Verifica que uma sequência de entradas executada contra o motor de
 * movimento + colisão produz resultados determinísticos e previsíveis.
 *
 * ## Cobertura (8 testes)
 *
 * 1. Traço simples: caminhar para leste sobre chão plano (z=1).
 * 2. Traço com step-up: subir um degrau de altura 1, parar no topo.
 * 3. Traço com step-up duplo: subir dois degraus, parar no topo.
 * 4. Traço bloqueado: tentar atravessar a quina com duas paredes.
 * 5. Traço com pulo: saltar e aterrissar.
 * 6. Traço de navegação mista: caminhar + desviar de parede.
 * 7. Determinismo: executar o mesmo traço duas vezes → mesmo resultado.
 * 8. Determinismo com bloqueio: traço bloqueado para no mesmo ponto.
 *
 * ## Execução
 *
 * ```bash
 * cd packages/iso-core && node --test src/trace.test.ts
 * ```
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlockStore, EdgeStore, type EdgeSide } from './map.ts';
import type { CollisionMap } from './collision.ts';
import {
  runTrace,
  dirInput,
  jumpInput,
  stepUpInput,
  type TraceFrame,
} from './trace.ts';

// ------------------------------------------------------------------ helpers

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Fixture {
  readonly descricao: string;
  readonly mapa: {
    readonly blocks: Record<string, readonly { block: string; count: number }[]>;
    readonly edges: readonly {
      x: number;
      y: number;
      z: number;
      lado: string;
      tipo: string;
    }[];
  };
}

function loadFixture(name: string): Fixture {
  const raw = readFileSync(join(__dirname, '..', 'test-fixtures', name), 'utf-8');
  return JSON.parse(raw) as Fixture;
}

function collisionMap(blocks: BlockStore, edges: EdgeStore): CollisionMap {
  return {
    hasBlock(x: number, y: number, z: number): boolean {
      const b = blocks.getBlock(x, y, z);
      return b !== undefined && b !== '';
    },
    hasEdge(x: number, y: number, z: number, lado: EdgeSide): boolean {
      return edges.getEdge(x, y, z, lado) !== undefined;
    },
  };
}

function cellOf(state: { pos: { x: number; y: number }; z: number }): { x: number; y: number; z: number } {
  return {
    x: Math.floor(state.pos.x),
    y: Math.floor(state.pos.y),
    z: state.z,
  };
}

// ------------------------------------------------------------------ setup

const fixture = loadFixture('mapa-degraus.json');
const blocks = BlockStore.fromRle(fixture.mapa.blocks);
const edges = EdgeStore.fromEntries(
  fixture.mapa.edges.map((e) => ({ ...e, lado: e.lado as EdgeSide })),
);
const map = collisionMap(blocks, edges);

// ------------------------------------------------------------------ Traço 1: caminhar para leste sobre chão plano

test('traço 1 — caminhar para leste sobre chão plano', () => {
  // Linha y=2: todas as colunas têm 1 bloco (z=0), z=1 é transitável.
  const frames: TraceFrame[] = [
    { duration: 0.8, input: dirInput(1, 0) },
  ];

  const result = runTrace(map, 0.5, 2.5, 1, frames);

  const cell = cellOf(result.finalState);
  console.log(`  traço 1 final: cell=(${cell.x},${cell.y},${cell.z}) pos=(${result.finalState.pos.x.toFixed(4)},${result.finalState.pos.y.toFixed(4)}) steps=${result.totalSteps} blocked=${result.blocked}`);

  assert.ok(result.totalSteps > 10, `deveria ter executado >10 passos, teve ${result.totalSteps}`);
  assert.ok(result.finalState.pos.x > 2.5, `deveria ter andado para leste, x=${result.finalState.pos.x.toFixed(2)}`);
  assert.ok(Math.abs(result.finalState.pos.y - 2.5) < 0.01, 'y não deveria mudar');
  assert.equal(result.finalState.z, 1, 'z deveria manter-se');
  assert.equal(result.blocked, false, 'não deveria estar bloqueado');

  // Coordenada final exacta (determinística)
  // speed=4, fixedDt=1/60, 0.8s → 48 passos → 48*4/60 = 3.2 unidades → x=3.7
  assert.ok(Math.abs(result.finalState.pos.x - 3.7) < 0.1, `x esperado ≈3.7, obtido ${result.finalState.pos.x.toFixed(4)}`);
});

// ------------------------------------------------------------------ Traço 2: subir um degrau (altura 1)

test('traço 2 — subir um degrau de altura 1', () => {
  // Começa em (0.5, 0.5, z=1) sobre (0,0,z=0).
  // (1,0) tem 2 blocos (z=0,1). stepUp sobe para z=2.
  // O personagem sobe e entra em (1,0,z=2).
  // Com stepUp contínuo, pode subir também para z=3 ao aproximar-se de (2,0).
  const frames: TraceFrame[] = [
    { duration: 0.25, input: stepUpInput(1, 0) },
  ];

  const result = runTrace(map, 0.5, 0.5, 1, frames);

  const cell = cellOf(result.finalState);
  console.log(`  traço 2 final: cell=(${cell.x},${cell.y},${cell.z}) pos=(${result.finalState.pos.x.toFixed(4)},${result.finalState.pos.y.toFixed(4)}) steps=${result.totalSteps} blocked=${result.blocked}`);

  assert.ok(result.finalState.pos.x > 0.9, `deveria ter andado para leste, x=${result.finalState.pos.x.toFixed(2)}`);
  // Pelo menos subiu 1 nível (de z=1 para z>=2)
  assert.ok(result.finalState.z >= 2, `z deveria ser >= 2 após step-up, mas é ${result.finalState.z}`);
  assert.equal(result.blocked, false, 'não deveria estar bloqueado');
  // Deve estar na célula (1,0) ou ainda na (0,0)
  assert.ok(cell.x >= 0 && cell.x <= 1, `célula x deveria ser 0 ou 1, é ${cell.x}`);
});

// ------------------------------------------------------------------ Traço 3: subir dois degraus (altura 2)

test('traço 3 — subir dois degraus', () => {
  // Começa em (1.5, 0.5, z=2) — já sobre (1,0,z=1).
  // (2,0) tem 3 blocos (z=0,1,2). stepUp sobe para z=3.
  // Duração curta: 0.25s → move 1.0 unidade → x≈2.5 (célula 2,0).
  const frames: TraceFrame[] = [
    { duration: 0.25, input: stepUpInput(1, 0) },
  ];

  const result = runTrace(map, 1.5, 0.5, 2, frames);

  const cell = cellOf(result.finalState);
  console.log(`  traço 3 final: cell=(${cell.x},${cell.y},${cell.z}) pos=(${result.finalState.pos.x.toFixed(4)},${result.finalState.pos.y.toFixed(4)}) steps=${result.totalSteps} blocked=${result.blocked}`);

  assert.equal(result.finalState.z, 3, `z deveria ser 3 após step-up duplo, mas é ${result.finalState.z}`);
  assert.equal(result.blocked, false, 'não deveria estar bloqueado');
  assert.equal(cell.x, 2, `célula x deveria ser 2, é ${cell.x}`);
});

// ------------------------------------------------------------------ Traço 4: bloqueado por parede

test('traço 4 — bloqueado na quina com parede', () => {
  // A parede N em (1,1,z=1) bloqueia o movimento de (1,1) para (1,2).
  // Começamos em (1.5, 1.5, z=1) — dentro de (1,1) — e vamos para norte.
  //
  // Nota: o início histórico era (1.5, 0.5, 1), dentro da coluna de 2 blocos
  // em (1,0) — invisível para o teste de ponto antigo (só o destino contava),
  // mas com a colisão por caixa o corpo nasce embutido no sólido e a varredura
  // bloqueia no primeiro passo. O estado inicial passou a ser válido; a
  // pergunta do teste — a parede da quina bloqueia — não mudou.
  const frames: TraceFrame[] = [
    { duration: 0.8, input: dirInput(0, 1) },
  ];

  const result = runTrace(map, 1.5, 1.5, 1, frames);

  const cell = cellOf(result.finalState);
  console.log(`  traço 4 final: cell=(${cell.x},${cell.y},${cell.z}) pos=(${result.finalState.pos.x.toFixed(4)},${result.finalState.pos.y.toFixed(4)}) blocked=${result.blocked} blockedAt=${result.blockedAt ? `(${result.blockedAt.x},${result.blockedAt.y},${result.blockedAt.z})` : 'nenhum'}`);

  assert.equal(result.blocked, true, 'deveria estar bloqueado pela parede');
  assert.ok(result.blockedAt, 'deveria ter blockedAt definido');
  if (result.blockedAt) {
    assert.equal(result.blockedAt.x, 1, `blockedAt.x deveria ser 1, é ${result.blockedAt.x}`);
    assert.equal(result.blockedAt.y, 1, `blockedAt.y deveria ser 1, é ${result.blockedAt.y}`);
    assert.equal(result.blockedAt.z, 1, `blockedAt.z deveria ser 1, é ${result.blockedAt.z}`);
  }
});

// ------------------------------------------------------------------ Traço 5: pular

test('traço 5 — pular', () => {
  // Começa em (0.5, 0.5, z=1). Pula para leste.
  // O pulo vai para z=2. Durante o pulo, o personagem sobrevoa (1,0,z=1) que tem bloco.
  // Após o pulo, aterrissa em z=2. Se continuar movendo, pode ser bloqueado
  // por falta de step-up. O importante é que o pulo alterou o z.
  const frames: TraceFrame[] = [
    { duration: 0.55, input: jumpInput(1, 0) },
  ];

  const result = runTrace(map, 0.5, 0.5, 1, frames);

  const cell = cellOf(result.finalState);
  console.log(`  traço 5 final: cell=(${cell.x},${cell.y},${cell.z}) pos=(${result.finalState.pos.x.toFixed(4)},${result.finalState.pos.y.toFixed(4)}) steps=${result.totalSteps} blocked=${result.blocked}`);

  // O pulo deve ter alterado o z para 2
  assert.equal(result.finalState.z, 2, `z deveria ser 2 após o pulo, mas é ${result.finalState.z}`);
  // Deve ter-se movido para leste durante o pulo
  assert.ok(result.finalState.pos.x > 1.0, `deveria ter-se movido para leste, x=${result.finalState.pos.x.toFixed(2)}`);
  // Nota: pode ficar bloqueado após o pulo se não houver step-up para o próximo obstáculo.
  // Isso é comportamento esperado do motor.
});

// ------------------------------------------------------------------ Traço 6: navegação mista

test('traço 6 — navegação mista com desvio', () => {
  // Começa em (0.5, 2.5, z=1), vai para leste, depois sul, depois oeste.
  // Rota por y=2 evita a coluna (1,0) com degrau.
  const frames: TraceFrame[] = [
    { duration: 0.8, input: dirInput(1, 0) },
    { duration: 0.8, input: dirInput(0, -1) },
    { duration: 0.8, input: dirInput(-1, 0) },
  ];

  const result = runTrace(map, 0.5, 2.5, 1, frames);

  const cell = cellOf(result.finalState);
  console.log(`  traço 6 final: cell=(${cell.x},${cell.y},${cell.z}) pos=(${result.finalState.pos.x.toFixed(4)},${result.finalState.pos.y.toFixed(4)}) steps=${result.totalSteps} blocked=${result.blocked}`);

  const dist = Math.sqrt(
    (result.finalState.pos.x - 0.5) ** 2 + (result.finalState.pos.y - 2.5) ** 2,
  );
  assert.ok(dist > 1.0, `deveria ter andado mais de 1 unidade, andou ${dist.toFixed(2)}`);
  assert.ok(result.totalSteps > 10, `deveria ter executado >10 passos, teve ${result.totalSteps}`);
  // Pode ficar bloqueado após o movimento, dependendo da rota
});

// ------------------------------------------------------------------ Determinismo

test('determinismo — mesma entrada, mesmo resultado', () => {
  const frames: TraceFrame[] = [
    { duration: 0.5, input: dirInput(1, 0) },
    { duration: 0.3, input: dirInput(0, 1) },
    { duration: 0.2, input: dirInput(-1, 0) },
    { duration: 0.4, input: dirInput(0, -1) },
    { duration: 0.3, input: jumpInput(1, 0) },
  ];

  const r1 = runTrace(map, 1.5, 2.5, 1, frames);
  const r2 = runTrace(map, 1.5, 2.5, 1, frames);

  assert.equal(r1.totalSteps, r2.totalSteps, 'totalSteps deveria ser igual');
  assert.equal(r1.totalTime, r2.totalTime, 'totalTime deveria ser igual');
  assert.equal(r1.blocked, r2.blocked, 'blocked deveria ser igual');
  assert.equal(r1.finalState.pos.x, r2.finalState.pos.x, 'pos.x deveria ser igual');
  assert.equal(r1.finalState.pos.y, r2.finalState.pos.y, 'pos.y deveria ser igual');
  assert.equal(r1.finalState.z, r2.finalState.z, 'z deveria ser igual');

  assert.ok(Number.isFinite(r1.finalState.pos.x), 'pos.x deve ser finito');
  assert.ok(Number.isFinite(r1.finalState.pos.y), 'pos.y deve ser finito');
  assert.ok(Number.isInteger(r1.finalState.z), 'z deve ser inteiro');

  console.log(`  determinismo: ${r1.totalSteps} passos, pos=(${r1.finalState.pos.x.toFixed(4)},${r1.finalState.pos.y.toFixed(4)},${r1.finalState.z})`);
});

// ------------------------------------------------------------------ Determinismo com bloqueio

test('determinismo — traço bloqueado tem mesmo ponto de paragem', () => {
  const frames: TraceFrame[] = [
    { duration: 0.8, input: dirInput(0, 1) },
  ];

  const r1 = runTrace(map, 1.5, 1.5, 1, frames);
  const r2 = runTrace(map, 1.5, 1.5, 1, frames);

  assert.equal(r1.blocked, r2.blocked, 'blocked deveria ser igual');
  assert.equal(r1.blocked, true, 'deveria estar bloqueado');
  if (r1.blockedAt && r2.blockedAt) {
    assert.equal(r1.blockedAt.x, r2.blockedAt.x, 'blockedAt.x deveria ser igual');
    assert.equal(r1.blockedAt.y, r2.blockedAt.y, 'blockedAt.y deveria ser igual');
    assert.equal(r1.blockedAt.z, r2.blockedAt.z, 'blockedAt.z deveria ser igual');
  }

  console.log(`  determinismo bloqueado: blockedAt=(${r1.blockedAt?.x},${r1.blockedAt?.y},${r1.blockedAt?.z})`);
});
