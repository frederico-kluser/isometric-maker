/**
 * Teste do cálculo de ajuste da reference_image ao limite da v3 (módulo puro).
 *
 * Propriedades verificadas:
 *   1. Imagem dentro do limite (≤ 256 nos dois lados) volta intacta, resized=false.
 *   2. Imagem acima do limite é escalada pela MAIOR dimensão, com proporção
 *      preservada dentro do arredondamento, nunca estourando o limite e nunca
 *      zerando um lado.
 *   3. Entrada inválida (zero, negativo, não inteiro, NaN) devolve null.
 *
 * Execute com: node --test src/app/screens/laboratorio/image-fit.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitWithinLimit, REFERENCE_LIMIT } from './image-fit.ts';

// ------------------------------------------------------------------ dentro do limite

test('dentro do limite: dimensões intactas, resized=false', () => {
	assert.deepEqual(fitWithinLimit(256, 256), { width: 256, height: 256, resized: false });
	assert.deepEqual(fitWithinLimit(100, 255), { width: 100, height: 255, resized: false });
	assert.deepEqual(fitWithinLimit(1, 1), { width: 1, height: 1, resized: false });
});

// ------------------------------------------------------------------ acima do limite

test('quadrada acima do limite cai para 256×256', () => {
	assert.deepEqual(fitWithinLimit(512, 512), { width: 256, height: 256, resized: true });
});

test('a maior dimensão manda na escala, proporção preservada', () => {
	// Larga: width manda. 512×256 → escala 1/2 → 256×128.
	assert.deepEqual(fitWithinLimit(512, 256), { width: 256, height: 128, resized: true });
	// Alta: height manda. 1000×500 → escala 0.256 → 256×128.
	assert.deepEqual(fitWithinLimit(1000, 500), { width: 256, height: 128, resized: true });
	// 640×480 → escala 0.4 → 256×192.
	assert.deepEqual(fitWithinLimit(640, 480), { width: 256, height: 192, resized: true });
});

test('arredondamento vai para o inteiro mais próximo', () => {
	// 513×100 → escala 256/513 ≈ 0.499 → 100×0.499 = 49.9 → 50.
	assert.deepEqual(fitWithinLimit(513, 100), { width: 256, height: 50, resized: true });
});

test('nenhum lado estoura o limite nem zera, em uma varredura de tamanhos', () => {
	const casos: readonly (readonly [number, number])[] = [
		[257, 1],
		[1, 257],
		[3, 1000],
		[1000, 3],
		[300, 299],
		[8192, 16],
		[16, 8192],
		[257, 256],
		[256, 257],
	];
	for (const [w, h] of casos) {
		const fit = fitWithinLimit(w, h);
		assert(fit !== null, `${w}×${h} devolveu null`);
		assert.equal(fit.resized, true, `${w}×${h} devia marcar resized`);
		assert(fit.width <= REFERENCE_LIMIT, `${w}×${h} → width ${fit.width} estourou`);
		assert(fit.height <= REFERENCE_LIMIT, `${w}×${h} → height ${fit.height} estourou`);
		assert(fit.width >= 1 && fit.height >= 1, `${w}×${h} → lado zerado`);
		// Proporção preservada dentro do arredondamento (tolerância de 1px).
		const esperado = Math.max(w, h) === w ? (h * REFERENCE_LIMIT) / w : (w * REFERENCE_LIMIT) / h;
		const obtido = Math.max(w, h) === w ? fit.height : fit.width;
		assert(
			Math.abs(obtido - esperado) <= 1,
			`${w}×${h} → proporção quebrou: esperado ~${esperado}, veio ${obtido}`,
		);
	}
});

// ------------------------------------------------------------------ entrada inválida

test('entrada inválida devolve null', () => {
	assert.equal(fitWithinLimit(0, 100), null);
	assert.equal(fitWithinLimit(100, 0), null);
	assert.equal(fitWithinLimit(-5, 100), null);
	assert.equal(fitWithinLimit(100.5, 100), null);
	assert.equal(fitWithinLimit(Number.NaN, 100), null);
	assert.equal(fitWithinLimit(100, 100, 0), null);
});

// ------------------------------------------------------------------ limite customizado

test('limite customizado é respeitado', () => {
	// 300×200 com limite 100 → escala 1/3 → 100×66.67 → 100×67.
	assert.deepEqual(fitWithinLimit(300, 200, 100), { width: 100, height: 67, resized: true });
	assert.deepEqual(fitWithinLimit(50, 50, 100), { width: 50, height: 50, resized: false });
});
