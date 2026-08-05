/**
 * Decisões de recuperação da bancada v3 — módulo puro (sem DOM, sem React).
 *
 * ## O problema que este módulo existe para tornar impossível
 *
 * O painel tem TRÊS origens assíncronas para a mesma tela: o catálogo em disco
 * (`GET /api/sprite-lab`, lido no mount), um job que continuou rodando no
 * servidor enquanto a aba esteve fechada (`studio.jobs['sprite-lab::<hash>']`)
 * e o POST que o usuário acabou de disparar. Cada uma sabe de uma corrida
 * DIFERENTE, e elas chegam em qualquer ordem.
 *
 * Enquanto o body da corrida e o resultado dela viviam em dois estados soltos
 * (`runBody` e `result`), nada impedia que a tela ficasse com o body de uma
 * corrida e os candidatos de outra — e o bundle exportado por "Baixar JSON"
 * carrega `size`, `description` e `seed` do body. No import, `config.size` vira
 * `lock.size` do personagem, que é IMUTÁVEL depois de travado e governa toda
 * geração paga de 8 direções. Um `size` errado entra em silêncio e custa
 * dinheiro.
 *
 * A regra que faltava, e que este módulo carrega:
 *
 *   **body, resumo e resultado descrevem A MESMA corrida, identificada pelo
 *   hash — ou o body simplesmente não existe.**
 *
 * O body nunca anda sozinho: ele viaja dentro de um `RunDescriptor`, que é um
 * par `{hash, body}`. Quem quer o body pergunta por ele passando o hash da
 * corrida ativa (`bodyForRun`), e recebe `null` quando os hashes divergem.
 * Não há como escrever um body sem dizer de que corrida ele é, então a
 * incoerência deixou de depender de booleanos coordenados — ela não tem mais
 * como ser representada.
 *
 * Separado da tela para rodar sob `node --test` sem DOM, como
 * ./studio-body.ts, ./image-fit.ts e ../wizard/wizard-progress.ts.
 */
import { resumoRecuperado, resumoStudio } from '../../../strings/laboratorio.ts';
import type { SpriteLabBody, SpriteLabResult } from './studio-body.ts';

// ------------------------------------------------------------------
// Espelho cliente do GET /api/sprite-lab (server/sprite-lab.ts)
// ------------------------------------------------------------------
// Mesma regra do studio-body.ts: a rota é a fronteira, o módulo do servidor
// não é importado aqui.

export interface RunConfigDTO {
	readonly description: string;
	readonly view: string;
	readonly size: number;
	readonly outputs: number;
	readonly noBackground: boolean;
	readonly enhancePrompt: boolean;
	readonly seed?: number;
	readonly outline?: string;
	readonly detail?: string;
	readonly templateId?: string;
	readonly hadReference: boolean;
}

export interface RunSummaryDTO {
	readonly hash: string;
	readonly at: string;
	readonly candidateCount: number;
	readonly candidates: readonly {
		readonly index: number;
		readonly seed: number;
		readonly southUrl: string;
	}[];
	/** Ausente nas corridas gravadas antes de o manifesto guardar a config. */
	readonly config?: RunConfigDTO;
}

/** Recorte de `studio.jobs[key]` que interessa aqui. */
export interface JobSnapshot {
	readonly status: string;
}

/** Corrida em voo que o painel está sondando. */
export interface PendingRun {
	readonly key: string;
	readonly hash: string;
}

/**
 * O body e o resumo de uma corrida, AMARRADOS ao hash dela.
 *
 * `body: null` é honesto e comum: manifesto legado (gravado antes de o
 * servidor guardar a config) ou job reencontrado em voo, cujo manifesto ainda
 * não existe. Sem config não há bundle, e a tela explica isso.
 */
export interface RunDescriptor {
	readonly hash: string;
	readonly summary: string;
	readonly body: SpriteLabBody | null;
}

/**
 * A corrida que ESTA montagem do painel passou a possuir — por ter recolado a
 * um job em voo ou por ter disparado um POST daqui.
 *
 * `hash: null` é a janela entre o clique em "Gerar" e a chegada do 202: a
 * montagem já possui uma corrida, o hash dela ainda não voltou do servidor.
 * A distinção importa porque é exatamente nessa janela que a recuperação em
 * disco (disparada no mount) pode chegar atrasada e tentar tomar a tela.
 */
export interface OwnedRun {
	readonly hash: string | null;
}

/**
 * Prefixo da chave de job do sprite-lab em `studio.jobs` (`api.ts` monta
 * `sprite-lab::<hash>`). O hash sai da própria chave — é o único lugar onde
 * ele sobrevive a um remount do painel.
 */
export const JOB_KEY_PREFIX = 'sprite-lab::';

/** Formato do hash produzido por `spriteLabHash` — hex de 16 chars. */
const HASH_RE = /^[a-f0-9]{16}$/i;

// ------------------------------------------------------------------
// Descritores
// ------------------------------------------------------------------

/**
 * Reconstrói o body que gerou a corrida a partir da config do manifesto — é
 * ele que o bundle de export documenta. `hadReference` não volta ao body: os
 * bytes da referência não são guardados, e o bundle nunca os carregou.
 */
export function bodyFromRunConfig(c: RunConfigDTO): SpriteLabBody {
	return {
		description: c.description,
		view: c.view,
		size: c.size,
		noBackground: c.noBackground,
		enhancePrompt: c.enhancePrompt,
		outputs: c.outputs,
		...(c.seed !== undefined ? { seed: c.seed } : {}),
		...(c.outline !== undefined ? { outline: c.outline } : {}),
		...(c.detail !== undefined ? { detail: c.detail } : {}),
		...(c.templateId !== undefined ? { templateId: c.templateId } : {}),
	};
}

/** Descritor de uma corrida do catálogo: pela config, ou só pelo hash. */
export function describeRun(run: RunSummaryDTO): RunDescriptor {
	if (run.config === undefined) {
		return { hash: run.hash, summary: resumoRecuperado(run.hash), body: null };
	}
	return {
		hash: run.hash,
		summary: resumoStudio(run.config.size, run.config.view, run.config.outputs),
		body: bodyFromRunConfig(run.config),
	};
}

/**
 * Descritor de uma corrida da qual só se sabe o hash — o job reencontrado em
 * voo. O body que a gerou não está em lugar nenhum enquanto o manifesto não
 * existir, e inventar um seria pior que não ter.
 */
export function describeLiveRun(hash: string): RunDescriptor {
	return { hash, summary: resumoRecuperado(hash), body: null };
}

// ------------------------------------------------------------------
// Identidade da corrida na tela
// ------------------------------------------------------------------

/**
 * Hash da corrida que a tela está descrevendo agora. Quem está em voo manda:
 * o resultado ainda visível é de uma corrida anterior até o job entregar.
 */
export function activeRunHash(
	pendingHash: string | null,
	resultHash: string | null,
): string | null {
	return pendingHash ?? resultHash;
}

/**
 * O body do descritor — SÓ se ele descrever a corrida ativa. Este é o ponto
 * único por onde o body chega ao bundle de export; um descritor de outra
 * corrida devolve `null`, e "Baixar JSON" fica desabilitado em vez de
 * exportar uma config que não gerou aqueles candidatos.
 */
export function bodyForRun(
	descriptor: RunDescriptor | null,
	activeHash: string | null,
): SpriteLabBody | null {
	if (descriptor === null || activeHash === null) return null;
	return descriptor.hash === activeHash ? descriptor.body : null;
}

/** O resumo do descritor, sob a mesma regra de identidade do body. */
export function summaryForRun(
	descriptor: RunDescriptor | null,
	activeHash: string | null,
): string {
	if (descriptor === null || activeHash === null) return '';
	return descriptor.hash === activeHash ? descriptor.summary : '';
}

// ------------------------------------------------------------------
// Recolagem a uma corrida em voo
// ------------------------------------------------------------------

export type ReattachPlan =
	/** Ainda não houve snapshot do estúdio — decidir agora seria decidir cedo. */
	| { readonly kind: 'wait' }
	/** Snapshot lido, nada em voo: a recolagem está resolvida para esta montagem. */
	| { readonly kind: 'none' }
	| {
			readonly kind: 'reattach';
			readonly pending: PendingRun;
			readonly descriptor: RunDescriptor;
			/**
			 * true quando a tela mostra os candidatos de OUTRA corrida (a
			 * recuperação em disco chegou primeiro). A corrida viva assume a
			 * tela inteira: exibir os candidatos de uma e o andamento de outra
			 * é o mesmo defeito de identidade, só que na parte visual.
			 */
			readonly clearResult: boolean;
	  };

/**
 * Decide se o painel deve voltar a acompanhar um job que já estava rodando.
 * O job continua no servidor enquanto a aba está fechada; o que se perde é a
 * sondagem, e a chave `sprite-lab::<hash>` devolve o hash de graça.
 */
export function planReattach(
	jobs: Readonly<Record<string, JobSnapshot>> | undefined,
	resultHash: string | null,
): ReattachPlan {
	if (jobs === undefined) return { kind: 'wait' };
	const emVoo = Object.entries(jobs).find(
		([key, j]) => key.startsWith(JOB_KEY_PREFIX) && j.status === 'gerando',
	);
	if (emVoo === undefined) return { kind: 'none' };
	const key = emVoo[0];
	const hash = key.slice(JOB_KEY_PREFIX.length);
	if (!HASH_RE.test(hash)) return { kind: 'none' };
	return {
		kind: 'reattach',
		pending: { key, hash },
		descriptor: describeLiveRun(hash),
		clearResult: resultHash !== null && resultHash !== hash,
	};
}

// ------------------------------------------------------------------
// Recuperação a partir do disco (mount)
// ------------------------------------------------------------------

export interface DiskRecoveryInput {
	/** Catálogo do `GET /api/sprite-lab`, mais recente primeiro. */
	readonly runs: readonly RunSummaryDTO[];
	/** `status` do `GET /api/sprite-lab/<hash>` da corrida mais nova. */
	readonly newestStatus: string | undefined;
	readonly newestResult: SpriteLabResult | undefined;
	/** A corrida que esta montagem já possui, se possui alguma. */
	readonly owned: OwnedRun | null;
}

export type DiskRecoveryPlan =
	/** Só o histórico: a tela já pertence a uma corrida desta montagem. */
	| { readonly kind: 'skip' }
	| {
			readonly kind: 'apply';
			readonly result: SpriteLabResult;
			readonly descriptor: RunDescriptor;
			readonly selectedIndex: number | null;
	  };

/**
 * O disco é a memória do painel, mas só preenche tela VAZIA.
 *
 * A recuperação nasce no mount e leva dois requests sequenciais (catálogo e
 * depois os bytes da corrida mais nova). Nesse meio-tempo a montagem pode ter
 * ganhado uma corrida própria — recolada a um job em voo ou disparada pelo
 * botão "Gerar". Quando isso acontece, a corrida em disco é OUTRA, e mais
 * velha: instalá-la colocaria na tela o resultado de uma corrida e o
 * andamento de outra.
 *
 * Note que o teste é `owned !== null`, não `owned.hash !== null`: entre o
 * clique em "Gerar" e o 202 o hash ainda não existe, e mesmo assim a tela já
 * tem dono.
 */
export function planDiskRecovery(input: DiskRecoveryInput): DiskRecoveryPlan {
	if (input.owned !== null) return { kind: 'skip' };
	const newest = input.runs[0];
	if (newest === undefined) return { kind: 'skip' };
	if (input.newestStatus !== 'pronto' || input.newestResult === undefined) {
		return { kind: 'skip' };
	}
	// O catálogo e os bytes vêm de dois requests: se não falarem da mesma
	// corrida, não há nada coerente a instalar.
	if (input.newestResult.hash !== newest.hash) return { kind: 'skip' };
	return {
		kind: 'apply',
		result: input.newestResult,
		descriptor: describeRun(newest),
		selectedIndex: input.newestResult.candidates[0]?.index ?? null,
	};
}

// ------------------------------------------------------------------
// Preenchimento tardio do descritor (corrida recolada que terminou)
// ------------------------------------------------------------------

export interface DescriptorRefreshInput {
	/** Catálogo relido depois que a corrida recolada terminou. */
	readonly runs: readonly RunSummaryDTO[];
	/** Hash da corrida ativa na tela — o único descritor aceitável. */
	readonly activeHash: string | null;
}

/**
 * Uma corrida recolada em voo não tem body em memória: ele nunca esteve lá.
 * Quando ela termina, o manifesto passa a existir e o catálogo devolve a
 * config — sem isto o usuário vê a sprite paga e não consegue exportá-la.
 *
 * A busca é pelo hash da corrida ATIVA, nunca pela "mais recente": era daí
 * que vinha a contaminação. Por construção, o descritor devolvido só pode ser
 * o da corrida ativa, ou nenhum.
 */
export function planDescriptorRefresh(
	input: DescriptorRefreshInput,
): RunDescriptor | null {
	if (input.activeHash === null) return null;
	const mine = input.runs.find((r) => r.hash === input.activeHash);
	if (mine === undefined || mine.config === undefined) return null;
	return describeRun(mine);
}

/**
 * Aplica o descritor recém-lido sobre o que já estava lá, recusando o que
 * chegou tarde demais: se a tela já passou a descrever outra corrida enquanto
 * o catálogo era relido, o descritor antigo não entra.
 */
export function mergeDescriptor(
	current: RunDescriptor | null,
	incoming: RunDescriptor,
): RunDescriptor {
	if (current === null || current.hash === incoming.hash) return incoming;
	return current;
}
