/**
 * Testes da fila persistente. NENHUM toca a rede: o executor entra por injeção
 * e nunca há cliente PixelLab aqui — este arquivo não pode custar um centavo.
 *
 * O relógio, a espera e o log também são injetados, então nada aqui depende de
 * tempo de parede a não ser o `waitFor`, que sonda o próprio estado da fila em
 * vez de dormir um prazo arbitrário.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TIER_CONCURRENCY } from "../../pixellab-pipeline/src/cost.ts";
import { weightFor } from "../../pixellab-pipeline/src/queue.ts";
import {
	DEFAULT_CONCURRENCY,
	ENDPOINT_BY_KIND,
	JOB_KINDS,
	JobQueue,
	SPRITE_LAB_MAX_PARALLEL_CALLS,
	cellStatusFor,
	classifyByStatus,
	defaultStatePath,
	resolveConcurrency,
	resolveConcurrencyDecision,
	weightForDescriptor,
	type JobDescriptor,
	type JobQueueOptions,
	type QueuedJob,
	type RemoteHandle,
} from "./job-queue.ts";
import type { WorldBlockConfig } from "./world-block.ts";

// ---------------------------------------------------------------- utilidades

interface Deferred<T> {
	readonly promise: Promise<T>;
	resolve(value: T): void;
	reject(err: unknown): void;
}

function deferred<T = void>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (err: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/**
 * Sonda uma condição do estado da fila. O orçamento é folgado de propósito: ele
 * só é gasto quando o teste vai falhar de verdade, e a suíte inteira roda em
 * paralelo — um teto apertado transformaria máquina carregada em falso negativo.
 */
async function waitFor(
	predicate: () => boolean,
	label = "condição",
): Promise<void> {
	for (let i = 0; i < 20_000; i += 1) {
		if (predicate()) return;
		await new Promise((r) => setTimeout(r, 1));
	}
	throw new Error(`waitFor: ${label} não aconteceu`);
}

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "job-queue-"));
	try {
		return await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

const OPEN_DEFAULTS = {
	concurrency: 1,
	// Alto de propósito: o limitador não pode virar espera de parede no teste.
	ratePerSecond: 1000,
	sleep: async (): Promise<void> => {},
	// `stillNeeded` é obrigatório na API: o default silencioso `() => true` era
	// "sempre gaste", e um chamador distraído perdia o recheque de idempotência
	// sem erro nenhum. Aqui a escolha é explícita, como tem de ser lá fora.
	stillNeeded: (): boolean => true,
} as const;

function openQueue(
	dir: string,
	overrides: Partial<JobQueueOptions> = {},
): Promise<JobQueue> {
	return JobQueue.open({
		statePath: join(dir, "job-queue.json"),
		execute: async () => {},
		...OPEN_DEFAULTS,
		...overrides,
	});
}

const pose = (poseId: string): JobDescriptor => ({
	kind: "pose",
	characterId: "heroi",
	poseId,
});

function enqueuePose(queue: JobQueue, poseId: string) {
	return queue.enqueue({
		key: `heroi::${poseId}`,
		label: `Herói · ${poseId}`,
		descriptor: pose(poseId),
	});
}

async function readState(dir: string): Promise<{
	nextSeq: number;
	jobs: QueuedJob[];
}> {
	const raw = await readFile(join(dir, "job-queue.json"), "utf8");
	return JSON.parse(raw) as { nextSeq: number; jobs: QueuedJob[] };
}

// ------------------------------------------- medição de simultaneidade real

/**
 * Enfileira uma mistura e devolve QUANTOS EXECUTORES ficaram em voo ao mesmo
 * tempo. Os executores travam num portão até a medição terminar, então o
 * patamar é o teto de admissão da mistura, não uma corrida de quem termina
 * primeiro.
 *
 * A medição tem duas metades, e nenhuma das duas sozinha prova o número:
 *
 *   1. `waitFor(live >= expected)` prova o PISO — a fila realmente admite
 *      tantos ao mesmo tempo. Sem ele, uma máquina carregada faria a medição
 *      parar num patamar intermediário e o teste viraria falso negativo.
 *   2. a janela de 30 ms depois dele deixa entrar quem ainda fosse entrar, e o
 *      `peak` medido depois dela pega o excesso. **Ela só prova o teto quando
 *      há job SOBRANDO na fila** — se `expected` for igual ao número de jobs
 *      enfileirados, não existe candidato a mais e a janela é satisfeita à toa.
 *      Nessas chamadas (a maioria dos braços "DEPOIS" das aceitações) quem
 *      prova o teto é o PAR: o braço "ANTES", com o modelo antigo, mede um
 *      patamar menor sobre a mesma mistura, e a assertiva de `inFlightWeight`
 *      mostra a ocupação exata. A metade sozinha não prova.
 *
 * O `expected` é declarado pelo teste de propósito: o critério de aceitação
 * desta onda é um número, e um número que o próprio harness descobre não pode
 * falhar quando estiver errado.
 */
async function observeParallelism(
	dir: string,
	entries: readonly { readonly key: string; readonly descriptor: JobDescriptor }[],
	overrides: Partial<JobQueueOptions>,
	expected: number,
): Promise<{ readonly peak: number; readonly inFlightWeight: number }> {
	let live = 0;
	let peak = 0;
	const gate = deferred();
	const queue = await openQueue(dir, {
		...overrides,
		execute: async () => {
			live += 1;
			peak = Math.max(peak, live);
			await gate.promise;
			live -= 1;
		},
	});
	try {
		for (const e of entries) {
			await queue.enqueue({
				key: e.key,
				label: e.key,
				descriptor: e.descriptor,
			});
		}
		await waitFor(() => live >= expected, `${expected} executores em voo`);
		await new Promise((r) => setTimeout(r, 30));
		return { peak, inFlightWeight: queue.stats().inFlightWeight };
	} finally {
		gate.resolve();
		await queue.idle();
		await queue.close();
	}
}

/**
 * O modelo de peso ANTERIOR, reconstruído a partir da mesma fonte que ele usava
 * — `COST_TABLE[...].concurrencyWeight` via `weightFor`. Não são números
 * copiados à mão: se a tabela do pipeline mudar, o "antes" desta comparação
 * muda junto, como tem de ser.
 */
const pesoAntigo = (d: JobDescriptor): number =>
	weightFor(ENDPOINT_BY_KIND[d.kind]);

/** O teto anterior: DEFAULT_TIER era `t2`. */
const TETO_ANTIGO = TIER_CONCURRENCY.t2;

const mix = (
	prefix: string,
	count: number,
	make: (i: number) => JobDescriptor,
): { readonly key: string; readonly descriptor: JobDescriptor }[] =>
	Array.from({ length: count }, (_, i) => ({
		key: `${prefix}-${i}`,
		descriptor: make(i),
	}));

const spriteLab = (outputs: number) =>
	(i: number): JobDescriptor => ({
		kind: "sprite-lab",
		hash: `h${i}`,
		config: { description: "x", size: 64, outputs },
	});

// ---------------------------------------------------------------- FIFO

test("drena na ordem de chegada", async () => {
	await withDir(async (dir) => {
		const ran: string[] = [];
		const queue = await openQueue(dir, {
			execute: async (ctx) => {
				ran.push(ctx.job.key);
			},
		});
		await enqueuePose(queue, "a");
		await enqueuePose(queue, "b");
		await enqueuePose(queue, "c");
		await queue.idle();
		await queue.close();

		assert.deepEqual(ran, ["heroi::a", "heroi::b", "heroi::c"]);
	});
});

test("a ordem vem do número de chegada, não do relógio (empate de milissegundo)", async () => {
	await withDir(async (dir) => {
		const ran: string[] = [];
		// Relógio CONGELADO: todos os jobs nascem com o mesmo enqueuedAt. Se a
		// ordenação dependesse do tempo, isto seria empate não determinístico.
		const queue = await openQueue(dir, {
			now: () => 1_700_000_000_000,
			execute: async (ctx) => {
				ran.push(ctx.job.key);
			},
		});
		for (const id of ["z", "y", "x", "w"]) await enqueuePose(queue, id);
		await queue.idle();
		await queue.close();

		assert.deepEqual(ran, ["heroi::z", "heroi::y", "heroi::x", "heroi::w"]);
		const seqs = queue.list().map((j) => j.seq);
		assert.deepEqual(seqs, [0, 1, 2, 3]);
		assert.equal(
			new Set(queue.list().map((j) => j.enqueuedAt)).size,
			1,
			"todos com o mesmo carimbo — a ordem não pode ter vindo dele",
		);
	});
});

test("quem chega enquanto outro roda entra atrás dele", async () => {
	await withDir(async (dir) => {
		const ran: string[] = [];
		const gate = deferred();
		const queue = await openQueue(dir, {
			execute: async (ctx) => {
				ran.push(ctx.job.key);
				if (ctx.job.key === "heroi::bloqueio") await gate.promise;
			},
		});
		await enqueuePose(queue, "bloqueio");
		await waitFor(() => queue.running().length === 1, "bloqueio começou");
		await enqueuePose(queue, "a");
		await enqueuePose(queue, "b");

		assert.deepEqual(ran, ["heroi::bloqueio"], "nada mais entrou ainda");
		assert.deepEqual(
			queue.pending().map((j) => j.key),
			["heroi::a", "heroi::b"],
		);

		gate.resolve();
		await queue.idle();
		await queue.close();
		assert.deepEqual(ran, ["heroi::bloqueio", "heroi::a", "heroi::b"]);
	});
});

test("a posição na fila é observável e 1-based", async () => {
	await withDir(async (dir) => {
		const gate = deferred();
		const queue = await openQueue(dir, {
			execute: async (ctx) => {
				if (ctx.job.key === "heroi::bloqueio") await gate.promise;
			},
		});
		await enqueuePose(queue, "bloqueio");
		await waitFor(() => queue.running().length === 1);
		const primeiro = await enqueuePose(queue, "a");
		const segundo = await enqueuePose(queue, "b");

		assert.equal(primeiro.accepted && primeiro.position, 1);
		assert.equal(segundo.accepted && segundo.position, 2);
		assert.equal(queue.toStudioJobs()["heroi::b"]?.queuePosition, 2);
		assert.equal(
			queue.toStudioJobs()["heroi::bloqueio"]?.queuePosition,
			undefined,
			"quem já saiu da fila não tem posição",
		);

		gate.resolve();
		await queue.idle();
		await queue.close();
	});
});

// ---------------------------------------------------------------- persistência

test("o estado sobrevive a um reinício, com a ordem intacta", async () => {
	await withDir(async (dir) => {
		const primeira = await openQueue(dir, {
			// Executor que nunca resolve: os jobs ficam presos na fila e o
			// arquivo é escrito com eles.
			execute: () => new Promise<void>(() => {}),
		});
		await enqueuePose(primeira, "a");
		await enqueuePose(primeira, "b");
		await enqueuePose(primeira, "c");
		await primeira.close();

		const ran: string[] = [];
		const segunda = await openQueue(dir, {
			execute: async (ctx) => {
				ran.push(ctx.job.key);
			},
		});
		await segunda.idle();
		await segunda.close();

		// O `a` estava EM VOO quando o processo caiu, e a fila não sabe se o
		// executor dele chegou a submeter — ele não é redespachado. `b` e `c`
		// nunca saíram da fila (`attempts === 0`), e esses continuam sendo
		// drenados na ordem original de chegada.
		assert.deepEqual(
			ran,
			["heroi::b", "heroi::c"],
			"os que nunca rodaram foram redespachados na ordem original de chegada",
		);
		assert.equal(
			segunda.get("heroi::a")?.status,
			"interrompido",
			"o que estava em voo NÃO volta a rodar sozinho: ressubmeter cobra de novo",
		);
		assert.equal(
			segunda.get("heroi::a")?.resumed,
			true,
			"o que estava em voo veio marcado como retomado",
		);
		assert.equal(segunda.get("heroi::b")?.resumed, undefined);
	});
});

test("o job carrega o payload: o descritor volta inteiro do disco", async () => {
	await withDir(async (dir) => {
		const descriptor: JobDescriptor = {
			kind: "sprite-lab",
			hash: "0123456789abcdef",
			config: {
				description: "cavaleiro de armadura enferrujada",
				size: 64,
				outputs: 2,
				seed: 7,
				view: "low top-down",
			},
		};
		const primeira = await openQueue(dir, {
			execute: () => new Promise<void>(() => {}),
		});
		// UM BLOQUEADOR NA FRENTE, e ele é o ponto do teste tanto quanto o
		// descritor: com o teto em 1 ele toma a vaga e o job de sprite-lab
		// atravessa o reinício em `'na-fila'`, com `attempts === 0`. Sem isso o
		// sprite-lab seria admitido, o processo cairia com ele em voo, e a
		// reconciliação — corretamente — se recusaria a redespachá-lo, porque
		// `sprite-lab` não sabe retomar de graça. O que se verifica aqui é o
		// descritor sobrevivendo ao disco, não a política de retomada.
		await enqueuePose(primeira, "bloqueador");
		await primeira.enqueue({
			key: "sprite-lab::0123456789abcdef",
			label: "sprite-lab · 0123456789abcdef",
			descriptor,
			cellKeys: [],
		});
		await waitFor(() => primeira.running().length === 1, "o bloqueador entrou");
		await primeira.close();

		let visto: JobDescriptor | undefined;
		const segunda = await openQueue(dir, {
			execute: async (ctx) => {
				visto = ctx.job.descriptor;
			},
		});
		await segunda.idle();
		await segunda.close();

		// Este é o defeito central que o módulo fecha: hoje só o closure sabe o
		// que rodar, e o closure morre com o processo.
		assert.deepEqual(visto, descriptor);
	});
});

test("job interrompido em 'gerando' vira terminal 'interrompido', marcado como retomado", async () => {
	await withDir(async (dir) => {
		// Nunca resolvido de propósito: simula o Vite reiniciando com job em voo.
		// Uma promise pendente não segura o event loop do runner.
		const primeira = await openQueue(dir, {
			execute: () => new Promise<void>(() => {}),
		});
		await enqueuePose(primeira, "a");
		await waitFor(() => primeira.running().length === 1);
		await primeira.close();

		const emDisco = await readState(dir);
		assert.equal(emDisco.jobs[0]?.status, "gerando");

		const gate = deferred();
		const segunda = await openQueue(dir, {
			execute: async () => {
				await gate.promise;
			},
		});
		const job = segunda.get("heroi::a");
		assert.ok(job);
		assert.equal(job.resumed, true);
		// ANTES ele voltava a ser "drenável", e drenar aqui é ressubmeter.
		assert.equal(job.status, "interrompido", "terminal: ninguém o executa de novo");
		assert.equal(segunda.pending().length, 0);
		assert.equal(segunda.running().length, 0);
		gate.resolve();
		await segunda.idle();
		await segunda.close();
	});
});

test("o log da retomada declara a incerteza em vez de afirmar que nada foi gasto", async () => {
	await withDir(async (dir) => {
		const primeira = await openQueue(dir, {
			execute: () => new Promise<void>(() => {}),
		});
		await enqueuePose(primeira, "a");
		await waitFor(() => primeira.running().length === 1);
		await primeira.close();

		const logs: string[] = [];
		const segunda = await openQueue(dir, {
			onLog: (m) => logs.push(m),
			execute: () => new Promise<void>(() => {}),
		});
		const linha = logs.find((m) => m.includes("INTERROMPIDO"));
		assert.ok(linha, `a interrupção tem de logar; saiu: ${logs.join(" | ")}`);
		// Entre o `submit` do executor e o `await ctx.markPaid` o dinheiro já saiu
		// e o disco ainda diz `paid: false`. Se o processo morre aí, este é
		// exatamente o job que reabre — e a fila NÃO tem como distinguir "nunca
		// submeteu" de "submeteu e morreu antes de anotar". Afirmar o mais barato
		// dos dois é certeza fingida sobre a fatura de alguém.
		assert.doesNotMatch(linha, /nada foi gasto/);
		assert.match(linha, /não foi verificado/i);
		// E a mensagem que a UI mostra diz a mesma coisa, em pt-BR, sem jargão.
		const msg = String(segunda.get("heroi::a")?.message);
		assert.doesNotMatch(msg, /nada foi gasto/);
		assert.match(msg, /pode ter sido cobrada/);
		assert.match(msg, /gerar de novo é decisão sua/i);
		await segunda.close();
	});
});

test("retomada de job PAGO preserva paid e o identificador remoto", async () => {
	await withDir(async (dir) => {
		const primeira = await openQueue(dir, {
			execute: async (ctx) => {
				await ctx.markPaid({ characterId: "char-42", jobIds: ["bg-1"] });
				await new Promise<void>(() => {});
			},
		});
		await enqueuePose(primeira, "a");
		await waitFor(() => primeira.get("heroi::a")?.paid === true, "pagou");
		await primeira.close();

		const segunda = await openQueue(dir, {
			execute: () => new Promise<void>(() => {}),
		});
		const job = segunda.get("heroi::a");
		assert.ok(job);
		assert.equal(job.paid, true, "o dinheiro saiu e o registro sabe disso");
		assert.equal(job.remote?.characterId, "char-42");
		assert.deepEqual(job.remote?.jobIds, ["bg-1"]);
		assert.deepEqual(
			segunda.paidUnfinished().map((j) => j.key),
			["heroi::a"],
			"a retomada enxerga o job pago sem artefato",
		);
		await segunda.close();
	});
});

test("markPaid grava no disco ANTES de o executor seguir para o poll", async () => {
	await withDir(async (dir) => {
		let vistoNoDisco: QueuedJob | undefined;
		const queue = await openQueue(dir, {
			execute: async (ctx) => {
				await ctx.markPaid({ characterId: "char-1" });
				// Ponto exato onde o poll começaria. O identificador já tem de
				// estar no arquivo — é o caminho de volta ao artefato (ADR 0023).
				const state = await readState(dir);
				vistoNoDisco = state.jobs.find((j) => j.key === ctx.job.key);
			},
		});
		await enqueuePose(queue, "a");
		await queue.idle();
		await queue.close();

		assert.ok(vistoNoDisco);
		assert.equal(vistoNoDisco.paid, true);
		assert.equal(vistoNoDisco.remote?.characterId, "char-1");
	});
});

test("nextSeq nunca regride, mesmo com arquivo adulterado", async () => {
	await withDir(async (dir) => {
		await writeFile(
			join(dir, "job-queue.json"),
			JSON.stringify({
				version: 1,
				nextSeq: 0,
				updatedAt: new Date(0).toISOString(),
				jobs: [
					{
						key: "heroi::antigo",
						label: "antigo",
						seq: 41,
						enqueuedAt: new Date(0).toISOString(),
						descriptor: { kind: "pose", characterId: "heroi", poseId: "antigo" },
						cellKeys: [],
						status: "pronto",
						attempts: 1,
						paid: false,
					},
				],
			}),
		);
		const queue = await openQueue(dir);
		const novo = await enqueuePose(queue, "novo");
		assert.ok(novo.accepted);
		assert.equal(novo.job.seq, 42, "seq novo tem de passar do maior em disco");
		await queue.idle();
		await queue.close();
	});
});

test("arquivo de estado corrompido não derruba a fila", async () => {
	await withDir(async (dir) => {
		await writeFile(join(dir, "job-queue.json"), "{ isto não é json");
		const queue = await openQueue(dir);
		assert.deepEqual(queue.list(), []);
		const r = await enqueuePose(queue, "a");
		assert.ok(r.accepted);
		await queue.idle();
		await queue.close();
	});
});

test("registro sem descritor conhecido é descartado na leitura", async () => {
	await withDir(async (dir) => {
		await writeFile(
			join(dir, "job-queue.json"),
			JSON.stringify({
				version: 1,
				nextSeq: 5,
				updatedAt: new Date(0).toISOString(),
				jobs: [
					{ key: "lixo", seq: 1, descriptor: { kind: "inventado" } },
					{
						key: "heroi::ok",
						label: "ok",
						seq: 2,
						enqueuedAt: new Date(0).toISOString(),
						descriptor: { kind: "pose", characterId: "heroi", poseId: "ok" },
						cellKeys: [],
						status: "na-fila",
						attempts: 0,
						paid: false,
					},
				],
			}),
		);
		const ran: string[] = [];
		const queue = await openQueue(dir, {
			execute: async (ctx) => {
				ran.push(ctx.job.key);
			},
		});
		await queue.idle();
		await queue.close();
		assert.deepEqual(ran, ["heroi::ok"]);
	});
});

test("adulteração: status inválido não vira zumbi, e paid ausente conta como PAGO", async () => {
	await withDir(async (dir) => {
		const base = {
			label: "x",
			enqueuedAt: new Date(0).toISOString(),
			cellKeys: [],
			attempts: 0,
		};
		await writeFile(
			join(dir, "job-queue.json"),
			JSON.stringify({
				version: 1,
				nextSeq: 9,
				updatedAt: new Date(0).toISOString(),
				jobs: [
					{
						...base,
						key: "heroi::zumbi",
						seq: 1,
						descriptor: { kind: "pose", characterId: "heroi", poseId: "zumbi" },
						status: "inventado",
						paid: false,
					},
					{
						...base,
						key: "heroi::sem-paid",
						seq: 2,
						descriptor: { kind: "pose", characterId: "heroi", poseId: "sem-paid" },
						status: "na-fila",
						// `paid` AUSENTE de propósito — é o campo que decide se este
						// registro pode ser ressubmetido.
					},
				],
			}),
		);
		const ran: string[] = [];
		const queue = await openQueue(dir, {
			maxAttempts: 5,
			execute: async (ctx) => {
				ran.push(ctx.job.key);
				throw Object.assign(new Error("503 no poll"), { status: 503 });
			},
		});
		await queue.idle();
		await queue.close();

		// Com status fora do conjunto válido o registro não era terminal, nem
		// 'na-fila', nem 'gerando': sumia de pending(), de running(), da poda e da
		// limpeza, e ficava imortal no arquivo.
		const zumbi = queue.get("heroi::zumbi");
		assert.ok(zumbi, "o registro não some: pode ser trilha de dinheiro");
		assert.equal(zumbi.status, "falhou");
		assert.equal(queue.pending().length, 0);
		assert.equal(queue.running().length, 0);
		assert.ok(!ran.includes("heroi::zumbi"), "e nunca é executado");

		// 503 é retentável — mas só para quem não pagou. Com `paid` ausente lido
		// como `false`, isto seriam cinco submissões pagas pela mesma coisa.
		assert.deepEqual(ran, ["heroi::sem-paid"], "uma chamada, não cinco");
		const semPaid = queue.get("heroi::sem-paid");
		assert.equal(semPaid?.paid, true, "na dúvida, o lado seguro é 'já custou'");
		assert.equal(semPaid?.attempts, 1);
		assert.equal(semPaid?.status, "falhou");
	});
});

// ---------------------------------------------------------------- concorrência

test("respeita o teto de concorrência", async () => {
	await withDir(async (dir) => {
		let vivos = 0;
		let pico = 0;
		const solta = deferred();
		const queue = await openQueue(dir, {
			concurrency: 2,
			weightOf: () => 1,
			execute: async () => {
				vivos += 1;
				pico = Math.max(pico, vivos);
				await solta.promise;
				vivos -= 1;
			},
		});
		for (const id of ["a", "b", "c", "d", "e"]) await enqueuePose(queue, id);
		await waitFor(() => queue.running().length === 2, "duas em voo");
		// Uma janela para provar que a terceira NÃO entra sozinha.
		await new Promise((r) => setTimeout(r, 20));
		assert.equal(queue.running().length, 2);
		assert.equal(pico, 2);

		solta.resolve();
		await queue.idle();
		await queue.close();
		assert.equal(pico, 2, "o teto valeu do começo ao fim");
	});
});

test("peso maior ocupa mais do teto", async () => {
	await withDir(async (dir) => {
		let pico = 0;
		let vivos = 0;
		const solta = deferred();
		const queue = await openQueue(dir, {
			concurrency: 4,
			// Peso 2 num teto de 4: no máximo dois ao mesmo tempo.
			weightOf: () => 2,
			execute: async () => {
				vivos += 1;
				pico = Math.max(pico, vivos);
				await solta.promise;
				vivos -= 1;
			},
		});
		for (const id of ["a", "b", "c", "d"]) await enqueuePose(queue, id);
		await waitFor(() => queue.running().length === 2);
		await new Promise((r) => setTimeout(r, 20));
		assert.equal(pico, 2);

		solta.resolve();
		await queue.idle();
		await queue.close();
	});
});

test("job mais pesado que o teto roda sozinho em vez de travar a fila", async () => {
	await withDir(async (dir) => {
		// Sem o clamp, WeightedSemaphore.acquire(6) num teto 2 esperaria um
		// release que nunca chega — a fila inteira morreria no primeiro job.
		const ran: string[] = [];
		const queue = await openQueue(dir, {
			concurrency: 2,
			weightOf: () => 6,
			execute: async (ctx) => {
				ran.push(ctx.job.key);
			},
		});
		await enqueuePose(queue, "pesado");
		await enqueuePose(queue, "leve");
		await queue.idle();
		await queue.close();
		assert.deepEqual(ran, ["heroi::pesado", "heroi::leve"]);
	});
});

// ------------------------------------------------ o critério de aceitação
//
// O pedido do usuário foi literal: "quero poder rodar mais gerações
// simultâneas". A única prova disso é CONTAR quantos executores ficam em voo ao
// mesmo tempo, para misturas de jobs que o editor realmente produz — não
// afirmar que o semáforo está correto.
//
// Cada teste mede as duas calibragens no mesmo cenário: o modelo ANTERIOR
// (teto t2 = 4, peso da COST_TABLE) e o atual (teto 8, peso = fan-out de
// chamadas). O número do "antes" não é constante escrita à mão: sai de rodar a
// fila com o peso antigo.

test("aceitação · 8 poses: de 2 simultâneas para 8", async () => {
	await withDir(async (dir) => {
		const poses = mix("pose", 8, (i) => ({
			kind: "pose",
			characterId: "heroi",
			poseId: `p${i}`,
		}));

		const antes = await observeParallelism(
			dir,
			poses,
			{
				statePath: join(dir, "antes.json"),
				concurrency: TETO_ANTIGO,
				weightOf: pesoAntigo,
			},
			2,
		);
		const depois = await observeParallelism(
			dir,
			poses,
			{ statePath: join(dir, "depois.json"), concurrency: DEFAULT_CONCURRENCY },
			8,
		);

		// animate-character pesava 2 num teto de 4.
		assert.equal(antes.peak, 2, "ANTES: 8 poses rodavam de duas em duas");
		// Uma pose é UMA submissão. As oito cabem no teto e rodam juntas — que é
		// exatamente o que o servidor sem limite nenhum já fazia hoje.
		assert.equal(depois.peak, 8, "DEPOIS: as oito juntas");
		assert.equal(depois.inFlightWeight, 8, "teto cheio, sem sobra");
	});
});

test("aceitação · 4 blocos de mundo: 2 simultâneos, e o limite é o fan-out", async () => {
	await withDir(async (dir) => {
		const blocos = mix("bloco", 4, (i) => ({
			kind: "world-block",
			hash: `h${i}`,
			config: { description: `bloco ${i}` },
		}));

		const antes = await observeParallelism(
			dir,
			blocos,
			{
				statePath: join(dir, "antes.json"),
				concurrency: TETO_ANTIGO,
				weightOf: pesoAntigo,
			},
			2,
		);
		const depois = await observeParallelism(
			dir,
			blocos,
			{ statePath: join(dir, "depois.json"), concurrency: DEFAULT_CONCURRENCY },
			2,
		);

		assert.equal(antes.peak, 2, "ANTES: create-isometric-tile pesava 2 num teto de 4");
		// Este é o caso em que a contagem de JOBS não melhora — e o motivo mudou.
		// Antes eram 2 por acidente de tabela; agora são 2 porque cada bloco
		// 'chained' já dispara TRÊS create-isometric-tile em paralelo dentro de
		// si. Dois blocos são 6 chamadas concorrentes, já acima das 4 que são a
		// única evidência medida. Admitir os quatro seriam 12, e isso seria
		// inventar folga que ninguém mediu.
		assert.equal(depois.peak, 2, "DEPOIS: 2 blocos = 6 chamadas concorrentes");
		assert.equal(depois.inFlightWeight, 6);
	});
});

test("aceitação · 1 guarda-roupa + 4 poses: de 1 simultânea para 5", async () => {
	await withDir(async (dir) => {
		const entries = [
			{
				key: "wardrobe-0",
				descriptor: {
					kind: "wardrobe",
					characterId: "heroi",
					wardrobeId: "elmo",
				} as JobDescriptor,
			},
			...mix("pose", 4, (i) => ({
				kind: "pose",
				characterId: "heroi",
				poseId: `p${i}`,
			})),
		];

		const antes = await observeParallelism(
			dir,
			entries,
			{
				statePath: join(dir, "antes.json"),
				concurrency: TETO_ANTIGO,
				weightOf: pesoAntigo,
			},
			1,
		);
		const depois = await observeParallelism(
			dir,
			entries,
			{ statePath: join(dir, "depois.json"), concurrency: DEFAULT_CONCURRENCY },
			5,
		);

		// O pior caso do modelo antigo: create-character-state pesava 6 num teto
		// de 4, era clampado, e o guarda-roupa — que faz UMA chamada — segurava
		// a fila inteira sozinho. Nenhuma pose entrava junto.
		assert.equal(antes.peak, 1, "ANTES: o guarda-roupa rodava sozinho");
		assert.equal(depois.peak, 5, "DEPOIS: guarda-roupa e as quatro poses juntos");
		assert.equal(depois.inFlightWeight, 5);
	});
});

test("aceitação · 2 sprite-lab com outputs 4: de 1 simultâneo para 2", async () => {
	await withDir(async (dir) => {
		const bancadas = mix("lab", 2, spriteLab(4));

		const antes = await observeParallelism(
			dir,
			bancadas,
			{
				statePath: join(dir, "antes.json"),
				concurrency: TETO_ANTIGO,
				weightOf: pesoAntigo,
			},
			1,
		);
		const depois = await observeParallelism(
			dir,
			bancadas,
			{ statePath: join(dir, "depois.json"), concurrency: DEFAULT_CONCURRENCY },
			2,
		);

		assert.equal(antes.peak, 1, "ANTES: create-character-v3 pesava 3 num teto de 4");
		// 4 + 4 = 8 chamadas create-character-v3 concorrentes. É o dobro da única
		// medição que existe (4 passam, 5 dão 429), e é aposta deliberada: a
		// submissão recusada custa US$ 0,00 e volta para a fila.
		assert.equal(depois.peak, 2, "DEPOIS: as duas bancadas juntas");
		assert.equal(depois.inFlightWeight, 8, "teto cheio");
	});
});

test("aceitação · o outputs do usuário passou a mudar a admissão", async () => {
	await withDir(async (dir) => {
		// No modelo antigo o peso de sprite-lab era 3 fizesse ele 1 ou 4
		// chamadas: escolher `outputs: 1` não comprava simultaneidade nenhuma.
		const um = await observeParallelism(
			dir,
			mix("lab", 8, spriteLab(1)),
			{ statePath: join(dir, "um.json"), concurrency: DEFAULT_CONCURRENCY },
			8,
		);
		const dois = await observeParallelism(
			dir,
			mix("lab", 8, spriteLab(2)),
			{ statePath: join(dir, "dois.json"), concurrency: DEFAULT_CONCURRENCY },
			4,
		);
		assert.equal(um.peak, 8, "outputs=1 é uma chamada: oito bancadas juntas");
		assert.equal(dois.peak, 4, "outputs=2 é duas chamadas: quatro bancadas");
	});
});

// ------------------------------------------------ peso maior que o teto

test("peso maior que o teto: roda sozinho, e o clamp é logado", async () => {
	await withDir(async (dir) => {
		const logs: string[] = [];
		// PIXELLAB_TIER=free resolve para 1 — o cenário real deste clamp.
		const { peak, inFlightWeight } = await observeParallelism(
			dir,
			mix("lab", 3, spriteLab(4)),
			{ concurrency: 1, onLog: (m) => logs.push(m) },
			1,
		);
		assert.equal(peak, 1, "um de cada vez, e a fila não trava");
		assert.equal(inFlightWeight, 1, "o job clampado ocupa o teto INTEIRO");
		const clampLogs = logs.filter((m) => m.includes("admitido SOZINHO"));
		// UM log por ADMISSÃO, não por volta do laço: os três jobs entram, um de
		// cada vez, e o log sai de `#start`. Um `>= 1` frouxo passaria mesmo se o
		// log voltasse para antes do `acquire`, onde ele afirma uma admissão que
		// ainda pode não acontecer (recheque de idempotência dispensando o job) e
		// se repete a cada volta do laço sobre a mesma cabeça de fila.
		assert.equal(clampLogs.length, 3, "um log por job admitido — três, nem mais");
		assert.match(clampLogs[0]!, /faz até 4 chamadas simultâneas e o teto é 1/);
	});
});

test("o log do clamp não sai quando o job nem chega a ser admitido", async () => {
	await withDir(async (dir) => {
		// O peso é calculado no laço, ANTES do `acquire` e antes do recheque de
		// idempotência. Enquanto o log saía de lá, este job — que o recheque
		// dispensa de graça, sem executor nenhum — anunciava "admitido SOZINHO"
		// sem nunca ter sido admitido. É a assertiva que segura o log em
		// `#start`; sem ela, mover a linha de volta não quebra nada.
		const logs: string[] = [];
		const ran: string[] = [];
		const queue = await openQueue(dir, {
			concurrency: 1,
			onLog: (m) => logs.push(m),
			stillNeeded: (): boolean => false,
			execute: async (ctx) => {
				ran.push(ctx.job.key);
			},
		});
		await queue.enqueue({
			key: "lab",
			label: "bancada",
			descriptor: spriteLab(4)(0),
		});
		await queue.idle();
		assert.deepEqual(ran, [], "o recheque dispensou o job: nada executou");
		assert.equal(queue.get("lab")?.status, "pronto");
		assert.deepEqual(
			logs.filter((m) => m.includes("admitido SOZINHO")),
			[],
			"ninguém foi admitido — o log não pode afirmar que foi",
		);
		await queue.close();
	});
});

test("peso maior que o teto: DOIS pesados nunca entram juntos", async () => {
	await withDir(async (dir) => {
		// Clampar no teto (e não abaixo dele) é o que garante isso: o job
		// clampado zera o disponível do semáforo. Se algum dia alguém clampar
		// para `teto - 1` "por segurança", dois pesados passam a caber e este
		// teste cai.
		const { peak, inFlightWeight } = await observeParallelism(
			dir,
			mix("lab", 4, spriteLab(4)),
			{ concurrency: 3 },
			1,
		);
		assert.equal(peak, 1);
		assert.equal(inFlightWeight, 3, "o clampado ocupa 3 de 3");
	});
});

test("peso maior que o teto não impede o job LEVE de esperar a vez", async () => {
	await withDir(async (dir) => {
		// A ordem importa: o pesado clampado não pode virar barreira permanente.
		const ran: string[] = [];
		const queue = await openQueue(dir, {
			concurrency: 2,
			execute: async (ctx) => {
				ran.push(ctx.job.key);
			},
		});
		await queue.enqueue({
			key: "lab",
			label: "bancada",
			descriptor: spriteLab(4)(0),
		});
		await enqueuePose(queue, "leve");
		await queue.idle();
		await queue.close();
		assert.deepEqual(ran, ["lab", "heroi::leve"]);
	});
});

// ------------------------------------------------ observabilidade do teto

test("stats publica o teto efetivo, a ocupação e de onde o teto veio", async () => {
	await withDir(async (dir) => {
		const gate = deferred();
		const queue = await openQueue(dir, {
			concurrency: 8,
			execute: async () => {
				await gate.promise;
			},
		});

		const vazia = queue.stats();
		assert.equal(vazia.concurrency, 8);
		assert.equal(vazia.inFlightWeight, 0);
		assert.equal(vazia.availableWeight, 8);
		assert.equal(vazia.concurrencySource, "option");

		// Uma bancada de 4 chamadas + uma pose = 5 ocupados, 3 livres. A
		// ocupação NÃO é a contagem de jobs: são dois jobs pesando cinco.
		await queue.enqueue({
			key: "lab",
			label: "bancada",
			descriptor: spriteLab(4)(0),
		});
		await enqueuePose(queue, "andar");
		await waitFor(() => queue.stats().inFlightWeight === 5, "cinco ocupados");

		const cheia = queue.stats();
		assert.equal(cheia.running, 2, "dois jobs");
		assert.equal(cheia.inFlightWeight, 5, "cinco chamadas simultâneas");
		assert.equal(cheia.availableWeight, 3);
		assert.equal(queue.weightOf(queue.get("lab")!), 4);
		assert.equal(queue.weightOf(queue.get("heroi::andar")!), 1);

		gate.resolve();
		await queue.idle();
		// A ocupação tem de VOLTAR — um vazamento aqui encolheria o teto a cada
		// job e a fila iria parando sozinha, em silêncio.
		assert.equal(queue.stats().inFlightWeight, 0, "ocupação devolvida");
		assert.equal(queue.stats().availableWeight, 8);
		await queue.close();
	});
});

test("a ocupação volta mesmo quando o job falha ou é cancelado", async () => {
	await withDir(async (dir) => {
		const gate = deferred();
		const queue = await openQueue(dir, {
			concurrency: 8,
			maxAttempts: 1,
			execute: async (ctx) => {
				if (ctx.job.key === "lab") throw new Error("estourou");
				await gate.promise;
			},
		});
		await queue.enqueue({
			key: "lab",
			label: "bancada",
			descriptor: spriteLab(4)(0),
		});
		// A devolução da ocupação acontece no `finally` de `#run`, DEPOIS de
		// `#handleFailure` ter persistido o status — então esperar por
		// `'falhou'` e ler a ocupação na linha seguinte é uma corrida, e ela
		// pega 4 em vez de 0 de vez em quando. A ordem está certa no código (o
		// permite do semáforo só volta depois da falha registrada); quem tinha
		// de esperar pelo sinal mais tardio era o teste.
		await waitFor(
			() => queue.stats().inFlightWeight === 0,
			"falha devolve a ocupação",
		);
		assert.equal(queue.get("lab")?.status, "falhou");

		await enqueuePose(queue, "andar");
		await waitFor(() => queue.stats().inFlightWeight === 1, "pose em voo");
		await queue.cancel("heroi::andar");
		gate.resolve();
		await queue.idle();
		assert.equal(
			queue.stats().inFlightWeight,
			0,
			"cancelamento devolve a ocupação",
		);
		await queue.close();
	});
});

test("sem teto explícito a fila usa o que o ambiente resolve", async () => {
	await withDir(async (dir) => {
		// Sem `concurrency`, o teto e a origem têm de ser exatamente os que
		// `resolveConcurrencyDecision` devolve para o ambiente deste processo —
		// é essa fiação que faz PIXELLAB_TIER e CHARACTER_BUILDER_JOB_CONCURRENCY
		// continuarem valendo.
		const queue = await JobQueue.open({
			statePath: join(dir, "job-queue.json"),
			execute: async () => {},
			ratePerSecond: 1000,
			sleep: async (): Promise<void> => {},
			stillNeeded: (): boolean => true,
		});
		const esperado = resolveConcurrencyDecision(process.env);
		assert.equal(queue.concurrency, esperado.limit);
		assert.equal(queue.concurrencySource, esperado.source);
		assert.equal(queue.stats().concurrency, esperado.limit);
		await queue.close();
	});
});

test("resolveConcurrency: override direto, tier e default", () => {
	assert.equal(resolveConcurrency({ CHARACTER_BUILDER_JOB_CONCURRENCY: "7" }), 7);
	assert.equal(resolveConcurrency({ PIXELLAB_TIER: "t3" }), 20);
	assert.equal(resolveConcurrency({ PIXELLAB_TIER: "free" }), 1);
	assert.equal(resolveConcurrency({ PIXELLAB_TIER: "t1" }), 2);
	// O default deixou de ser um tier. O pedido que originou esta onda foi
	// "quero poder rodar mais gerações simultâneas", e um default de 4 com os
	// pesos da COST_TABLE entregava UM sprite-lab por vez — menos que o servidor
	// sem limite que a fila substitui. Ver DEFAULT_CONCURRENCY para o que é
	// medido (4 create-character-v3 concorrentes, desta conta) e o que é
	// inferido (dobrar isso para carga mista).
	assert.equal(resolveConcurrency({}), 8, "default do editor");
	assert.equal(DEFAULT_CONCURRENCY, 8);
	// Declarar o tier DIMINUI o teto, e está certo: é o número da conta contra
	// o palpite do editor.
	assert.equal(resolveConcurrency({ PIXELLAB_TIER: "t2" }), 4);
	assert.equal(
		resolveConcurrency({ PIXELLAB_TIER: "inventado" }),
		8,
		"tier desconhecido cai no default em vez de virar NaN",
	);
	assert.equal(
		resolveConcurrency({ CHARACTER_BUILDER_JOB_CONCURRENCY: "0" }),
		8,
		"zero não é teto válido",
	);
	assert.equal(
		resolveConcurrency({ CHARACTER_BUILDER_JOB_CONCURRENCY: "abc" }),
		8,
	);
	assert.equal(
		resolveConcurrency({ CHARACTER_BUILDER_JOB_CONCURRENCY: "1", PIXELLAB_TIER: "t3" }),
		1,
		"o override direto ganha do tier, inclusive para diminuir",
	);
});

test("resolveConcurrencyDecision diz de ONDE o teto veio", () => {
	assert.deepEqual(
		resolveConcurrencyDecision({ CHARACTER_BUILDER_JOB_CONCURRENCY: "12" }),
		{ limit: 12, source: "env" },
	);
	assert.deepEqual(resolveConcurrencyDecision({ PIXELLAB_TIER: "t3" }), {
		limit: 20,
		source: "tier",
		tier: "t3",
	});
	assert.deepEqual(resolveConcurrencyDecision({}), {
		limit: DEFAULT_CONCURRENCY,
		source: "default",
	});
	// Um tier inválido não é "tier": a origem tem de contar a verdade, senão a
	// tela vai jurar que o usuário declarou algo que ele não declarou.
	assert.equal(resolveConcurrencyDecision({ PIXELLAB_TIER: "t9" }).source, "default");
});

// ---------------------------------------------------------------- cancelamento

test("cancelar antes de começar remove da fila e nada roda", async () => {
	await withDir(async (dir) => {
		const ran: string[] = [];
		const gate = deferred();
		const queue = await openQueue(dir, {
			execute: async (ctx) => {
				ran.push(ctx.job.key);
				if (ctx.job.key === "heroi::bloqueio") await gate.promise;
			},
		});
		await enqueuePose(queue, "bloqueio");
		await waitFor(() => queue.running().length === 1);
		await enqueuePose(queue, "vitima");

		const out = await queue.cancel("heroi::vitima");
		assert.equal(out.result, "removed");
		assert.equal(queue.get("heroi::vitima")?.status, "cancelado");
		assert.equal(queue.get("heroi::vitima")?.paid, false);

		gate.resolve();
		await queue.idle();
		await queue.close();
		assert.deepEqual(ran, ["heroi::bloqueio"], "a vítima nunca rodou");
	});
});

test("cancelar depois de começar aborta o signal de verdade", async () => {
	await withDir(async (dir) => {
		let abortado = false;
		let dentro = false;
		const queue = await openQueue(dir, {
			execute: async (ctx) =>
				new Promise<void>((_, reject) => {
					dentro = true;
					ctx.signal.addEventListener(
						"abort",
						() => {
							abortado = true;
							reject(new Error("chamada abortada"));
						},
						{ once: true },
					);
				}),
		});
		await enqueuePose(queue, "a");
		// Esperar por `running()` não basta: o status vira 'gerando' antes de o
		// executor rodar a primeira linha, e um abort nessa janela não tem
		// ouvinte registrado para pegar.
		await waitFor(() => dentro, "executor entrou");

		const out = await queue.cancel("heroi::a");
		assert.equal(out.result, "aborted");
		assert.equal(abortado, true);
		await waitFor(() => queue.running().length === 0);
		assert.equal(
			queue.get("heroi::a")?.status,
			"cancelado",
			"a rejeição do abort não pode virar 'falhou'",
		);
		await queue.close();
	});
});

test("cancelar job JÁ PAGO não devolve dinheiro e preserva o caminho de volta", async () => {
	await withDir(async (dir) => {
		const queue = await openQueue(dir, {
			execute: async (ctx) => {
				await ctx.markPaid({ characterId: "char-9" });
				await new Promise<void>((_, reject) => {
					ctx.signal.addEventListener(
						"abort",
						() => reject(new Error("poll abortado")),
						{ once: true },
					);
				});
			},
		});
		await enqueuePose(queue, "a");
		await waitFor(() => queue.get("heroi::a")?.paid === true);

		const out = await queue.cancel("heroi::a");
		assert.equal(out.result, "aborted");
		assert.equal(out.result === "aborted" && out.paid, true);
		const job = queue.get("heroi::a");
		assert.equal(job?.remote?.characterId, "char-9");
		assert.match(String(job?.message), /já foi cobrada/);
		await queue.close();
	});
});

test("cancelar o que não existe e o que já terminou são respostas distintas", async () => {
	await withDir(async (dir) => {
		const queue = await openQueue(dir);
		assert.equal((await queue.cancel("nada")).result, "not-found");
		await enqueuePose(queue, "a");
		await queue.idle();
		assert.equal((await queue.cancel("heroi::a")).result, "already-finished");
		await queue.close();
	});
});

test("close({abortRunning}) aborta o que está em voo", async () => {
	await withDir(async (dir) => {
		let abortado = false;
		let dentro = false;
		const queue = await openQueue(dir, {
			execute: async (ctx) =>
				new Promise<void>((resolve) => {
					dentro = true;
					ctx.signal.addEventListener(
						"abort",
						() => {
							abortado = true;
							resolve();
						},
						{ once: true },
					);
				}),
		});
		await enqueuePose(queue, "a");
		await waitFor(() => dentro, "executor entrou");
		await queue.close({ abortRunning: true });
		assert.equal(abortado, true);
		// O fechamento com abort espera o executor desenrolar: a escrita final já
		// tem de estar em disco quando `close` devolve, senão ela sairia depois de
		// alguém ter apagado o diretório de estado.
		const state = await readState(dir);
		assert.equal(state.jobs.find((j) => j.key === "heroi::a")?.status, "pronto");
	});
});

test("onChange que lança não trava a admissão", async () => {
	await withDir(async (dir) => {
		const ran: string[] = [];
		const logs: string[] = [];
		const queue = await openQueue(dir, {
			onLog: (m) => logs.push(m),
			// Na onda seguinte este gancho escreve célula no studio.json — I/O,
			// que falha. Uma exceção aqui chegaria ao laço com o permite do
			// semáforo na mão e a fila iria encolhendo até parar.
			onChange: () => {
				throw new Error("studio.json travado");
			},
			execute: async (ctx) => {
				ran.push(ctx.job.key);
			},
		});
		await enqueuePose(queue, "a");
		await enqueuePose(queue, "b");
		await enqueuePose(queue, "c");
		await queue.idle();
		await queue.close();
		assert.deepEqual(ran, ["heroi::a", "heroi::b", "heroi::c"]);
		assert.ok(logs.some((m) => m.includes("onChange")));
	});
});

test("cancelar entre a admissão e a primeira linha do executor não executa nada", async () => {
	await withDir(async (dir) => {
		let chamadas = 0;
		let cancelamento: Promise<unknown> | undefined;
		let fila: JobQueue | undefined;
		// A janela é curta demais para ser observada por sondagem. `onChange`
		// dispara SÍNCRONO dentro da admissão, logo depois de o status virar
		// 'gerando' e antes de o executor rodar a primeira linha — é o único
		// gancho determinístico para acertar exatamente esse instante.
		const queue = await openQueue(dir, {
			onChange: (job) => {
				if (job.status === "gerando" && cancelamento === undefined) {
					cancelamento = fila?.cancel(job.key);
				}
			},
			execute: async () => {
				chamadas += 1;
			},
		});
		fila = queue;
		await enqueuePose(queue, "a");
		await queue.idle();
		await cancelamento;
		await queue.close();

		// Sem a guarda de `signal.aborted` antes do executor, este job seria
		// submetido — e cobrado — depois de o usuário mandar cancelar.
		assert.equal(chamadas, 0, "nada foi submetido");
		assert.equal(queue.get("heroi::a")?.status, "cancelado");
		assert.equal(queue.get("heroi::a")?.paid, false);
	});
});

test("cancelar ENQUANTO o recheque de idempotência está pendente não executa nada", async () => {
	await withDir(async (dir) => {
		let chamadas = 0;
		const dentroDoRecheque = deferred();
		const liberaRecheque = deferred();
		const queue = await openQueue(dir, {
			// O recheque É assíncrono na vida real — a onda 2 vai passar um que lê
			// disco. Cada `await` do laço de admissão é uma janela em que o
			// cancelamento pode cair, e esta é a última antes da submissão.
			stillNeeded: async () => {
				dentroDoRecheque.resolve();
				await liberaRecheque.promise;
				return true;
			},
			execute: async () => {
				chamadas += 1;
			},
		});
		await enqueuePose(queue, "a");
		await dentroDoRecheque.promise;

		// O job ainda está 'na-fila': nunca começou, e por isso NÃO existe
		// AbortController registrado para o cancelamento abortar. Se a admissão
		// seguisse em frente depois do recheque, ela criaria um controller NOVO e
		// não-abortado, o executor submeteria, e o usuário pagaria por um job que
		// o próprio módulo acabou de responder como "nada foi gasto".
		const out = await queue.cancel("heroi::a");
		assert.equal(out.result, "removed");

		liberaRecheque.resolve();
		await queue.idle();
		await queue.close();

		assert.equal(chamadas, 0, "o executor não pode ter sido chamado");
		const job = queue.get("heroi::a");
		assert.equal(job?.status, "cancelado", "um job terminal não ressuscita");
		assert.equal(job?.paid, false);
		assert.equal(job?.startedAt, undefined, "nem chegou a começar");
		assert.equal(job?.attempts, 0);
	});
});

test("close({abortRunning}) não deixa executor entrar depois de ter resolvido", async () => {
	await withDir(async (dir) => {
		let chamadas = 0;
		let fechado = false;
		const dentroDoRecheque = deferred();
		const liberaRecheque = deferred();
		const queue = await openQueue(dir, {
			stillNeeded: async () => {
				dentroDoRecheque.resolve();
				await liberaRecheque.promise;
				return true;
			},
			execute: async () => {
				chamadas += 1;
			},
		});
		await enqueuePose(queue, "a");
		await dentroDoRecheque.promise;

		// `close` promete aguardar os executores desenrolarem, e faz isso tirando
		// um RETRATO de `#inFlight`. Com a admissão suspensa aqui, o retrato não
		// pode conter uma tarefa que ainda vai ser criada — a única saída é a
		// admissão recusar depois do fechamento.
		const fechamento = queue.close({ abortRunning: true }).then(() => {
			fechado = true;
		});
		liberaRecheque.resolve();
		await fechamento;
		assert.equal(fechado, true);
		// Folga generosa para o laço retomar e (não) admitir.
		await new Promise((r) => setTimeout(r, 30));

		assert.equal(chamadas, 0, "nenhum executor rodou depois de close() resolver");
		assert.equal(
			queue.get("heroi::a")?.status,
			"na-fila",
			"fechar não é cancelar: o job continua drenável no próximo boot",
		);
	});
});

// ------------------------------------------------- idempotência na drenagem

test("recheque na drenagem impede execução redundante", async () => {
	await withDir(async (dir) => {
		let chamadas = 0;
		const prontas = new Set<string>();
		const gate = deferred();
		const queue = await openQueue(dir, {
			stillNeeded: (job) => !prontas.has(job.key),
			execute: async (ctx) => {
				chamadas += 1;
				if (ctx.job.key === "heroi::bloqueio") await gate.promise;
			},
		});
		await enqueuePose(queue, "bloqueio");
		await waitFor(() => queue.running().length === 1);
		await enqueuePose(queue, "redundante");

		// O mundo muda ENQUANTO o job espera: a célula ficou pronta por outro
		// caminho. Rechecar só no enfileiramento não pegaria isto.
		prontas.add("heroi::redundante");
		gate.resolve();
		await queue.idle();
		await queue.close();

		assert.equal(chamadas, 1, "o redundante não chamou o executor");
		const job = queue.get("heroi::redundante");
		assert.equal(job?.status, "pronto");
		assert.equal(job?.paid, false);
		assert.match(String(job?.message), /nada gasto/);
	});
});

test("recheque que lança não bloqueia o job", async () => {
	await withDir(async (dir) => {
		let chamadas = 0;
		const logs: string[] = [];
		const queue = await openQueue(dir, {
			onLog: (m) => logs.push(m),
			stillNeeded: () => {
				throw new Error("disco sumiu");
			},
			execute: async () => {
				chamadas += 1;
			},
		});
		await enqueuePose(queue, "a");
		await queue.idle();
		await queue.close();
		assert.equal(chamadas, 1);
		assert.ok(logs.some((m) => m.includes("recheque")));
	});
});

// ---------------------------------------------------------------- falhas

test("falha fatal marca 'falhou' com a mensagem e não retenta", async () => {
	await withDir(async (dir) => {
		let chamadas = 0;
		const queue = await openQueue(dir, {
			execute: async () => {
				chamadas += 1;
				throw new Error("silhueta incompatível");
			},
		});
		await enqueuePose(queue, "a");
		await queue.idle();
		await queue.close();

		const job = queue.get("heroi::a");
		assert.equal(job?.status, "falhou");
		assert.equal(job?.message, "silhueta incompatível");
		assert.equal(job?.attempts, 1);
		assert.equal(chamadas, 1);
	});
});

test("recusa da conta (429) retenta até o teto e só então falha", async () => {
	await withDir(async (dir) => {
		let chamadas = 0;
		const queue = await openQueue(dir, {
			maxAttempts: 3,
			execute: async () => {
				chamadas += 1;
				throw Object.assign(new Error("Too many concurrent jobs"), {
					status: 429,
				});
			},
		});
		await enqueuePose(queue, "a");
		await queue.idle();
		await queue.close();

		assert.equal(chamadas, 3);
		assert.equal(queue.get("heroi::a")?.status, "falhou");
		assert.equal(queue.get("heroi::a")?.attempts, 3);
	});
});

test("recusa que passa na segunda tentativa termina 'pronto'", async () => {
	await withDir(async (dir) => {
		let chamadas = 0;
		const queue = await openQueue(dir, {
			execute: async () => {
				chamadas += 1;
				// 529 é a recusa NÃO-padrão do fornecedor. Como o 429, ela significa
				// "não aceitei o pedido" — nada gerado, nada cobrado.
				if (chamadas === 1) throw Object.assign(new Error("529"), { status: 529 });
			},
		});
		await enqueuePose(queue, "a");
		await queue.idle();
		await queue.close();
		assert.equal(chamadas, 2);
		assert.equal(queue.get("heroi::a")?.status, "pronto");
	});
});

test("429 desacelera a fila inteira", async () => {
	await withDir(async (dir) => {
		const queue = await openQueue(dir, {
			ratePerSecond: 8,
			maxAttempts: 3,
			execute: async () => {
				throw Object.assign(new Error("Too many concurrent jobs"), {
					status: 429,
				});
			},
		});
		assert.equal(queue.stats().ratePerSecond, 8);
		await enqueuePose(queue, "a");
		await queue.idle();
		await queue.close();
		// penalise() divide por dois a cada 429: 8 → 4 → 2 → 1.
		assert.equal(queue.stats().ratePerSecond, 1);
	});
});

test("job PAGO nunca é retentado, nem com erro transitório", async () => {
	await withDir(async (dir) => {
		let chamadas = 0;
		const queue = await openQueue(dir, {
			maxAttempts: 5,
			execute: async (ctx) => {
				chamadas += 1;
				await ctx.markPaid({ characterId: "char-7" });
				throw Object.assign(new Error("503 no poll"), { status: 503 });
			},
		});
		await enqueuePose(queue, "a");
		await queue.idle();
		await queue.close();

		// A regra mais cara do sistema: retentar aqui seria uma segunda cobrança.
		assert.equal(chamadas, 1, "um job pago não pode ser ressubmetido");
		const job = queue.get("heroi::a");
		assert.equal(job?.status, "falhou");
		assert.equal(job?.paid, true);
		assert.equal(job?.remote?.characterId, "char-7");
		assert.match(String(job?.message), /retomada é gratuita/);
	});
});

test("classifyByStatus separa o que se retenta do que não", () => {
	// RECUSA EXPLÍCITA — a chamada não foi processada, nada foi cobrado.
	assert.equal(classifyByStatus(Object.assign(new Error(""), { status: 429 })), "rate-limited");
	assert.equal(classifyByStatus(Object.assign(new Error(""), { status: 529 })), "rate-limited");
	// 5xx NÃO É MAIS RETENTÁVEL. `pixellab-pipeline/src/api.ts` já recusava
	// retentar POST 5xx — *"the request may have been processed and billed but
	// the response was lost"* — e a fila desfazia essa decisão uma camada acima,
	// reexecutando o job inteiro (o que ressubmete). Medido: submissão 503 →
	// três POSTs; submissão ACEITA com poll 500 → três gerações pagas por um
	// clique.
	for (const status of [500, 502, 503, 504, 408, 425]) {
		assert.equal(
			classifyByStatus(Object.assign(new Error(""), { status })),
			"fatal",
			`${status} não pode voltar a ser retentável: reexecutar o job é ressubmeter`,
		);
	}
	// Validação é bug nosso; retentar só queima cota.
	assert.equal(classifyByStatus(Object.assign(new Error(""), { status: 422 })), "fatal");
	assert.equal(classifyByStatus(Object.assign(new Error(""), { status: 402 })), "fatal");
	assert.equal(classifyByStatus(Object.assign(new Error(""), { status: 410 })), "fatal");
	assert.equal(classifyByStatus(new Error("rede caiu")), "fatal");
	assert.equal(classifyByStatus(undefined), "fatal");
});

// ---------------------------------------------------------------- dedup

test("chave em voo recusa submissão duplicada", async () => {
	await withDir(async (dir) => {
		const gate = deferred();
		const logs: string[] = [];
		const queue = await openQueue(dir, {
			onLog: (m) => logs.push(m),
			execute: async () => {
				await gate.promise;
			},
		});
		const primeira = await enqueuePose(queue, "a");
		assert.ok(primeira.accepted);
		const segunda = await enqueuePose(queue, "a");
		assert.equal(segunda.accepted, false);
		assert.equal(segunda.accepted === false && segunda.reason, "duplicate");
		assert.ok(logs.some((m) => m.includes("duplicada")));

		gate.resolve();
		await queue.idle();
		await queue.close();
		assert.equal(queue.list().length, 1);
	});
});

test("chave já terminal pode ser reenfileirada e vai para o fim", async () => {
	await withDir(async (dir) => {
		const ran: string[] = [];
		const queue = await openQueue(dir, {
			execute: async (ctx) => {
				ran.push(ctx.job.key);
			},
		});
		await enqueuePose(queue, "a");
		await queue.idle();
		const de_novo = await enqueuePose(queue, "a");
		assert.ok(de_novo.accepted);
		assert.equal(de_novo.job.seq, 1, "nasceu com número novo");
		await queue.idle();
		await queue.close();
		assert.deepEqual(ran, ["heroi::a", "heroi::a"]);
		assert.equal(queue.list().length, 1, "a chave é única no registro");
	});
});

test("reenfileirar chave PAGA que falhou herda paid e o identificador remoto", async () => {
	await withDir(async (dir) => {
		const vistos: {
			seq: number;
			paid: boolean;
			remote: RemoteHandle | undefined;
		}[] = [];
		const queue = await openQueue(dir, {
			maxAttempts: 5,
			execute: async (ctx) => {
				vistos.push({
					seq: ctx.job.seq,
					paid: ctx.job.paid,
					remote: ctx.job.remote,
				});
				// Caminho de recuperação: quem já tem identificador re-sonda de
				// graça em vez de submeter de novo.
				if (ctx.job.paid) return;
				await ctx.markPaid({ characterId: "char-7", jobIds: ["bg-1"] });
				throw new Error("download falhou depois da cobrança");
			},
		});
		await enqueuePose(queue, "a");
		await waitFor(
			() => queue.get("heroi::a")?.status === "falhou",
			"falhou já pago",
		);
		assert.deepEqual(vistos[0], { seq: 0, paid: false, remote: undefined });
		assert.match(String(queue.get("heroi::a")?.message), /retomada é gratuita/);

		// A ÚNICA ação que a UI oferece nessa célula é "gerar de novo". Se ela
		// apagasse o registro, apagaria a mesma retomada gratuita que a mensagem
		// acabou de prometer — e o executor pagaria outra vez pelo char-7.
		const denovo = await enqueuePose(queue, "a");
		assert.ok(denovo.accepted);
		assert.equal(denovo.job.seq, 1, "é um pedido novo, no fim da fila");
		assert.equal(denovo.job.paid, true, "o pedido novo nasce sabendo que já custou");
		assert.equal(denovo.job.remote?.characterId, "char-7");

		await queue.idle();
		await queue.close();

		assert.equal(vistos.length, 2);
		assert.equal(vistos[1]?.paid, true, "o executor entra pela recuperação");
		assert.equal(vistos[1]?.remote?.characterId, "char-7");
		assert.deepEqual(vistos[1]?.remote?.jobIds, ["bg-1"]);
		// E o disco também: é dele que o próximo boot vai ler.
		const state = await readState(dir);
		assert.equal(
			state.jobs.find((j) => j.key === "heroi::a")?.remote?.characterId,
			"char-7",
		);
	});
});

test("reenfileirar chave PRONTA não herda: regerar é compra nova e deliberada", async () => {
	await withDir(async (dir) => {
		const vistos: boolean[] = [];
		const queue = await openQueue(dir, {
			execute: async (ctx) => {
				vistos.push(ctx.job.paid);
				await ctx.markPaid({ characterId: `char-${ctx.job.seq}` });
			},
		});
		await enqueuePose(queue, "a");
		await queue.idle();
		assert.equal(queue.get("heroi::a")?.status, "pronto");

		// A fronteira é a mesma de `#prune`: o artefato chegou, o dinheiro virou
		// valor. Herdar aqui devolveria o asset antigo e tornaria a regeração
		// impossível — o oposto do que o usuário pediu ao clicar.
		const denovo = await enqueuePose(queue, "a");
		assert.ok(denovo.accepted);
		assert.equal(denovo.job.paid, false);
		assert.equal(denovo.job.remote, undefined);

		await queue.idle();
		await queue.close();
		assert.deepEqual(vistos, [false, false]);
		assert.equal(queue.get("heroi::a")?.remote?.characterId, "char-1");
	});
});

test("enqueue numa fila fechada é recusado", async () => {
	await withDir(async (dir) => {
		const queue = await openQueue(dir);
		await queue.close();
		const r = await enqueuePose(queue, "a");
		assert.equal(r.accepted, false);
		assert.equal(r.accepted === false && r.reason, "closed");
	});
});

// ---------------------------------------------------------------- projeções

test("toStudioJobs mantém a forma que a UI já lê", async () => {
	await withDir(async (dir) => {
		const queue = await openQueue(dir, {
			now: () => 1_700_000_000_000,
			execute: async () => {},
		});
		await enqueuePose(queue, "a");
		await queue.idle();
		await queue.close();

		const view = queue.toStudioJobs()["heroi::a"];
		assert.ok(view);
		assert.equal(view.key, "heroi::a");
		assert.equal(view.label, "Herói · a");
		assert.equal(view.status, "pronto");
		assert.equal(view.kind, "pose");
		assert.equal(typeof view.startedAt, "number");
		assert.equal(view.paid, false);
		assert.equal(view.attempts, 1);
	});
});

test("cellStatusFor mapeia para os status que o modelo já conhece", () => {
	assert.equal(cellStatusFor("na-fila"), "na-fila");
	assert.equal(cellStatusFor("gerando"), "gerando");
	assert.equal(cellStatusFor("pronto"), "pronto");
	assert.equal(cellStatusFor("falhou"), "falhou");
	// 'cancelado' não existe em CellStatus; a célula volta ao início, que é o
	// que DELETE /api/jobs/:key já faz hoje.
	assert.equal(cellStatusFor("cancelado"), "vazio");
});

test("weightForDescriptor cobre as sete formas e nunca devolve zero", () => {
	const descriptors: JobDescriptor[] = [
		{ kind: "wizard-south", characterId: "h", description: "x" },
		{ kind: "wizard-south-edit", characterId: "h", prompt: "x" },
		{ kind: "wizard-directions8", characterId: "h" },
		{ kind: "pose", characterId: "h", poseId: "p" },
		{ kind: "wardrobe", characterId: "h", wardrobeId: "w" },
		{ kind: "sprite-lab", hash: "a", config: { description: "x", size: 64, outputs: 1 } },
		{ kind: "world-block", hash: "a", config: { description: "x" } },
	];
	assert.equal(descriptors.length, 7);
	for (const d of descriptors) {
		const w = weightForDescriptor(d);
		assert.ok(Number.isInteger(w) && w >= 1, `${d.kind} devolveu ${w}`);
	}
});

test("o peso é o fan-out de CHAMADAS, não o custo do endpoint", () => {
	// Uma submissão, um peso — não importa quão cara ela seja. `wardrobe` é o
	// caso que mais dói: `create-character-state` custa 20–40 gerações e pesava
	// 6 na COST_TABLE, então rodava SEMPRE sozinho num teto de 4. Ele faz UMA
	// chamada; o preço dela não ocupa concorrência.
	const um: JobDescriptor[] = [
		{ kind: "wizard-south", characterId: "h", description: "x" },
		{ kind: "wizard-south-edit", characterId: "h", prompt: "x" },
		{ kind: "wizard-directions8", characterId: "h" },
		{ kind: "pose", characterId: "h", poseId: "p" },
		{ kind: "wardrobe", characterId: "h", wardrobeId: "w" },
	];
	for (const d of um) assert.equal(weightForDescriptor(d), 1, d.kind);

	// A bancada de sprites dispara `outputs` create-character-v3 num
	// Promise.all: o peso É o outputs que o usuário escolheu.
	for (const outputs of [1, 2, 3, 4]) {
		assert.equal(
			weightForDescriptor({
				kind: "sprite-lab",
				hash: "a",
				config: { description: "x", size: 64, outputs },
			}),
			outputs,
			`sprite-lab outputs=${outputs}`,
		);
	}

	// 'chained' faz a norte sozinha e as TRÊS irmãs em paralelo. 'texture' e
	// 'rotated' são seriais: uma chamada de cada vez.
	const block = (config: WorldBlockConfig): number =>
		weightForDescriptor({ kind: "world-block", hash: "a", config });
	assert.equal(block({ description: "x" }), 3, "technique ausente é chained");
	assert.equal(block({ description: "x", technique: "chained" }), 3);
	assert.equal(block({ description: "x", technique: "texture" }), 1);
	assert.equal(block({ description: "x", technique: "rotated" }), 1);
});

test("config adulterada nunca produz peso zero, negativo ou absurdo", () => {
	// O arquivo de estado é editável à mão e sobrevive a quedas no meio de uma
	// escrita. Peso 0 admitiria infinitos jobs; peso negativo devolveria
	// capacidade ao semáforo a cada release e o teto viraria ficção.
	const lab = (outputs: number): number =>
		weightForDescriptor({
			kind: "sprite-lab",
			hash: "a",
			config: { description: "x", size: 64, outputs },
		});
	assert.equal(lab(0), 1);
	assert.equal(lab(-3), 1);
	assert.equal(lab(2.5), 1, "não-inteiro não é fan-out crível");
	assert.equal(lab(Number.NaN), 1);
	assert.equal(
		lab(999),
		SPRITE_LAB_MAX_PARALLEL_CALLS,
		"a bancada valida 1–4; peso maior seria invenção",
	);
});

test("defaultStatePath respeita o seam de teste e é puro", () => {
	assert.equal(
		defaultStatePath({ CHARACTER_BUILDER_JOB_QUEUE_JSON: "/tmp/x.json" }, "/raiz"),
		"/tmp/x.json",
	);
	assert.equal(defaultStatePath({}, "/raiz"), "/raiz/job-queue.json");
});

// ---------------------------------------------------------------- histórico

test("clearFinished remove só os terminais", async () => {
	await withDir(async (dir) => {
		const gate = deferred();
		const queue = await openQueue(dir, {
			execute: async (ctx) => {
				if (ctx.job.key === "heroi::b") await gate.promise;
			},
		});
		await enqueuePose(queue, "a");
		await waitFor(() => queue.get("heroi::a")?.status === "pronto");
		await enqueuePose(queue, "b");
		await waitFor(() => queue.running().length === 1);

		assert.equal(await queue.clearFinished(), 1);
		assert.equal(queue.get("heroi::a"), undefined);
		assert.ok(queue.get("heroi::b"));

		gate.resolve();
		await queue.idle();
		await queue.close();
	});
});

test("clearFinished nunca descarta job PAGO sem artefato", async () => {
	await withDir(async (dir) => {
		const queue = await openQueue(dir, {
			execute: async (ctx) => {
				if (ctx.job.key === "heroi::pago") {
					await ctx.markPaid({ characterId: "char-9" });
					throw new Error("download falhou depois da cobrança");
				}
			},
		});
		await enqueuePose(queue, "pago");
		await waitFor(() => queue.get("heroi::pago")?.status === "falhou");
		await enqueuePose(queue, "ok");
		await queue.idle();

		assert.deepEqual(
			queue.paidUnfinished().map((j) => j.key),
			["heroi::pago"],
		);
		// "Limpar concluídos" é arrumação de UI, e arrumação não apaga
		// contabilidade: sem a mesma guarda que `#prune` tem, um clique levaria
		// junto o único ponteiro para o char-9 que já foi cobrado. O teste antigo
		// só cobria um job 'pronto', que é justamente o caso sem dinheiro em jogo.
		assert.equal(await queue.clearFinished(), 1, "só o 'pronto' saiu");
		assert.equal(queue.get("heroi::ok"), undefined);
		const pago = queue.get("heroi::pago");
		assert.ok(pago, "a trilha do dinheiro que já saiu tem de sobreviver");
		assert.equal(pago.remote?.characterId, "char-9");
		assert.deepEqual(
			queue.paidUnfinished().map((j) => j.key),
			["heroi::pago"],
			"a retomada continua enxergando o que precisa re-sondar",
		);

		const state = await readState(dir);
		assert.deepEqual(
			state.jobs.map((j) => j.key),
			["heroi::pago"],
			"e o disco concorda — é dele que o próximo boot lê",
		);
		await queue.close();
	});
});

test("a poda do histórico nunca descarta job pago sem artefato", async () => {
	await withDir(async (dir) => {
		const queue = await openQueue(dir, {
			historyLimit: 1,
			execute: async (ctx) => {
				if (ctx.job.key === "heroi::pago") {
					await ctx.markPaid({ characterId: "char-3" });
					throw new Error("download falhou depois da cobrança");
				}
			},
		});
		await enqueuePose(queue, "pago");
		await waitFor(() => queue.get("heroi::pago")?.status === "falhou");
		for (const id of ["a", "b", "c", "d"]) await enqueuePose(queue, id);
		await queue.idle();
		await queue.close();

		const pago = queue.get("heroi::pago");
		assert.ok(pago, "o registro do dinheiro que já saiu não pode ser podado");
		assert.equal(pago.remote?.characterId, "char-3");
	});
});

// ---------------------------------------------------------------- log

test("sem onLog nada é impresso — o runner do node não pode ser poluído", async () => {
	await withDir(async (dir) => {
		const original = console.log;
		const capturado: unknown[] = [];
		console.log = (...args: unknown[]) => {
			capturado.push(args);
		};
		try {
			const queue = await openQueue(dir, {
				execute: async () => {
					throw new Error("falha qualquer");
				},
			});
			await enqueuePose(queue, "a");
			await enqueuePose(queue, "a").catch(() => {});
			await queue.idle();
			await queue.close();
		} finally {
			console.log = original;
		}
		assert.deepEqual(capturado, [], "o default de onLog é no-op");
	});
});

// ------------------------------------------------- estado em disco: adulteração
//
// O arquivo é editável à mão e sobrevive a quedas no meio de uma escrita.
// `readState` não pode acreditar em nada dele — e as escolhas que ela faz têm
// consequência de dinheiro, porque um registro descartado é uma trilha de
// cobrança a menos.

/** Escreve um estado cru, do jeito que estiver, no caminho que a fila lê. */
async function writeRawState(dir: string, state: unknown): Promise<void> {
	await writeFile(join(dir, "job-queue.json"), JSON.stringify(state));
}

/** Um registro terminal e PAGO — a trilha do dinheiro que saiu sem artefato. */
function pagoSemArtefato(seq: number) {
	return {
		key: "heroi::pago",
		label: "pago",
		seq,
		enqueuedAt: new Date(0).toISOString(),
		descriptor: { kind: "pose", characterId: "heroi", poseId: "pago" },
		cellKeys: [],
		status: "falhou",
		attempts: 1,
		paid: true,
		remote: { characterId: "char-perdido" },
	};
}

test("estado com version diferente de 1 é descartado INTEIRO, inclusive o job pago", async () => {
	// `readState` compara `parsed.version !== STATE_VERSION` e devolve estado
	// vazio. É a escolha declarada — não derrubar o editor por causa de um
	// arquivo que não entende —, mas o preço dela merece estar escrito: uma
	// futura versão 2 apaga do registro todo job PAGO sem artefato, que é
	// exatamente o que `holdsUnclaimedMoney` existe para nunca perder. Migrar,
	// e não descartar, é o que fecharia isso.
	await withDir(async (dir) => {
		await writeRawState(dir, {
			version: 2,
			nextSeq: 9,
			updatedAt: new Date(0).toISOString(),
			jobs: [pagoSemArtefato(7)],
		});
		const queue = await openQueue(dir);
		assert.deepEqual(queue.list(), [], "versão desconhecida vira estado vazio");
		assert.deepEqual(
			queue.paidUnfinished(),
			[],
			"e a trilha do dinheiro que saiu vai junto",
		);
		// A fila segue funcionando, que é o motivo da escolha.
		const novo = await enqueuePose(queue, "depois");
		assert.ok(novo.accepted);
		assert.equal(novo.accepted && novo.job.seq, 0, "a numeração recomeça do zero");
		await queue.idle();
		await queue.close();
	});
});

test("`jobs` que não é array devolve estado vazio em vez de explodir", async () => {
	for (const jobs of [{}, null, "nenhum", 3] as const) {
		await withDir(async (dir) => {
			await writeRawState(dir, {
				version: 1,
				nextSeq: 4,
				updatedAt: new Date(0).toISOString(),
				jobs,
			});
			const queue = await openQueue(dir);
			assert.deepEqual(queue.list(), [], `jobs=${JSON.stringify(jobs)}`);
			const r = await enqueuePose(queue, "a");
			assert.ok(r.accepted);
			await queue.idle();
			await queue.close();
		});
	}
});

test("nextSeq ausente ou de tipo errado não faz dois jobs nascerem com o mesmo número", async () => {
	// `readState` cai para 0 quando `nextSeq` não é número finito, e a
	// reconciliação sobe para maxSeq+1. Sem essa segunda metade, o job novo
	// nasceria com seq 0 empatando com o que está em disco, e o FIFO — que é
	// ordenação POR SEQ — viraria empate não determinístico.
	for (const nextSeq of [undefined, "12", null, true] as const) {
		await withDir(async (dir) => {
			await writeRawState(dir, {
				version: 1,
				...(nextSeq !== undefined ? { nextSeq } : {}),
				updatedAt: new Date(0).toISOString(),
				jobs: [
					{
						key: "heroi::antigo",
						label: "antigo",
						seq: 12,
						enqueuedAt: new Date(0).toISOString(),
						descriptor: { kind: "pose", characterId: "heroi", poseId: "antigo" },
						cellKeys: [],
						status: "pronto",
						attempts: 1,
						paid: false,
					},
				],
			});
			const queue = await openQueue(dir);
			const novo = await enqueuePose(queue, "novo");
			assert.ok(novo.accepted, `nextSeq=${String(nextSeq)}`);
			assert.equal(
				novo.accepted && novo.job.seq,
				13,
				`nextSeq=${String(nextSeq)} tinha que render 13, e não empatar com 12`,
			);
			await queue.idle();
			await queue.close();
		});
	}
});

test("registro sem chave, sem seq ou com seq não-finito é descartado na leitura", async () => {
	await withDir(async (dir) => {
		const base = {
			label: "x",
			enqueuedAt: new Date(0).toISOString(),
			cellKeys: [],
			status: "na-fila",
			attempts: 0,
			paid: false,
			descriptor: { kind: "pose", characterId: "heroi", poseId: "p" },
		};
		await writeRawState(dir, {
			version: 1,
			nextSeq: 20,
			updatedAt: new Date(0).toISOString(),
			jobs: [
				{ ...base, seq: 1 }, // sem key
				{ ...base, key: "", seq: 2 }, // key vazia
				{ ...base, key: "heroi::sem-seq" }, // sem seq
				{ ...base, key: "heroi::seq-texto", seq: "3" }, // seq não é número
				null,
				"nem objeto é",
				{
					...base,
					key: "heroi::valido",
					seq: 5,
					descriptor: { kind: "pose", characterId: "heroi", poseId: "valido" },
				},
			],
		});
		const ran: string[] = [];
		const queue = await openQueue(dir, {
			execute: async (ctx) => {
				ran.push(ctx.job.key);
			},
		});
		await queue.idle();
		await queue.close();
		assert.deepEqual(
			queue.list().map((j) => j.key),
			["heroi::valido"],
			"só o registro redespachável sobrevive",
		);
		assert.deepEqual(ran, ["heroi::valido"]);
	});
});

// ---------------------------------------------------------------- ociosidade

test("idle() com a fila vazia resolve na hora, sem esperar nada", async () => {
	await withDir(async (dir) => {
		const queue = await openQueue(dir);
		let timer: NodeJS.Timeout | undefined;
		const estourou = new Promise<"estourou">((resolve) => {
			timer = setTimeout(() => resolve("estourou"), 5_000);
		});
		try {
			const quem = await Promise.race([
				queue.idle().then(() => "idle" as const),
				estourou,
			]);
			assert.equal(quem, "idle", "idle() numa fila vazia não pode ficar pendurada");
		} finally {
			if (timer) clearTimeout(timer);
		}
		// E de novo depois de um job ter passado — o waiter não pode ficar preso.
		await enqueuePose(queue, "a");
		await queue.idle();
		await queue.idle();
		assert.equal(queue.stats().queued, 0);
		await queue.close();
	});
});

test("enqueue DURANTE o close é recusado — `closed` vale a partir da primeira linha", async () => {
	await withDir(async (dir) => {
		const solta = deferred();
		const queue = await openQueue(dir, {
			execute: async () => {
				await solta.promise;
			},
		});
		await enqueuePose(queue, "em-voo");
		await waitFor(() => queue.running().length === 1, "o job entrou em execução");

		// `close({abortRunning})` AGUARDA os executores desenrolarem; o que
		// interessa aqui é que a admissão fecha antes da espera terminar.
		const fechando = queue.close({ abortRunning: true });
		const r = await queue.enqueue({
			key: "heroi::tarde",
			label: "tarde",
			descriptor: pose("tarde"),
		});
		assert.equal(r.accepted, false);
		assert.equal(r.accepted === false && r.reason, "closed");
		solta.resolve();
		await fechando;
		assert.equal(queue.get("heroi::tarde"), undefined, "nem registro fica");
	});
});

// ---------------------------------------------------------------- projeções

test("stats() conta os cinco estados e publica o teto de admissão", async () => {
	await withDir(async (dir) => {
		const base = {
			label: "x",
			enqueuedAt: new Date(0).toISOString(),
			cellKeys: [],
			attempts: 0,
			paid: false,
		};
		const job = (key: string, seq: number, status: string) => ({
			...base,
			key,
			seq,
			status,
			descriptor: { kind: "pose", characterId: "heroi", poseId: key },
		});
		await writeRawState(dir, {
			version: 1,
			nextSeq: 10,
			updatedAt: new Date(0).toISOString(),
			jobs: [
				job("heroi::pronto", 1, "pronto"),
				job("heroi::falhou", 2, "falhou"),
				job("heroi::cancelado", 3, "cancelado"),
				job("heroi::outro-pronto", 4, "pronto"),
			],
		});
		const solta = deferred();
		const queue = await openQueue(dir, {
			concurrency: 1,
			ratePerSecond: 7,
			execute: async () => {
				await solta.promise;
			},
		});
		await enqueuePose(queue, "rodando");
		await enqueuePose(queue, "esperando");
		await waitFor(() => queue.running().length === 1, "um job em execução");

		const s = queue.stats();
		assert.equal(s.running, 1);
		assert.equal(s.queued, 1, "o segundo espera o teto de 1");
		assert.equal(s.done, 2);
		assert.equal(s.failed, 1);
		assert.equal(s.cancelled, 1);
		assert.equal(s.concurrency, 1);
		assert.equal(s.ratePerSecond, 7, "a taxa corrente é observável — ela cai a cada 429");

		solta.resolve();
		await queue.idle();
		await queue.close();
	});
});

test("ENDPOINT_BY_KIND cobre TODO JOB_KINDS — um kind novo sem endpoint não passa", () => {
	// Este teste nasceu quando `weightForDescriptor` indexava
	// `ENDPOINT_BY_KIND[descriptor.kind]` para achar o peso de admissão. Não é
	// mais assim: o peso passou a ser o pico de chamadas simultâneas, num
	// `switch` exaustivo sobre `JobKind` que o compilador já cobre.
	//
	// A tabela continua carregando dinheiro, e por isso o teste continua. Ela é
	// a ÚNICA ponte deste módulo para a `COST_TABLE` do pipeline, e quem a
	// consome hoje é `pesoAntigo` — o lado "antes" da comparação de admissão,
	// que faz `weightFor(ENDPOINT_BY_KIND[d.kind])`. Um kind novo sem entrada
	// aqui passaria `undefined` para `weightFor`, que faz
	// `COST_TABLE[endpoint].concurrencyWeight` e estoura com TypeError dentro do
	// teste de aceitação — longe da causa. Falhar aqui nomeia o kind.
	assert.ok(JOB_KINDS.length >= 7, `JOB_KINDS tem ${JOB_KINDS.length}`);
	assert.equal(
		new Set(JOB_KINDS).size,
		JOB_KINDS.length,
		"nenhum kind repetido",
	);
	for (const kind of JOB_KINDS) {
		const endpoint = ENDPOINT_BY_KIND[kind];
		assert.ok(
			typeof endpoint === "string" && endpoint.length > 0,
			`kind "${kind}" sem endpoint de custo`,
		);
	}
	assert.equal(
		Object.keys(ENDPOINT_BY_KIND).length,
		JOB_KINDS.length,
		"e nenhum endpoint sobrando para um kind que não existe",
	);
});

// ---------------------------------------------------------------- dinheiro: retomada

/**
 * A CORREÇÃO MAIS CARA DESTA ONDA. Antes destes testes a fila devolvia todo job
 * `'gerando'` para `'na-fila'` e o executor rodava DO ZERO — segunda submissão,
 * segunda cobrança, a cada reinício do Vite (que acontece ao salvar qualquer
 * `server/*.ts`). O sinal que a fila usa agora é `attempts > 0`: quem passou por
 * `#start` teve o executor invocado, e a fila NÃO CONSEGUE saber se ele chegou a
 * submeter. Só quem declara recuperação gratuita volta a rodar sozinho.
 */

const blockDescriptor = (hash: string): JobDescriptor => ({
	kind: "world-block",
	hash,
	config: { description: "bloco de teste", technique: "texture" },
});

test("retomada: job interrompido NÃO é re-executado automaticamente", async () => {
	await withDir(async (dir) => {
		// Reinício com job em voo: executor que nunca resolve, `close` sem abort.
		const primeira = await openQueue(dir, {
			execute: () => new Promise<void>(() => {}),
		});
		await enqueuePose(primeira, "a");
		await waitFor(() => primeira.running().length === 1, "o job A entrou");
		await primeira.close();
		assert.equal((await readState(dir)).jobs[0]?.status, "gerando");

		// Segunda subida. O executor conta invocações — cada uma seria uma
		// submissão nova pela mesma pose.
		const invocacoes: string[] = [];
		const segunda = await openQueue(dir, {
			execute: async (ctx) => {
				invocacoes.push(ctx.job.key);
			},
		});
		await segunda.idle();
		await segunda.close();

		assert.deepEqual(
			invocacoes,
			[],
			"o executor de um job interrompido NÃO pode ser chamado de novo: " +
				"a fila não sabe se a submissão anterior saiu, e ressubmeter cobra de novo",
		);
		const job = segunda.get("heroi::a");
		assert.equal(job?.status, "interrompido", "estado terminal NOMEADO, não 'na-fila'");
		assert.equal(job?.resumed, true);
		assert.match(
			String(job?.message),
			/pode ter sido cobrada|já foi cobrada/,
			"a mensagem tem de dizer que a geração pode ter custado, em pt-BR",
		);
		assert.match(String(job?.message), /gerar de novo/i, "e que a decisão é do usuário");
	});
});

test("retomada: job interrompido JÁ PAGO também para, e guarda o remote", async () => {
	await withDir(async (dir) => {
		const primeira = await openQueue(dir, {
			execute: async (ctx) => {
				await ctx.markPaid({ jobIds: ["bg-que-ja-custou"] });
				return new Promise<void>(() => {});
			},
		});
		await enqueuePose(primeira, "a");
		await waitFor(() => primeira.get("heroi::a")?.paid === true, "markPaid");
		await primeira.close();

		let chamou = 0;
		const segunda = await openQueue(dir, {
			execute: async () => {
				chamou += 1;
			},
		});
		await segunda.idle();
		await segunda.close();

		assert.equal(chamou, 0, "job pago jamais é ressubmetido");
		const job = segunda.get("heroi::a");
		assert.equal(job?.status, "interrompido");
		assert.equal(job?.paid, true);
		assert.deepEqual(
			job?.remote?.jobIds,
			["bg-que-ja-custou"],
			"o identificador é o único caminho de volta ao artefato pago",
		);
		assert.deepEqual(
			segunda.paidUnfinished().map((j) => j.key),
			["heroi::a"],
			"e ele continua visível para quem for re-sondar à mão",
		);
	});
});

test("retomada: só quem declara recuperação GRATUITA volta a rodar sozinho", async () => {
	await withDir(async (dir) => {
		const canResumeWithoutSpending = (j: Readonly<QueuedJob>): boolean =>
			j.descriptor.kind === "world-block";

		const primeira = await openQueue(dir, {
			concurrency: 8,
			canResumeWithoutSpending,
			execute: () => new Promise<void>(() => {}),
		});
		await primeira.enqueue({
			key: "world-block::abc",
			label: "bloco",
			descriptor: blockDescriptor("abc"),
			cellKeys: [],
		});
		await enqueuePose(primeira, "a");
		await waitFor(() => primeira.running().length === 2, "os dois entraram");
		await primeira.close();

		const invocacoes: string[] = [];
		const segunda = await openQueue(dir, {
			concurrency: 8,
			canResumeWithoutSpending,
			execute: async (ctx) => {
				invocacoes.push(ctx.job.key);
			},
		});
		await segunda.idle();
		await segunda.close();

		assert.deepEqual(
			invocacoes,
			["world-block::abc"],
			"world-block procura o stub em disco antes de submeter; a pose não",
		);
		assert.equal(segunda.get("world-block::abc")?.status, "pronto");
		assert.equal(segunda.get("world-block::abc")?.resumed, true);
		assert.equal(segunda.get("heroi::a")?.status, "interrompido");
	});
});

test("adulteração: attempts ausente conta como JÁ RODOU, e o job não é reexecutado", async () => {
	await withDir(async (dir) => {
		await writeFile(
			join(dir, "job-queue.json"),
			JSON.stringify({
				version: 1,
				nextSeq: 3,
				updatedAt: new Date(0).toISOString(),
				jobs: [
					{
						key: "heroi::sem-attempts",
						label: "x",
						seq: 1,
						enqueuedAt: new Date(0).toISOString(),
						descriptor: {
							kind: "pose",
							characterId: "heroi",
							poseId: "sem-attempts",
						},
						cellKeys: [],
						status: "na-fila",
						paid: false,
						// `attempts` AUSENTE de propósito: é o campo que decide se o
						// executor já foi invocado, e o arquivo é editável à mão.
					},
				],
			}),
		);
		const ran: string[] = [];
		const queue = await openQueue(dir, {
			execute: async (ctx) => {
				ran.push(ctx.job.key);
			},
		});
		await queue.idle();
		await queue.close();

		assert.deepEqual(ran, [], "na dúvida sobre ter rodado, não se roda de novo");
		const job = queue.get("heroi::sem-attempts");
		assert.equal(job?.attempts, 1, "ausente resolve para 1, não para 0");
		assert.equal(job?.status, "interrompido");
	});
});

test("retomada: job que NUNCA rodou (attempts 0) continua sendo drenado normalmente", async () => {
	await withDir(async (dir) => {
		// Teto 1: `a` toma a vaga e `b` fica em 'na-fila' com attempts 0.
		const primeira = await openQueue(dir, {
			execute: () => new Promise<void>(() => {}),
		});
		await enqueuePose(primeira, "a");
		await enqueuePose(primeira, "b");
		await waitFor(() => primeira.running().length === 1, "só o A entrou");
		await primeira.close();

		const invocacoes: string[] = [];
		const segunda = await openQueue(dir, {
			execute: async (ctx) => {
				invocacoes.push(ctx.job.key);
			},
		});
		await segunda.idle();
		await segunda.close();

		assert.deepEqual(
			invocacoes,
			["heroi::b"],
			"quem nunca saiu daqui roda; quem já rodou uma vez, não",
		);
		assert.equal(segunda.get("heroi::a")?.status, "interrompido");
	});
});

// ---------------------------------------------------------------- dinheiro: retentativa

/**
 * `pixellab-pipeline/src/api.ts` recusa retentar POST 5xx com o motivo escrito:
 * *"the request may have been processed and billed but the response was lost"*.
 * A fila desfazia essa decisão uma camada acima — ela reexecutava o job INTEIRO,
 * o que ressubmete. Estes testes trancam o alinhamento.
 */

test("5xx na SUBMISSÃO não é retentado — o cliente HTTP já recusou retentar POST 5xx", async () => {
	await withDir(async (dir) => {
		let submissoes = 0;
		const queue = await openQueue(dir, {
			maxAttempts: 3,
			execute: async () => {
				submissoes += 1;
				throw Object.assign(new Error("503 em POST /create-character-v3"), {
					status: 503,
				});
			},
		});
		await enqueuePose(queue, "a");
		await queue.idle();
		await queue.close();

		assert.equal(submissoes, 1, "uma submissão recusada, não três");
		const job = queue.get("heroi::a");
		assert.equal(job?.status, "falhou");
		assert.equal(job?.attempts, 1);
	});
});

test("submissão ACEITA + poll 500 NÃO ressubmete — o pior caminho de todos", async () => {
	await withDir(async (dir) => {
		// Reproduz o ramo sem `markPaid` (sprite-lab, wizard, world-block): a
		// submissão é aceita, o dinheiro sai, o poll cai, e o registro em disco
		// continua dizendo `paid: false`.
		let submissoesAceitas = 0;
		const queue = await openQueue(dir, {
			maxAttempts: 3,
			execute: async () => {
				submissoesAceitas += 1; // 200 com background_job_id + usage.usd
				throw Object.assign(new Error("500 em GET /jobs/bg-1"), { status: 500 });
			},
		});
		await enqueuePose(queue, "a");
		await queue.idle();
		await queue.close();

		assert.equal(
			submissoesAceitas,
			1,
			"três submissões aceitas por um clique é o defeito que este teste tranca",
		);
		assert.equal(queue.get("heroi::a")?.status, "falhou");
	});
});

test("408 e 425 também deixam de ser retentáveis", async () => {
	await withDir(async (dir) => {
		for (const status of [408, 425]) {
			let chamadas = 0;
			const queue = await openQueue(dir, {
				maxAttempts: 3,
				execute: async () => {
					chamadas += 1;
					throw Object.assign(new Error(`${status}`), { status });
				},
			});
			await enqueuePose(queue, `s${status}`);
			await queue.idle();
			await queue.close();
			assert.equal(chamadas, 1, `${status} não pode ser retentado pela fila`);
		}
	});
});

test("429 e 529 CONTINUAM retentáveis — recusa explícita, nada processado", async () => {
	await withDir(async (dir) => {
		let chamadas = 0;
		const queue = await openQueue(dir, {
			maxAttempts: 3,
			execute: async () => {
				chamadas += 1;
				if (chamadas === 1) {
					throw Object.assign(new Error("Too many concurrent jobs"), {
						status: 429,
					});
				}
			},
		});
		await enqueuePose(queue, "a");
		await queue.idle();
		await queue.close();
		assert.equal(chamadas, 2, "a chamada RECUSADA não gerou nada: retentar é grátis");
		assert.equal(queue.get("heroi::a")?.status, "pronto");
	});
});

test("um remote guardado veta a retentativa mesmo sem paid", async () => {
	await withDir(async (dir) => {
		let chamadas = 0;
		const queue = await openQueue(dir, {
			maxAttempts: 3,
			// Classificador injetado que insiste em "retry": nem assim a fila pode
			// reexecutar um job que já tem identificador remoto guardado.
			classifyError: () => "retry",
			execute: async (ctx) => {
				chamadas += 1;
				await ctx.markPaid({ jobIds: ["bg-1"] });
				throw new Error("caiu depois de guardar o id");
			},
		});
		await enqueuePose(queue, "a");
		await queue.idle();
		await queue.close();
		assert.equal(chamadas, 1);
		assert.equal(queue.get("heroi::a")?.status, "falhou");
	});
});

// ---------------------------------------------------------------- posição na fila

test("a posição do 202 nunca é 0 — 1 é o próximo a entrar", async () => {
	await withDir(async (dir) => {
		// O laço de admissão ativo pega o job durante o `await #flush()` do
		// `enqueue`; a posição saía de `pending()` DEPOIS disso e vinha -1+1 = 0.
		const posicoes: number[] = [];
		const queue = await openQueue(dir, {
			concurrency: 4,
			execute: async () => {},
		});
		for (let i = 0; i < 12; i += 1) {
			const r = await enqueuePose(queue, `p${i}`);
			assert.ok(r.accepted);
			posicoes.push(r.position);
		}
		await queue.idle();
		await queue.close();
		assert.ok(
			posicoes.every((p) => p >= 1),
			`"position" é documentado como "1 = próximo a entrar"; veio ${posicoes.join(",")}`,
		);
	});
});
