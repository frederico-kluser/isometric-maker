/**
 * A fiação entre `server/api.ts` e a fila FIFO persistente (`server/job-queue.ts`).
 *
 * ## Por que este arquivo existe separado de `api.test.ts`
 *
 * Pelo mesmo motivo que `api-sprite-lab.test.ts`: o AMBIENTE é outro, e ele é
 * lido uma vez só, na carga do módulo.
 *
 *   1. **O teto de admissão precisa ser 1.** `CHARACTER_BUILDER_JOB_CONCURRENCY=1`
 *      é o que torna a ordem de chegada OBSERVÁVEL: com uma vaga só, um job
 *      pendurado no submit segura todos os outros em `'na-fila'`, e as posições
 *      1, 2, 3 são fato, não corrida. `api.test.ts` roda com o teto default (8)
 *      e mede outra coisa.
 *   2. **O arquivo de estado da fila precisa nascer SEMEADO.** O teste de
 *      retomada escreve um job já COBRADO em disco ANTES de importar `api.ts`,
 *      porque a reconciliação acontece na abertura da fila. Semear isso no meio
 *      de `api.test.ts` mudaria o resultado dos testes que já estão lá.
 *
 * ## Rede: IMPOSSÍVEL aqui, e a prova é local
 *
 * `globalThis.fetch` é substituído por um dublê que NUNCA sai da máquina: ele
 * anota o caminho pedido, guarda o `AbortSignal` recebido e devolve uma promessa
 * que o teste resolve na hora que quiser — primeiro pendurada (o job fica
 * deterministicamente `'gerando'`), depois com um 400 sintético (que
 * `PixelLabClient` não retenta em POST, então a falha é imediata e sem backoff).
 * O token é falso e só existe para `client()` não recusar antes da hora. Mesma
 * técnica que `api.test.ts` já usa no teste do 409 do bloco em geração.
 *
 * ## O que está sob verificação, e por que cada item é sobre dinheiro
 *
 *   - `202` traz a POSIÇÃO na fila, e o excedente fica `'na-fila'` — o estado
 *     que existia em `model.ts` e que ninguém escrevia.
 *   - A célula acompanha, inclusive nas rotas do wizard, que NÃO pré-marcam:
 *     ali quem escreve é o espelho `syncJobCells`.
 *   - Um POST repetido sobre job `'na-fila'` NÃO submete de novo. Este era o
 *     defeito caro: o `Map` anterior só reconhecia `'gerando'`, e um segundo
 *     clique sobre um pedido enfileirado virava segunda submissão PAGA.
 *   - Cancelar enfileirado remove sem gastar; cancelar em execução ABORTA de
 *     verdade — o `AbortSignal` do job chega ao `fetch`, e o teste lê o signal
 *     que o transporte recebeu para provar isso.
 *   - O recheque de idempotência (`stillNeeded`) dispensa, sem chamar o
 *     executor, um bloco que ficou pronto enquanto o pedido esperava.
 *   - Retomada depois de "reinício": um job PAGO reaberto do disco NÃO é
 *     redespachado. Ele vira `'interrompido'` — terminal, nomeado — com `paid` e
 *     `remote` intactos, e ZERO chamadas saem. Este teste rodava com o token
 *     APAGADO e media a coisa errada; ver a nota em `PIXELLAB_SECRET`, acima.
 *
 * Execute com: node --test server/api-queue.test.ts
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  cellKey,
  seedStudio,
  southKey,
  type Character,
  type Studio,
} from './model.ts';

// ------------------------------------------------------------------ ambiente isolado

const dir = mkdtempSync(join(tmpdir(), 'api-queue-test-'));
const STUDIO_PATH = join(dir, 'studio.json');
const ASSETS_DIR = join(dir, 'assets');
const QUEUE_PATH = join(dir, 'job-queue.json');
process.env['CHARACTER_BUILDER_STUDIO_JSON'] = STUDIO_PATH;
process.env['CHARACTER_BUILDER_ASSETS_DIR'] = ASSETS_DIR;
process.env['CHARACTER_BUILDER_JOB_QUEUE_JSON'] = QUEUE_PATH;
// UMA vaga. Ver o cabeçalho: é isto que troca corrida por fato.
process.env['CHARACTER_BUILDER_JOB_CONCURRENCY'] = '1';
/**
 * TOKEN FALSO DESDE A CARGA DO MÓDULO, e isto é a correção de um teste que
 * media a coisa errada.
 *
 * O teste de retomada rodava com `delete process.env['PIXELLAB_SECRET']` e
 * declarava, na própria mensagem do assert, o motivo de ver zero chamadas:
 * *"nenhuma chamada saiu — nem havia token"*. Ele provava que `client()` recusa
 * sem token — o que já tem teste próprio — e NÃO que a retomada deixa de
 * ressubmeter. Com o token presente (a condição normal de uso) o mesmo fixture
 * mandava um `POST /animate-character` por um job JÁ PAGO.
 *
 * O token é sintético e não sai da máquina: `globalThis.fetch` é dublado logo
 * abaixo, antes de qualquer teste rodar.
 */
process.env['PIXELLAB_SECRET'] = 'token-falso-que-nunca-sai-da-maquina';

/**
 * Mesmo desvio de `api.test.ts`: o `node --test` transporta o resultado deste
 * arquivo pelo stdout do processo filho, num protocolo com prefixo de tamanho,
 * e log de job em segundo plano caindo no meio de um quadro aborta o arquivo
 * inteiro. A fila loga MUITO (admissão, clamp, retomada), então sem isto aqui o
 * arquivo não fecha.
 */
console.log = (...args: unknown[]): void => {
  console.error(...args);
};

const originalFetch = globalThis.fetch;

/**
 * A fila é FECHADA antes de o tmpdir ir embora — ver a nota longa no `after` de
 * `api.test.ts`. Aqui isso importa ainda mais: este arquivo deixa jobs de
 * propósito pendurados no `fetch` dublado, e sem `closeQueueForTests` eles
 * continuariam escrevendo `job-queue.json` durante o `rmSync`.
 *
 * A ORDEM É OBRIGATÓRIA: fechar a fila ANTES de devolver o `fetch` original.
 * `close({abortRunning:true})` aborta o que está em voo e ESPERA os executores
 * desenrolarem; se o `fetch` real voltasse antes, uma retentativa nascida nesse
 * desenrolar sairia da máquina de verdade — com um token falso, mas sairia.
 */
after(async () => {
  const { closeQueueForTests } = await import('./api.ts');
  await closeQueueForTests();
  globalThis.fetch = originalFetch;
  delete process.env['PIXELLAB_SECRET'];
  rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ fixture

const AGORA = new Date().toISOString();
const studio = seedStudio();
studio.lock = { frameCount: 8, fps: 8, size: 128 };
const base = studio.characters[0]!;
// Com `remoteId` e wizard concluído: as poses chegam ao submit em vez de morrer
// na pré-condição. É o que faz o dublê de fetch ser exercitado.
studio.characters[0] = {
  ...base,
  remoteId: 'personagem-remoto-de-teste',
  wizard: { etapa: 'pronto', southVersions: [], activeSouth: 0 },
};
const GUERREIRO: Character = {
  id: 'guerreiro',
  label: 'Guerreiro',
  silhouette: 'humano-medio',
  description: '',
  size: 128,
  seed: 2,
  wizard: { etapa: 'sul', southVersions: [], activeSouth: 0 },
  createdAt: AGORA,
};
studio.characters.push(GUERREIRO);
writeFileSync(STUDIO_PATH, `${JSON.stringify(studio, null, 2)}\n`);

/** O job que o "reinício" deixou pela metade — e que JÁ FOI COBRADO. */
const JOB_RETOMADO = cellKey('manequim', 'atacando');
const REMOTE_JA_COBRADO = 'bg-job-que-ja-custou-dinheiro';
writeFileSync(
  QUEUE_PATH,
  `${JSON.stringify(
    {
      version: 1,
      nextSeq: 1,
      jobs: [
        {
          key: JOB_RETOMADO,
          label: 'Manequim base · Atacando',
          seq: 0,
          enqueuedAt: AGORA,
          descriptor: { kind: 'pose', characterId: 'manequim', poseId: 'atacando' },
          cellKeys: [JOB_RETOMADO],
          status: 'gerando',
          attempts: 1,
          paid: true,
          remote: { jobIds: [REMOTE_JA_COBRADO] },
          startedAt: Date.now() - 60_000,
        },
      ],
      updatedAt: AGORA,
    },
    null,
    2,
  )}\n`,
);

// Import dinâmico DEPOIS do env: api.ts lê as costuras na carga do módulo.
const { handle } = await import('./api.ts');

// ------------------------------------------------------------------ dublê de fetch

/** Caminhos pedidos ao `fetch`. Nenhum deles sai da máquina. */
const caminhosPedidos: string[] = [];
/** Resolvedores das chamadas penduradas — o teste decide quando cada uma cai. */
let penduradas: Array<(res: unknown) => void> = [];
/** O signal que o transporte recebeu na última chamada. */
let signalRecebido: AbortSignal | undefined;
/** A partir daqui toda chamada nova falha na hora, sem pendurar. */
let falharNaHora = false;

/**
 * 400 sintético. `PixelLabClient.request` NÃO retenta 4xx em POST ("the request
 * may have been processed and billed but the response was lost" só vale para
 * 5xx), então a falha volta na primeira tentativa, sem backoff — o teste não
 * espera os seis retries do cliente.
 */
function respostaRecusada(): unknown {
  return {
    ok: false,
    status: 400,
    headers: { get: (): string | null => null },
    text: async (): Promise<string> =>
      JSON.stringify({ detail: 'recusado pelo dublê de teste — nada saiu da máquina' }),
  };
}

globalThis.fetch = ((input: unknown, init?: { signal?: AbortSignal }) => {
  caminhosPedidos.push(String(input));
  signalRecebido = init?.signal;
  if (falharNaHora) return Promise.resolve(respostaRecusada() as Response);
  return new Promise<Response>((resolve) => {
    penduradas.push(resolve as (r: unknown) => void);
  });
}) as unknown as typeof fetch;

function derrubarPenduradas(): void {
  const lista = penduradas;
  penduradas = [];
  for (const resolve of lista) resolve(respostaRecusada());
}

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

async function call(method: string, path: string, body?: unknown) {
  const res = mockRes();
  const handled = await handle(
    mockReq(method, path, body),
    res as unknown as ServerResponse,
  );
  assert.equal(handled, true, `${method} ${path} deveria ser tratada pelo handler`);
  return {
    status: res.statusCode,
    json: JSON.parse(res.body) as Record<string, unknown>,
  };
}

const post = (path: string, body: unknown) => call('POST', path, body);
const del = (path: string) => call('DELETE', path, {});
const get = (path: string) => call('GET', path);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ leitura de estado

interface JobView {
  readonly key: string;
  readonly status: string;
  readonly message?: string;
  readonly queuePosition?: number;
  readonly paid: boolean;
  readonly attempts: number;
}

async function jobsDoEstudio(): Promise<Record<string, JobView>> {
  const r = await get('/api/studio');
  return r.json['jobs'] as Record<string, JobView>;
}

function lerStudio(): Studio {
  return JSON.parse(readFileSync(STUDIO_PATH, 'utf8')) as Studio;
}

interface EstadoDaFila {
  readonly jobs: ReadonlyArray<{
    readonly key: string;
    readonly paid: boolean;
    readonly resumed?: boolean;
    readonly remote?: { readonly jobIds?: readonly string[] };
  }>;
}

function lerEstadoDaFila(): EstadoDaFila {
  return JSON.parse(readFileSync(QUEUE_PATH, 'utf8')) as EstadoDaFila;
}

/** Espera uma condição virar verdadeira, ou falha com a mensagem dada. */
async function esperarAte(
  condicao: () => boolean | Promise<boolean>,
  oQueFalhou: string,
  tentativas = 200,
): Promise<void> {
  for (let i = 0; i < tentativas; i += 1) {
    if (await condicao()) return;
    await sleep(20);
  }
  assert.fail(oQueFalhou);
}

async function esperarJob(key: string, pronto: (j: JobView) => boolean): Promise<JobView> {
  let visto: JobView | undefined;
  await esperarAte(async () => {
    visto = (await jobsDoEstudio())[key];
    return visto !== undefined && pronto(visto);
  }, `o job "${key}" nunca chegou ao estado esperado`);
  return visto!;
}

/** Semeia um bloco v3 (textura animada) em disco — sem geração, só arquivos. */
function semearBloco(hash: string): void {
  const blocoDir = join(ASSETS_DIR, 'world-blocks', hash);
  mkdirSync(blocoDir, { recursive: true });
  writeFileSync(
    join(blocoDir, 'block.json'),
    JSON.stringify({
      version: 3,
      hash,
      technique: 'texture',
      description: 'semeado pelo teste',
      animated: true,
      frameCount: 4,
      fps: 8,
      pingPong: true,
    }),
  );
  // `readWorldBlockResult` só checa a EXISTÊNCIA do artefato na v3/texture —
  // não decodifica o PNG. Bytes quaisquer bastam e o teste não precisa de zlib.
  writeFileSync(join(blocoDir, 'spritesheet.png'), Buffer.from('nao-e-um-png-de-verdade'));
}

// ------------------------------------------------------------------ retomada (ADR 0023)

test('retomada: job PAGO reaberto do disco NÃO ressubmete, MESMO com token válido', async () => {
  // A primeira rota abre a fila, que reconcilia o `'gerando'` interrompido. O
  // token EXISTE e o `fetch` está dublado: se o executor for redespachado, a
  // submissão aparece em `caminhosPedidos` — foi assim que o defeito foi
  // reproduzido, com este mesmo fixture e uma linha de diferença.
  const antes = caminhosPedidos.length;
  assert.equal(antes, 0, 'este é o primeiro teste do arquivo: nada pode ter saído antes');

  await get('/api/studio');

  // Espera um estado OBSERVÁVEL: ou a fila concluiu o job, ou uma chamada saiu.
  // Determinístico dos dois lados — não é paciência de teste.
  await esperarAte(
    async () => {
      if (caminhosPedidos.length > 0) return true;
      const s = (await jobsDoEstudio())[JOB_RETOMADO]?.status;
      return s === 'interrompido' || s === 'falhou' || s === 'cancelado' || s === 'pronto';
    },
    'a retomada nunca chegou a um estado observável',
    100,
  );

  assert.deepEqual(
    caminhosPedidos,
    [],
    'NENHUMA submissão pode sair na retomada de um job já pago — ' +
      `saíram: ${caminhosPedidos.join(', ')}`,
  );

  const fim = await esperarJob(
    JOB_RETOMADO,
    (j) => j.status === 'interrompido' || j.status === 'falhou',
  );
  assert.equal(fim.status, 'interrompido', 'estado terminal NOMEADO: a fila parou de propósito');
  assert.equal(fim.paid, true, 'o registro do que já foi cobrado sobrevive à reabertura');
  assert.equal(
    fim.attempts,
    1,
    'a tentativa que ficou em disco, e nenhuma nova: o executor não foi chamado',
  );
  assert.match(
    String(fim.message),
    /cobrada/i,
    'a mensagem tem de dizer que a geração já foi paga, senão o usuário compra de novo',
  );
  assert.match(
    String(fim.message),
    /gerar de novo/i,
    'e tem de dizer que refazer é decisão do usuário — o servidor não decide sozinho',
  );

  const job = lerEstadoDaFila().jobs.find((j) => j.key === JOB_RETOMADO);
  assert.ok(job, 'o registro do job pago não pode sumir do disco');
  assert.equal(job.resumed, true, 'o job foi marcado como retomado');
  assert.deepEqual(
    job.remote?.jobIds,
    [REMOTE_JA_COBRADO],
    'o identificador remoto é o ÚNICO caminho de volta ao artefato pago',
  );

  // E a célula acompanhou, com a mensagem que explica a cobrança. `CellStatus`
  // não tem valor para `'interrompido'`, então `cellStatusFor` o colapsa em
  // `'falhou'` — que é onde a UI oferece "gerar de novo", o clique deliberado
  // que substitui a retomada automática. O espelho é SERIALIZADO e assíncrono de
  // propósito (ver `syncJobCells`), então ele chega DEPOIS do status do job —
  // esperar por ele é parte do contrato, não paciência de teste.
  await esperarAte(
    () => lerStudio().cells[JOB_RETOMADO]?.status === 'falhou',
    'a célula tinha de acompanhar o job interrompido',
  );
  assert.match(String(lerStudio().cells[JOB_RETOMADO]?.error), /cobrada/i);
});

// ------------------------------------------------------------------ FIFO observável

const CHAVE_A = cellKey('manequim', 'parado');
const CHAVE_B = cellKey('manequim', 'caminhando');
const CHAVE_C = cellKey('manequim', 'correndo');
const CHAVE_D = southKey('guerreiro');
let signalDoJobA: AbortSignal | undefined;
let hashDoBloco = '';

test('202 traz a POSIÇÃO na fila; o excedente fica "na-fila" e a célula acompanha', async () => {
  // O token já está no ambiente desde a carga do módulo — ver a nota lá em cima.
  const a = await post('/api/generate', { characterId: 'manequim', poseId: 'parado' });
  assert.equal(a.status, 202, `esperava 202, veio ${a.status}: ${JSON.stringify(a.json)}`);
  assert.equal(a.json['position'], 1, 'primeiro da fila vazia é a posição 1');

  // O job A toma a única vaga e fica pendurado no submit. Daqui para baixo
  // NADA drena, e por isso as posições abaixo são fato e não corrida.
  await esperarAte(
    () => caminhosPedidos.length === 1,
    'o job A precisava chegar ao submit e ficar pendurado lá',
  );
  signalDoJobA = signalRecebido;
  assert.ok(signalDoJobA, 'o submit da pose tem de receber um AbortSignal');
  assert.equal(signalDoJobA.aborted, false);

  const b = await post('/api/generate', { characterId: 'manequim', poseId: 'caminhando' });
  const c = await post('/api/generate', { characterId: 'manequim', poseId: 'correndo' });
  const d = await post('/api/wizard/south', {
    characterId: 'guerreiro',
    description: 'guerreiro de teste, sem rede envolvida',
  });
  assert.deepEqual(
    [b.status, c.status, d.status],
    [202, 202, 202],
    'enfileirar responde 202',
  );
  assert.deepEqual(
    [b.json['position'], c.json['position'], d.json['position']],
    [1, 2, 3],
    'FIFO: a posição é a ordem de chegada, e não a de conclusão',
  );

  const jobs = await jobsDoEstudio();
  assert.equal(jobs[CHAVE_A]?.status, 'gerando', 'o primeiro ocupou a vaga');
  assert.equal(jobs[CHAVE_B]?.status, 'na-fila', 'o segundo está VIVO e enfileirado');
  assert.equal(jobs[CHAVE_B]?.queuePosition, 1);
  assert.equal(jobs[CHAVE_C]?.queuePosition, 2);
  assert.equal(jobs[CHAVE_D]?.status, 'na-fila');
  assert.equal(jobs[CHAVE_D]?.queuePosition, 3);

  // O teto efetivo e a origem dele viajam junto — é o que a tela precisa para
  // dizer "1 simultânea" E de onde esse 1 saiu.
  const stats = (await get('/api/studio')).json['queue'] as Record<string, unknown>;
  assert.equal(stats['concurrency'], 1);
  assert.equal(stats['concurrencySource'], 'env');
  assert.equal(stats['queued'], 3);
  assert.equal(stats['running'], 1);

  // A CÉLULA acompanha. Nas poses a rota pré-marca; na sul do wizard NÃO —
  // ali quem escreve 'na-fila' é o espelho `syncJobCells`, e é este assert que
  // prova que ele existe.
  await esperarAte(
    () => lerStudio().cells[CHAVE_B]?.status === 'na-fila',
    'a célula da pose enfileirada tinha de estar "na-fila"',
  );
  await esperarAte(
    () => lerStudio().cells[CHAVE_D]?.status === 'na-fila',
    'a célula da sul do guerreiro tinha de virar "na-fila" pelo espelho do onChange',
  );
});

// ------------------------------------------------------------------ dinheiro: duplicata

test('POST repetido sobre job "na-fila" NÃO submete de novo', async () => {
  // O defeito que este teste tranca: o registro anterior só reconhecia
  // 'gerando', então um segundo clique sobre um pedido ENFILEIRADO passava reto
  // e submetia — segunda cobrança pela mesma coisa.
  const antes = caminhosPedidos.length;
  const r = await post('/api/generate', { characterId: 'manequim', poseId: 'caminhando' });
  assert.equal(r.status, 202, 'duplicata não é erro: a chave já está na fila');
  assert.equal(r.json['duplicate'], true);
  assert.equal(r.json['status'], 'na-fila');
  await sleep(50);
  assert.equal(
    caminhosPedidos.length,
    antes,
    'submissão duplicada de job enfileirado NÃO pode sair — é dinheiro',
  );
  const jobs = await jobsDoEstudio();
  assert.equal(jobs[CHAVE_B]?.queuePosition, 1, 'o pedido duplicado não reordena a fila');
});

// ------------------------------------------------------------------ cancelamento

test('cancelar job "na-fila" remove sem gastar e apaga a célula', async () => {
  const antes = caminhosPedidos.length;
  const r = await del(`/api/jobs/${CHAVE_C}`);
  assert.equal(r.status, 200, `esperava 200, veio ${r.status}`);
  assert.equal(r.json['status'], 'cancelado');
  assert.equal(r.json['aborted'], false, 'ele nunca chegou a rodar');
  assert.equal(r.json['paid'], false, 'nada foi cobrado');
  assert.equal(caminhosPedidos.length, antes, 'cancelar não submete nada');

  assert.equal((await jobsDoEstudio())[CHAVE_C]?.status, 'cancelado');
  await esperarAte(
    () => lerStudio().cells[CHAVE_C] === undefined,
    'a célula do job cancelado antes de rodar tem de voltar ao vazio',
  );
});

test('cancelar chave desconhecida é 404; cancelar job terminal devolve o status dele', async () => {
  const r404 = await del('/api/jobs/nao::existe');
  assert.equal(r404.status, 404);

  const rTerminal = await del(`/api/jobs/${CHAVE_C}`);
  assert.equal(rTerminal.status, 200, 'job já terminal não é erro');
  assert.equal(rTerminal.json['status'], 'cancelado');
});

// ------------------------------------------------------------------ stillNeeded

test('stillNeeded: bloco que ficou pronto enquanto esperava entra na fila e sai SEM executor', async () => {
  const r = await post('/api/world-block', {
    description: 'lava do teste de fila',
    technique: 'texture',
    seed: 3,
  });
  assert.equal(r.status, 202, `esperava 202, veio ${r.status}: ${JSON.stringify(r.json)}`);
  hashDoBloco = String(r.json['hash']);
  assert.match(hashDoBloco, /^[a-f0-9]{16}$/);

  // Enquanto o pedido espera na fila, o bloco APARECE em disco (outra corrida,
  // uma importação, o que for). O recheque roda na DRENAGEM justamente para
  // enxergar isso — a conferência é no teste de drenagem, abaixo.
  semearBloco(hashDoBloco);

  // E, ainda enfileirado, ele NÃO pode cair no ramo 'desconhecido' do GET: a
  // tela trata aquele estado como perda definitiva e para de sondar.
  const g = await get(`/api/world-block/${hashDoBloco}`);
  assert.equal(g.status, 200);
  assert.equal(g.json['status'], 'pronto', 'com o manifesto em disco o GET já responde pronto');
});

test('bloco EM FILA não pode ser apagado sem antes sair da fila', async () => {
  // O DELETE recusava só 'gerando'. Um bloco 'na-fila' era apagado e sobrava um
  // job órfão que regeraria — pagando — o que o usuário mandou apagar. Agora o
  // enfileirado é CANCELADO junto (nada foi gasto) e o diretório vai embora.
  const r = await post('/api/world-block', {
    description: 'bloco que vai ser apagado ainda na fila',
    technique: 'texture',
    seed: 11,
  });
  assert.equal(r.status, 202);
  const hash = String(r.json['hash']);
  assert.equal((await jobsDoEstudio())[`world-block::${hash}`]?.status, 'na-fila');

  // Enfileirado NÃO é 'desconhecido': aquele status a tela lê como perda
  // definitiva e para de sondar, e o job rodaria sozinho com a tela em erro.
  const emFila = await get(`/api/world-block/${hash}`);
  assert.equal(emFila.status, 200);
  assert.equal(emFila.json['status'], 'gerando', 'andamento nomeado, nunca perdido');
  assert.equal(emFila.json['queued'], true, 'e a distinção viaja em campo aditivo');
  // A posição vem da MESMA fila que `/api/studio` publica — o número exato
  // depende de quantos pedidos os testes acima deixaram esperando, e travá-lo
  // aqui seria acoplar este teste à ordem do arquivo.
  assert.equal(
    emFila.json['position'],
    (await jobsDoEstudio())[`world-block::${hash}`]?.queuePosition,
    'a posição do GET e a de /api/studio são a mesma fila',
  );

  const d = await del(`/api/world-block/${hash}`);
  assert.equal(d.status, 200, `esperava 200, veio ${d.status}: ${JSON.stringify(d.json)}`);
  assert.equal(d.json['cancelledQueued'], true, 'o job enfileirado foi cancelado junto');
  assert.equal(
    (await jobsDoEstudio())[`world-block::${hash}`]?.status,
    'cancelado',
    'não pode sobrar job vivo apontando para um bloco que não existe mais',
  );
  // E o GET volta a "desconhecido" — o registro do job apagado é esquecido.
  const g = await get(`/api/world-block/${hash}`);
  assert.equal(g.json['status'], 'desconhecido');
});

// ------------------------------------------------------------------ abortar de verdade

test('cancelar job EM EXECUÇÃO aborta a chamada em voo — o signal chega ao transporte', async () => {
  assert.ok(signalDoJobA, 'o teste de FIFO precisa ter rodado antes');
  assert.equal(signalDoJobA.aborted, false, 'antes do cancelamento o signal está limpo');

  const r = await del(`/api/jobs/${CHAVE_A}`);
  assert.equal(r.status, 200, `esperava 200, veio ${r.status}`);
  assert.equal(r.json['status'], 'cancelado');
  assert.equal(r.json['aborted'], true, 'ele estava rodando: o cancelamento é um abort');
  assert.equal(
    r.json['paid'],
    false,
    'a submissão ficou pendurada e nunca foi aceita — nada foi cobrado',
  );

  // A prova de que o cancelamento é REAL e não cosmético: o `AbortSignal` que
  // `PixelLabClient.request` passou ao fetch foi abortado. Sem a fiação do
  // `ctx.signal` este assert falha — o signal do transporte seria só o timeout.
  assert.equal(
    signalDoJobA.aborted,
    true,
    'o signal do job tem de chegar ao submit, senão cancelar só relabela o registro',
  );
});

// ------------------------------------------------------------------ drenagem

test('a fila drena o resto em ordem e o bloco já pronto conclui SEM chamar o executor', async () => {
  // Daqui em diante toda chamada nova falha na hora: o objetivo é ver a fila
  // ANDAR, não ver os jobs darem certo (dar certo exigiria a API de verdade).
  falharNaHora = true;
  derrubarPenduradas();

  const chaveBloco = `world-block::${hashDoBloco}`;
  await esperarAte(async () => {
    const jobs = await jobsDoEstudio();
    return [CHAVE_A, CHAVE_B, CHAVE_D, chaveBloco].every((k) => {
      const s = jobs[k]?.status;
      return s === 'pronto' || s === 'falhou' || s === 'cancelado';
    });
  }, 'a fila tinha de drenar tudo depois que a vaga foi liberada');

  const jobs = await jobsDoEstudio();
  // O permite do semáforo voltou mesmo depois de um cancelamento: se não
  // voltasse, B e D ficariam presos em 'na-fila' para sempre.
  assert.equal(jobs[CHAVE_B]?.status, 'falhou', 'o segundo da fila rodou e falhou no 400');
  assert.equal(jobs[CHAVE_D]?.status, 'falhou');

  // O BLOCO: dispensado pelo recheque, sem executor e sem chamada.
  assert.equal(jobs[chaveBloco]?.status, 'pronto');
  assert.match(String(jobs[chaveBloco]?.message), /já estava pronto/);
  assert.equal(
    jobs[chaveBloco]?.attempts,
    0,
    'attempts sobe em #start, e #start nunca foi chamado: o executor não rodou, logo nada foi gasto',
  );
  assert.equal(jobs[chaveBloco]?.paid, false);

  // Nenhuma chamada de bloco isométrico saiu — o recheque economizou a geração.
  assert.ok(
    !caminhosPedidos.some((p) => p.includes('isometric-tile')),
    `o bloco já em disco não podia gerar chamada; saíram: ${caminhosPedidos.join(', ')}`,
  );

  // Fila quieta ao fim: o `after` pode apagar o tmpdir sem job escrevendo nele.
  await esperarAte(async () => {
    const finais = await jobsDoEstudio();
    return !Object.values(finais).some(
      (j) => j.status === 'na-fila' || j.status === 'gerando',
    );
  }, 'a fila tinha de ficar vazia ao fim do arquivo');
});
