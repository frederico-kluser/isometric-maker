/**
 * Teste da montagem do body do Sprite Studio e do bundle sprite-lab-south
 * (módulo puro, sem DOM).
 *
 * Propriedades verificadas:
 *   1. Obrigatórios: description não vazia (aparada), view do enum, size dos
 *      presets, outputs 1–4 inteiro.
 *   2. Opcionais omitidos de verdade (F0-09): seed vazia, outline/detail/
 *      templateId no '' e reference_image ausente NÃO viram chave no body.
 *   3. noBackground e enhancePrompt sempre viajam — escolha explícita da bancada.
 *   4. Bundle: kind/version/exportedAt fixos, selected bate com a seleção,
 *      config NÃO carrega referenceImageBase64 nem outputs, e a seed cai para
 *      a do primeiro candidato quando o usuário não informou uma.
 *
 * Execute com: node --test src/app/screens/laboratorio/studio-body.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildLabBundle,
	buildSpriteLabBody,
	SIZE_PRESETS,
	type BuildStudioBodyResult,
	type SpriteLabBody,
	type SpriteLabCandidate,
	type StudioErrorCode,
	type StudioRawForm,
} from './studio-body.ts';

/** Formulário-base válido, todo opcional no default — cada teste sobrescreve o que importa. */
const BASE: StudioRawForm = {
	description: 'guerreiro de armadura enferrujada',
	view: 'low top-down',
	size: 128,
	seedText: '',
	noBackground: true,
	outline: '',
	detail: '',
	enhancePrompt: false,
	templateId: '',
	referenceImageBase64: null,
	outputs: 1,
};

function okBody(form: Partial<StudioRawForm>): SpriteLabBody {
	const r: BuildStudioBodyResult = buildSpriteLabBody({ ...BASE, ...form });
	assert(r.ok, `esperava ok, veio ${r.ok === false ? r.code : ''}`);
	return r.body;
}

function errCode(form: Partial<StudioRawForm>): StudioErrorCode {
	const r = buildSpriteLabBody({ ...BASE, ...form });
	assert(!r.ok, 'esperava erro, veio ok');
	return r.code;
}

// ------------------------------------------------------------------ obrigatórios

test('formulário-base válido: só os fixos vão, opcionais não aparecem', () => {
	const body = okBody({});
	assert.equal(body.description, 'guerreiro de armadura enferrujada');
	assert.equal(body.view, 'low top-down');
	assert.equal(body.size, 128);
	assert.equal(body.noBackground, true);
	assert.equal(body.enhancePrompt, false);
	assert.equal(body.outputs, 1);
	assert.equal('seed' in body, false);
	assert.equal('outline' in body, false);
	assert.equal('detail' in body, false);
	assert.equal('templateId' in body, false);
	assert.equal('referenceImageBase64' in body, false);
});

test('description vazia ou só espaços: description-missing', () => {
	assert.equal(errCode({ description: '' }), 'description-missing');
	assert.equal(errCode({ description: '   ' }), 'description-missing');
});

test('description é aparada antes de ir para o body', () => {
	assert.equal(okBody({ description: '  mago azul  ' }).description, 'mago azul');
});

test('view fora do enum: view-invalid; as três do spec passam', () => {
	assert.equal(errCode({ view: 'isometric' }), 'view-invalid');
	for (const view of ['low top-down', 'high top-down', 'side']) {
		assert.equal(okBody({ view }).view, view);
	}
});

test('size fora dos presets (mesmo dentro de 32–256): size-invalid', () => {
	assert.equal(errCode({ size: 100 }), 'size-invalid');
	assert.equal(errCode({ size: 16 }), 'size-invalid');
	assert.equal(errCode({ size: 512 }), 'size-invalid');
	assert.equal(errCode({ size: 128.5 }), 'size-invalid');
	for (const size of SIZE_PRESETS) {
		assert.equal(okBody({ size }).size, size);
	}
});

test('outputs fora de 1–4 ou não inteiro: outputs-range', () => {
	assert.equal(errCode({ outputs: 0 }), 'outputs-range');
	assert.equal(errCode({ outputs: 5 }), 'outputs-range');
	assert.equal(errCode({ outputs: 1.5 }), 'outputs-range');
	assert.equal(errCode({ outputs: Number.NaN }), 'outputs-range');
	for (const outputs of [1, 2, 3, 4]) {
		assert.equal(okBody({ outputs }).outputs, outputs);
	}
});

// ------------------------------------------------------------------ opcionais

test('seed vazia é omitida; seed inteira entra; seed não inteira reprova', () => {
	assert.equal('seed' in okBody({ seedText: '' }), false);
	assert.equal('seed' in okBody({ seedText: '   ' }), false);
	assert.equal(okBody({ seedText: '42' }).seed, 42);
	assert.equal(okBody({ seedText: '-7' }).seed, -7);
	assert.equal(errCode({ seedText: 'abc' }), 'seed-invalid');
	assert.equal(errCode({ seedText: '1.5' }), 'seed-invalid');
});

test("enums opcionais: '' é omitido, valor do enum entra, valor estranho é omitido", () => {
	const body = okBody({
		outline: 'lineless',
		detail: 'highly detailed',
		templateId: 'cat',
	});
	assert.equal(body.outline, 'lineless');
	assert.equal(body.detail, 'highly detailed');
	assert.equal(body.templateId, 'cat');

	// A tela nunca produz valor fora do enum, mas o módulo não confia nela.
	const estranho = okBody({ outline: 'grosso', detail: 'muito', templateId: 'wolf' });
	assert.equal('outline' in estranho, false);
	assert.equal('detail' in estranho, false);
	assert.equal('templateId' in estranho, false);
});

test('reference_image ausente ou vazia é omitida; presente entra', () => {
	assert.equal('referenceImageBase64' in okBody({ referenceImageBase64: null }), false);
	assert.equal('referenceImageBase64' in okBody({ referenceImageBase64: '' }), false);
	assert.equal(
		okBody({ referenceImageBase64: 'aVBORw0KGgo=' }).referenceImageBase64,
		'aVBORw0KGgo=',
	);
});

test('noBackground e enhancePrompt sempre viajam, inclusive false', () => {
	const body = okBody({ noBackground: false, enhancePrompt: true });
	assert.equal(body.noBackground, false);
	assert.equal(body.enhancePrompt, true);
});

// ------------------------------------------------------------------ bundle

const CANDIDATES: readonly SpriteLabCandidate[] = [
	{ index: 0, seed: 700, southB64: 'Y2FuZGlkYXRvMA==' },
	{ index: 1, seed: 701, southB64: 'Y2FuZGlkYXRvMQ==' },
	{ index: 2, seed: 702, southB64: 'Y2FuZGlkYXRvMg==' },
];

test('bundle: kind/version/exportedAt fixos e seleção respeitada', () => {
	const bundle = buildLabBundle({
		body: okBody({ seedText: '700', outputs: 3 }),
		candidates: CANDIDATES,
		selectedIndex: 1,
		exportedAt: new Date('2026-08-01T12:00:00.000Z'),
	});
	assert(bundle !== null);
	assert.equal(bundle.kind, 'sprite-lab-south');
	assert.equal(bundle.version, 1);
	assert.equal(bundle.exportedAt, '2026-08-01T12:00:00.000Z');
	assert.deepEqual(bundle.selected, { index: 1, seed: 701, b64: 'Y2FuZGlkYXRvMQ==' });
	assert.equal(bundle.candidates.length, 3);
	assert.deepEqual(bundle.candidates[0], { index: 0, seed: 700, b64: 'Y2FuZGlkYXRvMA==' });
});

test('bundle: config documenta o que gerou o lote — sem referenceImage nem outputs', () => {
	const bundle = buildLabBundle({
		body: okBody({
			seedText: '42',
			outputs: 4,
			referenceImageBase64: 'aVBORw0KGgo=',
			outline: 'selective outline',
			enhancePrompt: true,
		}),
		candidates: CANDIDATES,
		selectedIndex: 0,
		exportedAt: new Date('2026-08-01T12:00:00.000Z'),
	});
	assert(bundle !== null);
	assert.equal(bundle.config.seed, 42);
	assert.equal(bundle.config.outline, 'selective outline');
	assert.equal(bundle.config.enhancePrompt, true);
	assert.equal('outputs' in bundle.config, false);
	assert.equal('referenceImageBase64' in bundle.config, false);
	assert.equal('detail' in bundle.config, false);
	assert.equal('templateId' in bundle.config, false);
});

test('bundle: sem seed informada, config.seed é a do primeiro candidato (base derivada)', () => {
	const bundle = buildLabBundle({
		body: okBody({}),
		candidates: CANDIDATES,
		selectedIndex: 2,
		exportedAt: new Date('2026-08-01T12:00:00.000Z'),
	});
	assert(bundle !== null);
	assert.equal(bundle.config.seed, 700);
});

test('bundle: sem candidatos ou seleção inexistente devolve null', () => {
	assert.equal(
		buildLabBundle({ body: okBody({}), candidates: [], selectedIndex: 0 }),
		null,
	);
	assert.equal(
		buildLabBundle({ body: okBody({}), candidates: CANDIDATES, selectedIndex: 9 }),
		null,
	);
});
