/**
 * De quem é o job, e o que ele impede.
 *
 * A PERGUNTA ERRADA E A CERTA
 *
 * `useStudio` respondia "algum job está gerando?" e o wizard inteiro apagava.
 * Qualquer job — bloco do mundo, sprite-lab, pose de OUTRO personagem —
 * congelava uma tela que não tem relação nenhuma com aquele trabalho. A
 * pergunta certa é "algo que impede ESTA ação está em andamento?", e a resposta
 * sai da CHAVE do job: ela já carrega o dono.
 *
 * A GRAMÁTICA DAS CHAVES (server/model.ts, server/api.ts)
 *
 *   `${characterId}::${poseId}`            cellKey        — pose
 *   `${characterId}::wardrobe::${itemId}`  wardrobeKey    — peça
 *   `${characterId}::__south__`            southKey       — wizard, face sul
 *   `${characterId}::__directions8__`      directions8Key — wizard, 8 direções
 *   `${characterId}::__cardinal-<dir>__`   cardinalKey    — wizard, legado v2
 *   `${characterId}::__cardinals__`        cardinalsBatchKey — wizard, legado v2
 *   `sprite-lab::<hash>`                   api.ts:1339    — bancada
 *   `world-block::<hash>`                  api.ts:1439    — bancada
 *
 * A BANCADA É CHECADA PRIMEIRO — MAS ISSO NÃO DECIDE DONO
 *
 * `sprite-lab::<hash>` tem exatamente a forma de `cellKey('sprite-lab', hash)`.
 * Sem a precedência, todo job de bancada viraria "pose do personagem chamado
 * sprite-lab". E o id colidente É CRIÁVEL: `POST /api/characters` faz
 * `id = slug(b.label)` e `slug` é `toLowerCase()` + `[^a-z0-9]+ → '-'`
 * (`server/api.ts`), então o label livre "Sprite Lab" produz o id `sprite-lab`
 * — o campo de label na UI só valida não-vazio. `POST /api/characters/import`
 * copia o mesmo `slug` (`server/sprite-bundle.ts`).
 *
 * Por isso `wizardStepBlock` NÃO pergunta a `characterOf` de quem é o job: ele
 * compara `key.startsWith(characterId + '::')`, o mesmo teste que
 * `wizard/character-header.tsx` já faz para impedir apagar um personagem com
 * job em voo. As duas camadas erram para lados OPOSTOS, de propósito:
 *
 *   - `parseJobScope` lê a chave sozinha e, na dúvida, chama de bancada — assim
 *     um job de bancada nunca vira pose de personagem nenhum, que era o
 *     congelamento global que motivou o módulo.
 *   - `wizardStepBlock` já sabe de quem é o wizard e, na dúvida, BLOQUEIA —
 *     porque a dúvida aqui vale uma `create-character-v3` paga em cima de uma
 *     face sul que está sendo substituída.
 *
 * O preço, explícito: para um personagem cujo id seja literalmente
 * `sprite-lab` ou `world-block`, os jobs da bancada bloqueiam o wizard dele.
 * Isso é espera indevida num caso de nome colidente; o outro lado era gasto.
 *
 * `'na-fila'` CONTA COMO OCUPADO
 *
 * O status novo da fila (`server/job-queue.ts`) significa "ainda vai rodar",
 * não "não vai rodar". Para efeito de bloqueio ele vale tanto quanto
 * `'gerando'`; para efeito de TEXTO na tela os dois são estados diferentes, e é
 * por isso que `WizardBlock` devolve o status em vez de só um booleano.
 *
 * Módulo puro, sem React — a decisão roda sob `node --test` sem DOM, como
 * `wizard/wizard-progress.ts`, `itens/item-state.ts` e os outros quatro.
 */
import {
	cardinalsBatchKey,
	directions8Key,
	southKey,
} from '../../server/model.ts';

// ---------------------------------------------------------------- ocupado

/**
 * Os dois status que impedem uma ação nova. `'pronto'`, `'falhou'` e
 * `'cancelado'` são terminais: o job acabou e não segura mais nada.
 */
export type BusyStatus = 'na-fila' | 'gerando';

export function isBusyStatus(status: string | undefined): status is BusyStatus {
	return status === 'na-fila' || status === 'gerando';
}

/** Forma mínima do job que este módulo lê (compatível com StudioJobEntry). */
export interface JobLike {
	readonly status: string;
	readonly label?: string;
}

// ---------------------------------------------------------------- escopo

/** Etapa do wizard a que um job pertence. `cardeais` é dado v2 legado. */
export type WizardStep = 'sul' | 'direcoes8' | 'cardeais';

/** As duas bancadas: trabalho sem entidade no estúdio, identificado por hash. */
export type BenchId = 'sprite-lab' | 'world-block';

export const BENCH_IDS: readonly BenchId[] = ['sprite-lab', 'world-block'];

/**
 * O que a chave do job diz sobre ele. União discriminada de propósito: cada
 * variante carrega só o que existe naquele caso, e `exactOptionalPropertyTypes`
 * deixa de ser um problema porque não há campo opcional nenhum.
 */
export type JobScope =
	| { readonly kind: 'wizard'; readonly characterId: string; readonly step: WizardStep }
	| { readonly kind: 'pose'; readonly characterId: string; readonly poseId: string }
	| { readonly kind: 'wardrobe'; readonly characterId: string; readonly itemId: string }
	| { readonly kind: 'bench'; readonly bench: BenchId; readonly hash: string }
	| { readonly kind: 'unknown'; readonly key: string };

/**
 * Sentinelas do namespace do wizard, derivadas das funções de `server/model.ts`
 * em vez de literais copiados. O que o teste homônimo pega, e o que não:
 *
 *   PEGA mudança ESTRUTURAL da convenção — sentinela virar prefixo em vez de
 *   sufixo, outro separador, um segmento a mais. Qualquer uma quebra `suffixOf`
 *   e a asserção falha antes de a tela mostrar bloqueio errado.
 *
 *   NÃO PEGA renome do token, e é correto que não pegue: se `southKey` passar a
 *   emitir `__sul__`, módulo e teste derivam ambos do mesmo `southKey` e
 *   continuam de acordo. Não há nada para falhar porque nada quebrou — o
 *   acoplamento por função é justamente o que torna o renome inofensivo.
 */
const SENTINEL_PROBE = '__probe__';
const SOUTH_SENTINEL = suffixOf(southKey(SENTINEL_PROBE));
const DIR8_SENTINEL = suffixOf(directions8Key(SENTINEL_PROBE));
const CARDINALS_SENTINEL = suffixOf(cardinalsBatchKey(SENTINEL_PROBE));
/** `cardinalKey` varia por direção — só o prefixo é estável. */
const CARDINAL_PREFIX = '__cardinal-';

function suffixOf(key: string): string {
	return key.slice(`${SENTINEL_PROBE}::`.length);
}

/** Lê a chave do job e devolve de quem ela é. Nunca lança. */
export function parseJobScope(key: string): JobScope {
	// Bancada ANTES de cellKey — ver o cabeçalho: as duas formas se confundem.
	for (const bench of BENCH_IDS) {
		const prefix = `${bench}::`;
		if (key.startsWith(prefix)) {
			return { kind: 'bench', bench, hash: key.slice(prefix.length) };
		}
	}

	const parts = key.split('::');
	const characterId = parts[0];
	const head = parts[1];
	if (
		characterId === undefined ||
		characterId === '' ||
		head === undefined ||
		head === ''
	) {
		return { kind: 'unknown', key };
	}

	if (head === SOUTH_SENTINEL) {
		return { kind: 'wizard', characterId, step: 'sul' };
	}
	if (head === DIR8_SENTINEL) {
		return { kind: 'wizard', characterId, step: 'direcoes8' };
	}
	if (head === CARDINALS_SENTINEL || head.startsWith(CARDINAL_PREFIX)) {
		return { kind: 'wizard', characterId, step: 'cardeais' };
	}

	const tail = parts[2];
	if (head === 'wardrobe' && tail !== undefined && tail !== '') {
		return { kind: 'wardrobe', characterId, itemId: tail };
	}
	return { kind: 'pose', characterId, poseId: head };
}

/** O personagem dono do job, ou `undefined` para bancada e chave estranha. */
export function characterOf(scope: JobScope): string | undefined {
	switch (scope.kind) {
		case 'wizard':
		case 'pose':
		case 'wardrobe':
			return scope.characterId;
		case 'bench':
		case 'unknown':
			return undefined;
	}
}

// ---------------------------------------------------------------- bloqueio

/**
 * Por que a ação está bloqueada.
 *
 * `mesma-etapa` é o mutex que NÃO pode ser afrouxado: pedir a face sul duas
 * vezes ao mesmo tempo é pagar duas vezes pela mesma imagem.
 *
 * `mesmo-personagem` é conservador de propósito. A cadeia do wizard é
 * derivativa — as 8 direções nascem da sul ativa, e as poses e peças nascem do
 * `remoteId` que as 8 direções escrevem —, então dois trabalhos do MESMO
 * personagem em voo produzem arte que já não combina com o corpo que a gerou.
 * Errar para o lado de bloquear custa espera; errar para o lado de permitir
 * custa geração paga que sai errada.
 */
export type BlockReason = 'mesma-etapa' | 'mesmo-personagem';

export type WizardBlock =
	| { readonly blocked: false }
	| {
			readonly blocked: true;
			readonly reason: BlockReason;
			/** `'na-fila'` e `'gerando'` bloqueiam igual e se escrevem diferente. */
			readonly status: BusyStatus;
			/** Chave do job que segura — útil em log e em teste. */
			readonly key: string;
			/** Rótulo pt-BR do job, para a mensagem. Cai na chave se não houver. */
			readonly label: string;
	  };

const NOT_BLOCKED: WizardBlock = { blocked: false };

/**
 * Id-sonda para reclassificar o SUFIXO de uma chave cujo dono já foi decidido
 * pelo prefixo. Não é nome de bancada nem id que o servidor consiga emitir (o
 * `slug` nunca produz `_`), então a precedência da bancada não interfere aqui.
 */
const OWNER_PROBE = '__owner__';

/**
 * O que impede uma etapa do wizard DESTE personagem.
 *
 * Bloqueiam: job ocupado da mesma etapa (mutex), e job ocupado de qualquer
 * outra etapa, pose ou peça do MESMO personagem.
 *
 * Não bloqueiam: job de OUTRO personagem, job terminal, sufixo que não se sabe
 * ler. A bancada (`sprite-lab`, `world-block`) também não — exceto no caso em
 * que o id do personagem é literalmente o nome de uma bancada, e aí ela
 * bloqueia. Ver o cabeçalho: esse id É criável, e o desempate cai para o lado
 * de bloquear porque o outro lado é geração paga sobre referência trocada.
 *
 * A varredura é por chave ORDENADA e a mesma-etapa tem precedência, então duas
 * telas com o mesmo snapshot mostram a mesma mensagem — ordem de iteração de
 * objeto não é contrato, e entre dois `mesmo-personagem` vence o primeiro em
 * ordem de chave, sempre o mesmo.
 */
export function wizardStepBlock(
	jobs: Readonly<Record<string, JobLike>> | undefined,
	characterId: string,
	step: WizardStep,
): WizardBlock {
	if (jobs === undefined || characterId === '') return NOT_BLOCKED;
	const prefix = `${characterId}::`;

	let fallback: WizardBlock | undefined;
	for (const key of Object.keys(jobs).sort()) {
		const job = jobs[key];
		if (job === undefined || !isBusyStatus(job.status)) continue;
		// Dono por PREFIXO, não por `characterOf(key)` — ver o cabeçalho. Um id
		// de personagem nunca contém `::` (o `slug` só emite `[a-z0-9-]`), então
		// o prefixo casa exatamente o namespace deste personagem.
		if (!key.startsWith(prefix)) continue;
		// O resto da chave é reclassificado sob a sonda: assim `__south__` de um
		// personagem chamado `sprite-lab` continua sendo a etapa sul dele.
		const scope = parseJobScope(`${OWNER_PROBE}::${key.slice(prefix.length)}`);
		// Sufixo ilegível (vazio, só separadores) não bloqueia — é o mesmo
		// contrato de "chave que não se sabe ler", agora aplicado ao sufixo.
		if (characterOf(scope) === undefined) continue;

		const reason: BlockReason =
			scope.kind === 'wizard' && scope.step === step
				? 'mesma-etapa'
				: 'mesmo-personagem';
		const block: WizardBlock = {
			blocked: true,
			reason,
			status: job.status,
			key,
			label: job.label ?? key,
		};
		if (reason === 'mesma-etapa') return block;
		fallback ??= block;
	}
	return fallback ?? NOT_BLOCKED;
}
