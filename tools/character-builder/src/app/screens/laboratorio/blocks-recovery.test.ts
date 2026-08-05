/**
 * O que estes testes provam: um F5 no meio de uma geração de bloco não perde
 * mais o rastro dela — nem quando o job ainda está esperando a vez na fila, que
 * é o estado mais comum logo depois de disparar várias — E que a recolagem
 * nunca toma a tela de uma corrida que já tem dono.
 *
 * Rodar: `node --test src/app/screens/laboratorio/blocks-recovery.test.ts`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	planBlockReattach,
	BLOCK_JOB_KEY_PREFIX,
	type BlockJobSnapshot,
} from './blocks-recovery.ts';

const HASH_A = 'aaaaaaaaaaaaaaaa';
const HASH_B = 'bbbbbbbbbbbbbbbb';

const keyOf = (hash: string): string => `${BLOCK_JOB_KEY_PREFIX}${hash}`;

const jobs = (
  entries: Record<string, string>,
): Record<string, BlockJobSnapshot> =>
	Object.fromEntries(
		Object.entries(entries).map(([key, status]) => [key, { status }]),
	);

test('sem snapshot ainda, a decisão espera — nunca conclui "nada em voo"', () => {
	assert.equal(planBlockReattach(undefined, null).kind, 'wait');
});

test('BLOQUEADOR: um job ENFILEIRADO é recolado, não ignorado', () => {
	// O caso do F5 com fila: o bloco foi aceito, ainda não entrou em execução.
	// Enquanto o teste era `status === 'gerando'`, a tela via "nada em voo" e o
	// bloco pago ficava invisível até alguém recarregar o catálogo.
	const plano = planBlockReattach(jobs({ [keyOf(HASH_A)]: 'na-fila' }), null);
	assert.equal(plano.kind, 'reattach');
	if (plano.kind !== 'reattach') return;
	assert.equal(plano.hash, HASH_A);
	assert.equal(plano.key, keyOf(HASH_A));
	assert.equal(plano.status, 'na-fila', 'a tela precisa saber que ele espera');
});

test('um job em execução também é recolado, com o status certo', () => {
	const plano = planBlockReattach(jobs({ [keyOf(HASH_A)]: 'gerando' }), null);
	assert.equal(plano.kind === 'reattach' && plano.status, 'gerando');
});

test('todo status terminal fica de fora', () => {
	for (const status of ['pronto', 'falhou', 'cancelado', 'interrompido']) {
		assert.equal(
			planBlockReattach(jobs({ [keyOf(HASH_A)]: status }), null).kind,
			'none',
			status,
		);
	}
	assert.equal(planBlockReattach({}, null).kind, 'none');
});

test('job de outra bancada, e hash malformado, não recolam nada', () => {
	assert.equal(
		planBlockReattach(jobs({ 'sprite-lab::aaaaaaaaaaaaaaaa': 'gerando' }), null).kind,
		'none',
	);
	assert.equal(
		planBlockReattach(jobs({ 'manequim::__south__': 'gerando' }), null).kind,
		'none',
	);
	// `world-block::` seguido de lixo viraria sondagem infinita num hash que
	// não existe.
	assert.equal(
		planBlockReattach(jobs({ [keyOf('naoehash')]: 'gerando' }), null).kind,
		'none',
	);
});

// ------------------------------------------------------------------
// A guarda de dono — os três casos que o revisor rodou à mão
// ------------------------------------------------------------------
//
// O painel passa `ownBlock.current`, não `pendingHash`. A diferença entre os
// dois é a origem do defeito: `pendingHash` volta a `null` no instante em que o
// resultado chega (`setPendingHash(null)` no sucesso da sondagem), e o efeito
// re-disparava com o snapshot VELHO do estúdio em mão.

test('CASO 1 — a própria corrida em voo, snapshot fresco: nada a recolar', () => {
	// A tela sonda A, o snapshot também diz A em voo. Recolar reiniciaria o
	// intervalo à toa.
	assert.deepEqual(
		planBlockReattach(jobs({ [keyOf(HASH_A)]: 'gerando' }), { hash: HASH_A }),
		{ kind: 'none' },
	);
});

test('CASO 2 — BLOQUEADOR: snapshot velho não apaga o bloco recém-entregue', () => {
	// Caminho feliz, sem corrida de relógio: `GET /api/world-block/<hash>` lê o
	// resultado DO DISCO, que `runWorldBlock` grava ANTES de a promessa resolver
	// e a fila marcar 'pronto'. A sondagem vê 'pronto' enquanto
	// `studio.jobs['world-block::<hash>']` ainda diz 'gerando' (e o snapshot em
	// mão pode estar até 3 s atrasado por cima disso).
	//
	// O sucesso faz `setPendingHash(null)`. Com `pendingHash` como guarda, o
	// efeito re-disparava vendo `tracked === null` e recolava na PRÓPRIA corrida
	// já entregue: o bloco sumia da tela, o skeleton voltava e a nota
	// "reencontrei uma geração em andamento" aparecia sobre o que o usuário
	// acabara de receber. Com a guarda de DONO, o snapshot atrasado não decide
	// nada.
	assert.deepEqual(
		planBlockReattach(jobs({ [keyOf(HASH_A)]: 'gerando' }), { hash: HASH_A }),
		{ kind: 'none' },
		'a corrida entregue continua sendo desta montagem',
	);
});

test('CASO 3 — clicar "Gerar" em B não entrega a tela ao A de outra aba', () => {
	// Entre o clique e o 202 o dono existe e o hash ainda não: é exatamente a
	// janela em que o snapshot com o job A em voo roubava a tela. B ficava na
	// fila, PAGO, sem ninguém acompanhando.
	assert.deepEqual(
		planBlockReattach(jobs({ [keyOf(HASH_A)]: 'gerando' }), { hash: null }),
		{ kind: 'none' },
		'dono sem hash ainda é dono',
	);
	// E depois do 202, com o hash de B na mão, A continua sem tomar a tela.
	assert.deepEqual(
		planBlockReattach(jobs({ [keyOf(HASH_A)]: 'gerando' }), { hash: HASH_B }),
		{ kind: 'none' },
	);
	// O mesmo snapshot SEM dono recola normalmente — a guarda não desliga a
	// recuperação, só decide de quem é a tela.
	const orfa = planBlockReattach(jobs({ [keyOf(HASH_A)]: 'gerando' }), null);
	assert.equal(orfa.kind === 'reattach' && orfa.hash, HASH_A);
});

test('a tela órfã recola no bloco em voo, mesmo depois do primeiro snapshot', () => {
	// Não há latch: enquanto não houver dono, todo snapshot novo é uma chance.
	// Um job que estava terminal no primeiro snapshot e outro que entrou depois
	// são decididos no snapshot em que aparecerem.
	assert.equal(planBlockReattach(jobs({ [keyOf(HASH_A)]: 'pronto' }), null).kind, 'none');
	const depois = planBlockReattach(
		jobs({ [keyOf(HASH_A)]: 'pronto', [keyOf(HASH_B)]: 'na-fila' }),
		null,
	);
	assert.equal(depois.kind === 'reattach' && depois.hash, HASH_B);
});

test('com vários em voo, quem está gerando ganha — e a escolha é estável', () => {
	const varios = jobs({
		[keyOf(HASH_B)]: 'gerando',
		[keyOf(HASH_A)]: 'na-fila',
	});
	const plano = planBlockReattach(varios, null);
	assert.equal(plano.kind === 'reattach' && plano.hash, HASH_B);

	// A mesma resposta com as chaves em ordem invertida no objeto.
	const invertido = jobs({
		[keyOf(HASH_A)]: 'na-fila',
		[keyOf(HASH_B)]: 'gerando',
	});
	assert.deepEqual(planBlockReattach(invertido, null), plano);
});

test('entre dois enfileirados, vence a menor chave — sempre a mesma', () => {
	const dois = jobs({ [keyOf(HASH_B)]: 'na-fila', [keyOf(HASH_A)]: 'na-fila' });
	assert.equal(planBlockReattach(dois, null).kind === 'reattach', true);
	assert.equal(
		planBlockReattach(dois, null).kind === 'reattach'
			? (planBlockReattach(dois, null) as { hash: string }).hash
			: null,
		HASH_A,
	);
});
