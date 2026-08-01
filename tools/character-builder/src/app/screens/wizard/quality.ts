/**
 * Presets do seletor de qualidade do passo de configuração. Os enums de
 * estilo (detail/outline) e o tipo do lock vêm de server/model.ts —
 * fonte única, verificada contra o spec vendorizado em 2026-07-31; aqui
 * ficam só as escolhas da UI.
 *
 * Com a migração para create-character-v3 (2026-07-31):
 * - shading e guidanceScale removidos — o v3 não tem esses parâmetros.
 * - detail e outline permanecem mas são IGNORADOS em modo reference_image
 *   (progressivo); só valem no modo from-scratch (direto).
 * - O teto de size subiu de 128 para 256 (v3 from-scratch).
 *
 * O vendor descreve detail/outline como "soft guidance — the model
 * may not follow exactly": a UI repete isso na nota de wizard.config.
 */
import {
	type DetailOption,
	type OutlineOption,
} from '../../../../server/model.ts';

export interface QualityValues {
	readonly size: number;
	readonly detail: DetailOption;
	readonly outline: OutlineOption;
}

export type QualityPresetId = 'rascunho' | 'padrao' | 'maxima';

export const QUALITY_PRESETS: Readonly<Record<QualityPresetId, QualityValues>> = {
	rascunho: {
		size: 64,
		detail: 'low detail',
		outline: 'single color black outline',
	},
	padrao: {
		size: 96,
		detail: 'medium detail',
		outline: 'single color black outline',
	},
	maxima: {
		size: 128,
		detail: 'highly detailed',
		outline: 'selective outline',
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
			p.outline === values.outline
		);
	});
}
