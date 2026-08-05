/**
 * O que estes testes provam sobre o painel da fila.
 *
 * Não há jsdom neste repositório e instalar é proibido, então o que se prova
 * aqui é a DECISÃO, não o pixel: a ordem FIFO que a tela promete, o grau de
 * cerimônia de cada cancelamento (que é uma afirmação sobre dinheiro), a
 * leitura da resposta do DELETE e o destino do "gerar de novo".
 *
 * Rodar: `node --test src/app/queue/queue-model.test.ts`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	abortsForReal,
	buildQueueRows,
	cancelKindFor,
	concurrencySourceOf,
	describeCancelOutcome,
	isJobStatus,
	occupancyShare,
	summariseQueue,
	tabForScope,
	type QueueJobInput,
} from './queue-model.ts';
import { parseJobScope } from '../job-scope.ts';

// ------------------------------------------------------------------ fixtures

const job = (over: Partial<QueueJobInput> & { status: string }): QueueJobInput => ({
	label: 'rótulo',
	...over,
});

/** Um snapshot com as chaves em ordem "errada" de propósito. */
function snapshot(): Record<string, QueueJobInput> {
	return {
		'manequim::__directions8__': job({
			status: 'na-fila',
			queuePosition: 2,
			seq: 4,
			kind: 'wizard-directions8',
		}),
		'sprite-lab::aaaaaaaaaaaaaaaa': job({
			status: 'gerando',
			seq: 1,
			kind: 'sprite-lab',
			paid: true,
		}),
		'manequim::correr': job({
			status: 'na-fila',
			queuePosition: 1,
			seq: 3,
			kind: 'pose',
		}),
		'manequim::__south__': job({ status: 'pronto', seq: 0, kind: 'wizard-south' }),
		'world-block::bbbbbbbbbbbbbbbb': job({
			status: 'interrompido',
			seq: 2,
			kind: 'world-block',
			paid: true,
			message: 'o servidor reiniciou',
		}),
	};
}

// ------------------------------------------------------------------ a ordem

test('buildQueueRows põe rodando primeiro, depois a fila em ordem FIFO', () => {
	const rows = buildQueueRows(snapshot());
	assert.deepEqual(
		rows.map((r) => r.key),
		[
			// rodando
			'sprite-lab::aaaaaaaaaaaaaaaa',
			// fila, por queuePosition (1 = próximo a entrar)
			'manequim::correr',
			'manequim::__directions8__',
			// encerrados, do mais recente para o mais antigo (seq desc)
			'world-block::bbbbbbbbbbbbbbbb',
			'manequim::__south__',
		],
	);
	assert.deepEqual(
		rows.map((r) => r.phase),
		['running', 'queued', 'queued', 'finished', 'finished'],
	);
});

test('a ordem NÃO depende da ordem das chaves no JSON', () => {
	const original = snapshot();
	const invertido: Record<string, QueueJobInput> = {};
	for (const key of Object.keys(original).reverse()) {
		const value = original[key];
		if (value !== undefined) invertido[key] = value;
	}
	assert.deepEqual(
		buildQueueRows(invertido).map((r) => r.key),
		buildQueueRows(original).map((r) => r.key),
		'dois clientes com o mesmo snapshot têm de mostrar a mesma lista',
	);
});

test('empate resolve pela chave, e job sem seq nem posição vai para o fim', () => {
	const rows = buildQueueRows({
		'z::a': job({ status: 'na-fila' }),
		'a::a': job({ status: 'na-fila' }),
		'm::a': job({ status: 'na-fila', queuePosition: 1, seq: 9 }),
	});
	assert.deepEqual(
		rows.map((r) => r.key),
		['m::a', 'a::a', 'z::a'],
	);
});

test('status desconhecido é descartado em vez de virar linha muda', () => {
	const rows = buildQueueRows({
		'manequim::correr': job({ status: 'inventado' }),
		'manequim::parado': job({ status: 'gerando' }),
	});
	assert.deepEqual(
		rows.map((r) => r.key),
		['manequim::parado'],
	);
	assert.deepEqual(buildQueueRows(undefined), []);
});

test('a linha carrega o escopo lido da chave, e o rótulo cai na chave', () => {
	const rows = buildQueueRows({
		'manequim::wardrobe::capacete': { status: 'gerando' },
	});
	const row = rows[0];
	assert.ok(row);
	assert.equal(row.label, 'manequim::wardrobe::capacete');
	assert.deepEqual(row.scope, {
		kind: 'wardrobe',
		characterId: 'manequim',
		itemId: 'capacete',
	});
});

// ------------------------------------------------------------------ dinheiro

test('cancelKindFor: NA FILA só é de graça quando o registro não acusa cobrança', () => {
	assert.equal(cancelKindFor('na-fila', false), 'free');
	// Em execução a cobrança acontece na submissão: cancelar não devolve nada.
	assert.equal(cancelKindFor('gerando', true), 'paid');
	// `paid: false` num job já rodando é "não consta", nunca "de graça".
	assert.equal(cancelKindFor('gerando', false), 'maybe-paid');
	for (const terminal of ['pronto', 'falhou', 'cancelado', 'interrompido'] as const) {
		assert.equal(cancelKindFor(terminal, true), 'none');
	}
});

test('BLOQUEADOR: "na-fila" com paid HERDADO não é cancelamento de graça', () => {
	// O caminho é o que o próprio painel recomenda: um job 'interrompido',
	// 'falhou' ou 'cancelado' que ainda segura dinheiro (`holdsUnclaimedMoney`)
	// é pedido de novo, e `enqueue` (`server/job-queue.ts`) faz o registro NOVO
	// herdar `paid: true`. O resultado é um 'na-fila' que carrega dinheiro — e
	// dizer "ainda não foi submetido" sobre ele é falso: ele JÁ foi, antes.
	assert.equal(cancelKindFor('na-fila', true), 'maybe-paid');
});

test('a linha decide cerimônia e decisão pendente pelo status', () => {
	const rows = buildQueueRows(snapshot());
	const porChave = new Map(rows.map((r) => [r.key, r]));

	const rodando = porChave.get('sprite-lab::aaaaaaaaaaaaaaaa');
	assert.equal(rodando?.cancel, 'paid');
	assert.equal(rodando?.holdsMoney, true);
	assert.equal(rodando?.canRetry, false);

	const naFila = porChave.get('manequim::correr');
	assert.equal(naFila?.cancel, 'free');
	assert.equal(naFila?.position, 1);
	assert.equal(naFila?.holdsMoney, false);
	assert.equal(naFila?.paid, false);

	// 'interrompido' é terminal: não há o que cancelar, e há o que decidir.
	const interrompido = porChave.get('world-block::bbbbbbbbbbbbbbbb');
	assert.equal(interrompido?.cancel, 'none');
	assert.equal(interrompido?.needsDecision, true);
	assert.equal(interrompido?.canRetry, true);
	assert.equal(interrompido?.holdsMoney, true);
	assert.equal(interrompido?.message, 'o servidor reiniciou');

	// 'pronto' não pede nada: nem cancelamento, nem decisão, nem refazer.
	const pronto = porChave.get('manequim::__south__');
	assert.equal(pronto?.cancel, 'none');
	assert.equal(pronto?.needsDecision, false);
	assert.equal(pronto?.canRetry, false);
	assert.equal(pronto?.holdsMoney, false);
});

test('abortsForReal: só pose e wardrobe recebem o AbortSignal', () => {
	assert.equal(abortsForReal('pose'), true);
	assert.equal(abortsForReal('wardrobe'), true);
	for (const kind of [
		'wizard-south',
		'wizard-south-edit',
		'wizard-directions8',
		'sprite-lab',
		'world-block',
	]) {
		assert.equal(abortsForReal(kind), false, `${kind} não recebe signal`);
	}
	// Servidor antigo, sem `kind`: o lado conservador é avisar que a vaga demora.
	assert.equal(abortsForReal(undefined), false);
});

// ------------------------------------------------------------------ resposta do DELETE

test('a linha publica o `paid` do registro — o DELETE não o devolve', () => {
	// `world-block::cccc…` é o pedido REFEITO de um job que ainda segurava
	// dinheiro: `enqueue` herdou `paid: true` para o registro novo.
	const rows = buildQueueRows({
		'world-block::cccccccccccccccc': job({
			status: 'na-fila',
			queuePosition: 1,
			seq: 7,
			kind: 'world-block',
			paid: true,
		}),
		'manequim::correr': job({ status: 'na-fila', queuePosition: 2, seq: 8, kind: 'pose' }),
	});
	const porChave = new Map(rows.map((r) => [r.key, r]));

	const herdado = porChave.get('world-block::cccccccccccccccc');
	assert.equal(herdado?.paid, true);
	assert.equal(herdado?.cancel, 'maybe-paid', 'a cerimônia acompanha o dinheiro');
	assert.equal(herdado?.holdsMoney, true);

	const limpo = porChave.get('manequim::correr');
	assert.equal(limpo?.paid, false);
	assert.equal(limpo?.cancel, 'free');
});

test('describeCancelOutcome lê as três formas que o servidor emite', () => {
	assert.deepEqual(
		describeCancelOutcome({ ok: true, status: 'cancelado', aborted: false, paid: false }),
		{ kind: 'removed', paid: false },
	);
	assert.deepEqual(
		describeCancelOutcome({ ok: true, status: 'cancelado', aborted: true, paid: true }),
		{ kind: 'aborted', paid: true },
	);
	assert.deepEqual(
		describeCancelOutcome({ ok: true, status: 'cancelado', aborted: true, paid: false }),
		{ kind: 'aborted', paid: false },
	);
	assert.deepEqual(describeCancelOutcome({ ok: true, status: 'pronto' }), {
		kind: 'already-finished',
		status: 'pronto',
	});
});

test('describeCancelOutcome distingue "cancelei agora" de "já estava cancelado"', () => {
	// As duas respostas trazem status 'cancelado'. Só `aborted` separa as duas,
	// e por isso ele é lido PRIMEIRO.
	assert.deepEqual(describeCancelOutcome({ ok: true, status: 'cancelado' }), {
		kind: 'already-finished',
		status: 'cancelado',
	});
	assert.deepEqual(
		describeCancelOutcome({ ok: true, status: 'cancelado', aborted: false, paid: false }),
		{ kind: 'removed', paid: false },
	);
});

test('BLOQUEADOR: sair da fila com registro PAGO não é "nada foi cobrado"', () => {
	// O servidor responde `{aborted:false, paid:false}` HARDCODED no ramo de
	// remoção (`server/api.ts`): ele não consulta o `paid` do registro. A
	// informação existe só do lado da tela, em `studio.jobs[key].paid` — e é
	// por isso que ela entra aqui como segundo argumento.
	assert.deepEqual(
		describeCancelOutcome(
			{ ok: true, status: 'cancelado', aborted: false, paid: false },
			true,
		),
		{ kind: 'removed', paid: true },
	);
	assert.deepEqual(
		describeCancelOutcome(
			{ ok: true, status: 'cancelado', aborted: false, paid: false },
			false,
		),
		{ kind: 'removed', paid: false },
	);
	// Em execução as duas fontes se somam pelo lado conservador: se qualquer
	// uma acusa cobrança, a tela assume que houve.
	assert.deepEqual(
		describeCancelOutcome(
			{ ok: true, status: 'cancelado', aborted: true, paid: false },
			true,
		),
		{ kind: 'aborted', paid: true },
	);
});

test('describeCancelOutcome nunca arredonda para grátis', () => {
	for (const lixo of [null, undefined, 42, 'ok', {}, { ok: true }]) {
		assert.deepEqual(describeCancelOutcome(lixo), { kind: 'unknown' });
	}
	// Status que este cliente não conhece: já terminou, mas sem nome para ele.
	assert.deepEqual(describeCancelOutcome({ ok: true, status: 'inventado' }), {
		kind: 'already-finished',
		status: null,
	});
});

// ------------------------------------------------------------------ resumo e teto

test('summariseQueue conta por fase e destaca o que precisa de decisão', () => {
	const s = summariseQueue(buildQueueRows(snapshot()));
	assert.deepEqual(s, {
		running: 1,
		queued: 2,
		finished: 2,
		interrupted: 1,
		active: 3,
	});
});

test('occupancyShare mede PESO contra teto, e nunca passa de 1', () => {
	assert.equal(occupancyShare({ concurrency: 8, inFlightWeight: 4 }), 0.5);
	// Um sprite-lab de 4 saídas ocupa 4 vagas — a barra enche sem 4 jobs.
	assert.equal(occupancyShare({ concurrency: 4, inFlightWeight: 4 }), 1);
	assert.equal(occupancyShare({ concurrency: 4, inFlightWeight: 9 }), 1);
	assert.equal(occupancyShare({ concurrency: 0, inFlightWeight: 3 }), 0);
	assert.equal(occupancyShare({ inFlightWeight: 3 }), 0);
	assert.equal(occupancyShare(undefined), 0);
});

test('concurrencySourceOf só aceita as quatro origens declaradas', () => {
	assert.equal(concurrencySourceOf({ concurrencySource: 'env' }), 'env');
	assert.equal(concurrencySourceOf({ concurrencySource: 'tier' }), 'tier');
	assert.equal(concurrencySourceOf({ concurrencySource: 'sei-la' }), null);
	assert.equal(concurrencySourceOf(undefined), null);
});

// ------------------------------------------------------------------ para onde ir

test('tabForScope leva cada job à aba que tem o botão de gerar de novo', () => {
	assert.equal(tabForScope(parseJobScope('manequim::__south__')), 'wizard');
	assert.equal(tabForScope(parseJobScope('manequim::__directions8__')), 'wizard');
	assert.equal(tabForScope(parseJobScope('manequim::correr')), 'poses');
	assert.equal(tabForScope(parseJobScope('manequim::wardrobe::capacete')), 'itens');
	assert.equal(
		tabForScope(parseJobScope('sprite-lab::aaaaaaaaaaaaaaaa')),
		'laboratorio',
	);
	assert.equal(
		tabForScope(parseJobScope('world-block::bbbbbbbbbbbbbbbb')),
		'laboratorio',
	);
	// Chave ilegível não inventa destino.
	assert.equal(tabForScope(parseJobScope('::')), null);
});

test('isJobStatus fecha o vocabulário nos seis da fila', () => {
	for (const s of [
		'na-fila',
		'gerando',
		'pronto',
		'falhou',
		'cancelado',
		'interrompido',
	]) {
		assert.equal(isJobStatus(s), true);
	}
	assert.equal(isJobStatus('vazio'), false);
	assert.equal(isJobStatus(undefined), false);
});
