/**
 * Testes do escopo de bloqueio (node --test, sem DOM).
 *
 * O que está sob verificação é a substituição do mutex GLOBAL: um job só pode
 * bloquear o que ele de fato impede. As propriedades:
 *
 *   1. Bancada (`sprite-lab::`, `world-block::`) não bloqueia wizard nenhum —
 *      era esse o congelamento que motivou o módulo.
 *   2. Job de OUTRO personagem não bloqueia este.
 *   3. Job da MESMA etapa bloqueia — o mutex que não pode ser afrouxado.
 *   4. `'na-fila'` bloqueia igual a `'gerando'`, e o status volta distinto.
 *   5. Sem job, nada bloqueia.
 *   6. Personagem cujo id COLIDE com o nome de uma bancada continua bloqueando
 *      — o desempate cai para o lado de bloquear, não para o do silêncio.
 *   7. Entre dois jobs `mesmo-personagem`, o vencedor é determinístico.
 *
 * Execute com: node --test src/app/job-scope.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	cardinalKey,
	cardinalsBatchKey,
	cellKey,
	directions8Key,
	southKey,
	wardrobeKey,
} from '../../server/model.ts';
import {
	characterOf,
	isBusyStatus,
	parseJobScope,
	wizardStepBlock,
	type JobLike,
} from './job-scope.ts';

// ------------------------------------------------------------------ helpers

const CHAR = 'manequim';
const OUTRO = 'guarda';

function jobs(
	entries: Record<string, string>,
	labels: Record<string, string> = {},
): Record<string, JobLike> {
	const out: Record<string, JobLike> = {};
	for (const [key, status] of Object.entries(entries)) {
		const label = labels[key];
		out[key] = label === undefined ? { status } : { status, label };
	}
	return out;
}

// ------------------------------------------------------------------ parse

test('sentinelas saem de server/model.ts, não de literais copiados', () => {
	assert.deepEqual(parseJobScope(southKey(CHAR)), {
		kind: 'wizard',
		characterId: CHAR,
		step: 'sul',
	});
	assert.deepEqual(parseJobScope(directions8Key(CHAR)), {
		kind: 'wizard',
		characterId: CHAR,
		step: 'direcoes8',
	});
	assert.deepEqual(parseJobScope(cardinalsBatchKey(CHAR)), {
		kind: 'wizard',
		characterId: CHAR,
		step: 'cardeais',
	});
	assert.deepEqual(parseJobScope(cardinalKey(CHAR, 'east')), {
		kind: 'wizard',
		characterId: CHAR,
		step: 'cardeais',
	});
});

test('pose e peça saem de cellKey e wardrobeKey', () => {
	assert.deepEqual(parseJobScope(cellKey(CHAR, 'correndo')), {
		kind: 'pose',
		characterId: CHAR,
		poseId: 'correndo',
	});
	assert.deepEqual(parseJobScope(wardrobeKey(CHAR, 'elmo-de-ferro')), {
		kind: 'wardrobe',
		characterId: CHAR,
		itemId: 'elmo-de-ferro',
	});
});

test('bancada ganha do formato de cellKey — a precedência é o contrato', () => {
	// `sprite-lab::<hash>` tem a MESMA forma de cellKey('sprite-lab', hash).
	assert.deepEqual(parseJobScope('sprite-lab::abc123'), {
		kind: 'bench',
		bench: 'sprite-lab',
		hash: 'abc123',
	});
	assert.deepEqual(parseJobScope('world-block::deadbeef'), {
		kind: 'bench',
		bench: 'world-block',
		hash: 'deadbeef',
	});
	assert.equal(characterOf(parseJobScope('sprite-lab::abc123')), undefined);
	assert.equal(characterOf(parseJobScope('world-block::deadbeef')), undefined);
});

test('chave sem dono não vira personagem nenhum', () => {
	assert.deepEqual(parseJobScope('avulso'), { kind: 'unknown', key: 'avulso' });
	assert.deepEqual(parseJobScope('::orfa'), { kind: 'unknown', key: '::orfa' });
	assert.equal(characterOf(parseJobScope('avulso')), undefined);
});

test('isBusyStatus: só na-fila e gerando; terminais não', () => {
	assert.equal(isBusyStatus('na-fila'), true);
	assert.equal(isBusyStatus('gerando'), true);
	assert.equal(isBusyStatus('pronto'), false);
	assert.equal(isBusyStatus('falhou'), false);
	assert.equal(isBusyStatus('cancelado'), false);
	assert.equal(isBusyStatus(undefined), false);
	assert.equal(isBusyStatus('vazio'), false);
});

// ------------------------------------------------------------------ bloqueio

test('nenhum job: nada bloqueia', () => {
	assert.deepEqual(wizardStepBlock({}, CHAR, 'sul'), { blocked: false });
	assert.deepEqual(wizardStepBlock(undefined, CHAR, 'direcoes8'), {
		blocked: false,
	});
});

test('job de bancada NÃO bloqueia o wizard — era o congelamento global', () => {
	const j = jobs({
		'world-block::deadbeef': 'gerando',
		'sprite-lab::abc123': 'gerando',
	});
	assert.deepEqual(wizardStepBlock(j, CHAR, 'sul'), { blocked: false });
	assert.deepEqual(wizardStepBlock(j, CHAR, 'direcoes8'), { blocked: false });
});

test('job de OUTRO personagem não bloqueia este', () => {
	const j = jobs({
		[southKey(OUTRO)]: 'gerando',
		[cellKey(OUTRO, 'correndo')]: 'na-fila',
		[wardrobeKey(OUTRO, 'elmo')]: 'gerando',
	});
	assert.deepEqual(wizardStepBlock(j, CHAR, 'sul'), { blocked: false });
	assert.deepEqual(wizardStepBlock(j, CHAR, 'direcoes8'), { blocked: false });
	// E o dono continua bloqueado — o escopo estreitou, não sumiu.
	assert.equal(wizardStepBlock(j, OUTRO, 'sul').blocked, true);
});

test('job da MESMA etapa bloqueia: o mutex do dinheiro continua de pé', () => {
	const j = jobs(
		{ [southKey(CHAR)]: 'gerando' },
		{ [southKey(CHAR)]: 'Manequim · sul' },
	);
	const block = wizardStepBlock(j, CHAR, 'sul');
	assert.equal(block.blocked, true);
	assert.ok(block.blocked);
	assert.equal(block.reason, 'mesma-etapa');
	assert.equal(block.status, 'gerando');
	assert.equal(block.key, southKey(CHAR));
	assert.equal(block.label, 'Manequim · sul');
});

test("'na-fila' bloqueia igual a 'gerando' — enfileirado ainda vai rodar", () => {
	const j = jobs({ [directions8Key(CHAR)]: 'na-fila' });
	const block = wizardStepBlock(j, CHAR, 'direcoes8');
	assert.ok(block.blocked);
	assert.equal(block.reason, 'mesma-etapa');
	// O status volta DISTINTO: bloqueia igual, se escreve diferente na tela.
	assert.equal(block.status, 'na-fila');
});

test('outra etapa do MESMO personagem bloqueia, com motivo próprio', () => {
	const j = jobs(
		{ [directions8Key(CHAR)]: 'gerando' },
		{ [directions8Key(CHAR)]: 'Manequim · 8 direções' },
	);
	const block = wizardStepBlock(j, CHAR, 'sul');
	assert.ok(block.blocked);
	assert.equal(block.reason, 'mesmo-personagem');
	assert.equal(block.label, 'Manequim · 8 direções');
});

test('pose e peça do MESMO personagem bloqueiam o wizard dele', () => {
	const pose = wizardStepBlock(
		jobs({ [cellKey(CHAR, 'correndo')]: 'gerando' }),
		CHAR,
		'sul',
	);
	assert.ok(pose.blocked);
	assert.equal(pose.reason, 'mesmo-personagem');

	const peca = wizardStepBlock(
		jobs({ [wardrobeKey(CHAR, 'elmo')]: 'na-fila' }),
		CHAR,
		'direcoes8',
	);
	assert.ok(peca.blocked);
	assert.equal(peca.reason, 'mesmo-personagem');
});

test('job terminal não bloqueia nada', () => {
	const j = jobs({
		[southKey(CHAR)]: 'pronto',
		[directions8Key(CHAR)]: 'falhou',
		[cellKey(CHAR, 'correndo')]: 'cancelado',
	});
	assert.deepEqual(wizardStepBlock(j, CHAR, 'sul'), { blocked: false });
	assert.deepEqual(wizardStepBlock(j, CHAR, 'direcoes8'), { blocked: false });
});

test('mesma etapa tem precedência sobre outro job do personagem', () => {
	const j = jobs({
		[cellKey(CHAR, 'correndo')]: 'gerando',
		[southKey(CHAR)]: 'na-fila',
	});
	const block = wizardStepBlock(j, CHAR, 'sul');
	assert.ok(block.blocked);
	assert.equal(block.reason, 'mesma-etapa');
	assert.equal(block.key, southKey(CHAR));
});

test('sem rótulo, a mensagem cai na chave em vez de ficar vazia', () => {
	const block = wizardStepBlock(jobs({ [southKey(CHAR)]: 'gerando' }), CHAR, 'sul');
	assert.ok(block.blocked);
	assert.equal(block.label, southKey(CHAR));
});

test('personagem sem id não bloqueia — o wizard monta antes da seleção', () => {
	const j = jobs({ [southKey(CHAR)]: 'gerando' });
	assert.deepEqual(wizardStepBlock(j, '', 'sul'), { blocked: false });
});

// -------------------------------------------------- id que colide com bancada

/**
 * O caso que abriu o buraco inverso, e que custa dinheiro.
 *
 * `POST /api/characters` faz `id = slug(label)` e `slug` é `toLowerCase()` +
 * `[^a-z0-9]+ → '-'`, então o label livre "Sprite Lab" cria o personagem de id
 * `sprite-lab`. Se o dono do job saísse de `parseJobScope`, `characterOf()`
 * devolveria `undefined` para TODOS os jobs desse personagem — a precedência da
 * bancada os classifica como bancada — e o wizard dele NUNCA bloquearia.
 *
 * O gasto concreto: com `sprite-lab::__south__` gerando (edição da sul em
 * curso), o botão "Gerar 8 direções" ficava habilitado, porque o servidor não
 * marca a célula do wizard como `gerando` e `southReady` continua `true`. Um
 * POST em `/api/wizard/directions8` usa chave DIFERENTE, a guarda do `spawn`
 * não pega, e uma `create-character-v3` paga sai baseada na sul que está sendo
 * substituída. Em `main` o `busy` global impedia isso por acidente.
 *
 * O dono agora sai do PREFIXO da chave, então o desempate cai para bloquear.
 */
const COLIDE = 'sprite-lab';

test('personagem chamado "Sprite Lab": a sul dele bloqueia as 8 direções', () => {
	const j = jobs(
		{ [southKey(COLIDE)]: 'gerando' },
		{ [southKey(COLIDE)]: 'Sprite Lab · sul' },
	);
	const block = wizardStepBlock(j, COLIDE, 'direcoes8');
	assert.ok(block.blocked, 'a sul em curso tem de segurar as 8 direções');
	assert.equal(block.reason, 'mesmo-personagem');
	assert.equal(block.key, southKey(COLIDE));
	assert.equal(block.label, 'Sprite Lab · sul');
});

test('personagem chamado "Sprite Lab": o mutex da mesma etapa vale para ele', () => {
	const j = jobs({ [southKey(COLIDE)]: 'na-fila' });
	const block = wizardStepBlock(j, COLIDE, 'sul');
	assert.ok(block.blocked);
	// A etapa é reconhecida como sul, não engolida pela precedência da bancada.
	assert.equal(block.reason, 'mesma-etapa');
	assert.equal(block.status, 'na-fila');
});

test('pose e peça de um personagem com id de bancada também bloqueiam', () => {
	const pose = wizardStepBlock(
		jobs({ [cellKey('world-block', 'correndo')]: 'gerando' }),
		'world-block',
		'sul',
	);
	assert.ok(pose.blocked);
	assert.equal(pose.reason, 'mesmo-personagem');

	const peca = wizardStepBlock(
		jobs({ [wardrobeKey(COLIDE, 'elmo')]: 'na-fila' }),
		COLIDE,
		'direcoes8',
	);
	assert.ok(peca.blocked);
	assert.equal(peca.reason, 'mesmo-personagem');
});

test('o preço do desempate: a bancada bloqueia o wizard do id homônimo', () => {
	// Reconhecido e escolhido: `sprite-lab::abc123` é job REAL de bancada, mas
	// é indistinguível de trabalho do personagem `sprite-lab`. Errar aqui custa
	// espera indevida; errar para o outro lado custava geração paga.
	const j = jobs({ 'sprite-lab::abc123': 'gerando' });
	assert.ok(wizardStepBlock(j, COLIDE, 'sul').blocked);
	// E nada disso vaza para um personagem de id normal — o ponto da tarefa.
	assert.deepEqual(wizardStepBlock(j, CHAR, 'sul'), { blocked: false });
});

test('sufixo ilegível não bloqueia, mesmo dentro do namespace do personagem', () => {
	const j = jobs({ [`${CHAR}::`]: 'gerando', [`${CHAR}::::x`]: 'gerando' });
	assert.deepEqual(wizardStepBlock(j, CHAR, 'sul'), { blocked: false });
});

// ------------------------------------------------------- desempate ordenado

test('entre dois mesmo-personagem vence o primeiro em ordem de chave', () => {
	// Nenhum dos três é a etapa pedida ('cardeais'), então os três são
	// `mesmo-personagem` e o desempate é só a ordem. `_` (0x5F) vem antes das
	// minúsculas, então `__directions8__` ganha de `correndo` e de `wardrobe`.
	const esperado = directions8Key(CHAR);
	const direta = wizardStepBlock(
		jobs({
			[directions8Key(CHAR)]: 'gerando',
			[cellKey(CHAR, 'correndo')]: 'gerando',
			[wardrobeKey(CHAR, 'elmo')]: 'na-fila',
		}),
		CHAR,
		'cardeais',
	);
	assert.ok(direta.blocked);
	assert.equal(direta.key, esperado);

	// Mesmo conjunto, ordem de inserção invertida: a resposta não muda — ordem
	// de iteração de objeto não pode virar contrato de tela.
	const invertida = wizardStepBlock(
		jobs({
			[wardrobeKey(CHAR, 'elmo')]: 'na-fila',
			[cellKey(CHAR, 'correndo')]: 'gerando',
			[directions8Key(CHAR)]: 'gerando',
		}),
		CHAR,
		'cardeais',
	);
	assert.ok(invertida.blocked);
	assert.equal(invertida.key, esperado);
	assert.equal(invertida.status, direta.status);
});
