/**
 * Montagem e validação local do body de POST /api/rotate-lab.
 *
 * Módulo puro (sem DOM, sem React) para ser testável com node --test —
 * a tela só coleta os valores brutos dos inputs e delega.
 *
 * Regra de ouro, herdada de server/rotate-lab.ts: o par
 * fromDirection+toDirection e directionChange são XOR — o MODO escolhido na
 * tela decide qual grupo entra no body, e o outro grupo não aparece nem
 * como chave vazia. As faixas (16–200, −180..180, −90..90) são as do spec
 * vendorizado, já validadas de novo no servidor; validar aqui só evita a
 * viagem de ida e volta com erro previsível.
 */
import type { Direction } from '../../../../server/model.ts';

export type RotateMode = 'directions' | 'angles';

/** Erros locais, mapeados para mensagens pt-BR na tela via S.laboratorio.erros. */
export type BodyErrorCode =
	| 'image-missing'
	| 'size-range'
	| 'direction-change-range'
	| 'view-change-range'
	| 'seed-invalid';

/** Valores brutos do formulário — inputs numéricos chegam como texto. */
export interface RotateLabRawForm {
	readonly imageBase64: string | null;
	readonly widthText: string;
	readonly heightText: string;
	readonly mode: RotateMode;
	readonly fromDirection: Direction;
	readonly toDirection: Direction;
	readonly fromView: string;
	readonly toView: string;
	readonly directionChangeText: string;
	readonly viewChangeText: string;
	readonly initImageBase64: string | null;
	readonly initImageStrength: number;
	readonly seedText: string;
	readonly isometric: boolean;
}

export type BuildBodyResult =
	| { readonly ok: true; readonly body: Record<string, unknown> }
	| { readonly ok: false; readonly code: BodyErrorCode };

/** Inteiro dentro de [min, max] ou null — '' e texto não numérico reprovam. */
function parseIntInRange(text: string, min: number, max: number): number | null {
	if (text.trim() === '') return null;
	const n = Number(text);
	if (!Number.isInteger(n) || n < min || n > max) return null;
	return n;
}

/**
 * Monta o body do POST. Chaves opcionais só existem quando informadas —
 * com exactOptionalPropertyTypes, omitir é diferente de mandar undefined.
 */
export function buildRotateLabBody(form: RotateLabRawForm): BuildBodyResult {
	if (form.imageBase64 === null || form.imageBase64 === '') {
		return { ok: false, code: 'image-missing' };
	}

	const width = parseIntInRange(form.widthText, 16, 200);
	const height = parseIntInRange(form.heightText, 16, 200);
	if (width === null || height === null) return { ok: false, code: 'size-range' };

	const body: Record<string, unknown> = {
		imageBase64: form.imageBase64,
		imageSize: { width, height },
	};

	// XOR do /rotate: o modo escolhido define o grupo que vai no body.
	if (form.mode === 'directions') {
		body['fromDirection'] = form.fromDirection;
		body['toDirection'] = form.toDirection;
		body['fromView'] = form.fromView;
		body['toView'] = form.toView;
	} else {
		const directionChange = parseIntInRange(form.directionChangeText, -180, 180);
		if (directionChange === null) return { ok: false, code: 'direction-change-range' };
		const viewChange = parseIntInRange(form.viewChangeText, -90, 90);
		if (viewChange === null) return { ok: false, code: 'view-change-range' };
		body['directionChange'] = directionChange;
		body['viewChange'] = viewChange;
	}

	// init_image_strength nunca viaja sem init_image (o servidor recusa).
	if (form.initImageBase64 !== null && form.initImageBase64 !== '') {
		body['initImageBase64'] = form.initImageBase64;
		body['initImageStrength'] = form.initImageStrength;
	}

	if (form.seedText.trim() !== '') {
		const seed = Number(form.seedText);
		if (!Number.isInteger(seed)) return { ok: false, code: 'seed-invalid' };
		body['seed'] = seed;
	}

	// isometric: omitido quando false (F0-09 — o servidor faz o mesmo).
	if (form.isometric) body['isometric'] = true;

	return { ok: true, body };
}
