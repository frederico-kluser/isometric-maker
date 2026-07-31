/**
 * Teste do fluxo do wizard (server/mannequin.ts) com cliente falso.
 *
 * Cobre, sem tocar a API de verdade:
 *   1. fluxo sul → edição → undo (versões e activeSouth);
 *   2. paralelismo das cardeais: E ∥ N concorrentes, W só depois;
 *   3. idempotência em cada passo (segunda execução não chama a API);
 *   4. directions8 exige studio.lock;
 *   5. directions8 monta o mapa directions com as 4 cardeais certas;
 *   6. erro explícito quando falta cardeal.
 *
 * Execute com: node --test server/mannequin.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { PixelLabClient, type ApiResult } from '../../pixellab-pipeline/src/api.ts';
import {
  DIRECTIONS, cardinalKey, directions8Key, seedStudio, southKey,
  type Studio,
} from './model.ts';
import {
  generateSouthFromText, editSouth, undoSouth, rotateCardinals, generateDirections8,
  type StudioStore, type WizardOpts,
} from './mannequin.ts';

// ------------------------------------------------------------------ PNGs falsos

const SIZE = 64;

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

/** PNG RGBA 8bpc de cor sólida — suficiente para validateImport e para o decode da prova de congelamento. */
function makeSolidPNG(size: number, r: number, g: number, b: number): string {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type 6 = RGBA
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x += 1) {
    row[1 + x * 4] = r;
    row[2 + x * 4] = g;
    row[3 + x * 4] = b;
    row[4 + x * 4] = 255;
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

// Cores diferentes por direção: dá para distinguir quem é quem no mapa directions.
const PNG_SOUTH = makeSolidPNG(SIZE, 200, 30, 30);
const PNG_SOUTH_EDITED = makeSolidPNG(SIZE, 30, 200, 30);
const PNG_EAST = makeSolidPNG(SIZE, 30, 30, 200);
const PNG_NORTH = makeSolidPNG(SIZE, 200, 200, 30);
const PNG_WEST = makeSolidPNG(SIZE, 200, 30, 200);
const PNG_DIAGONAL = makeSolidPNG(SIZE, 90, 90, 90);

// ------------------------------------------------------------------ store em memória

class MemStore implements StudioStore {
  studio: Studio;

  constructor(studio: Studio) {
    this.studio = studio;
  }

  async load(): Promise<Studio> {
    return this.studio;
  }
  async save(s: Studio): Promise<void> {
    this.studio = s;
  }
}

// ------------------------------------------------------------------ client falso

interface RecordedCall {
  readonly method: string;
  readonly path: string;
  readonly body?: Record<string, unknown>;
}

class FakeClient extends PixelLabClient {
  readonly calls: RecordedCall[] = [];
  /** Linha do tempo de início/fim das chamadas — prova de concorrência. */
  readonly events: string[] = [];
  /** Último mapa directions submetido ao endpoint de 8 direções. */
  lastDirections: Record<string, string> | undefined;
  editSeq = 0;
  /** Atraso do /rotate para que E e N só se sobreponham se forem concorrentes. */
  rotateDelayMs = 5;

  constructor() {
    super('fake-token-for-test-only');
  }

  count(path: string): number {
    return this.calls.filter((c) => c.method === 'POST' && c.path === path).length;
  }

  override async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    const b = body as Record<string, unknown> | undefined;
    this.calls.push({ method, path, ...(b ? { body: b } : {}) });

    if (method === 'POST' && path === '/create-image-bitforge') {
      return this.ok<T>({ image: PNG_SOUTH, usage: { type: 'usd', usd: 0.0072 } });
    }

    if (method === 'POST' && path === '/edit-image') {
      this.editSeq += 1;
      return this.ok<T>(
        {
          background_job_id: `job-edit-${this.editSeq}`,
          status: 'processing',
          usage: { type: 'usd', usd: 0.0072 },
        },
        202,
      );
    }

    if (method === 'POST' && path === '/rotate') {
      const to = String(b?.['to_direction']);
      this.events.push(`start:rotate:${to}`);
      await new Promise((resolve) => setTimeout(resolve, this.rotateDelayMs));
      this.events.push(`end:rotate:${to}`);
      const img = to === 'east' ? PNG_EAST : to === 'north' ? PNG_NORTH : PNG_WEST;
      return this.ok<T>({ image: img, usage: { type: 'usd', usd: 0.0106 } });
    }

    if (method === 'POST' && path === '/create-character-with-8-directions') {
      this.lastDirections = { ...(b?.['directions'] as Record<string, string>) };
      return this.ok<T>({
        background_job_id: 'job-dir8',
        character_id: 'remote-char-1',
        status: 'processing',
        usage: { type: 'usd', usd: 0.0173 },
      });
    }

    if (method === 'GET' && path.startsWith('/background-jobs/')) {
      const id = path.slice('/background-jobs/'.length);
      if (id.startsWith('job-edit-')) {
        return this.ok<T>({
          id,
          status: 'completed',
          created_at: '2026-07-31T00:00:00Z',
          last_response: { image: PNG_SOUTH_EDITED },
        });
      }
      if (id === 'job-dir8') {
        const d = this.lastDirections ?? {};
        // Cardeais congeladas: devolve byte-a-byte o que foi enviado, mais as
        // 4 diagonais geradas — rotation_urls keyeado por nome de direção.
        return this.ok<T>({
          id,
          status: 'completed',
          created_at: '2026-07-31T00:00:00Z',
          last_response: {
            south: d['south'],
            east: d['east'],
            north: d['north'],
            west: d['west'],
            rotation_urls: {
              south: [d['south']],
              'south-west': [PNG_DIAGONAL],
              west: [d['west']],
              'north-west': [PNG_DIAGONAL],
              north: [d['north']],
              'north-east': [PNG_DIAGONAL],
              east: [d['east']],
              'south-east': [PNG_DIAGONAL],
            },
          },
        });
      }
    }

    throw new Error(`FakeClient: chamada inesperada ${method} ${path}`);
  }

  private ok<T>(data: unknown, status = 200): ApiResult<T> {
    const usage = (data as { usage?: ApiResult<T>['usage'] }).usage;
    return {
      data: data as T,
      status,
      raw: JSON.stringify(data),
      ...(usage ? { usage } : {}),
    };
  }
}

// ------------------------------------------------------------------ harness

const CHAR_ID = 'manequim';

function tmpDir(): string {
  const dir = join(tmpdir(), `mannequin-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface Harness {
  readonly dir: string;
  readonly store: MemStore;
  readonly opts: WizardOpts;
  readonly logs: string[];
}

function makeHarness(withLock = true): Harness {
  const dir = tmpDir();
  const studio = seedStudio();
  if (withLock) {
    studio.lock = { frameCount: 8, fps: 8, size: SIZE };
  }
  const store = new MemStore(studio);
  const logs: string[] = [];
  const opts: WizardOpts = {
    assetsDir: join(dir, 'assets'),
    ledgerPath: join(dir, 'assets', 'ledger.ndjson'),
    onLog: (m) => logs.push(m),
  };
  return { dir, store, opts, logs };
}

function wizardOf(store: MemStore) {
  const wiz = store.studio.characters[0]?.wizard;
  assert.ok(wiz, 'wizard deveria existir');
  return wiz;
}

function southFile(opts: WizardOpts, version: number): string {
  return join(opts.assetsDir, 'wizard', CHAR_ID, `south-v${version}.png`);
}

// ------------------------------------------------------------------ testes

test('fluxo sul → edição → undo: versões e activeSouth', async () => {
  const { dir, store, opts } = makeHarness();
  try {
    const client = new FakeClient();

    await generateSouthFromText(client, store, CHAR_ID, 'guerreiro careca', opts);

    let wiz = wizardOf(store);
    assert.equal(wiz.southVersions.length, 1);
    assert.equal(wiz.southVersions[0]?.prompt, 'guerreiro careca');
    assert.equal(wiz.activeSouth, 0);
    assert.equal(wiz.etapa, 'cardeais');
    assert.equal(store.studio.characters[0]?.description, 'guerreiro careca');
    assert.deepEqual(store.studio.cells[southKey(CHAR_ID)]?.frames, {
      south: [`/assets/wizard/${CHAR_ID}/south-v0.png`],
    });
    assert.ok(existsSync(southFile(opts, 0)), 'south-v0.png deveria existir');
    assert.equal(readFileSync(southFile(opts, 0)).toString('base64'), PNG_SOUTH);

    await editSouth(client, store, CHAR_ID, 'deixar o cabelo maior', opts);

    wiz = wizardOf(store);
    assert.equal(wiz.southVersions.length, 2);
    assert.equal(wiz.southVersions[1]?.prompt, 'deixar o cabelo maior');
    assert.equal(wiz.activeSouth, 1);
    assert.ok(existsSync(southFile(opts, 1)), 'south-v1.png deveria existir');
    assert.equal(
      readFileSync(southFile(opts, 1)).toString('base64'),
      PNG_SOUTH_EDITED,
      'v1 gravada é a imagem devolvida pelo job de edição',
    );
    assert.deepEqual(store.studio.cells[southKey(CHAR_ID)]?.frames, {
      south: [`/assets/wizard/${CHAR_ID}/south-v1.png`],
    });

    await undoSouth(store, CHAR_ID, opts);

    wiz = wizardOf(store);
    assert.equal(wiz.activeSouth, 0);
    assert.equal(wiz.southVersions.length, 2, 'histórico é preservado no undo');
    assert.deepEqual(store.studio.cells[southKey(CHAR_ID)]?.frames, {
      south: [`/assets/wizard/${CHAR_ID}/south-v0.png`],
    });

    // Undo além da v0 é erro explícito.
    await assert.rejects(() => undoSouth(store, CHAR_ID, opts), /v0/);

    // Editar depois do undo com prompt NOVO descarta o ramo de redo.
    await editSouth(client, store, CHAR_ID, 'outra direção de arte', opts);
    wiz = wizardOf(store);
    assert.equal(wiz.southVersions.length, 2);
    assert.equal(wiz.southVersions[1]?.prompt, 'outra direção de arte');
    assert.equal(wiz.activeSouth, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cardeais: E e N em paralelo, W só depois', async () => {
  const { dir, store, opts } = makeHarness();
  try {
    const client = new FakeClient();
    await generateSouthFromText(client, store, CHAR_ID, 'base', opts);
    await rotateCardinals(client, store, CHAR_ID, opts);

    const ev = client.events;
    const iStartE = ev.indexOf('start:rotate:east');
    const iStartN = ev.indexOf('start:rotate:north');
    const iEndE = ev.indexOf('end:rotate:east');
    const iEndN = ev.indexOf('end:rotate:north');
    const iStartW = ev.indexOf('start:rotate:west');
    assert.ok(
      iStartE >= 0 && iStartN >= 0 && iEndE >= 0 && iEndN >= 0 && iStartW >= 0,
      `eventos de rotate ausentes: ${ev.join(', ')}`,
    );
    assert.ok(
      iStartE < iEndN && iStartN < iEndE,
      `E e N deveriam se sobrepor no tempo: ${ev.join(', ')}`,
    );
    assert.ok(
      iStartW > iEndE && iStartW > iEndN,
      `W deveria começar só depois de E e N terminarem: ${ev.join(', ')}`,
    );

    assert.equal(store.studio.cells[cardinalKey(CHAR_ID, 'east')]?.status, 'pronto');
    assert.equal(store.studio.cells[cardinalKey(CHAR_ID, 'north')]?.status, 'pronto');
    assert.equal(store.studio.cells[cardinalKey(CHAR_ID, 'west')]?.status, 'pronto');
    assert.equal(wizardOf(store).etapa, 'direcoes8');
    assert.equal(client.count('/rotate'), 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('idempotência: mesma sul e mesma edição não chamam a API de novo', async () => {
  const { dir, store, opts } = makeHarness();
  try {
    const client = new FakeClient();

    await generateSouthFromText(client, store, CHAR_ID, 'base', opts);
    await generateSouthFromText(client, store, CHAR_ID, 'base', opts);
    assert.equal(client.count('/create-image-bitforge'), 1, 'sul idêntica não regenera');

    await editSouth(client, store, CHAR_ID, 'mais detalhe', opts);
    await editSouth(client, store, CHAR_ID, 'mais detalhe', opts);
    assert.equal(client.count('/edit-image'), 1, 'mesma edição sobre a versão ativa não regenera');

    // Undo + mesmo prompt = redo de graça, sem API.
    await undoSouth(store, CHAR_ID, opts);
    await editSouth(client, store, CHAR_ID, 'mais detalhe', opts);
    assert.equal(client.count('/edit-image'), 1, 'redo não chama a API');
    assert.equal(wizardOf(store).activeSouth, 1);

    console.log('✓ idempotência: 0 requisições na segunda execução (sul e edição)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('idempotência por direção: re-execução só refaz a cardeal que falta', async () => {
  const { dir, store, opts } = makeHarness();
  try {
    const client = new FakeClient();
    await generateSouthFromText(client, store, CHAR_ID, 'base', opts);
    await rotateCardinals(client, store, CHAR_ID, opts);
    await rotateCardinals(client, store, CHAR_ID, opts);
    assert.equal(client.count('/rotate'), 3, 'segunda execução não chama nada');

    // Derruba só a cardeal north (simula falha parcial) e re-executa.
    delete store.studio.cells[cardinalKey(CHAR_ID, 'north')];
    await rotateCardinals(client, store, CHAR_ID, opts);
    assert.equal(client.count('/rotate'), 4, 'só a direção que faltava regenera');
    assert.equal(
      client.calls.filter((c) => c.path === '/rotate').at(-1)?.body?.['to_direction'],
      'north',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('directions8 exige studio.lock', async () => {
  const { dir, store, opts } = makeHarness(false); // sem lock
  try {
    const client = new FakeClient();
    await generateSouthFromText(client, store, CHAR_ID, 'base', opts);
    await rotateCardinals(client, store, CHAR_ID, opts);
    await assert.rejects(
      () => generateDirections8(client, store, CHAR_ID, opts),
      /config travada/,
    );
    assert.equal(
      client.count('/create-character-with-8-directions'),
      0,
      'sem lock, nenhuma chamada sai',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('directions8 monta o mapa directions com as 4 cardeais certas', async () => {
  const { dir, store, opts } = makeHarness();
  try {
    const client = new FakeClient();
    await generateSouthFromText(client, store, CHAR_ID, 'base', opts);
    await rotateCardinals(client, store, CHAR_ID, opts);
    await generateDirections8(client, store, CHAR_ID, opts);

    const d = client.lastDirections;
    assert.ok(d, 'o mapa directions deveria ter sido submetido');
    assert.deepEqual(Object.keys(d).sort(), ['east', 'north', 'south', 'west']);
    assert.equal(d['south'], PNG_SOUTH, 'sul ativa vai no mapa');
    assert.equal(d['east'], PNG_EAST);
    assert.equal(d['north'], PNG_NORTH);
    assert.equal(d['west'], PNG_WEST);

    // remoteId persistido, célula pronta com as 8 direções por chave, etapa pronto.
    assert.equal(store.studio.characters[0]?.remoteId, 'remote-char-1');
    const cell = store.studio.cells[directions8Key(CHAR_ID)];
    assert.equal(cell?.status, 'pronto');
    assert.deepEqual(
      Object.keys(cell?.frames ?? {}).sort(),
      [...DIRECTIONS].sort(),
      'frames extraídos por chave para as 8 direções',
    );
    assert.equal(wizardOf(store).etapa, 'pronto');

    // Segunda execução: nenhuma chamada nova.
    await generateDirections8(client, store, CHAR_ID, opts);
    assert.equal(client.count('/create-character-with-8-directions'), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('directions8 falha nomeando a cardeal que falta', async () => {
  const { dir, store, opts } = makeHarness();
  try {
    const client = new FakeClient();
    await generateSouthFromText(client, store, CHAR_ID, 'base', opts);

    // Sem nenhuma cardeal: as três aparecem no erro.
    await assert.rejects(
      () => generateDirections8(client, store, CHAR_ID, opts),
      /east, north, west/,
    );

    // Com só east pronta, o erro nomeia north e west.
    const eastFile = join(opts.assetsDir, 'wizard', CHAR_ID, 'cardinal-east.png');
    mkdirSync(dirname(eastFile), { recursive: true });
    writeFileSync(eastFile, Buffer.from(PNG_EAST, 'base64'));
    const eKey = cardinalKey(CHAR_ID, 'east');
    store.studio.cells[eKey] = {
      key: eKey,
      status: 'pronto',
      frames: { east: [`/assets/wizard/${CHAR_ID}/cardinal-east.png`] },
      updatedAt: new Date().toISOString(),
    };
    await assert.rejects(
      () => generateDirections8(client, store, CHAR_ID, opts),
      /north, west/,
    );
    assert.equal(client.count('/create-character-with-8-directions'), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ referência do manequim

test('referência do manequim chega como color_image na sul e nas 8 direções', async () => {
  const { dir, store, opts } = makeHarness();
  try {
    const client = new FakeClient();
    // api.ts preenche reference com o PNG da sul do manequim para derivados;
    // aqui o valor é um b64 simbólico — o módulo só o repassa ao request.
    const optsRef: WizardOpts = {
      ...opts,
      reference: { colorImageB64: 'cmVmZXJlbmNpYS1kby1tYW5lcXVpbQ==' },
    };

    await generateSouthFromText(client, store, CHAR_ID, 'derivado do manequim', optsRef);
    const bitforge = client.calls.find((c) => c.path === '/create-image-bitforge');
    assert.equal(
      bitforge?.body?.['color_image'],
      'cmVmZXJlbmNpYS1kby1tYW5lcXVpbQ==',
      'a sul por texto leva color_image quando a referência está presente',
    );

    // As cardeais NÃO levam referência (/rotate não tem color_image no fluxo
    // do wizard) — só a sul e as 8 direções.
    await rotateCardinals(client, store, CHAR_ID, opts);
    for (const call of client.calls.filter((c) => c.path === '/rotate')) {
      assert.ok(!('color_image' in (call.body ?? {})), 'rotate não recebe color_image');
    }

    await generateDirections8(client, store, CHAR_ID, optsRef);
    const dir8 = client.calls.find((c) => c.path === '/create-character-with-8-directions');
    assert.equal(
      dir8?.body?.['color_image'],
      'cmVmZXJlbmNpYS1kby1tYW5lcXVpbQ==',
      'as 8 direções levam color_image quando a referência está presente',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sem reference, nenhum color_image é enviado (retroativo-compatível)', async () => {
  const { dir, store, opts } = makeHarness();
  try {
    const client = new FakeClient();
    await generateSouthFromText(client, store, CHAR_ID, 'base', opts);
    await rotateCardinals(client, store, CHAR_ID, opts);
    await generateDirections8(client, store, CHAR_ID, opts);

    const bitforge = client.calls.find((c) => c.path === '/create-image-bitforge');
    assert.ok(
      !('color_image' in (bitforge?.body ?? {})),
      'sem reference, o bitforge não recebe color_image',
    );
    const dir8 = client.calls.find((c) => c.path === '/create-character-with-8-directions');
    assert.ok(
      !('color_image' in (dir8?.body ?? {})),
      'sem reference, o endpoint de 8 direções não recebe color_image',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
