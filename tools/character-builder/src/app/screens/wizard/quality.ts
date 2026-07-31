/**
 * Presets do seletor de qualidade do passo de configuração. Os enums de
 * estilo (detail/shading/outline) e o tipo do lock vêm de server/model.ts —
 * fonte única, verificada contra o spec vendorizado em 2026-07-31; aqui
 * ficam só as escolhas da UI.
 *
 * O preset "Máxima" é o decidido na pesquisa (TASK_PLAN 4b): 128px +
 * highly detailed + detailed shading + selective outline + guidance 8 —
 * guidance NÃO sobe além de 8 (supersaturação, docs oficiais; o spec dá
 * default 8 para text_guidance_scale). Rascunho e Padrão são escolhas do
 * estúdio: o Padrão ancora nos defaults que o spec documenta para
 * /create-character-with-8-directions, o Rascunho desce um degrau em tudo.
 * O spec não dita preset nenhum — registrado para não fingir certeza.
 *
 * O vendor descreve detail/shading/outline como "soft guidance — the model
 * may not follow exactly": a UI repete isso na nota de wizard.config.
 */
import {
	type DetailOption,
	type OutlineOption,
	type ShadingOption,
} from '../../../../server/model.ts';

/** Faixa do guidance do formulário — mesma do lock (text_guidance_scale,
 *  inteiro 1–20 no spec). */
export const GUIDANCE_MIN = 1;
export const GUIDANCE_MAX = 20;

export interface QualityValues {
	readonly size: number;
	readonly detail: DetailOption;
	readonly shading: ShadingOption;
	readonly outline: OutlineOption;
	readonly guidanceScale: number;
}

export type QualityPresetId = 'rascunho' | 'padrao' | 'maxima';

export const QUALITY_PRESETS: Readonly<Record<QualityPresetId, QualityValues>> = {
	rascunho: {
		size: 64,
		detail: 'low detail',
		shading: 'flat shading',
		outline: 'single color black outline',
		guidanceScale: 4,
	},
	padrao: {
		size: 96,
		detail: 'medium detail',
		shading: 'basic shading',
		outline: 'single color black outline',
		guidanceScale: 6,
	},
	maxima: {
		size: 128,
		detail: 'highly detailed',
		shading: 'detailed shading',
		outline: 'selective outline',
		guidanceScale: 8,
	},
};

export const QUALITY_PRESET_IDS: readonly QualityPresetId[] = [
	'rascunho',
	'padrao',
	'maxima',
];

/** Preset cujos valores batem exatamente; undefined quando o usuário
 *  customizou algum campo no Avançado (o toggle fica sem seleção). */
export function matchPreset(values: QualityValues): QualityPresetId | undefined {
	return QUALITY_PRESET_IDS.find((id) => {
		const p = QUALITY_PRESETS[id];
		return (
			p.size === values.size &&
			p.detail === values.detail &&
			p.shading === values.shading &&
			p.outline === values.outline &&
			p.guidanceScale === values.guidanceScale
		);
	});
}
