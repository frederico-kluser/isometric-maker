/**
 * O modelo do painel da fila — módulo puro (sem React, sem DOM, sem fetch).
 *
 * ## Por que a decisão sai daqui e não do componente
 *
 * Não há jsdom nem testing-library neste repositório, e instalar não é opção.
 * O padrão já existe em oito lugares (`job-scope.ts`, `studio-recovery.ts`,
 * `wizard-progress.ts`, `item-state.ts`, …): a REGRA vira módulo puro e roda sob
 * `node --test`; o componente fica com DOM e fiação. Aqui a regra vale mais que
 * o de costume, porque duas das decisões deste arquivo são sobre DINHEIRO:
 *
 *   1. **Quando cancelar é grátis e quando não é.** `'na-fila'` com o registro
 *      limpo nunca foi submetido — cancelar não custa nada e não pede
 *      cerimônia. `'gerando'` já entrou em execução e a cobrança acontece na
 *      SUBMISSÃO: cancelar interrompe a espera e **não devolve o dinheiro**
 *      (`server/job-queue.ts`, `cancel()`). Essa distinção é a razão de a
 *      resposta do `DELETE /api/jobs/:key` trazer `paid`.
 *
 *      **Mas `'na-fila'` não implica registro limpo**, e a exceção é o caminho
 *      que o próprio painel recomenda: um job `'interrompido'`, `'falhou'` ou
 *      `'cancelado'` que ainda segura dinheiro (`holdsUnclaimedMoney`) é pedido
 *      de novo, e `enqueue` faz o registro NOVO **herdar `paid: true`**
 *      (`server/job-queue.ts`). O status volta ao começo; o dinheiro não. Por
 *      isso o grau sai de `(status, paid)`, nunca do status sozinho.
 *
 *   2. **`paid: false` não significa "de graça".** O executor só grava
 *      `paid: true` em dois dos sete ramos (`markPaid`), então um job `'gerando'`
 *      com `paid: false` é "não consta", nunca "não saiu". O cabeçalho de
 *      `server/job-queue.ts` diz isso com todas as letras, e o painel repete —
 *      por isso existem TRÊS graus de cancelamento e não dois.
 *
 * ## A ordem é a promessa da tela
 *
 * O usuário pediu "mandar várias gerações e gerenciar em FIFO". A ordem tem de
 * ser a mesma em duas telas abertas com o mesmo snapshot, e a ordem de iteração
 * de um objeto JSON não é contrato — então `buildQueueRows` ordena por chaves
 * EXPLÍCITAS e desempata sempre pela chave do job, que é única. Dois clientes
 * com o mesmo `GET /api/studio` mostram exatamente a mesma lista.
 *
 * O espelho dos tipos do servidor é intencional: a ROTA é a fronteira, e
 * `server/job-queue.ts` importa `node:fs`. Mesma regra de `studio-body.ts` e
 * `blocks-body.ts`.
 */
import { parseJobScope, type JobScope } from '../job-scope.ts';

// ------------------------------------------------------------------ vocabulário

/**
 * Os seis status de `JobStatus` (`server/job-queue.ts`). Os quatro primeiros
 * coincidem com `CellStatus`; `'cancelado'` e `'interrompido'` só existem na
 * fila.
 */
export type JobStatusView =
	| 'na-fila'
	| 'gerando'
	| 'pronto'
	| 'falhou'
	| 'cancelado'
	| 'interrompido';

export const JOB_STATUSES: readonly JobStatusView[] = [
	'na-fila',
	'gerando',
	'pronto',
	'falhou',
	'cancelado',
	'interrompido',
];

const JOB_STATUS_SET: ReadonlySet<string> = new Set<string>(JOB_STATUSES);

export function isJobStatus(value: unknown): value is JobStatusView {
	return typeof value === 'string' && JOB_STATUS_SET.has(value);
}

/** Os sete `JobKind` de `server/job-queue.ts`. */
export type JobKindView =
	| 'wizard-south'
	| 'wizard-south-edit'
	| 'wizard-directions8'
	| 'pose'
	| 'wardrobe'
	| 'sprite-lab'
	| 'world-block';

/**
 * Os dois únicos ramos do executor que recebem `ctx.signal` (`server/api.ts`,
 * na rota do DELETE). Nos outros cinco o cancelamento é IMEDIATO no registro e
 * o trabalho em voo continua até terminar sozinho — o job aparece
 * `'cancelado'` na hora e a vaga do semáforo só volta depois. Não custa
 * dinheiro; custa vaga, e a tela precisa dizer isso em vez de prometer uma
 * interrupção que não acontece.
 */
const ABORTS_FOR_REAL: ReadonlySet<string> = new Set<JobKindView>([
	'pose',
	'wardrobe',
]);

/** De onde saiu o teto de simultaneidade (`ConcurrencySource`). */
export type ConcurrencySourceView = 'option' | 'env' | 'tier' | 'default';

/** As quatro abas do estúdio (`src/app/shell.tsx`). */
export type StudioTab = 'wizard' | 'poses' | 'itens' | 'laboratorio';

// ------------------------------------------------------------------ entrada

/**
 * Espelho cliente de `StudioJobView` (`server/job-queue.ts`), com tudo opcional
 * menos o status.
 *
 * Opcional de propósito: `GET /api/studio` publicava um `Job` mais pobre antes
 * da fila, e uma tela que exige campo novo quebra contra um servidor antigo em
 * vez de degradar. Ausência vira "não sei", nunca um valor inventado.
 */
export interface QueueJobInput {
	readonly status: string;
	readonly label?: string;
	readonly message?: string;
	readonly kind?: string;
	readonly seq?: number;
	readonly startedAt?: number;
	readonly enqueuedAt?: string;
	/** 1 = próximo a entrar. Ausente quando o job não está mais na fila. */
	readonly queuePosition?: number;
	readonly paid?: boolean;
	readonly attempts?: number;
}

/** Espelho cliente de `QueueStats` (`server/job-queue.ts`). */
export interface QueueStatsInput {
	readonly queued?: number;
	readonly running?: number;
	readonly done?: number;
	readonly failed?: number;
	readonly cancelled?: number;
	readonly concurrency?: number;
	readonly concurrencySource?: string;
	readonly inFlightWeight?: number;
	readonly availableWeight?: number;
	readonly ratePerSecond?: number;
}

// ------------------------------------------------------------------ saída

/** Em que parte da lista o job entra. */
export type QueuePhase = 'running' | 'queued' | 'finished';

/**
 * Quanto custa cancelar ESTE job, decidido ANTES de o usuário confirmar.
 *
 *   `none`       — terminal: não há o que cancelar.
 *   `free`       — `'na-fila'` com `paid: false`: nunca foi submetido, nada saiu.
 *   `paid`       — `'gerando'` com `paid: true`: a cobrança JÁ aconteceu.
 *   `maybe-paid` — o registro acusa dinheiro que não bate com o status. São dois
 *                  casos: `'gerando'` com `paid: false` ("não consta" não é "de
 *                  graça") e `'na-fila'` com `paid: true` (pedido refeito que
 *                  herdou a cobrança do anterior).
 */
export type CancelKind = 'none' | 'free' | 'paid' | 'maybe-paid';

export interface QueueRow {
	readonly key: string;
	/** Rótulo pt-BR do job. Cai na chave quando o servidor não mandou um. */
	readonly label: string;
	readonly status: JobStatusView;
	readonly phase: QueuePhase;
	/** Posição FIFO (1 = próximo a entrar), ou `null` fora da fila. */
	readonly position: number | null;
	/** De quem é o job, lido da chave (`src/app/job-scope.ts`). */
	readonly scope: JobScope;
	/**
	 * O que o REGISTRO acusa (`job.paid`), sem interpretação. Não é o mesmo que
	 * `holdsMoney` (que já exclui o `'pronto'`, cujo dinheiro virou artefato):
	 * este é o dado bruto que decide o grau do cancelamento e o texto do
	 * resultado dele, porque o servidor não devolve `paid` no ramo de remoção.
	 */
	readonly paid: boolean;
	readonly cancel: CancelKind;
	/** false quando o cancelamento é imediato na tela e a vaga demora a voltar. */
	readonly abortsForReal: boolean;
	readonly message: string | null;
	/**
	 * `'interrompido'`: o servidor caiu com o job em voo, pode ter sido cobrado,
	 * e a fila NÃO refaz sozinha para não cobrar de novo. Exige decisão humana.
	 */
	readonly needsDecision: boolean;
	/** Terminal e sem artefato: a tela dona tem um botão de gerar de novo. */
	readonly canRetry: boolean;
	/** Dinheiro que saiu e ainda não virou artefato (`holdsUnclaimedMoney`). */
	readonly holdsMoney: boolean;
	readonly seq: number | null;
	readonly kind: JobKindView | null;
}

/** Contagens que o gatilho e o cabeçalho do painel mostram. */
export interface QueueSummary {
	readonly running: number;
	readonly queued: number;
	readonly finished: number;
	readonly interrupted: number;
	/** `running + queued` — o número que vai no gatilho da gaveta. */
	readonly active: number;
}

// ------------------------------------------------------------------ regras

/**
 * Quanto custa cancelar. Ver `CancelKind` — e note que o lado conservador é
 * sempre "pode ter custado": um status desconhecido não vira `free`.
 */
export function cancelKindFor(
	status: JobStatusView,
	paid: boolean,
): CancelKind {
	// 'na-fila' + paid é o pedido REFEITO que herdou a cobrança do registro
	// anterior (`enqueue`, `server/job-queue.ts`). Ele não está esperando a
	// primeira submissão: está esperando a SEGUNDA, e a primeira já saiu.
	if (status === 'na-fila') return paid ? 'maybe-paid' : 'free';
	if (status === 'gerando') return paid ? 'paid' : 'maybe-paid';
	return 'none';
}

/** O `AbortSignal` chega ao executor? Só em `pose` e `wardrobe`. */
export function abortsForReal(kind: string | undefined): boolean {
	return kind !== undefined && ABORTS_FOR_REAL.has(kind);
}

/** Qual aba do estúdio tem o botão que refaz este job. */
export function tabForScope(scope: JobScope): StudioTab | null {
	switch (scope.kind) {
		case 'wizard':
			return 'wizard';
		case 'pose':
			return 'poses';
		case 'wardrobe':
			return 'itens';
		case 'bench':
			return 'laboratorio';
		case 'unknown':
			return null;
	}
}

const PHASE_ORDER: Record<QueuePhase, number> = {
	running: 0,
	queued: 1,
	finished: 2,
};

function phaseOf(status: JobStatusView): QueuePhase {
	if (status === 'gerando') return 'running';
	if (status === 'na-fila') return 'queued';
	return 'finished';
}

/** Ausência ordena por último, nunca em primeiro. */
const LAST = Number.MAX_SAFE_INTEGER;

/**
 * A lista do painel, em ordem FIFO e determinística.
 *
 * Rodando primeiro (é o que está gastando agora), depois a fila na ordem em que
 * vai entrar, depois os encerrados do mais recente para o mais antigo. O
 * desempate final é sempre a chave, que é única — dois clientes com o mesmo
 * snapshot produzem exatamente a mesma lista, mesmo que o JSON tenha chegado com
 * as chaves em outra ordem.
 *
 * Um status que este cliente não conhece é DESCARTADO em vez de virar linha
 * muda: a fila só emite seis, e inventar uma sétima categoria na tela é pior que
 * omitir a linha (que continua no servidor e volta assim que a tela for
 * atualizada).
 */
export function buildQueueRows(
	jobs: Readonly<Record<string, QueueJobInput>> | undefined,
): readonly QueueRow[] {
	if (jobs === undefined) return [];
	const rows: QueueRow[] = [];
	for (const key of Object.keys(jobs)) {
		const job = jobs[key];
		if (job === undefined || !isJobStatus(job.status)) continue;
		const status = job.status;
		const paid = job.paid === true;
		const phase = phaseOf(status);
		rows.push({
			key,
			label: job.label ?? key,
			status,
			phase,
			position: phase === 'queued' ? (job.queuePosition ?? null) : null,
			scope: parseJobScope(key),
			paid,
			cancel: cancelKindFor(status, paid),
			abortsForReal: abortsForReal(job.kind),
			message: job.message ?? null,
			needsDecision: status === 'interrompido',
			canRetry: phase === 'finished' && status !== 'pronto',
			holdsMoney: paid && status !== 'pronto',
			seq: typeof job.seq === 'number' ? job.seq : null,
			kind: (job.kind as JobKindView | undefined) ?? null,
		});
	}
	rows.sort(compareRows);
	return rows;
}

function compareRows(a: QueueRow, b: QueueRow): number {
	const phase = PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase];
	if (phase !== 0) return phase;
	if (a.phase === 'queued') {
		const pos = (a.position ?? LAST) - (b.position ?? LAST);
		if (pos !== 0) return pos;
	}
	const seqA = a.seq ?? LAST;
	const seqB = b.seq ?? LAST;
	if (seqA !== seqB) {
		// Encerrado: o mais recente primeiro. Em voo: a ordem de chegada.
		return a.phase === 'finished' ? seqB - seqA : seqA - seqB;
	}
	return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export function summariseQueue(rows: readonly QueueRow[]): QueueSummary {
	let running = 0;
	let queued = 0;
	let finished = 0;
	let interrupted = 0;
	for (const row of rows) {
		if (row.phase === 'running') running += 1;
		else if (row.phase === 'queued') queued += 1;
		else finished += 1;
		if (row.needsDecision) interrupted += 1;
	}
	return { running, queued, finished, interrupted, active: running + queued };
}

/**
 * Fração do teto de admissão ocupada agora, em [0,1].
 *
 * É `inFlightWeight / concurrency`, e não `running / concurrency`: um
 * `sprite-lab` de 4 saídas ocupa 4 vagas. O número é uma ESTIMATIVA OTIMISTA —
 * entre o semáforo admitir e o job começar existe uma janela em que a barra
 * mostra folga que não existe (`server/job-queue.ts`, `#inFlightWeight`).
 */
export function occupancyShare(stats: QueueStatsInput | undefined): number {
	const ceiling = stats?.concurrency;
	const weight = stats?.inFlightWeight;
	if (typeof ceiling !== 'number' || ceiling <= 0) return 0;
	if (typeof weight !== 'number' || weight <= 0) return 0;
	return Math.min(1, weight / ceiling);
}

/** Origem do teto, ou `null` quando o servidor não disse. */
export function concurrencySourceOf(
	stats: QueueStatsInput | undefined,
): ConcurrencySourceView | null {
	const source = stats?.concurrencySource;
	return source === 'option' ||
		source === 'env' ||
		source === 'tier' ||
		source === 'default'
		? source
		: null;
}

// ------------------------------------------------------------------ cancelamento

/**
 * O que o `DELETE /api/jobs/:key` respondeu, já traduzido para o que o usuário
 * precisa saber sobre o dinheiro.
 */
export type CancelOutcome =
	/**
	 * Saiu da fila sem chegar a rodar NESTA passagem. `paid` vem do registro do
	 * cliente, não da resposta: um pedido refeito herda a cobrança do anterior,
	 * e aí "saiu da fila" não é "nada foi cobrado".
	 */
	| { readonly kind: 'removed'; readonly paid: boolean }
	/** Estava em execução: o dinheiro NÃO volta. `paid` diz se já consta. */
	| { readonly kind: 'aborted'; readonly paid: boolean }
	/** Chegou tarde: o job já tinha terminado sozinho. */
	| { readonly kind: 'already-finished'; readonly status: JobStatusView | null }
	/** Resposta que este cliente não sabe ler — o lado conservador. */
	| { readonly kind: 'unknown' };

/**
 * Lê o corpo do DELETE. Nunca lança, e nunca "arredonda para grátis": um corpo
 * ilegível vira `unknown`, cujo texto assume que a cobrança pode ter saído.
 *
 * As formas que o servidor emite (`server/api.ts`):
 *   `{ok, status:'cancelado', aborted:true,  paid:boolean}` → estava rodando
 *   `{ok, status:'cancelado', aborted:false, paid:false}`   → estava só na fila
 *   `{ok, status:<terminal>}`                                → já tinha acabado
 *
 * `aborted` só existe no caminho do cancelamento, então ele é lido PRIMEIRO: um
 * job que já estava `'cancelado'` responde `{ok, status:'cancelado'}` sem
 * `aborted`, e sem essa ordem essas duas respostas seriam indistinguíveis.
 *
 * ## Por que existe um segundo argumento
 *
 * O `paid: false` da segunda forma é **literal no servidor**: o ramo de remoção
 * responde `{aborted: false, paid: false}` sem consultar o registro. Para um
 * pedido refeito — que herdou `paid: true` de um job pago anterior — isso faria
 * a tela anunciar "nada foi cobrado" sobre dinheiro que saiu. O registro está do
 * lado do cliente (`studio.jobs[key].paid`, publicado em `QueueRow.paid`), então
 * é ele que entra aqui. As duas fontes se somam pelo lado conservador: se
 * qualquer uma acusa cobrança, houve.
 */
export function describeCancelOutcome(
	body: unknown,
	/** `paid` do registro do job, como a tela o viu no último snapshot. */
	registroPago = false,
): CancelOutcome {
	if (typeof body !== 'object' || body === null) return { kind: 'unknown' };
	const record = body as {
		aborted?: unknown;
		paid?: unknown;
		status?: unknown;
	};
	if (typeof record.aborted === 'boolean') {
		const pago = record.paid === true || registroPago;
		return record.aborted
			? { kind: 'aborted', paid: pago }
			: { kind: 'removed', paid: pago };
	}
	if (typeof record.status === 'string') {
		return {
			kind: 'already-finished',
			status: isJobStatus(record.status) ? record.status : null,
		};
	}
	return { kind: 'unknown' };
}
