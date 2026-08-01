/**
 * Ajuste da reference_image ao limite do create-character-v3 (máx 256×256).
 *
 * Módulo puro (sem DOM, sem React) para ser testável com node --test — o
 * redimensionamento em si acontece na tela, num <canvas> com
 * imageSmoothingEnabled=false (pixel art não pode borrar); aqui fica só a
 * decisão: precisa redimensionar e para quais dimensões.
 *
 * A proporção é sempre preservada: a escala é limitSide / maior lado, e os
 * dois lados são arredondados para o inteiro mais próximo — nunca acima do
 * limite, nunca abaixo de 1.
 */

/** Lado máximo da reference_image da v3, do spec vendorizado. */
export const REFERENCE_LIMIT = 256;

export interface FitResult {
	readonly width: number;
	readonly height: number;
	/** true quando as dimensões originais passavam do limite. */
	readonly resized: boolean;
}

/**
 * Calcula as dimensões-alvo para caber em `limit`×`limit` mantendo a
 * proporção. Devolve null para entrada inválida (não inteira, ≤ 0, NaN) —
 * a tela só chama com naturalWidth/naturalHeight, mas null é mais honesto
 * que uma exceção em módulo puro.
 */
export function fitWithinLimit(
	width: number,
	height: number,
	limit: number = REFERENCE_LIMIT,
): FitResult | null {
	if (
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		!Number.isInteger(limit) ||
		width <= 0 ||
		height <= 0 ||
		limit <= 0
	) {
		return null;
	}
	if (width <= limit && height <= limit) {
		return { width, height, resized: false };
	}
	const scale = limit / Math.max(width, height);
	// Math.max(1, …): lados muito finos (1×512) arredondariam para 0 sem o piso.
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
		resized: true,
	};
}
