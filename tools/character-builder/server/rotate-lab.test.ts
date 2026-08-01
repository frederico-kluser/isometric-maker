/**
 * Teste do laboratório de rotação com cliente falso.
 *
 * Propriedades verificadas (sem rede):
 *   1. Validação ANTES de gastar: XOR from/to vs directionChange, faixas do
 *      spec (16–200, −90..90, −180..180, 1..999), init_strength exige imagem —
 *      tudo com erro nomeado e ZERO chamadas à API.
 *   2. Idempotência por hash: segunda execução com o mesmo input não chama a
 *      API; data URI e b64 puro da mesma imagem colidem.
 *   3. PNG gravado em disco no retorno (chamada síncrona: depois da cobrança,
 *      gravar é a primeira coisa a fazer).
 *   4. Ledger ndjson escrito com usage cru — e não reescrito num hit de cache.
 *   5. Erro claro quando a resposta não traz o campo "image".
 *   6. isometric entra no request só quando true (F0-09).
 *
 * Execute com: node --test server/rotate-lab.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { PixelLabClient, type ApiResult } from '../../pixellab-pipeline/src/api.ts';
import {
  runRotateLab,
  RotateLabValidationError,
  type RotateLabErrorCode,
  type RotateLabInput,
} from './rotate-lab.ts';

// ------------------------------------------------------------------ fake

/** PNG 1×1 pixel válido, em base64 — mesmo do rotate.test.ts. */
const FAKE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

class FakeClient extends PixelLabClient {
  callCount = 0;
  /** Bodies recebidos no POST /rotate, em ordem. */
  bodies: Array<Record<string, unknown>> = [];
  /** Quando false, a resposta vem sem o campo image. */
  respondWithImage = true;

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
      this.bodies.push(body as Record<string, unknown>);
      const data: Record<string, unknown> = {
        usage: { type: 'usd', usd: 0.0106 },
      };
      if (this.respondWithImage) data['image'] = FAKE_PNG_B64;
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
  const dir = join(tmpdir(), `rotate-lab-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function baseInput(): RotateLabInput {
  return {
    imageBase64: FAKE_PNG_B64,
    fromDirection: 'south',
    toDirection: 'east',
    imageSize: { width: 64, height: 64 },
  };
}

function opts(dir: string, logs?: string[]) {
  return {
    assetsDir: dir,
    ledgerPath: join(dir, 'ledger.ndjson'),
    ...(logs ? { onLog: (m: string) => logs.push(m) } : {}),
  };
}

function readLedger(dir: string): Array<Record<string, unknown>> {
  const path = join(dir, 'ledger.ndjson');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

async function assertValidation(
  input: RotateLabInput,
  code: RotateLabErrorCode,
): Promise<void> {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    await assert.rejects(
      runRotateLab(client, input, opts(dir)),
      (err: unknown) => {
        assert.ok(err instanceof RotateLabValidationError, `esperava RotateLabValidationError, veio ${String(err)}`);
        assert.equal(err.code, code);
        return true;
      },
    );
    assert.equal(client.callCount, 0, `validação ${code} não pode chamar a API`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ validação (antes de gastar)

test('from/to_direction junto com direction_change → direction-xor', async () => {
  await assertValidation(
    { ...baseInput(), directionChange: 45 },
    'direction-xor',
  );
});

test('nem par from/to nem direction_change → direction-xor', async () => {
  const input: RotateLabInput = { imageBase64: FAKE_PNG_B64, imageSize: { width: 64, height: 64 } };
  await assertValidation(input, 'direction-xor');
});

test('só fromDirection (sem toDirection) → direction-incomplete', async () => {
  const input: RotateLabInput = {
    imageBase64: FAKE_PNG_B64,
    fromDirection: 'south',
    imageSize: { width: 64, height: 64 },
  };
  await assertValidation(input, 'direction-incomplete');
});

test('só toDirection (sem fromDirection) → direction-incomplete', async () => {
  const input: RotateLabInput = {
    imageBase64: FAKE_PNG_B64,
    toDirection: 'west',
    imageSize: { width: 64, height: 64 },
  };
  await assertValidation(input, 'direction-incomplete');
});

test('imageSize fora da faixa 16–200 do /rotate → size-range', async () => {
  await assertValidation(
    { ...baseInput(), imageSize: { width: 8, height: 64 } },
    'size-range',
  );
  await assertValidation(
    { ...baseInput(), imageSize: { width: 64, height: 256 } },
    'size-range',
  );
  await assertValidation(
    { ...baseInput(), imageSize: { width: 64.5, height: 64 } },
    'size-range',
  );
});

test('imageSize ausente (JSON sem o campo) → size-range, nunca TypeError', async () => {
  const input = {
    imageBase64: FAKE_PNG_B64,
    fromDirection: 'south',
    toDirection: 'east',
  } as RotateLabInput;
  await assertValidation(input, 'size-range');
});

test('direction_change fora de −180..180 → direction-change-range', async () => {
  const base: RotateLabInput = { imageBase64: FAKE_PNG_B64, imageSize: { width: 64, height: 64 } };
  await assertValidation({ ...base, directionChange: 181 }, 'direction-change-range');
  await assertValidation({ ...base, directionChange: -181 }, 'direction-change-range');
  await assertValidation({ ...base, directionChange: 45.5 }, 'direction-change-range');
});

test('view_change fora de −90..90 → view-change-range', async () => {
  await assertValidation({ ...baseInput(), viewChange: 91 }, 'view-change-range');
  await assertValidation({ ...baseInput(), viewChange: -91 }, 'view-change-range');
});

test('from_view fora do enum CameraView → view-enum', async () => {
  await assertValidation({ ...baseInput(), fromView: 'isometric' }, 'view-enum');
  await assertValidation({ ...baseInput(), toView: 'top' }, 'view-enum');
});

test('initImageStrength sem initImageBase64 → init-strength-without-image', async () => {
  await assertValidation({ ...baseInput(), initImageStrength: 300 }, 'init-strength-without-image');
});

test('initImageStrength fora de 1..999 → init-strength-range', async () => {
  await assertValidation(
    { ...baseInput(), initImageBase64: FAKE_PNG_B64, initImageStrength: 0 },
    'init-strength-range',
  );
  await assertValidation(
    { ...baseInput(), initImageBase64: FAKE_PNG_B64, initImageStrength: 1000 },
    'init-strength-range',
  );
});

// ------------------------------------------------------------------ execução

test('primeira execução — UMA chamada, params do par from/to, PNG gravado no retorno', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const logs: string[] = [];

    const result = await runRotateLab(client, baseInput(), opts(dir, logs));

    assert.equal(client.callCount, 1, 'laboratório faz exatamente UMA chamada ao /rotate');
    const body = client.bodies[0];
    assert.ok(body, 'body da chamada registrado');
    assert.equal(body['from_direction'], 'south');
    assert.equal(body['to_direction'], 'east');
    assert.equal(body['direction_change'], undefined, 'par from/to não manda direction_change');
    assert.deepEqual(
      body['from_image'],
      { type: 'base64', base64: FAKE_PNG_B64 },
      'from_image é Base64Image ({base64}), não string crua — string é 422 na API',
    );
    assert.deepEqual(body['image_size'], { width: 64, height: 64 });
    assert.equal('isometric' in body, false, 'isometric=false é omitido do request (F0-09)');

    // PNG gravado: no retorno o arquivo já existe e o conteúdo bate com o b64 devolvido.
    assert.ok(result.path.includes(join('rotate-lab')), 'PNG fica em assetsDir/rotate-lab/');
    assert.ok(existsSync(result.path), 'PNG existe no disco quando a função retorna');
    assert.equal(readFileSync(result.path).toString('base64'), FAKE_PNG_B64);
    assert.equal(result.image, FAKE_PNG_B64);

    // Usage cru no resultado.
    assert.equal(result.usage?.type, 'usd');
    assert.equal(result.usage?.usd, 0.0106);

    // Estimativa logada no servidor — informa, nunca recusa.
    assert.ok(
      logs.some((m) => m.includes('Estimativa') && m.includes('US$')),
      'log de estimativa (preço estimado) emitido antes da chamada',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('direction_change gera direction_change no request, sem from/to_direction', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const input: RotateLabInput = {
      imageBase64: FAKE_PNG_B64,
      directionChange: 90,
      imageSize: { width: 64, height: 64 },
    };
    await runRotateLab(client, input, opts(dir));

    const body = client.bodies[0];
    assert.ok(body);
    assert.equal(body['direction_change'], 90);
    assert.equal('from_direction' in body, false);
    assert.equal('to_direction' in body, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isometric=true entra no request; views, seed e init_image quando informados', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const input: RotateLabInput = {
      ...baseInput(),
      fromView: 'low top-down',
      toView: 'low top-down',
      isometric: true,
      seed: 42,
      initImageBase64: `data:image/png;base64,${FAKE_PNG_B64}`,
      initImageStrength: 300,
    };
    await runRotateLab(client, input, opts(dir));

    const body = client.bodies[0];
    assert.ok(body);
    assert.equal(body['isometric'], true);
    assert.equal(body['from_view'], 'low top-down');
    assert.equal(body['to_view'], 'low top-down');
    assert.equal(body['seed'], 42);
    assert.deepEqual(
      body['init_image'],
      { type: 'base64', base64: FAKE_PNG_B64 },
      'init_image também é Base64Image',
    );
    assert.equal(body['init_image_strength'], 300);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ idempotência

test('segunda execução com o mesmo input — ZERO chamadas (idempotência por hash)', async () => {
  const dir = tmpDir();
  try {
    const input = baseInput();

    const client1 = new FakeClient();
    const first = await runRotateLab(client1, input, opts(dir));
    assert.equal(client1.callCount, 1);

    const client2 = new FakeClient();
    const second = await runRotateLab(client2, input, opts(dir));
    assert.equal(client2.callCount, 0, 'mesmo hash + PNG existente → sem chamada à API');
    assert.equal(second.path, first.path, 'hit de cache devolve o mesmo path');
    assert.equal(second.image, FAKE_PNG_B64);
    assert.equal(second.usage, undefined, 'hit de cache não tem usage (não houve chamada)');

    // Ledger não é reescrito no hit de cache.
    assert.equal(readLedger(dir).length, 1, 'ledger tem uma linha só — cache não loga de novo');

    console.log('✓ idempotência: 0 requisições na segunda execução');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('data URI e b64 puro da mesma imagem colidem no hash', async () => {
  const dir = tmpDir();
  try {
    const client1 = new FakeClient();
    await runRotateLab(
      client1,
      { ...baseInput(), imageBase64: `data:image/png;base64,${FAKE_PNG_B64}` },
      opts(dir),
    );
    assert.equal(client1.callCount, 1);

    const client2 = new FakeClient();
    await runRotateLab(client2, baseInput(), opts(dir));
    assert.equal(client2.callCount, 0, 'data URI e b64 puro são o mesmo input');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('input diferente (direction_change) gera hash diferente → nova chamada', async () => {
  const dir = tmpDir();
  try {
    const client1 = new FakeClient();
    await runRotateLab(
      client1,
      { imageBase64: FAKE_PNG_B64, directionChange: 45, imageSize: { width: 64, height: 64 } },
      opts(dir),
    );
    assert.equal(client1.callCount, 1);

    const client2 = new FakeClient();
    await runRotateLab(
      client2,
      { imageBase64: FAKE_PNG_B64, directionChange: 90, imageSize: { width: 64, height: 64 } },
      opts(dir),
    );
    assert.equal(client2.callCount, 1, 'direction_change diferente → hash diferente → chama de novo');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ ledger

test('ledger ndjson escrito com usage cru após o PNG', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const result = await runRotateLab(client, baseInput(), opts(dir));

    const lines = readLedger(dir);
    assert.equal(lines.length, 1);
    const entry = lines[0];
    assert.ok(entry);
    assert.equal(entry['endpoint'], 'rotate');
    assert.equal(entry['lab'], true);
    assert.equal(entry['usd'], 0.0106, 'usage cru: usd da resposta');
    assert.equal(entry['unit'], 'usd', 'usage cru: type da resposta');
    assert.equal(entry['generations'], null);
    assert.equal(entry['path'], result.path);
    assert.equal(typeof entry['hash'], 'string');
    assert.equal(typeof entry['at'], 'string');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ resposta sem image

test('resposta sem campo "image" → erro claro, sem PNG e sem ledger', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    client.respondWithImage = false;

    await assert.rejects(
      runRotateLab(client, baseInput(), opts(dir)),
      /campo "image"/,
    );
    assert.equal(client.callCount, 1, 'a chamada aconteceu — o erro é da resposta');
    assert.equal(existsSync(join(dir, 'rotate-lab')), false, 'nenhum PNG gravado');
    assert.equal(readLedger(dir).length, 0, 'nenhuma linha de ledger');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
