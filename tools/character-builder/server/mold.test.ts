/**
 * Teste do molde de proporção (server/mold.ts) e da troca de slot que ele
 * provoca na geração da face sul.
 *
 * O que estes testes travam:
 *   1. os dois moldes existem em disco, são quadrados e são decodificáveis pelo
 *      decodificador do projeto (que NÃO lê PNG de paleta — os arquivos crus da
 *      raiz eram colorType 3 e teriam explodido aqui);
 *   2. `readMoldPngB64` devolve um PNG do tamanho pedido, e devolve os bytes
 *      originais quando o tamanho já bate;
 *   3. com molde, o molde vai em `init_image` e a referência do usuário migra
 *      para `style_image` — a troca de slot é o coração da funcionalidade;
 *   4. sem molde, nada muda: a referência volta a `init_image` com força 500;
 *   5. o negativo do molde entra só quando há molde.
 *
 * Execute com: node --test server/mold.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { PixelLabClient, type ApiResult } from '../../pixellab-pipeline/src/api.ts';
import { seedStudio, isMoldId, MOLD_IDS, type Studio } from './model.ts';
import {
  MOLD_DIR,
  MOLD_INIT_STRENGTH,
  MOLD_NEGATIVE,
  REFERENCE_STYLE_STRENGTH,
  moldExists,
  moldPath,
  readMoldPngB64,
  withMoldNegative,
} from './mold.ts';
import { decode } from './frame-fit.ts';
import { readPngHeader } from './png.ts';
import {
  generateSouthFromText,
  type StudioStore,
  type WizardOpts,
} from './mannequin.ts';
import { readFileSync } from 'node:fs';

const SIZE = 128;
const CHAR_ID = 'manequim';

// ------------------------------------------------------------------ PNG falso

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

function makeSolidPNG(size: number, r: number, g: number, b: number): string {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
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

const PNG_REF = makeSolidPNG(SIZE, 10, 20, 30);
const PNG_OUT = makeSolidPNG(SIZE, 200, 30, 30);

// ------------------------------------------------------------------ harness

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

interface RecordedCall {
  readonly path: string;
  readonly body?: Record<string, unknown>;
}

class FakeClient extends PixelLabClient {
  readonly calls: RecordedCall[] = [];
  constructor() {
    super('fake-token-for-test-only');
  }
  override async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    const b = body as Record<string, unknown> | undefined;
    this.calls.push({ path, ...(b ? { body: b } : {}) });
    return {
      status: 200,
      raw: '{}',
      data: { image: { type: 'base64', base64: PNG_OUT } },
      usage: { type: 'usd', usd: 0.0072 },
    } as unknown as ApiResult<T>;
  }
}

function makeHarness(): {
  dir: string;
  store: MemStore;
  opts: WizardOpts;
} {
  const dir = join(tmpdir(), `mold-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  const studio = seedStudio();
  studio.lock = { frameCount: 8, fps: 8, size: SIZE };
  return {
    dir,
    store: new MemStore(studio),
    opts: {
      assetsDir: join(dir, 'assets'),
      ledgerPath: join(dir, 'assets', 'ledger.ndjson'),
    },
  };
}

function writeReference(opts: WizardOpts): void {
  const refPath = join(opts.assetsDir, 'wizard', CHAR_ID, 'reference.png');
  mkdirSync(dirname(refPath), { recursive: true });
  writeFileSync(refPath, Buffer.from(PNG_REF, 'base64'));
}

function bitforgeBody(client: FakeClient): Record<string, unknown> {
  const call = client.calls.filter((c) => c.path === '/create-image-bitforge').at(-1);
  assert.ok(call?.body, 'esperava uma chamada ao /create-image-bitforge');
  return call.body;
}

function setMold(store: MemStore, mold: 'adulto' | 'crianca' | undefined): void {
  const ch = store.studio.characters[0];
  assert.ok(ch, 'personagem base deveria existir');
  if (mold) ch.mold = mold;
  else delete ch.mold;
}

// ------------------------------------------------------------------ os arquivos

test('os dois moldes existem, são quadrados e o decodificador do projeto os lê', () => {
  assert.deepStrictEqual([...MOLD_IDS], ['adulto', 'crianca']);
  for (const id of MOLD_IDS) {
    assert.ok(moldExists(id), `molde "${id}" não está em ${MOLD_DIR}`);
    const buf = readFileSync(moldPath(id));
    const head = readPngHeader(buf);
    assert.equal(head.width, head.height, `${id}: molde tem que ser quadrado`);
    // colorType 3 (paleta) é o que os arquivos crus da raiz eram, e o
    // decodificador deste repositório cobre só 0, 2, 4 e 6. Se alguém repuser um
    // PNG de paleta aqui, este decode explode — que é exatamente o ponto.
    const dec = decode(buf);
    assert.equal(dec.rgba.length, dec.width * dec.height * 4);
  }
});

test('adulto é mais alto que criança, e os dois compartilham a linha de chão', () => {
  // É a única informação que um molde carrega. Se um dia alguém trocar as
  // imagens por duas de mesma altura, o seletor vira enfeite e este teste cai.
  const alturas: Record<string, { topo: number; base: number }> = {};
  for (const id of MOLD_IDS) {
    const dec = decode(readFileSync(moldPath(id)));
    let topo = dec.height;
    let base = -1;
    for (let y = 0; y < dec.height; y += 1) {
      for (let x = 0; x < dec.width; x += 1) {
        if (dec.rgba[(y * dec.width + x) * 4 + 3]! > 8) {
          if (y < topo) topo = y;
          if (y > base) base = y;
          break;
        }
      }
    }
    alturas[id] = { topo, base };
  }
  const adulto = alturas['adulto']!;
  const crianca = alturas['crianca']!;
  assert.ok(
    adulto.base - adulto.topo > crianca.base - crianca.topo,
    `adulto (${adulto.base - adulto.topo}px) tem que ser mais alto que criança (${crianca.base - crianca.topo}px)`,
  );
  assert.ok(
    Math.abs(adulto.base - crianca.base) <= 4,
    `linha de chão deveria coincidir: adulto ${adulto.base}, criança ${crianca.base}`,
  );
});

// ------------------------------------------------------------------ leitura

test('readMoldPngB64 devolve PNG do tamanho pedido', async () => {
  const b64 = await readMoldPngB64('adulto', 64);
  const head = readPngHeader(Buffer.from(b64, 'base64'));
  assert.equal(head.width, 64);
  assert.equal(head.height, 64);
});

test('readMoldPngB64 devolve os bytes originais quando o tamanho já bate', async () => {
  const original = readFileSync(moldPath('crianca'));
  const head = readPngHeader(original);
  const b64 = await readMoldPngB64('crianca', head.width);
  assert.equal(b64, original.toString('base64'), 'não deveria reescalar à toa');
});

test('readMoldPngB64 recusa tamanho inválido', async () => {
  await assert.rejects(() => readMoldPngB64('adulto', 0), /tamanho inválido/);
  await assert.rejects(() => readMoldPngB64('adulto', 12.5), /tamanho inválido/);
});

test('isMoldId aceita só os moldes que existem', () => {
  assert.ok(isMoldId('adulto'));
  assert.ok(isMoldId('crianca'));
  assert.ok(!isMoldId('criança'), 'com cedilha não é o id');
  assert.ok(!isMoldId('adult'));
  assert.ok(!isMoldId(''));
  assert.ok(!isMoldId(null));
  assert.ok(!isMoldId(undefined));
});

test('withMoldNegative preserva o negativo do usuário e anexa o do molde', () => {
  assert.equal(withMoldNegative(undefined), MOLD_NEGATIVE);
  assert.equal(withMoldNegative('   '), MOLD_NEGATIVE);
  assert.equal(withMoldNegative('tattoo'), `tattoo, ${MOLD_NEGATIVE}`);
  assert.equal(withMoldNegative(' , tattoo , '), `tattoo, ${MOLD_NEGATIVE}`);
});

// ------------------------------------------------------------------ troca de slot

test('com molde: molde em init_image e referência do usuário em style_image', async () => {
  const { dir, store, opts } = makeHarness();
  try {
    writeReference(opts);
    setMold(store, 'crianca');
    const client = new FakeClient();
    await generateSouthFromText(client, store, CHAR_ID, 'um mago de robe azul', opts);

    const body = bitforgeBody(client);
    const esperado = await readMoldPngB64('crianca', SIZE);
    assert.deepStrictEqual(
      body['init_image'],
      { type: 'base64', base64: esperado },
      'o molde é que ocupa init_image',
    );
    assert.equal(body['init_image_strength'], MOLD_INIT_STRENGTH);
    assert.deepStrictEqual(
      body['style_image'],
      { type: 'base64', base64: PNG_REF },
      'a referência do usuário migra para style_image',
    );
    assert.equal(body['style_strength'], REFERENCE_STYLE_STRENGTH);
    assert.notEqual(
      MOLD_INIT_STRENGTH,
      500,
      'força de molde não pode ser a de "variação fiel" — traria a madeira junto',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('com molde e sem referência: só init_image, sem style_image', async () => {
  const { dir, store, opts } = makeHarness();
  try {
    setMold(store, 'adulto');
    const client = new FakeClient();
    await generateSouthFromText(client, store, CHAR_ID, 'um guerreiro', opts);

    const body = bitforgeBody(client);
    assert.equal(body['init_image_strength'], MOLD_INIT_STRENGTH);
    assert.ok(!('style_image' in body), 'sem referência não há estilo a transferir');
    assert.ok(!('style_strength' in body));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sem molde: caminho histórico intacto — referência em init_image com força 500', async () => {
  const { dir, store, opts } = makeHarness();
  try {
    writeReference(opts);
    setMold(store, undefined);
    const client = new FakeClient();
    await generateSouthFromText(client, store, CHAR_ID, 'um guerreiro', opts);

    const body = bitforgeBody(client);
    assert.deepStrictEqual(body['init_image'], { type: 'base64', base64: PNG_REF });
    assert.equal(body['init_image_strength'], 500);
    assert.ok(!('style_image' in body), 'sem molde nada vai para style_image');
    assert.ok(!('style_strength' in body));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('o negativo do molde entra só quando há molde', async () => {
  const semMolde = makeHarness();
  try {
    setMold(semMolde.store, undefined);
    const c1 = new FakeClient();
    await generateSouthFromText(c1, semMolde.store, CHAR_ID, 'um guerreiro', semMolde.opts);
    const b1 = bitforgeBody(c1);
    const neg1 = String(b1['negative_description'] ?? '');
    assert.ok(
      !neg1.includes('wooden mannequin'),
      'sem molde não se proíbe palavra que ninguém convidou',
    );
  } finally {
    rmSync(semMolde.dir, { recursive: true, force: true });
  }

  const comMolde = makeHarness();
  try {
    setMold(comMolde.store, 'adulto');
    const c2 = new FakeClient();
    await generateSouthFromText(c2, comMolde.store, CHAR_ID, 'um guerreiro', comMolde.opts);
    const b2 = bitforgeBody(c2);
    assert.ok(
      String(b2['negative_description']).includes('wooden mannequin'),
      'com molde, o boneco de madeira tem que ser nomeado no negativo',
    );
  } finally {
    rmSync(comMolde.dir, { recursive: true, force: true });
  }
});
