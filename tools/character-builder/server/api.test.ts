/**
 * Teste da guarda de idempotência das rotas /api/generate (server/api.ts),
 * da validação de qualidade do /api/wizard/config, da referência da sul e
 * da concorrência do store.
 *
 * Célula 'pronto' é terminal: a rota responde 200 sem pré-marcar 'gerando'
 * e sem dar spawn no gerador — um clique duplo não pode cobrar de novo.
 * O teste roda contra um studio.json descartável em tmpdir (costuras
 * CHARACTER_BUILDER_STUDIO_JSON e CHARACTER_BUILDER_ASSETS_DIR); o estado
 * e os assets reais do tool nunca são tocados.
 *
 * Rede: IMPOSSÍVEL aqui — PIXELLAB_SECRET é apagado do ambiente e o
 * manequim do fixture não tem remoteId, então qualquer geração que escape
 * da guarda morre antes de client() existir. Nenhuma chamada à API sai.
 *
 * Execute com: node --test server/api.test.ts
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  DIRECTIONS, cellKey, seedStudio, wardrobeKey,
  type Studio, type WardrobeItem,
} from './model.ts';

// ------------------------------------------------------------------ ambiente isolado

const dir = mkdtempSync(join(tmpdir(), 'api-guard-test-'));
const STUDIO_PATH = join(dir, 'studio.json');
const ASSETS_DIR = join(dir, 'assets');
process.env['CHARACTER_BUILDER_STUDIO_JSON'] = STUDIO_PATH;
process.env['CHARACTER_BUILDER_ASSETS_DIR'] = ASSETS_DIR;
// Terceira costura, da mesma família: a fila de jobs é PERSISTENTE agora
// (server/job-queue.ts) e grava um JSON a cada transição. Sem isto ela gravaria
// em tools/character-builder/job-queue.json — o estado real da máquina — e dois
// arquivos de teste dividiriam o mesmo FIFO.
process.env['CHARACTER_BUILDER_JOB_QUEUE_JSON'] = join(dir, 'job-queue.json');
delete process.env['PIXELLAB_SECRET'];

/**
 * O SERVIDOR loga com `console.log` — `api.ts` passa `onLog: (m) =>
 * console.log(m)` aos módulos de geração, e o guard de custo escreve por ali.
 * O `node --test` transporta o resultado deste arquivo pelo stdout do processo
 * filho, num protocolo v8 com prefixo de tamanho: uma escrita crua caindo no
 * meio de um quadro aborta o arquivo inteiro com "Unable to deserialize cloned
 * data". E como o log vem de um job em segundo plano, não há hora marcada em
 * que ele seja seguro.
 *
 * Aqui o canal vira stderr, que é fd separado e não passa pelo protocolo. As
 * mensagens continuam visíveis; o que some é a chance de corromper o stream.
 */
console.log = (...args: unknown[]): void => {
  console.error(...args);
};

/**
 * FECHE A FILA ANTES DE APAGAR O TMPDIR — este `after` já derrubou um
 * `gate.sh`.
 *
 * A fila de jobs (`server/job-queue.ts`) é um objeto de segundo plano: ela
 * escreve `job-queue.json` por temp+rename a cada transição, e o último `assert`
 * de um teste não é o último byte escrito. O `rmSync` corria com esse rename e o
 * `after` estourava `ENOTEMPTY` — medido em **1 de 40** execuções com os três
 * arquivos de api em paralelo, e **0 de 40** antes de a fila existir.
 *
 * Nenhum teste tinha como fechá-la: `api.ts` só exportava `handle`. Agora
 * exporta `closeQueueForTests`, que fecha abortando o que estiver em voo,
 * aguarda os executores desenrolarem e drena as duas correntes de escrita
 * (a da fila e a do espelho job → célula).
 */
after(async () => {
  const { closeQueueForTests } = await import('./api.ts');
  await closeQueueForTests();
  rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ fixture

const AGORA = new Date().toISOString();
const PECA: WardrobeItem = {
  id: 'cota-de-malha',
  label: 'Cota de malha',
  slot: 'torso',
  silhouette: 'humano-medio',
  editDescription: 'wearing a chainmail hauberk',
  keepPalette: true,
  seed: 7,
  createdAt: AGORA,
};

const studio = seedStudio();
studio.lock = { frameCount: 8, fps: 8, size: 64 };
studio.wardrobe.push(PECA);
// Sem remoteId de propósito: se a guarda falhar, o gerador morre no cheque
// de wizard ANTES de criar cliente — nunca há chamada de rede no teste.
const POSE_KEY = cellKey('manequim', 'parado');
const PECA_KEY = wardrobeKey('manequim', PECA.id);
studio.cells[POSE_KEY] = { key: POSE_KEY, status: 'pronto', updatedAt: AGORA };
studio.cells[PECA_KEY] = { key: PECA_KEY, status: 'pronto', updatedAt: AGORA };
writeFileSync(STUDIO_PATH, `${JSON.stringify(studio, null, 2)}\n`);

// Import dinâmico DEPOIS do env: api.ts lê CHARACTER_BUILDER_STUDIO_JSON na carga.
const { handle } = await import('./api.ts');

// ------------------------------------------------------------------ mocks de http

function mockReq(method: string, path: string, body?: unknown): IncomingMessage {
  return {
    method,
    url: path,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body ?? {}), 'utf8');
    },
  } as unknown as IncomingMessage;
}

function mockRes() {
  const res = {
    statusCode: 0,
    body: '',
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    },
    end(data?: string) {
      this.body = data ?? '';
    },
  };
  return res;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

function readStudioFile(): Studio {
  return JSON.parse(readFileSync(STUDIO_PATH, 'utf8')) as Studio;
}

async function post(path: string, body: unknown) {
  const res = mockRes();
  const handled = await handle(
    mockReq('POST', path, body),
    res as unknown as ServerResponse,
  );
  assert.equal(handled, true, `${path} deveria ser tratada pelo handler`);
  return { status: res.statusCode, json: JSON.parse(res.body) as Record<string, unknown> };
}

async function del(path: string, body: unknown) {
  const res = mockRes();
  const handled = await handle(
    mockReq('DELETE', path, body),
    res as unknown as ServerResponse,
  );
  assert.equal(handled, true, `${path} deveria ser tratada pelo handler`);
  return { status: res.statusCode, json: JSON.parse(res.body) as Record<string, unknown> };
}

async function get(path: string) {
  const res = mockRes();
  const handled = await handle(
    mockReq('GET', path),
    res as unknown as ServerResponse,
  );
  assert.equal(handled, true, `${path} deveria ser tratada pelo handler`);
  return { status: res.statusCode, json: JSON.parse(res.body) as Record<string, unknown> };
}

// ------------------------------------------------------------------ PNGs sintéticos

// Mesmo padrão de sprite-bundle.test.ts / src/import.test.ts: PNG RGB 8bpc
// mínimo, quadrado, dentro da faixa 32–256 do validateImport.

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c = CRC_TABLE[(c ^ b)! & 0xff]! ^ (c >>> 8);
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

/** PNG RGB 8bpc válido de `size`×`size`; `fill` distingue os bytes entre arquivos. */
function makePNG(size: number, fill = 0): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const rowLen = 1 + size * 3;
  const raw = Buffer.alloc(size * rowLen, fill & 0xff);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const b64 = (buf: Buffer): string => buf.toString('base64');

// ------------------------------------------------------------------ guarda: pose

test('pose com célula pronto → 200 sem spawn, célula intacta no disco', async () => {
  const r = await post('/api/generate', { characterId: 'manequim', poseId: 'parado' });
  assert.equal(r.status, 200, `esperava 200 (terminal), veio ${r.status}`);
  assert.equal(r.json['key'], POSE_KEY);
  assert.equal(r.json['status'], 'pronto');

  // Se a guarda furasse, o spawn marcaria a célula 'falhou' (sem remoteId o
  // gerador lança antes de client()). Espera uma janela e relê o ARQUIVO.
  await sleep(150);
  const s = readStudioFile();
  assert.equal(
    s.cells[POSE_KEY]?.status,
    'pronto',
    'a célula pronto não pode ser rearmada por um clique duplo',
  );

  // E nenhum job foi registrado para a chave.
  const res = mockRes();
  await handle(mockReq('GET', '/api/studio'), res as unknown as ServerResponse);
  const studioResp = JSON.parse(res.body) as { jobs: Record<string, unknown> };
  assert.equal(studioResp.jobs[POSE_KEY], undefined, 'não pode haver job para célula pronto');
});

// ------------------------------------------------------------------ guarda: guarda-roupa

test('peça com célula pronto → 200 sem spawn, célula intacta no disco', async () => {
  const r = await post('/api/generate', { characterId: 'manequim', wardrobeId: PECA.id });
  assert.equal(r.status, 200, `esperava 200 (terminal), veio ${r.status}`);
  assert.equal(r.json['key'], PECA_KEY);
  assert.equal(r.json['status'], 'pronto');

  await sleep(150);
  const s = readStudioFile();
  assert.equal(
    s.cells[PECA_KEY]?.status,
    'pronto',
    'a célula pronto não pode ser rearmada por um clique duplo',
  );

  const res = mockRes();
  await handle(mockReq('GET', '/api/studio'), res as unknown as ServerResponse);
  const studioResp = JSON.parse(res.body) as { jobs: Record<string, unknown> };
  assert.equal(studioResp.jobs[PECA_KEY], undefined, 'não pode haver job para célula pronto');
});

// ------------------------------------------------------------------ controle: célula ausente gera

test('controle: pose SEM célula → 202 e spawn (falha local antes de client())', async () => {
  const key = cellKey('manequim', 'caminhando');
  const r = await post('/api/generate', { characterId: 'manequim', poseId: 'caminhando' });
  assert.equal(r.status, 202, `célula ausente deveria disparar geração (202), veio ${r.status}`);
  assert.equal(r.json['key'], key);

  // O spawn roda e morre no cheque de wizard (manequim sem remoteId) — prova
  // de que a guarda não bloqueia geração de verdade, sem rede envolvida.
  let status: string | undefined;
  let error: string | undefined;
  for (let i = 0; i < 100; i += 1) {
    const cell = readStudioFile().cells[key];
    if (cell?.status === 'falhou') {
      status = cell.status;
      error = cell.error;
      break;
    }
    await sleep(20);
  }
  assert.equal(status, 'falhou', 'o spawn deveria ter rodado e falhado localmente');
  assert.ok(
    error?.includes('conclua o wizard'),
    `a falha deveria ser o cheque de wizard (sem remoteId), veio: ${error}`,
  );
});

// ------------------------------------------------------------------ wizard: config com qualidade

// ORDEM IMPORTA: os quatro testes de config rodam em sequência sobre o mesmo
// studio.json — o de enum inválido lê o lock gravado pelo de sucesso, e o de
// omissão (por último) o regrava sem qualidade.

test('config: grava qualidade no lock e persiste no disco', async () => {
  const r = await post('/api/wizard/config', {
    characterId: 'manequim',
    frameCount: 8,
    fps: 8,
    size: 128,
    detail: 'highly detailed',
    outline: 'selective outline',
    view: 'low top-down',
    templateId: 'mannequin',
  });
  assert.equal(r.status, 200, `config válida deveria dar 200, veio ${r.status}: ${JSON.stringify(r.json)}`);

  const s = readStudioFile();
  assert.deepEqual(s.lock, {
    frameCount: 8,
    fps: 8,
    size: 128,
    detail: 'highly detailed',
    outline: 'selective outline',
    view: 'low top-down',
    templateId: 'mannequin',
  });
});

test('config: enum de qualidade inválido → 400 listando os válidos', async () => {
  const r = await post('/api/wizard/config', {
    characterId: 'manequim',
    frameCount: 8,
    fps: 8,
    size: 128,
    detail: 'ultra mega detailed',
  });
  assert.equal(r.status, 400, `enum inválido deveria dar 400, veio ${r.status}`);
  const err = String(r.json['error']);
  assert.ok(
    err.includes('low detail') && err.includes('highly detailed'),
    `a mensagem deveria listar os valores válidos, veio: ${err}`,
  );

  // O lock gravado pelo teste anterior não foi tocado.
  assert.deepEqual(
    readStudioFile().lock,
    {
      frameCount: 8,
      fps: 8,
      size: 128,
      detail: 'highly detailed',
      outline: 'selective outline',
      view: 'low top-down',
      templateId: 'mannequin',
    },
    'um config inválido não pode regravar o lock',
  );
});

test('config: size fora da faixa 32-256 → 400', async () => {
  for (const size of [31, 257]) {
    const r = await post('/api/wizard/config', {
      characterId: 'manequim',
      frameCount: 8,
      fps: 8,
      size,
    });
    assert.equal(r.status, 400, `size=${size} deveria dar 400, veio ${r.status}`);
  }
});

test('config: sem campos de qualidade, o lock fica sem eles (omissão F0-09)', async () => {
  const r = await post('/api/wizard/config', {
    characterId: 'manequim',
    frameCount: 8,
    fps: 8,
    size: 128,
  });
  assert.equal(r.status, 200);
  assert.deepEqual(
    readStudioFile().lock,
    { frameCount: 8, fps: 8, size: 128 },
    'sem os campos no pedido, o lock não ganha quality (ausente = default da API)',
  );
});

// ------------------------------------------------------------------ wizard: referência da sul

test('south: referenceBase64 é gravado em wizard/<charId>/reference.png', async () => {
  const refPath = join(ASSETS_DIR, 'wizard', 'manequim', 'reference.png');
  assert.equal(existsSync(refPath), false, 'o arquivo não deveria existir antes do upload');

  // b64 puro e data URI são ambos aceitos (a UI manda o formato do FileReader).
  const b64 = Buffer.from('referência falsa de teste').toString('base64');
  const r = await post('/api/wizard/south', {
    characterId: 'manequim',
    description: 'base de teste com referência',
    referenceBase64: `data:image/png;base64,${b64}`,
  });
  assert.equal(r.status, 202, `south deveria dar 202, veio ${r.status}: ${JSON.stringify(r.json)}`);
  assert.equal(existsSync(refPath), true, 'o upload deveria ter gravado reference.png');
  assert.equal(
    readFileSync(refPath, 'utf8'),
    'referência falsa de teste',
    'o prefixo data URI é stripado antes de gravar',
  );

  // Sem PIXELLAB_SECRET o spawn morre antes de client() existir — nenhuma
  // rede. A célula da sul falha, mas isso não apaga a referência gravada.
  await sleep(150);
  assert.equal(existsSync(refPath), true, 'falha da geração não remove a referência');
});

test('south reference: DELETE remove o arquivo e é idempotente (200 sempre)', async () => {
  const refPath = join(ASSETS_DIR, 'wizard', 'manequim', 'reference.png');

  // O teste anterior deixou um reference.png gravado: o DELETE o remove.
  assert.equal(existsSync(refPath), true);
  const r1 = await del('/api/wizard/south/reference', { characterId: 'manequim' });
  assert.equal(r1.status, 200);
  assert.equal(existsSync(refPath), false, 'o DELETE deveria remover o arquivo');

  // Sem arquivo: 200 do mesmo jeito — remover o que não existe não é erro.
  const r2 = await del('/api/wizard/south/reference', { characterId: 'manequim' });
  assert.equal(r2.status, 200, 'DELETE sem arquivo é 200 (idempotente)');

  // Personagem inexistente continua sendo erro do pedido.
  const r3 = await del('/api/wizard/south/reference', { characterId: 'fantasma' });
  assert.equal(r3.status, 404);
});

// ------------------------------------------------------------------ concorrência do store

test('concorrência: duas gerações simultâneas não perdem células nem corrompem o JSON', async () => {
  const keyA = cellKey('manequim', 'correndo');
  const keyB = cellKey('manequim', 'pulando');

  // Os dois POSTs partem juntos: handlers intercalados no mesmo cache, dois
  // saves de 'gerando' e dois spawns que morrem localmente (sem remoteId) e
  // gravam 'falhou' — o padrão dos botões "Gerar todas" da UI.
  const [rA, rB] = await Promise.all([
    post('/api/generate', { characterId: 'manequim', poseId: 'correndo' }),
    post('/api/generate', { characterId: 'manequim', poseId: 'pulando' }),
  ]);
  assert.equal(rA.status, 202);
  assert.equal(rB.status, 202);

  for (let i = 0; i < 100; i += 1) {
    const s = readStudioFile();
    if (s.cells[keyA]?.status === 'falhou' && s.cells[keyB]?.status === 'falhou') break;
    await sleep(20);
  }
  // JSON.parse dentro de readStudioFile lançaria se um save tivesse
  // corrompido o studio.json (tmp compartilhado, na versão sem fila).
  const s = readStudioFile();
  assert.equal(s.cells[keyA]?.status, 'falhou', 'a célula A sobreviveu à concorrência');
  assert.equal(s.cells[keyB]?.status, 'falhou', 'a célula B sobreviveu à concorrência');
  assert.equal(s.cells[POSE_KEY]?.status, 'pronto', 'células anteriores intactas');
  assert.equal(s.cells[PECA_KEY]?.status, 'pronto', 'células anteriores intactas');
  // Sem `console.log` de encerramento: o `node --test` transporta o resultado
  // de cada arquivo pelo stdout, num protocolo v8 com prefixo de tamanho, e
  // uma escrita crua caindo no meio de um quadro aborta o arquivo inteiro com
  // "Unable to deserialize cloned data". O `✔` do runner já diz o que a linha
  // dizia. Se precisar imprimir algo, use `t.diagnostic(...)` ou stderr.
});

// ------------------------------------------------------------------ sprite studio: rotas

test('sprite-lab: config inválida → 400 nomeado, sem spawn e sem job', async () => {
  const r = await post('/api/sprite-lab', { description: '', size: 128, outputs: 1 });
  assert.equal(r.status, 400, `config inválida deveria dar 400, veio ${r.status}`);
  assert.equal(r.json['code'], 'description-required');
  assert.match(String(r.json['error']), /description é obrigatória/);

  // A validação roda ANTES de responder: nenhum job sprite-lab existe.
  const res = mockRes();
  await handle(mockReq('GET', '/api/studio'), res as unknown as ServerResponse);
  const studioResp = JSON.parse(res.body) as { jobs: Record<string, unknown> };
  assert.ok(
    !Object.keys(studioResp.jobs).some((k) => k.startsWith('sprite-lab::')),
    'um 400 de validação não pode registrar job',
  );
});

test('sprite-lab: config válida → 202 {key, hash}; o job morre local sem token', async () => {
  const r = await post('/api/sprite-lab', {
    description: 'guerreiro careca de teste',
    size: 128,
    outputs: 1,
  });
  assert.equal(r.status, 202, `config válida deveria dar 202, veio ${r.status}: ${JSON.stringify(r.json)}`);
  const key = String(r.json['key']);
  const hash = String(r.json['hash']);
  assert.match(hash, /^[a-f0-9]{16}$/, 'hash é o sha256 truncado do input');
  assert.equal(key, `sprite-lab::${hash}`);

  // Sem PIXELLAB_SECRET o spawn morre ao criar o client — prova de que o
  // trabalho foi disparado, sem rede. O teste só verifica a resposta e o
  // desfecho local do job (o resultado em si exigiria a API de verdade).
  let status: string | undefined;
  let message: string | undefined;
  for (let i = 0; i < 100; i += 1) {
    const res = mockRes();
    await handle(mockReq('GET', '/api/studio'), res as unknown as ServerResponse);
    const jobs = (JSON.parse(res.body) as { jobs: Record<string, { status: string; message?: string }> }).jobs;
    if (jobs[key]?.status === 'falhou') {
      status = jobs[key]?.status;
      message = jobs[key]?.message;
      break;
    }
    await sleep(20);
  }
  assert.equal(status, 'falhou', 'o job deveria ter rodado e falhado localmente');
  assert.ok(
    message?.includes('PIXELLAB_SECRET'),
    `a falha deveria ser a ausência do token, veio: ${message}`,
  );
});

test('sprite-lab GET: andamento é status 200 nomeado, nunca 404; hash malformado é 404', async () => {
  // Regressão do Sprite Studio: enquanto o job rodava, esta rota devolvia 404
  // e a UI sondava em cima disso. O console do navegador enchia de linha
  // vermelha, o usuário lia como falha, e uma falha REAL do job ficava
  // indistinguível do caminho feliz. Andamento é resposta, não erro.
  const r = await get('/api/sprite-lab/0000000000000000');
  assert.equal(r.status, 200, `estado do lote é 200, veio ${r.status}`);
  assert.equal(r.json['status'], 'desconhecido', 'sem manifesto e sem job = desconhecido');
  assert.match(String(r.json['error']), /reiniciado|não há resultado/);

  // Hash malformado é o ÚNICO 404 que sobra aqui, e significa mesmo
  // "recurso inexistente" (barreira de path traversal no manifesto).
  const malformed = await get('/api/sprite-lab/zzz');
  assert.equal(malformed.status, 404, 'hash fora do formato hex-16 é 404, não path traversal');
});

test('sprite-lab GET: job em andamento → 200 {status:"gerando"}; job falho → 200 {status:"falhou"}', async () => {
  const r = await post('/api/sprite-lab', {
    description: 'andamento nomeado de teste',
    size: 64,
    outputs: 1,
  });
  assert.equal(r.status, 202);
  const hash = String(r.json['hash']);
  const key = String(r.json['key']);

  // Sem PIXELLAB_SECRET o job falha rápido; antes disso ele está 'gerando'.
  // Aceitar os dois é o correto: a corrida é real e nenhum dos dois é 404.
  const first = await get(`/api/sprite-lab/${hash}`);
  assert.equal(first.status, 200);
  assert.ok(
    first.json['status'] === 'gerando' || first.json['status'] === 'falhou',
    `estado inesperado: ${JSON.stringify(first.json)}`,
  );

  for (let i = 0; i < 100; i += 1) {
    const res = mockRes();
    await handle(mockReq('GET', '/api/studio'), res as unknown as ServerResponse);
    const jobs = (JSON.parse(res.body) as { jobs: Record<string, { status: string }> }).jobs;
    if (jobs[key]?.status === 'falhou') break;
    await sleep(20);
  }

  const failed = await get(`/api/sprite-lab/${hash}`);
  assert.equal(failed.status, 200, 'falha do job também é 200 com status nomeado');
  assert.equal(failed.json['status'], 'falhou');
  assert.match(String(failed.json['error']), /PIXELLAB_SECRET/);
});

// ---------------------------------------------- sprite studio: catálogo e recuperação

/**
 * Semeia uma corrida sprite-lab COMPLETA no assets dir de teste — o formato
 * que `listSpriteLabRuns` publica. Nenhuma geração, nenhuma chamada: só disco.
 */
function seedSpriteLabRun(hash: string, outputs: number, withConfig: boolean): void {
  const root = join(ASSETS_DIR, 'sprite-lab');
  mkdirSync(root, { recursive: true });
  for (let i = 0; i < outputs; i += 1) {
    mkdirSync(join(root, `${hash}-cand${i}`), { recursive: true });
    writeFileSync(join(root, `${hash}-cand${i}`, 'south-00.png'), makePNG(64, i));
  }
  writeFileSync(
    join(root, `${hash}.json`),
    JSON.stringify({
      version: 1,
      hash,
      candidates: Array.from({ length: outputs }, (_, i) => ({
        index: i,
        seed: 100 + i,
      })),
      ...(withConfig
        ? {
            config: {
              description: 'guerreiro semeado em disco',
              view: 'low top-down',
              size: 64,
              outputs,
              noBackground: true,
              enhancePrompt: false,
              hadReference: false,
            },
          }
        : {}),
    }),
  );
}

async function spriteLabRuns(): Promise<Array<Record<string, unknown>>> {
  const r = await get('/api/sprite-lab');
  assert.equal(r.status, 200, `o catálogo responde 200, veio ${r.status}`);
  const runs = r.json['runs'];
  assert.ok(Array.isArray(runs), `o catálogo responde {runs}, veio ${JSON.stringify(r.json)}`);
  return runs as Array<Record<string, unknown>>;
}

test('GET /api/sprite-lab: catálogo das corridas em disco — o caminho EXATO não cai no ramo do hash', async () => {
  // Sem esta rota, o hash de uma corrida voltava uma vez só (no corpo do 202) e
  // vivia apenas em estado React: trocar de aba desmontava o painel e a sprite
  // paga sumia da tela sem ter sumido do disco.
  const hash = 'aaaaaaaaaaaaaaa1';
  seedSpriteLabRun(hash, 2, true);

  const runs = await spriteLabRuns();
  const found = runs.find((r) => r['hash'] === hash);
  assert.ok(found, `a corrida semeada deveria estar no catálogo: ${JSON.stringify(runs)}`);
  assert.equal(found['candidateCount'], 2);
  const candidates = found['candidates'] as Array<Record<string, unknown>>;
  assert.equal(
    candidates[0]?.['southUrl'],
    `/sprite-lab/${hash}-cand0/south-00.png`,
    'a miniatura aponta para o PNG servido por serveGeneratedAsset',
  );
  assert.ok(found['config'], 'a config do manifesto viaja no catálogo');
  assert.ok(typeof found['at'] === 'string' && !Number.isNaN(Date.parse(found['at'])));
});

test('GET /api/sprite-lab: corrida INCOMPLETA fica fora do catálogo', async () => {
  const hash = 'bbbbbbbbbbbbbbb2';
  seedSpriteLabRun(hash, 2, false);
  rmSync(join(ASSETS_DIR, 'sprite-lab', `${hash}-cand1`), {
    recursive: true,
    force: true,
  });

  const runs = await spriteLabRuns();
  assert.ok(
    !runs.some((r) => r['hash'] === hash),
    'resultado incompleto não é resultado — a tela não pode mostrar meia corrida',
  );
});

test('recuperação: a chave do job carrega o hash, e o GET por hash responde estado nomeado', async () => {
  // Este é o contrato de que o painel depende para se recolar a uma corrida em
  // voo depois de um remount: o hash não sobrevive em lugar nenhum além da
  // chave `sprite-lab::<hash>` do registro de jobs e do próprio disco.
  const r = await post('/api/sprite-lab', {
    description: 'recolagem a job em voo',
    size: 64,
    outputs: 1,
  });
  assert.equal(r.status, 202);
  const key = String(r.json['key']);
  const hash = String(r.json['hash']);
  assert.equal(key.slice('sprite-lab::'.length), hash, 'o hash sai da chave por fatiamento');

  const res = mockRes();
  await handle(mockReq('GET', '/api/studio'), res as unknown as ServerResponse);
  const jobs = (JSON.parse(res.body) as { jobs: Record<string, { status: string }> }).jobs;
  const spriteLabKeys = Object.keys(jobs).filter((k) => k.startsWith('sprite-lab::'));
  assert.ok(spriteLabKeys.includes(key), 'o job aparece em /api/studio, que é o que a tela lê');
  for (const k of spriteLabKeys) {
    assert.match(
      k.slice('sprite-lab::'.length),
      /^[a-f0-9]{16}$/,
      'toda chave de sprite-lab carrega um hash no formato que o GET aceita',
    );
  }

  const estado = await get(`/api/sprite-lab/${hash}`);
  assert.equal(estado.status, 200, 'andamento é 200 com status nomeado, nunca 404');
  assert.ok(
    ['gerando', 'pronto', 'falhou'].includes(String(estado.json['status'])),
    `estado inesperado: ${JSON.stringify(estado.json)}`,
  );
});

// ------------------------------------------------------------------ wizard: import/export de bundle

// ORDEM IMPORTA: estes testes rodam por último sobre o mesmo studio.json —
// o lock vigente é {frameCount: 8, fps: 8, size: 128} (gravado pelos testes
// de config), e o size do bundle PRECISA casar com ele (regra do módulo).

test('wizard import/export: roundtrip com bundle montado em tmpdir', async () => {
  const wizardBundle = {
    kind: 'sprite-wizard-directions',
    version: 1,
    exportedAt: new Date().toISOString(),
    config: {
      description: 'herói do roundtrip',
      view: 'low top-down',
      size: 128,
      seed: 42,
      silhouette: 'humano-medio',
      frameCount: 8,
      fps: 8,
    },
    remoteId: 'remote-roundtrip-1',
    south: { b64: b64(makePNG(128, 7)) },
    directions: Object.fromEntries(
      DIRECTIONS.map((d, i) => [d, b64(makePNG(128, 10 + i))]),
    ),
  };

  const imp = await post('/api/wizard/import', {
    characterId: 'manequim',
    bundle: wizardBundle,
  });
  assert.equal(imp.status, 200, `import deveria dar 200, veio ${imp.status}: ${JSON.stringify(imp.json)}`);
  assert.deepEqual(imp.json, { ok: true });

  // O wizard do manequim foi aplicado: etapa pronto + remoteId do bundle, e
  // os PNGs estão no assets dir de teste (nunca no real).
  const s = readStudioFile();
  const man = s.characters.find((c) => c.id === 'manequim');
  assert.equal(man?.wizard?.etapa, 'pronto');
  assert.equal(man?.remoteId, 'remote-roundtrip-1');
  assert.ok(
    existsSync(join(ASSETS_DIR, 'wizard', 'manequim', 'south-v0.png')),
    'a sul do bundle foi gravada em assets/wizard/manequim',
  );

  const exp = await post('/api/wizard/export', { characterId: 'manequim' });
  assert.equal(exp.status, 200, `export deveria dar 200, veio ${exp.status}: ${JSON.stringify(exp.json)}`);
  assert.equal(exp.json['kind'], 'sprite-wizard-directions');
  assert.equal(exp.json['version'], 1);
  assert.equal(exp.json['remoteId'], 'remote-roundtrip-1');
  const expConfig = exp.json['config'] as Record<string, unknown>;
  assert.equal(expConfig['size'], 128);
  assert.equal(expConfig['seed'], 42);
  assert.equal(expConfig['silhouette'], 'humano-medio');

  // Os bytes voltam iguais aos que subiram — o roundtrip é lossless.
  assert.equal(
    (exp.json['south'] as Record<string, unknown>)['b64'],
    wizardBundle.south.b64,
    'sul exportada é byte-idêntica à importada',
  );
  const expDirs = exp.json['directions'] as Record<string, string>;
  assert.deepEqual(Object.keys(expDirs).sort(), [...DIRECTIONS].sort());
  for (const d of DIRECTIONS) {
    assert.equal(expDirs[d], wizardBundle.directions[d], `direção ${d} byte-idêntica`);
  }

  // E o bundle exportado reimporta — a reimportação é idempotente.
  const re = await post('/api/wizard/import', {
    characterId: 'manequim',
    bundle: exp.json,
  });
  assert.equal(re.status, 200, `reimport do exportado deveria dar 200, veio ${re.status}`);
});

test('wizard/export: personagem inexistente → 400 nomeado', async () => {
  const r = await post('/api/wizard/export', { characterId: 'fantasma' });
  assert.equal(r.status, 400, `export de personagem inexistente deveria dar 400, veio ${r.status}`);
  assert.match(String(r.json['error']), /não existe/);
});

// ------------------------------------------------------------------ characters/import

test('characters/import: cria personagem derivado e devolve o Character', async () => {
  const labBundle = {
    kind: 'sprite-lab-south',
    version: 1,
    exportedAt: new Date().toISOString(),
    config: {
      description: 'vilão de teste',
      view: 'low top-down',
      size: 128,
      seed: 9,
      noBackground: true,
      enhancePrompt: false,
    },
    selected: { index: 0, seed: 9, b64: b64(makePNG(128, 21)) },
    candidates: [{ index: 0, seed: 9, b64: b64(makePNG(128, 21)) }],
  };

  const r = await post('/api/characters/import', {
    label: 'Vilão Importado',
    bundle: labBundle,
  });
  assert.equal(r.status, 200, `import deveria dar 200, veio ${r.status}: ${JSON.stringify(r.json)}`);
  // A UI lê character.id — o Character criado é a resposta.
  assert.equal(r.json['id'], 'vilao-importado');
  assert.equal(r.json['label'], 'Vilão Importado');
  // Bundle de lab: wizard na etapa direcoes8, SEM remoteId (descartado).
  assert.equal((r.json['wizard'] as Record<string, unknown>)['etapa'], 'direcoes8');
  assert.equal(r.json['remoteId'], undefined);

  // Persistiu no studio.json, com a célula da sul pronta.
  const s = readStudioFile();
  assert.ok(s.characters.some((c) => c.id === 'vilao-importado'));
  assert.equal(s.cells['vilao-importado::__south__']?.status, 'pronto');
  assert.ok(
    existsSync(join(ASSETS_DIR, 'wizard', 'vilao-importado', 'south-v0.png')),
    'a sul do personagem importado foi gravada no assets dir de teste',
  );
});

test('characters/import: bundle de kind desconhecido ("config normal") → 400', async () => {
  const r = await post('/api/characters/import', {
    label: 'Config Normal',
    bundle: { kind: 'wizard-config', version: 1, frameCount: 8, fps: 8 },
  });
  assert.equal(r.status, 400, `kind desconhecido deveria dar 400, veio ${r.status}`);
  assert.match(String(r.json['error']), /kind/);
  assert.match(String(r.json['error']), /sprite-lab-south/);

  // Nada foi criado nem gravado.
  assert.ok(!readStudioFile().characters.some((c) => c.id === 'config-normal'));
  assert.ok(!existsSync(join(ASSETS_DIR, 'wizard', 'config-normal')));
});

// ------------------------------------------------------------------ remoção de bloco do mundo

/**
 * Semeia um bloco 'texture' COMPLETO no assets dir de teste — o formato que
 * `listWorldBlocks` publica. Nenhuma geração, nenhuma chamada: só disco.
 */
function seedWorldBlock(hash: string, description: string): string {
  const dir = join(ASSETS_DIR, 'world-blocks', hash);
  mkdirSync(join(dir, 'frames'), { recursive: true });
  writeFileSync(
    join(dir, 'block.json'),
    JSON.stringify({
      version: 3,
      hash,
      technique: 'texture',
      description,
      animated: true,
      frameCount: 4,
      fps: 8,
      pingPong: true,
    }),
  );
  writeFileSync(join(dir, 'spritesheet.png'), makePNG(32));
  writeFileSync(join(dir, 'spritesheet.json'), '{}');
  writeFileSync(join(dir, 'animation.json'), JSON.stringify({ fps: 8, frameCount: 4 }));
  writeFileSync(join(dir, 'frames', 'frame_000.png'), makePNG(32));
  return dir;
}

async function catalogHashes(): Promise<string[]> {
  const r = await get('/api/world-blocks');
  return (r.json['blocks'] as Array<{ hash: string }>).map((b) => b.hash);
}

test('DELETE /api/world-block/{hash}: apaga o diretório, some do catálogo e é IDEMPOTENTE', async () => {
  const alvo = '0123456789abcdef';
  const vizinho = 'fedcba9876543210';
  const dirAlvo = seedWorldBlock(alvo, 'lava fluindo');
  const dirVizinho = seedWorldBlock(vizinho, 'grama sobre terra');

  assert.deepEqual((await catalogHashes()).sort(), [alvo, vizinho].sort());

  const r1 = await del(`/api/world-block/${alvo}`, {});
  assert.equal(r1.status, 200, `esperava 200, veio ${r1.status}`);
  assert.equal(r1.json['ok'], true);
  assert.equal(r1.json['existed'], true);
  assert.equal(r1.json['hash'], alvo);
  assert.equal(r1.json['removedFiles'], 5);
  assert.equal(r1.json['pendingDiscarded'], false);
  assert.equal(existsSync(dirAlvo), false, 'o diretório do bloco tem que sumir');
  assert.equal(existsSync(dirVizinho), true, 'o vizinho não pode ser tocado');
  assert.deepEqual(await catalogHashes(), [vizinho]);

  // Segunda vez: 200 do mesmo jeito. Apagar o que já não existe não é erro —
  // é a mesma regra do DELETE /api/wizard/south/reference.
  const r2 = await del(`/api/world-block/${alvo}`, {});
  assert.equal(r2.status, 200, 'DELETE repetido é 200 (idempotente)');
  assert.equal(r2.json['existed'], false);
  assert.equal(r2.json['removedFiles'], 0);

  // E o GET do bloco apagado volta a ser "desconhecido", não "pronto".
  const g = await get(`/api/world-block/${alvo}`);
  assert.equal(g.status, 200);
  assert.equal(g.json['status'], 'desconhecido');

  rmSync(dirVizinho, { recursive: true, force: true });
});

test('DELETE /api/world-block: caminho que não é hash é RECUSADO — nada é apagado', async () => {
  const alvo = 'aaaabbbbccccdddd';
  const dirAlvo = seedWorldBlock(alvo, 'pedra');
  const foraDaArvore = join(ASSETS_DIR, 'NAO-APAGUE.txt');
  writeFileSync(foraDaArvore, 'estado do usuário');

  // O WHATWG URL NÃO decodifica o pathname: `%2f` continua `%2f` e o segmento
  // chega inteiro ao handler. É por isso que a regex tem que ser aplicada ao
  // texto cru — e é ela quem recusa cada um destes.
  for (const evil of [
    '%2e%2e%2f%2e%2e',
    '..%2f..%2fetc',
    `..%2f${alvo}`,
    'nao-e-hash',
    '0123456789abcde',
    '0123456789abcdefg',
    `${alvo}%00`,
    `${alvo}%2f..`,
  ]) {
    const r = await del(`/api/world-block/${evil}`, {});
    assert.equal(r.status, 400, `${evil} deveria ser 400, veio ${r.status}`);
    assert.equal(r.json['code'], 'hash-format');
  }

  // Há uma SEGUNDA barreira antes da rota, e ela some com o caminho em vez de
  // recusá-lo: o parser de URL trata um segmento inteiro igual a `..`, `%2e%2e`
  // ou `.%2e` (sem distinguir maiúsculas) como "subir um nível" e o remove. O
  // pathname deixa de bater com o prefixo da rota — 404 de rota desconhecida,
  // nunca uma remoção.
  for (const comido of ['%2e%2e', '%2E%2E', '.%2e']) {
    const r = await del(`/api/world-block/${comido}`, {});
    assert.equal(r.status, 404, `${comido} deveria morrer antes da rota, veio ${r.status}`);
  }

  // Traversal cru sai do prefixo /api/ inteiro: o handler nem trata.
  const res = mockRes();
  const handled = await handle(
    mockReq('DELETE', '/api/world-block/../../../../etc/passwd'),
    res as unknown as ServerResponse,
  );
  assert.equal(handled, false, 'traversal cru sai do prefixo /api/ e não é tratado aqui');

  assert.equal(existsSync(foraDaArvore), true, 'arquivo fora de world-blocks/ sobreviveu');
  assert.equal(existsSync(dirAlvo), true, 'o bloco legítimo sobreviveu');
  assert.equal(existsSync(join(ASSETS_DIR, 'world-blocks')), true);
  assert.deepEqual(await catalogHashes(), [alvo]);

  rmSync(dirAlvo, { recursive: true, force: true });
  rmSync(foraDaArvore, { force: true });
});

test('DELETE /api/world-block: bloco EM GERAÇÃO → 409, e o bloco continua gerando', async () => {
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env['PIXELLAB_SECRET'];
  const originalAnthropic = process.env['ANTHROPIC_API_KEY'];
  let fetchCalls = 0;
  // Toda saída de rede destes módulos passa por globalThis.fetch. Aqui ele
  // vira uma promessa que NUNCA resolve: nada sai da máquina e o job fica
  // deterministicamente 'gerando' (o AbortSignal.timeout do cliente usa timer
  // sem ref, então nada disso segura o processo depois do teste).
  globalThis.fetch = ((): Promise<Response> => {
    fetchCalls += 1;
    return new Promise<Response>(() => {});
  }) as typeof fetch;
  process.env['PIXELLAB_SECRET'] = 'fake-token-do-teste';
  delete process.env['ANTHROPIC_API_KEY'];

  try {
    const r = await post('/api/world-block', {
      description: 'lava fluindo devagar',
      technique: 'texture',
      seed: 3,
    });
    assert.equal(r.status, 202, `esperava 202, veio ${r.status}`);
    const hash = String(r.json['hash']);

    // Espera o job ser ADMITIDO e chegar ao submit. Com a fila FIFO isso deixou
    // de ser imediato: entre o 202 e a primeira chamada existem o limitador de
    // taxa (2/s, que é o que faz um 429 desacelerar a fila inteira) e o recheque
    // de idempotência, que lê disco. Um `sleep` fixo aqui vira teste instável —
    // a condição é que o job chegue lá, não que chegue em 150 ms.
    for (let i = 0; i < 200 && fetchCalls === 0; i += 1) await sleep(20);
    assert.ok(fetchCalls > 0, 'o job chegou à submissão e ficou pendurado lá');

    const d = await del(`/api/world-block/${hash}`, {});
    assert.equal(d.status, 409, `bloco gerando deveria ser 409, veio ${d.status}`);
    assert.equal(d.json['code'], 'block-generating');
    assert.match(String(d.json['error']), /gerado agora/);
    assert.match(String(d.json['error']), /pago/);

    // A recusa não mexeu no estado: o job continua de pé.
    const g = await get(`/api/world-block/${hash}`);
    assert.equal(g.json['status'], 'gerando');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env['PIXELLAB_SECRET'];
    else process.env['PIXELLAB_SECRET'] = originalSecret;
    if (originalAnthropic !== undefined) process.env['ANTHROPIC_API_KEY'] = originalAnthropic;
  }
});
