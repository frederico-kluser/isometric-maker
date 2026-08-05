/**
 * Fila de jobs persistente do character-builder.
 *
 * O QUE ESTE MÓDULO RESOLVE
 *
 * Hoje `server/api.ts` tem `spawn(key, label, work)`: grava `{status:'gerando'}`
 * num `Map` volátil e dispara `void (async()=>{})()` na hora. Três defeitos saem
 * daí, e são os três que este módulo existe para fechar:
 *
 *   1. **Não há admissão.** Seis poses viram seis submissões simultâneas, cada
 *      uma sondando oito direções — 48 requisições concorrentes contra um teto
 *      de conta que rende 429. O único lugar do produto que reconhece o limite é
 *      `server/sprite-lab.ts`, que trava `outputs` em 1–4.
 *   2. **O job não sabe o que rodar.** Só o closure sabe, e o closure morre com
 *      o processo. Aqui o job carrega um DESCRITOR serializável — um worker
 *      redespacha lendo o disco.
 *   3. **O registro é volátil.** Editar qualquer `server/*.ts` reinicia o Vite
 *      (o `vite.config.ts` importa `api.ts`) e mata geração em voo — ADR 0023
 *      registrou isso depois de custar uma geração paga. Aqui o estado vai a
 *      disco por escrita atômica.
 *
 * A INVARIANTE DE DINHEIRO (ADR 0012, ADR 0023)
 *
 * "Money leaves on submit, value arrives on download." Entre esses dois
 * momentos o identificador remoto é a única coisa entre nós e pagar duas vezes.
 * Por isso o executor recebe `ctx.markPaid(...)`, que persiste `paid: true` mais
 * os identificadores ANTES do primeiro poll, e por isso um job com `paid: true`
 * NUNCA é retentado automaticamente: retomar é re-sondar, jamais ressubmeter.
 *
 * A JANELA QUE ESTA CAMADA NÃO FECHA — CONTRATO PARA QUEM ESCREVE O EXECUTOR
 *
 * Entre o `submit` do executor e o `await ctx.markPaid(...)` existe um intervalo
 * em que o dinheiro JÁ SAIU e o disco ainda diz `paid: false`. Se o processo
 * morrer aí (o Vite reinicia sozinho ao salvar qualquer `server/*.ts` — ADR
 * 0023), a fila reabre um job cobrado marcado como grátis, e NÃO TEM COMO SABER
 * disso: nada do que ela observa distingue "nunca submeteu" de "submeteu e
 * morreu antes de anotar".
 *
 * A janela é irredutível nesta camada, e — isto NÃO foi verificado contra o
 * fornecedor — provavelmente em qualquer outra: o identificador só existe DEPOIS
 * da submissão, então não há o que gravar antes dela. Só uma chave de
 * idempotência aceita pelo fornecedor fecharia o buraco de verdade, e o spec
 * vendorizado não foi consultado sobre isso.
 *
 * O que o executor tem de fazer, e a fila não pode fazer por ele:
 *
 *   1. Gravar o stub de retomada assim que a resposta da submissão chegar, antes
 *      de qualquer poll ou download — é o que `world-block.ts` faz com
 *      `v3StubPath`/`tileStubPath`. Isso encolhe a janela ao mínimo possível.
 *   2. Ao receber um job com `paid: false`, PROCURAR esse stub antes de
 *      ressubmeter. `paid: false` significa "não consta", nunca "é de graça".
 *
 * Por isso o log de retomada declara a incerteza em vez de afirmar que nada foi
 * gasto: ver `#reconcile`.
 *
 * O módulo é PURO: nada acontece ao importar, nenhum cliente real é criado, e o
 * executor entra por injeção. Ele também não escreve célula nenhuma no
 * `studio.json` — quem faz a fiação com o estúdio é `server/api.ts`.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
	AdaptiveLimiter,
	WeightedSemaphore,
	concurrencyFor,
} from "../../pixellab-pipeline/src/queue.ts";
import { TIER_CONCURRENCY } from "../../pixellab-pipeline/src/cost.ts";
import type { Tier } from "../../pixellab-pipeline/src/cost.ts";
import type { EndpointId } from "../../pixellab-pipeline/src/endpoints.ts";
import type { CellStatus } from "./model.ts";
import type { SpriteLabConfig } from "./sprite-lab.ts";
import type { WorldBlockConfig } from "./world-block.ts";

// ---------------------------------------------------------------- descritores

/**
 * As sete formas de trabalho que o estúdio dispara hoje, conferidas nos sete
 * call sites de `spawn` em `server/api.ts`:
 *
 * | Rota                          | linha | descritor            |
 * |-------------------------------|-------|----------------------|
 * | POST /api/wizard/south        | 1077  | `wizard-south`       |
 * | POST /api/wizard/south/edit   | 1107  | `wizard-south-edit`  |
 * | POST /api/wizard/directions8  | 1177  | `wizard-directions8` |
 * | POST /api/sprite-lab          | 1340  | `sprite-lab`         |
 * | POST /api/world-block         | 1425  | `world-block`        |
 * | POST /api/generate (peça)     | 1926  | `wardrobe`           |
 * | POST /api/generate (pose)     | 1968  | `pose`               |
 *
 * Cada variante carrega o mínimo para REDESPACHAR a partir do disco. Ids de
 * entidade do estúdio (personagem, pose, peça) em vez de objetos inteiros: o
 * `studio.json` é a fonte da verdade deles e pode ter mudado entre o
 * enfileiramento e a execução. Já `sprite-lab` e `world-block` NÃO têm entidade
 * no estúdio — a config é o próprio pedido e vai inteira, junto do hash que a
 * identifica em disco.
 */
export type JobDescriptor =
	| {
			readonly kind: "wizard-south";
			readonly characterId: string;
			/** Prompt da sul. O módulo relê o personagem, mas não o texto do pedido. */
			readonly description: string;
			/** Referência de cor explícita do cliente, quando houve. */
			readonly colorImageB64?: string;
	  }
	| {
			readonly kind: "wizard-south-edit";
			readonly characterId: string;
			readonly prompt: string;
	  }
	| { readonly kind: "wizard-directions8"; readonly characterId: string }
	| {
			readonly kind: "pose";
			readonly characterId: string;
			readonly poseId: string;
	  }
	| {
			readonly kind: "wardrobe";
			readonly characterId: string;
			readonly wardrobeId: string;
	  }
	| {
			readonly kind: "sprite-lab";
			readonly hash: string;
			readonly config: SpriteLabConfig;
	  }
	| {
			readonly kind: "world-block";
			readonly hash: string;
			readonly config: WorldBlockConfig;
	  };

export type JobKind = JobDescriptor["kind"];

export const JOB_KINDS: readonly JobKind[] = [
	"wizard-south",
	"wizard-south-edit",
	"wizard-directions8",
	"pose",
	"wardrobe",
	"sprite-lab",
	"world-block",
];

// ---------------------------------------------------------------- estado do job

/**
 * O status do job. Os quatro primeiros são exatamente os de `CellStatus`
 * (`server/model.ts`), incluindo `'na-fila'`, que já existe no modelo e que a UI
 * já renderiza (`poses/cell-view.tsx`, `poses/generate-button.tsx`,
 * `itens/item-state.ts`, `wizard/wizard-progress.ts`) — e que hoje NINGUÉM
 * escreve. É o encaixe pronto para o estado enfileirado.
 */
export type JobStatus =
	| "na-fila"
	| "gerando"
	| "pronto"
	| "falhou"
	| "cancelado";

/** Estados dos quais um job não sai sozinho. */
const TERMINAL: ReadonlySet<JobStatus> = new Set<JobStatus>([
	"pronto",
	"falhou",
	"cancelado",
]);

/**
 * O conjunto fechado dos status válidos. Existe para a leitura do disco: um
 * status fora desta lista não é um estado a mais, é um job INVISÍVEL — fora de
 * `TERMINAL`, fora de `pending()` e fora de `running()`, portanto nunca drenado,
 * nunca podado e nunca mostrado como pendência.
 */
const JOB_STATUSES: ReadonlySet<string> = new Set<JobStatus>([
	"na-fila",
	"gerando",
	"pronto",
	"falhou",
	"cancelado",
]);

/**
 * O caminho de volta ao artefato pago (ADR 0023, regra 1). Gravado no momento
 * da submissão, antes de qualquer poll — sem ele, uma geração cobrada cujo
 * download falhou é dinheiro perdido.
 */
export interface RemoteHandle {
	/** `background_job_id`. Animação devolve um POR DIREÇÃO. */
	readonly jobIds?: readonly string[];
	/** `character_id` — a v3 só entrega pixels em `GET /characters/{id}`. */
	readonly characterId?: string;
	/** `tile_id`, `object_id`… para as famílias com poll por recurso. */
	readonly resourceId?: string;
	/** Texto livre para o worker anotar onde ficou o stub de retomada. */
	readonly note?: string;
}

export interface QueuedJob {
	/** Chave de deduplicação. Hoje é a chave de célula, ou `sprite-lab::<hash>`. */
	readonly key: string;
	/** Rótulo em pt-BR que a UI mostra. */
	readonly label: string;
	/**
	 * Número de chegada, monótono e persistido. É ELE que define o FIFO — não a
	 * ordem de iteração de objeto, que o V8 reordena para chaves numéricas, e
	 * não o relógio, que pode empatar ou andar para trás.
	 */
	readonly seq: number;
	readonly enqueuedAt: string;
	readonly descriptor: JobDescriptor;
	/** Células canônicas que a UI lê para este job. Vazio para as bancadas. */
	readonly cellKeys: readonly string[];
	status: JobStatus;
	attempts: number;
	/**
	 * `true` a partir da submissão: O DINHEIRO JÁ SAIU. Um job pago nunca é
	 * retentado nem ressubmetido — só re-sondado.
	 */
	paid: boolean;
	startedAt?: number;
	finishedAt?: number;
	message?: string;
	remote?: RemoteHandle;
	/** Veio de um reinício do servidor: já rodou uma vez e foi interrompido. */
	resumed?: boolean;
}

interface PersistedState {
	readonly version: 1;
	nextSeq: number;
	jobs: QueuedJob[];
	updatedAt: string;
}

const STATE_VERSION = 1;

// ---------------------------------------------------------------- execução

export interface JobContext {
	readonly job: Readonly<QueuedJob>;
	/**
	 * Abortado por `cancel()` e por `close({abortRunning:true})`. O transporte
	 * do pipeline aceita `AbortSignal` (`pixellab-pipeline/src/api.ts`), e
	 * `pollJob` também — repassar este signal é o que torna o cancelamento real
	 * em vez de cosmético.
	 */
	readonly signal: AbortSignal;
	/**
	 * Chame IMEDIATAMENTE após a submissão, e AGUARDE, antes do primeiro poll.
	 * Persiste `paid: true` e os identificadores remotos. A partir daqui o job
	 * nunca mais é retentado automaticamente.
	 */
	markPaid(remote?: RemoteHandle): Promise<void>;
	/** Log injetado. Nunca escreva em `console` direto — ver `onLog` abaixo. */
	log(message: string): void;
}

export type JobExecutor = (ctx: JobContext) => Promise<void>;

/** Como a fila deve reagir a uma exceção do executor. */
export type FailureKind = "fatal" | "retry" | "rate-limited";

// ---------------------------------------------------------------- configuração

/**
 * Teto de admissão quando ninguém declarou um. **Oito chamadas simultâneas.**
 *
 * O QUE ESTE NÚMERO É, E O QUE ELE NÃO É
 *
 * A unidade do teto é CHAMADA SIMULTÂNEA À API, não job — ver
 * `weightForDescriptor`. Um `sprite-lab` com `outputs: 4` conta 4, porque
 * dispara quatro `create-character-v3` ao mesmo tempo dentro de um job só.
 *
 * **MEDIDO (uma única observação, desta conta, gravada no código):**
 * `server/sprite-lab.ts` trava `outputs` em 1–4 com a mensagem
 * `Acima de 4 a v3 responde 429 "Concurrency limit reached"`. Ou seja: quatro
 * `create-character-v3` concorrentes passam, cinco não. É o único número medido
 * que este repositório tem, e ele fala de UM endpoint — o mais pesado de todos
 * (2–9 gerações por chamada).
 *
 * **DOCUMENTADO PELO FORNECEDOR (e não se aplica a nós sem confirmação):** o
 * tier de US$ 50/mês declara "até 20 jobs simultâneos". `docs/01-pixellab/
 * custos-e-limites.md:176` é explícito sobre o resto: *"a concorrência dos
 * tiers menores não está documentada e precisa ser medida"*. Os valores
 * `free: 1, t1: 2, t2: 4` de `TIER_CONCURRENCY` são MODELO DO PROJETO, não
 * número lido do fornecedor. Em qual tier esta conta está **não foi
 * verificado**.
 *
 * **INFERIDO (é daqui que sai o 8):** dobrar a medição da família mais pesada
 * para uma carga MISTA. O job típico do editor não é `create-character-v3` — é
 * `animate-character` em `mode='template'` (1 geração por direção) ou
 * `create-isometric-tile`. Admitir oito chamadas concorrentes de trabalho leve
 * onde quatro de trabalho pesado passaram é aposta deliberada, não medição, e
 * 8 é também o tamanho do lote natural do editor: as oito direções, as oito
 * poses que o usuário dispara de uma vez.
 *
 * **POR QUE ERRAR PARA CIMA É O LADO BARATO.** Um 429 na submissão custa
 * US$ 0,00: a chamada foi RECUSADA, nada foi gerado, nada foi cobrado — o
 * dinheiro só sai numa submissão aceita. `classifyByStatus` marca 429 como
 * `rate-limited`, `#handleFailure` devolve o job à fila (ele não está `paid`) e
 * o `AdaptiveLimiter` corta a taxa da FILA INTEIRA pela metade. O custo de
 * admitir demais é lentidão e uma retentativa. O custo de admitir de menos é
 * exatamente a reclamação que originou esta onda: com o `t2` = 4 anterior, e
 * com os pesos vindos da `COST_TABLE`, um `sprite-lab` admitia UM por vez e um
 * `wardrobe` rodava sozinho — MENOS simultaneidade que o servidor sem limite
 * nenhum que ele substitui. Isso é regressão medida, não percebida.
 *
 * `CHARACTER_BUILDER_JOB_CONCURRENCY` e `PIXELLAB_TIER` continuam mandando
 * sempre que presentes: quem sabe o limite da conta declara, e a declaração
 * substitui esta aposta. Note que declarar `PIXELLAB_TIER=t2` DIMINUI o teto
 * para 4, e isso está certo — é o número da conta contra o palpite do editor.
 */
export const DEFAULT_CONCURRENCY = 8;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_HISTORY_LIMIT = 200;
/**
 * Tokens por segundo do limitador. Jobs levam minutos, então isto não limita
 * nada em regime normal; ele existe para que um 429 (`penalise()` divide a taxa
 * pela metade, piso 0,2/s) desacelere a FILA INTEIRA, não só o job que tomou o
 * erro. Sem isso, N workers retentando em paralelo mantêm a conta permanentemente
 * limitada.
 */
export const DEFAULT_RATE_PER_SECOND = 2;

export interface JobQueueOptions {
	/** Arquivo JSON do estado. Ver `defaultStatePath`. */
	readonly statePath: string;
	readonly execute: JobExecutor;
	/** Teto de admissão. Ver `resolveConcurrency`. */
	readonly concurrency?: number;
	/** Peso de admissão do job. Default: `weightForDescriptor`. */
	readonly weightOf?: (descriptor: JobDescriptor) => number;
	/**
	 * Recheque de idempotência AVALIADO NA DRENAGEM, não no enfileiramento: um
	 * job parado dez minutos na fila pode ter virado redundante (a célula ficou
	 * 'pronto', o hash apareceu em disco). Devolver `false` conclui o job sem
	 * chamar o executor e sem gastar.
	 *
	 * OBRIGATÓRIO, e de propósito. O default anterior era `() => true`, isto é,
	 * "sempre execute" — a direção do GASTO — e um chamador que esquecesse de
	 * passá-lo transformava o recheque em no-op sem aviso, sem erro e sem teste
	 * que percebesse. Num módulo que gasta dinheiro real, a omissão tem de doer
	 * no compilador, não na fatura. Quem de fato não tem o que rechecar escreve
	 * `() => true` explicitamente, e a decisão fica no código de quem a tomou.
	 */
	readonly stillNeeded: (job: Readonly<QueuedJob>) => boolean | Promise<boolean>;
	/** Default: `classifyByStatus`. */
	readonly classifyError?: (
		err: unknown,
		job: Readonly<QueuedJob>,
	) => FailureKind;
	/** Relógio injetável — testes de tempo não podem depender de parede. */
	readonly now?: () => number;
	/** Espera injetável, pelo mesmo motivo. */
	readonly sleep?: (ms: number) => Promise<void>;
	/**
	 * Log injetado, default no-op. `server/api.test.ts` desvia `console.log`
	 * para stderr porque log de job em background corrompe o protocolo TAP do
	 * `node --test`; um worker que logasse direto cairia nessa armadilha.
	 */
	readonly onLog?: (message: string) => void;
	/** Notificado a cada transição de status — a fiação com as células mora aqui. */
	readonly onChange?: (job: Readonly<QueuedJob>) => void;
	/** Tentativas por job, contando a primeira. Só vale para job NÃO pago. */
	readonly maxAttempts?: number;
	/** Quantos jobs terminais o histórico guarda antes de podar os mais antigos. */
	readonly historyLimit?: number;
	readonly ratePerSecond?: number;
}

/**
 * Onde o estado mora. Segue o idioma de seam de teste do repo —
 * `CHARACTER_BUILDER_STUDIO_JSON` e `CHARACTER_BUILDER_ASSETS_DIR` são os
 * precedentes, ambos em `server/api.ts`.
 */
export function defaultStatePath(
	env: Record<string, string | undefined> = process.env,
	root: string = new URL("..", import.meta.url).pathname,
): string {
	return env["CHARACTER_BUILDER_JOB_QUEUE_JSON"] ?? join(root, "job-queue.json");
}

function isTier(value: string): value is Tier {
	return Object.hasOwn(TIER_CONCURRENCY, value);
}

/**
 * De onde veio o teto que está valendo. Existe para a tela: "4 simultâneas"
 * significa coisas diferentes quando é o palpite do editor e quando é o tier
 * que o usuário declarou, e a UI da onda seguinte precisa poder dizer qual.
 */
export type ConcurrencySource =
	/** Passado direto em `JobQueueOptions.concurrency` (testes, e a fiação de api.ts). */
	| "option"
	/** `CHARACTER_BUILDER_JOB_CONCURRENCY`. */
	| "env"
	/** `PIXELLAB_TIER`, resolvido por `TIER_CONCURRENCY`. */
	| "tier"
	/** `DEFAULT_CONCURRENCY` — ninguém declarou nada. */
	| "default";

export interface ConcurrencyDecision {
	readonly limit: number;
	readonly source: ConcurrencySource;
	/** Preenchido só quando `source === 'tier'`. */
	readonly tier?: Tier;
}

/**
 * Teto de admissão, em ordem de precedência:
 *
 *   1. `CHARACTER_BUILDER_JOB_CONCURRENCY` — inteiro ≥ 1, override direto.
 *   2. `PIXELLAB_TIER` — free|t1|t2|t3, a mesma variável que o CLI do pipeline
 *      já lê (`pixellab-pipeline/src/cli.ts`), resolvida por `TIER_CONCURRENCY`.
 *   3. `DEFAULT_CONCURRENCY` = 8 — ver lá o que é medido e o que é inferido.
 *
 * O teto é DA CONTA PixelLab, não nosso: passar dele rende 429. Só `t3` (20) é
 * número que o fornecedor documenta; os outros três são o modelo do projeto
 * (`pixellab-pipeline/src/cost.ts`), e `docs/01-pixellab/custos-e-limites.md:176`
 * diz literalmente que a concorrência dos tiers menores "precisa ser medida".
 */
export function resolveConcurrencyDecision(
	env: Record<string, string | undefined> = process.env,
): ConcurrencyDecision {
	const raw = env["CHARACTER_BUILDER_JOB_CONCURRENCY"];
	if (raw !== undefined && raw.trim() !== "") {
		const n = Number(raw);
		if (Number.isInteger(n) && n >= 1) return { limit: n, source: "env" };
	}
	const tier = env["PIXELLAB_TIER"];
	if (tier !== undefined && isTier(tier)) {
		return { limit: concurrencyFor(tier), source: "tier", tier };
	}
	return { limit: DEFAULT_CONCURRENCY, source: "default" };
}

/** O mesmo, quando só o número interessa. */
export function resolveConcurrency(
	env: Record<string, string | undefined> = process.env,
): number {
	return resolveConcurrencyDecision(env).limit;
}

/**
 * Endpoint que domina o custo de cada tipo de job. **Não é mais a fonte do
 * peso** — ver `weightForDescriptor` logo abaixo.
 *
 * POR QUE O EXPORT CONTINUA AQUI, honestamente: hoje ele tem UM consumidor, e é
 * o teste. `job-queue.test.ts` reconstrói com ele o modelo de peso ANTIGO
 * (`pesoAntigo = weightFor(ENDPOINT_BY_KIND[kind])`), que é o braço "ANTES" da
 * comparação de cada critério de aceitação desta onda — assim os números do
 * "antes" saem da mesma `COST_TABLE` que os produzia, em vez de copiados à mão,
 * e mudam junto se a tabela do pipeline mudar. `grep -rn ENDPOINT_BY_KIND
 * tools/` devolve exatamente este arquivo e aquele teste: **nenhuma estimativa
 * e nenhum relatório o consomem**. Se um dia a comparação antes/depois sair do
 * teste, este export sai junto.
 *
 * Uma aproximação registrada: `wizard-south-edit` chama `edit-image`, que não
 * está na `COST_TABLE` do pipeline; `mannequin.ts` já estima esse passo por
 * proxy do `create-image-bitforge`, e aqui se usa o mesmo proxy.
 */
export const ENDPOINT_BY_KIND: Readonly<Record<JobKind, EndpointId>> = {
	"wizard-south": "create-image-bitforge",
	"wizard-south-edit": "create-image-bitforge",
	"wizard-directions8": "create-character-v3",
	pose: "animate-character",
	wardrobe: "create-character-state",
	"sprite-lab": "create-character-v3",
	"world-block": "create-isometric-tile",
};

/**
 * Teto de candidatos paralelos da bancada de sprites. `sprite-lab.ts` valida
 * `outputs` em 1–4 e a mensagem diz por quê: *"Acima de 4 a v3 responde 429
 * Concurrency limit reached"*. O peso clampa no mesmo número para que um
 * arquivo de estado editado à mão não invente um peso de 99.
 */
export const SPRITE_LAB_MAX_PARALLEL_CALLS = 4;

/**
 * Chamadas simultâneas da técnica `chained` do bloco de mundo: a face NORTE sai
 * primeiro, sozinha, e as três irmãs saem juntas num `Promise.all`
 * (`server/world-block.ts`, "As outras três em paralelo"). O pico é 3.
 */
export const WORLD_BLOCK_CHAINED_PARALLEL_CALLS = 3;

/**
 * **Peso de admissão = pico de CHAMADAS SIMULTÂNEAS que o job faz à API.**
 *
 * POR QUE MUDOU. O peso vinha de `COST_TABLE[...].concurrencyWeight` via
 * `weightFor`, e aquela coluna foi calibrada para o CLI do pipeline, cujo
 * padrão de fan-out é outro: lá um item do catálogo é UMA chamada, e o peso
 * expressa "quanto de servidor esta chamada consome" (`create-character-pro`
 * pesa 6 porque custa 20–40 gerações). Aqui um job pode ser QUATRO chamadas —
 * e o semáforo contava jobs enquanto a PixelLab conta chamadas. As duas
 * consequências, ambas erradas na mesma direção:
 *
 *   - `wardrobe` pesava 6 num teto de 4: clampado, rodava SEMPRE sozinho,
 *     mesmo fazendo uma única chamada;
 *   - `sprite-lab` pesava 3 num teto de 4: um por vez, fizesse ele 1 ou 4
 *     chamadas — o `outputs` do usuário não mudava nada.
 *
 * O DESCRITOR CARREGA O CONFIG, então onde o fan-out é conhecido o peso é
 * função dele:
 *
 * | kind                 | peso                    | de onde sai o número |
 * |----------------------|-------------------------|----------------------|
 * | `sprite-lab`         | `config.outputs` (1–4)  | `Promise.all` sobre `outputs` candidatos, cada um um `create-character-v3` |
 * | `world-block`        | 3 em `chained`, 1 nas outras | `chained` faz norte + `Promise.all` das 3 irmãs; `texture` e `rotated` são seriais |
 * | `pose`               | 1                       | UMA submissão `animate-character` |
 * | `wardrobe`           | 1                       | UMA submissão `create-character-state` |
 * | `wizard-south`       | 1                       | UMA submissão |
 * | `wizard-south-edit`  | 1                       | UMA submissão |
 * | `wizard-directions8` | 1                       | UMA submissão `create-character-v3` |
 *
 * AS APROXIMAÇÕES, E O ERRO QUE ELAS PODEM TER — as duas são declaradas porque
 * nenhuma foi verificada contra o fornecedor:
 *
 * 1. **`pose` pode valer muito mais que 1, e não temos como saber.** Uma
 *    submissão de `animate-character` cria um background job POR DIREÇÃO (até
 *    oito) do lado do servidor, e `server/api.ts` faz um `pollJob` por direção
 *    em paralelo. Se o teto da conta contar JOBS DO SERVIDOR em vez de
 *    submissões nossas, oito poses concorrentes são 64 jobs e o 429 é certo.
 *    Contamos submissões porque é a unidade em que a única evidência medida
 *    fala (4 `create-character-v3` concorrentes passam) e porque o servidor de
 *    hoje já dispara essas poses sem limite nenhum: adotar o outro modelo
 *    entregaria MENOS que o estado atual. **Erro possível: subestimar `pose`
 *    por um fator de até 8.** O sintoma é 429 com o `AdaptiveLimiter`
 *    derrubando a taxa da fila — e não custa dinheiro, porque submissão
 *    recusada não gera nada.
 * 2. **`sprite-lab` e `world-block` contam o pico, não o instante.** Um
 *    candidato que já está em disco resolve sem chamada (`sprite-lab.ts` checa
 *    o PNG antes de submeter), então um job de peso 4 pode fazer zero chamadas.
 *    **Erro: superestimar em até o peso inteiro**, o que só desperdiça vaga —
 *    o lado barato.
 *
 * O peso nunca é zero: um job desconhecido, ou com config adulterada, vale 1.
 */
export function weightForDescriptor(descriptor: JobDescriptor): number {
	switch (descriptor.kind) {
		case "sprite-lab": {
			const outputs = descriptor.config.outputs;
			if (!Number.isInteger(outputs) || outputs < 1) return 1;
			return Math.min(outputs, SPRITE_LAB_MAX_PARALLEL_CALLS);
		}
		case "world-block":
			// `technique` ausente é 'chained' — o mesmo default de
			// `runWorldBlock`, e o único caminho com fan-out.
			return (descriptor.config.technique ?? "chained") === "chained"
				? WORLD_BLOCK_CHAINED_PARALLEL_CALLS
				: 1;
		case "wizard-south":
		case "wizard-south-edit":
		case "wizard-directions8":
		case "pose":
		case "wardrobe":
			return 1;
	}
}

/**
 * Classificação default de exceção, por duck typing do campo `status` —
 * `PixelLabError` o expõe, e não importá-lo mantém este módulo puro e testável
 * sem rede.
 *
 * 429 ("Too many concurrent jobs") e 529 ("Rate limit exceeded", NÃO-padrão e
 * ignorado pela maioria dos clientes HTTP) desaceleram a fila. 400/401/403/404/
 * 422 nunca são retentados: validação é bug nosso, e retentar só queima cota.
 */
export function classifyByStatus(err: unknown): FailureKind {
	const status = (err as { status?: unknown } | null | undefined)?.status;
	if (typeof status !== "number") return "fatal";
	if (status === 429 || status === 529) return "rate-limited";
	if (status === 408 || status === 425 || (status >= 500 && status <= 504)) {
		return "retry";
	}
	return "fatal";
}

/**
 * Status de job → status de célula. `'cancelado'` não existe em `CellStatus`, e
 * devolver a célula a `'vazio'` é o que a rota `DELETE /api/jobs/:key` já faz
 * hoje (ela apaga a célula não-pronta).
 */
export function cellStatusFor(status: JobStatus): CellStatus {
	switch (status) {
		case "na-fila":
			return "na-fila";
		case "gerando":
			return "gerando";
		case "pronto":
			return "pronto";
		case "falhou":
			return "falhou";
		case "cancelado":
			return "vazio";
	}
}

// ---------------------------------------------------------------- resultados

export type EnqueueOutcome =
	| { readonly accepted: true; readonly job: QueuedJob; readonly position: number }
	| {
			readonly accepted: false;
			readonly reason: "duplicate" | "closed";
			readonly job?: QueuedJob;
	  };

export type CancelOutcome =
	/** Estava na fila e nunca rodou: nada foi gasto. */
	| { readonly result: "removed"; readonly job: QueuedJob }
	/** Já estava rodando: o signal foi abortado. NÃO devolve dinheiro. */
	| { readonly result: "aborted"; readonly job: QueuedJob; readonly paid: boolean }
	| { readonly result: "already-finished"; readonly job: QueuedJob }
	| { readonly result: "not-found" };

export interface QueueStats {
	readonly queued: number;
	readonly running: number;
	readonly done: number;
	readonly failed: number;
	readonly cancelled: number;
	/**
	 * Teto EFETIVO de chamadas simultâneas, já resolvido — não o default, não o
	 * tier: o número que o semáforo está usando agora.
	 */
	readonly concurrency: number;
	/** De onde esse número veio. Ver `ConcurrencySource`. */
	readonly concurrencySource: ConcurrencySource;
	/**
	 * Ocupação: soma dos pesos dos jobs em voo. É esta a fração que enche o
	 * teto, e ela NÃO é `running` — um `sprite-lab` de `outputs: 4` conta 4.
	 */
	readonly inFlightWeight: number;
	/**
	 * `concurrency - inFlightWeight`, nunca negativo. É uma **estimativa
	 * otimista** de vaga livre, não o disponível real do semáforo: entre o
	 * permite ser adquirido e o job de fato começar existe uma janela em que o
	 * semáforo já está mais cheio do que este número diz. Ver `#inFlightWeight`
	 * para a medição e o porquê de não haver número exato.
	 */
	readonly availableWeight: number;
	/** Taxa corrente do limitador — cai pela metade a cada 429. */
	readonly ratePerSecond: number;
}

/**
 * A projeção que `GET /api/studio` publica. É um superconjunto do `Job` que
 * `server/api.ts` expõe hoje (`key`, `label`, `status`, `message?`,
 * `startedAt`), então a UI existente continua lendo sem mudança.
 */
export interface StudioJobView {
	readonly key: string;
	readonly label: string;
	readonly status: JobStatus;
	readonly message?: string;
	readonly startedAt: number;
	readonly kind: JobKind;
	readonly seq: number;
	readonly enqueuedAt: string;
	/** 1 = próximo a entrar. Ausente quando o job não está mais na fila. */
	readonly queuePosition?: number;
	readonly paid: boolean;
	readonly attempts: number;
}

// ---------------------------------------------------------------- a fila

export class JobQueue {
	readonly #statePath: string;
	readonly #execute: JobExecutor;
	readonly #weightOf: (descriptor: JobDescriptor) => number;
	readonly #stillNeeded: (job: Readonly<QueuedJob>) => boolean | Promise<boolean>;
	readonly #classify: (err: unknown, job: Readonly<QueuedJob>) => FailureKind;
	readonly #now: () => number;
	readonly #sleep: (ms: number) => Promise<void>;
	readonly #log: (message: string) => void;
	readonly #onChange: (job: Readonly<QueuedJob>) => void;
	readonly #maxAttempts: number;
	readonly #historyLimit: number;
	readonly #concurrency: number;
	readonly #concurrencySource: ConcurrencySource;
	readonly #semaphore: WeightedSemaphore;
	readonly #limiter: AdaptiveLimiter;
	readonly #controllers = new Map<string, AbortController>();
	readonly #inFlight = new Set<Promise<void>>();
	readonly #idleWaiters: (() => void)[] = [];

	#state: PersistedState;
	/** Corrente de escrita: um temp+rename por vez. Ver `#flush`. */
	#writeChain: Promise<void> = Promise.resolve();
	#loopActive = false;
	#closed = false;
	/**
	 * Soma dos pesos **confirmadamente** em voo — ou seja, de jobs que `#start`
	 * já admitiu e que ainda estão executando. É a ocupação que `stats()`
	 * publica. Sobe em `#start`, o único ponto que admite, e desce no `finally`
	 * de `#run`, no mesmo lugar que devolve o permite.
	 *
	 * ELE NÃO É O OCUPADO DO SEMÁFORO, E A DIFERENÇA É OBSERVÁVEL. O permite é
	 * adquirido lá no laço (`#loop`), e entre esse `acquire` e o `#start` há dois
	 * pontos de suspensão: a espera do limitador e o recheque de idempotência,
	 * que LÊ DISCO. Nessa janela o semáforo já está ocupado e este contador ainda
	 * está em zero — uma sonda com o recheque travado num portão mede
	 * `running=0 inFlightWeight=0 availableWeight=4` com o semáforo sem NENHUMA
	 * vaga livre. Não é vazamento (o caminho de recusa devolve o permite sem
	 * nunca ter incrementado aqui) e não custa dinheiro, mas é a razão de
	 * `availableWeight` ser uma **estimativa otimista**, e não o número exato de
	 * vagas: ele pode anunciar folga que o semáforo não tem.
	 *
	 * Contabilizado aqui, e não perguntado ao `WeightedSemaphore`, porque ele não
	 * expõe o disponível dele. Publicar o número exato exigiria mudar aquela
	 * classe (`pixellab-pipeline/src/queue.ts`), que é compartilhada com o CLI;
	 * a limitação fica REGISTRADA em vez de contornada com API inventada. Quem
	 * for pôr o teto na tela precisa saber que a barra pode mostrar vaga durante
	 * a janela de admissão.
	 */
	#inFlightWeight = 0;

	private constructor(options: JobQueueOptions, state: PersistedState) {
		this.#statePath = options.statePath;
		this.#execute = options.execute;
		this.#weightOf = options.weightOf ?? weightForDescriptor;
		this.#stillNeeded = options.stillNeeded;
		this.#classify = options.classifyError ?? classifyByStatus;
		this.#now = options.now ?? (() => Date.now());
		this.#sleep =
			options.sleep ??
			((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
		this.#log = options.onLog ?? (() => {});
		this.#onChange = options.onChange ?? (() => {});
		this.#maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
		this.#historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
		// Um teto declarado ganha do ambiente; sem ele, o ambiente decide e a
		// origem vem junto para a tela poder dizer de onde saiu o número.
		const decided = resolveConcurrencyDecision();
		this.#concurrency = Math.max(1, options.concurrency ?? decided.limit);
		this.#concurrencySource =
			options.concurrency !== undefined ? "option" : decided.source;
		this.#semaphore = new WeightedSemaphore(this.#concurrency);
		this.#limiter = new AdaptiveLimiter(
			options.ratePerSecond ?? DEFAULT_RATE_PER_SECOND,
		);
		this.#state = state;
	}

	/**
	 * Abre a fila, reconcilia o que o reinício deixou pela metade e volta a
	 * drenar. Chamada explícita — o módulo não faz nada ao ser importado.
	 */
	static async open(options: JobQueueOptions): Promise<JobQueue> {
		const state = await readState(options.statePath);
		const queue = new JobQueue(options, state);
		await queue.#reconcile();
		queue.#kick();
		return queue;
	}

	// ------------------------------------------------------------- leitura

	get concurrency(): number {
		return this.#concurrency;
	}

	/** De onde o teto veio: opção explícita, env, tier ou o default. */
	get concurrencySource(): ConcurrencySource {
		return this.#concurrencySource;
	}

	/**
	 * Peso de admissão que ESTE job ocuparia, já clampado no teto. Público
	 * porque a tela precisa explicar por que um job sozinho encheu a fila.
	 */
	weightOf(job: Readonly<QueuedJob>): number {
		return this.#admissionWeight(job);
	}

	get statePath(): string {
		return this.#statePath;
	}

	get(key: string): QueuedJob | undefined {
		return this.#state.jobs.find((j) => j.key === key);
	}

	/** Todos os jobs, em ordem de chegada. */
	list(): readonly QueuedJob[] {
		return [...this.#state.jobs].sort((a, b) => a.seq - b.seq);
	}

	/** Só os que ainda não entraram, em ordem de chegada — a fila propriamente. */
	pending(): readonly QueuedJob[] {
		return this.#state.jobs
			.filter((j) => j.status === "na-fila")
			.sort((a, b) => a.seq - b.seq);
	}

	running(): readonly QueuedJob[] {
		return this.#state.jobs
			.filter((j) => j.status === "gerando")
			.sort((a, b) => a.seq - b.seq);
	}

	/** Jobs pagos sem artefato: o que a retomada precisa re-sondar. */
	paidUnfinished(): readonly QueuedJob[] {
		return this.list().filter(holdsUnclaimedMoney);
	}

	stats(): QueueStats {
		const jobs = this.#state.jobs;
		return {
			queued: jobs.filter((j) => j.status === "na-fila").length,
			running: jobs.filter((j) => j.status === "gerando").length,
			done: jobs.filter((j) => j.status === "pronto").length,
			failed: jobs.filter((j) => j.status === "falhou").length,
			cancelled: jobs.filter((j) => j.status === "cancelado").length,
			concurrency: this.#concurrency,
			concurrencySource: this.#concurrencySource,
			inFlightWeight: this.#inFlightWeight,
			availableWeight: Math.max(0, this.#concurrency - this.#inFlightWeight),
			ratePerSecond: this.#limiter.rate,
		};
	}

	toStudioJobs(): Record<string, StudioJobView> {
		const positions = new Map<string, number>();
		this.pending().forEach((j, i) => positions.set(j.key, i + 1));
		const out: Record<string, StudioJobView> = {};
		for (const job of this.list()) {
			const position = positions.get(job.key);
			out[job.key] = {
				key: job.key,
				label: job.label,
				status: job.status,
				startedAt: job.startedAt ?? Date.parse(job.enqueuedAt),
				kind: job.descriptor.kind,
				seq: job.seq,
				enqueuedAt: job.enqueuedAt,
				paid: job.paid,
				attempts: job.attempts,
				...(job.message !== undefined ? { message: job.message } : {}),
				...(position !== undefined ? { queuePosition: position } : {}),
			};
		}
		return out;
	}

	// ------------------------------------------------------------- escrita

	/**
	 * Enfileira. Dedup pela chave, como o `spawn` de hoje: uma chave em
	 * `'na-fila'` ou `'gerando'` recusa a segunda submissão. Uma chave terminal
	 * é substituída por um pedido novo, que vai para o FIM da fila.
	 *
	 * A SUBSTITUIÇÃO NÃO PODE SER CEGA. O registro anterior pode ser o ÚNICO
	 * ponteiro para uma geração já cobrada: `paid: true` em `'falhou'` ou
	 * `'cancelado'` é dinheiro que saiu e artefato que não chegou, e a única ação
	 * que a UI oferece nessa célula é justamente "gerar de novo". Apagar o
	 * registro aqui destruiria a mesma retomada gratuita que `#handleFailure`
	 * acabou de prometer na mensagem do job, e o executor ressubmeteria — segunda
	 * cobrança pelo mesmo `characterId`. Por isso `paid` e `remote` são
	 * HERDADOS pelo job novo, que nasce no caminho de recuperação.
	 *
	 * Um registro `'pronto'` NÃO transmite nada, mesmo pago: o artefato chegou, e
	 * regerar é compra nova e deliberada — herdar ali devolveria o asset antigo e
	 * tornaria a regeração impossível. É a mesma fronteira que `#prune` usa.
	 */
	async enqueue(input: {
		readonly key: string;
		readonly label: string;
		readonly descriptor: JobDescriptor;
		readonly cellKeys?: readonly string[];
	}): Promise<EnqueueOutcome> {
		if (this.#closed) return { accepted: false, reason: "closed" };
		const existing = this.get(input.key);
		if (existing && !TERMINAL.has(existing.status)) {
			this.#log(
				`[fila] "${input.key}" já está ${existing.status} — submissão duplicada ignorada`,
			);
			return { accepted: false, reason: "duplicate", job: existing };
		}
		const inherits = existing !== undefined && holdsUnclaimedMoney(existing);
		if (inherits) {
			this.#log(
				`[fila] "${input.key}" já havia sido COBRADO e não entregou artefato — ` +
					"o pedido novo herda paid e o identificador remoto: o executor tem " +
					"de re-sondar, nunca ressubmeter",
			);
		}
		if (existing) {
			this.#state.jobs = this.#state.jobs.filter((j) => j.key !== input.key);
		}
		const job: QueuedJob = {
			key: input.key,
			label: input.label,
			seq: this.#state.nextSeq,
			enqueuedAt: new Date(this.#now()).toISOString(),
			descriptor: input.descriptor,
			cellKeys: input.cellKeys ?? [input.key],
			status: "na-fila",
			attempts: 0,
			paid: inherits,
			...(inherits && existing?.remote !== undefined
				? { remote: existing.remote }
				: {}),
		};
		this.#state.nextSeq += 1;
		this.#state.jobs.push(job);
		this.#prune();
		await this.#flush();
		this.#notify(job);
		const position = this.pending().findIndex((j) => j.key === job.key) + 1;
		this.#kick();
		return { accepted: true, job, position };
	}

	/**
	 * Cancelamento de verdade, nos dois estados:
	 *
	 *   - ainda na fila → sai sem nunca ter rodado, e nada foi gasto;
	 *   - já rodando    → o `AbortSignal` é abortado, o que interrompe a chamada
	 *     HTTP em voo (o transporte do pipeline aceita signal).
	 *
	 * ATENÇÃO, E ISTO NÃO É DETALHE: cancelar um job JÁ SUBMETIDO **não recupera
	 * o dinheiro**. A cobrança acontece na submissão; abortar o poll só descarta
	 * o resultado. Por isso o `remote` é preservado no registro — é o caminho de
	 * volta ao artefato que já foi pago (ADR 0023).
	 */
	async cancel(key: string): Promise<CancelOutcome> {
		const job = this.get(key);
		if (!job) return { result: "not-found" };
		if (TERMINAL.has(job.status)) return { result: "already-finished", job };

		const wasRunning = job.status === "gerando";
		job.status = "cancelado";
		job.finishedAt = this.#now();
		if (wasRunning && job.paid) {
			job.message =
				"cancelado depois da submissão — a geração já foi cobrada e o " +
				"identificador remoto foi preservado para retomada";
		}
		const controller = this.#controllers.get(key);
		controller?.abort(new Error(`job "${key}" cancelado`));
		await this.#flush();
		this.#notify(job);
		this.#settle();
		return wasRunning
			? { result: "aborted", job, paid: job.paid }
			: { result: "removed", job };
	}

	/**
	 * Remove os jobs terminais do registro (e do disco) — MENOS os que guardam o
	 * caminho de volta a uma geração já cobrada.
	 *
	 * A exceção é a MESMA de `#prune`, e pelo mesmo motivo: um job pago sem
	 * artefato é a única trilha do dinheiro que saiu. "Limpar concluídos" é um
	 * botão de arrumação da UI, e arrumação nunca pode apagar contabilidade. O
	 * usuário limpa a lista, o registro pago fica, e `paidUnfinished()` continua
	 * enxergando o que a retomada precisa re-sondar.
	 */
	async clearFinished(): Promise<number> {
		const before = this.#state.jobs.length;
		this.#state.jobs = this.#state.jobs.filter(
			(j) => !TERMINAL.has(j.status) || holdsUnclaimedMoney(j),
		);
		await this.#flush();
		return before - this.#state.jobs.length;
	}

	/** Resolve quando não há nada na fila nem rodando. */
	async idle(): Promise<void> {
		if (!this.#hasWork()) return;
		await new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
	}

	/**
	 * Para de admitir. `abortRunning` aborta o que já está em voo — o que NÃO
	 * devolve dinheiro de job já submetido.
	 *
	 * Com `abortRunning`, o fechamento AGUARDA os executores desenrolarem. Sem
	 * essa espera, a escrita final de um job que acabou de ser abortado sairia
	 * depois do `close`, e quem tivesse acabado de apagar o diretório de estado
	 * (um teste, um reset) veria a fila recriá-lo. Sem `abortRunning` não há
	 * espera: um executor que ignora o signal travaria o desligamento.
	 */
	async close(
		opts: { readonly abortRunning?: boolean } = {},
	): Promise<void> {
		this.#closed = true;
		if (opts.abortRunning) {
			for (const [key, controller] of this.#controllers) {
				controller.abort(new Error(`fila fechada com "${key}" em voo`));
			}
			await Promise.allSettled([...this.#inFlight]);
		}
		await this.#writeChain;
		this.#settle();
	}

	// ------------------------------------------------------------- internos

	/**
	 * Reconciliação de reinício. Todo job que estava `'gerando'` volta para
	 * `'na-fila'` com `resumed: true`, mantendo `seq` — o que preserva o FIFO
	 * através do reinício e coloca os interrompidos na frente do que chegar
	 * depois.
	 *
	 * O `paid` e o `remote` sobrevivem intactos, e é assim que a retomada sai de
	 * graça: o executor vê `job.paid === true`, encontra o identificador remoto
	 * no descritor/registro e RE-SONDA em vez de ressubmeter. Esta é a metade
	 * que este módulo consegue garantir sozinho; a outra metade — usar o stub em
	 * disco (`world-block.ts` grava `v3StubPath`/`tileStubPath` logo após a
	 * submissão) — mora nos módulos geradores.
	 */
	async #reconcile(): Promise<void> {
		let touched = 0;
		for (const job of this.#state.jobs) {
			if (job.status !== "gerando") continue;
			job.status = "na-fila";
			job.resumed = true;
			delete job.startedAt;
			touched += 1;
			// A mensagem do caso NÃO-PAGO custou uma reescrita: ela dizia "nada foi
			// gasto ainda", e isso é falso exatamente na janela entre o `submit` do
			// executor e o `await ctx.markPaid` — o dinheiro sai no submit e o disco
			// só aprende depois. Esta camada não consegue distinguir "nunca
			// submeteu" de "submeteu e morreu antes de anotar", e afirmar a mais
			// barata das duas é o tipo de certeza fingida que ninguém vai conferir
			// depois. Ver o contrato da janela no cabeçalho do módulo.
			this.#log(
				`[fila] retomando "${job.key}" após reinício` +
					(job.paid
						? " — JÁ PAGO: o executor tem de re-sondar, nunca ressubmeter"
						: " — o registro NÃO ACUSA cobrança, o que NÃO FOI VERIFICADO: se o " +
							"processo morreu entre a submissão e o markPaid, a cobrança existe e " +
							"o disco não sabe. Procure o stub de retomada antes de ressubmeter"),
			);
		}
		this.#state.jobs.sort((a, b) => a.seq - b.seq);
		// nextSeq nunca pode regredir: um arquivo adulterado ou truncado que o
		// deixasse para trás faria dois jobs nascerem com o mesmo número e o
		// FIFO viraria empate não determinístico.
		const maxSeq = this.#state.jobs.reduce((m, j) => Math.max(m, j.seq), -1);
		if (this.#state.nextSeq <= maxSeq) this.#state.nextSeq = maxSeq + 1;
		this.#prune();
		if (touched > 0 || this.#state.jobs.length > 0) await this.#flush();
	}

	/**
	 * Avisa a transição. O `onChange` é código de fora — na onda seguinte ele vai
	 * escrever célula no `studio.json`, que é I/O e pode falhar. Uma exceção dele
	 * chegaria ao laço de admissão com o permite do semáforo na mão, e a fila
	 * encolheria um pouco a cada erro até parar de admitir. Ela é isolada aqui.
	 */
	#notify(job: QueuedJob): void {
		try {
			this.#onChange(job);
		} catch (err) {
			this.#log(`[fila] onChange de "${job.key}" lançou: ${describe(err)}`);
		}
	}

	#hasWork(): boolean {
		return (
			this.#loopActive ||
			this.#controllers.size > 0 ||
			this.#state.jobs.some((j) => j.status === "na-fila")
		);
	}

	#settle(): void {
		if (this.#hasWork()) return;
		const waiters = this.#idleWaiters.splice(0, this.#idleWaiters.length);
		for (const resolve of waiters) resolve();
	}

	#kick(): void {
		if (this.#closed || this.#loopActive) return;
		this.#loopActive = true;
		// O laço escreve em disco (recheque de idempotência que dispensa o job) e
		// o disparo é sem `await` — sem este `catch` uma falha de escrita viraria
		// unhandled rejection e derrubaria o processo do editor.
		const loop = this.#loop().catch((err: unknown) => {
			this.#log(`[fila] laço de admissão interrompido: ${describe(err)}`);
		});
		void loop.finally(() => {
			this.#loopActive = false;
			// Relança se alguém enfileirou na janela entre o laço encontrar a fila
			// vazia e este `finally` rodar. Sem esta recheca, um `enqueue` que
			// caísse exatamente aí veria `#loopActive` ainda ligado, desistiria de
			// chamar `#kick`, e o job ficaria em 'na-fila' para sempre.
			if (!this.#closed && this.#state.jobs.some((j) => j.status === "na-fila")) {
				this.#kick();
				return;
			}
			this.#settle();
		});
	}

	/**
	 * Laço de admissão. Ele é SERIAL de propósito: só um job é admitido por vez,
	 * e o seguinte espera o `acquire` do anterior. É isso que faz o FIFO ser
	 * observável — sem a serialização, N `acquire` concorrentes resolveriam na
	 * ordem em que o semáforo os liberasse, que não é a ordem de chegada.
	 *
	 * NENHUMA das rechecagens abaixo é a guarda de verdade. Cada `await` aqui é
	 * uma janela nova em que `cancel()` ou `close()` podem cair, e uma guarda por
	 * `await` é uma linha que a próxima pessoa a acrescentar um `await` vai
	 * esquecer. A guarda que decide vive em `#start`, onde a transição para
	 * `'gerando'` acontece; estas só evitam trabalho e espera inúteis, e podem
	 * ser omitidas sem consequência de dinheiro.
	 */
	async #loop(): Promise<void> {
		while (!this.#closed) {
			const job = this.pending()[0];
			if (!job) return;

			const { wanted, weight } = this.#weighJob(job);
			await this.#semaphore.acquire(weight);

			// Tudo abaixo pode ter mudado enquanto esperávamos capacidade.
			if (this.#closed || job.status !== "na-fila") {
				this.#semaphore.release(weight);
				if (this.#closed) return;
				continue;
			}

			const wait = this.#limiter.reserve(this.#now());
			// A espera é injetada; se o chamador passar uma que rejeita, o permite
			// do semáforo vazaria e a fila encolheria em silêncio a cada erro.
			if (wait > 0) {
				try {
					await this.#sleep(wait);
				} catch (err) {
					this.#log(`[fila] espera do limitador falhou: ${describe(err)}`);
				}
			}

			if (this.#closed || job.status !== "na-fila") {
				this.#semaphore.release(weight);
				if (this.#closed) return;
				continue;
			}

			// Recheque de idempotência NA DRENAGEM: o mundo mudou desde o
			// enfileiramento, e refazer o que já está pronto é gasto puro.
			let needed = true;
			try {
				needed = await this.#stillNeeded(job);
			} catch (err) {
				this.#log(
					`[fila] recheque de "${job.key}" falhou (${describe(err)}) — seguindo com a execução`,
				);
			}
			if (!needed) {
				this.#semaphore.release(weight);
				// Fechado no meio do recheque: parar de admitir é também parar de
				// ESCREVER, senão a conclusão sai depois de `close` ter resolvido e
				// recria o arquivo de estado que alguém acabou de apagar. A
				// conclusão fica para o próximo boot, onde o recheque vai dispensar
				// este job de novo — e de graça.
				if (this.#closed) return;
				// O recheque pode ter demorado (ele lê disco), e nesse intervalo o
				// usuário pode ter cancelado. Concluir como 'pronto' aqui
				// RESSUSCITARIA um job terminal — mesma classe de defeito que a
				// guarda de `#start` fecha, só que sem gasto.
				if (job.status === "na-fila") {
					job.status = "pronto";
					job.finishedAt = this.#now();
					job.message = "já estava pronto quando a fila chegou nele — nada gasto";
					await this.#flush();
					this.#notify(job);
				}
				continue;
			}

			// `#start` é quem decide, e pode recusar: ele reconfere o estado no
			// mesmo bloco síncrono em que faria a transição. Recusou, o permite
			// volta para o semáforo e o laço segue para o próximo da fila.
			if (!this.#start(job, weight, wanted)) {
				this.#semaphore.release(weight);
				if (this.#closed) return;
				continue;
			}
		}
	}

	/**
	 * O peso nunca pode passar da capacidade. `WeightedSemaphore.acquire` de
	 * `pixellab-pipeline/src/queue.ts` só admite quando `available >= weight`,
	 * e um job mais pesado que o teto com a fila vazia esperaria um `release`
	 * que nunca vem — trava eterna. O teste do pipeline só cobre o caso em que
	 * um release chega depois. Clampar aqui é a diferença entre "job pesado roda
	 * sozinho" e "a fila morre".
	 *
	 * O CLAMP É UMA DECISÃO, NÃO UM ACIDENTE, e ela tem duas metades:
	 *
	 *   1. **Rodar sozinho é melhor que travar.** Um `sprite-lab` de 4 chamadas
	 *      sob `PIXELLAB_TIER=free` (teto 1) vai estourar o limite da conta de
	 *      qualquer jeito — a fila não controla o que acontece DENTRO do job.
	 *      Recusá-lo seria transformar excesso de concorrência (429 grátis,
	 *      retentável) em funcionalidade indisponível.
	 *   2. **Clampar no teto, e não no teto menos um, é o que garante que dois
	 *      pesados nunca entrem juntos.** O peso clampado é exatamente a
	 *      capacidade do semáforo, então enquanto ele estiver em voo o
	 *      disponível é zero e NADA mais é admitido — nem outro clampado, nem um
	 *      job de peso 1. É essa igualdade que faz o isolamento; um clamp para
	 *      qualquer valor menor abriria fresta para um segundo job pesado.
	 *
	 * O log NÃO sai daqui, e isso é deliberado: este método é chamado no laço,
	 * ANTES do `acquire`, do limitador e do recheque de idempotência — um job que
	 * o recheque dispensa nunca chega a ser admitido, e cada volta do laço sobre
	 * a mesma cabeça de fila recalcularia o peso. Logar aqui afirmaria uma
	 * admissão que pode não acontecer, e repetiria a afirmação. Quem loga é
	 * `#start`, que é onde a admissão de fato acontece; o texto continua dizendo
	 * o que a fila não consegue impedir, senão a próxima pessoa a ver 429 vai
	 * procurar o defeito na fila, que é o único lugar onde ele não está.
	 */
	#weighJob(job: Readonly<QueuedJob>): {
		/** O que o job pediu, já normalizado — antes do clamp. */
		readonly wanted: number;
		/** O que ele ocupa de fato: `wanted` clampado no teto. */
		readonly weight: number;
	} {
		let raw: number;
		try {
			raw = this.#weightOf(job.descriptor);
		} catch {
			raw = 1;
		}
		if (!Number.isFinite(raw) || raw < 1) raw = 1;
		const wanted = Math.floor(raw);
		return { wanted, weight: Math.min(wanted, this.#concurrency) };
	}

	#admissionWeight(job: Readonly<QueuedJob>): number {
		return this.#weighJob(job).weight;
	}

	/**
	 * Admite o job: a ÚNICA porta para `'gerando'` e para o executor.
	 *
	 * Este método é inteiramente SÍNCRONO, e isso é a correção — não um detalhe
	 * de estilo. Dois defeitos de dinheiro saíam de ele não ser:
	 *
	 * 1. A GUARDA VIVE ONDE A TRANSIÇÃO ACONTECE. Antes, o laço reconferia
	 *    `status !== 'na-fila'` depois do `acquire` e depois do `sleep`, e `#start`
	 *    escrevia `'gerando'` sem perguntar nada. Bastava um `await` a mais no
	 *    laço — e o recheque de idempotência da onda 2 lê disco, então ele É
	 *    assíncrono — para abrir uma janela em que `cancel()` marcava
	 *    `'cancelado'`, não encontrava controller nenhum para abortar (o job ainda
	 *    não tinha começado), respondia `'removed'` — que este módulo documenta
	 *    como "nada foi gasto" — e então `#start` sobrescrevia o status, criava um
	 *    `AbortController` NOVO e não-abortado, e o executor submetia. O usuário
	 *    cancelava, era cobrado, e a UI mostrava sucesso. Perguntando aqui, no
	 *    mesmo bloco síncrono da escrita, nenhum `await` futuro do laço reabre a
	 *    janela: entre a checagem e a transição não existe ponto de suspensão onde
	 *    outro código possa rodar.
	 *
	 * 2. QUEM CANCELA E QUEM FECHA TÊM DE ACHAR EM QUEM PEGAR. O `AbortController`
	 *    entra em `#controllers` e a tarefa entra em `#inFlight` ANTES de qualquer
	 *    coisa poder suspender. `close({abortRunning:true})` tira um RETRATO
	 *    (`[...this.#inFlight]`) e promete esperar os executores desenrolarem;
	 *    quando o registro acontecia depois de um `await` do laço, o retrato saía
	 *    vazio, `close` resolvia, e o executor rodava depois — reprodutível.
	 *
	 * Devolve `false` quando recusa; o chamador ainda segura o permite do
	 * semáforo e é quem o devolve.
	 *
	 * `wanted` é o peso ANTES do clamp, e serve só para o log do clamp sair
	 * daqui — depois da guarda, quando a admissão já é fato consumado — em vez
	 * de sair do laço, onde ainda podia não acontecer. Ver `#weighJob`.
	 */
	#start(job: QueuedJob, weight: number, wanted: number): boolean {
		if (this.#closed || job.status !== "na-fila") return false;

		// Daqui para baixo não há ponto de suspensão até a transição: o job ESTÁ
		// admitido, e só agora a frase "admitido SOZINHO" é verdadeira. O clamp
		// corta exatamente quando `weight < wanted`, e nesse caso `weight` é o
		// teto inteiro — por construção, `Math.min(wanted, concurrency)`.
		if (weight < wanted) {
			this.#log(
				`[fila] "${job.key}" faz até ${wanted} chamadas simultâneas e o teto é ` +
					`${this.#concurrency} — admitido SOZINHO, ocupando o teto inteiro. ` +
					"O fan-out acontece DENTRO do job e a fila não o divide: se a conta " +
					"recusar, o 429 não custa nada e o limitador desacelera a fila.",
			);
		}

		const controller = new AbortController();
		this.#controllers.set(job.key, controller);
		// Ocupação sobe junto com a admissão, no mesmo bloco síncrono: um
		// `stats()` lido entre as duas linhas mostraria job em voo com teto
		// vazio, e é justamente essa leitura que a onda seguinte vai pôr na tela.
		this.#inFlightWeight += weight;
		job.status = "gerando";
		job.attempts += 1;
		job.startedAt = this.#now();
		delete job.message;
		delete job.finishedAt;
		this.#notify(job);

		const ctx: JobContext = {
			job,
			signal: controller.signal,
			markPaid: async (remote?: RemoteHandle) => {
				job.paid = true;
				if (remote) job.remote = { ...job.remote, ...remote };
				// Persiste ANTES de o chamador seguir para o poll. O dinheiro já
				// saiu; perder o identificador daqui em diante é perder a geração.
				await this.#flush();
				this.#notify(job);
			},
			log: this.#log,
		};

		// `Promise.resolve().then(...)` em vez de invocar `#run` direto: o corpo só
		// pode começar num microtask POSTERIOR, o que torna impossível — por
		// construção, não por leitura atenta — que a tarefa rode antes de estar em
		// `#inFlight`. Nenhum `await` acrescentado dentro de `#run` muda isso.
		const task = Promise.resolve().then(() =>
			this.#run(job, weight, controller, ctx),
		);
		this.#inFlight.add(task);
		void task.finally(() => this.#inFlight.delete(task));
		return true;
	}

	/** O corpo da execução. Só entra aqui job que `#start` admitiu. */
	async #run(
		job: QueuedJob,
		weight: number,
		controller: AbortController,
		ctx: JobContext,
	): Promise<void> {
		try {
			// A escrita de 'gerando' não é aguardada pelo laço: aguardá-la
			// atrasaria a admissão do próximo por um fsync. Ela é aguardada
			// aqui, dentro do job, antes do trabalho de verdade.
			await this.#flush();
			// Janela real: o cancelamento pode chegar entre a admissão e a
			// primeira linha do executor. Chamar o executor aqui submeteria —
			// e cobraria — um job que o usuário já mandou cancelar. O
			// `addEventListener('abort')` do executor não salvaria: um signal
			// abortado ANTES do registro nunca dispara o ouvinte.
			if (controller.signal.aborted || job.status !== "gerando") return;
			await this.#execute(ctx);
			this.#limiter.reward();
			// Um cancelamento entre o fim do trabalho e este ponto já trocou o
			// status; não sobrescreva. Mesma guarda do `spawn` de hoje.
			if (job.status === "gerando") {
				job.status = "pronto";
				job.finishedAt = this.#now();
				await this.#flush();
				this.#notify(job);
			}
		} catch (err) {
			// `#handleFailure` escreve em disco, e disco falha. Se a rejeição
			// dele escapasse deste `catch`, viraria unhandled rejection: a
			// tarefa é disparada sem `await`, e o processo do editor morreria
			// por causa de um flush, não por causa do job.
			try {
				await this.#handleFailure(job, err);
			} catch (flushErr) {
				this.#log(
					`[fila] não consegui registrar a falha de "${job.key}": ${describe(flushErr)}`,
				);
			}
		} finally {
			this.#controllers.delete(job.key);
			this.#inFlightWeight = Math.max(0, this.#inFlightWeight - weight);
			this.#semaphore.release(weight);
			this.#kick();
			this.#settle();
		}
	}

	async #handleFailure(job: QueuedJob, err: unknown): Promise<void> {
		// Falha de job cancelado é esperada (a chamada remota foi abortada).
		if (job.status !== "gerando") return;

		const message = describe(err);
		let kind: FailureKind;
		try {
			kind = this.#classify(err, job);
		} catch {
			kind = "fatal";
		}
		if (kind === "rate-limited") {
			// Desacelera a FILA INTEIRA, não só este job.
			this.#limiter.penalise();
			this.#log(
				`[fila] limite de concorrência da conta em "${job.key}" — taxa agora ${this.#limiter.rate}/s`,
			);
		}

		// A REGRA MAIS CARA DO SISTEMA: um job cujo id já temos nunca é
		// ressubmetido. Retentar um job pago criaria uma segunda cobrança pela
		// mesma coisa. Retomada re-sonda; retentativa automática, jamais.
		const retryable =
			kind !== "fatal" && !job.paid && job.attempts < this.#maxAttempts;

		if (retryable) {
			job.status = "na-fila";
			job.message = `tentativa ${job.attempts} falhou (${message}) — de volta à fila`;
			delete job.startedAt;
			await this.#flush();
			this.#notify(job);
			return;
		}

		job.status = "falhou";
		job.finishedAt = this.#now();
		job.message = job.paid
			? `${message} — ATENÇÃO: a geração já havia sido cobrada; o identificador ` +
				"remoto está guardado e a retomada é gratuita"
			: message;
		await this.#flush();
		this.#notify(job);
	}

	/** Mantém o histórico limitado, podando os terminais mais antigos. */
	#prune(): void {
		const terminal = this.#state.jobs
			.filter((j) => TERMINAL.has(j.status))
			.sort((a, b) => a.seq - b.seq);
		const excess = terminal.length - this.#historyLimit;
		if (excess <= 0) return;
		// Nunca poda um job PAGO cujo artefato não chegou: ele é o registro do
		// caminho de volta ao dinheiro que já saiu.
		const doomed = new Set(
			terminal
				.filter((j) => !holdsUnclaimedMoney(j))
				.slice(0, excess)
				.map((j) => j.key),
		);
		this.#state.jobs = this.#state.jobs.filter((j) => !doomed.has(j.key));
	}

	/**
	 * Escrita atômica SERIALIZADA — o padrão de `server/api.ts`
	 * (`writeStudioFile` + a `writeQueue` do `save`), não o do pipeline.
	 *
	 * Os dois padrões existem no repo e a escolha aqui é deliberada.
	 * `writeFileAtomic` (`pixellab-pipeline/src/util.ts`) nomeia o temporário
	 * como `${path}.tmp-${pid}-${Date.now().toString(36)}` — duas escritas no
	 * MESMO milissegundo do mesmo processo dividem o mesmo arquivo temporário,
	 * e a segunda renomeia um caminho que a primeira já consumiu: `ENOENT` no
	 * rename. Uma fila escreve exatamente assim (admissão, `markPaid`,
	 * conclusão, tudo em rajada), e o teste de retomada reproduziu a colisão na
	 * primeira execução. O sufixo aleatório de `writeStudioFile` não tem esse
	 * problema.
	 *
	 * A serialização é a segunda metade: o rename é atômico, mas dois renames
	 * fora de ordem deixariam o arquivo com o estado ANTIGO. A corrente executa
	 * na ordem de chegada, então o arquivo final é sempre o flush mais recente.
	 */
	async #flush(): Promise<void> {
		this.#state.updatedAt = new Date(this.#now()).toISOString();
		const run = this.#writeChain.then(async () => {
			await mkdir(dirname(this.#statePath), { recursive: true });
			const tmp = `${this.#statePath}.${randomBytes(6).toString("hex")}.tmp`;
			await writeFile(tmp, `${JSON.stringify(this.#state, null, 2)}\n`);
			await rename(tmp, this.#statePath);
		});
		// A corrente nunca trava: a falha volta ao chamador, mas o elo seguinte
		// segue. Mesmo desenho do `save` de `server/api.ts`.
		this.#writeChain = run.catch(() => {});
		return run;
	}
}

// ---------------------------------------------------------------- auxiliares

function describe(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * O job guarda dinheiro que saiu e não virou artefato: `paid` com status
 * diferente de `'pronto'` (falhou, cancelado depois da submissão, ou ainda em
 * voo). O registro dele é o ÚNICO caminho de volta ao que já foi cobrado.
 *
 * Três lugares dependem desta mesma fronteira, e o defeito aparecia quando um
 * deles a reimplementava sozinho: `#prune` (não poda), `clearFinished` (não
 * limpa), `enqueue` (herda `paid` e `remote` em vez de descartar) e
 * `paidUnfinished` (é a própria consulta).
 *
 * `'pronto'` fica de fora de propósito: o artefato chegou, o dinheiro virou
 * valor, e um pedido novo naquela chave é compra nova.
 */
function holdsUnclaimedMoney(job: Readonly<QueuedJob>): boolean {
	return job.paid && job.status !== "pronto";
}

function emptyState(): PersistedState {
	return {
		version: STATE_VERSION,
		nextSeq: 0,
		jobs: [],
		updatedAt: new Date(0).toISOString(),
	};
}

/**
 * Lê o estado do disco. Arquivo ausente, ilegível ou corrompido devolve estado
 * vazio em vez de lançar: a fila é infraestrutura do editor, e derrubar o
 * servidor por causa de um JSON quebrado seria pior que perder o histórico —
 * mesma escolha que `loadFromDisk` de `server/api.ts` faz com o `studio.json`.
 */
async function readState(path: string): Promise<PersistedState> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch {
		return emptyState();
	}
	try {
		const parsed = JSON.parse(raw) as Partial<PersistedState>;
		if (parsed.version !== STATE_VERSION || !Array.isArray(parsed.jobs)) {
			return emptyState();
		}
		const jobs = parsed.jobs
			.map(normalizeJob)
			.filter((j): j is QueuedJob => j !== undefined);
		const nextSeq =
			typeof parsed.nextSeq === "number" && Number.isFinite(parsed.nextSeq)
				? parsed.nextSeq
				: 0;
		return {
			version: STATE_VERSION,
			nextSeq,
			jobs,
			updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
		};
	} catch {
		return emptyState();
	}
}

/**
 * Descarta registros que não têm o mínimo para serem redespachados e NORMALIZA
 * os dois campos cujo valor inválido custa caro. O arquivo é editável à mão e
 * sobrevive a quedas no meio de uma escrita; nada aqui pode acreditar nele.
 *
 * `status` fora do conjunto válido era um job ZUMBI: não é terminal, não é
 * `'na-fila'`, não é `'gerando'` — logo some de `pending()`, de `running()`, da
 * poda e da limpeza, e fica no arquivo para sempre sem ninguém conseguir vê-lo
 * ou agir sobre ele. Vira `'falhou'`: terminal, visível na listagem, jamais
 * executado, e — se o registro for pago — protegido por `holdsUnclaimedMoney`.
 *
 * `paid` ausente ou não-booleano resolve para `true`, NÃO para `false`. Os dois
 * erros não custam a mesma coisa: assumir `false` devolve um job possivelmente
 * já cobrado à execução automática e paga a mesma geração de novo, enquanto
 * assumir `true` no máximo obriga o usuário a reenfileirar à mão. Na dúvida
 * sobre dinheiro, o lado seguro é o que não gasta.
 */
function normalizeJob(value: unknown): QueuedJob | undefined {
	if (value === null || typeof value !== "object") return undefined;
	const j = value as Partial<QueuedJob>;
	if (typeof j.key !== "string" || j.key === "") return undefined;
	if (typeof j.seq !== "number" || !Number.isFinite(j.seq)) return undefined;
	const d = j.descriptor as { kind?: unknown } | undefined;
	if (!d || typeof d.kind !== "string") return undefined;
	if (!(JOB_KINDS as readonly string[]).includes(d.kind)) return undefined;

	const statusOk = typeof j.status === "string" && JOB_STATUSES.has(j.status);
	const paid = typeof j.paid === "boolean" ? j.paid : true;
	const job = { ...j, paid } as QueuedJob;
	if (!statusOk) {
		job.status = "falhou";
		job.message =
			"registro em disco com status inválido — tratado como falhou, e nada " +
			"foi executado a partir dele";
	}
	return job;
}
