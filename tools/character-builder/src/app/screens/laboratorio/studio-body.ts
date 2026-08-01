/**
 * Montagem e validação local do body de POST /api/sprite-lab (Sprite Studio).
 *
 * Módulo puro (sem DOM, sem React) para ser testável com node --test —
 * a tela só coleta os valores brutos dos inputs e delega.
 *
 * Os tipos de resultado são ESPELHO do contrato do TASK_PLAN.md
 * (server/sprite-lab.ts, escrito por outro agente): NÃO importar o módulo
 * do servidor aqui — o cliente e o servidor evoluem em arquivos separados
 * e a rota é a única fronteira.
 *
 * Regras de omissão, herdadas do F0-09: seed vazia, outline/detail/templateId
 * no "padrão da API" ('') e reference_image ausente NÃO entram no body — a
 * API aplica os defaults dela. noBackground e enhancePrompt sempre viajam:
 * são escolhas explícitas da bancada, não herança.
 */
import {
	DETAIL_OPTIONS,
	OUTLINE_OPTIONS,
	TEMPLATE_OPTIONS,
	VIEW_OPTIONS,
} from '../../../../server/model.ts';

// ------------------------------------------------------------------
// Espelho cliente do contrato server/sprite-lab.ts (TASK_PLAN.md)
// ------------------------------------------------------------------

export interface SpriteLabUsage {
	readonly type?: string;
	readonly usd?: number | null;
	readonly generations?: number | null;
}

export interface SpriteLabCandidate {
	readonly index: number;
	readonly seed: number;
	/** b64 puro do frame south extraído da resposta da v3. */
	readonly southB64: string;
	readonly usage?: SpriteLabUsage;
}

export interface SpriteLabResult {
	readonly hash: string;
	readonly candidates: readonly SpriteLabCandidate[];
	readonly fromCache: boolean;
}

/** Aceito do POST /api/sprite-lab: 202 {key, hash}. */
export interface SpriteLabAccepted {
	readonly key: string;
	readonly hash: string;
}

// ------------------------------------------------------------------
// Bundle de export (sprite-lab-south) — espelho do TASK_PLAN.md
// ------------------------------------------------------------------

export interface LabBundleConfig {
	readonly description: string;
	readonly view: string;
	readonly size: number;
	readonly seed: number;
	readonly noBackground: boolean;
	readonly outline?: string;
	readonly detail?: string;
	readonly enhancePrompt: boolean;
	readonly templateId?: string;
}

export interface LabBundleCandidate {
	readonly index: number;
	readonly seed: number;
	readonly b64: string;
}

export interface SpriteLabSouthBundle {
	readonly kind: 'sprite-lab-south';
	readonly version: 1;
	readonly exportedAt: string;
	readonly config: LabBundleConfig;
	readonly selected: LabBundleCandidate;
	readonly candidates: readonly LabBundleCandidate[];
}

// ------------------------------------------------------------------
// Body do POST
// ------------------------------------------------------------------

/** Presets do Select de tamanho — faixa da v3 é 32–256 (spec vendorizado). */
export const SIZE_PRESETS = [32, 48, 64, 96, 128, 192, 256] as const;

export const DEFAULT_SIZE = 128;

/** Teto de saídas paralelas: a v3 responde 429 "Concurrency limit" acima disso. */
export const MAX_OUTPUTS = 4;

/** Erros locais, mapeados para mensagens pt-BR na tela via S.laboratorio.studio.erros. */
export type StudioErrorCode =
	| 'description-missing'
	| 'view-invalid'
	| 'size-invalid'
	| 'seed-invalid'
	| 'outputs-range';

/** Valores brutos do formulário — seed chega como texto; '' nas selects = padrão da API. */
export interface StudioRawForm {
	readonly description: string;
	readonly view: string;
	readonly size: number;
	readonly seedText: string;
	readonly noBackground: boolean;
	readonly outline: string;
	readonly detail: string;
	readonly enhancePrompt: boolean;
	readonly templateId: string;
	readonly referenceImageBase64: string | null;
	readonly outputs: number;
}

/**
 * Body tipado do POST /api/sprite-lab — chaves camelCase como o resto do
 * servidor (imageBase64, initImageStrength…). Opcionais ausentes de verdade
 * (exactOptionalPropertyTypes: omitir ≠ mandar undefined).
 */
export interface SpriteLabBody {
	readonly description: string;
	readonly view: string;
	readonly size: number;
	readonly seed?: number;
	readonly noBackground: boolean;
	readonly outline?: string;
	readonly detail?: string;
	readonly enhancePrompt: boolean;
	readonly templateId?: string;
	readonly referenceImageBase64?: string;
	readonly outputs: number;
}

export type BuildStudioBodyResult =
	| { readonly ok: true; readonly body: SpriteLabBody }
	| { readonly ok: false; readonly code: StudioErrorCode };

/**
 * Monta o body do POST. Chaves opcionais só existem quando informadas —
 * com exactOptionalPropertyTypes, omitir é diferente de mandar undefined.
 */
export function buildSpriteLabBody(form: StudioRawForm): BuildStudioBodyResult {
	const description = form.description.trim();
	if (description === '') return { ok: false, code: 'description-missing' };

	if (!(VIEW_OPTIONS as readonly string[]).includes(form.view)) {
		return { ok: false, code: 'view-invalid' };
	}

	if (
		!Number.isInteger(form.size) ||
		!(SIZE_PRESETS as readonly number[]).includes(form.size)
	) {
		return { ok: false, code: 'size-invalid' };
	}

	if (
		!Number.isInteger(form.outputs) ||
		form.outputs < 1 ||
		form.outputs > MAX_OUTPUTS
	) {
		return { ok: false, code: 'outputs-range' };
	}

	let seed: number | null = null;
	if (form.seedText.trim() !== '') {
		const n = Number(form.seedText);
		if (!Number.isInteger(n)) return { ok: false, code: 'seed-invalid' };
		seed = n;
	}

	// Enums opcionais só entram com valor válido — '' é "padrão da API" e
	// qualquer outra coisa fora do enum não viaja (a tela nunca produz isso,
	// mas o módulo puro não confia na tela).
	const outline = (OUTLINE_OPTIONS as readonly string[]).includes(form.outline)
		? form.outline
		: null;
	const detail = (DETAIL_OPTIONS as readonly string[]).includes(form.detail)
		? form.detail
		: null;
	const templateId = (TEMPLATE_OPTIONS as readonly string[]).includes(form.templateId)
		? form.templateId
		: null;

	return {
		ok: true,
		body: {
			description,
			view: form.view,
			size: form.size,
			noBackground: form.noBackground,
			enhancePrompt: form.enhancePrompt,
			outputs: form.outputs,
			...(seed !== null ? { seed } : {}),
			...(outline !== null ? { outline } : {}),
			...(detail !== null ? { detail } : {}),
			...(templateId !== null ? { templateId } : {}),
			...(form.referenceImageBase64 !== null && form.referenceImageBase64 !== ''
				? { referenceImageBase64: form.referenceImageBase64 }
				: {}),
		},
	};
}

// ------------------------------------------------------------------
// Bundle de export (download client-side)
// ------------------------------------------------------------------

export interface BuildBundleInput {
	/** O body já validado que foi ao POST — o bundle documenta o que gerou o lote. */
	readonly body: SpriteLabBody;
	readonly candidates: readonly SpriteLabCandidate[];
	/** index do candidato escolhido na grade. */
	readonly selectedIndex: number;
	/** Injetável para teste; default new Date(). */
	readonly exportedAt?: Date;
}

/**
 * Monta o bundle `sprite-lab-south` do TASK_PLAN.md. Devolve null quando não
 * há o que exportar (sem candidatos, ou seleção que não existe na grade).
 *
 * config.seed: a seed informada tem precedência; sem ela, entra a seed do
 * primeiro candidato — ela É a base derivada pelo servidor (candidato i =
 * base + i), então o bundle continua reproduzível.
 */
export function buildLabBundle(input: BuildBundleInput): SpriteLabSouthBundle | null {
	const selected = input.candidates.find((c) => c.index === input.selectedIndex);
	const first = input.candidates[0];
	if (selected === undefined || first === undefined) return null;

	const { body } = input;
	const config: LabBundleConfig = {
		description: body.description,
		view: body.view,
		size: body.size,
		seed: body.seed ?? first.seed,
		noBackground: body.noBackground,
		enhancePrompt: body.enhancePrompt,
		...(body.outline !== undefined ? { outline: body.outline } : {}),
		...(body.detail !== undefined ? { detail: body.detail } : {}),
		...(body.templateId !== undefined ? { templateId: body.templateId } : {}),
	};

	const toBundleCandidate = (c: SpriteLabCandidate): LabBundleCandidate => ({
		index: c.index,
		seed: c.seed,
		b64: c.southB64,
	});

	return {
		kind: 'sprite-lab-south',
		version: 1,
		exportedAt: (input.exportedAt ?? new Date()).toISOString(),
		config,
		selected: toBundleCandidate(selected),
		candidates: input.candidates.map(toBundleCandidate),
	};
}
