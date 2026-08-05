/**
 * Derivação pura do progresso do wizard a partir do studio v2.
 *
 * O passo ativo sai de `character.wizard.etapa` + status das células
 * (`southKey`, `directions8Key`), e a trilha inteira é derivada daqui —
 * sem estado paralelo.
 *
 * Os JOBS entram na derivação porque o servidor nunca marca célula do
 * wizard como `gerando` (o spawn do api.ts escreve célula só na falha):
 * o andamento real vive em `studio.jobs[chave].status`, e a mensagem de
 * erro chega primeiro em `studio.jobs[chave].message` quando o job falha.
 * As chaves são as mesmas que o spawn usa: southKey e directions8Key.
 *
 * Separado da UI para rodar sob `node --test` sem DOM.
 */
import {
	directions8Key,
	southKey,
	type Cell,
	type Character,
	type Studio,
	type WizardState,
} from '../../../../server/model.ts';
import { isBusyStatus } from '../../job-scope.ts';

export type WizardStepId = 'config' | 'sul' | 'direcoes8' | 'pronto';

export type StepStatus = 'done' | 'active' | 'todo' | 'failed';

/** Os quatro passos da trilha, na ordem da cadeia derivativa v3. */
export const WIZARD_STEPS: readonly WizardStepId[] = [
	'config',
	'sul',
	'direcoes8',
	'pronto',
];

export interface WizardStep {
	readonly id: WizardStepId;
	readonly status: StepStatus;
}

export interface WizardProgress {
	readonly character: Character;
	readonly wizard: WizardState;
	readonly southCell: Cell | undefined;
	readonly dir8Cell: Cell | undefined;
	readonly locked: boolean;
	readonly southReady: boolean;
	readonly southGenerating: boolean;
	readonly dir8Ready: boolean;
	readonly dir8Generating: boolean;
	readonly southError: string | undefined;
	readonly dir8Error: string | undefined;
	readonly ready: boolean;
	readonly activeStep: WizardStepId;
	readonly steps: readonly WizardStep[];
	readonly stepErrors: Partial<Record<WizardStepId, string>>;
	readonly firstRun: boolean;
}

/** Estado inicial do wizard para personagens sem `wizard` (v2 é aditivo). */
export function defaultWizardState(): WizardState {
	return { etapa: 'sul', southVersions: [], activeSouth: 0 };
}

/**
 * A etapa está em trabalho — na fila ou gerando.
 *
 * O lado da CÉLULA já contava `'na-fila'`; o lado do JOB só contava
 * `'gerando'`, e essa assimetria virou defeito com a fila.
 *
 * Não é que o servidor deixe de marcar a célula: `enqueueAndRespond` passa
 * `cellKeys: [southKey(...)]` / `[directions8Key(...)]` e `syncJobCells`
 * escreve `'na-fila'` nela (`server/api.ts`). O buraco é a **regra 1** desse
 * espelho — célula `'pronto'` nunca é sobrescrita, porque é progresso pago e a
 * idempotência de `mannequin.ts` lê exatamente esse status. Então ao REGERAR
 * uma sul que já está pronta, a célula continua `'pronto'` de propósito e só o
 * lado do JOB tem notícia do pedido novo: contando apenas `'gerando'` lá, a
 * etapa aceita e enfileirada aparecia como se nada tivesse acontecido — sem
 * skeleton, com o botão convidando a pedir de novo a MESMA face sul paga.
 *
 * `isBusyStatus` é o predicado único dos dois estados (`src/app/job-scope.ts`).
 */
const generating = (cell: Cell | undefined, jobStatus?: string): boolean =>
	isBusyStatus(jobStatus) ||
	cell?.status === 'gerando' ||
	cell?.status === 'na-fila';

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
	const dir8Cell = cells[directions8Key(character.id)];

	const locked = studio.lock != null;
	const southReady = southCell?.status === 'pronto';
	const ready = wizard.etapa === 'pronto';
	const dir8Ready = ready || dir8Cell?.status === 'pronto';

	const jobFailedMessage = (key: string): string | undefined =>
		jobs?.[key]?.status === 'falhou' ? jobs[key]?.message : undefined;
	const cellFailedError = (cell: Cell | undefined): string | undefined =>
		cell?.status === 'falhou' ? cell.error : undefined;

	const southError =
		jobFailedMessage(southKey(character.id)) ?? cellFailedError(southCell);
	const dir8Error =
		jobFailedMessage(directions8Key(character.id)) ?? cellFailedError(dir8Cell);

	const stepErrors: Partial<Record<WizardStepId, string>> = {};
	if (!southReady && southError !== undefined) stepErrors['sul'] = southError;
	if (!dir8Ready && dir8Error !== undefined) {
		stepErrors['direcoes8'] = dir8Error;
	}

	const done: Record<WizardStepId, boolean> = {
		config: locked,
		sul: southReady,
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
		dir8Cell,
		locked,
		southReady,
		southGenerating: generating(southCell, jobs?.[southKey(character.id)]?.status),
		dir8Ready,
		dir8Generating: generating(dir8Cell, jobs?.[directions8Key(character.id)]?.status),
		southError,
		dir8Error,
		ready,
		activeStep,
		steps,
		stepErrors,
		firstRun:
			character.id === studio.characters[0]?.id &&
			wizard.southVersions.length === 0 &&
			!southReady &&
			southError === undefined &&
			dir8Error === undefined,
	};
}

/** Algum personagem fechou as 8 direções — libera derivar novos personagens. */
export function isMannequinReady(studio: Studio): boolean {
	return studio.characters.some((c) => c.wizard?.etapa === 'pronto');
}

/** Resolve o personagem selecionado, caindo no primeiro disponível quando o id some. */
export function resolveCharacter(
	studio: Studio,
	characterId: string,
): Character | undefined {
	return (
		studio.characters.find((c) => c.id === characterId) ??
		studio.characters[0]
	);
}
