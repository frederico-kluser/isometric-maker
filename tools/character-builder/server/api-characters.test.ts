/**
 * Teste da criação de personagens derivados (POST /api/characters): o derivado
 * herda do corpo-base o que define o corpo — silhueta, size do lock e, desde
 * 2026-08-03 (ADR 0035), o MOLDE de proporção. Com o manequim nascendo com
 * `mold: "adulto"` no seed, todo derivado nasce com o adulto como referência.
 *
 * Rede: IMPOSSÍVEL aqui — PIXELLAB_SECRET é apagado do ambiente e a rota de
 * criação não dispara geração nenhuma (só cria o Character). Nenhuma chamada
 * à API sai.
 *
 * Isolamento: studio.json e assets descartáveis em tmpdir (costuras
 * CHARACTER_BUILDER_STUDIO_JSON e CHARACTER_BUILDER_ASSETS_DIR); o estado real
 * do tool nunca é tocado. O fixture traz o manequim com wizard.etapa 'pronto'
 * e lock travado — as duas pré-condições da rota.
 *
 * Execute com: node --test server/api-characters.test.ts
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { seedStudio, type Studio } from './model.ts';

// ------------------------------------------------------------------ ambiente isolado

const dir = mkdtempSync(join(tmpdir(), 'api-characters-test-'));
const STUDIO_PATH = join(dir, 'studio.json');
const ASSETS_DIR = join(dir, 'assets');
process.env['CHARACTER_BUILDER_STUDIO_JSON'] = STUDIO_PATH;
process.env['CHARACTER_BUILDER_ASSETS_DIR'] = ASSETS_DIR;
delete process.env['PIXELLAB_SECRET'];

// Mesma proteção do api.test.ts: o log do servidor sai por stderr, que é fd
// separado e não passa pelo protocolo v8 do node --test.
console.log = (...args: unknown[]): void => {
  console.error(...args);
};

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ fixture

const studio = seedStudio();
// Pré-condições da rota: lock travado e um corpo-base com o wizard fechado.
studio.lock = { frameCount: 8, fps: 8, size: 128 };
const manequim = studio.characters.find((c) => c.id === 'manequim')!;
manequim.wizard = { etapa: 'pronto', southVersions: [], activeSouth: 0 };
assert.equal(manequim.mold, 'adulto', 'seed: manequim nasce com molde adulto (ADR 0035)');
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
    setHeader(_k: string, _v: string): void {},
    end(data?: string): void {
      this.body = data ?? '';
    },
  };
  return res;
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

function readStudioFile(): Studio {
  return JSON.parse(readFileSync(STUDIO_PATH, 'utf8')) as Studio;
}

// ------------------------------------------------------------------ characters

test('characters: derivado herda o molde do corpo-base (adulto por padrão)', async () => {
  const r = await post('/api/characters', {
    label: 'Guerreiro',
    description: 'guerreiro de robe azul',
  });
  assert.equal(r.status, 200, `deveria dar 200, veio ${r.status}: ${JSON.stringify(r.json)}`);
  assert.equal(r.json['id'], 'guerreiro');
  assert.equal(r.json['mold'], 'adulto', 'molde herdado do corpo-base');
  assert.equal(r.json['silhouette'], 'humano-medio', 'silhueta herdada do corpo-base');
  assert.equal(r.json['size'], 128, 'size vem do lock');

  const s = readStudioFile();
  const criado = s.characters.find((c) => c.id === 'guerreiro');
  assert.ok(criado, 'derivado persistido no studio');
  assert.equal(criado?.mold, 'adulto', 'molde persistido no studio');
  assert.equal(criado?.wizard?.etapa, 'sul', 'derivado nasce no passo da sul');
  assert.equal(
    s.characters.find((c) => c.id === 'manequim')?.mold,
    'adulto',
    'corpo-base intacto',
  );
});

test('characters: sem base pronta e sem lock, a criação é recusada (400)', async () => {
  // O reset do manequim abre o wizard do zero (etapa 'sul') e derruba o lock —
  // as duas pré-condições da rota de criação somem juntas.
  const reset = await post('/api/mannequin/reset', {});
  assert.equal(reset.status, 200);

  const r = await post('/api/characters', {
    label: 'Fantasma',
    description: 'sem base pronta',
  });
  assert.equal(r.status, 400);
  assert.match(
    String(r.json['error']),
    /trave a configuração|wizard concluído/,
    'a recusa nomeia a pré-condição faltante',
  );
});
