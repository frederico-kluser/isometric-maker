/**
 * Testes da derivação do progresso do wizard (node --test, sem DOM).
 *
 * O que está sob verificação é a regra "primeiro passo não concluído é o
 * ativo", incluindo os dois casos de borda que a tela encontra de verdade:
 * sul gerada antes da config travar, e personagem sem wizard state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	cardinalKey,
	directions8Key,
	seedStudio,
	southKey,
	type Cell,
	type Character,
	type Studio,
} from '../../../../server/model.ts';
import {
	deriveWizard,
	isMannequinReady,
	resolveCharacter,
	type WizardStepId,
} from './wizard-progress.ts';

// ------------------------------------------------------------------ helpers

function readyCell(key: string): Cell {
	return { key, status: 'pronto' };
}

function withLock(s: Studio): Studio {
	return { ...s, lock: { frameCount: 8, fps: 8, size: 64 } };
}

function withCell(s: Studio, key: string, cell?: Cell): Studio {
	return { ...s, cells: { ...s.cells, [key]: cell ?? readyCell(key) } };
}

function mannequin(s: Studio): Character {
	const ch = s.characters.find((c) => c.id === 'manequim');
	assert.ok(ch, 'seed sempre tem o manequim');
	return ch;
}

function statusMap(p: ReturnType<typeof deriveWizard>): Record<WizardStepId, string> {
	return Object.fromEntries(p.steps.map((s) => [s.id, s.status])) as Record<
		WizardStepId,
		string
	>;
}

// ------------------------------------------------------------------ casos

test('estado inicial: config é o passo ativo, primeira execução', () => {
	const s = seedStudio();
	const p = deriveWizard(s, mannequin(s));

	assert.equal(p.activeStep, 'config');
	assert.equal(p.locked, false);
	assert.equal(p.southReady, false);
	assert.equal(p.firstRun, true);
	assert.deepEqual(statusMap(p), {
		config: 'active',
		sul: 'todo',
		cardeais: 'todo',
		direcoes8: 'todo',
		pronto: 'todo',
	});
});

test('config travada: sul vira o passo ativo', () => {
	const s = withLock(seedStudio());
	const p = deriveWizard(s, mannequin(s));

	assert.equal(p.activeStep, 'sul');
	assert.equal(statusMap(p)['config'], 'done');
	assert.equal(statusMap(p)['sul'], 'active');
	// Lock sozinho não sai da primeira execução: ainda não há versão nenhuma.
	assert.equal(p.firstRun, true);
});

test('sul pronta: cardeais vira o passo ativo', () => {
	const s = withCell(withLock(seedStudio()), southKey('manequim'));
	const p = deriveWizard(s, mannequin(s));

	assert.equal(p.activeStep, 'cardeais');
	assert.equal(p.southReady, true);
	assert.equal(p.firstRun, false);
});

test('sul gerada sem lock: o passo ativo continua sendo a config', () => {
	// O servidor permite gerar a sul antes de travar a config — sem lock,
	// porém, as 8 direções não saem. A trilha aponta a config como pendente.
	const s = withCell(seedStudio(), southKey('manequim'));
	const p = deriveWizard(s, mannequin(s));

	assert.equal(p.activeStep, 'config');
	assert.equal(p.southReady, true);
	assert.equal(statusMap(p)['sul'], 'done');
	assert.equal(statusMap(p)['config'], 'active');
});

test('cardeais parciais: o passo continua em cardeais', () => {
	let s = withCell(withLock(seedStudio()), southKey('manequim'));
	s = withCell(s, cardinalKey('manequim', 'east'));
	s = withCell(s, cardinalKey('manequim', 'north'));
	const p = deriveWizard(s, mannequin(s));

	assert.equal(p.cardinalsReady, false);
	assert.equal(p.activeStep, 'cardeais');
});

test('tudo pronto e etapa pronto: trilha inteira concluída', () => {
	let s = withLock(seedStudio());
	s = withCell(s, southKey('manequim'));
	for (const d of ['east', 'north', 'west'] as const) {
		s = withCell(s, cardinalKey('manequim', d));
	}
	s = withCell(s, directions8Key('manequim'));
	const ch = mannequin(s);
	ch.wizard = { etapa: 'pronto', southVersions: [], activeSouth: 0 };
	const p = deriveWizard(s, ch);

	assert.equal(p.ready, true);
	assert.equal(p.activeStep, 'pronto');
	assert.ok(p.steps.every((step) => step.status === 'done'));
	assert.equal(isMannequinReady(s), true);
});

test('isMannequinReady: false no seed, false com células mas sem etapa pronto', () => {
	assert.equal(isMannequinReady(seedStudio()), false);

	let s = withCell(withLock(seedStudio()), southKey('manequim'));
	s = withCell(s, directions8Key('manequim'));
	// Células prontas mas wizard.etapa ainda 'sul' (estado intermediário).
	assert.equal(isMannequinReady(s), false);
});

test('personagem sem wizard state: tratado como primeira etapa', () => {
	const s = withLock(seedStudio());
	const derivado: Character = {
		id: 'cavaleiro',
		label: 'Cavaleiro',
		silhouette: 'humano-medio',
		description: 'a knight',
		size: 64,
		seed: 42,
		createdAt: new Date().toISOString(),
	};
	s.characters.push(derivado);
	const p = deriveWizard(s, derivado);

	assert.equal(p.wizard.etapa, 'sul');
	assert.equal(p.activeStep, 'sul'); // lock global já travado
	assert.equal(p.firstRun, false); // primeira execução é só do manequim
});

test('resolveCharacter: id desconhecido cai no manequim', () => {
	const s = seedStudio();
	assert.equal(resolveCharacter(s, 'nao-existe')?.id, 'manequim');
	assert.equal(resolveCharacter(s, 'manequim')?.id, 'manequim');
});

test('células gerando marcam os flags de progresso', () => {
	let s = withLock(seedStudio());
	s = withCell(s, southKey('manequim'), {
		key: southKey('manequim'),
		status: 'gerando',
	});
	const p = deriveWizard(s, mannequin(s));

	assert.equal(p.southGenerating, true);
	assert.equal(p.southReady, false);
	assert.equal(p.activeStep, 'sul');
});
