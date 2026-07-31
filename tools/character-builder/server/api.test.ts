/**
 * Teste da guarda de idempotência das rotas /api/generate (server/api.ts).
 *
 * Célula 'pronto' é terminal: a rota responde 200 sem pré-marcar 'gerando'
 * e sem dar spawn no gerador — um clique duplo não pode cobrar de novo.
 * O teste roda contra um studio.json descartável em tmpdir (costura
 * CHARACTER_BUILDER_STUDIO_JSON); o estado real do tool nunca é tocado.
 *
 * Rede: IMPOSSÍVEL aqui — PIXELLAB_SECRET é apagado do ambiente e o
 * manequim do fixture não tem remoteId, então qualquer geração que escape
 * da guarda morre antes de client() existir. Nenhuma chamada à API sai.
 *
 * Execute com: node --test server/api.test.ts
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  cellKey, seedStudio, wardrobeKey,
  type Studio, type WardrobeItem,
} from './model.ts';

// ------------------------------------------------------------------ ambiente isolado

const dir = mkdtempSync(join(tmpdir(), 'api-guard-test-'));
const STUDIO_PATH = join(dir, 'studio.json');
process.env['CHARACTER_BUILDER_STUDIO_JSON'] = STUDIO_PATH;
delete process.env['PIXELLAB_SECRET'];

after(() => {
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
