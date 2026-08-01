/**
 * Aba Wizard — a cadeia derivativa inteira do personagem selecionado:
 * config → face sul → cardeais → 8 direções → pronto.
 *
 * O ImportCard no topo é a entrada alternativa: um JSON do Laboratório
 * (sul pronta) ou do próprio Wizard cai no meio da cadeia sem remover
 * nada do fluxo original.
 *
 * A tela não guarda progresso: deriva tudo de `character.wizard.etapa` +
 * células + jobs (wizard-progress.ts — o servidor nunca marca célula do
 * wizard como `gerando`; andamento e falha vivem em studio.jobs) e lê o
 * studio do useStudio, que já faz poll enquanto houver geração. Toda ação
 * remota sai pelo multi-state-button e todo erro HTTP aparece como veio do
 * servidor (pt-BR), sem diálogo de orçamento em nenhuma forma.
 */
import { wizard } from '../../strings/wizard.ts';
import { useSelectedCharacter, useStudio } from '../studio-store.tsx';
import { CharacterHeader } from './wizard/character-header.tsx';
import { FirstRun } from './wizard/first-run.tsx';
import { ImportCard } from './wizard/import-card.tsx';
import { StepCard } from './wizard/step-card.tsx';
import { ConfigStep } from './wizard/step-config.tsx';
import { DirectionsStep } from './wizard/step-directions.tsx';
import { ReadyStep } from './wizard/step-ready.tsx';
import { SouthStep } from './wizard/step-south.tsx';
import { StepTrail } from './wizard/step-trail.tsx';
import {
	deriveWizard,
	resolveCharacter,
	type StepStatus,
	type WizardStepId,
} from './wizard/wizard-progress.ts';

export function WizardScreen() {
	const { studio, refresh, busy, error } = useStudio();
	const { characterId } = useSelectedCharacter();

	if (!studio) {
		return error ? (
			<p role="alert" className="text-sm text-destructive">
				{error}
			</p>
		) : (
			<p className="text-sm text-muted-foreground">{wizard.carregando}</p>
		);
	}

	const character = resolveCharacter(studio, characterId);
	if (!character) {
		return (
			<p className="text-sm text-muted-foreground">{wizard.carregando}</p>
		);
	}
	const progress = deriveWizard(studio, character, studio.jobs);
	const status = (id: WizardStepId): StepStatus =>
		progress.steps.find((s) => s.id === id)?.status ?? 'todo';

	return (
		<div className="flex flex-col gap-6">
			<CharacterHeader studio={studio} refresh={refresh} />
			{/* key reinicia o estado local do import ao trocar de personagem */}
			<ImportCard key={character.id} refresh={refresh} />
			{progress.firstRun ? <FirstRun studio={studio} refresh={refresh} /> : null}
			<StepTrail steps={progress.steps} />
			{/* key reinicia os formulários locais ao trocar de personagem */}
			<div className="flex flex-col gap-4" key={character.id}>
				<StepCard
					title={wizard.config.titulo}
					note={wizard.config.nota}
					status={status('config')}
				>
					<ConfigStep
						progress={progress}
						lock={studio.lock}
						refresh={refresh}
					/>
				</StepCard>
				<StepCard
					title={wizard.sul.titulo}
					note={wizard.sul.nota}
					status={status('sul')}
				>
					<SouthStep progress={progress} refresh={refresh} busy={busy} />
				</StepCard>
				<StepCard
					title={wizard.direcoes8.titulo}
					note={wizard.direcoes8.nota}
					status={status('direcoes8')}
				>
					<DirectionsStep progress={progress} refresh={refresh} busy={busy} />
				</StepCard>
				<StepCard title={wizard.pronto.titulo} status={status('pronto')}>
					<ReadyStep progress={progress} refresh={refresh} />
				</StepCard>
			</div>
			{error ? (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			) : null}
		</div>
	);
}
