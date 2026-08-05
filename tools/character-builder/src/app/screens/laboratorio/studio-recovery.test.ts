/**
 * Testes das decisões de recuperação da bancada v3 (node --test, sem DOM).
 *
 * O que está sob verificação é UMA regra: o body exportado no bundle sempre
 * descreve a corrida cujos candidatos estão na tela. A contaminação que estes
 * testes existem para impedir custa dinheiro de verdade — `config.size` do
 * bundle vira o `lock.size` IMUTÁVEL do personagem no import
 * (server/sprite-bundle.ts), e o lock governa toda geração paga das 8
 * direções. Nada valida as dimensões do PNG contra ele.
 *
 * As duas ORDENS DE CHEGADA (A e B) são reproduzidas passo a passo com um
 * espelho mínimo da fiação do painel — as mesmas funções puras, chamadas na
 * mesma sequência em que os efeitos do React as chamam.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SpriteLabBody, SpriteLabResult } from './studio-body.ts';
import {
	activeRunHash,
	bodyForRun,
	bodyFromRunConfig,
	describeLiveRun,
	describeRun,
	mergeDescriptor,
	planDescriptorRefresh,
	planDiskRecovery,
	planReattach,
	summaryForRun,
	type JobSnapshot,
	type OwnedRun,
	type PendingRun,
	type RunConfigDTO,
	type RunDescriptor,
	type RunSummaryDTO,
} from './studio-recovery.ts';

// ------------------------------------------------------------------ fixtures

const HASH_ANTIGA = 'aaaaaaaaaaaaaaaa';
const HASH_NOVA = 'bbbbbbbbbbbbbbbb';

/** A corrida ANTIGA usa 256 px; a NOVA, 32 px — a troca é impossível de não ver. */
function config(overrides: Partial<RunConfigDTO> = {}): RunConfigDTO {
	return {
		description: 'guerreiro de armadura enferrujada',
		view: 'low top-down',
		size: 256,
		outputs: 2,
		noBackground: true,
		enhancePrompt: false,
		hadReference: false,
		...overrides,
	};
}

function run(hash: string, cfg?: RunConfigDTO, at = '2026-08-04T10:00:00.000Z'): RunSummaryDTO {
	return {
		hash,
		at,
		candidateCount: 1,
		candidates: [
			{ index: 0, seed: 701, southUrl: `/sprite-lab/${hash}-cand0/south-00.png` },
		],
		...(cfg !== undefined ? { config: cfg } : {}),
	};
}

function result(hash: string): SpriteLabResult {
	return {
		hash,
		fromCache: true,
		candidates: [{ index: 0, seed: 701, southB64: 'iVBORw0KGgo=' }],
	};
}

function gerando(hash: string): Record<string, JobSnapshot> {
	return { [`sprite-lab::${hash}`]: { status: 'gerando' } };
}

// ---------------------------------------------------- espelho da fiação real

/**
 * Estado que o painel mantém, reduzido ao que decide a identidade da corrida.
 * Cada `aplicar*` abaixo é a mesma sequência do efeito correspondente em
 * studio-panel.tsx — mudou a ordem aqui, mudou a ordem lá.
 */
interface Tela {
	own: OwnedRun | null;
	pending: PendingRun | null;
	result: SpriteLabResult | null;
	desc: RunDescriptor | null;
}

const telaVazia = (): Tela => ({
	own: null,
	pending: null,
	result: null,
	desc: null,
});

const hashAtivo = (t: Tela): string | null =>
	activeRunHash(t.pending?.hash ?? null, t.result?.hash ?? null);

/** Exatamente o que `handleDownload` põe no bundle. */
const bodyExportado = (t: Tela): SpriteLabBody | null =>
	bodyForRun(t.desc, hashAtivo(t));

const resumoNaTela = (t: Tela): string => summaryForRun(t.desc, hashAtivo(t));

/** Efeito de mount: catálogo + bytes da corrida mais nova. */
function aplicarRecuperacaoEmDisco(
	t: Tela,
	runs: readonly RunSummaryDTO[],
	status: string,
	res: SpriteLabResult | undefined,
): void {
	const plano = planDiskRecovery({
		runs,
		newestStatus: status,
		newestResult: res,
		owned: t.own,
	});
	if (plano.kind !== 'apply') return;
	t.result = plano.result;
	t.desc = plano.descriptor;
}

/** Efeito de recolagem: primeiro snapshot de studio.jobs. */
function aplicarRecolagem(
	t: Tela,
	jobs: Record<string, JobSnapshot> | undefined,
): void {
	const plano = planReattach(jobs, t.result?.hash ?? null);
	if (plano.kind !== 'reattach') return;
	t.own = { hash: plano.pending.hash };
	t.desc = plano.descriptor;
	if (plano.clearResult) t.result = null;
	t.pending = plano.pending;
}

/** Sondagem entregou: a corrida em voo virou resultado. */
function aplicarEntregaDaSondagem(t: Tela, res: SpriteLabResult): void {
	t.result = res;
	t.pending = null;
}

/** Terceiro efeito: relê o catálogo para preencher o body que faltava. */
function aplicarRefrescoDoDescritor(t: Tela, runs: readonly RunSummaryDTO[]): void {
	if (t.result === null || bodyExportado(t) !== null) return;
	if (t.own?.hash !== t.result.hash) return;
	const desc = planDescriptorRefresh({ runs, activeHash: t.result.hash });
	if (desc === null) return;
	t.desc = mergeDescriptor(t.desc, desc);
}

/** Clique em "Gerar": a tela ganha dono antes de o hash existir. */
function aplicarCliqueGerar(t: Tela): void {
	t.own = { hash: null };
}

/** 202 do POST: o hash chegou. */
function aplicarAceite(t: Tela, hash: string, body: SpriteLabBody): void {
	t.own = { hash };
	t.desc = { hash, summary: 'resumo do formulário', body };
	t.result = null;
	t.pending = { key: `sprite-lab::${hash}`, hash };
}

const bodyDoFormulario: SpriteLabBody = {
	description: 'mago de manto azul',
	view: 'low top-down',
	size: 32,
	noBackground: true,
	enhancePrompt: false,
	outputs: 1,
};

// ------------------------------------------------------------------ unidades

test('describeRun com config traz body e resumo pelos parâmetros', () => {
	const d = describeRun(run(HASH_ANTIGA, config()));
	assert.equal(d.hash, HASH_ANTIGA);
	assert.equal(d.summary, '256 px · low top-down · 2 saídas');
	assert.equal(d.body?.size, 256);
});

test('describeRun sem config: body null e resumo pelo hash (manifesto legado)', () => {
	const d = describeRun(run(HASH_ANTIGA));
	assert.equal(d.body, null);
	assert.equal(d.summary, `corrida ${HASH_ANTIGA}`);
});

test('bodyFromRunConfig omite opcionais ausentes e não carrega hadReference', () => {
	const body = bodyFromRunConfig(config({ hadReference: true }));
	assert.equal('seed' in body, false);
	assert.equal('outline' in body, false);
	assert.equal('detail' in body, false);
	assert.equal('templateId' in body, false);
	assert.equal('hadReference' in body, false);
	const cheio = bodyFromRunConfig(
		config({ seed: 9, outline: 'single color black outline', detail: 'high detail', templateId: 'mannequin' }),
	);
	assert.equal(cheio.seed, 9);
	assert.equal(cheio.outline, 'single color black outline');
	assert.equal(cheio.detail, 'high detail');
	assert.equal(cheio.templateId, 'mannequin');
});

test('activeRunHash: quem está em voo manda sobre o resultado ainda visível', () => {
	assert.equal(activeRunHash(HASH_NOVA, HASH_ANTIGA), HASH_NOVA);
	assert.equal(activeRunHash(null, HASH_ANTIGA), HASH_ANTIGA);
	assert.equal(activeRunHash(null, null), null);
});

test('bodyForRun devolve null quando o descritor é de OUTRA corrida', () => {
	const d = describeRun(run(HASH_ANTIGA, config()));
	assert.equal(bodyForRun(d, HASH_ANTIGA)?.size, 256);
	assert.equal(bodyForRun(d, HASH_NOVA), null);
	assert.equal(bodyForRun(d, null), null);
	assert.equal(bodyForRun(null, HASH_ANTIGA), null);
});

test('summaryForRun segue a mesma regra de identidade do body', () => {
	const d = describeLiveRun(HASH_NOVA);
	assert.equal(summaryForRun(d, HASH_NOVA), `corrida ${HASH_NOVA}`);
	assert.equal(summaryForRun(d, HASH_ANTIGA), '');
});

test('planReattach espera o primeiro snapshot antes de concluir "nada em voo"', () => {
	assert.equal(planReattach(undefined, null).kind, 'wait');
	assert.equal(planReattach({}, null).kind, 'none');
	assert.equal(
		planReattach({ 'sprite-lab::naoehash': { status: 'gerando' } }, null).kind,
		'none',
	);
	assert.equal(
		planReattach({ [`sprite-lab::${HASH_NOVA}`]: { status: 'pronto' } }, null).kind,
		'none',
	);
	assert.equal(
		planReattach({ 'south::manequim': { status: 'gerando' } }, null).kind,
		'none',
	);
});

test('planReattach nasce com body null e manda limpar resultado de outra corrida', () => {
	const plano = planReattach(gerando(HASH_NOVA), HASH_ANTIGA);
	assert.equal(plano.kind, 'reattach');
	if (plano.kind !== 'reattach') return;
	assert.equal(plano.pending.hash, HASH_NOVA);
	assert.equal(plano.pending.key, `sprite-lab::${HASH_NOVA}`);
	assert.equal(plano.descriptor.body, null);
	assert.equal(plano.descriptor.hash, HASH_NOVA);
	assert.equal(plano.clearResult, true);
	// Mesma corrida na tela: não há nada de outra pessoa para limpar.
	const mesma = planReattach(gerando(HASH_NOVA), HASH_NOVA);
	assert.equal(mesma.kind === 'reattach' && mesma.clearResult, false);
	const vazia = planReattach(gerando(HASH_NOVA), null);
	assert.equal(vazia.kind === 'reattach' && vazia.clearResult, false);
});

test('planDiskRecovery só preenche tela sem dono', () => {
	const runs = [run(HASH_ANTIGA, config())];
	const base = {
		runs,
		newestStatus: 'pronto',
		newestResult: result(HASH_ANTIGA),
	};
	assert.equal(planDiskRecovery({ ...base, owned: null }).kind, 'apply');
	// Job recolado: a tela já tem dono.
	assert.equal(
		planDiskRecovery({ ...base, owned: { hash: HASH_NOVA } }).kind,
		'skip',
	);
	// Clique em "Gerar" antes de o 202 voltar: dono sem hash ainda.
	assert.equal(planDiskRecovery({ ...base, owned: { hash: null } }).kind, 'skip');
});

test('planDiskRecovery ignora corrida não terminada, catálogo vazio e hash incoerente', () => {
	const runs = [run(HASH_ANTIGA, config())];
	assert.equal(
		planDiskRecovery({
			runs,
			newestStatus: 'gerando',
			newestResult: undefined,
			owned: null,
		}).kind,
		'skip',
	);
	assert.equal(
		planDiskRecovery({
			runs: [],
			newestStatus: 'pronto',
			newestResult: result(HASH_ANTIGA),
			owned: null,
		}).kind,
		'skip',
	);
	// Os dois requests falaram de corridas diferentes.
	assert.equal(
		planDiskRecovery({
			runs,
			newestStatus: 'pronto',
			newestResult: result(HASH_NOVA),
			owned: null,
		}).kind,
		'skip',
	);
});

test('planDescriptorRefresh procura pelo hash ATIVO, nunca pela corrida mais nova', () => {
	const runs = [run(HASH_NOVA, config({ size: 32 })), run(HASH_ANTIGA, config())];
	const achado = planDescriptorRefresh({ runs, activeHash: HASH_ANTIGA });
	assert.equal(achado?.hash, HASH_ANTIGA);
	assert.equal(achado?.body?.size, 256);
	assert.equal(planDescriptorRefresh({ runs, activeHash: null }), null);
	assert.equal(planDescriptorRefresh({ runs, activeHash: 'cccccccccccccccc' }), null);
	// Manifesto legado: sem config não há o que remontar.
	assert.equal(
		planDescriptorRefresh({ runs: [run(HASH_ANTIGA)], activeHash: HASH_ANTIGA }),
		null,
	);
});

test('mergeDescriptor recusa descritor que chegou tarde demais', () => {
	const antigo = describeRun(run(HASH_ANTIGA, config()));
	const novo = describeRun(run(HASH_NOVA, config({ size: 32 })));
	assert.equal(mergeDescriptor(null, antigo), antigo);
	assert.equal(mergeDescriptor(describeLiveRun(HASH_ANTIGA), antigo), antigo);
	// A tela já passou a descrever a NOVA: o descritor da ANTIGA não entra.
	assert.equal(mergeDescriptor(novo, antigo), novo);
});

// ------------------------------------------- as duas ordens de chegada (A/B)

test('ORDEM A — recolagem antes da recuperação: o body da corrida ANTIGA nunca entra', () => {
	const catalogo = [run(HASH_ANTIGA, config())]; // a NOVA ainda não tem manifesto
	const t = telaVazia();

	// 1. /api/studio chega primeiro (1 request contra os 2 sequenciais do disco)
	aplicarRecolagem(t, gerando(HASH_NOVA));
	assert.equal(t.pending?.hash, HASH_NOVA);
	assert.equal(bodyExportado(t), null);

	// 2. a recuperação em disco resolve com a corrida COMPLETA mais nova (a ANTIGA)
	aplicarRecuperacaoEmDisco(t, catalogo, 'pronto', result(HASH_ANTIGA));
	assert.equal(t.result, null, 'a corrida em disco não toma a tela da corrida viva');
	assert.equal(bodyExportado(t), null);

	// 3. o efeito de refresco roda com a tela nesse estado
	aplicarRefrescoDoDescritor(t, catalogo);
	assert.equal(bodyExportado(t), null, 'nada da corrida ANTIGA foi colado');
	assert.equal(resumoNaTela(t), `corrida ${HASH_NOVA}`);

	// 4. a corrida NOVA termina e o manifesto dela passa a existir
	aplicarEntregaDaSondagem(t, result(HASH_NOVA));
	const comManifesto = [run(HASH_NOVA, config({ size: 32 })), ...catalogo];
	aplicarRefrescoDoDescritor(t, comManifesto);

	assert.equal(bodyExportado(t)?.size, 32, 'o body exportado é o da corrida NOVA');
	assert.equal(t.desc?.hash, HASH_NOVA);
	assert.equal(resumoNaTela(t), '32 px · low top-down · 2 saídas');
});

test('ORDEM B — recuperação antes da recolagem: o body da corrida ANTIGA não sobrevive', () => {
	const catalogo = [run(HASH_ANTIGA, config())];
	const t = telaVazia();

	// 1. a recuperação em disco chega primeiro, com a tela ainda órfã
	aplicarRecuperacaoEmDisco(t, catalogo, 'pronto', result(HASH_ANTIGA));
	assert.equal(bodyExportado(t)?.size, 256, 'nesta janela a tela É a corrida ANTIGA');

	// 2. o primeiro snapshot do estúdio revela o job em voo
	aplicarRecolagem(t, gerando(HASH_NOVA));
	assert.equal(t.pending?.hash, HASH_NOVA);
	assert.equal(t.result, null, 'os candidatos da ANTIGA saem da tela');
	assert.equal(bodyExportado(t), null);

	// 3. o efeito de refresco roda: não pode achar a ANTIGA e colar
	aplicarRefrescoDoDescritor(t, catalogo);
	assert.equal(bodyExportado(t), null);

	// 4. a corrida NOVA termina
	aplicarEntregaDaSondagem(t, result(HASH_NOVA));
	aplicarRefrescoDoDescritor(t, [run(HASH_NOVA, config({ size: 32 })), ...catalogo]);

	assert.equal(bodyExportado(t)?.size, 32);
	assert.equal(t.desc?.hash, HASH_NOVA);
});

test('as duas ordens convergem para o mesmo estado final', () => {
	const catalogo = [run(HASH_ANTIGA, config())];
	const comManifesto = [run(HASH_NOVA, config({ size: 32 })), ...catalogo];

	const a = telaVazia();
	aplicarRecolagem(a, gerando(HASH_NOVA));
	aplicarRecuperacaoEmDisco(a, catalogo, 'pronto', result(HASH_ANTIGA));
	aplicarRefrescoDoDescritor(a, catalogo);
	aplicarEntregaDaSondagem(a, result(HASH_NOVA));
	aplicarRefrescoDoDescritor(a, comManifesto);

	const b = telaVazia();
	aplicarRecuperacaoEmDisco(b, catalogo, 'pronto', result(HASH_ANTIGA));
	aplicarRecolagem(b, gerando(HASH_NOVA));
	aplicarRefrescoDoDescritor(b, catalogo);
	aplicarEntregaDaSondagem(b, result(HASH_NOVA));
	aplicarRefrescoDoDescritor(b, comManifesto);

	assert.deepEqual(a.desc, b.desc);
	assert.deepEqual(bodyExportado(a), bodyExportado(b));
	assert.equal(bodyExportado(a)?.size, 32);
});

test('job recolado que FALHA não deixa os candidatos da corrida ANTIGA na tela', () => {
	const catalogo = [run(HASH_ANTIGA, config())];
	for (const ordem of ['A', 'B'] as const) {
		const t = telaVazia();
		if (ordem === 'A') {
			aplicarRecolagem(t, gerando(HASH_NOVA));
			aplicarRecuperacaoEmDisco(t, catalogo, 'pronto', result(HASH_ANTIGA));
		} else {
			aplicarRecuperacaoEmDisco(t, catalogo, 'pronto', result(HASH_ANTIGA));
			aplicarRecolagem(t, gerando(HASH_NOVA));
		}
		// finish(): a sondagem desiste, a mensagem de erro aparece.
		t.pending = null;
		assert.equal(t.result, null, `ordem ${ordem}: nada de outra corrida sob o erro`);
		assert.equal(hashAtivo(t), null);
		assert.equal(bodyExportado(t), null);
	}
});

// --------------------------------------- "Gerar" durante a recuperação (sem
// nenhum job em voo: aqui não há recolagem para arbitrar nada)

test('VARIANTE — "Gerar" durante a recuperação: o disco não sobrescreve o body do formulário', () => {
	const catalogo = [run(HASH_ANTIGA, config())];
	const t = telaVazia();

	// 1. o usuário clica em Gerar enquanto os dois requests do mount vão e voltam
	aplicarCliqueGerar(t);
	// 2. a recuperação em disco resolve AGORA, antes do 202
	aplicarRecuperacaoEmDisco(t, catalogo, 'pronto', result(HASH_ANTIGA));
	assert.equal(t.result, null, 'a tela já tinha dono no clique');
	assert.equal(t.desc, null);

	// 3. o 202 chega com o hash da corrida nova
	aplicarAceite(t, HASH_NOVA, bodyDoFormulario);
	assert.equal(bodyExportado(t)?.size, 32);

	// 4. a corrida termina
	aplicarEntregaDaSondagem(t, result(HASH_NOVA));
	assert.equal(bodyExportado(t)?.size, 32, 'o bundle documenta o que foi gerado');
	assert.equal(bodyExportado(t)?.description, 'mago de manto azul');
});

test('VARIANTE — recuperação que chega DEPOIS do 202 também é recusada', () => {
	const catalogo = [run(HASH_ANTIGA, config())];
	const t = telaVazia();
	aplicarCliqueGerar(t);
	aplicarAceite(t, HASH_NOVA, bodyDoFormulario);
	aplicarRecuperacaoEmDisco(t, catalogo, 'pronto', result(HASH_ANTIGA));
	assert.equal(bodyExportado(t)?.size, 32);
	assert.equal(t.pending?.hash, HASH_NOVA);
});

// ------------------------------------------------------- limitação conhecida

test('manifesto legado sem config: body null, e ninguém inventa uma config', () => {
	const legado = [run(HASH_ANTIGA)];
	const t = telaVazia();
	aplicarRecuperacaoEmDisco(t, legado, 'pronto', result(HASH_ANTIGA));
	assert.equal(t.result?.hash, HASH_ANTIGA);
	assert.equal(bodyExportado(t), null, '"Baixar JSON" fica desabilitado');
	assert.equal(resumoNaTela(t), `corrida ${HASH_ANTIGA}`);
	// Reler o catálogo não muda nada: a config não existe em lugar nenhum.
	aplicarRefrescoDoDescritor(t, legado);
	assert.equal(bodyExportado(t), null);
});

test('tela vazia recuperada do disco continua exportável quando há config', () => {
	const t = telaVazia();
	aplicarRecuperacaoEmDisco(t, [run(HASH_ANTIGA, config())], 'pronto', result(HASH_ANTIGA));
	assert.equal(bodyExportado(t)?.size, 256);
	assert.equal(resumoNaTela(t), '256 px · low top-down · 2 saídas');
});
