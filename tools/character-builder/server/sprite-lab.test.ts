/**
 * Teste da bancada v3 (Sprite Studio) com cliente falso.
 *
 * Propriedades verificadas (sem rede):
 *   1. Validação ANTES de gastar: description (obrigatória, teto 2000 do spec),
 *      view/size/seed/outputs nas faixas do spec, outline/detail/templateId nos
 *      enums de model.ts, referência que não decodifica, e o par proibido
 *      enhance_prompt+reference_image (422 garantido na API) — tudo com erro
 *      nomeado e ZERO chamadas.
 *   2. N submissões EM PARALELO (prova por interleaving de eventos), seeds
 *      determinísticas (informada ou derivada do hash), candidato i = base+i.
 *   3. Extração do frame `south` POR CHAVE — PNGs distintos por direção.
 *   4. Idempotência por candidato: cache total = zero chamadas e fromCache;
 *      cache parcial = só a posição apagada é regenerada; data URI e b64 puro
 *      da mesma referência colidem; `outputs` entra no hash.
 *   5. outline/detail OMITIDOS com reference_image (a v3 os ignora) e
 *      incluídos sem ela; enhance_prompt omitido quando false (F0-09);
 *      no_background default true; view default 'low top-down'.
 *   6. Ledger ndjson por submissão (usage cru + enhanced_prompt/enhance_usage
 *      quando presentes) — e não reescrito em hit de cache.
 *   7. readSpriteLabResult: null para ausente/incompleto, resultado do disco
 *      para hash conhecido.
 *
 * Execute com: node --test server/sprite-lab.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { PixelLabClient, type ApiResult } from '../../pixellab-pipeline/src/api.ts';
import { DIRECTIONS, type Direction } from './model.ts';
import {
  waitForCharacterRotations,
  CharacterFailedError,
  CharacterTimeoutError,
} from './character-detail.ts';
import {
  runSpriteLab,
  listSpriteLabRuns,
  readSpriteLabResult,
  spriteLabHash,
  SpriteLabValidationError,
  type SpriteLabConfig,
  type SpriteLabErrorCode,
} from './sprite-lab.ts';

// ------------------------------------------------------------------ PNGs sintéticos

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

/** PNG RGB 8bpc válido; `fill` distingue arquivos (é como provamos quem é south). */
function makePNG(width: number, height: number, fill = 0): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const rowLen = 1 + width * 3;
  const raw = Buffer.alloc(height * rowLen, fill & 0xff);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Um PNG distinto por direção — south tem fill 10. */
const PNG_BY_DIRECTION: Record<Direction, string> = Object.fromEntries(
  DIRECTIONS.map((d, i) => [d, makePNG(8, 8, (i + 1) * 10).toString('base64')]),
) as Record<Direction, string>;

/** Referência de upload (não é nenhuma das direções). */
const REF_B64 = makePNG(8, 8, 99).toString('base64');

// ------------------------------------------------------------------ storage falso

/**
 * Host fictício das rotation_urls. O fake precisa servir HTTP de verdade
 * porque é assim que a API real entrega os pixels do create-character-v3:
 * `GET /characters/{id}` devolve URLs, não base64. Um fake que devolvesse
 * base64 aqui é justamente o que deixou o bug de 2026-08-01 passar por 76
 * testes verdes — a suíte modelava uma resposta que a API nunca produziu.
 */
const FAKE_HOST = 'https://storage.fake-pixellab.test';

function rotationUrl(characterId: string, dir: Direction): string {
  return `${FAKE_HOST}/${characterId}/${dir}.png`;
}

const realFetch = globalThis.fetch;

/** Serve os PNGs das rotation_urls; qualquer outra URL cai no fetch real. */
function installFakeStorage(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith(FAKE_HOST)) {
      const dir = url.slice(url.lastIndexOf('/') + 1).replace(/\.png$/, '') as Direction;
      const b64 = PNG_BY_DIRECTION[dir];
      if (b64 === undefined) return new Response('não encontrado', { status: 404 });
      return new Response(Buffer.from(b64, 'base64'), { status: 200 });
    }
    return realFetch(input, init);
  }) as typeof globalThis.fetch;
}

function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

installFakeStorage();

// ------------------------------------------------------------------ client falso

class FakeClient extends PixelLabClient {
  /** Bodies recebidos no POST /create-character-v3, em ordem. */
  readonly bodies: Array<Record<string, unknown>> = [];
  /** Linha do tempo start/end das submissões — prova de concorrência. */
  readonly events: string[] = [];
  /** Atraso do submit para que as N submissões só se sobreponham se paralelas. */
  submitDelayMs = 5;
  /** Simula enhance_prompt=true: devolve enhanced_prompt + enhance_usage. */
  includeEnhance = false;
  /** Simula resposta quebrada: rotation_urls sem a chave south. */
  omitSouth = false;
  /**
   * Quantas sondagens de GET /characters/{id} respondem 'pending' antes de
   * virar 'completed'. Reproduz a janela real entre o job concluir e as
   * rotation_urls existirem (o spec avisa que elas são null fora de
   * 'completed').
   */
  pendingReads = 0;
  /** Força o status do CharacterDetail (ex.: 'failed'). */
  characterStatus: string | undefined;
  /** Sondagens de GET /characters/{id} recebidas, por character_id. */
  readonly characterReads: string[] = [];

  constructor() {
    super('fake-token-for-test-only');
  }

  override async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    if (method === 'POST' && path === '/create-character-v3') {
      const b = (body ?? {}) as Record<string, unknown>;
      this.bodies.push(b);
      const seed = String(b['seed']);
      this.events.push(`start:${seed}`);
      await new Promise((resolve) => setTimeout(resolve, this.submitDelayMs));
      this.events.push(`end:${seed}`);
      const data: Record<string, unknown> = {
        background_job_id: `job-${seed}`,
        character_id: `char-${seed}`,
        status: 'processing',
        usage: { type: 'usd', usd: 0.041 },
      };
      if (this.includeEnhance) {
        data['enhanced_prompt'] = `enhanced: ${String(b['description'])}`;
        data['enhance_usage'] = { type: 'usd', usd: 0.001 };
      }
      return this.ok<T>(data);
    }

    if (method === 'GET' && path.startsWith('/background-jobs/')) {
      const id = path.slice('/background-jobs/'.length);
      // Formato REAL do job concluído do create-character-v3: metadado puro.
      // Nenhum pixel passa por aqui — quem tem os pixels é o CharacterDetail.
      return this.ok<T>({
        id,
        status: 'completed',
        created_at: '2026-08-01T00:00:00Z',
        last_response: {
          character_id: id.replace(/^job-/, 'char-'),
          directions_count: 8,
          directions_type: '8-directions',
          saved_to_storage: true,
          uploaded_directions: [...DIRECTIONS],
        },
      });
    }

    if (method === 'GET' && path.startsWith('/characters/')) {
      const id = decodeURIComponent(path.slice('/characters/'.length));
      this.characterReads.push(id);
      if (this.characterStatus !== undefined) {
        return this.ok<T>({ id, status: this.characterStatus, rotation_urls: null });
      }
      // Janela real: 'pending' com rotation_urls null enquanto o upload dos
      // frames e o esqueleto 3D não terminam.
      if (this.characterReads.filter((c) => c === id).length <= this.pendingReads) {
        return this.ok<T>({ id, status: 'pending', directions: 8, rotation_urls: null });
      }
      const rotation: Record<string, string> = {};
      for (const d of DIRECTIONS) {
        if (this.omitSouth && d === 'south') continue;
        rotation[d] = rotationUrl(id, d);
      }
      return this.ok<T>({
        id,
        status: 'completed',
        directions: 8,
        size: { width: 64, height: 64 },
        rotation_urls: rotation,
      });
    }

    throw new Error(`FakeClient: chamada inesperada ${method} ${path}`);
  }

  private ok<T>(data: unknown): ApiResult<T> {
    const usage = (data as { usage?: ApiResult<T>['usage'] }).usage;
    return {
      data: data as T,
      status: 200,
      raw: JSON.stringify(data),
      ...(usage ? { usage } : {}),
    };
  }
}

// ------------------------------------------------------------------ helpers

function tmpDir(): string {
  const dir = join(tmpdir(), `sprite-lab-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function baseConfig(): SpriteLabConfig {
  return {
    description: 'bald naked humanoid mannequin, grey skin',
    size: 64,
    outputs: 1,
  };
}

function opts(dir: string, logs?: string[]) {
  return {
    assetsDir: join(dir, 'assets'),
    ledgerPath: join(dir, 'assets', 'ledger.ndjson'),
    ...(logs ? { onLog: (m: string) => logs.push(m) } : {}),
  };
}

function readLedger(dir: string): Array<Record<string, unknown>> {
  const path = join(dir, 'assets', 'ledger.ndjson');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

async function assertValidation(
  config: SpriteLabConfig,
  code: SpriteLabErrorCode,
): Promise<void> {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    await assert.rejects(
      runSpriteLab(client, config, opts(dir)),
      (err: unknown) => {
        assert.ok(err instanceof SpriteLabValidationError, `esperava SpriteLabValidationError, veio ${String(err)}`);
        assert.equal(err.code, code);
        return true;
      },
    );
    assert.equal(client.bodies.length, 0, `validação ${code} não pode chamar a API`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ validação (antes de gastar)

test('description ausente, vazia ou whitespace → description-required', async () => {
  await assertValidation({ ...baseConfig(), description: '' }, 'description-required');
  await assertValidation({ ...baseConfig(), description: '   ' }, 'description-required');
  const semDesc = { size: 64, outputs: 1 } as SpriteLabConfig;
  await assertValidation(semDesc, 'description-required');
});

test('description acima de 2000 caracteres (teto do spec) → description-too-long', async () => {
  await assertValidation({ ...baseConfig(), description: 'x'.repeat(2001) }, 'description-too-long');
});

test('view fora do enum CameraView → view-enum', async () => {
  await assertValidation(
    { ...baseConfig(), view: 'isometric' } as unknown as SpriteLabConfig,
    'view-enum',
  );
});

test('size fora da faixa 32–256 do V3OutputImageSize → size-range', async () => {
  await assertValidation({ ...baseConfig(), size: 31 }, 'size-range');
  await assertValidation({ ...baseConfig(), size: 257 }, 'size-range');
  await assertValidation({ ...baseConfig(), size: 64.5 }, 'size-range');
  const semSize = { description: 'x', outputs: 1 } as SpriteLabConfig;
  await assertValidation(semSize, 'size-range');
});

test('outputs fora de 1–4 → outputs-range', async () => {
  await assertValidation({ ...baseConfig(), outputs: 0 }, 'outputs-range');
  await assertValidation({ ...baseConfig(), outputs: 5 }, 'outputs-range');
  await assertValidation({ ...baseConfig(), outputs: 1.5 }, 'outputs-range');
  const semOutputs = { description: 'x', size: 64 } as SpriteLabConfig;
  await assertValidation(semOutputs, 'outputs-range');
});

test('seed negativa ou não-inteira → seed-range', async () => {
  await assertValidation({ ...baseConfig(), seed: -1 }, 'seed-range');
  await assertValidation({ ...baseConfig(), seed: 1.5 }, 'seed-range');
});

test('outline/detail/templateId fora dos enums de model.ts → erros nomeados', async () => {
  await assertValidation(
    { ...baseConfig(), outline: 'grosso' } as unknown as SpriteLabConfig,
    'outline-enum',
  );
  await assertValidation(
    { ...baseConfig(), detail: 'high detail' } as unknown as SpriteLabConfig,
    'detail-enum',
  );
  await assertValidation(
    { ...baseConfig(), templateId: 'goblin' } as unknown as SpriteLabConfig,
    'template-enum',
  );
});

test('referência que não decodifica para bytes → reference-invalid', async () => {
  await assertValidation({ ...baseConfig(), referenceImageBase64: '' }, 'reference-invalid');
  await assertValidation(
    { ...baseConfig(), referenceImageBase64: 'data:image/png;base64,' },
    'reference-invalid',
  );
});

test('enhancePrompt junto com referenceImageBase64 → enhance-with-reference (422 na API)', async () => {
  await assertValidation(
    { ...baseConfig(), enhancePrompt: true, referenceImageBase64: REF_B64 },
    'enhance-with-reference',
  );
});

// ------------------------------------------------------------------ execução

test('primeira execução — UMA submissão, params da config, south extraído e gravado', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const logs: string[] = [];

    const result = await runSpriteLab(client, { ...baseConfig(), seed: 42 }, opts(dir, logs));

    assert.equal(client.bodies.length, 1, 'bancada com outputs=1 faz exatamente UMA submissão');
    const body = client.bodies[0];
    assert.ok(body, 'body da submissão registrado');
    assert.equal(body['description'], baseConfig().description);
    assert.equal(body['view'], 'low top-down', 'view default é low top-down (ADR 0005)');
    assert.deepEqual(body['image_size'], { width: 64, height: 64 });
    assert.equal(body['seed'], 42);
    assert.equal(body['no_background'], true, 'no_background default true');
    assert.equal('template_id' in body, false, 'template_id ausente é omitido (default da API)');
    assert.equal('enhance_prompt' in body, false, 'enhance_prompt=false é omitido (F0-09)');
    assert.equal('reference_image' in body, false);
    assert.equal('outline' in body, false);
    assert.equal('detail' in body, false);

    assert.equal(result.fromCache, false);
    assert.equal(result.candidates.length, 1);
    const cand = result.candidates[0];
    assert.ok(cand);
    assert.equal(cand.index, 0);
    assert.equal(cand.seed, 42);
    assert.equal(cand.southB64, PNG_BY_DIRECTION['south'], 'south extraído POR CHAVE');
    assert.equal(cand.usage?.usd, 0.041);

    // PNG gravado em disco quando a função retorna — e é o south, não outra direção.
    const dirCand = join(dir, 'assets', 'sprite-lab', `${result.hash}-cand0`);
    const southPath = join(dirCand, 'south-00.png');
    assert.ok(existsSync(southPath), 'south-00.png existe no disco');
    assert.equal(readFileSync(southPath).toString('base64'), PNG_BY_DIRECTION['south']);
    assert.equal(
      readFileSync(join(dirCand, 'north-00.png')).toString('base64'),
      PNG_BY_DIRECTION['north'],
      'as outras 7 direções ficam em disco como subproduto',
    );

    // Estimativa logada — informa, nunca recusa.
    assert.ok(
      logs.some((m) => m.includes('[guard]') && m.includes('preço estimado')),
      'log de estimativa emitido antes da submissão',
    );

    // Ledger: uma linha com o usage cru.
    const lines = readLedger(dir);
    assert.equal(lines.length, 1);
    const entry = lines[0];
    assert.ok(entry);
    assert.equal(entry['endpoint'], 'create-character-v3');
    assert.equal(entry['lab'], true);
    assert.equal(entry['hash'], result.hash);
    assert.equal(entry['index'], 0);
    assert.equal(entry['usd'], 0.041);
    assert.equal(entry['unit'], 'usd');
    assert.equal(entry['generations'], null);
    assert.equal('enhanced_prompt' in entry, false, 'sem enhance, ledger não tem enhanced_prompt');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('outputs=3 — 3 submissões EM PARALELO, seeds base+i', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();

    const result = await runSpriteLab(client, { ...baseConfig(), seed: 42, outputs: 3 }, opts(dir));

    assert.equal(client.bodies.length, 3, 'outputs=3 → 3 submissões');
    assert.deepEqual(
      client.bodies.map((b) => b['seed']),
      [42, 43, 44],
      'candidato i recebe seed base+i',
    );

    // Prova de concorrência: com o submit atrasado, os três starts vêm antes
    // de qualquer end — se fossem sequenciais, alternariam start/end.
    const firstEnd = client.events.findIndex((e) => e.startsWith('end:'));
    const lastStart = client.events.reduce(
      (acc, e, i) => (e.startsWith('start:') ? i : acc),
      -1,
    );
    assert.ok(
      lastStart !== -1 && firstEnd !== -1 && lastStart < firstEnd,
      `submissões não foram paralelas: ${client.events.join(', ')}`,
    );

    assert.equal(result.candidates.length, 3);
    assert.deepEqual(
      result.candidates.map((c) => c.seed),
      [42, 43, 44],
    );
    for (let i = 0; i < 3; i += 1) {
      assert.ok(
        existsSync(join(dir, 'assets', 'sprite-lab', `${result.hash}-cand${i}`, 'south-00.png')),
        `PNG do candidato ${i} gravado`,
      );
    }
    assert.equal(readLedger(dir).length, 3, 'uma linha de ledger por submissão');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sem seed informada, a base deriva do hash e é determinística', async () => {
  const dir1 = tmpDir();
  const dir2 = tmpDir();
  try {
    const client1 = new FakeClient();
    const r1 = await runSpriteLab(client1, { ...baseConfig(), outputs: 2 }, opts(dir1));
    const seeds1 = client1.bodies.map((b) => b['seed']);
    assert.equal(seeds1.length, 2);
    assert.ok(
      seeds1.every((s) => typeof s === 'number' && Number.isInteger(s) && (s as number) >= 0),
      'seeds derivadas são inteiros >= 0 (spec)',
    );
    assert.equal(seeds1[1], (seeds1[0] as number) + 1, 'candidato i = base+i');

    const client2 = new FakeClient();
    const r2 = await runSpriteLab(client2, { ...baseConfig(), outputs: 2 }, opts(dir2));
    assert.deepEqual(
      client2.bodies.map((b) => b['seed']),
      seeds1,
      'mesma config sem seed → mesmas seeds (derivadas do hash)',
    );
    assert.equal(r2.hash, r1.hash, 'mesma config → mesmo hash');
  } finally {
    rmSync(dir1, { recursive: true, force: true });
    rmSync(dir2, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ idempotência

test('segunda execução com a mesma config — ZERO submissões e fromCache', async () => {
  const dir = tmpDir();
  try {
    const config = { ...baseConfig(), seed: 42, outputs: 2 };

    const client1 = new FakeClient();
    const first = await runSpriteLab(client1, config, opts(dir));
    assert.equal(client1.bodies.length, 2);

    const client2 = new FakeClient();
    const logs: string[] = [];
    const second = await runSpriteLab(client2, config, opts(dir, logs));
    assert.equal(client2.bodies.length, 0, 'cache total → sem chamada à API');
    assert.equal(second.fromCache, true);
    assert.equal(second.hash, first.hash);
    assert.deepEqual(
      second.candidates.map((c) => c.southB64),
      first.candidates.map((c) => c.southB64),
    );
    assert.equal(
      second.candidates.every((c) => c.usage === undefined),
      true,
      'hit de cache não tem usage (não houve chamada)',
    );

    assert.equal(readLedger(dir).length, 2, 'ledger não é reescrito no hit de cache');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cache por candidato — apagar um PNG refaz só aquela posição', async () => {
  const dir = tmpDir();
  try {
    const config = { ...baseConfig(), seed: 42, outputs: 2 };

    const client1 = new FakeClient();
    const first = await runSpriteLab(client1, config, opts(dir));
    assert.equal(client1.bodies.length, 2);

    rmSync(join(dir, 'assets', 'sprite-lab', `${first.hash}-cand1`), { recursive: true, force: true });

    const client2 = new FakeClient();
    const second = await runSpriteLab(client2, config, opts(dir));
    assert.equal(client2.bodies.length, 1, 'só o candidato apagado é regenerado');
    assert.equal(client2.bodies[0]?.['seed'], 43, 'a posição 1 é a da seed 43');
    assert.equal(second.fromCache, false);
    assert.equal(second.candidates[0]?.usage, undefined, 'candidato 0 veio do cache');
    assert.ok(second.candidates[1]?.usage, 'candidato 1 tem usage da nova submissão');
    assert.equal(readLedger(dir).length, 3, 'ledger acumula uma linha por submissão');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('data URI e b64 puro da mesma referência colidem no hash', async () => {
  const dir = tmpDir();
  try {
    const client1 = new FakeClient();
    await runSpriteLab(
      client1,
      { ...baseConfig(), referenceImageBase64: `data:image/png;base64,${REF_B64}` },
      opts(dir),
    );
    assert.equal(client1.bodies.length, 1);

    const client2 = new FakeClient();
    const second = await runSpriteLab(
      client2,
      { ...baseConfig(), referenceImageBase64: REF_B64 },
      opts(dir),
    );
    assert.equal(client2.bodies.length, 0, 'data URI e b64 puro são o mesmo input');
    assert.equal(second.fromCache, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('outputs entra no hash — mesma config com outputs diferente não reusa cache', async () => {
  const dir = tmpDir();
  try {
    const client1 = new FakeClient();
    await runSpriteLab(client1, { ...baseConfig(), seed: 42, outputs: 1 }, opts(dir));
    assert.equal(client1.bodies.length, 1);

    const client2 = new FakeClient();
    const second = await runSpriteLab(client2, { ...baseConfig(), seed: 42, outputs: 2 }, opts(dir));
    assert.equal(client2.bodies.length, 2, 'outputs mudou → hash mudou → nada é reutilizado');
    assert.equal(second.fromCache, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ request: reference / outline / detail / enhance

test('com reference_image, outline/detail são OMITIDOS do request (a v3 os ignora) e a omissão é logada', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const logs: string[] = [];

    await runSpriteLab(
      client,
      {
        ...baseConfig(),
        referenceImageBase64: REF_B64,
        outline: 'lineless',
        detail: 'highly detailed',
        templateId: 'cat',
      },
      opts(dir, logs),
    );

    const body = client.bodies[0];
    assert.ok(body);
    assert.deepEqual(body['reference_image'], { base64: REF_B64 }, 'referência vai como Base64Image sem data URI');
    assert.equal('outline' in body, false, 'a v3 ignora outline com reference_image');
    assert.equal('detail' in body, false, 'a v3 ignora detail com reference_image');
    assert.equal(body['template_id'], 'cat');
    assert.ok(
      logs.some((m) => m.includes('outline/detail omitidos')),
      'omissão de outline/detail registrada no log',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sem reference_image, outline/detail entram no request quando informados', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();

    await runSpriteLab(
      client,
      { ...baseConfig(), outline: 'lineless', detail: 'low detail' },
      opts(dir),
    );

    const body = client.bodies[0];
    assert.ok(body);
    assert.equal(body['outline'], 'lineless');
    assert.equal(body['detail'], 'low detail');
    assert.equal('reference_image' in body, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('enhancePrompt=true entra no request e enhanced_prompt/enhance_usage vão ao ledger', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    client.includeEnhance = true;

    await runSpriteLab(client, { ...baseConfig(), enhancePrompt: true }, opts(dir));

    const body = client.bodies[0];
    assert.ok(body);
    assert.equal(body['enhance_prompt'], true);

    const lines = readLedger(dir);
    assert.equal(lines.length, 1);
    const entry = lines[0];
    assert.ok(entry);
    assert.equal(entry['enhanced_prompt'], `enhanced: ${baseConfig().description}`);
    assert.deepEqual(entry['enhance_usage'], { type: 'usd', usd: 0.001 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('noBackground=false é enviado; view explícita respeitada', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();

    await runSpriteLab(
      client,
      { ...baseConfig(), noBackground: false, view: 'side' },
      opts(dir),
    );

    const body = client.bodies[0];
    assert.ok(body);
    assert.equal(body['no_background'], false);
    assert.equal(body['view'], 'side');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ resposta sem south

test('resposta sem a chave south → erro explícito (frames.ts recusa direção ausente)', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    client.omitSouth = true;

    await assert.rejects(
      runSpriteLab(client, baseConfig(), opts(dir)),
      /south/,
    );
    assert.equal(client.bodies.length, 1, 'a submissão aconteceu — o erro é da resposta');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ readSpriteLabResult

test('readSpriteLabResult — null para hash desconhecido', async () => {
  const dir = tmpDir();
  try {
    assert.equal(await readSpriteLabResult('0000000000000000', join(dir, 'assets')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readSpriteLabResult — devolve o resultado do disco após uma execução', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const first = await runSpriteLab(client, { ...baseConfig(), seed: 42, outputs: 2 }, opts(dir));

    const read = await readSpriteLabResult(first.hash, join(dir, 'assets'));
    assert.ok(read, 'resultado deveria ser lido do disco');
    assert.equal(read.hash, first.hash);
    assert.equal(read.fromCache, true, 'leitura do disco é sempre cache');
    assert.equal(read.candidates.length, 2);
    assert.deepEqual(
      read.candidates.map((c) => c.seed),
      [42, 43],
    );
    assert.deepEqual(
      read.candidates.map((c) => c.southB64),
      first.candidates.map((c) => c.southB64),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readSpriteLabResult — null quando um PNG do manifesto sumiu', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const first = await runSpriteLab(client, { ...baseConfig(), seed: 42, outputs: 2 }, opts(dir));

    rmSync(join(dir, 'assets', 'sprite-lab', `${first.hash}-cand1`), { recursive: true, force: true });

    assert.equal(
      await readSpriteLabResult(first.hash, join(dir, 'assets')),
      null,
      'resultado incompleto não é resultado',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ listSpriteLabRuns

/**
 * O catálogo é o que faz uma sprite PAGA sobreviver a um remount do painel.
 *
 * Antes dele o `hash` voltava uma vez só, no corpo do 202 do POST, e vivia daí
 * em diante apenas em estado React: trocar de aba no estúdio desmontava a tela
 * e a sprite gerada — presente em disco — sumia da interface. Os testes abaixo
 * fixam as PROPRIEDADES que a recuperação precisa: só corrida completa entra, a
 * miniatura aponta para um arquivo que existe, a ordem é da mais nova para a
 * mais velha, e um manifesto legado (sem config) continua legível.
 */

test('listSpriteLabRuns — diretório inexistente devolve lista vazia, não erro', async () => {
  const dir = tmpDir();
  try {
    assert.deepEqual(await listSpriteLabRuns(join(dir, 'assets')), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listSpriteLabRuns — corrida completa entra com miniatura, contagem e config', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const run = await runSpriteLab(
      client,
      { ...baseConfig(), seed: 42, outputs: 2 },
      opts(dir),
    );

    const runs = await listSpriteLabRuns(join(dir, 'assets'));
    assert.equal(runs.length, 1);
    const only = runs[0]!;
    assert.equal(only.hash, run.hash);
    assert.equal(only.candidateCount, 2);
    assert.deepEqual(
      only.candidates.map((c) => c.seed),
      [42, 43],
    );
    // A miniatura tem que apontar para o PNG que o servidor de assets serve.
    assert.equal(
      only.candidates[0]?.southUrl,
      `/sprite-lab/${run.hash}-cand0/south-00.png`,
    );
    assert.ok(
      existsSync(join(dir, 'assets', 'sprite-lab', `${run.hash}-cand0`, 'south-00.png')),
      'a URL da miniatura corresponde a um arquivo real',
    );
    assert.ok(!Number.isNaN(Date.parse(only.at)), '`at` é ISO parseável');

    // A config é o que permite resumir a corrida e remontar o bundle: o hash é
    // irreversível e o manifesto é o único lugar onde ela sobrevive.
    assert.ok(only.config, 'corrida nova traz a config no manifesto');
    assert.equal(only.config.description, baseConfig().description);
    assert.equal(only.config.size, 64);
    assert.equal(only.config.outputs, 2);
    assert.equal(only.config.seed, 42);
    assert.equal(only.config.view, 'low top-down', 'default do spec já aplicado');
    assert.equal(only.config.noBackground, true);
    assert.equal(only.config.enhancePrompt, false);
    assert.equal(only.config.hadReference, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listSpriteLabRuns — corrida com PNG faltando fica FORA; lixo no diretório é ignorado', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const run = await runSpriteLab(
      client,
      { ...baseConfig(), seed: 42, outputs: 2 },
      opts(dir),
    );
    const root = join(dir, 'assets', 'sprite-lab');

    // Arquivo que não é manifesto e diretório que não é candidato: nem entram
    // no catálogo nem derrubam a varredura.
    writeFileSync(join(root, 'anotacoes.txt'), 'nada a ver');
    writeFileSync(join(root, 'naoehash.json'), '{"version":1}');

    rmSync(join(root, `${run.hash}-cand1`), { recursive: true, force: true });

    assert.deepEqual(
      await listSpriteLabRuns(join(dir, 'assets')),
      [],
      'resultado incompleto não é resultado — mesma regra do readSpriteLabResult',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listSpriteLabRuns — ordena da corrida mais recente para a mais antiga', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const velha = await runSpriteLab(
      client,
      { ...baseConfig(), description: 'corrida antiga', seed: 1 },
      opts(dir),
    );
    const nova = await runSpriteLab(
      client,
      { ...baseConfig(), description: 'corrida nova', seed: 2 },
      opts(dir),
    );

    // mtimes explícitos: duas execuções seguidas podem cair no mesmo
    // milissegundo e a ordem viraria sorte.
    const root = join(dir, 'assets', 'sprite-lab');
    utimesSync(join(root, `${velha.hash}.json`), new Date(1_000_000), new Date(1_000_000));
    utimesSync(join(root, `${nova.hash}.json`), new Date(2_000_000), new Date(2_000_000));

    const runs = await listSpriteLabRuns(join(dir, 'assets'));
    assert.deepEqual(
      runs.map((r) => r.hash),
      [nova.hash, velha.hash],
      'a mais recente vem primeiro — é ela que o painel traz de volta à tela',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listSpriteLabRuns — manifesto legado (sem config) entra no catálogo, sem inventar config', async () => {
  const dir = tmpDir();
  try {
    // Formato exato dos manifestos já pagos em disco: version/hash/candidates,
    // sem config. Ler o que já foi pago é sempre mais barato que regerar.
    const hash = 'abcdef0123456789';
    const root = join(dir, 'assets', 'sprite-lab');
    mkdirSync(join(root, `${hash}-cand0`), { recursive: true });
    writeFileSync(join(root, `${hash}-cand0`, 'south-00.png'), makePNG(8, 8, 10));
    writeFileSync(
      join(root, `${hash}.json`),
      JSON.stringify({
        version: 1,
        hash,
        candidates: [{ index: 0, seed: 3198724287, characterId: 'char-legado' }],
      }),
    );

    const runs = await listSpriteLabRuns(join(dir, 'assets'));
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.hash, hash);
    assert.equal(runs[0]?.candidateCount, 1);
    assert.equal(
      runs[0]?.config,
      undefined,
      'config ausente é dado que não existe, não dado a adivinhar',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------- regressão: o caminho dos pixels da v3

/**
 * Os quatro testes abaixo cobrem o bug de 2026-08-01: 14 submissões pagas de
 * create-character-v3 e ZERO PNG em disco, com a suíte inteira verde.
 *
 * A causa foi ler os frames do `last_response` do background job. O job da v3
 * carrega só metadado; os pixels moram em `GET /characters/{id}.rotation_urls`,
 * como URLs. O fake antigo devolvia base64 dentro do job — uma resposta que a
 * API real nunca produziu —, então o teste confirmava a fantasia e não o
 * contrato.
 */

test('regressão v3: os frames vêm de GET /characters/{id}, não do background job', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    await runSpriteLab(client, { ...baseConfig(), seed: 7 }, opts(dir));

    assert.deepEqual(
      client.characterReads,
      ['char-7'],
      'o CharacterDetail é o único lugar onde a v3 entrega pixels — ele TEM que ser lido',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('regressão v3: espera as rotation_urls aparecerem quando o personagem ainda está pending', async () => {
  const client = new FakeClient();
  // Duas leituras 'pending' antes de completar: é a janela real entre o job
  // concluir e o upload dos frames + esqueleto 3D terminarem. O spec avisa
  // que rotation_urls é null fora de status 'completed'.
  client.pendingReads = 2;

  const detail = await waitForCharacterRotations(client, 'char-7', { intervalMs: 5 });

  assert.equal(client.characterReads.length, 3, 'duas sondagens pending + a que completou');
  assert.equal(detail.status, 'completed');
  assert.equal(Object.keys(detail.rotation_urls ?? {}).length, 8);
});

test('regressão v3: personagem com status failed → erro nomeado, sem espera inútil', async () => {
  const client = new FakeClient();
  client.characterStatus = 'failed';
  await assert.rejects(
    waitForCharacterRotations(client, 'char-7', { intervalMs: 5, timeoutMs: 200 }),
    (err: unknown) => {
      assert.ok(err instanceof CharacterFailedError, `esperava CharacterFailedError, veio ${String(err)}`);
      assert.equal(err.characterId, 'char-7');
      return true;
    },
  );
  assert.equal(client.characterReads.length, 1, 'falha é terminal — não se sonda de novo');
});

test('regressão v3: rotation_urls que nunca aparecem → timeout que diz onde está o artefato pago', async () => {
  const client = new FakeClient();
  client.pendingReads = Number.POSITIVE_INFINITY;
  await assert.rejects(
    waitForCharacterRotations(client, 'char-7', { intervalMs: 5, timeoutMs: 30 }),
    (err: unknown) => {
      assert.ok(err instanceof CharacterTimeoutError, `esperava CharacterTimeoutError, veio ${String(err)}`);
      // A mensagem tem que dizer que o dinheiro não sumiu — é o ponto do erro.
      assert.match(err.message, /paga|pago/);
      return true;
    },
  );
});

test('regressão v3: character_id vai ao ledger E ao manifesto (caminho de volta ao artefato pago)', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const result = await runSpriteLab(client, { ...baseConfig(), seed: 7, outputs: 2 }, opts(dir));

    // Ledger: sem character_id, uma geração cobrada cujo download falhou é
    // irrecuperável a partir do histórico — foi exatamente o que aconteceu.
    const lab = readLedger(dir).filter((l) => l['lab'] === true);
    assert.equal(lab.length, 2);
    assert.deepEqual(
      lab.map((l) => l['characterId']).sort(),
      ['char-7', 'char-8'],
      'toda linha de ledger paga tem que carregar o character_id',
    );
    for (const l of lab) {
      assert.ok(typeof l['jobId'] === 'string' && l['jobId'].length > 0, 'jobId no ledger');
    }

    // Manifesto: o mesmo caminho de volta sobrevive ao reinício do servidor.
    assert.deepEqual(
      result.candidates.map((c) => c.characterId),
      ['char-7', 'char-8'],
    );
    const manifest = JSON.parse(
      readFileSync(join(dir, 'assets', 'sprite-lab', `${result.hash}.json`), 'utf-8'),
    ) as { candidates: Array<Record<string, unknown>> };
    assert.deepEqual(
      manifest.candidates.map((c) => c['characterId']),
      ['char-7', 'char-8'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ retomada gratuita (ADR 0023)

test('retomada: candidato PAGO cujo download caiu NÃO ressubmete o create-character-v3', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const config: SpriteLabConfig = { ...baseConfig(), seed: 7, outputs: 2 };

    // 1ª execução: as duas submissões são ACEITAS (dinheiro fora) e o
    // GET /characters/{id} vem 'failed'. É o 2026-08-01 exato: pago, sem PNG.
    client.characterStatus = 'failed';
    await assert.rejects(
      () => runSpriteLab(client, config, opts(dir)),
      /failed|cobrada/i,
    );
    assert.equal(
      client.bodies.length,
      2,
      'as duas submissões saíram na primeira execução — foram elas que custaram',
    );
    // `Promise.all` rejeita no PRIMEIRO candidato e não espera o irmão. Curar o
    // fornecedor aqui, com o irmão ainda em voo, o deixaria terminar com
    // sucesso e o teste mediria outra coisa. Duas leituras de personagem = os
    // dois candidatos já tomaram o 'failed'.
    for (let i = 0; i < 200 && client.characterReads.length < 2; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(
      client.characterReads.length,
      2,
      'os dois candidatos tinham de tentar buscar o personagem e falhar',
    );
    assert.equal(
      await readSpriteLabResult(spriteLabHash(config), join(dir, 'assets')),
      null,
      'nenhum PNG em disco: sem isso a idempotência por candidato mascararia a ' +
        'retomada e o teste ficaria vacuamente verde',
    );

    // 2ª execução, fornecedor de volta: RE-SONDA os character_ids guardados.
    client.characterStatus = undefined;
    const result = await runSpriteLab(client, config, opts(dir));

    assert.equal(
      client.bodies.length,
      2,
      'a retomada NÃO pode submeter de novo — os character_id já estavam em disco',
    );
    assert.equal(result.candidates.length, 2);
    assert.deepEqual(
      result.candidates.map((c) => c.characterId),
      ['char-7', 'char-8'],
      'a retomada devolve o caminho de volta ao artefato pago, por candidato',
    );
    for (let i = 0; i < 2; i += 1) {
      const png = join(dir, 'assets', 'sprite-lab', `${result.hash}-cand${i}`, 'south-00.png');
      assert.ok(existsSync(png), `o PNG pago do candidato ${i} chegou na retomada`);
      assert.ok(
        !existsSync(`${png}.pending.json`),
        `com o PNG em disco não pode sobrar stub do candidato ${i}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('retomada parcial: só o candidato que caiu re-sonda; o outro é cache e nenhum submete', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const config: SpriteLabConfig = { ...baseConfig(), seed: 21, outputs: 2 };

    // Execução completa e sadia: dois candidatos em disco, duas submissões.
    const primeiro = await runSpriteLab(client, config, opts(dir));
    assert.equal(client.bodies.length, 2);

    // O candidato 1 perde o PNG mas guarda o stub — é o estado exato de
    // "pago, download caiu" para UMA posição só.
    const png1 = join(dir, 'assets', 'sprite-lab', `${primeiro.hash}-cand1`, 'south-00.png');
    rmSync(png1);
    writeFileSync(
      `${png1}.pending.json`,
      `${JSON.stringify({ characterId: 'char-22', jobIds: ['job-22'] })}\n`,
    );

    const segundo = await runSpriteLab(client, config, opts(dir));
    assert.equal(
      client.bodies.length,
      2,
      'nem o cache nem a retomada podem submeter — as duas posições já foram pagas',
    );
    assert.equal(segundo.candidates.length, 2);
    assert.ok(existsSync(png1), 'o PNG pago do candidato 1 voltou pela retomada');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('regressão v3: as 8 direções são gravadas, não só a sul', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const result = await runSpriteLab(client, { ...baseConfig(), seed: 7 }, opts(dir));

    const candDir = join(dir, 'assets', 'sprite-lab', `${result.hash}-cand0`);
    for (const d of DIRECTIONS) {
      assert.ok(
        existsSync(join(candDir, `${d}-00.png`)),
        `direção ${d} tem que estar em disco — o endpoint SEMPRE produz as 8 e a bancada as guarda`,
      );
    }
    // E o conteúdo é o da direção certa: prova de que a leitura foi por CHAVE.
    assert.equal(
      readFileSync(join(candDir, 'south-00.png')).toString('base64'),
      PNG_BY_DIRECTION['south'],
    );
    assert.equal(
      readFileSync(join(candDir, 'north-00.png')).toString('base64'),
      PNG_BY_DIRECTION['north'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    restoreFetch();
  }
});
