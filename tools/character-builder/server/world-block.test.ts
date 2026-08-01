/**
 * Teste da bancada de blocos do mundo (/create-isometric-tile) com cliente falso.
 *
 * Propriedades verificadas (sem rede):
 *   1. Validação ANTES de gastar: description, size 16–64, e os enums do spec
 *      (shape, isometric_tile_size, outline, shading, detail, guidance, seed,
 *      facingMode) — erro nomeado e ZERO chamadas.
 *   2. Modo uniforme custa UMA geração e mesmo assim entrega as quatro faces
 *      em disco (é a regra de "nada de custo surpresa" aplicada à paleta).
 *   3. Modo orientado custa QUATRO, a face norte sai primeiro e as outras três
 *      recebem color_image travado nela.
 *   4. As duas formas de resposta do endpoint — 200 com `image` embutido e
 *      202 com {background_job_id, tile_id} — produzem o mesmo PNG em disco.
 *   5. Idempotência por face: PNG existente = zero chamada naquela face.
 *   6. tile_id no ledger E no manifesto: o caminho de volta ao artefato pago.
 *   7. listWorldBlocks só publica bloco COMPLETO.
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
import {
  runWorldBlock,
  readWorldBlockResult,
  listWorldBlocks,
  facingPrompt,
  worldBlockHash,
  WorldBlockValidationError,
  BLOCK_FACINGS,
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

/** PNG RGB válido; `fill` distingue arquivos. */
function makePNG(side: number, fill: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(side, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(side * (1 + side * 3), fill & 0xff);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Um PNG distinto por seed — é como provamos qual face é qual. */
function pngForSeed(seed: number): string {
  return makePNG(8, (seed % 200) + 1).toString('base64');
}

// ------------------------------------------------------------------ client falso

type ResponseMode = 'sync' | 'async-job' | 'async-tile';

class FakeClient extends PixelLabClient {
  readonly bodies: Array<Record<string, unknown>> = [];
  /** Ordem de chegada dos POSTs — prova que a norte vem primeiro. */
  readonly order: string[] = [];
  /**
   * 'sync'       → 200 com image embutida;
   * 'async-job'  → 202 e a imagem vem no last_response do job;
   * 'async-tile' → 202, job sem imagem, e o PNG só existe em GET /isometric-tiles.
   */
  mode: ResponseMode = 'sync';
  /** Quantos GETs de tile respondem 423 antes de entregar. */
  lockedReads = 0;
  private tileReads = new Map<string, number>();

  constructor() {
    super('fake-token-for-test-only');
  }

  override async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    if (method === 'POST' && path === '/create-isometric-tile') {
      const b = (body ?? {}) as Record<string, unknown>;
      this.bodies.push(b);
      const seed = Number(b['seed']);
      this.order.push(String(b['description']));
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

    if (method === 'GET' && path.startsWith('/background-jobs/')) {
      const id = path.slice('/background-jobs/'.length);
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
      const seen = (this.tileReads.get(id) ?? 0) + 1;
      this.tileReads.set(id, seen);
      // 423 Locked = ainda processando, direto do spec.
      if (seen <= this.lockedReads) {
        throw new PixelLabError(`423 Locked (ainda gerando): ${path}`, 423, '', false);
      }
      const seed = Number(id.replace('tile-', ''));
      return this.ok<T>({ image: { type: 'base64', base64: pngForSeed(seed) } });
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
  const dir = join(tmpdir(), `world-block-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function baseConfig(): WorldBlockConfig {
  return { description: 'grass on top of dirt', size: 32 };
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
    assert.equal(client.bodies.length, 0, `validação ${code} não pode chamar a API`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ validação

test('description ausente ou vazia → description-required, sem chamada', async () => {
  await assertValidation({ ...baseConfig(), description: '' }, 'description-required');
  await assertValidation({ ...baseConfig(), description: '   ' }, 'description-required');
  await assertValidation({ size: 32 } as WorldBlockConfig, 'description-required');
});

test('size fora de 16–64 (faixa do ImageSize do endpoint) → size-range', async () => {
  await assertValidation({ ...baseConfig(), size: 15 }, 'size-range');
  await assertValidation({ ...baseConfig(), size: 65 }, 'size-range');
  await assertValidation({ ...baseConfig(), size: 32.5 }, 'size-range');
});

test('enums do spec fora da faixa → erros nomeados', async () => {
  await assertValidation(
    { ...baseConfig(), shape: 'cubo' as never },
    'shape-enum',
  );
  await assertValidation(
    { ...baseConfig(), tileUnitSize: 24 as never },
    'tile-unit-size-enum',
  );
  await assertValidation({ ...baseConfig(), outline: 'grosso' as never }, 'outline-enum');
  await assertValidation({ ...baseConfig(), shading: 'nenhum' as never }, 'shading-enum');
  await assertValidation({ ...baseConfig(), detail: 'muito' as never }, 'detail-enum');
  await assertValidation({ ...baseConfig(), textGuidanceScale: 0 }, 'guidance-range');
  await assertValidation({ ...baseConfig(), textGuidanceScale: 21 }, 'guidance-range');
  await assertValidation({ ...baseConfig(), seed: -1 }, 'seed-range');
  await assertValidation({ ...baseConfig(), facingMode: 'girado' as never }, 'facing-mode-enum');
});

// ------------------------------------------------------------------ modo uniforme

test('uniforme: UMA geração e ainda assim as quatro faces em disco', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const result = await runWorldBlock(client, { ...baseConfig(), seed: 5 }, opts(dir));

    assert.equal(client.bodies.length, 1, 'material uniforme não paga quatro vezes');
    assert.equal(result.generated, 1);
    assert.equal(result.faces.length, 4);

    for (const f of BLOCK_FACINGS) {
      assert.ok(existsSync(facePath(dir, result.hash, f)), `face ${f} em disco`);
    }
    // As quatro faces são a MESMA arte — é o que "uniforme" quer dizer.
    const bytes = BLOCK_FACINGS.map((f) =>
      readFileSync(facePath(dir, result.hash, f)).toString('base64'),
    );
    assert.equal(new Set(bytes).size, 1, 'uniforme = uma arte só');
    assert.deepEqual(
      result.faces.map((f) => f.reused),
      [false, true, true, true],
      'só a norte foi gerada; as outras três são reuso declarado',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uniforme: a descrição vai crua, sem sufixo de face', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    await runWorldBlock(client, { ...baseConfig(), seed: 5 }, opts(dir));
    assert.equal(client.bodies[0]?.['description'], 'grass on top of dirt');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ modo orientado

test('orientado: QUATRO gerações, norte primeiro, e sufixo de face por vista', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const result = await runWorldBlock(
      client,
      { ...baseConfig(), seed: 5, facingMode: 'oriented' },
      opts(dir),
    );

    assert.equal(client.bodies.length, 4, 'bloco orientado é uma geração por vista');
    assert.equal(result.generated, 4);
    assert.equal(
      client.order[0],
      facingPrompt('grass on top of dirt', 'north'),
      'a norte tem que ser a PRIMEIRA — é dela que sai a paleta',
    );
    const prompts = new Set(client.bodies.map((b) => String(b['description'])));
    assert.equal(prompts.size, 4, 'cada vista tem seu próprio prompt');
    for (const f of BLOCK_FACINGS) {
      assert.ok(prompts.has(facingPrompt('grass on top of dirt', f)), `prompt da ${f}`);
    }
    assert.deepEqual(
      result.faces.map((f) => f.reused),
      [false, false, false, false],
      'nada é reusado no modo orientado',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('orientado: as três faces seguintes recebem color_image travado na norte', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const result = await runWorldBlock(
      client,
      { ...baseConfig(), seed: 5, facingMode: 'oriented' },
      opts(dir),
    );

    // O que trava a paleta é o PNG JÁ CODIFICADO da norte, não os bytes crus
    // que a API devolveu: é esse arquivo que existe em disco e é ele que a
    // próxima geração tem que enxergar.
    const northB64 = readFileSync(facePath(dir, result.hash, 'north')).toString('base64');
    assert.equal(client.bodies[0]?.['color_image'], undefined, 'a primeira não tem no que travar');
    for (const b of client.bodies.slice(1)) {
      assert.deepEqual(
        b['color_image'],
        { type: 'base64', base64: northB64 },
        'sem paleta travada as quatro vistas param de parecer o mesmo bloco',
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('orientado com lockPalette=false: nenhuma face recebe color_image', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    await runWorldBlock(
      client,
      { ...baseConfig(), seed: 5, facingMode: 'oriented', lockPalette: false },
      opts(dir),
    );
    for (const b of client.bodies) assert.equal(b['color_image'], undefined);
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
      const result = await runWorldBlock(client, { ...baseConfig(), seed: 5 }, opts(dir));
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
    const result = await runWorldBlock(client, { ...baseConfig(), seed: 5 }, opts(dir));
    assert.ok(existsSync(facePath(dir, result.hash, 'north')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ idempotência e ledger

test('segunda execução com a mesma config — ZERO submissões e fromCache', async () => {
  const dir = tmpDir();
  try {
    const first = await runWorldBlock(new FakeClient(), { ...baseConfig(), seed: 5 }, opts(dir));
    const client = new FakeClient();
    const second = await runWorldBlock(client, { ...baseConfig(), seed: 5 }, opts(dir));

    assert.equal(client.bodies.length, 0, 'gerar de novo com o mesmo spec não gasta nada');
    assert.equal(second.fromCache, true);
    assert.equal(second.generated, 0);
    assert.equal(second.hash, first.hash);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('orientado: apagar UMA face regenera só ela', async () => {
  const dir = tmpDir();
  try {
    const cfg: WorldBlockConfig = { ...baseConfig(), seed: 5, facingMode: 'oriented' };
    const first = await runWorldBlock(new FakeClient(), cfg, opts(dir));
    rmSync(facePath(dir, first.hash, 'east'), { force: true });

    const client = new FakeClient();
    await runWorldBlock(client, cfg, opts(dir));
    assert.equal(client.bodies.length, 1, 'só a face que sumiu volta a custar');
    assert.equal(client.bodies[0]?.['description'], facingPrompt(cfg.description, 'east'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('facingMode entra no hash — uniforme e orientado não compartilham cache', () => {
  const uniform = worldBlockHash({ ...baseConfig(), seed: 5 });
  const oriented = worldBlockHash({ ...baseConfig(), seed: 5, facingMode: 'oriented' });
  assert.notEqual(uniform, oriented, 'reusar arte uniforme como se fosse orientada é mentira');
});

test('tile_id e jobId no ledger E no manifesto (caminho de volta ao artefato pago)', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    client.mode = 'async-tile';
    const result = await runWorldBlock(client, { ...baseConfig(), seed: 5 }, opts(dir));

    const lines = readLedger(dir);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.['tileId'], 'tile-5');
    assert.equal(lines[0]?.['jobId'], 'job-5');
    assert.equal(lines[0]?.['endpoint'], 'create-isometric-tile');
    assert.equal(lines[0]?.['kind'], 'world-block');

    const manifest = JSON.parse(
      readFileSync(join(dir, 'assets', 'world-blocks', result.hash, 'block.json'), 'utf-8'),
    ) as { faces: Array<Record<string, unknown>> };
    assert.equal(manifest.faces[0]?.['tileId'], 'tile-5');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('o guard informa o custo e nunca recusa (ADR 0012)', async () => {
  const dir = tmpDir();
  const logs: string[] = [];
  try {
    await runWorldBlock(new FakeClient(), { ...baseConfig(), seed: 5 }, opts(dir, logs));
    const guard = logs.find((l) => l.startsWith('[guard]'));
    assert.ok(guard, 'toda execução que gasta tem que logar a estimativa');
    assert.match(guard, /create-isometric-tile \(1× world-block, modo uniform/);
    assert.match(guard, /USD/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ leitura e catálogo

test('readWorldBlockResult — null para hash desconhecido e para bloco incompleto', async () => {
  const dir = tmpDir();
  try {
    assert.equal(await readWorldBlockResult('0'.repeat(16), join(dir, 'assets')), null);

    const result = await runWorldBlock(new FakeClient(), { ...baseConfig(), seed: 5 }, opts(dir));
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

test('listWorldBlocks só publica bloco COMPLETO, em ordem estável', async () => {
  const dir = tmpDir();
  try {
    const a = await runWorldBlock(new FakeClient(), { ...baseConfig(), seed: 5 }, opts(dir));
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
    assert.deepEqual(Object.keys(list[0]?.faceUrls ?? {}).sort(), [...BLOCK_FACINGS].sort());
    assert.match(String(list[0]?.faceUrls.north), /^\/world-blocks\/[a-f0-9]{16}\/north\.png$/);

    // Bloco pela metade sai da paleta: colocá-lo falharia na hora do desenho.
    rmSync(facePath(dir, b.hash, 'south'), { force: true });
    list = await listWorldBlocks(join(dir, 'assets'));
    assert.deepEqual(list.map((x) => x.hash), [a.hash]);

    // Pasta sem manifesto também não entra.
    mkdirSync(join(dir, 'assets', 'world-blocks', 'lixo'), { recursive: true });
    writeFileSync(join(dir, 'assets', 'world-blocks', 'lixo', 'north.png'), 'nada');
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
