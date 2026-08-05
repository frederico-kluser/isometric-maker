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

import {
	JobQueue,
	cellStatusFor,
	classifyByStatus,
	defaultStatePath,
	resolveConcurrency,
	weightForDescriptor,
	type JobDescriptor,
	type JobQueueOptions,
	type QueuedJob,
	type RemoteHandle,
} from "./job-queue.ts";

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

		assert.deepEqual(
			ran,
			["heroi::a", "heroi::b", "heroi::c"],
			"os três foram redespachados na ordem original de chegada",
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
		await primeira.enqueue({
			key: "sprite-lab::0123456789abcdef",
			label: "sprite-lab · 0123456789abcdef",
			descriptor,
			cellKeys: [],
		});
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

test("job interrompido em 'gerando' volta para 'na-fila' marcado como retomado", async () => {
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
		assert.ok(
			job.status === "na-fila" || job.status === "gerando",
			"voltou a ser drenável",
		);
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
		const linha = logs.find((m) => m.includes("retomando"));
		assert.ok(linha, "a retomada tem de logar");
		// Entre o `submit` do executor e o `await ctx.markPaid` o dinheiro já saiu
		// e o disco ainda diz `paid: false`. Se o processo morre aí, este é
		// exatamente o job que reabre — e a fila NÃO tem como distinguir "nunca
		// submeteu" de "submeteu e morreu antes de anotar". Afirmar o mais barato
		// dos dois é certeza fingida sobre a fatura de alguém.
		assert.doesNotMatch(linha, /nada foi gasto/);
		assert.match(linha, /NÃO FOI VERIFICADO/);
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

test("resolveConcurrency: override direto, tier e default", () => {
	assert.equal(resolveConcurrency({ CHARACTER_BUILDER_JOB_CONCURRENCY: "7" }), 7);
	assert.equal(resolveConcurrency({ PIXELLAB_TIER: "t3" }), 20);
	assert.equal(resolveConcurrency({ PIXELLAB_TIER: "free" }), 1);
	assert.equal(resolveConcurrency({ PIXELLAB_TIER: "t1" }), 2);
	// O default é t2 = 4, e o pedido que originou a fila foi "quero poder rodar
	// mais gerações simultâneas". A evidência do 4 é `server/sprite-lab.ts`, que
	// trava `outputs` em 1–4 porque acima disso a v3 responde 429 — observação
	// desta conta, não medição do tier. As duas variáveis continuam mandando.
	assert.equal(resolveConcurrency({}), 4, "default t2");
	assert.equal(resolveConcurrency({ PIXELLAB_TIER: "t2" }), 4);
	assert.equal(
		resolveConcurrency({ PIXELLAB_TIER: "inventado" }),
		4,
		"tier desconhecido cai no default em vez de virar NaN",
	);
	assert.equal(
		resolveConcurrency({ CHARACTER_BUILDER_JOB_CONCURRENCY: "0" }),
		4,
		"zero não é teto válido",
	);
	assert.equal(
		resolveConcurrency({ CHARACTER_BUILDER_JOB_CONCURRENCY: "abc" }),
		4,
	);
	assert.equal(
		resolveConcurrency({ CHARACTER_BUILDER_JOB_CONCURRENCY: "1", PIXELLAB_TIER: "t3" }),
		1,
		"o override direto ganha do tier, inclusive para diminuir",
	);
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

test("erro transitório retenta até o teto e só então falha", async () => {
	await withDir(async (dir) => {
		let chamadas = 0;
		const queue = await openQueue(dir, {
			maxAttempts: 3,
			execute: async () => {
				chamadas += 1;
				throw Object.assign(new Error("503"), { status: 503 });
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

test("erro transitório que passa na segunda tentativa termina 'pronto'", async () => {
	await withDir(async (dir) => {
		let chamadas = 0;
		const queue = await openQueue(dir, {
			execute: async () => {
				chamadas += 1;
				if (chamadas === 1) throw Object.assign(new Error("502"), { status: 502 });
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
	assert.equal(classifyByStatus(Object.assign(new Error(""), { status: 429 })), "rate-limited");
	assert.equal(classifyByStatus(Object.assign(new Error(""), { status: 529 })), "rate-limited");
	assert.equal(classifyByStatus(Object.assign(new Error(""), { status: 503 })), "retry");
	assert.equal(classifyByStatus(Object.assign(new Error(""), { status: 408 })), "retry");
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
	// A v3 pesa mais que uma imagem solta — a tabela do pipeline é a fonte.
	assert.ok(
		weightForDescriptor({ kind: "wizard-directions8", characterId: "h" }) >
			weightForDescriptor({ kind: "wizard-south", characterId: "h", description: "x" }),
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
