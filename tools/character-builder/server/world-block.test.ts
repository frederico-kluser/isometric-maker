/**
 * Teste da bancada de blocos do mundo com cliente falso — as DUAS técnicas.
 *
 * Propriedades verificadas (sem rede, sem gastar):
 *   1. Validação ANTES de gastar: erro nomeado e ZERO chamadas.
 *   2. `chained`: 4 gerações de tile; a norte sai PRIMEIRO com o molde como
 *      init_image, e as outras três recebem o RESULTADO da norte como
 *      init_image E color_image — o encadeamento é o contrato.
 *   3. `rotated`: 1 tile (source) + 1 create-character-v3; as 8 direções vêm
 *      de rotation_urls como imagens separadas (nada de GIF), gravadas em
 *      v3/; as 4 vistas são derivadas localmente no quadro CANÔNICO 48×53.
 *   4. Idempotência e retomada SEM repagar: segunda execução = zero
 *      submissões; falha depois da submissão deixa stub com tile_id /
 *      character_id, e a retomada busca o artefato pago de graça.
 *   5. A técnica entra no hash; default explícito e omitido têm o MESMO hash.
 *   6. tile_id/character_id no ledger E no manifesto, e o manifesto NUNCA
 *      perde provenance numa retomada parcial (ADR 0023).
 *   7. listWorldBlocks só publica bloco COMPLETO do formato v2; trocar o
 *      mapeamento facing→direção rederiva de graça.
 *
 * Execute com: node --test server/world-block.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { PixelLabClient, PixelLabError, type ApiResult } from '../../pixellab-pipeline/src/api.ts';
import { apiImageSize, mouldBase64, BLOCK_GEOMETRY } from './cube-mould.ts';
import { decodePngToRgba, encodePngFromRgba, readPngHeader } from './png.ts';
import { DIRECTIONS } from './model.ts';
import {
  runWorldBlock,
  readWorldBlockResult,
  listWorldBlocks,
  facingPrompt,
  worldBlockHash,
  padPngToApiCanvas,
  apiBytesToCanonicalPng,
  WorldBlockValidationError,
  BLOCK_FACINGS,
  FACING_TO_V3_DIRECTION,
  type WorldBlockConfig,
  type WorldBlockErrorCode,
} from './world-block.ts';

// ------------------------------------------------------------------ PNG sintético

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
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

/** PNG RGBA válido e DECODIFICÁVEL (tipo de cor 6); `fill` distingue arquivos. */
function makePNG(side: number, fill: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(side, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(side * (1 + side * 4));
  for (let y = 0; y < side; y += 1) {
    const row = y * (1 + side * 4);
    raw[row] = 0;
    for (let x = 0; x < side; x += 1) {
      const px = row + 1 + x * 4;
      raw[px] = fill & 0xff;
      raw[px + 1] = (fill * 7) & 0xff;
      raw[px + 2] = (fill * 13) & 0xff;
      raw[px + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Um PNG distinto por seed — é como provamos qual chamada produziu o quê. */
function pngForSeed(seed: number): string {
  return makePNG(8, (seed % 200) + 1).toString('base64');
}

/** Um PNG distinto por direção do v3. */
function pngForDirection(direction: string): Buffer {
  let h = 0;
  for (const ch of direction) h = (h * 31 + ch.charCodeAt(0)) % 199;
  return makePNG(16, h + 1);
}

// ------------------------------------------------------------------ client falso

type ResponseMode = 'sync' | 'async-job' | 'async-tile';

class FakeClient extends PixelLabClient {
  readonly tileBodies: Array<Record<string, unknown>> = [];
  readonly v3Bodies: Array<Record<string, unknown>> = [];
  /** GETs de /isometric-tiles — prova a recuperação por tile_id sem POST. */
  readonly tileGets: string[] = [];
  /** Ordem de chegada dos POSTs de tile — prova que a norte vem primeiro. */
  readonly order: string[] = [];
  mode: ResponseMode = 'sync';
  /** Quantos GETs de tile respondem 423 antes de entregar. */
  lockedReads = 0;
  /** Quantos jobs de tile respondem 'failed' (falha DEPOIS da cobrança). */
  failTileJobs = 0;
  /** Direções OMITIDAS de rotation_urls, para o teste de ausência. */
  omitDirections: string[] = [];
  private tileReads = new Map<string, number>();

  constructor() {
    super('fake-token-for-test-only');
  }

  /**
   * Simula o estado do fornecedor em 2026-08-01: qualquer submissão de tile
   * com init_image/color_image morre em 422 síncrono (validação pede PNG,
   * worker exige RGBA cru — incompatíveis; ver o comentário em generateTile).
   */
  rejectImageInputs = false;

  override async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    if (method === 'POST' && path === '/create-isometric-tile') {
      const b = (body ?? {}) as Record<string, unknown>;
      if (this.rejectImageInputs && ('init_image' in b || 'color_image' in b)) {
        // Antes do push: o 422 não cobra, não vira ledger e não conta corpo.
        throw new PixelLabError(
          '422 em POST /create-isometric-tile',
          422,
          '{"detail":[{"type":"value_error","loc":["body","init_image","base64"],' +
            '"msg":"Value error, decodes but is not a readable image."}]}',
          false,
        );
      }
      this.tileBodies.push(b);
      this.order.push(String(b['description']));
      const seed = Number(b['seed']);
      if (this.mode === 'sync') {
        return this.ok<T>({
          image: { type: 'base64', base64: pngForSeed(seed) },
          usage: { type: 'usd', usd: 0.0156 },
        });
      }
      return this.ok<T>({
        background_job_id: `job-${seed}`,
        tile_id: `tile-${seed}`,
        status: 'processing',
        usage: { type: 'usd', usd: 0.0156 },
      });
    }

    if (method === 'POST' && path === '/create-character-v3') {
      const b = (body ?? {}) as Record<string, unknown>;
      this.v3Bodies.push(b);
      const seed = Number(b['seed']);
      return this.ok<T>({
        background_job_id: `v3job-${seed}`,
        character_id: `char-${seed}`,
        usage: { type: 'usd', usd: 0.04 },
      });
    }

    if (method === 'GET' && path.startsWith('/background-jobs/')) {
      const id = path.slice('/background-jobs/'.length);
      if (id.startsWith('v3job-')) {
        // O job do v3 traz SÓ metadado — os pixels moram no CharacterDetail.
        return this.ok<T>({
          id,
          status: 'completed',
          created_at: '2026-08-01T00:00:00Z',
          last_response: { character_id: id.replace('v3job-', 'char-'), directions_count: 8 },
        });
      }
      if (this.failTileJobs > 0) {
        this.failTileJobs -= 1;
        return this.ok<T>({
          id,
          status: 'failed',
          created_at: '2026-08-01T00:00:00Z',
          error: 'falha simulada depois da cobrança',
        });
      }
      const seed = Number(id.replace('job-', ''));
      return this.ok<T>({
        id,
        status: 'completed',
        created_at: '2026-08-01T00:00:00Z',
        last_response:
          this.mode === 'async-job'
            ? { image: { type: 'base64', base64: pngForSeed(seed) } }
            : { tile_id: `tile-${seed}` },
      });
    }

    if (method === 'GET' && path.startsWith('/isometric-tiles/')) {
      const id = decodeURIComponent(path.slice('/isometric-tiles/'.length));
      this.tileGets.push(id);
      const seen = (this.tileReads.get(id) ?? 0) + 1;
      this.tileReads.set(id, seen);
      // 423 Locked = ainda processando, direto do spec.
      if (seen <= this.lockedReads) {
        throw new PixelLabError(`423 Locked (ainda gerando): ${path}`, 423, '', false);
      }
      const seed = Number(id.replace('tile-', ''));
      return this.ok<T>({ image: { type: 'base64', base64: pngForSeed(seed) } });
    }

    if (method === 'GET' && path.startsWith('/characters/')) {
      const urls: Record<string, string> = {};
      for (const d of DIRECTIONS) {
        if (!this.omitDirections.includes(d)) urls[d] = `https://fake.test/v3/${d}.png`;
      }
      return this.ok<T>({
        id: decodeURIComponent(path.slice('/characters/'.length)),
        status: 'completed',
        directions: 8,
        rotation_urls: urls,
      });
    }

    throw new Error(`FakeClient: chamada inesperada ${method} ${path}`);
  }

  get calls(): number {
    return this.tileBodies.length + this.v3Bodies.length;
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

/**
 * Serve os downloads de rotation_urls sem rede. Restaurar SEMPRE (finally).
 * `failOnce`/`failAlways` simulam queda no meio do lote de downloads.
 */
function mockFetch(failOnce: Set<string> = new Set(), failAlways: Set<string> = new Set()): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const m = /\/v3\/([a-z-]+)\.png$/.exec(url);
    if (!m) return new Response('não conheço essa URL', { status: 404 });
    const dir = m[1]!;
    if (failAlways.has(dir)) return new Response('erro simulado', { status: 500 });
    if (failOnce.has(dir)) {
      failOnce.delete(dir);
      return new Response('erro simulado', { status: 500 });
    }
    return new Response(new Uint8Array(pngForDirection(dir)), { status: 200 });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

// ------------------------------------------------------------------ helpers

function tmpDir(): string {
  const dir = join(tmpdir(), `world-block-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function baseConfig(): WorldBlockConfig {
  return { description: 'grass on top of dirt', seed: 5 };
}

function rotatedConfig(): WorldBlockConfig {
  return { ...baseConfig(), technique: 'rotated' };
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

function facePath(dir: string, hash: string, facing: string): string {
  return join(dir, 'assets', 'world-blocks', hash, `${facing}.png`);
}

function blockFile(dir: string, hash: string, ...rest: string[]): string {
  return join(dir, 'assets', 'world-blocks', hash, ...rest);
}

function readManifest(dir: string, hash: string): Record<string, unknown> {
  return JSON.parse(readFileSync(blockFile(dir, hash, 'block.json'), 'utf-8')) as Record<
    string,
    unknown
  >;
}

async function assertValidation(
  config: WorldBlockConfig,
  code: WorldBlockErrorCode,
): Promise<void> {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    await assert.rejects(runWorldBlock(client, config, opts(dir)), (err: unknown) => {
      assert.ok(
        err instanceof WorldBlockValidationError,
        `esperava WorldBlockValidationError, veio ${String(err)}`,
      );
      assert.equal(err.code, code);
      return true;
    });
    assert.equal(client.calls, 0, `validação ${code} não pode chamar a API`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ validação

test('description ausente ou vazia → description-required, sem chamada', async () => {
  await assertValidation({ ...baseConfig(), description: '' }, 'description-required');
  await assertValidation({ ...baseConfig(), description: '   ' }, 'description-required');
  await assertValidation({ seed: 5 } as WorldBlockConfig, 'description-required');
});

test('enums e faixas do spec fora → erros nomeados, sem chamada', async () => {
  await assertValidation({ ...baseConfig(), shape: 'cubo' as never }, 'shape-enum');
  await assertValidation({ ...baseConfig(), tileUnitSize: 24 as never }, 'tile-unit-size-enum');
  await assertValidation({ ...baseConfig(), outline: 'grosso' as never }, 'outline-enum');
  await assertValidation({ ...baseConfig(), shading: 'nenhum' as never }, 'shading-enum');
  await assertValidation({ ...baseConfig(), detail: 'muito' as never }, 'detail-enum');
  await assertValidation({ ...baseConfig(), textGuidanceScale: 0 }, 'guidance-range');
  await assertValidation({ ...baseConfig(), textGuidanceScale: 21 }, 'guidance-range');
  await assertValidation({ ...baseConfig(), seed: -1 }, 'seed-range');
  await assertValidation({ ...baseConfig(), technique: 'girado' as never }, 'technique-enum');
  await assertValidation({ ...baseConfig(), initImageStrength: 0 }, 'init-strength-range');
  await assertValidation({ ...baseConfig(), initImageStrength: 1000 }, 'init-strength-range');
});

// ------------------------------------------------------------------ hash

test('a técnica entra no hash — chained e rotated não compartilham cache', () => {
  const chained = worldBlockHash(baseConfig());
  const rotated = worldBlockHash(rotatedConfig());
  assert.notEqual(chained, rotated, 'são dois artefatos do mesmo prompt, comparáveis');
});

test('default explícito e omitido têm o MESMO hash (não se paga duas vezes o mesmo request)', () => {
  const omitido = worldBlockHash(baseConfig());
  assert.equal(omitido, worldBlockHash({ ...baseConfig(), tileUnitSize: 16 }));
  assert.equal(omitido, worldBlockHash({ ...baseConfig(), textGuidanceScale: 8 }));
  assert.notEqual(omitido, worldBlockHash({ ...baseConfig(), tileUnitSize: 32 }));
  assert.notEqual(omitido, worldBlockHash({ ...baseConfig(), textGuidanceScale: 9 }));
});

// ------------------------------------------------------------------ técnica chained

test('chained: 4 gerações, norte PRIMEIRO com o molde, e o resultado dela nas outras', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const result = await runWorldBlock(client, baseConfig(), opts(dir));

    assert.equal(client.tileBodies.length, 4, 'toda geração tem 4 vistas');
    assert.equal(client.v3Bodies.length, 0);
    assert.equal(result.generated, 4);
    assert.equal(result.technique, 'chained');

    // Norte primeiro, com o MOLDE como init_image — acolchoado no canvas da
    // API (múltiplos de 4; o 48×53 cru falha com code 3006 no fornecedor).
    assert.equal(client.order[0], facingPrompt('grass on top of dirt', 'north'));
    const northBody = client.tileBodies[0]!;
    assert.deepEqual(
      northBody['init_image'],
      { type: 'base64', base64: padPngToApiCanvas(mouldBase64(), apiImageSize()) },
      'a norte nasce do molde do cubo, no canvas da API',
    );
    assert.equal(northBody['init_image_strength'], 480);
    assert.equal(northBody['color_image'], undefined, 'a primeira não tem paleta para travar');

    // As outras três recebem o RESULTADO da norte como molde E paleta.
    const northB64 = readFileSync(facePath(dir, result.hash, 'north')).toString('base64');
    const northApiB64 = padPngToApiCanvas(northB64, apiImageSize());
    for (const b of client.tileBodies.slice(1)) {
      assert.deepEqual(
        b['init_image'],
        { type: 'base64', base64: northApiB64 },
        'o resultado da norte É o molde das outras faces',
      );
      assert.deepEqual(b['color_image'], { type: 'base64', base64: northApiB64 });
    }

    // Cada vista tem seu prompt e sua arte.
    const prompts = new Set(client.tileBodies.map((b) => String(b['description'])));
    assert.equal(prompts.size, 4);
    for (const f of BLOCK_FACINGS) {
      assert.ok(prompts.has(facingPrompt('grass on top of dirt', f)), `prompt da ${f}`);
    }
    const bytes = BLOCK_FACINGS.map((f) =>
      readFileSync(facePath(dir, result.hash, f)).toString('base64'),
    );
    assert.equal(new Set(bytes).size, 4, '4 vistas = 4 artes distintas');

    // O canvas da API é o bounding box arredondado a múltiplos de 4 — nunca o
    // canônico cru (48×53 falha no fornecedor com code 3006).
    assert.deepEqual(client.tileBodies[0]!['image_size'], apiImageSize());
    assert.equal(apiImageSize().width % 4, 0);
    assert.equal(apiImageSize().height % 4, 0);
    assert.ok(apiImageSize().width >= BLOCK_GEOMETRY.spriteWidth);
    assert.ok(apiImageSize().height >= BLOCK_GEOMETRY.spriteHeight);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chained: segunda execução com a mesma config — ZERO submissões e fromCache', async () => {
  const dir = tmpDir();
  try {
    const first = await runWorldBlock(new FakeClient(), baseConfig(), opts(dir));
    const client = new FakeClient();
    const second = await runWorldBlock(client, baseConfig(), opts(dir));

    assert.equal(client.calls, 0, 'gerar de novo com o mesmo spec não gasta nada');
    assert.equal(second.fromCache, true);
    assert.equal(second.generated, 0);
    assert.equal(second.hash, first.hash);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('canvas da API: acolchoa a múltiplos de 4 e o recorte devolve o quadro canônico intacto', () => {
  const frame = { width: BLOCK_GEOMETRY.spriteWidth, height: BLOCK_GEOMETRY.spriteHeight };
  const api = apiImageSize();

  const rgba = Buffer.alloc(frame.width * frame.height * 4);
  for (let i = 0; i < rgba.length; i += 1) rgba[i] = (i * 31 + 7) & 0xff;
  const canonical = encodePngFromRgba(rgba, frame.width, frame.height);

  // A ida emite RGBA CRU no canvas da API — é o que `Image.frombytes` do
  // backend espera; um PNG aqui derruba o job com "Expected image of size".
  const padded = Buffer.from(padPngToApiCanvas(canonical.toString('base64'), api), 'base64');
  assert.equal(padded.length, api.width * api.height * 4, 'RGBA cru, nunca PNG');

  // A API devolve os pixels CRUS do canvas DELA — a volta tem de ser a
  // inversa exata da ida.
  const cropped = apiBytesToCanonicalPng(padded, api, frame);
  const back = readPngHeader(cropped);
  assert.equal(back.width, frame.width);
  assert.equal(back.height, frame.height);
  assert.deepEqual(decodePngToRgba(cropped).data, rgba, 'ida e volta sem perder um byte');
});

test('fornecedor recusando init/color (estado 2026-08-01) → resubmete sem imagens e completa', async () => {
  const dir = tmpDir();
  try {
    const logs: string[] = [];
    const client = new FakeClient();
    client.rejectImageInputs = true;
    const result = await runWorldBlock(client, baseConfig(), opts(dir, logs));

    assert.equal(result.generated, 4, 'as 4 vistas saem mesmo com o fornecedor recusando imagem');
    assert.equal(client.tileBodies.length, 4, 'o 422 síncrono não conta como submissão');
    for (const b of client.tileBodies) {
      assert.ok(!('init_image' in b), 'o fallback remove o init_image');
      assert.ok(!('color_image' in b), 'o fallback remove o color_image');
      assert.ok(!('init_image_strength' in b));
    }
    assert.ok(
      logs.some((l) => l.includes('recusou init_image')),
      'o aviso do fallback é gritante no log',
    );
    for (const f of BLOCK_FACINGS) {
      assert.ok(existsSync(facePath(dir, result.hash, f)), `face ${f} em disco`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chained: apagar UMA face regenera só ela, encadeada na norte que está em disco', async () => {
  const dir = tmpDir();
  try {
    const first = await runWorldBlock(new FakeClient(), baseConfig(), opts(dir));
    rmSync(facePath(dir, first.hash, 'east'), { force: true });

    const client = new FakeClient();
    await runWorldBlock(client, baseConfig(), opts(dir));
    assert.equal(client.tileBodies.length, 1, 'só a face que sumiu volta a custar');
    assert.equal(client.tileBodies[0]?.['description'], facingPrompt('grass on top of dirt', 'east'));
    const northB64 = readFileSync(facePath(dir, first.hash, 'north')).toString('base64');
    assert.deepEqual(client.tileBodies[0]?.['init_image'], {
      type: 'base64',
      base64: padPngToApiCanvas(northB64, apiImageSize()),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chained: north.png sumido com irmãs em disco avisa que o encadeamento quebrou', async () => {
  const dir = tmpDir();
  const logs: string[] = [];
  try {
    const first = await runWorldBlock(new FakeClient(), baseConfig(), opts(dir));
    rmSync(facePath(dir, first.hash, 'north'), { force: true });

    const client = new FakeClient();
    await runWorldBlock(client, baseConfig(), opts(dir, logs));
    assert.equal(client.tileBodies.length, 1, 'só a norte é regenerada — regenerar as irmãs custaria 3 gerações sem ninguém pedir');
    assert.ok(
      logs.some((l) => l.includes('irmãs') && l.includes('aviso')),
      'o usuário tem que ficar sabendo que o bloco pode ter ficado incoerente',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chained: manifesto de retomada parcial NÃO perde o tile_id das faces que ficaram', async () => {
  const dir = tmpDir();
  try {
    const client1 = new FakeClient();
    client1.mode = 'async-tile';
    const first = await runWorldBlock(client1, baseConfig(), opts(dir));
    assert.equal((readManifest(dir, first.hash)['faces'] as Array<Record<string, unknown>>)[0]?.['tileId'], 'tile-5');

    // Regenera só a leste, em modo síncrono (sem tile_id novo).
    rmSync(facePath(dir, first.hash, 'east'), { force: true });
    await runWorldBlock(new FakeClient(), baseConfig(), opts(dir));

    const faces = readManifest(dir, first.hash)['faces'] as Array<Record<string, unknown>>;
    const north = faces.find((f) => f['facing'] === 'north');
    assert.equal(north?.['tileId'], 'tile-5', 'a norte não foi tocada — o caminho de volta fica');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chained: falha DEPOIS da cobrança deixa stub, e a retomada busca o tile pago sem re-submeter', async () => {
  const dir = tmpDir();
  try {
    const client1 = new FakeClient();
    client1.mode = 'async-tile';
    client1.failTileJobs = 1;
    await assert.rejects(runWorldBlock(client1, baseConfig(), opts(dir)));
    assert.equal(client1.tileBodies.length, 1, 'a norte foi submetida (e cobrada) uma vez');

    const hash = worldBlockHash(baseConfig());
    const stub = JSON.parse(
      readFileSync(`${facePath(dir, hash, 'north')}.pending.json`, 'utf-8'),
    ) as Record<string, unknown>;
    assert.equal(stub['tileId'], 'tile-5', 'o caminho de volta fica em disco na hora da submissão');

    const client2 = new FakeClient();
    client2.mode = 'async-tile';
    const second = await runWorldBlock(client2, baseConfig(), opts(dir));
    assert.ok(client2.tileGets.includes('tile-5'), 'a retomada busca o tile pago por id');
    assert.equal(
      client2.tileBodies.filter((b) => String(b['description']).includes('north')).length,
      0,
      'a norte NÃO é re-submetida — re-pagar o que já foi pago é o pior bug deste sistema',
    );
    assert.equal(client2.tileBodies.length, 3, 'só as três irmãs restantes são novas');
    assert.equal(
      readFileSync(facePath(dir, second.hash, 'north')).toString('base64'),
      pngForSeed(5),
      'o PNG veio do tile pago original',
    );
    assert.ok(!existsSync(`${facePath(dir, hash, 'north')}.pending.json`), 'stub some após o resgate');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ formas de resposta

for (const mode of ['sync', 'async-job', 'async-tile'] as const) {
  test(`resposta ${mode} → mesmo PNG em disco (o status HTTP não diz se é assíncrono)`, async () => {
    const dir = tmpDir();
    try {
      const client = new FakeClient();
      client.mode = mode;
      const result = await runWorldBlock(client, baseConfig(), opts(dir));
      assert.equal(
        readFileSync(facePath(dir, result.hash, 'north')).toString('base64'),
        pngForSeed(5),
        `a forma ${mode} tem que entregar o mesmo PNG`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('423 Locked no GET do tile é "ainda processando", não erro', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    client.mode = 'async-tile';
    client.lockedReads = 1;
    const result = await runWorldBlock(client, baseConfig(), opts(dir));
    assert.ok(existsSync(facePath(dir, result.hash, 'north')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ técnica rotated

test('rotated: 1 tile (source com o molde) + 1 v3, 8 direções em v3/, 4 faces no quadro 48×53', async () => {
  const dir = tmpDir();
  const restore = mockFetch();
  try {
    const client = new FakeClient();
    const result = await runWorldBlock(client, rotatedConfig(), opts(dir));

    assert.equal(client.tileBodies.length, 1, 'um tile só: a source');
    assert.equal(client.v3Bodies.length, 1, 'um v3 só: as 8 direções');
    assert.equal(result.generated, 2);
    assert.equal(result.technique, 'rotated');

    // A source nasce do molde, como na chained — acolchoado no canvas da API.
    assert.deepEqual(client.tileBodies[0]!['init_image'], {
      type: 'base64',
      base64: padPngToApiCanvas(mouldBase64(), apiImageSize()),
    });
    assert.ok(existsSync(blockFile(dir, result.hash, 'source.png')));

    // O v3 recebe a source como reference_image, na vista do projeto.
    const sourceB64 = readFileSync(blockFile(dir, result.hash, 'source.png')).toString('base64');
    const v3 = client.v3Bodies[0]!;
    assert.deepEqual(v3['reference_image'], { type: 'base64', base64: sourceB64 });
    assert.equal(v3['view'], 'low top-down');
    assert.equal(v3['no_background'], true);

    // As 8 direções ficam em disco — imagens separadas, nada de GIF.
    for (const d of DIRECTIONS) {
      assert.ok(existsSync(blockFile(dir, result.hash, 'v3', `${d}.png`)), `v3/${d}.png`);
    }

    // As 4 faces existem NO QUADRO CANÔNICO 48×53 — o mesmo contrato de pixel
    // da técnica chained. Quadro quadrado desenharia o bloco a ~90% da célula.
    for (const f of BLOCK_FACINGS) {
      const head = readPngHeader(readFileSync(facePath(dir, result.hash, f)));
      assert.equal(head.width, BLOCK_GEOMETRY.spriteWidth, `largura da ${f}`);
      assert.equal(head.height, BLOCK_GEOMETRY.spriteHeight, `altura da ${f}`);
    }
    const faces = BLOCK_FACINGS.map((f) =>
      readFileSync(facePath(dir, result.hash, f)).toString('base64'),
    );
    assert.equal(new Set(faces).size, 4, '4 vistas distintas também aqui');

    // Ledger: as duas submissões, com o caminho de volta ao artefato pago.
    const lines = readLedger(dir);
    assert.equal(lines.length, 2);
    assert.equal(lines[0]?.['endpoint'], 'create-isometric-tile');
    assert.equal(lines[1]?.['endpoint'], 'create-character-v3');
    assert.equal(lines[1]?.['remoteId'], 'char-6', 'character_id no ledger');

    // Manifesto: source + character + mapeamento registrados.
    const manifest = readManifest(dir, result.hash);
    assert.equal(manifest['version'], 2);
    assert.equal(manifest['technique'], 'rotated');
    assert.equal((manifest['character'] as Record<string, unknown>)['id'], 'char-6');
    assert.ok(manifest['source'], 'a source de tile fica registrada');
    assert.equal(
      manifest['v3Mapping'],
      BLOCK_FACINGS.map((f) => FACING_TO_V3_DIRECTION[f]).join(','),
    );
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotated: faces apagadas com v3/ em disco rederivam DE GRAÇA — zero chamadas', async () => {
  const dir = tmpDir();
  const restore = mockFetch();
  try {
    const first = await runWorldBlock(new FakeClient(), rotatedConfig(), opts(dir));
    for (const f of BLOCK_FACINGS) rmSync(facePath(dir, first.hash, f), { force: true });

    const client = new FakeClient();
    const second = await runWorldBlock(client, rotatedConfig(), opts(dir));
    assert.equal(client.calls, 0, 'rederivar de v3/ não pode tocar a rede');
    assert.equal(second.fromCache, true);
    for (const f of BLOCK_FACINGS) assert.ok(existsSync(facePath(dir, first.hash, f)));
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotated: falha no download deixa o stub do v3, e a retomada NÃO paga outro v3', async () => {
  const dir = tmpDir();
  const eastDir = FACING_TO_V3_DIRECTION.east;
  const restoreFail = mockFetch(new Set([eastDir]));
  try {
    const client1 = new FakeClient();
    await assert.rejects(
      runWorldBlock(client1, rotatedConfig(), opts(dir)),
      new RegExp(eastDir),
      'direção necessária que falha derruba a execução',
    );
    assert.equal(client1.v3Bodies.length, 1, 'o v3 foi submetido (e cobrado) uma vez');
    const hash = worldBlockHash(rotatedConfig());
    assert.ok(
      existsSync(blockFile(dir, hash, 'v3', 'character.json')),
      'o stub com o character_id fica em disco na hora da submissão',
    );

    restoreFail();
    const restoreOk = mockFetch();
    try {
      const client2 = new FakeClient();
      const second = await runWorldBlock(client2, rotatedConfig(), opts(dir));
      assert.equal(client2.calls, 0, 'a retomada busca o personagem pago de graça — nenhum POST');
      assert.equal(second.generated, 0);
      for (const f of BLOCK_FACINGS) assert.ok(existsSync(facePath(dir, hash, f)));
      assert.equal(
        (readManifest(dir, hash)['character'] as Record<string, unknown>)['id'],
        'char-6',
        'o personagem retomado fica registrado no manifesto',
      );
      assert.ok(
        !existsSync(blockFile(dir, hash, 'v3', 'character.json')),
        'stub some depois de as direções chegarem',
      );
    } finally {
      restoreOk();
    }
  } finally {
    restoreFail();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotated: falha de download em direção NÃO usada não derruba o v3 pago', async () => {
  const dir = tmpDir();
  const restore = mockFetch(new Set(), new Set(['south-west']));
  try {
    const client = new FakeClient();
    const result = await runWorldBlock(client, rotatedConfig(), opts(dir));
    assert.equal(result.generated, 2);
    for (const f of BLOCK_FACINGS) assert.ok(existsSync(facePath(dir, result.hash, f)));
    assert.ok(
      !existsSync(blockFile(dir, result.hash, 'v3', 'south-west.png')),
      'a direção que falhou fica de fora, sem derrubar a execução',
    );
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotated: direção necessária ausente de rotation_urls é erro explícito', async () => {
  const dir = tmpDir();
  const restore = mockFetch();
  try {
    const client = new FakeClient();
    client.omitDirections = [FACING_TO_V3_DIRECTION.east];
    await assert.rejects(
      runWorldBlock(client, rotatedConfig(), opts(dir)),
      new RegExp(FACING_TO_V3_DIRECTION.east),
    );
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotated: manifesto e source apagados com as 4 faces em disco NÃO geram tile órfão', async () => {
  const dir = tmpDir();
  const restore = mockFetch();
  try {
    const first = await runWorldBlock(new FakeClient(), rotatedConfig(), opts(dir));
    rmSync(blockFile(dir, first.hash, 'block.json'), { force: true });
    rmSync(blockFile(dir, first.hash, 'source.png'), { force: true });

    const client = new FakeClient();
    const second = await runWorldBlock(client, rotatedConfig(), opts(dir));
    assert.equal(client.calls, 0, 'uma source que ninguém consome seria custo surpresa');
    assert.equal(second.fromCache, true);
    assert.ok(existsSync(blockFile(dir, first.hash, 'block.json')), 'o manifesto volta');
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotated: mapeamento diferente no manifesto invalida a leitura e rederiva de graça', async () => {
  const dir = tmpDir();
  const restore = mockFetch();
  try {
    const first = await runWorldBlock(new FakeClient(), rotatedConfig(), opts(dir));
    const assets = join(dir, 'assets');

    // Simula um flip de FACING_TO_V3_DIRECTION feito DEPOIS desta derivação.
    const manifest = readManifest(dir, first.hash);
    writeFileSync(
      blockFile(dir, first.hash, 'block.json'),
      `${JSON.stringify({ ...manifest, v3Mapping: 'south,west,north,east' }, null, 2)}\n`,
    );

    assert.equal(
      await readWorldBlockResult(first.hash, assets),
      null,
      'faces derivadas com OUTRO mapeamento não podem passar por prontas',
    );

    const client = new FakeClient();
    const second = await runWorldBlock(client, rotatedConfig(), opts(dir));
    assert.equal(client.calls, 0, 'rederivar por flip de mapeamento não custa nada');
    assert.equal(second.faces.length, 4);
    assert.equal(
      readManifest(dir, first.hash)['v3Mapping'],
      BLOCK_FACINGS.map((f) => FACING_TO_V3_DIRECTION[f]).join(','),
      'o manifesto passa a registrar o mapeamento vigente',
    );
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ guard e ledger

test('o guard informa o custo das 4 gerações e nunca recusa (ADR 0012)', async () => {
  const dir = tmpDir();
  const logs: string[] = [];
  try {
    await runWorldBlock(new FakeClient(), baseConfig(), opts(dir, logs));
    const guard = logs.find((l) => l.startsWith('[guard]'));
    assert.ok(guard, 'toda execução que gasta tem que logar a estimativa');
    assert.match(guard, /create-isometric-tile \(4× world-block, molde encadeado/);
    assert.match(guard, /USD/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotated: o guard informa os DOIS endpoints antes de gastar', async () => {
  const dir = tmpDir();
  const logs: string[] = [];
  const restore = mockFetch();
  try {
    await runWorldBlock(new FakeClient(), rotatedConfig(), opts(dir, logs));
    assert.ok(logs.some((l) => l.includes('create-isometric-tile (1× world-block source')));
    assert.ok(logs.some((l) => l.includes('create-character-v3 (8 direções')));
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chained: tile_id no ledger E no manifesto (caminho de volta ao artefato pago)', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    client.mode = 'async-tile';
    const result = await runWorldBlock(client, baseConfig(), opts(dir));

    const lines = readLedger(dir);
    assert.equal(lines.length, 4);
    assert.equal(lines[0]?.['tileId'], 'tile-5');
    assert.equal(lines[0]?.['jobId'], 'job-5');
    assert.equal(lines[0]?.['endpoint'], 'create-isometric-tile');
    assert.equal(lines[0]?.['kind'], 'world-block');

    const manifest = readManifest(dir, result.hash) as { faces: Array<Record<string, unknown>> };
    assert.equal(manifest.faces[0]?.['tileId'], 'tile-5');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ leitura e catálogo

test('readWorldBlockResult — null para hash desconhecido e para bloco incompleto', async () => {
  const dir = tmpDir();
  try {
    assert.equal(await readWorldBlockResult('0'.repeat(16), join(dir, 'assets')), null);

    const result = await runWorldBlock(new FakeClient(), baseConfig(), opts(dir));
    assert.ok(await readWorldBlockResult(result.hash, join(dir, 'assets')));

    rmSync(facePath(dir, result.hash, 'west'), { force: true });
    assert.equal(
      await readWorldBlockResult(result.hash, join(dir, 'assets')),
      null,
      'bloco pela metade não é bloco',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listWorldBlocks só publica bloco COMPLETO do formato v2, em ordem estável', async () => {
  const dir = tmpDir();
  try {
    const a = await runWorldBlock(new FakeClient(), baseConfig(), opts(dir));
    const b = await runWorldBlock(
      new FakeClient(),
      { ...baseConfig(), description: 'cobblestone', seed: 9 },
      opts(dir),
    );

    let list = await listWorldBlocks(join(dir, 'assets'));
    assert.equal(list.length, 2);
    assert.deepEqual(
      list.map((x) => x.hash),
      [a.hash, b.hash].sort((p, q) => p.localeCompare(q)),
      'ordem estável: a paleta não pode dançar entre recargas',
    );
    assert.equal(list[0]?.technique, 'chained');
    assert.deepEqual(Object.keys(list[0]?.faceUrls ?? {}).sort(), [...BLOCK_FACINGS].sort());
    assert.match(String(list[0]?.faceUrls?.north ?? ''), /^\/world-blocks\/[a-f0-9]{16}\/north\.png$/);

    // Bloco pela metade sai da paleta: colocá-lo falharia na hora do desenho.
    rmSync(facePath(dir, b.hash, 'south'), { force: true });
    list = await listWorldBlocks(join(dir, 'assets'));
    assert.deepEqual(list.map((x) => x.hash), [a.hash]);

    // Manifesto do formato antigo (version 1, era uniforme) não entra: aquele
    // catálogo foi arquivado junto com a feature.
    const oldDir = join(dir, 'assets', 'world-blocks', 'aaaaaaaaaaaaaaaa');
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(
      join(oldDir, 'block.json'),
      JSON.stringify({ version: 1, hash: 'aaaaaaaaaaaaaaaa', facingMode: 'uniform', faces: [] }),
    );
    for (const f of BLOCK_FACINGS) writeFileSync(join(oldDir, `${f}.png`), 'nada');
    list = await listWorldBlocks(join(dir, 'assets'));
    assert.deepEqual(list.map((x) => x.hash), [a.hash]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listWorldBlocks — [] quando nunca se gerou nada', async () => {
  const dir = tmpDir();
  try {
    assert.deepEqual(await listWorldBlocks(join(dir, 'assets')), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
