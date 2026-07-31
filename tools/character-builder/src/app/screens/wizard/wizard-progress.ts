/**
 * Derivação pura do progresso do wizard a partir do studio v2.
 *
 * A tela não decide nada olhando timestamps nem jobs: o passo ativo sai de
 * `character.wizard.etapa` + status das células (`southKey`, `cardinalKey`,
 * `directions8Key`), e a trilha inteira é derivada daqui — sem estado paralelo.
 *
 * Separado da UI para rodar sob `node --test` sem DOM.
 */
import {
	cardinalKey,
	directions8Key,
	southKey,
	type Cell,
	type Character,
	type Studio,
	type WizardState,
} from '../../../../server/model.ts';

export type WizardStepId = 'config' | 'sul' | 'cardeais' | 'direcoes8' | 'pronto';

export type StepStatus = 'done' | 'active' | 'todo';

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
	/** wizard.etapa === 'pronto': corpo-base fechado. */
	readonly ready: boolean;
	/** Primeiro passo não concluído; 'pronto' quando todos concluídos. */
	readonly activeStep: WizardStepId;
	readonly steps: readonly WizardStep[];
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

const generating = (cell: Cell | undefined): boolean =>
	cell?.status === 'gerando' || cell?.status === 'na-fila';

/** Deriva o progresso completo do wizard de um personagem já resolvido. */
export function deriveWizard(
	studio: Studio,
	character: Character,
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

	const done: Record<WizardStepId, boolean> = {
		config: locked,
		sul: southReady,
		cardeais: cardinalsReady,
		direcoes8: dir8Ready,
		pronto: ready,
	};

	const activeStep = WIZARD_STEPS.find((id) => !done[id]) ?? 'pronto';
	const steps: WizardStep[] = WIZARD_STEPS.map((id) => ({
		id,
		status: done[id] ? 'done' : id === activeStep ? 'active' : 'todo',
	}));

	return {
		character,
		wizard,
		southCell,
		cardinalCells,
		dir8Cell,
		locked,
		southReady,
		southGenerating: generating(southCell),
		cardinalsReady,
		cardinalsGenerating: CARDINAL_DIRECTIONS.some((d) =>
			generating(cardinalCells[d]),
		),
		dir8Ready,
		dir8Generating: generating(dir8Cell),
		ready,
		activeStep,
		steps,
		firstRun:
			character.id === 'manequim' &&
			wizard.southVersions.length === 0 &&
			!southReady,
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
