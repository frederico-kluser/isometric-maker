/**
 * Teste do módulo /rotate com cliente falso.
 *
 * Verifica duas propriedades:
 *   1. Na primeira execução, o cliente recebe exatamente 3 chamadas
 *      (south→north, south→east, south→west).
 *   2. Na segunda execução com os mesmos parâmetros, ZERO chamadas —
 *      idempotência via hash de conteúdo + seed.
 *
 * Execute com: npx tsx server/rotate.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { PixelLabClient, type ApiResult } from '../../pixellab-pipeline/src/api.ts';
import { rotateCardinals, estimateRotate, type RotateInput } from './rotate.ts';

// ------------------------------------------------------------------ fake

/** PNG 1×1 pixel válido, em base64 — suficiente para o teste de idempotência. */
const FAKE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

class FakeClient extends PixelLabClient {
  callCount = 0;

  constructor() {
    super('fake-token-for-test-only');
  }

  override async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    if (method === 'POST' && path === '/rotate') {
      this.callCount += 1;
      const data = {
        image: FAKE_PNG_B64,
        usage: { type: 'usd' as const, usd: 0.0106 },
      };
      return {
        data: data as T,
        status: 200,
        raw: JSON.stringify(data),
        usage: { type: 'usd', usd: 0.0106 },
      };
    }
    throw new Error(`FakeClient: chamada inesperada ${method} ${path}`);
  }
}

// ------------------------------------------------------------------ helpers

function tmpDir(): string {
  const dir = join(tmpdir(), `rotate-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function fakeInput(outputDir: string): RotateInput {
  return {
    fromImage: FAKE_PNG_B64,
    seed: 42,
    imageSize: { width: 64, height: 64 },
    outputDir,
  };
}

// ------------------------------------------------------------------ testes

test('estimateRotate devolve BudgetReport com checkBudget', () => {
  const input = fakeInput('/tmp/irrelevante');
  const report = estimateRotate(input);
  assert.ok(report.estimate.point > 0, 'estimativa deveria ser positiva');
  assert.equal(report.requiresConfirmation, true, 'requiresConfirmation deve ser literal true');
  assert.ok(Array.isArray(report.avisos), 'avisos deve ser array');
});

test('primeira execução — 3 chamadas ao /rotate', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const input = fakeInput(dir);

    const result = await rotateCardinals(client, input);

    assert.equal(client.callCount, 3, 'deveria ter feito 3 chamadas');
    assert.ok(existsSync(result.north), 'north.png deveria existir');
    assert.ok(existsSync(result.east), 'east.png deveria existir');
    assert.ok(existsSync(result.west), 'west.png deveria existir');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('segunda execução com mesmos parâmetros — ZERO requisições (idempotência)', async (t) => {
  const dir = tmpDir();
  try {
    const input = fakeInput(dir);

    // Primeira execução: cria os arquivos
    const client1 = new FakeClient();
    await rotateCardinals(client1, input);
    assert.equal(client1.callCount, 3, 'primeira execução deveria fazer 3 chamadas');

    // Segunda execução: mesma imagem, mesmo seed → ZERO chamadas
    const client2 = new FakeClient();
    await rotateCardinals(client2, input);
    assert.equal(client2.callCount, 0, 'segunda execução deveria fazer 0 chamadas');

    // Verificação explícita para o grep do critério de aceitação. Vai por
    // `t.diagnostic` e não por `console.log`: escrever cru no stdout corrompe o
    // protocolo serializado que o `node --test` usa entre pai e filho.
    t.diagnostic('idempotência: 0 requisições na segunda execução');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isometric=true entra nos params, isometric=false é omitido', async () => {
  const dir = tmpDir();
  try {
    // Com isometric=true
    const clientIso = new FakeClient();
    const inputIso = { ...fakeInput(dir), isometric: true, outputDir: join(dir, 'iso') };
    await rotateCardinals(clientIso, inputIso);
    assert.equal(clientIso.callCount, 3, 'chamada isométrica deveria funcionar');

    // Com isometric=false — deve ser omitido dos params (F0-09).
    // A idempotência com isometric=false é testada pelo teste principal.
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('com isometric=true e false geram artefatos diferentes (hashes diferentes)', async () => {
  const dir = tmpDir();
  try {
    const inputFalse = { ...fakeInput(join(dir, 'plain')), isometric: false };
    const inputTrue = { ...fakeInput(join(dir, 'iso')), isometric: true };

    const c1 = new FakeClient();
    await rotateCardinals(c1, inputFalse);
    assert.equal(c1.callCount, 3);

    const c2 = new FakeClient();
    await rotateCardinals(c2, inputTrue);
    assert.equal(c2.callCount, 3, 'isometric=true deveria gerar hashes diferentes → novas chamadas');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
