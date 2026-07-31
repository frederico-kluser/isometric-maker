/**
 * Teste da montagem do body do laboratório de rotação (módulo puro, sem DOM).
 *
 * Propriedades verificadas:
 *   1. XOR do /rotate: o modo escolhido define o grupo de chaves no body e o
 *      outro grupo NÃO aparece — nem vazio.
 *   2. Faixas do spec vendorizado validadas localmente: imageSize 16–200,
 *      directionChange −180..180, viewChange −90..90 (inteiros).
 *   3. Opcionais: seed vazia é omitida; init_image_strength nunca vai sem
 *      init_image; isometric só entra quando true (F0-09).
 *
 * Execute com: node --test src/app/screens/laboratorio/body.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildRotateLabBody,
	type BodyErrorCode,
	type RotateLabRawForm,
} from './body.ts';

/** Formulário-base válido no modo directions — cada teste sobrescreve o que importa. */
const BASE: RotateLabRawForm = {
	imageBase64: 'aVBORw0KGgo=',
	widthText: '64',
	heightText: '64',
	mode: 'directions',
	fromDirection: 'south',
	toDirection: 'east',
	fromView: 'side',
	toView: 'low top-down',
	directionChangeText: '90',
	viewChangeText: '0',
	initImageBase64: null,
	initImageStrength: 300,
	seedText: '',
	isometric: false,
};

function okBody(form: Partial<RotateLabRawForm>): Record<string, unknown> {
	const r = buildRotateLabBody({ ...BASE, ...form });
	assert(r.ok, `esperava ok, veio ${r.ok === false ? r.code : ''}`);
	return r.body;
}

function errCode(form: Partial<RotateLabRawForm>): BodyErrorCode {
	const r = buildRotateLabBody({ ...BASE, ...form });
	assert(!r.ok, 'esperava erro, veio ok');
	return r.code;
}

// ------------------------------------------------------------------ XOR

test('modo directions: par from/to + views entram, ângulos não aparecem', () => {
	const body = okBody({});
	assert.equal(body['fromDirection'], 'south');
	assert.equal(body['toDirection'], 'east');
	assert.equal(body['fromView'], 'side');
	assert.equal(body['toView'], 'low top-down');
	assert.equal('directionChange' in body, false);
	assert.equal('viewChange' in body, false);
});

test('modo angles: directionChange/viewChange entram, par from/to não aparece', () => {
	const body = okBody({ mode: 'angles', directionChangeText: '-45', viewChangeText: '30' });
	assert.equal(body['directionChange'], -45);
	assert.equal(body['viewChange'], 30);
	assert.equal('fromDirection' in body, false);
	assert.equal('toDirection' in body, false);
	assert.equal('fromView' in body, false);
	assert.equal('toView' in body, false);
});

// ------------------------------------------------------------------ imagem e tamanho

test('sem imagem: image-missing', () => {
	assert.equal(errCode({ imageBase64: null }), 'image-missing');
	assert.equal(errCode({ imageBase64: '' }), 'image-missing');
});

test('imageSize vira par de números inteiros', () => {
	const body = okBody({ widthText: '128', heightText: '96' });
	assert.deepEqual(body['imageSize'], { width: 128, height: 96 });
});

test('imageSize fora de 16–200, vazio ou não inteiro: size-range', () => {
	assert.equal(errCode({ widthText: '15' }), 'size-range');
	assert.equal(errCode({ heightText: '201' }), 'size-range');
	assert.equal(errCode({ widthText: '' }), 'size-range');
	assert.equal(errCode({ heightText: '64.5' }), 'size-range');
	assert.equal(errCode({ widthText: 'abc' }), 'size-range');
});

// ------------------------------------------------------------------ ângulos

test('directionChange fora de −180..180 ou não inteiro: direction-change-range', () => {
	assert.equal(errCode({ mode: 'angles', directionChangeText: '-181' }), 'direction-change-range');
	assert.equal(errCode({ mode: 'angles', directionChangeText: '181' }), 'direction-change-range');
	assert.equal(errCode({ mode: 'angles', directionChangeText: '10.5' }), 'direction-change-range');
	assert.equal(errCode({ mode: 'angles', directionChangeText: '' }), 'direction-change-range');
});

test('viewChange fora de −90..90: view-change-range', () => {
	assert.equal(errCode({ mode: 'angles', viewChangeText: '91' }), 'view-change-range');
	assert.equal(errCode({ mode: 'angles', viewChangeText: '-91' }), 'view-change-range');
});

test('extremos válidos dos ângulos passam', () => {
	const body = okBody({ mode: 'angles', directionChangeText: '-180', viewChangeText: '90' });
	assert.equal(body['directionChange'], -180);
	assert.equal(body['viewChange'], 90);
});

// ------------------------------------------------------------------ opcionais

test('seed vazia é omitida; seed inteira entra; seed não inteira reprova', () => {
	assert.equal('seed' in okBody({ seedText: '' }), false);
	assert.equal('seed' in okBody({ seedText: '   ' }), false);
	assert.equal(okBody({ seedText: '42' })['seed'], 42);
	assert.equal(errCode({ seedText: 'abc' }), 'seed-invalid');
	assert.equal(errCode({ seedText: '1.5' }), 'seed-invalid');
});

test('init_image_strength nunca vai sem init_image', () => {
	const semInit = okBody({ initImageBase64: null, initImageStrength: 999 });
	assert.equal('initImageBase64' in semInit, false);
	assert.equal('initImageStrength' in semInit, false);

	const comInit = okBody({ initImageBase64: 'aW5pdA==', initImageStrength: 150 });
	assert.equal(comInit['initImageBase64'], 'aW5pdA==');
	assert.equal(comInit['initImageStrength'], 150);
});

test('isometric só entra quando true (F0-09)', () => {
	assert.equal('isometric' in okBody({ isometric: false }), false);
	assert.equal(okBody({ isometric: true })['isometric'], true);
});
