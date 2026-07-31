/**
 * Derivação pura do progresso do wizard a partir do studio v2.
 *
 * O passo ativo sai de `character.wizard.etapa` + status das células
 * (`southKey`, `cardinalKey`, `directions8Key`), e a trilha inteira é
 * derivada daqui — sem estado paralelo.
 *
 * Os JOBS entram na derivação porque o servidor nunca marca célula do
 * wizard como `gerando` (o spawn do api.ts escreve célula só na falha):
 * o andamento real vive em `studio.jobs[chave].status`, e a mensagem de
 * erro chega primeiro em `studio.jobs[chave].message` quando o job falha.
 * As chaves são as mesmas que o spawn usa: southKey, cardinalsBatchKey
 * (o lote das três cardeais) e directions8Key.
 *
 * Separado da UI para rodar sob `node --test` sem DOM.
 */
import {
	cardinalKey,
	cardinalsBatchKey,
	directions8Key,
	southKey,
	type Cell,
	type Character,
	type Studio,
	type WizardState,
} from '../../../../server/model.ts';

export type WizardStepId = 'config' | 'sul' | 'cardeais' | 'direcoes8' | 'pronto';

export type StepStatus = 'done' | 'active' | 'todo' | 'failed';

/** Os cinco passos da trilha, na ordem da cadeia derivativa. */
export const WIZARD_STEPS: readonly WizardStepId[] = [
	'config',
	'sul',
	'cardeais',
	'direcoes8',
	'pronto',
];

export const CARDINAL_DIRECTIONS = ['east', 'north', 'west'] as const;
export type CardinalDirection = (typeof CARDINAL_DIRECTIONS)[number];

export interface WizardStep {
	readonly id: WizardStepId;
	readonly status: StepStatus;
}

export interface WizardProgress {
	readonly character: Character;
	/** Wizard state efetivo — default de primeira execução quando ausente. */
	readonly wizard: WizardState;
	readonly southCell: Cell | undefined;
	readonly cardinalCells: Readonly<Record<CardinalDirection, Cell | undefined>>;
	readonly dir8Cell: Cell | undefined;
	/** studio.lock presente — a config travou (passo 1 concluído). */
	readonly locked: boolean;
	readonly southReady: boolean;
	readonly southGenerating: boolean;
	readonly cardinalsReady: boolean;
	readonly cardinalsGenerating: boolean;
	readonly dir8Ready: boolean;
	readonly dir8Generating: boolean;
	/**
	 * Mensagem de erro da sul: do job `falhou` em studio.jobs (chega primeiro,
	 * assim que o spawn registra), com fallback para o erro da célula — que o
	 * spawn também grava, e é o que sobrevive a um restart do servidor.
	 * Presente MESMO com a célula pronta: uma edição falhada deixa a versão
	 * anterior pronta, e o erro precisa aparecer no passo mesmo assim.
	 */
	readonly southError: string | undefined;
	/** Idem para o lote das cardeais (chave de lote + erro das células). */
	readonly cardinalsError: string | undefined;
	/** Idem para as 8 direções. */
	readonly dir8Error: string | undefined;
	/** wizard.etapa === 'pronto': corpo-base fechado. */
	readonly ready: boolean;
	/** Primeiro passo não concluído; 'pronto' quando todos concluídos. */
	readonly activeStep: WizardStepId;
	readonly steps: readonly WizardStep[];
	/** Per-step error messages when a relevant job or cell has failed. */
	readonly stepErrors: Partial<Record<WizardStepId, string>>;
	/**
	 * Primeira execução do manequim: nenhuma versão de sul gerada ainda.
	 * É o único momento em que a tela oferece importar o default do projeto.
	 */
	readonly firstRun: boolean;
}

/** Estado inicial do wizard para personagens sem `wizard` (v2 é aditivo). */
export function defaultWizardState(): WizardState {
	return { etapa: 'sul', southVersions: [], activeSouth: 0 };
}

const generating = (cell: Cell | undefined, jobStatus?: string): boolean =>
	jobStatus === 'gerando' || cell?.status === 'gerando' || cell?.status === 'na-fila';

/** Forma mínima do job que a derivação lê (compatível com StudioResponse.jobs). */
export interface WizardJobInfo {
	readonly status: string;
	readonly message?: string;
}

/** Deriva o progresso completo do wizard de um personagem já resolvido. */
export function deriveWizard(
	studio: Studio,
	character: Character,
	jobs?: Record<string, WizardJobInfo>,
): WizardProgress {
	const wizard = character.wizard ?? defaultWizardState();
	const cells = studio.cells;

	const southCell = cells[southKey(character.id)];
	const cardinalCells: Record<CardinalDirection, Cell | undefined> = {
		east: cells[cardinalKey(character.id, 'east')],
		north: cells[cardinalKey(character.id, 'north')],
		west: cells[cardinalKey(character.id, 'west')],
	};
	const dir8Cell = cells[directions8Key(character.id)];

	const locked = studio.lock != null;
	const southReady = southCell?.status === 'pronto';
	const cardinalsReady = CARDINAL_DIRECTIONS.every(
		(d) => cardinalCells[d]?.status === 'pronto',
	);
	const ready = wizard.etapa === 'pronto';
	const dir8Ready = ready || dir8Cell?.status === 'pronto';

	// Erro do job tem precedência sobre o da célula: o spawn registra o job
	// falhou ANTES de gravar as células, então o job é o sinal mais fresco.
	// A célula é o fallback — e o que resta depois de um restart (jobs são
	// memória do processo; células falhou persistem no studio.json).
	const jobFailedMessage = (key: string): string | undefined =>
		jobs?.[key]?.status === 'falhou' ? jobs[key]?.message : undefined;
	const cellFailedError = (cell: Cell | undefined): string | undefined =>
		cell?.status === 'falhou' ? cell.error : undefined;

	const southError =
		jobFailedMessage(southKey(character.id)) ?? cellFailedError(southCell);
	const cardinalsError =
		jobFailedMessage(cardinalsBatchKey(character.id)) ??
		CARDINAL_DIRECTIONS.map((d) => cellFailedError(cardinalCells[d])).find(
			(e) => e !== undefined,
		);
	const dir8Error =
		jobFailedMessage(directions8Key(character.id)) ?? cellFailedError(dir8Cell);

	// A TRILHA só marca "falhou" quando o passo não está concluído — uma
	// edição da sul que falhou deixa a versão anterior pronta (passo feito,
	// erro visível no corpo), e marcar a trilha como falha seria mentira.
	const stepErrors: Partial<Record<WizardStepId, string>> = {};
	if (!southReady && southError !== undefined) stepErrors['sul'] = southError;
	if (!cardinalsReady && cardinalsError !== undefined) {
		stepErrors['cardeais'] = cardinalsError;
	}
	if (!dir8Ready && dir8Error !== undefined) {
		stepErrors['direcoes8'] = dir8Error;
	}

	const done: Record<WizardStepId, boolean> = {
		config: locked,
		sul: southReady,
		cardeais: cardinalsReady,
		direcoes8: dir8Ready,
		pronto: ready,
	};

	const activeStep = WIZARD_STEPS.find((id) => !done[id]) ?? 'pronto';
	const steps: WizardStep[] = WIZARD_STEPS.map((id) => {
		if (stepErrors[id] !== undefined) return { id, status: 'failed' };
		if (done[id]) return { id, status: 'done' };
		if (id === activeStep) return { id, status: 'active' };
		return { id, status: 'todo' };
	});

	return {
		character,
		wizard,
		southCell,
		cardinalCells,
		dir8Cell,
		locked,
		southReady,
		southGenerating: generating(southCell, jobs?.[southKey(character.id)]?.status),
		cardinalsReady,
		cardinalsGenerating:
			CARDINAL_DIRECTIONS.some((d) =>
				generating(cardinalCells[d], jobs?.[cardinalKey(character.id, d)]?.status),
			) || jobs?.[cardinalsBatchKey(character.id)]?.status === 'gerando',
		dir8Ready,
		dir8Generating: generating(dir8Cell, jobs?.[directions8Key(character.id)]?.status),
		southError,
		cardinalsError,
		dir8Error,
		ready,
		activeStep,
		steps,
		stepErrors,
		firstRun:
			character.id === 'manequim' &&
			wizard.southVersions.length === 0 &&
			!southReady &&
			southError === undefined &&
			cardinalsError === undefined &&
			dir8Error === undefined,
	};
}

/** O manequim fechou as 8 direções — libera derivar novos personagens. */
export function isMannequinReady(studio: Studio): boolean {
	return (
		studio.characters.find((c) => c.id === 'manequim')?.wizard?.etapa ===
		'pronto'
	);
}

/** Resolve o personagem selecionado, caindo no manequim quando o id some. */
export function resolveCharacter(
	studio: Studio,
	characterId: string,
): Character | undefined {
	return (
		studio.characters.find((c) => c.id === characterId) ??
		studio.characters.find((c) => c.id === 'manequim') ??
		studio.characters[0]
	);
}
