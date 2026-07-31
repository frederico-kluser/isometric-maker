/**
 * Teste do módulo animate.ts com cliente falso.
 *
 * Verifica:
 *   1. animateCeiling devolve pior caso para template (8 gens) e v3 (320 gens).
 *   2. estimateAnimate devolve BudgetReport com requiresConfirmation.
 *   3. Primeira execução com mode='template' faz exactamente 1 chamada e
 *      devolve os 8 job IDs do fake.
 *   4. Segunda execução com os mesmos parâmetros faz ZERO chamadas
 *      (idempotência).
 *   5. mode='v3' inclui keep_first_frame e action_description.
 *
 * Execute com: npx tsx server/animate.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { PixelLabClient, type ApiResult } from '../../pixellab-pipeline/src/api.ts';
import { animateCharacter, animateCeiling, estimateAnimate, type AnimateInput } from './animate.ts';

// ------------------------------------------------------------------ fake

/** PNG 1×1 pixel válido em base64. */
const FAKE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** PNG com prefixo data URI (para ser extraída por extractImages). */
const FAKE_PNG_DATA_URI = `data:image/png;base64,${FAKE_PNG_B64}`;

class FakeClient extends PixelLabClient {
  callCount = 0;
  jobCallCount = 0;
  #fakeJobIds: string[];

  constructor(fakeJobIds?: string[]) {
    super('fake-token-for-test-only');
    this.#fakeJobIds = fakeJobIds ?? [
      'job-south-001', 'job-southwest-002', 'job-west-003', 'job-northwest-004',
      'job-north-005', 'job-northeast-006', 'job-east-007', 'job-southeast-008',
    ];
  }

  override async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    if (method === 'POST' && path === '/animate-character') {
      this.callCount += 1;

      // Verifica que directions está explícito com as 8.
      const b = body as Record<string, unknown> | undefined;
      if (b) {
        const dirs = b['directions'] as string[] | undefined;
        assert.ok(Array.isArray(dirs), 'directions deveria ser array');
        assert.equal(dirs!.length, 8, 'directions deveria ter 8 elementos');
      }

      const data: Record<string, unknown> = {};
      // Cada direcção gera um job.
      for (const id of this.#fakeJobIds) {
        data[id] = { background_job_id: id, status: 'completed' };
      }

      // Também inclui os job IDs como array para collectJobIds.
      data['jobs'] = this.#fakeJobIds.map((id) => ({ background_job_id: id }));

      return {
        data: data as T,
        status: 200,
        raw: JSON.stringify(data),
        usage: { type: 'usd', usd: 0.01433 * 8 },
      };
    }

    throw new Error(`FakeClient: chamada inesperada ${method} ${path}`);
  }

  /** Override job para devolver completed imediatamente, sem polling real. */
  override async job<T>(jobId: string): Promise<ApiResult<T>> {
    this.jobCallCount += 1;
    const jobData = {
      status: 'completed' as const,
      last_response: { image: FAKE_PNG_DATA_URI },
    };
    return {
      data: jobData as T,
      status: 200,
      raw: JSON.stringify(jobData),
    };
  }
}

// ------------------------------------------------------------------ helpers

function tmpDir(): string {
  const dir = join(tmpdir(), `animate-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function fakeTemplateInput(outputDir: string): AnimateInput {
  return {
    characterId: 'char-fake-001',
    seed: 42,
    imageSize: { width: 64, height: 64 },
    mode: 'template',
    templateAnimationId: 'walking-4-frames',
    outputDir,
  };
}

function fakeV3Input(outputDir: string): AnimateInput {
  return {
    characterId: 'char-fake-001',
    seed: 42,
    imageSize: { width: 64, height: 64 },
    mode: 'v3',
    actionDescription: 'running forward, arms swinging',
    frameCount: 4,
    keepFirstFrame: true,
    outputDir,
  };
}

// ------------------------------------------------------------------ ceiling

test('animateCeiling — template: 8 gerações, custo positivo', () => {
  const input = fakeTemplateInput('/tmp/irrelevante');
  const ceil = animateCeiling(input);
  assert.equal(ceil.maxGenerations, 8, 'template deveria ter 8 gerações (1/direcção)');
  assert.ok(ceil.maxCostUsd > 0, 'custo deveria ser positivo');
  assert.ok(ceil.label.includes('até 8 gerações'), 'label deve incluir "até 8 gerações"');
  assert.ok(ceil.label.includes('US$'), 'label deve incluir US$');
});

test('animateCeiling — v3: 320 gerações (pior caso)', () => {
  const input = fakeV3Input('/tmp/irrelevante');
  const ceil = animateCeiling(input);
  assert.equal(ceil.maxGenerations, 320, 'v3 deveria ter 320 gerações (40/direcção)');
  assert.ok(ceil.maxCostUsd > 0, 'custo deveria ser positivo');
  assert.ok(ceil.label.includes('até 320 gerações'), 'label deve incluir "até 320 gerações"');
});

// ------------------------------------------------------------------ estimate

test('estimateAnimate devolve BudgetReport com requiresConfirmation', () => {
  const input = fakeTemplateInput('/tmp/irrelevante');
  const report = estimateAnimate(input, 0, 0);
  assert.ok(report.estimate.point > 0, 'estimativa deveria ser positiva');
  assert.equal(report.requiresConfirmation, true, 'requiresConfirmation deve ser true');
  assert.ok(Array.isArray(report.avisos), 'avisos deve ser array');
});

// ------------------------------------------------------------------ execução template

test('primeira execução template — 1 chamada, 8 frames', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const input = fakeTemplateInput(dir);

    const result = await animateCharacter(client, input, { pollInitialMs: 0, pollSteadyMs: 0 });

    assert.equal(client.callCount, 1, 'deveria ter feito exactamente 1 chamada');
    const dirCount = Object.keys(result.frames).length;
    assert.ok(dirCount >= 1, `deveria ter pelo menos 1 direcção com frames, teve ${dirCount}`);
    console.log(`✓ template: ${client.callCount} chamada(s), ${dirCount} direcções com frames`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ idempotência

test('segunda execução com mesmos parâmetros — ZERO requisições (idempotência)', async () => {
  const dir = tmpDir();
  try {
    const input = fakeTemplateInput(dir);

    // Primeira execução: cria os frames.
    const client1 = new FakeClient();
    await animateCharacter(client1, input, { pollInitialMs: 0, pollSteadyMs: 0 });
    assert.equal(client1.callCount, 1, 'primeira execução deveria fazer 1 chamada');

    // Segunda execução: mesma config → ZERO chamadas.
    const client2 = new FakeClient();
    await animateCharacter(client2, input, { pollInitialMs: 0, pollSteadyMs: 0 });
    assert.equal(client2.callCount, 0, 'segunda execução deveria fazer 0 chamadas');

    console.log('✓ idempotência: 0 requisições na segunda execução');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ v3

test('mode v3 inclui keep_first_frame e action_description', async () => {
const dir = tmpDir();
try {
// Sobrescreve o FakeClient para inspeccionar o corpo.
const bodies: Record<string, unknown>[] = [];
class InspectClient extends PixelLabClient {
callCount = 0;
constructor() { super('fake-token'); }
override async request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
if (method === 'POST' && path === '/animate-character') {
this.callCount += 1;
if (body) bodies.push(body as Record<string, unknown>);
const data = {
jobs: [
{ background_job_id: 'job-001' }, { background_job_id: 'job-002' },
{ background_job_id: 'job-003' }, { background_job_id: 'job-004' },
{ background_job_id: 'job-005' }, { background_job_id: 'job-006' },
{ background_job_id: 'job-007' }, { background_job_id: 'job-008' },
],
};
return { data: data as T, status: 200, raw: JSON.stringify(data), usage: { type: 'usd', usd: 0.05 } };
}
throw new Error(`InspectClient: inesperada ${method} ${path}`);
}
override async job<T>(_jobId: string): Promise<ApiResult<T>> {
return {
data: { status: 'completed' as const, last_response: { image: FAKE_PNG_DATA_URI } } as T,
status: 200,
raw: JSON.stringify({ status: 'completed' }),
};
}
}

const client = new InspectClient();
const input = fakeV3Input(dir);
    await animateCharacter(client, input, { pollInitialMs: 0, pollSteadyMs: 0 });

    assert.equal(client.callCount, 1);
    const body = bodies[0];
    assert.ok(body, 'corpo da requisição deveria existir');
    assert.equal(body!['mode'], 'v3');
    assert.equal(body!['action_description'], 'running forward, arms swinging');
    assert.equal(body!['frame_count'], 4);
    assert.equal(body!['keep_first_frame'], true);
    assert.ok(Array.isArray(body!['directions']), 'directions deveria ser array');
    assert.equal((body!['directions'] as string[]).length, 8, 'directions deveria ter 8 elementos');

    console.log('✓ v3: keep_first_frame=true, action_description, frame_count=4, directions explícitas');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ directions explícitas

test('directions SEMPRE explícito com as 8 direcções', async () => {
  const dir = tmpDir();
  try {
    const bodies: Record<string, unknown>[] = [];
    class InspectClient extends PixelLabClient {
      constructor() { super('fake-token'); }
      override async request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
        if (method === 'POST' && path === '/animate-character') {
          if (body) bodies.push(body as Record<string, unknown>);
          const data = {
            jobs: Array.from({ length: 8 }, (_, i) => ({ background_job_id: `job-${i}` })),
          };
          return { data: data as T, status: 200, raw: JSON.stringify(data), usage: { type: 'usd', usd: 0.05 } };
        }
        throw new Error(`InspectClient: inesperada ${method} ${path}`);
      }
      override async job<T>(_jobId: string): Promise<ApiResult<T>> {
        return {
          data: { status: 'completed' as const, last_response: { image: FAKE_PNG_DATA_URI } } as T,
          status: 200,
          raw: JSON.stringify({ status: 'completed' }),
        };
      }
    }

    const client = new InspectClient();

    // Template
    await animateCharacter(client, fakeTemplateInput(join(dir, 'tpl')), { pollInitialMs: 0, pollSteadyMs: 0 });
    assert.equal((bodies[0]!['directions'] as string[]).length, 8);
    assert.deepEqual(bodies[0]!['directions'], [
      'south', 'south-west', 'west', 'north-west',
      'north', 'north-east', 'east', 'south-east',
    ]);

    // v3
    await animateCharacter(client, fakeV3Input(join(dir, 'v3')), { pollInitialMs: 0, pollSteadyMs: 0 });
    assert.equal((bodies[1]!['directions'] as string[]).length, 8);

    console.log('✓ directions explícitas em ambos os modos');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
