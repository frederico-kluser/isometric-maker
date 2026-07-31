/**
 * Teste de idempotência ponta a ponta do builder — F1-09.
 *
 * Verifica que a segunda execução com os mesmos parâmetros não gera
 * nenhuma requisição nova, medindo:
 *   1. Requisições por endpoint (rotate, 8-directions, animate).
 *   2. Linhas do ledger (não ganha linha nova na segunda passada).
 *   3. Comportamento com seed diferente — exige contagem > 0.
 *
 * ## Execução
 *
 * ```bash
 * cd tools/character-builder && npx tsx server/idempotence.test.ts
 * ```
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { PixelLabClient, type ApiResult } from '../../pixellab-pipeline/src/api.ts';
import { rotateCardinals, type RotateInput } from './rotate.ts';
import { animateCharacter, type AnimateInput } from './animate.ts';

// ------------------------------------------------------------------ fake

const FAKE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const FAKE_PNG_DATA_URI = `data:image/png;base64,${FAKE_PNG_B64}`;

/**
 * Cliente falso que conta requisições por endpoint.
 */
class CountingClient extends PixelLabClient {
  /** Contagem de chamadas por endpoint. */
  counts = new Map<string, number>();

  constructor() {
    super('fake-token-for-test-only');
  }

  private inc(endpoint: string): void {
    this.counts.set(endpoint, (this.counts.get(endpoint) ?? 0) + 1);
  }

  override async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    this.inc(path);

    if (path === '/rotate') {
      return {
        data: { image: FAKE_PNG_DATA_URI } as T,
        status: 200,
        raw: JSON.stringify({ image: FAKE_PNG_DATA_URI }),
        usage: { type: 'usd', usd: 0.0106 },
      };
    }

    if (path === '/create-character-with-8-directions') {
      const jobId = `job-8dir-${randomBytes(4).toString('hex')}`;
      return {
        data: {
          background_job_id: jobId,
          character_id: `char-${randomBytes(4).toString('hex')}`,
        } as T,
        status: 200,
        raw: JSON.stringify({ background_job_id: jobId }),
        usage: { type: 'usd', usd: 0.05 },
      };
    }

    if (path === '/animate-character') {
      const jobIds = [
        'job-south-001', 'job-sw-002', 'job-west-003', 'job-nw-004',
        'job-north-005', 'job-ne-006', 'job-east-007', 'job-se-008',
      ];
      return {
        data: { jobs: jobIds.map((id) => ({ background_job_id: id })) } as T,
        status: 200,
        raw: JSON.stringify({ jobs: jobIds }),
        usage: { type: 'usd', usd: 0.05 },
      };
    }

    throw new Error(`CountingClient: endpoint inesperado ${path}`);
  }

  override async job<T>(jobId: string): Promise<ApiResult<T>> {
    this.inc(`job:${jobId}`);
    return {
      data: {
        status: 'completed' as const,
        last_response: { image: FAKE_PNG_DATA_URI },
      } as T,
      status: 200,
      raw: JSON.stringify({ status: 'completed' }),
    };
  }
}

// ------------------------------------------------------------------ helpers

function tmpDir(): string {
  const dir = join(tmpdir(), `idempotence-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function fakeRotateInput(outputDir: string, seed: number): RotateInput {
  return {
    fromImage: FAKE_PNG_B64,
    seed,
    imageSize: { width: 64, height: 64 },
    isometric: false,
    outputDir,
  };
}

function fakeAnimateInput(outputDir: string, seed: number): AnimateInput {
  return {
    characterId: `char-fake-${seed}`,
    seed,
    imageSize: { width: 64, height: 64 },
    mode: 'template',
    templateAnimationId: 'walking-4-frames',
    outputDir,
  };
}

// ------------------------------------------------------------------ rotate

test('rotate — primeira execução faz 3 chamadas, segunda 0', async () => {
  const dir = tmpDir();
  try {
    const input = fakeRotateInput(dir, 42);

    // Primeira execução
    const client1 = new CountingClient();
    await rotateCardinals(client1, input);
    const rotateCalls1 = client1.counts.get('/rotate') ?? 0;
    assert.equal(rotateCalls1, 3, `primeira execução deveria fazer 3 chamadas /rotate, fez ${rotateCalls1}`);
    console.log(`  rotate 1ª execução: ${rotateCalls1} chamadas /rotate`);

    // Segunda execução — mesmos parâmetros
    const client2 = new CountingClient();
    await rotateCardinals(client2, input);
    const rotateCalls2 = client2.counts.get('/rotate') ?? 0;
    assert.equal(rotateCalls2, 0, `segunda execução deveria fazer 0 chamadas /rotate, fez ${rotateCalls2}`);
    console.log(`  rotate 2ª execução: ${rotateCalls2} chamadas /rotate`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ rotate com seed diferente

test('rotate — seed diferente gera novas chamadas', async () => {
  const dir = tmpDir();
  try {
    const input1 = fakeRotateInput(dir, 42);
    const input2 = fakeRotateInput(dir, 99);

    // Primeira execução com seed 42
    const client1 = new CountingClient();
    await rotateCardinals(client1, input1);
    const calls1 = client1.counts.get('/rotate') ?? 0;
    assert.equal(calls1, 3, `primeira execução (seed=42) deveria fazer 3 chamadas, fez ${calls1}`);

    // Segunda execução com seed diferente → deve gerar novas chamadas
    const client2 = new CountingClient();
    await rotateCardinals(client2, input2);
    const calls2 = client2.counts.get('/rotate') ?? 0;
    assert.ok(calls2 > 0, `segunda execução (seed=99) deveria fazer > 0 chamadas, fez ${calls2}`);
    console.log(`  rotate seed diferente: seed=42 → ${calls1} chamadas, seed=99 → ${calls2} chamadas`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ animate

test('animate — primeira execução faz 1 chamada, segunda 0', async () => {
  const dir = tmpDir();
  try {
    const input = fakeAnimateInput(dir, 42);

    // Primeira execução
    const client1 = new CountingClient();
    await animateCharacter(client1, input, { pollInitialMs: 0, pollSteadyMs: 0 });
    const animCalls1 = client1.counts.get('/animate-character') ?? 0;
    assert.equal(animCalls1, 1, `primeira execução deveria fazer 1 chamada /animate-character, fez ${animCalls1}`);
    console.log(`  animate 1ª execução: ${animCalls1} chamada(s) /animate-character`);

    // Segunda execução — mesmos parâmetros
    const client2 = new CountingClient();
    await animateCharacter(client2, input, { pollInitialMs: 0, pollSteadyMs: 0 });
    const animCalls2 = client2.counts.get('/animate-character') ?? 0;
    assert.equal(animCalls2, 0, `segunda execução deveria fazer 0 chamadas /animate-character, fez ${animCalls2}`);
    console.log(`  animate 2ª execução: ${animCalls2} chamada(s) /animate-character`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ animate com seed diferente

test('animate — seed diferente gera novas chamadas', async () => {
  const dir = tmpDir();
  try {
    const input1 = fakeAnimateInput(dir, 42);
    const input2 = fakeAnimateInput(dir, 99);

    const client1 = new CountingClient();
    await animateCharacter(client1, input1, { pollInitialMs: 0, pollSteadyMs: 0 });
    const calls1 = client1.counts.get('/animate-character') ?? 0;
    assert.equal(calls1, 1);

    const client2 = new CountingClient();
    await animateCharacter(client2, input2, { pollInitialMs: 0, pollSteadyMs: 0 });
    const calls2 = client2.counts.get('/animate-character') ?? 0;
    assert.ok(calls2 > 0, `segunda execução (seed diferente) deveria fazer > 0 chamadas, fez ${calls2}`);
    console.log(`  animate seed diferente: seed=42 → ${calls1}, seed=99 → ${calls2}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ ledger

test('ledger — segunda execução não adiciona linhas', async () => {
  const dir = tmpDir();
  const ledgerPath = join(dir, 'ledger.ndjson');
  try {
    const input = fakeRotateInput(dir, 42);

    // Primeira execução com ledger
    const client1 = new CountingClient();
    await rotateCardinals(client1, input, { ledgerPath });
    const lines1 = existsSync(ledgerPath)
      ? readFileSync(ledgerPath, 'utf-8').trim().split('\n').filter(Boolean).length
      : 0;
    assert.ok(lines1 > 0, `primeira execução deveria escrever linhas no ledger, tem ${lines1}`);
    console.log(`  ledger 1ª execução: ${lines1} linha(s)`);

    // Segunda execução — mesmos parâmetros
    const client2 = new CountingClient();
    await rotateCardinals(client2, input, { ledgerPath });
    const lines2 = existsSync(ledgerPath)
      ? readFileSync(ledgerPath, 'utf-8').trim().split('\n').filter(Boolean).length
      : 0;
    assert.equal(lines2, lines1, `segunda execução não deveria adicionar linhas no ledger: ${lines1} → ${lines2}`);
    console.log(`  ledger 2ª execução: ${lines2} linha(s) (mesmo que antes)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ contagem total

test('contagem total — segunda execução zera todas as contagens', async () => {
  const dir = tmpDir();
  try {
    const input = fakeRotateInput(dir, 42);

    const client1 = new CountingClient();
    await rotateCardinals(client1, input);

    const total1 = [...client1.counts.values()].reduce((a, b) => a + b, 0);
    assert.ok(total1 > 0, `primeira execução deveria ter requisições > 0, total=${total1}`);

    const client2 = new CountingClient();
    await rotateCardinals(client2, input);

    // Verifica que NENHUM endpoint foi chamado na segunda execução
    const rotateAfter = client2.counts.get('/rotate') ?? 0;
    const total2 = [...client2.counts.values()].reduce((a, b) => a + b, 0);
    assert.equal(total2, 0, `segunda execução deveria ter 0 requisições, total=${total2} (rotate=${rotateAfter})`);

    console.log(`  contagem total: 1ª=${total1}, 2ª=${total2}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
