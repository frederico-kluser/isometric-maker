/**
 * Bordas do `GET /api/sprite-lab` — o catálogo de onde o Sprite Studio se
 * recupera depois de trocar de aba ou de um F5.
 *
 * ## Por que este arquivo existe separado de `api.test.ts`
 *
 * Duas razões, e a primeira é decisiva:
 *
 * 1. **O diretório de assets precisa nascer VAZIO.** `api.test.ts` semeia
 *    corridas nos primeiros testes e o `ASSETS_DIR` dele nunca mais está limpo;
 *    o caso "o diretório nem existe" — que é o estado de uma instalação nova, e
 *    o mais provável de todos — não tem como ser reproduzido lá.
 * 2. `api.test.ts` declara no próprio corpo que a ORDEM dos testes importa (o
 *    `lock` do `studio.json` é construído por eles em sequência). Semear lixo e
 *    manifesto corrompido no meio daquilo é acoplar o que não precisa ser.
 *
 * Cada arquivo de `node --test` roda no seu processo, então o `studio.json` e o
 * `assets/` daqui são exclusivos deste arquivo.
 *
 * ## O que está sob verificação
 *
 * O catálogo é servidor-autoritativo: se ele publicar uma corrida que não tem
 * bytes em disco, a tela mostra miniatura quebrada de uma sprite PAGA e o
 * usuário conclui que perdeu a geração. Por isso a regra é "resultado
 * incompleto não é resultado", e por isso nenhum arquivo malformado no
 * diretório pode derrubar a rota inteira — um `.json` truncado por uma queda no
 * meio da escrita não pode esconder as corridas boas que estão ao lado.
 *
 * Rede: IMPOSSÍVEL aqui — `PIXELLAB_SECRET` é apagado do ambiente e nenhum
 * teste deste arquivo faz POST.
 *
 * Execute com: node --test server/api-sprite-lab.test.ts
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ------------------------------------------------------------------ ambiente isolado

const dir = mkdtempSync(join(tmpdir(), 'api-sprite-lab-test-'));
const STUDIO_PATH = join(dir, 'studio.json');
const ASSETS_DIR = join(dir, 'assets');
process.env['CHARACTER_BUILDER_STUDIO_JSON'] = STUDIO_PATH;
process.env['CHARACTER_BUILDER_ASSETS_DIR'] = ASSETS_DIR;
// A fila de jobs é persistente (server/job-queue.ts) e grava um JSON a cada
// transição. Nenhum teste deste arquivo enfileira nada, mas a costura fica
// declarada aqui também: sem ela um POST acrescentado depois escreveria no
// job-queue.json REAL do tool.
process.env['CHARACTER_BUILDER_JOB_QUEUE_JSON'] = join(dir, 'job-queue.json');
delete process.env['PIXELLAB_SECRET'];

/**
 * Mesmo desvio de `api.test.ts`, e pelo mesmo motivo: o `node --test` transporta
 * o resultado deste arquivo pelo stdout do processo filho, num protocolo com
 * prefixo de tamanho. Uma escrita crua caindo no meio de um quadro aborta o
 * arquivo inteiro com "Unable to deserialize cloned data".
 */
console.log = (...args: unknown[]): void => {
  console.error(...args);
};

/**
 * Fecha a fila antes de apagar o tmpdir — ver a nota longa no `after` de
 * `api.test.ts`. Nenhum teste deste arquivo enfileira nada, mas a rota
 * `GET /api/sprite-lab/{hash}` ABRE a fila para consultar o job, e uma fila
 * aberta é uma fila que escreve.
 */
after(async () => {
  await closeQueueForTests();
  rmSync(dir, { recursive: true, force: true });
});

// `assets/` NÃO é criado de propósito: o primeiro teste é justamente o de
// instalação nova, em que o diretório não existe.

// Import dinâmico DEPOIS do env: api.ts lê as duas variáveis na carga.
const { handle, closeQueueForTests } = await import('./api.ts');

// ------------------------------------------------------------------ mocks de http

function mockReq(method: string, path: string): IncomingMessage {
  return {
    method,
    url: path,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from('{}', 'utf8');
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

async function get(path: string) {
  const res = mockRes();
  const handled = await handle(
    mockReq('GET', path),
    res as unknown as ServerResponse,
  );
  assert.equal(handled, true, `${path} deveria ser tratada pelo handler`);
  return { status: res.statusCode, json: JSON.parse(res.body) as Record<string, unknown> };
}

/** As corridas publicadas pelo catálogo, já validando a forma da resposta. */
async function runs(): Promise<Array<Record<string, unknown>>> {
  const r = await get('/api/sprite-lab');
  assert.equal(r.status, 200, `o catálogo responde 200, veio ${r.status}`);
  const lista = r.json['runs'];
  assert.ok(Array.isArray(lista), `esperava {runs}, veio ${JSON.stringify(r.json)}`);
  return lista as Array<Record<string, unknown>>;
}

const hashes = async (): Promise<string[]> =>
  (await runs()).map((r) => String(r['hash']));

// ------------------------------------------------------------------ fixtures em disco

const SPRITE_LAB = (): string => join(ASSETS_DIR, 'sprite-lab');

/**
 * Escreve os PNGs de uma corrida. O conteúdo é irrelevante: o catálogo só
 * pergunta se o arquivo EXISTE (é a miniatura que viaja como URL, não como
 * base64), e inventar um PNG válido aqui diria que ele é validado quando não é.
 */
function seedPngs(hash: string, indices: readonly number[]): void {
  for (const i of indices) {
    mkdirSync(join(SPRITE_LAB(), `${hash}-cand${i}`), { recursive: true });
    writeFileSync(join(SPRITE_LAB(), `${hash}-cand${i}`, 'south-00.png'), `png ${hash} ${i}`);
  }
}

/** Manifesto v1 completo, no formato que `runSpriteLab` grava. */
function manifest(hash: string, outputs: number): Record<string, unknown> {
  return {
    version: 1,
    hash,
    candidates: Array.from({ length: outputs }, (_, i) => ({ index: i, seed: 100 + i })),
    config: {
      description: `corrida ${hash}`,
      view: 'low top-down',
      size: 64,
      outputs,
      noBackground: true,
      enhancePrompt: false,
      hadReference: false,
    },
  };
}

/** Grava um arquivo cru dentro de `sprite-lab/`, com o nome exato pedido. */
function seedFile(name: string, content: string): void {
  mkdirSync(SPRITE_LAB(), { recursive: true });
  writeFileSync(join(SPRITE_LAB(), name), content);
}

function seedRun(hash: string, outputs: number): void {
  seedPngs(hash, Array.from({ length: outputs }, (_, i) => i));
  seedFile(`${hash}.json`, JSON.stringify(manifest(hash, outputs)));
}

// ------------------------------------------------------------------ testes

test('GET /api/sprite-lab: instalação nova, sem assets/ nenhum → 200 com lista vazia', async () => {
  // O diretório de assets ainda não existe neste ponto do arquivo. Uma exceção
  // aqui derrubaria a tela inicial do estúdio de quem nunca gerou nada.
  const r = await get('/api/sprite-lab');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json['runs'], []);
});

test('GET /api/sprite-lab: diretório sprite-lab/ existente e vazio → lista vazia', async () => {
  mkdirSync(SPRITE_LAB(), { recursive: true });
  assert.deepEqual(await hashes(), []);
});

test('GET /api/sprite-lab: manifesto com JSON inválido é ignorado e não leva as corridas boas junto', async () => {
  const bom = 'aaaaaaaaaaaaaaa1';
  const quebrado = 'aaaaaaaaaaaaaaa2';
  seedRun(bom, 1);
  // Um arquivo truncado no meio da escrita é exatamente isto: JSON pela metade.
  seedPngs(quebrado, [0]);
  seedFile(`${quebrado}.json`, '{"version":1,"hash":"aaaaaaaaaaaaaaa2","candi');

  const lista = await hashes();
  assert.ok(lista.includes(bom), 'a corrida íntegra ao lado tem que continuar publicada');
  assert.ok(!lista.includes(quebrado), 'manifesto ilegível não vira corrida');
});

test('GET /api/sprite-lab: manifesto cujo hash NÃO bate com o nome do arquivo fica de fora', async () => {
  // O nome do arquivo é a chave de tudo: os PNGs moram em `<hash>-cand<i>/`.
  // Um manifesto que declara outro hash apontaria para diretórios de OUTRA
  // corrida — publicar isso é mostrar a sprite de um pedido no lugar do outro.
  const nomeDoArquivo = 'bbbbbbbbbbbbbbb1';
  const declaradoDentro = 'bbbbbbbbbbbbbbb2';
  seedPngs(nomeDoArquivo, [0]);
  seedPngs(declaradoDentro, [0]);
  seedFile(`${nomeDoArquivo}.json`, JSON.stringify(manifest(declaradoDentro, 1)));

  const lista = await hashes();
  assert.ok(!lista.includes(nomeDoArquivo), 'nem sob o nome do arquivo');
  assert.ok(!lista.includes(declaradoDentro), 'nem sob o hash que ele declara');
});

test('GET /api/sprite-lab: manifesto com `candidates` que não é array é ignorado', async () => {
  const hash = 'ccccccccccccccc1';
  seedPngs(hash, [0]);
  seedFile(`${hash}.json`, JSON.stringify({ version: 1, hash, candidates: { '0': {} } }));
  assert.ok(!(await hashes()).includes(hash));
});

test('GET /api/sprite-lab: manifesto sem candidato nenhum fica de fora', async () => {
  // `candidates: []` passa em "todo PNG do manifesto existe" por vacuidade. Uma
  // corrida sem candidato não tem o que mostrar, e publicá-la poria um cartão
  // vazio na tela.
  const hash = 'ccccccccccccccc2';
  seedFile(`${hash}.json`, JSON.stringify({ version: 1, hash, candidates: [] }));
  assert.ok(!(await hashes()).includes(hash));
});

test('GET /api/sprite-lab: corrida cujos PNGs ainda não chegaram entra SÓ quando eles chegam', async () => {
  // A corrida em andamento: manifesto em disco, bytes ainda não. É o estado que
  // o catálogo não pode publicar — e o que ele PRECISA publicar assim que os
  // arquivos aparecem, sem exigir reinício do servidor.
  const hash = 'ddddddddddddddd1';
  seedFile(`${hash}.json`, JSON.stringify(manifest(hash, 2)));
  assert.ok(!(await hashes()).includes(hash), 'sem bytes, não é resultado');

  seedPngs(hash, [0]);
  assert.ok(!(await hashes()).includes(hash), 'meia corrida também não é resultado');

  seedPngs(hash, [1]);
  const publicada = (await runs()).find((r) => r['hash'] === hash);
  assert.ok(publicada, 'com os dois PNGs em disco a corrida aparece');
  assert.equal(publicada['candidateCount'], 2);
  const candidatos = publicada['candidates'] as Array<Record<string, unknown>>;
  assert.equal(candidatos[0]?.['southUrl'], `/sprite-lab/${hash}-cand0/south-00.png`);
  assert.equal(candidatos[1]?.['southUrl'], `/sprite-lab/${hash}-cand1/south-00.png`);
});

test('GET /api/sprite-lab: lixo no diretório é ignorado sem derrubar a rota', async () => {
  const bom = 'eeeeeeeeeeeeeee1';
  seedRun(bom, 1);

  // Tudo o que pode aparecer numa pasta de trabalho: nome fora do formato de
  // hash, extensão errada, arquivo do sistema, diretório solto, e o próprio
  // diretório de candidatos (que NÃO é manifesto e nunca pode virar corrida).
  seedFile('anotacoes.txt', 'nada a ver');
  seedFile('zzzz.json', '{"version":1}');
  seedFile('0123456789abcdef0.json', JSON.stringify(manifest('0123456789abcdef0', 1)));
  seedFile('.DS_Store', 'lixo do sistema');
  seedFile(`${bom}.json.tmp`, 'escrita atômica interrompida');
  mkdirSync(join(SPRITE_LAB(), 'pasta-solta'), { recursive: true });

  const lista = await hashes();
  assert.ok(lista.includes(bom), 'a corrida boa continua lá');
  for (const impostor of ['anotacoes.txt', 'zzzz', '0123456789abcdef0', 'pasta-solta']) {
    assert.ok(!lista.includes(impostor), `"${impostor}" não pode virar corrida`);
  }
  // Nenhum hash publicado foge do formato que o GET por hash aceita.
  for (const h of lista) {
    assert.match(h, /^[a-f0-9]{16}$/i, `hash publicado fora do formato: ${h}`);
  }
});

test('GET /api/sprite-lab: o caminho EXATO não cai no ramo do hash, e o hash malformado ainda é 404', async () => {
  // As duas rotas dividem o prefixo, e a ordem delas em `api.ts` é o que separa
  // uma da outra. Este teste é a trava dessa ordem.
  const catalogo = await get('/api/sprite-lab');
  assert.equal(catalogo.status, 200);
  assert.ok(Array.isArray(catalogo.json['runs']), 'o caminho exato devolve {runs}');
  assert.equal(catalogo.json['status'], undefined, 'e NUNCA um status de corrida');

  const porHash = await get('/api/sprite-lab/zzz');
  assert.equal(porHash.status, 404, 'hash fora do formato é o único 404 da rota');
});

test('GET /api/sprite-lab: toda corrida publicada tem `at` de data real e config quando o manifesto a guarda', async () => {
  const lista = await runs();
  assert.ok(lista.length > 0, 'os testes anteriores deixaram corridas publicadas');
  for (const r of lista) {
    const at = r['at'];
    assert.ok(
      typeof at === 'string' && !Number.isNaN(Date.parse(at)),
      `at inválido em ${JSON.stringify(r['hash'])}: ${JSON.stringify(at)}`,
    );
    const candidatos = r['candidates'] as Array<Record<string, unknown>>;
    assert.equal(
      candidatos.length,
      r['candidateCount'],
      'candidateCount tem que contar os candidatos que viajam junto',
    );
  }
});

// ------------------------------------------------------------------ abertura da fila

test('uma falha ao ABRIR a fila não fica guardada para sempre — a requisição seguinte tenta de novo', async () => {
  // O DEFEITO: `jobQueue()` memoizava com `??=`, então a PROMESSA REJEITADA
  // ficava no cache. Medido com o diretório em modo 555, as três requisições
  // seguintes devolviam 500 com a mesma mensagem — inclusive depois de o disco
  // voltar ao normal. Como `GET /api/studio` é o poll de 3 s da tela, um soluço
  // de disco derrubava a UI até alguém reiniciar o Vite. `loadFromDisk` do
  // estúdio faz o oposto (cai para o seed), e é esse o comportamento certo para
  // infraestrutura do editor.
  const HASH = '00112233445566aa';

  // Esquece a fila que os testes acima abriram: o que está sob teste é a
  // ABERTURA, e ela só acontece uma vez por promessa guardada.
  await closeQueueForTests();

  // Estado com UM job: sem ele a reconciliação não escreve nada e a abertura
  // não teria como falhar.
  writeFileSync(
    join(dir, 'job-queue.json'),
    `${JSON.stringify({
      version: 1,
      nextSeq: 1,
      updatedAt: new Date(0).toISOString(),
      jobs: [
        {
          key: 'sprite-lab::00112233445566aa',
          label: 'sprite-lab · 00112233445566aa',
          seq: 0,
          enqueuedAt: new Date(0).toISOString(),
          descriptor: { kind: 'sprite-lab', hash: HASH, config: { description: 'x' } },
          cellKeys: [],
          status: 'pronto',
          attempts: 1,
          paid: false,
        },
      ],
    })}\n`,
  );

  chmodSync(dir, 0o555);
  let escritaFalhou = true;
  try {
    const r1 = await get(`/api/sprite-lab/${HASH}`);
    if (r1.status !== 500) {
      // Rodando como root, ou num FS que ignora o modo: o cenário não existe
      // nesta máquina e o teste não tem o que afirmar.
      escritaFalhou = false;
    } else {
      const r2 = await get(`/api/sprite-lab/${HASH}`);
      assert.equal(r2.status, 500, 'com o disco ainda travado, o erro se repete');
    }
  } finally {
    chmodSync(dir, 0o755);
  }

  if (!escritaFalhou) return;

  // Disco de volta ao normal: a rota TEM de voltar a responder.
  const r3 = await get(`/api/sprite-lab/${HASH}`);
  assert.equal(
    r3.status,
    200,
    `depois de o disco voltar, a fila reabre; veio ${r3.status}: ${JSON.stringify(r3.json)}`,
  );
});
