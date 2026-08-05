/**
 * Local API for the character builder, mounted as Vite middleware.
 *
 * Two responsibilities that must not leak into the browser:
 *   1. The PixelLab token. Every call to the API goes through here.
 *   2. Long jobs. Generation takes 2-5 minutes; the browser polls this server,
 *      which owns the job registry and survives a page reload.
 *
 * v3 (2026-07-31): o wizard do manequim migrou para create-character-v3 —
 * a sul vai como reference_image e o modelo rotaciona sozinho; o passo de
 * cardeais foi removido. Estas rotas só fazem a fiação: validam o pedido,
 * escolhem as chaves canônicas de célula e disparam o módulo certo.
 *
 * FILA (onda 3): o registro volátil de jobs virou `server/job-queue.ts` — FIFO
 * persistente, com admissão por peso e retomada depois de um reinício. Este
 * arquivo é a FIAÇÃO: enfileira descritores serializáveis, despacha cada um
 * para o módulo certo (`dispatch`), espelha o status do job nas células do
 * estúdio (`syncJobCells`) e publica a fila em `GET /api/studio`.
 *
 * Política de células (a UI lê o status por elas):
 *   - O espelho job→célula é ÚNICO e mora em `syncJobCells`. Ele NUNCA
 *     sobrescreve célula 'pronto' — é progresso pago — e NUNCA escreve
 *     'pronto': o sucesso vem do MÓDULO, com os frames junto (mannequin.ts
 *     grava a sul e as 8 direções; generatePose/generateWardrobe gravam a sua).
 *   - A idempotência de mannequin.ts lê o status 'pronto' da célula, e
 *     sobrescrevê-lo faria uma geração já paga sair de novo. Por isso a regra
 *     acima é uma invariante de DINHEIRO, não de estética.
 *   - Poses e guarda-roupa pré-marcam 'na-fila' SÓ quando a célula não está
 *     'pronto': a rota responde 200 sem enfileirar numa célula pronta, e
 *     generatePose/generateWardrobe releem a célula no início e retornam sem
 *     chamar a API — 'pronto' é terminal de ponta a ponta, como no wizard.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { PixelLabClient, pollJob } from "../../pixellab-pipeline/src/api.ts";
import {
	JobQueue,
	cellStatusFor,
	defaultStatePath,
	type JobContext,
	type JobDescriptor,
	type QueuedJob,
} from "./job-queue.ts";
import {
	generateSouthFromText,
	editSouth,
	undoSouth,
	generateDirections8,
	type StudioStore,
	type WizardOpts,
} from "./mannequin.ts";
import { exportMannequin, importMannequin } from "./mannequin-io.ts";
import { MOLD_DIR, moldExists, moldPath } from "./mold.ts";
import {
	runRotateLab,
	RotateLabValidationError,
	type RotateLabInput,
} from "./rotate-lab.ts";
import {
	runSpriteLab,
	listSpriteLabRuns,
	readSpriteLabResult,
	spriteLabHash,
	validateSpriteLabConfig,
	SpriteLabValidationError,
	type SpriteLabConfig,
} from "./sprite-lab.ts";
import {
	runWorldBlock,
	readWorldBlockResult,
	listWorldBlocks,
	deleteWorldBlock,
	isWorldBlockHash,
	worldBlockHash,
	validateWorldBlockConfig,
	WorldBlockValidationError,
	type WorldBlockConfig,
} from "./world-block.ts";
import { BLOCK_GEOMETRY, renderMouldPng } from "./cube-mould.ts";
import {
	discardPendingStub,
	pendingStubPath,
	readPendingStub,
	requestFingerprint,
	writePendingStub,
} from "./pending-stub.ts";
import {
	exportWizardBundle,
	importSpriteBundle,
	parseSpriteBundle,
	type WizardBundle,
} from "./sprite-bundle.ts";
import type { MapExportV2 } from "../../../packages/iso-core/src/map-instances.ts";
import {
	DIRECTIONS,
	DETAIL_OPTIONS,
	OUTLINE_OPTIONS,
	TEMPLATE_OPTIONS,
	VIEW_OPTIONS,
	cellKey,
	directions8Key,
	isMoldId,
	MOLD_IDS,
	seedStudio,
	southKey,
	wardrobeKey,
	type Cell,
	type Character,
	type DetailOption,
	type Keypoint,
	type MannequinLock,
	type OutlineOption,
	type Pose,
	type PoseKind,
	type Silhouette,
	type Studio,
	type TemplateAnimation,
	type TemplateOption,
	type ViewOption,
	type WardrobeItem,
} from "./model.ts";

const ROOT = new URL("..", import.meta.url).pathname;
// Test seam: lets server/api.test.ts point the state at a tmpdir. Never set
// in normal use — the default is the tool's own studio.json.
const STUDIO_JSON =
	process.env["CHARACTER_BUILDER_STUDIO_JSON"] ?? join(ROOT, "studio.json");
// Test seam, same idea: points the assets root (wizard PNGs, ledger, frames)
// at a tmpdir so tests never touch the real assets/ directory.
const ASSETS =
	process.env["CHARACTER_BUILDER_ASSETS_DIR"] ?? join(ROOT, "assets");
const LEDGER_PATH = join(ASSETS, "ledger.ndjson");
/** Onde o bundle default do projeto mora (mannequin.json + 12 PNGs). */
const MANNEQUIN_DEFAULT_DIR = join(
	ROOT,
	"../../packages/game-assets/manequim",
);

const SILHOUETTES: readonly Silhouette[] = [
	"humano-medio",
	"humano-corpulento",
	"humano-esguio",
	"quadrupede",
];

// ---------------------------------------------------------------- persistence

let cache: Studio | undefined;
/** Carga em voo compartilhada enquanto o cache está frio (ver load). */
let loadPromise: Promise<Studio> | undefined;
/** Fila de escrita: um writeFile+rename por vez (ver save). */
let writeQueue: Promise<void> = Promise.resolve();

async function loadFromDisk(): Promise<Studio> {
	try {
		cache = JSON.parse(await readFile(STUDIO_JSON, "utf8")) as Studio;
	} catch {
		cache = seedStudio();
		await save(cache);
	}
	return cache;
}

async function load(): Promise<Studio> {
	if (cache) return cache;
	// Concorrência (botões "Gerar todas"): N spawns simultâneos sobre cache
	// frio dividem UMA carga. Sem isto, cada spawn parseava o arquivo por
	// conta e ficava com uma referência DIVERGENTE do Studio — o save do
	// segundo sobrescrevia o do primeiro e células se perdiam. Com a
	// referência única, load→mutate→save acontece sobre o objeto comum.
	loadPromise ??= loadFromDisk().finally(() => {
		loadPromise = undefined;
	});
	return loadPromise;
}

async function writeStudioFile(s: Studio): Promise<void> {
	await mkdir(dirname(STUDIO_JSON), { recursive: true });
	// tmp único por execução: dois saves nunca dividem o mesmo caminho
	// temporário (defesa em profundidade — a fila já serializa).
	const tmp = `${STUDIO_JSON}.${randomBytes(4).toString("hex")}.tmp`;
	await writeFile(tmp, `${JSON.stringify(s, null, 2)}\n`);
	const { rename } = await import("node:fs/promises");
	await rename(tmp, STUDIO_JSON);
}

async function save(s: Studio): Promise<void> {
	cache = s;
	// Fila de escrita: serializa writeFile+rename. Dois saves concorrentes
	// sobre o MESMO tmp podiam intercalar bytes e misturar dois JSONs — e o
	// load seguinte, achando JSON inválido, caía no catch e RESETAVA o
	// estúdio para o seed. A fila executa na ordem de chegada, então o
	// arquivo final é sempre o save mais recente. A fila nunca trava: uma
	// falha é devolvida ao chamador mas a corrente segue com catch.
	const run = writeQueue.then(() => writeStudioFile(s));
	writeQueue = run.catch(() => {});
	return run;
}

/** A implementação de StudioStore que os módulos do wizard/export recebem. */
const store: StudioStore = { load, save };

// ---------------------------------------------------------------- job registry

/**
 * Onde a fila persiste. Mesma costura de teste do `studio.json`: a variável
 * `CHARACTER_BUILDER_JOB_QUEUE_JSON` aponta o estado para um tmpdir e os testes
 * nunca tocam o arquivo real (`defaultStatePath` em `server/job-queue.ts`).
 *
 * Lido no carregamento do módulo, como STUDIO_JSON e ASSETS — quem importa
 * `api.ts` depois de setar o env pega o caminho de teste.
 */
const JOB_QUEUE_JSON = defaultStatePath();

/**
 * A fila é aberta UMA vez, preguiçosamente, e a PROMESSA é guardada.
 *
 * Preguiçosa e não no topo do módulo porque `JobQueue.open` lê disco,
 * reconcilia o que um reinício deixou pela metade e volta a drenar — trabalho
 * que não pode acontecer só por alguém ter importado `api.ts` (o
 * `vite.config.ts` importa este arquivo, e um `npm run typecheck` não pode
 * disparar retomada de job pago). Guardar a promessa em vez do objeto é o que
 * garante UMA fila: dois pedidos concorrentes na primeira requisição dividem a
 * mesma abertura, em vez de abrir duas filas sobre o mesmo arquivo de estado —
 * o mesmo motivo do `loadPromise` do estúdio, algumas linhas acima.
 */
let queuePromise: Promise<JobQueue> | undefined;

/**
 * QUAIS RAMOS SABEM RETOMAR SEM SUBMETER DE NOVO — a resposta é: seis dos sete.
 *
 * `canResumeWithoutSpending` é uma afirmação sobre o MÓDULO GERADOR, não sobre o
 * job: ele grava o identificador remoto assim que a resposta da submissão chega,
 * e PROCURA esse identificador antes de submeter qualquer coisa. É a "outra
 * metade do contrato" que o cabeçalho de `server/job-queue.ts` exige, e ela
 * agora existe em `server/pending-stub.ts` — um stub `<artefato>.pending.json`
 * ao lado do arquivo que ele substitui, o mesmo idioma que `world-block.ts` já
 * usava sozinho.
 *
 * | ramo | grava | lê antes de submeter |
 * |---|---|---|
 * | `world-block` | `*.pending.json` (tile, animação, v3) | `existsSync` do stub |
 * | `sprite-lab` | um stub POR CANDIDATO | o stub do candidato |
 * | `wizard-directions8` | stub com `character_id` + `background_job_id` | o stub |
 * | `wizard-south-edit` | stub com `background_job_id` | o stub |
 * | `pose` | stub com os N `background_job_id` (um por direção) | o stub, e `ctx.job.remote` |
 * | `wardrobe` | stub com `background_job_id` + `character_id` | o stub, e `ctx.job.remote` |
 *
 * `pose` e `wardrobe` leem TAMBÉM `ctx.job.remote` porque `ctx.markPaid` já o
 * escrevia desde a onda anterior: existem registros em disco com o identificador
 * na fila e sem stub nenhum, e uma leitura a mais só pode EVITAR uma submissão.
 *
 * `wizard-south` continua de fora, e isso é decisão, não pendência.
 * `/create-image-bitforge` é síncrono e sua resposta
 * (`CreateImageBitforgeResponse` no spec vendorizado) tem exatamente `usage` e
 * `image` — nenhum identificador, e nenhuma rota GET que reentregue a imagem.
 * Não há o que gravar na submissão, logo não há o que procurar depois. Para ele
 * a fila PARA em `'interrompido'` e devolve a decisão ao usuário, que é o único
 * erro barato disponível.
 *
 * A JANELA QUE ISTO NÃO FECHA, e que vale para os seis: entre a submissão ser
 * aceita e o identificador chegar ao disco o dinheiro já saiu e nada foi
 * anotado. É irredutível — o id só existe depois da resposta — e é a mesma
 * janela que `world-block` sempre teve. Dizer `true` aqui é aceitar essa janela,
 * não negá-la.
 */
function canResumeWithoutSpending(job: Readonly<QueuedJob>): boolean {
	switch (job.descriptor.kind) {
		case "world-block":
		case "sprite-lab":
		case "wizard-directions8":
		case "wizard-south-edit":
		case "pose":
		case "wardrobe":
			return true;
		case "wizard-south":
			return false;
	}
}

function jobQueue(): Promise<JobQueue> {
	if (queuePromise !== undefined) return queuePromise;
	const opening = JobQueue.open({
		statePath: JOB_QUEUE_JSON,
		execute: dispatch,
		stillNeeded,
		canResumeWithoutSpending,
		onChange: syncJobCells,
		// `server/api.test.ts` desvia `console.log` para stderr porque log de job
		// em segundo plano corrompe o protocolo do `node --test`. Resolver
		// `console.log` na hora da chamada (e não capturar a referência) é o que
		// faz o desvio valer também para a fila.
		onLog: (m) => console.log(m),
	}).catch((err: unknown) => {
		// A REJEIÇÃO NÃO PODE SER GUARDADA PARA SEMPRE, e antes era: com `??=` a
		// promessa rejeitada ficava no cache e TODA requisição seguinte devolvia
		// 500 com a mesma mensagem, inclusive depois de o disco voltar ao normal
		// (medido com o diretório em modo 555). Como `GET /api/studio` é o poll de
		// 3 s da tela, um soluço de disco derrubava a UI até alguém reiniciar o
		// Vite. `loadFromDisk` do estúdio faz o oposto — cai para o seed — e é
		// esse o comportamento certo para infraestrutura do editor.
		//
		// Limpar o cache aqui deixa a PRÓXIMA requisição tentar abrir de novo. A
		// requisição que tomou o erro ainda recebe o erro: `throw` mantém a
		// promessa rejeitada para quem já a estava aguardando.
		if (queuePromise === opening) queuePromise = undefined;
		console.log(
			`[fila] não consegui abrir a fila de jobs: ${
				err instanceof Error ? err.message : String(err)
			} — a próxima requisição tenta de novo`,
		);
		throw err;
	});
	queuePromise = opening;
	return opening;
}

/**
 * Fecha a fila e esquece a promessa. EXISTE PARA OS TESTES, e o nome diz isso.
 *
 * O defeito que ela fecha: `server/api.test.ts`, `api-queue.test.ts` e
 * `api-sprite-lab.test.ts` apagam o tmpdir no `after()`, e a fila é um objeto de
 * segundo plano que continua escrevendo `job-queue.json` depois do último
 * `assert`. O `rmSync` corria com o `rename` da fila e o `after` estourava
 * `ENOTEMPTY` — medido em 1 de 40 execuções com os três arquivos em paralelo, e
 * 0 de 40 antes da fila existir. Nenhum teste tinha como fechar a fila: `api.ts`
 * só exportava `handle`, e o objeto vive numa variável de módulo.
 *
 * `abortRunning: true` porque `close` sem ele não espera executor nenhum — e é
 * justamente o executor em voo que ainda vai escrever. Com ele, `close` aguarda
 * as tarefas desenrolarem e a corrente de escrita drenar antes de resolver.
 */
export async function closeQueueForTests(): Promise<void> {
	const pendente = queuePromise;
	queuePromise = undefined;
	if (pendente !== undefined) {
		const q = await pendente.catch(() => undefined);
		await q?.close({ abortRunning: true });
	}
	// A fila não é a única coisa que escreve depois do último assert: o espelho
	// job → célula (`syncJobCells`) é uma corrente própria, e ela grava o
	// `studio.json` no MESMO tmpdir. Fechar a fila sem drenar esta corrente
	// deixaria a última transição escrevendo durante o `rmSync`.
	// Duas voltas: a última transição da fila pode ter ENFILEIRADO um elo novo
	// enquanto o anterior era aguardado.
	await cellWriteChain;
	await cellWriteChain;
	await writeQueue;
}

/**
 * Espelho job → célula do estúdio. É o ÚNICO ponto que escreve célula a partir
 * do status de um job, e é aqui que `'na-fila'` — que existe em `model.ts` e
 * que a UI já renderiza em quatro lugares — finalmente ganha quem o escreva.
 *
 * TRÊS REGRAS, e as três são sobre dinheiro:
 *
 *   1. **Célula `'pronto'` nunca é sobrescrita.** Ela é progresso PAGO, e a
 *      idempotência de `mannequin.ts`, `generatePose` e `generateWardrobe` lê
 *      exatamente esse status para NÃO chamar a API de novo. Rebaixá-la a
 *      `'gerando'` rearmaria uma geração já cobrada.
 *   2. **Job `'pronto'` não escreve célula.** O sucesso é do MÓDULO, que grava
 *      a célula com os `frames` dentro. Escrever `{status:'pronto'}` daqui
 *      apagaria os frames que acabaram de chegar.
 *   3. **`'cancelado'` só apaga a célula quando NADA foi cobrado.** Cancelar
 *      depois da submissão não devolve dinheiro (ADR 0023): o `remote` fica no
 *      registro do job e a célula vira `'falhou'` com a mensagem da fila, que é
 *      onde a UI oferece "gerar de novo" — e `enqueue` HERDA `paid`/`remote`
 *      nesse caminho, então a retomada re-sonda em vez de ressubmeter. Apagar a
 *      célula ali esconderia a única trilha do que já saiu da conta.
 *
 * Síncrono por fora (o `onChange` da fila é síncrono e isola exceções) e
 * SERIALIZADO por dentro: duas transições em rajada gravariam o `studio.json`
 * fora de ordem, e a segunda a terminar venceria — 'gerando' sobrescrevendo
 * 'na-fila' é inofensivo, o contrário não.
 */
let cellWriteChain: Promise<void> = Promise.resolve();

function syncJobCells(job: Readonly<QueuedJob>): void {
	if (job.cellKeys.length === 0) return;
	const status = cellStatusFor(job.status);
	// Retrato dos campos AGORA: a corrente resolve depois, e o registro do job é
	// mutável — ler `job.status` lá dentro leria o status de outra transição.
	const keys = [...job.cellKeys];
	const message = job.message;
	const paid = job.paid;
	const run = cellWriteChain.then(async () => {
		const s = await load();
		const now = new Date().toISOString();
		let touched = false;
		for (const ck of keys) {
			const cur = s.cells[ck];
			if (cur?.status === "pronto") continue; // regra 1
			if (status === "pronto") continue; // regra 2
			if (status === "vazio" && !paid) {
				// regra 3, metade grátis: o job saiu da fila sem nunca ter rodado.
				if (cur !== undefined) {
					delete s.cells[ck];
					touched = true;
				}
				continue;
			}
			// regra 3, metade paga: cancelado DEPOIS da submissão vira 'falhou'
			// com a mensagem da fila, que já explica que a retomada é gratuita.
			const alvo = status === "vazio" ? "falhou" : status;
			const erro =
				alvo === "falhou"
					? (message ??
						"o job foi cancelado depois da submissão — a geração já foi cobrada")
					: undefined;
			if (cur?.status === alvo && cur.error === erro) continue;
			const next: Cell = { ...cur, key: ck, status: alvo, updatedAt: now };
			if (erro !== undefined) next.error = erro;
			else delete next.error;
			s.cells[ck] = next;
			touched = true;
		}
		if (touched) await save(s);
	});
	cellWriteChain = run.catch((err: unknown) => {
		console.log(
			`[fila] não consegui espelhar as células de "${job.key}": ` +
				`${err instanceof Error ? err.message : String(err)}`,
		);
	});
}

/**
 * Recheque de idempotência AVALIADO NA DRENAGEM (`JobQueueOptions.stillNeeded`):
 * um job parado na fila pode ter virado redundante enquanto esperava. Devolver
 * `false` conclui o job sem chamar o executor e sem gastar.
 *
 * Cada ramo espelha a condição TERMINAL do módulo que ele dispensaria — não uma
 * regra inventada aqui:
 *
 *   - `sprite-lab`/`world-block`: manifesto em disco é o resultado inteiro; é o
 *     mesmo cache-hit que as rotas POST já respondem com 200.
 *   - `wizard-directions8`, `pose`, `wardrobe`: célula `'pronto'` faz o módulo
 *     retornar antes de qualquer chamada.
 *   - `wizard-south` e `wizard-south-edit` devolvem `true` SEMPRE, e isso é
 *     decisão, não esquecimento: a idempotência da sul é por PROMPT, não por
 *     célula (`generateSouthFromText` compara a descrição efetiva da versão
 *     ativa), e `editSouth` EXIGE célula `'pronto'` para ter o que editar.
 *     Rechecar por célula aqui descartaria calado exatamente os dois pedidos que
 *     o usuário mais repete — regerar a sul com outro texto, e editá-la. Quando
 *     o pedido de fato é redundante, o módulo sai sem chamar a API: o recheque
 *     economizaria o despacho, nunca dinheiro.
 */
async function stillNeeded(job: Readonly<QueuedJob>): Promise<boolean> {
	const d = job.descriptor;
	switch (d.kind) {
		case "sprite-lab":
			return (await readSpriteLabResult(d.hash, ASSETS)) === null;
		case "world-block":
			return (await readWorldBlockResult(d.hash, ASSETS)) === null;
		case "wizard-south":
		case "wizard-south-edit":
			return true;
		case "wizard-directions8":
		case "pose":
		case "wardrobe": {
			const s = await load();
			if (job.cellKeys.length === 0) return true;
			return !job.cellKeys.every((ck) => s.cells[ck]?.status === "pronto");
		}
	}
}

/**
 * O despachante: descritor serializável → o módulo que faz o trabalho. É ele
 * que substitui os sete closures do antigo `spawn`, e a diferença é o motivo do
 * módulo existir: um closure morre com o processo, um descritor sobrevive em
 * disco e pode ser redespachado depois de um reinício.
 *
 * OS RAMOS QUE SÓ GUARDAM IDS RELEEM O ESTÚDIO AQUI. Entre o enfileiramento e a
 * execução o `studio.json` pode ter mudado — o personagem foi apagado, a pose
 * removida, o lock desfeito. Isso é FALHA NOMEADA, em pt-BR, e não um `TypeError`
 * de campo indefinido: a fila registra a mensagem, o job vira 'falhou' e a
 * célula recebe o texto.
 */
async function dispatch(ctx: JobContext): Promise<void> {
	const d = ctx.job.descriptor;
	switch (d.kind) {
		case "wizard-south": {
			const s = await load();
			const ch = requireCharacterFor(s, d.characterId);
			// A referência de cor é reavaliada AGORA, não no enfileiramento: o
			// descritor só guarda a que o cliente mandou explicitamente, e a sul do
			// manequim pode ter mudado enquanto o job esperava.
			const reference =
				d.colorImageB64 !== undefined && d.colorImageB64.length > 0
					? d.colorImageB64
					: ch.id === "manequim"
						? undefined
						: await mannequinSouthB64(s);
			await generateSouthFromText(
				client(),
				store,
				ch.id,
				d.description,
				wizardOpts(ctx, reference),
			);
			return;
		}
		case "wizard-south-edit": {
			const s = await load();
			const ch = requireCharacterFor(s, d.characterId);
			await editSouth(client(), store, ch.id, d.prompt, wizardOpts(ctx));
			return;
		}
		case "wizard-directions8": {
			const s = await load();
			const ch = requireCharacterFor(s, d.characterId);
			await generateDirections8(client(), store, ch.id, wizardOpts(ctx));
			return;
		}
		case "sprite-lab": {
			await runSpriteLab(client(), d.config, {
				assetsDir: ASSETS,
				ledgerPath: LEDGER_PATH,
				onLog: (m) => console.log(m),
				onPaid: ctx.markPaid,
			});
			return;
		}
		case "world-block": {
			await runWorldBlock(client(), d.config, {
				assetsDir: ASSETS,
				ledgerPath: LEDGER_PATH,
				onLog: (m) => console.log(m),
			});
			return;
		}
		case "wardrobe": {
			const s = await load();
			const ch = requireCharacterFor(s, d.characterId);
			const item = s.wardrobe.find((w) => w.id === d.wardrobeId);
			if (!item) {
				throw new Error(
					`a peça "${d.wardrobeId}" foi removida do guarda-roupa enquanto o ` +
						"pedido esperava na fila — nada foi gerado e nada foi cobrado",
				);
			}
			await generateWardrobe(ch, item, ctx);
			return;
		}
		case "pose": {
			const s = await load();
			const ch = requireCharacterFor(s, d.characterId);
			const pose = s.poses.find((p) => p.id === d.poseId);
			if (!pose) {
				throw new Error(
					`a pose "${d.poseId}" foi removida enquanto o pedido esperava na ` +
						"fila — nada foi gerado e nada foi cobrado",
				);
			}
			const lock = s.lock;
			if (!lock) {
				throw new Error(
					"a configuração do manequim foi destravada enquanto o pedido " +
						"esperava na fila — o frameCount da pose vem do lock",
				);
			}
			await generatePose(ch, pose, lock, ctx);
			return;
		}
	}
}

/** O personagem do descritor, ou uma falha nomeada — ele pode ter sumido. */
function requireCharacterFor(s: Studio, characterId: string): Character {
	const ch = s.characters.find((c) => c.id === characterId);
	if (!ch) {
		throw new Error(
			`o personagem "${characterId}" foi apagado enquanto o pedido esperava ` +
				"na fila — nada foi gerado e nada foi cobrado",
		);
	}
	return ch;
}

/**
 * Enfileira e responde. Substitui os sete `spawn(...)`: 202 com a POSIÇÃO na
 * fila, que é o que a tela precisa para dizer "3º de 5".
 *
 * Recusa por duplicata NÃO é erro, exatamente como o `spawn` de hoje, que
 * avisava no log e devolvia 202 assim mesmo: o pedido já está na fila ou
 * rodando, e o cliente que clicou duas vezes recebe a mesma chave. Repare que a
 * dedução de duplicata é da FILA, e ela testa contra o conjunto TERMINAL — um
 * job `'na-fila'` conta como duplicata, que é justamente o buraco que o `Map`
 * anterior tinha (ele só reconhecia `'gerando'`, e um segundo POST sobre um job
 * enfileirado submetia de novo, pago).
 */
async function enqueueAndRespond(
	res: ServerResponse,
	input: {
		readonly key: string;
		readonly label: string;
		readonly descriptor: JobDescriptor;
		readonly cellKeys?: readonly string[];
	},
	extra: Record<string, unknown> = {},
): Promise<void> {
	const q = await jobQueue();
	const outcome = await q.enqueue(input);
	if (outcome.accepted) {
		json(res, 202, { key: input.key, position: outcome.position, ...extra });
		return;
	}
	if (outcome.reason === "closed") {
		json(res, 503, {
			error:
				"a fila de geração está sendo encerrada — nada foi enfileirado e nada foi cobrado",
			key: input.key,
			...extra,
		});
		return;
	}
	const posicao = q.pending().findIndex((j) => j.key === input.key) + 1;
	json(res, 202, {
		key: input.key,
		duplicate: true,
		...(posicao > 0 ? { position: posicao } : {}),
		...(outcome.job !== undefined ? { status: outcome.job.status } : {}),
		...extra,
	});
}

/**
 * Hashes de bloco apagados NESTE processo. Existe por uma lacuna conhecida:
 * `JobQueue` não expõe como esquecer um registro terminal, e sem isso um
 * `GET /api/world-block/{hash}` depois do DELETE responderia 'falhou' sobre um
 * hash que não está em lugar nenhum — o registro é persistente agora, o `Map`
 * volátil de antes se resolvia sozinho no reinício. Este conjunto reproduz
 * exatamente o comportamento antigo (`jobs.delete`), inclusive na duração: ele
 * também morre com o processo. Ver o handoff — o conserto de verdade é um
 * `JobQueue.forget(key)`, e a fila está fora do escopo desta onda.
 */
const forgottenWorldBlocks = new Set<string>();

function client(): PixelLabClient {
	const secret = process.env["PIXELLAB_SECRET"];
	if (!secret) {
		throw new Error(
			"PIXELLAB_SECRET não está definido. Exporte o token antes de subir o estúdio — " +
				"ele fica só no servidor e nunca chega ao navegador.",
		);
	}
	return new PixelLabClient(secret);
}

/** Pulls every PNG out of a response, whatever shape it arrived in. */
function extractImages(payload: unknown): string[] {
	const out: string[] = [];
	const walk = (n: unknown): void => {
		if (typeof n === "string") {
			if (n.startsWith("data:image/"))
				out.push(n.replace(/^data:image\/\w+;base64,/, ""));
			else if (/^iVBORw0KGgo/.test(n) && n.length > 256) out.push(n);
			return;
		}
		if (Array.isArray(n)) {
			n.forEach(walk);
			return;
		}
		if (n && typeof n === "object") {
			for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
				if (k === "usage") continue;
				walk(v);
			}
		}
	};
	walk(payload);
	return out;
}

/** Chave de célula → nome de diretório. Uma definição só, usada nos dois lados. */
function safeKey(key: string): string {
	return key.replace(/[^a-z0-9-]+/gi, "_");
}

/**
 * Caminho de volta ao artefato PAGO de uma pose ou peça (ADR 0023, regra 1).
 * Ver `server/pending-stub.ts` para o mecanismo.
 *
 * A impressão do PEDIDO entra no nome porque a chave de célula é estável
 * (`manequim::atacando`) e o request não é: trocar o `templateId` da pose ou o
 * `editDescription` da peça produz outra arte pelo mesmo caminho. Sem a
 * impressão, a retomada devolveria de graça a arte de um pedido que o usuário
 * já trocou; com ela, um pedido diferente simplesmente não acha stub.
 */
function framesStubPath(scope: string, key: string, fingerprint: string): string {
	return pendingStubPath(join(ASSETS, scope, `${safeKey(key)}-${fingerprint}`));
}

async function writeFrames(
	scope: string,
	key: string,
	images: string[],
): Promise<Record<string, string[]>> {
	const safe = safeKey(key);
	const dir = join(ASSETS, scope, safe);
	await mkdir(dir, { recursive: true });

	const frames: Record<string, string[]> = {};
	// The 8-rotation endpoints return frames in canonical direction order. When a
	// pose has several frames per direction they arrive grouped the same way, so
	// slicing by direction index is the correct read of the payload.
	const perDir = Math.max(1, Math.floor(images.length / DIRECTIONS.length));
	for (const [di, dir8] of DIRECTIONS.entries()) {
		const list: string[] = [];
		for (let f = 0; f < perDir; f += 1) {
			const idx = di * perDir + f;
			const b64 = images[idx];
			if (!b64) continue;
			const name = `${dir8}-${String(f).padStart(2, "0")}.png`;
			await writeFile(join(dir, name), Buffer.from(b64, "base64"));
			list.push(`/assets/${scope}/${safe}/${name}`);
		}
		if (list.length > 0) frames[dir8] = list;
	}
	return frames;
}

// ---------------------------------------------------------------- wizard plumbing

/**
 * Opções comuns dos módulos do wizard: assets, ledger e log no stdout do
 * servidor. `referenceB64` é o PNG da sul do manequim — presente só para
 * personagens derivados (ver mannequinSouthB64); vai como color_image nos
 * endpoints que o aceitam, prendendo a paleta do derivado à do manequim.
 */
function wizardOpts(
	ctx?: JobContext,
	referenceB64?: string,
): WizardOpts {
	return {
		assetsDir: ASSETS,
		ledgerPath: LEDGER_PATH,
		onLog: (m) => console.log(m),
		// `onPaid` é `ctx.markPaid`: o módulo declara a submissão e a fila para de
		// retentar. Ausente fora da fila (a rota do undo, que não chama a API) —
		// e ali a ausência é correta, não esquecimento.
		...(ctx !== undefined ? { onPaid: ctx.markPaid } : {}),
		...(referenceB64 !== undefined
			? { reference: { colorImageB64: referenceB64 } }
			: {}),
	};
}

/**
 * PNG da sul ativa do manequim, lido do disco a partir da célula — funciona
 * tanto para o manequim gerado no wizard (/assets/wizard/manequim/…) quanto
 * para o importado do bundle default (/assets/manequim/south.png).
 *
 * Ausência NÃO é erro: devolve undefined e avisa no log. Um derivado gerado
 * sem referência só perde a paleta travada; bloquear a geração por um arquivo
 * recuperável seria pior.
 */
async function mannequinSouthB64(s: Studio): Promise<string | undefined> {
	const cell = s.cells[southKey("manequim")];
	if (cell?.status !== "pronto") return undefined;
	const pub = cell.frames?.["south"]?.[0];
	if (pub === undefined) return undefined;
	const fsPath = join(ASSETS, pub.replace(/^\/+/, "").replace(/^assets\//, ""));
	try {
		return (await readFile(fsPath)).toString("base64");
	} catch {
		console.log(
			`[wizard] sul do manequim não encontrada no disco (${fsPath}) — ` +
				"o derivado segue sem color_image.",
		);
		return undefined;
	}
}

// ---------------------------------------------------------------- generation

/**
 * Uma pose, animada sobre um personagem que concluiu o wizard (remoteId
 * presente). frame_count vem do lock — nunca do cliente nem da pose.
 *
 * Célula 'pronto' é terminal: retorna sem chamar a API. A UI trata 'pronto'
 * como final, mas o servidor é a trava de verdade — um clique duplo não pode
 * cobrar de novo (mesma leitura idempotente que mannequin.ts faz).
 *
 * `ctx` é o contexto da fila, e ele fecha as duas pontas que o `spawn` deixava
 * abertas: o `signal` chega ao `submit` e a cada `pollJob`, então cancelar
 * interrompe a chamada HTTP em voo em vez de só relabelar o registro; e
 * `markPaid` grava `paid: true` mais os `background_job_id` ANTES do primeiro
 * poll, que é a janela em que o dinheiro já saiu e o disco ainda não sabe
 * (ADR 0023).
 */
async function generatePose(
	character: Character,
	pose: Pose,
	lock: MannequinLock,
	ctx: JobContext,
): Promise<void> {
	const key = cellKey(character.id, pose.id);
	const s = await load();
	if (s.cells[key]?.status === "pronto") return;
	if (!character.remoteId) {
		throw new Error(
			"conclua o wizard do personagem primeiro — a pose se apoia no " +
				"personagem remoto criado nas 8 direções",
		);
	}
	const c = client();

	const body: Record<string, unknown> = {
		character_id: character.remoteId,
		animation_name: pose.id,
		seed: character.seed,
		// Without this the API animates only the south direction in custom mode.
		directions: [...DIRECTIONS],
	};

	if (pose.kind === "template") {
		// 1 generation per direction — by far the cheapest path.
		body["mode"] = "template";
		body["template_animation_id"] = pose.templateId;
	} else if (pose.kind === "action") {
		// Free text. Costs ~1 gen/direction up to 96px and scales with size above.
		body["mode"] = "v3";
		body["action_description"] = pose.action;
		body["frame_count"] = lock.frameCount;
	} else {
		throw new Error(
			"pose de esqueleto é gerada pelo endpoint animate-with-skeleton, não por aqui",
		);
	}

	const stubPath = framesStubPath("poses", key, requestFingerprint(body));

	/**
	 * RETOMADA GRATUITA (ADR 0023): a animação já foi submetida e COBRADA, e o
	 * poll caiu depois — ou o Vite reiniciou no meio, o que acontece toda vez que
	 * alguém salva um `server/*.ts`. Re-sondar N `background_job_id` custa zero;
	 * ressubmeter custa a animação inteira, uma geração POR DIREÇÃO.
	 *
	 * DUAS FONTES, e as duas só podem EVITAR uma submissão:
	 *   1. o stub em disco, escrito por este módulo logo depois do submit;
	 *   2. `ctx.job.remote`, escrito por `ctx.markPaid` — que já existia antes
	 *      desta onda, então há registros em disco com ele e sem stub.
	 */
	const retomada = await readPendingStub(stubPath);
	let ids = [...(retomada?.jobIds ?? ctx.job.remote?.jobIds ?? [])];

	if (ids.length > 0) {
		ctx.log(
			`[fila] retomando animação já paga de "${key}" (${ids.length} job(s): ` +
				`${ids.join(", ")}) — nenhuma submissão nova.`,
		);
	} else {
		const res = await c.submit<Record<string, unknown>>(
			"animate-character",
			body,
			{ signal: ctx.signal },
		);
		// Animation queues one job PER DIRECTION and returns a list of ids.
		ids = collectJobIds(res.data);
		// markPaid ANTES do cheque dos ids, e AGUARDADO: uma submissão aceita já foi
		// cobrada mesmo quando a resposta vem sem id nenhum. Anotar só no caminho
		// feliz deixaria o caso patológico marcado como grátis, e a fila retentaria
		// — segunda cobrança pela mesma animação.
		await ctx.markPaid(
			ids.length > 0
				? { jobIds: ids }
				: { note: "submit aceito sem background_job_id na resposta" },
		);
		// E o mesmo caminho de volta em disco, que sobrevive à fila: um registro
		// terminal pode ser podado, e o stub fica ao lado do artefato que falta.
		if (ids.length > 0) {
			await writePendingStub(stubPath, {
				jobIds: ids,
				note: `animate-character de ${key} (${String(body["mode"])})`,
			});
		}
		if (ids.length === 0) throw new Error("a API não devolveu nenhum job id");
	}

	// Poll das direções EM PARALELO: eram sequenciais, e cada direção leva
	// minutos — a espera total era a soma dos tempos, agora é o máximo.
	const polledAll = await Promise.all(
		ids.map((id) => pollJob(c, id, { timeoutMs: 900_000, signal: ctx.signal })),
	);
	const images: string[] = [];
	for (const polled of polledAll) {
		if (!polled.ok) continue;
		images.push(...extractImages(polled.job.last_response ?? polled.job));
	}
	if (images.length === 0) throw new Error("nenhuma direção retornou imagem");

	const frames = await writeFrames("poses", key, images);
	const cur = await load();
	cur.cells[key] = {
		key,
		status: "pronto",
		frames,
		updatedAt: new Date().toISOString(),
	};
	await save(cur);
	// O artefato chegou e a célula está 'pronto' — daqui para frente a
	// idempotência é a célula. Descartar antes disso jogaria fora a retomada.
	await discardPendingStub(stubPath);
}

/**
 * Equipment, as a character state derived from a finished body.
 *
 * Mesmo contrato de `ctx` que `generatePose`: signal repassado ao `submit` e ao
 * `pollJob`, `markPaid` aguardado logo depois da submissão.
 */
async function generateWardrobe(
	character: Character,
	item: WardrobeItem,
	ctx: JobContext,
): Promise<void> {
	const key = wardrobeKey(character.id, item.id);
	// Idempotency lock, same as generatePose: 'pronto' is terminal, return
	// without calling the API — a double-click must not be charged twice.
	const s = await load();
	if (s.cells[key]?.status === "pronto") return;
	if (!character.remoteId) {
		throw new Error(
			"conclua o wizard do personagem primeiro — a peça se apoia no " +
				"personagem remoto criado nas 8 direções",
		);
	}
	// Refuse before spending: a garment authored for one silhouette will not fit
	// another, and the API will happily charge for the attempt.
	if (item.silhouette !== character.silhouette) {
		throw new Error(
			`"${item.label}" foi feita para a silhueta ${item.silhouette}, e ${character.label} ` +
				`é ${character.silhouette}. Peça só vale dentro da mesma silhueta — gere uma variante.`,
		);
	}
	const c = client();

	const body = {
		character_id: character.remoteId,
		edit_description: item.editDescription,
		seed: item.seed,
		no_background: true,
		// Snapping to the source palette is what stops each piece drifting in colour.
		use_color_palette_from_reference: item.keepPalette,
	};
	const stubPath = framesStubPath("wardrobe", key, requestFingerprint(body));

	/**
	 * RETOMADA GRATUITA (ADR 0023), mesmas duas fontes de `generatePose`: o stub
	 * em disco e o `ctx.job.remote` que `ctx.markPaid` já gravava. O
	 * `create-character-state` devolve `background_job_id` E `character_id` (os
	 * dois obrigatórios no spec vendorizado), e é o job que carrega os pixels.
	 */
	const retomada = await readPendingStub(stubPath);
	let jobId = retomada?.jobIds?.[0] ?? ctx.job.remote?.jobIds?.[0];
	let stateId = retomada?.characterId ?? ctx.job.remote?.characterId;

	if (jobId !== undefined) {
		ctx.log(
			`[fila] retomando peça já paga de "${key}" (job ${jobId}) — ` +
				"nenhuma submissão nova.",
		);
	} else {
		const res = await c.submit<{
			background_job_id?: string;
			character_id?: string;
		}>("create-character-state", body, { signal: ctx.signal });
		jobId = res.data?.background_job_id;
		stateId = res.data?.character_id;
		// Idem generatePose: o dinheiro saiu na submissão aceita, e o `character_id`
		// devolvido é o caminho de volta ao estado já cobrado mesmo sem job id.
		await ctx.markPaid({
			...(jobId !== undefined ? { jobIds: [jobId] } : {}),
			...(stateId !== undefined ? { characterId: stateId } : {}),
			...(jobId === undefined
				? { note: "submit aceito sem background_job_id na resposta" }
				: {}),
		});
		if (jobId !== undefined) {
			await writePendingStub(stubPath, {
				jobIds: [jobId],
				...(stateId !== undefined ? { characterId: stateId } : {}),
				note: `create-character-state de ${key}`,
			});
		}
		if (!jobId) throw new Error("a API não devolveu background_job_id");
	}

	const polled = await pollJob(c, jobId, {
		timeoutMs: 900_000,
		signal: ctx.signal,
	});
	if (!polled.ok)
		throw new Error(
			polled.reason === "timeout"
				? "tempo esgotado"
				: (polled.detail ?? "falhou"),
		);

	const images = extractImages(polled.job.last_response ?? polled.job);
	if (images.length === 0) throw new Error("resposta sem imagem");

	const frames = await writeFrames("wardrobe", key, images);
	const cur = await load();
	const groupId = (
		polled.job.last_response as { group_id?: string } | undefined
	)?.group_id;
	cur.cells[key] = {
		key,
		status: "pronto",
		frames,
		updatedAt: new Date().toISOString(),
		...(stateId ? { remoteId: stateId } : {}),
		...(groupId ? { groupId } : {}),
	};
	await save(cur);
	// Só depois de a célula estar 'pronto': ela é a idempotência daqui em diante.
	await discardPendingStub(stubPath);
}

/**
 * Os `background_job_id` de uma resposta, venham no singular ou no PLURAL.
 *
 * O plural não é defesa preventiva: é a forma que o spec vendorizado declara
 * para o endpoint que esta função existe para ler.
 * `CreateCharacterAnimationResponse` (`/animate-character`) tem
 * `background_job_ids` — array, **obrigatório**, "List of background job IDs
 * (one per direction)" — e nenhum campo singular.
 *
 * A versão anterior testava `/job_id$/i` e descia para `walk(v)` no resto. Como
 * `background_job_ids` termina em `ids`, a chave não casava; e `walk`, ao
 * receber o array, visitava strings, que ele ignora. Resultado: **zero ids** na
 * resposta real. `generatePose` marcava a submissão como paga (certo — o
 * dinheiro saiu) e morria em seguida com "a API não devolveu nenhum job id",
 * sem nada anotado para voltar. Era o cenário da ADR 0023 outra vez: cobrado,
 * irrecuperável. Nenhum teste pegava porque nenhum fixture do repositório
 * modelava a resposta de `/animate-character` — o mesmo defeito de suíte que a
 * própria ADR 0023 registrou.
 */
function collectJobIds(payload: unknown): string[] {
	const ids: string[] = [];
	const walk = (n: unknown): void => {
		if (Array.isArray(n)) {
			n.forEach(walk);
			return;
		}
		if (n && typeof n === "object") {
			for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
				if (!/job_ids?$/i.test(k)) {
					walk(v);
					continue;
				}
				if (typeof v === "string") ids.push(v);
				else if (Array.isArray(v)) {
					for (const item of v) if (typeof item === "string") ids.push(item);
				} else walk(v);
			}
		}
	};
	walk(payload);
	return [...new Set(ids)];
}

// ---------------------------------------------------------------- pacote de projeto (ADR 0033)

/**
 * Pacote de projeto autocontido (ADR 0033): mapa + personagem + blocos num
 * JSON só, com os PNGs embutidos em base64 — portável entre máquinas, sem a
 * pasta de assets.
 */
interface ProjectBundleV1 {
	readonly version: 1;
	readonly name: string;
	readonly map: MapExportV2;
	/** null quando nenhum personagem fechou o wizard na origem. */
	readonly character: WizardBundle | null;
	/** hash do bloco → base64 do primeiro frame (norte no v2, base no v3). */
	readonly blocks: Record<string, string>;
	readonly createdAt: string;
}

function invalidBundle(reason: string): never {
	throw new Error(`pacote de projeto inválido: ${reason}`);
}

function projectMapOf(raw: unknown): MapExportV2 {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		invalidBundle('campo "map" precisa ser um objeto');
	}
	const rec = raw as Record<string, unknown>;
	if (rec["schemaVersion"] !== 2 || !Array.isArray(rec["palette"])) {
		invalidBundle(
			'campo "map" precisa ser uma exportação v2 (schemaVersion 2 com palette)',
		);
	}
	return rec as unknown as MapExportV2;
}

/** Assinatura PNG (89 50 4E 47) — rejeita texto/JSON disfarçado de imagem. */
function isPngBase64(b64: string): boolean {
	const buf = Buffer.from(b64, "base64");
	return (
		buf.length >= 4 &&
		buf[0] === 0x89 &&
		buf[1] === 0x50 &&
		buf[2] === 0x4e &&
		buf[3] === 0x47
	);
}

/**
 * Valida um pacote desconhecido e o devolve tipado. Estrutura, PNGs do
 * personagem (via parseSpriteBundle) e chaves de bloco são validados AQUI —
 * depois do parse, o pacote é confiável e nenhuma escrita sai pela metade.
 */
function parseProjectBundle(raw: unknown): ProjectBundleV1 {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		invalidBundle("o pacote precisa ser um objeto");
	}
	const obj = raw as Record<string, unknown>;
	if (obj["version"] !== 1) {
		invalidBundle(
			`campo "version" precisa ser 1 (recebido ${String(obj["version"])})`,
		);
	}
	const name = obj["name"];
	if (typeof name !== "string" || name.trim() === "") {
		invalidBundle('campo "name" precisa ser string não vazia');
	}
	const createdAt = obj["createdAt"];
	if (
		typeof createdAt !== "string" ||
		!Number.isFinite(Date.parse(createdAt))
	) {
		invalidBundle('campo "createdAt" precisa ser uma data ISO');
	}
	const map = projectMapOf(obj["map"]);

	// Personagem: null (não havia) ou bundle do wizard já validado — bundle de
	// sprite-lab é recusado: o pacote só carrega a base fechada do wizard.
	let character: WizardBundle | null = null;
	if (obj["character"] !== null) {
		const parsed = parseSpriteBundle(obj["character"]);
		if (parsed.kind !== "sprite-wizard-directions") {
			invalidBundle(
				'"character" precisa ser um bundle do wizard (sprite-wizard-directions)',
			);
		}
		character = parsed;
	}

	const blocksRaw = obj["blocks"];
	if (
		blocksRaw === null ||
		typeof blocksRaw !== "object" ||
		Array.isArray(blocksRaw)
	) {
		invalidBundle('campo "blocks" precisa ser um objeto hash → base64');
	}
	const blocks: Record<string, string> = {};
	for (const [hash, b64] of Object.entries(blocksRaw as Record<string, unknown>)) {
		if (!isWorldBlockHash(hash)) {
			invalidBundle(`"${hash}" não é hash de bloco (16 caracteres hexadecimais)`);
		}
		if (typeof b64 !== "string" || !isPngBase64(b64)) {
			invalidBundle(`campo "blocks[${hash}]" precisa ser um PNG em base64`);
		}
		blocks[hash] = b64;
	}

	return { version: 1, name, map, character, blocks, createdAt };
}

/**
 * Primeiro frame de um bloco em disco, em base64: a norte (formato v2, a
 * primeira das 4 faces) ou o cubo base (formato v3, o primeiro frame da
 * textura). Hash sem PNG não é erro — devolve null, o pacote segue sem o
 * bloco, e quem importar vê o cubo procedural (decisão da ADR 0033).
 */
async function readBlockBasePng(
	assetsDir: string,
	hash: string,
): Promise<string | null> {
	const dir = join(assetsDir, "world-blocks", hash);
	for (const rel of ["north.png", "base.png", "frames/frame_000.png"]) {
		try {
			return (await readFile(join(dir, rel))).toString("base64");
		} catch {
			// tenta o próximo candidato
		}
	}
	return null;
}

/**
 * Grava um bloco importado no catálogo: o PNG como cubo base estático
 * (manifesto v3, animated false) — o mínimo que listWorldBlocks e
 * readWorldBlockResult aceitam. A arte viaja sem a animação nem as 4 vistas;
 * regerar no destino com a mesma configuração reaproveita o base.png.
 */
async function writeImportedBlock(
	assetsDir: string,
	hash: string,
	b64: string,
): Promise<void> {
	const dir = join(assetsDir, "world-blocks", hash);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "base.png"), Buffer.from(b64, "base64"));
	const manifest = {
		version: 3,
		hash,
		technique: "texture",
		description: "bloco importado de um pacote de projeto",
		geometry: {
			tileWidth: BLOCK_GEOMETRY.tileWidth,
			tileHeight: BLOCK_GEOMETRY.tileHeight,
			cubeHeight: BLOCK_GEOMETRY.cubeHeight,
			spriteWidth: BLOCK_GEOMETRY.spriteWidth,
			spriteHeight: BLOCK_GEOMETRY.spriteHeight,
		},
		action: "static",
		animated: false,
		frameCount: 0,
		fps: 8,
	};
	await writeFile(join(dir, "block.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

// ---------------------------------------------------------------- http

const json = (res: ServerResponse, code: number, body: unknown): void => {
	res.statusCode = code;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.end(JSON.stringify(body));
};

/** 400 com mensagem em pt-BR — erro do pedido, nunca do servidor. */
const badRequest = (res: ServerResponse, error: string): void =>
	json(res, 400, { error });

async function readBody<T>(req: IncomingMessage): Promise<T> {
	const chunks: Buffer[] = [];
	for await (const c of req) chunks.push(c as Buffer);
	return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
}

const slug = (s: string): string =>
	s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "") || `id-${Date.now()}`;

/** Valida characterId + existência + wizard state das rotas do wizard. */
function resolveWizardCharacter(
	s: Studio,
	res: ServerResponse,
	characterId: string,
): Character | null {
	const ch = s.characters.find((c) => c.id === characterId);
	if (!ch) {
		json(res, 404, { error: `personagem "${characterId}" não encontrado` });
		return null;
	}
	if (!ch.wizard) {
		badRequest(res, `o personagem "${ch.id}" não está no fluxo do wizard`);
		return null;
	}
	return ch;
}

/** Extensões que a rota de assets serve, com o content-type de cada uma. */
const ASSET_TYPES: Readonly<Record<string, string>> = {
	".png": "image/png",
	".json": "application/json; charset=utf-8",
};

/**
 * Serve um arquivo gerado de dentro de `assets/`, lendo do disco a CADA
 * requisição.
 *
 * O `publicDir` do Vite não serve para isto: ele monta a listagem de arquivos
 * no boot, e todo asset gerado DEPOIS disso cai no fallback do index.html —
 * o navegador recebe HTML com status 200 no lugar do PNG e a miniatura
 * aparece quebrada. Verificado em 2026-08-01: blocos gravados antes do boot
 * respondiam `image/png`, e os gravados depois, `text/html`.
 *
 * Como aqui o arquivo é lido na hora, um asset recém-gerado aparece sem
 * reiniciar nada — que é o comportamento óbvio para uma ferramenta cujo
 * trabalho É gerar arquivos.
 */
async function serveGeneratedAsset(
	pathname: string,
	res: ServerResponse,
): Promise<boolean> {
	// `..` nunca chega ao join: o caminho é normalizado e qualquer salto para
	// fora de ASSETS é 404, não leitura de arquivo arbitrário.
	const rel = decodeURIComponent(pathname.replace(/^\/+/, ""));
	if (rel.includes("..") || rel.includes("\0")) return false;
	const ext = rel.slice(rel.lastIndexOf("."));
	const type = ASSET_TYPES[ext];
	if (type === undefined) return false;

	const full = join(ASSETS, rel);
	if (!full.startsWith(ASSETS)) return false;
	let body: Buffer;
	try {
		body = await readFile(full);
	} catch {
		return false;
	}
	res.statusCode = 200;
	res.setHeader("content-type", type);
	// Sem cache: o mesmo caminho pode ganhar bytes novos numa regeração.
	res.setHeader("cache-control", "no-store");
	res.end(body);
	return true;
}

export async function handle(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<boolean> {
	const url = new URL(req.url ?? "/", "http://local");

	// Assets gerados em runtime, antes do ramo /api/.
	if (
		req.method === "GET" &&
		(url.pathname.startsWith("/world-blocks/") ||
			url.pathname.startsWith("/sprite-lab/") ||
			url.pathname.startsWith("/assets/"))
	) {
		const rel = url.pathname.startsWith("/assets/")
			? url.pathname.slice("/assets".length)
			: url.pathname;
		if (await serveGeneratedAsset(rel, res)) return true;
		// Não achou: deixa o Vite tentar (publicDir cobre o que existia no boot).
		return false;
	}

	if (!url.pathname.startsWith("/api/")) return false;

	try {
		// ---- state -------------------------------------------------------------
		if (url.pathname === "/api/studio" && req.method === "GET") {
			const s = await load();
			const q = await jobQueue();
			json(res, 200, {
				...s,
				// `StudioJobView` é SUPERCONJUNTO do `Job` que esta rota publicava
				// (key, label, status, message?, startedAt), então a UI existente
				// continua lendo sem mudança — e ganha `queuePosition`, `kind`,
				// `paid` e `seq` de graça. A CHAVE é a mesma: `src/app/job-scope.ts`
				// deriva o dono do job dela, e mudá-la quebraria o bloqueio do wizard.
				jobs: q.toStudioJobs(),
				// O estado do teto de admissão, para a tela da onda seguinte poder
				// dizer "4 simultâneas" E de onde esse 4 saiu.
				queue: q.stats(),
				hasToken: Boolean(process.env["PIXELLAB_SECRET"]),
				// existsSync de propósito: validar os 12 PNGs do bundle a cada poll
				// de 3s seria I/O jogado fora — a validação de verdade roda no import.
				mannequinDefaultAvailable: existsSync(
					join(MANNEQUIN_DEFAULT_DIR, "mannequin.json"),
				),
			});
			return true;
		}

		// ---- jobs: cancelar -------------------------------------------------------
		if (url.pathname.startsWith("/api/jobs/") && req.method === "DELETE") {
			const jobKey = url.pathname.slice("/api/jobs/".length);
			if (!jobKey) {
				badRequest(res, "chave do job é obrigatória");
				return true;
			}
			// Cancelamento de VERDADE nos dois estados: enfileirado sai sem nunca
			// ter rodado (nada gasto), em execução tem o AbortSignal abortado —
			// e o signal chega às chamadas HTTP das poses e das peças, então lá a
			// interrupção é real e não só um relabel do registro.
			//
			// LIMITAÇÃO CONHECIDA, E NÃO CORRIGIDA AQUI: o `ctx.signal` só é
			// repassado em DOIS dos sete ramos — `pose` e `wardrobe`, logo abaixo
			// neste arquivo. Nos outros cinco (`wizard-south`, `wizard-south-edit`,
			// `wizard-directions8`, `sprite-lab`, `world-block`) o executor não
			// recebe signal nenhum, então `#run` fica aguardando um trabalho que
			// ninguém interrompeu: o job aparece 'cancelado' na hora para o usuário,
			// mas continua OCUPANDO a vaga do semáforo até o módulo terminar
			// sozinho — até 15 min num `sprite-lab`. Não custa dinheiro (a
			// submissão daquele job já saiu ou não vai sair), custa VAGA: com o teto
			// default de 8 chamadas, cinco cancelamentos cosméticos deixam a fila
			// com três.
			//
			// Fechar isso é levar `ctx.signal` para `mannequin.ts`, `sprite-lab.ts`
			// e `world-block.ts` — três módulos FORA do escopo desta correção, e um
			// deles sob edição por outro agente. Fica registrado em vez de
			// contornado com uma gambiarra que abandonasse o executor em voo.
			const q = await jobQueue();
			const outcome = await q.cancel(jobKey);
			if (outcome.result === "not-found") {
				json(res, 404, { error: `job "${jobKey}" não encontrado` });
				return true;
			}
			if (outcome.result === "already-finished") {
				json(res, 200, { ok: true, status: outcome.job.status });
				return true;
			}
			// A célula é escrita pelo espelho (`syncJobCells`), que já conhece a
			// regra de dinheiro: apaga quando NADA foi cobrado, e deixa 'falhou'
			// com a mensagem da fila quando o cancelamento veio DEPOIS da
			// submissão — ali o `remote` guardado é o caminho de volta ao que já
			// foi pago, e a UI precisa do botão de retomar, não de uma célula vazia.
			json(res, 200, {
				ok: true,
				status: "cancelado",
				...(outcome.result === "aborted"
					? { aborted: true, paid: outcome.paid }
					: { aborted: false, paid: false }),
			});
			return true;
		}

		// ---- wizard: config -----------------------------------------------------
		if (url.pathname === "/api/wizard/config" && req.method === "POST") {
			const b = await readBody<{
				characterId?: string;
				frameCount?: number;
				fps?: number;
				size?: number;
				silhouette?: Silhouette;
				detail?: DetailOption;
				outline?: OutlineOption;
				view?: ViewOption;
				templateId?: TemplateOption;
				coverage?: number;
				fitFrames?: boolean;
			}>(req);

			// Só o primeiro personagem trava a config; personagens derivados herdam o lock.
			const s = await load();
			const ch = s.characters.find((c) => c.id === b.characterId);
			if (!ch) {
				json(res, 404, { error: `personagem "${b.characterId}" não encontrado` });
				return true;
			}
			// Valida os campos ANTES de checar o lock: um POST com enum inválido
			// não deve parecer que o lock está bloqueando.
			if (b.frameCount !== 4 && b.frameCount !== 8 && b.frameCount !== 16) {
				badRequest(
					res,
					"frameCount precisa ser 4, 8 ou 16 — a API rejeita qualquer outro valor",
				);
				return true;
			}
			if (typeof b.fps !== "number" || !Number.isFinite(b.fps) || b.fps <= 0) {
				badRequest(res, "fps precisa ser um número positivo");
				return true;
			}
			if (
				typeof b.size !== "number" ||
				!Number.isInteger(b.size) ||
				b.size < 32 ||
				b.size > 256
			) {
				badRequest(
					res,
					"size precisa ser inteiro entre 32 e 256 (faixa do endpoint create-character-v3)",
				);
				return true;
			}
			if (b.silhouette !== undefined && !SILHOUETTES.includes(b.silhouette)) {
				badRequest(res, `silhouette desconhecida: ${b.silhouette}`);
				return true;
			}
			if (b.detail !== undefined && !DETAIL_OPTIONS.includes(b.detail as DetailOption)) {
				badRequest(
					res,
					`detail inválido: ${b.detail} (válidos: ${DETAIL_OPTIONS.join(", ")})`,
				);
				return true;
			}
			if (b.outline !== undefined && !OUTLINE_OPTIONS.includes(b.outline as OutlineOption)) {
				badRequest(
					res,
					`outline inválido: ${b.outline} (válidos: ${OUTLINE_OPTIONS.join(", ")})`,
				);
				return true;
			}
			if (b.view !== undefined && !VIEW_OPTIONS.includes(b.view as ViewOption)) {
				badRequest(res, `view inválida: ${b.view} (válidas: ${VIEW_OPTIONS.join(", ")})`);
				return true;
			}
			if (
				b.templateId !== undefined &&
				!TEMPLATE_OPTIONS.includes(b.templateId as TemplateOption)
			) {
				badRequest(
					res,
					`templateId inválido: ${b.templateId} (válidos: ${TEMPLATE_OPTIONS.join(", ")})`,
				);
				return true;
			}
			if (ch.wizard?.etapa === "pronto") {
				badRequest(res, "a configuração é imutável depois do personagem pronto");
				return true;
			}
			if ((ch.wizard?.southVersions.length ?? 0) > 0) {
				badRequest(
					res,
					"já existe uma versão da sul gerada — a configuração só muda via reset do personagem",
				);
				return true;
			}
			s.lock = {
				frameCount: b.frameCount,
				fps: b.fps,
				size: b.size,
				...(b.detail !== undefined ? { detail: b.detail } : {}),
				...(b.outline !== undefined ? { outline: b.outline } : {}),
				...(b.view !== undefined ? { view: b.view } : {}),
				...(b.templateId !== undefined ? { templateId: b.templateId } : {}),
				...(b.coverage !== undefined ? { coverage: b.coverage } : {}),
				...(b.fitFrames !== undefined ? { fitFrames: b.fitFrames } : {}),
			};
			const idx = s.characters.findIndex((c) => c.id === ch.id);
			s.characters[idx] = {
				...ch,
				size: b.size,
				...(b.silhouette !== undefined ? { silhouette: b.silhouette } : {}),
			};
			await save(s);
			json(res, 200, { ok: true, lock: s.lock });
			return true;
		}

		// ---- wizard: sul por texto ----------------------------------------------
		if (url.pathname === "/api/wizard/south" && req.method === "POST") {
			const b = await readBody<{
				characterId?: string;
				description?: string;
				colorImageB64?: string;
				referenceBase64?: string;
				mannequin?: boolean;
				mold?: string | null;
				negativePrompt?: string;
			}>(req);
			if (
				typeof b.characterId !== "string" ||
				typeof b.description !== "string" ||
				b.description.trim() === ""
			) {
				badRequest(res, "characterId e description são obrigatórios");
				return true;
			}
			const characterId = b.characterId;
			const description = b.description;
			const s = await load();
			const ch = resolveWizardCharacter(s, res, characterId);
			if (!ch) return true;
			// Modo manequim e negativo são do PERSONAGEM, não do request: a geração
			// roda em background e mannequin.ts lê o studio.json de novo lá dentro.
			// Gravar antes do spawn é o que faz o andaime chegar no request.
			if (
				b.mannequin !== undefined ||
				b.mold !== undefined ||
				b.negativePrompt !== undefined
			) {
				if (b.mannequin !== undefined && typeof b.mannequin !== "boolean") {
					badRequest(res, "mannequin precisa ser booleano");
					return true;
				}
				// `null` APAGA o molde e volta ao caminho histórico (referência do
				// usuário em init_image). Um id desconhecido é recusado em vez de
				// ignorado: gerar sem o molde que o usuário escolheu, calado, gastaria
				// dinheiro produzindo a proporção errada.
				if (b.mold !== undefined && b.mold !== null && !isMoldId(b.mold)) {
					badRequest(
						res,
						`mold precisa ser um de: ${MOLD_IDS.join(", ")} (ou null para nenhum)`,
					);
					return true;
				}
				if (b.mold !== undefined && b.mold !== null && !moldExists(b.mold)) {
					badRequest(
						res,
						`o molde "${b.mold}" não está em ${MOLD_DIR} — o arquivo do projeto sumiu`,
					);
					return true;
				}
				if (
					b.negativePrompt !== undefined &&
					typeof b.negativePrompt !== "string"
				) {
					badRequest(res, "negativePrompt precisa ser texto");
					return true;
				}
				const idx = s.characters.findIndex((c) => c.id === ch.id);
				const atualizado: Character = { ...ch };
				if (b.mannequin !== undefined) atualizado.mannequin = b.mannequin;
				if (b.mold !== undefined) {
					if (b.mold === null) delete atualizado.mold;
					else atualizado.mold = b.mold;
				}
				if (b.negativePrompt !== undefined) {
					const negativo = b.negativePrompt.trim();
					// Campo vazio APAGA o negativo; deixá-lo como undefined explícito
					// não passa em exactOptionalPropertyTypes e sujaria o studio.json.
					if (negativo) atualizado.negativePrompt = negativo;
					else delete atualizado.negativePrompt;
				}
				s.characters[idx] = atualizado;
				await save(s);
			}
			// Upload de referência visual para a sul: grava ANTES do spawn —
			// mannequin.ts lê o arquivo do disco e o envia como init_image.
			// Aceita b64 puro ou data URI (FileReader.readAsDataURL na UI manda
			// "data:image/png;base64,…"). Upload novo substitui o anterior; sem
			// o campo, uma referência já gravada continua valendo (remover é
			// DELETE /api/wizard/south/reference). O formato real da imagem não
			// é validado aqui — quem rejeita é a API, e a correção é refazer o
			// upload ou remover a referência.
			if (
				typeof b.referenceBase64 === "string" &&
				b.referenceBase64.trim() !== ""
			) {
				const raw = b.referenceBase64.replace(/^data:image\/\w+;base64,/, "");
				const buf = Buffer.from(raw, "base64");
				if (buf.length === 0) {
					badRequest(res, "referenceBase64 não é um base64 válido");
					return true;
				}
				const refPath = join(ASSETS, "wizard", ch.id, "reference.png");
				await mkdir(dirname(refPath), { recursive: true });
				await writeFile(refPath, buf);
			}
			// colorImageB64 explícito do cliente (ex.: referência de cor customizada)
			// tem precedência sobre a sul do manequim do estúdio — e a decisão
			// mudou de lugar: ela agora acontece no DESPACHO (ver `dispatch`),
			// porque a sul do manequim pode ser gerada enquanto este pedido espera
			// na fila, e ler o disco aqui congelaria a ausência dela.
			const key = southKey(ch.id);
			await enqueueAndRespond(res, {
				key,
				label: `${ch.label} · sul`,
				descriptor: {
					kind: "wizard-south",
					characterId: ch.id,
					description,
					// Só a referência EXPLÍCITA do cliente entra no descritor; a sul do
					// manequim é relida no despacho, que é quando ela vale.
					...(b.colorImageB64 !== undefined && b.colorImageB64.length > 0
						? { colorImageB64: b.colorImageB64 }
						: {}),
				},
				cellKeys: [key],
			});
			return true;
		}

		// ---- wizard: edição da sul ------------------------------------------------
		if (url.pathname === "/api/wizard/south/edit" && req.method === "POST") {
			const b = await readBody<{ characterId?: string; prompt?: string }>(req);
			if (
				typeof b.characterId !== "string" ||
				typeof b.prompt !== "string" ||
				b.prompt.trim() === ""
			) {
				badRequest(res, "characterId e prompt são obrigatórios");
				return true;
			}
			const characterId = b.characterId;
			const prompt = b.prompt;
			const s = await load();
			const ch = resolveWizardCharacter(s, res, characterId);
			if (!ch) return true;
			const key = southKey(ch.id);
			await enqueueAndRespond(res, {
				key,
				label: `${ch.label} · edição da sul`,
				descriptor: { kind: "wizard-south-edit", characterId: ch.id, prompt },
				cellKeys: [key],
			});
			return true;
		}

		// ---- wizard: desfazer edição da sul -----------------------------------------
		if (url.pathname === "/api/wizard/south/undo" && req.method === "POST") {
			const b = await readBody<{ characterId?: string }>(req);
			if (typeof b.characterId !== "string") {
				badRequest(res, "characterId é obrigatório");
				return true;
			}
			const s = await load();
			const ch = resolveWizardCharacter(s, res, b.characterId);
			if (!ch) return true;
			// Instantâneo (nenhuma chamada de API): roda na hora — não é job.
			try {
				await undoSouth(store, ch.id, wizardOpts());
			} catch (err) {
				badRequest(res, err instanceof Error ? err.message : String(err));
				return true;
			}
			json(res, 200, { ok: true });
			return true;
		}

		// ---- wizard: remover a referência da sul -------------------------------------
		if (
			url.pathname === "/api/wizard/south/reference" &&
			req.method === "DELETE"
		) {
			const b = await readBody<{ characterId?: string }>(req);
			if (typeof b.characterId !== "string") {
				badRequest(res, "characterId é obrigatório");
				return true;
			}
			const s = await load();
			const ch = s.characters.find((c) => c.id === b.characterId);
			if (!ch) {
				json(res, 404, {
					error: `personagem "${b.characterId}" não encontrado`,
				});
				return true;
			}
			// Idempotente: 200 sempre que o personagem existe — rm force não
			// lança quando o arquivo não existe. Não há ponteiro persistido no
			// modelo: o arquivo em disco É o estado da referência, então
			// removê-lo já devolve a sul ao modo texto puro. Não exige wizard
			// state de propósito: a limpeza precisa funcionar mesmo depois de
			// um reset do manequim.
			await rm(join(ASSETS, "wizard", ch.id, "reference.png"), {
				force: true,
			});
			json(res, 200, { ok: true });
			return true;
		}

		// ---- wizard: oito direções (create-character-v3) -------------------------------
		if (url.pathname === "/api/wizard/directions8" && req.method === "POST") {
			const b = await readBody<{ characterId?: string }>(req);
			if (typeof b.characterId !== "string") {
				badRequest(res, "characterId é obrigatório");
				return true;
			}
			const s = await load();
			const ch = resolveWizardCharacter(s, res, b.characterId);
			if (!ch) return true;
			const key = directions8Key(ch.id);
			await enqueueAndRespond(res, {
				key,
				label: `${ch.label} · 8 direções`,
				descriptor: { kind: "wizard-directions8", characterId: ch.id },
				cellKeys: [key],
			});
			return true;
		}

		// ---- manequim default -------------------------------------------------------
		if (url.pathname === "/api/mannequin/export" && req.method === "POST") {
			try {
				const bundle = await exportMannequin(store, MANNEQUIN_DEFAULT_DIR);
				json(res, 200, bundle);
			} catch (err) {
				// Pré-condição não atendida (wizard não pronto, célula faltando…) é
				// erro do pedido, não do servidor.
				badRequest(res, err instanceof Error ? err.message : String(err));
			}
			return true;
		}

		if (url.pathname === "/api/mannequin/import" && req.method === "POST") {
			const b = await readBody<{ source?: string; bundle?: unknown }>(req);
			try {
				if (b.source === "default") {
					await importMannequin(
						store,
						{ kind: "default", defaultDir: MANNEQUIN_DEFAULT_DIR },
						ASSETS,
					);
				} else if (b.bundle !== undefined) {
					await importMannequin(store, { kind: "bundle", bundle: b.bundle }, ASSETS);
				} else {
					badRequest(res, 'informe { source: "default" } ou { bundle }');
					return true;
				}
			} catch (err) {
				// Erros de validação do bundle chegam nomeados — vão ao usuário como 400.
				badRequest(res, err instanceof Error ? err.message : String(err));
				return true;
			}
			json(res, 200, { ok: true });
			return true;
		}

		if (url.pathname === "/api/mannequin/reset" && req.method === "POST") {
			const s = await load();
			const idx = s.characters.findIndex((c) => c.id === "manequim");
			const ch = s.characters[idx];
			if (!ch) {
				json(res, 404, { error: "manequim não encontrado" });
				return true;
			}
			// Reabre o wizard do zero: sul, 8 direções, remoteId e lock
			// caem. Poses, guarda-roupa e os demais personagens não são tocados.
			// O passo de cardeais foi removido com a migração v3.
			const next: Character = {
				...ch,
				wizard: { etapa: "sul", southVersions: [], activeSouth: 0 },
			};
			delete next.remoteId;
			s.characters[idx] = next;
			delete s.cells[southKey("manequim")];
			delete s.cells[directions8Key("manequim")];
			delete s.lock;
			await save(s);
			json(res, 200, { ok: true });
			return true;
		}

		// ---- wizard: import/export de bundle (Sprite Studio) ------------------------------
		if (url.pathname === "/api/wizard/import" && req.method === "POST") {
			const b = await readBody<{ characterId?: string; bundle?: unknown }>(req);
			if (typeof b.characterId !== "string" || b.bundle === undefined) {
				badRequest(res, "characterId e bundle são obrigatórios");
				return true;
			}
			try {
				// parseSpriteBundle valida TUDO (schema + PNGs) antes do primeiro
				// byte escrito; importSpriteBundle reseta o wizard do alvo e aplica
				// o bundle (lab → etapa direcoes8; wizard → pronto + remoteId).
				const bundle = parseSpriteBundle(b.bundle);
				await importSpriteBundle(
					store,
					bundle,
					{ kind: "existing", characterId: b.characterId },
					ASSETS,
				);
			} catch (err) {
				// Erros nomeiam o campo ofensor — vão ao usuário como 400.
				badRequest(res, err instanceof Error ? err.message : String(err));
				return true;
			}
			json(res, 200, { ok: true });
			return true;
		}

		if (url.pathname === "/api/wizard/export" && req.method === "POST") {
			const b = await readBody<{ characterId?: string }>(req);
			if (typeof b.characterId !== "string") {
				badRequest(res, "characterId é obrigatório");
				return true;
			}
			try {
				// Exige etapa 'pronto' — exportar trabalho incompleto seria congelar
				// uma base aberta (a regra é do módulo, que lança erro nomeado).
				const bundle = await exportWizardBundle(store, b.characterId, ASSETS);
				json(res, 200, bundle);
			} catch (err) {
				badRequest(res, err instanceof Error ? err.message : String(err));
			}
			return true;
		}

		// ---- laboratório de rotação -----------------------------------------------------
		if (url.pathname === "/api/rotate-lab" && req.method === "POST") {
			const b = await readBody<RotateLabInput>(req);
			try {
				const result = await runRotateLab(client(), b, {
					assetsDir: ASSETS,
					ledgerPath: LEDGER_PATH,
					onLog: (m) => console.log(m),
				});
				// Cache hit vem sem `usage` — não é erro: nenhuma chamada saiu.
				json(res, 200, result);
			} catch (err) {
				if (err instanceof RotateLabValidationError) {
					json(res, 400, { error: err.message, code: err.code });
					return true;
				}
				throw err;
			}
			return true;
		}

		// ---- sprite studio (bancada v3) ---------------------------------------------------
		// ORDEM IMPORTA: as rotas de caminho EXATO (o POST e o GET do catálogo)
		// vêm ANTES do GET com prefixo — sem isso um POST /api/sprite-lab cairia
		// no ramo do GET com hash vazio, e o catálogo idem.
		if (url.pathname === "/api/sprite-lab" && req.method === "POST") {
			const b = await readBody<SpriteLabConfig>(req);
			// Validação TOTAL antes de responder: config inválida é 400 nomeado —
			// sem job, sem disco, sem API.
			try {
				validateSpriteLabConfig(b);
			} catch (err) {
				if (err instanceof SpriteLabValidationError) {
					json(res, 400, { error: err.message, code: err.code });
					return true;
				}
				throw err;
			}
			const hash = spriteLabHash(b);
			// Cache hit: o manifesto e os PNGs já estão em disco — 200 com o
			// resultado, sem job e sem gasto (idempotência por hash).
			const cached = await readSpriteLabResult(hash, ASSETS);
			if (cached) {
				// Mesma forma do GET: status nomeado + result. Sem isso a tela
				// teria que distinguir dois formatos de resposta da mesma rota.
				json(res, 200, { status: "pronto", result: cached });
				return true;
			}
			// A CHAVE continua sendo exatamente `sprite-lab::<hash>`: é o único
			// caminho de volta a uma corrida em voo depois de um remount da tela
			// (`src/app/screens/laboratorio/studio-recovery.ts` extrai o hash
			// fatiando a chave), e `src/app/job-scope.ts` deriva o dono do job dela.
			const key = `sprite-lab::${hash}`;
			// cellKeys []: a bancada não tem célula no studio — o andamento chega
			// à UI pelo registro de jobs e o resultado pelo GET abaixo.
			await enqueueAndRespond(
				res,
				{
					key,
					label: `sprite-lab · ${hash}`,
					// A config INTEIRA vai no descritor, e isso é requisito: a bancada
					// não tem entidade no estúdio para reler, e `runSpriteLab` grava
					// `config` no manifesto (`runConfigOf`) — reexecutar por outro
					// caminho gravaria outro manifesto.
					descriptor: { kind: "sprite-lab", hash, config: b },
					cellKeys: [],
				},
				{ hash },
			);
			return true;
		}

		// Catálogo das corridas já geradas em disco — é daqui que o Sprite Studio
		// se recupera depois de trocar de aba ou de um F5. Espelha
		// GET /api/world-blocks, que é o motivo de um bloco gerado sobreviver ao
		// remount e um personagem gerado não sobreviver: o painel de blocos
		// tinha um catálogo para ler, este não tinha.
		//
		// Sem barra final de propósito: este é o caminho EXATO, e por isso vem
		// antes do GET com prefixo logo abaixo.
		if (url.pathname === "/api/sprite-lab" && req.method === "GET") {
			json(res, 200, { runs: await listSpriteLabRuns(ASSETS) });
			return true;
		}

		if (url.pathname.startsWith("/api/sprite-lab/") && req.method === "GET") {
			const hash = url.pathname.slice("/api/sprite-lab/".length);
			// O hash é sempre hex de 16 chars — qualquer outra coisa é 404, não
			// tentativa de path traversal no manifesto. Este é o ÚNICO 404 que
			// sobra nesta rota, e ele significa mesmo "recurso inexistente".
			if (!/^[a-f0-9]{16}$/i.test(hash)) {
				json(res, 404, {
					error: `resultado do sprite-lab "${hash}" não existe`,
				});
				return true;
			}

			// Andamento é RESPOSTA, não erro. Antes esta rota devolvia 404
			// enquanto o job rodava e a UI sondava em cima disso: o navegador
			// registrava uma linha vermelha a cada 3 s, o usuário lia aquilo
			// como falha, e uma falha real do job ficava indistinguível do
			// caminho feliz. Agora o estado vem nomeado no corpo, com 200.
			const result = await readSpriteLabResult(hash, ASSETS);
			if (result) {
				json(res, 200, { status: "pronto", result });
				return true;
			}
			const q = await jobQueue();
			const job = q.get(`sprite-lab::${hash}`);
			// `'interrompido'` viaja como `'falhou'`: o vocabulário desta rota tem
			// quatro valores e a tela os consome LITERALMENTE — um quinto cairia no
			// `throw` do cliente e mataria o `setInterval` da sondagem. O que
			// distingue os dois casos é o texto, que vem do `message` do job e já
			// diz que a geração pode ter sido cobrada. Terminal dos dois jeitos: a
			// tela para de sondar, que é o certo.
			if (job?.status === "falhou" || job?.status === "interrompido") {
				json(res, 200, {
					status: "falhou",
					error: job.message ?? "a geração falhou",
				});
				return true;
			}
			// ENFILEIRADO TAMBÉM É ANDAMENTO. Um job que ainda não entrou não pode
			// cair no ramo 'desconhecido' logo abaixo: a UI trata aquele estado
			// como perda definitiva e para de sondar, e o job rodaria sozinho com
			// a tela dizendo que falhou. O status NOMEADO continua sendo
			// 'gerando' — o vocabulário desta rota tem quatro valores e a tela os
			// consome literalmente — e a distinção viaja em `queued`/`position`,
			// que são aditivos: quem não os lê continua vendo o que via.
			if (job?.status === "gerando" || job?.status === "na-fila") {
				const posicao = q.pending().findIndex((j) => j.key === job.key) + 1;
				json(res, 200, {
					status: "gerando",
					queued: job.status === "na-fila",
					...(posicao > 0 ? { position: posicao } : {}),
				});
				return true;
			}
			// Sem manifesto e sem job. Com a fila persistente isto deixou de ser o
			// caso comum — um reinício não perde mais o registro, ele é
			// reconciliado e volta a drenar. O ramo FICA porque um hash que nunca
			// rodou nesta máquina continua chegando aqui.
			json(res, 200, {
				status: "desconhecido",
				error:
					`não há resultado nem job para o sprite-lab "${hash}" — ` +
					"esta configuração nunca rodou neste servidor, ou o registro dela já " +
					"foi podado do histórico. " +
					"Gerar de novo com a mesma configuração reaproveita o que já está em disco.",
			});
			return true;
		}

		// ---- blocos do mundo (bancada do create-isometric-tile) --------------------------
		// Mesma forma do sprite-lab: POST exato ANTES do GET com prefixo, 202
		// com {key, hash}, e o GET devolve estado NOMEADO com 200 — andamento
		// nunca é 404.
		if (url.pathname === "/api/world-block" && req.method === "POST") {
			const b = await readBody<WorldBlockConfig>(req);
			try {
				validateWorldBlockConfig(b);
			} catch (err) {
				if (err instanceof WorldBlockValidationError) {
					json(res, 400, { error: err.message, code: err.code });
					return true;
				}
				throw err;
			}
			const hash = worldBlockHash(b);
			const cached = await readWorldBlockResult(hash, ASSETS);
			if (cached) {
				json(res, 200, { status: "pronto", result: cached });
				return true;
			}
			const key = `world-block::${hash}`;
			// Um pedido novo para um hash apagado neste processo volta a ser
			// visível: o "esquecimento" do DELETE valia para o registro antigo.
			forgottenWorldBlocks.delete(hash);
			await enqueueAndRespond(
				res,
				{
					key,
					label: `world-block · ${hash}`,
					descriptor: { kind: "world-block", hash, config: b },
					cellKeys: [],
				},
				{ hash },
			);
			return true;
		}

		if (url.pathname.startsWith("/api/world-block/") && req.method === "GET") {
			const hash = url.pathname.slice("/api/world-block/".length);
			// A regra do hash mora em world-block.ts (isWorldBlockHash) — uma
			// fonte só, porque o DELETE abaixo apaga arquivos com base nela.
			if (!isWorldBlockHash(hash)) {
				json(res, 404, { error: `bloco do mundo "${hash}" não existe` });
				return true;
			}
			const result = await readWorldBlockResult(hash, ASSETS);
			if (result) {
				json(res, 200, { status: "pronto", result });
				return true;
			}
			const q = await jobQueue();
			const job = forgottenWorldBlocks.has(hash)
				? undefined
				: q.get(`world-block::${hash}`);
			// Mesma colapsagem do sprite-lab, e pelo mesmo motivo: ver lá.
			if (job?.status === "falhou" || job?.status === "interrompido") {
				json(res, 200, {
					status: "falhou",
					error: job.message ?? "a geração falhou",
				});
				return true;
			}
			// Mesma regra do sprite-lab: enfileirado é andamento, não perda.
			if (job?.status === "gerando" || job?.status === "na-fila") {
				const posicao = q.pending().findIndex((j) => j.key === job.key) + 1;
				json(res, 200, {
					status: "gerando",
					queued: job.status === "na-fila",
					...(posicao > 0 ? { position: posicao } : {}),
				});
				return true;
			}
			json(res, 200, {
				status: "desconhecido",
				error:
					`não há bloco nem job para "${hash}" — esta configuração nunca rodou ` +
					"neste servidor, ou o bloco foi apagado. Gerar de novo com a mesma " +
					"configuração reaproveita o disco.",
			});
			return true;
		}

		// Remoção do bloco. Vem DEPOIS do POST exato e não colide com ele nem
		// com /api/world-blocks (que não tem a barra do prefixo), mas segue a
		// mesma ordem documentada acima: exato primeiro, prefixado depois.
		//
		// Irreversível de propósito e sem lixeira — a confirmação é da tela
		// (pressionar-e-segurar). O dinheiro da geração já saiu e não volta.
		if (url.pathname.startsWith("/api/world-block/") && req.method === "DELETE") {
			const hash = url.pathname.slice("/api/world-block/".length);
			// 400, não 404: hash malformado é pedido errado, não recurso
			// ausente — e a resposta tem que ser uma RECUSA visível. `..`, `/`,
			// `\` e NUL não passam desta linha; o que sobrevive a ela é
			// literalmente 16 hexadecimais.
			if (!isWorldBlockHash(hash)) {
				json(res, 400, {
					error: `"${hash}" não é hash de bloco: são 16 caracteres hexadecimais. Nada foi apagado.`,
					code: "hash-format",
				});
				return true;
			}

			// Bloco em geração não se apaga. Dois motivos, os dois sobre
			// dinheiro: o diretório guarda os stubs (`*.pending.json`,
			// `v3/character.json`) que são o caminho de volta GRATUITO ao que a
			// PixelLab já cobrou, e remover arquivos embaixo de runWorldBlock
			// deixaria o bloco meio gravado.
			//
			// UM JOB 'na-fila' TEM DE ENTRAR NESTA GUARDA, e antes não entrava:
			// a checagem testava só "gerando", então um bloco enfileirado era
			// apagado e sobrava um job órfão apontando para um diretório que já
			// não existia — ele chegaria na frente da fila e regeraria o bloco
			// que o usuário acabou de mandar apagar, pagando por isso. Enfileirado
			// ainda não gastou nada, então aqui o certo não é recusar: é CANCELAR
			// (a fila devolve 'removed', sem cobrança) e seguir apagando.
			const q = await jobQueue();
			const jobKey = `world-block::${hash}`;
			const emVoo = q.get(jobKey);
			if (emVoo?.status === "gerando") {
				json(res, 409, {
					error:
						`o bloco "${hash}" está sendo gerado agora — espere terminar ou cancele o job ` +
						`(DELETE /api/jobs/${jobKey}) para apagar. ` +
						"A geração já foi cobrada e apagar no meio jogaria fora o caminho de volta ao que foi pago.",
					code: "block-generating",
				});
				return true;
			}
			let cancelledQueued = false;
			if (emVoo?.status === "na-fila") {
				const cancel = await q.cancel(jobKey);
				cancelledQueued = cancel.result === "removed";
			}

			const removal = await deleteWorldBlock(ASSETS, hash);
			// O bloco não existe mais: o registro do job dele também não deve
			// aparecer, senão um GET posterior responderia 'falhou' sobre um
			// hash que não está em lugar nenhum. Ver `forgottenWorldBlocks`.
			forgottenWorldBlocks.add(hash);
			json(res, 200, { ok: true, ...removal, ...(cancelledQueued ? { cancelledQueued } : {}) });
			return true;
		}

		// Catálogo de blocos já gerados: é daqui que o map-builder monta a paleta.
		if (url.pathname === "/api/world-blocks" && req.method === "GET") {
			json(res, 200, { blocks: await listWorldBlocks(ASSETS) });
			return true;
		}

		// O molde em PNG: o editor mostra ao usuário a forma que toda geração segue.
		// Prévia dos moldes de proporção. Serve o PNG do pacote de assets em vez de
		// copiá-lo para `assets/`: molde é asset versionado do projeto, não arte
		// gerada, e duplicá-lo criaria duas verdades sobre a mesma proporção.
		if (url.pathname.startsWith("/api/molde/") && req.method === "GET") {
			const id = url.pathname.slice("/api/molde/".length).replace(/\.png$/, "");
			if (!isMoldId(id)) {
				json(res, 404, {
					error: `molde desconhecido: "${id}". Existem: ${MOLD_IDS.join(", ")}.`,
				});
				return true;
			}
			if (!moldExists(id)) {
				json(res, 404, {
					error: `o molde "${id}" não está em ${MOLD_DIR}.`,
				});
				return true;
			}
			const png = await readFile(moldPath(id));
			res.writeHead(200, {
				"content-type": "image/png",
				"content-length": String(png.length),
				"cache-control": "no-cache",
			});
			res.end(png);
			return true;
		}

		if (url.pathname === "/api/block-mould.png" && req.method === "GET") {
			const png = renderMouldPng();
			res.writeHead(200, {
				"content-type": "image/png",
				"content-length": String(png.length),
				// Determinístico e derivado do código: cachear é seguro enquanto o
				// processo viver, e errado entre versões. `no-cache` revalida.
				"cache-control": "no-cache",
			});
			res.end(png);
			return true;
		}

		// A geometria canônica, para quem desenha. Uma fonte, não uma constante
		// copiada em cada ferramenta.
		if (url.pathname === "/api/block-geometry" && req.method === "GET") {
			json(res, 200, {
				geometry: {
					tileWidth: BLOCK_GEOMETRY.tileWidth,
					tileHeight: BLOCK_GEOMETRY.tileHeight,
					cubeHeight: BLOCK_GEOMETRY.cubeHeight,
					spriteWidth: BLOCK_GEOMETRY.spriteWidth,
					spriteHeight: BLOCK_GEOMETRY.spriteHeight,
					anchorX: BLOCK_GEOMETRY.anchorX,
					anchorY: BLOCK_GEOMETRY.anchorY,
				},
				mouldUrl: "/api/block-mould.png",
			});
			return true;
		}

		// ---- characters ------------------------------------------------------------------
		if (url.pathname === "/api/characters" && req.method === "POST") {
			const b = await readBody<{
				label?: string;
				description?: string;
				silhouette?: Silhouette;
				seed?: number;
			}>(req);
			const s = await load();
			const lock = s.lock;
			if (!lock) {
				badRequest(
					res,
					"trave a configuração primeiro (POST /api/wizard/config)",
				);
				return true;
			}
			const base = s.characters.find((c) => c.wizard?.etapa === "pronto");
			if (!base) {
				badRequest(
					res,
					"é preciso ter um personagem com wizard concluído para derivar novos",
				);
				return true;
			}
			if (
				typeof b.label !== "string" ||
				b.label.trim() === "" ||
				typeof b.description !== "string"
			) {
				badRequest(res, "label e description são obrigatórios");
				return true;
			}
			if (b.silhouette !== undefined && !SILHOUETTES.includes(b.silhouette)) {
				badRequest(
					res,
					`silhouette desconhecida: ${b.silhouette} (válidas: ${SILHOUETTES.join(", ")})`,
				);
				return true;
			}
			const id = slug(b.label);
			if (s.characters.some((c) => c.id === id)) {
				badRequest(
					res,
					`já existe um personagem com o id "${id}" — escolha outro nome`,
				);
				return true;
			}
			const ch: Character = {
				id,
				label: b.label,
				description: b.description,
				// Sem silhueta informada, o derivado herda a do manequim: é o corpo
				// de referência, e peça só vale dentro da mesma silhueta.
				silhouette: b.silhouette ?? base.silhouette,
				size: lock.size,
				seed: b.seed ?? Math.floor(Math.random() * 100000),
				wizard: { etapa: "sul", southVersions: [], activeSouth: 0 },
				createdAt: new Date().toISOString(),
			};
			s.characters.push(ch);
			await save(s);
			json(res, 200, ch);
			return true;
		}

		if (url.pathname === "/api/characters" && req.method === "DELETE") {
			const b = await readBody<{ characterId?: string }>(req);
			if (typeof b.characterId !== "string" || b.characterId.trim() === "") {
				badRequest(res, "characterId é obrigatório");
				return true;
			}
			const s = await load();
			const idx = s.characters.findIndex((c) => c.id === b.characterId);
			if (idx === -1) {
				json(res, 404, { error: `personagem "${b.characterId}" não encontrado` });
				return true;
			}
			// `idx !== -1` já retornou acima, então o acesso nunca é undefined.
			const ch = s.characters[idx]!;
			// `builtin` não está no tipo Character (os presets foram removidos na
			// onda anterior), mas pode existir num studio.json legado em disco —
			// o cast preserva a proteção sem declarar campo novo no modelo.
			if ((ch as { readonly builtin?: boolean }).builtin) {
				badRequest(res, "personagens embutidos não podem ser deletados");
				return true;
			}
			// Bloqueia se houver QUALQUER job VIVO para este personagem — e vivo
			// inclui 'na-fila'. Testar só 'gerando' deixava apagar um personagem
			// com pedido enfileirado: o job continuava na fila, chegava na frente e
			// despachava contra um personagem que não existe mais. Hoje isso é
			// falha nomeada (`requireCharacterFor`) e não gasta, mas a resposta
			// certa é não deixar o usuário criar o órfão.
			const prefix = b.characterId + "::";
			const q = await jobQueue();
			const vivo = q
				.list()
				.find(
					(j) =>
						j.key.startsWith(prefix) &&
						(j.status === "gerando" || j.status === "na-fila"),
				);
			if (vivo) {
				json(res, 409, {
					error:
						vivo.status === "gerando"
							? `o personagem "${ch.label}" está sendo gerado agora — espere terminar para apagar`
							: `o personagem "${ch.label}" tem pedido na fila ("${vivo.label}") — cancele o job ou espere para apagar`,
					code: "character-generating",
				});
				return true;
			}
			// Remove o personagem do array.
			s.characters.splice(idx, 1);
			// Remove todas as células com prefixo do personagem.
			for (const ck of Object.keys(s.cells)) {
				if (ck.startsWith(prefix)) delete s.cells[ck];
			}
			await save(s);
			// Remove assets em disco (assíncrono: melhor esforço, não trava o response).
			const assetDir = join(ASSETS, "wizard", b.characterId);
			rm(assetDir, { recursive: true, force: true }).catch(() => {});
			json(res, 200, { ok: true });
			return true;
		}

		if (url.pathname === "/api/characters/import" && req.method === "POST") {
			const b = await readBody<{ label?: string; bundle?: unknown }>(req);
			if (
				typeof b.label !== "string" ||
				b.label.trim() === "" ||
				b.bundle === undefined
			) {
				badRequest(res, "label e bundle são obrigatórios");
				return true;
			}
			try {
				// Personagem NOVO derivado de um bundle do estúdio (id = slug do
				// label; conflito de id é 400 nomeado pelo módulo). O wizard dele
				// nasce no estado que o bundle carrega: lab → direcoes8; wizard →
				// pronto + remoteId.
				const bundle = parseSpriteBundle(b.bundle);
				const { characterId } = await importSpriteBundle(
					store,
					bundle,
					{ kind: "new", label: b.label },
					ASSETS,
				);
				// A UI lê character.id — devolve o Character recém-criado.
				const s = await load();
				const created = s.characters.find((c) => c.id === characterId);
				if (!created) {
					throw new Error(
						`personagem "${characterId}" não encontrado após o import`,
					);
				}
				json(res, 200, created);
			} catch (err) {
				badRequest(res, err instanceof Error ? err.message : String(err));
			}
			return true;
		}

		// ---- pacote de projeto (ADR 0033) --------------------------------------------------
		if (url.pathname === "/api/project/export" && req.method === "POST") {
			const b = await readBody<{ map?: unknown; name?: unknown }>(req);
			let map: MapExportV2;
			try {
				map = projectMapOf(b.map);
			} catch (err) {
				badRequest(res, err instanceof Error ? err.message : String(err));
				return true;
			}
			const name =
				typeof b.name === "string" && b.name.trim() !== ""
					? b.name.trim()
					: "projeto";

			const s = await load();
			// Primeiro personagem do estúdio. Sem base fechada, o pacote segue
			// SEM personagem — degradação, não erro (ADR 0033).
			let character: WizardBundle | null = null;
			const first = s.characters[0];
			if (first) {
				try {
					character = await exportWizardBundle(store, first.id, ASSETS);
				} catch (err) {
					console.log(
						`[projeto] sem personagem no pacote: ${
							err instanceof Error ? err.message : String(err)
						}`,
					);
				}
			}

			// Hashes referenciados na palette do mapa → primeiro frame em base64.
			// Hash fora do formato (16 hex) ou sem PNG em disco é pulado: o mapa
			// do pacote continua válido e o destino cai no cubo procedural.
			const blocks: Record<string, string> = {};
			for (const p of map.palette) {
				const hash = p.sourceHash;
				if (typeof hash !== "string" || !isWorldBlockHash(hash)) continue;
				if (blocks[hash] !== undefined) continue;
				const b64 = await readBlockBasePng(ASSETS, hash);
				if (b64 !== null) blocks[hash] = b64;
			}

			json(res, 200, {
				version: 1,
				name,
				map,
				character,
				blocks,
				createdAt: new Date().toISOString(),
			} satisfies ProjectBundleV1);
			return true;
		}

		if (url.pathname === "/api/project/import" && req.method === "POST") {
			const b = await readBody<unknown>(req);
			try {
				// Validação TOTAL (schema + PNGs + chaves) antes da primeira
				// escrita — mesmo padrão dos outros imports.
				const bundle = parseProjectBundle(b);

				let characterId: string | null = null;
				if (bundle.character) {
					// Personagem NOVO com o nome do projeto — a mesma lógica de
					// POST /api/characters/import; conflito de id é erro nomeado.
					const { characterId: id } = await importSpriteBundle(
						store,
						bundle.character,
						{ kind: "new", label: bundle.name },
						ASSETS,
					);
					characterId = id;
				}

				let blockCount = 0;
				for (const [hash, b64] of Object.entries(bundle.blocks)) {
					await writeImportedBlock(ASSETS, hash, b64);
					blockCount += 1;
				}

				json(res, 200, { success: true, characterId, blockCount });
			} catch (err) {
				badRequest(res, err instanceof Error ? err.message : String(err));
			}
			return true;
		}

		// ---- poses -------------------------------------------------------------------------
		if (url.pathname === "/api/poses" && req.method === "POST") {
			const b = await readBody<{
				label?: string;
				kind?: PoseKind;
				templateId?: TemplateAnimation;
				action?: string;
				fps?: number;
				skeleton?: readonly Keypoint[];
				notes?: string;
			}>(req);
			const s = await load();
			// frameCount NÃO vem do cliente: é o lock do wizard que manda.
			const lock = s.lock;
			if (!lock) {
				badRequest(
					res,
					"trave a configuração do manequim primeiro — o frameCount das poses vem do lock (POST /api/wizard/config)",
				);
				return true;
			}
			if (
				typeof b.label !== "string" ||
				b.label.trim() === "" ||
				b.kind === undefined
			) {
				badRequest(res, "label e kind são obrigatórios");
				return true;
			}
			const pose: Pose = {
				id: slug(b.label),
				label: b.label,
				kind: b.kind,
				frameCount: lock.frameCount,
				fps: b.fps ?? lock.fps,
				...(b.templateId !== undefined ? { templateId: b.templateId } : {}),
				...(b.action !== undefined ? { action: b.action } : {}),
				...(b.skeleton !== undefined ? { skeleton: b.skeleton } : {}),
				...(b.notes !== undefined ? { notes: b.notes } : {}),
			};
			s.poses.push(pose);
			await save(s);
			json(res, 200, pose);
			return true;
		}

		if (url.pathname === "/api/poses" && req.method === "DELETE") {
			const b = await readBody<{ id: string }>(req);
			const s = await load();
			s.poses = s.poses.filter((p) => p.id !== b.id || p.builtin);
			await save(s);
			json(res, 200, { ok: true });
			return true;
		}

		// ---- wardrobe ------------------------------------------------------------------------
		if (url.pathname === "/api/wardrobe" && req.method === "POST") {
			const b = await readBody<Omit<WardrobeItem, "id" | "createdAt">>(req);
			const s = await load();
			const item: WardrobeItem = {
				...b,
				id: slug(b.label),
				createdAt: new Date().toISOString(),
			};
			s.wardrobe.push(item);
			await save(s);
			json(res, 200, item);
			return true;
		}

		// ---- generation ------------------------------------------------------------------------
		if (url.pathname === "/api/generate" && req.method === "POST") {
			const b = await readBody<{
				characterId?: string;
				poseId?: string;
				wardrobeId?: string;
			}>(req);
			const s = await load();
			const ch = s.characters.find((c) => c.id === b.characterId);
			if (!ch) {
				json(res, 404, { error: "personagem não encontrado" });
				return true;
			}

			if (b.wardrobeId !== undefined) {
				const item = s.wardrobe.find((w) => w.id === b.wardrobeId);
				if (!item) {
					json(res, 404, { error: "peça não encontrada" });
					return true;
				}
				const key = wardrobeKey(ch.id, item.id);
				// 'pronto' is terminal: answer without pre-marking or spawning —
				// overwriting the cell with 'gerando' would re-arm a paid generation.
				if (s.cells[key]?.status === "pronto") {
					json(res, 200, { key, status: "pronto" });
					return true;
				}
				// Pré-marca 'na-fila', não 'gerando': é a verdade, e a célula tem de
				// mudar ANTES do 202 — o espelho `syncJobCells` escreve depois, e
				// uma sondagem caindo nessa janela veria a célula vazia e ofereceria
				// o botão de gerar de novo sobre um pedido que já está na fila.
				s.cells[key] = {
					key,
					status: "na-fila",
					updatedAt: new Date().toISOString(),
				};
				await save(s);
				await enqueueAndRespond(res, {
					key,
					label: `${ch.label} · ${item.label}`,
					descriptor: {
						kind: "wardrobe",
						characterId: ch.id,
						wardrobeId: item.id,
					},
					cellKeys: [key],
				});
				return true;
			}

			// O fluxo v1 morreu: a base agora nasce no wizard, não nesta rota.
			if (b.poseId === undefined || b.poseId === "__base__") {
				badRequest(
					res,
					"o modelo base não é gerado por esta rota — use o wizard " +
						"(POST /api/wizard/south, /api/wizard/cardinals e /api/wizard/directions8)",
				);
				return true;
			}

			const pose = s.poses.find((p) => p.id === b.poseId);
			if (!pose) {
				json(res, 404, { error: "pose não encontrada" });
				return true;
			}
			const lock = s.lock;
			if (!lock) {
				badRequest(
					res,
					"trave a configuração do manequim primeiro — o frameCount das poses vem do lock (POST /api/wizard/config)",
				);
				return true;
			}
			const key = cellKey(ch.id, pose.id);
			// 'pronto' is terminal, same as the wardrobe branch above.
			if (s.cells[key]?.status === "pronto") {
				json(res, 200, { key, status: "pronto" });
				return true;
			}
			// Mesma pré-marcação 'na-fila' do ramo do guarda-roupa, pelo mesmo motivo.
			s.cells[key] = {
				key,
				status: "na-fila",
				updatedAt: new Date().toISOString(),
			};
			await save(s);
			await enqueueAndRespond(res, {
				key,
				label: `${ch.label} · ${pose.label}`,
				descriptor: { kind: "pose", characterId: ch.id, poseId: pose.id },
				cellKeys: [key],
			});
			return true;
		}

		json(res, 404, { error: "rota desconhecida" });
		return true;
	} catch (err) {
		json(res, 500, { error: err instanceof Error ? err.message : String(err) });
		return true;
	}
}
