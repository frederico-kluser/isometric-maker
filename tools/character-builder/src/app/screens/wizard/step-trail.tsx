/**
 * Trilha de progresso do wizard: os quatro passos da cadeia derivativa v3 com
 * o estado de cada um (concluído / atual / pendente). O passo de cardeais foi
 * removido com a migração v3.
 *
 * Código novo porque o registry @motion não tem stepper — são `<ol>` +
 * tokens shadcn; o movimento da tela fica por conta dos componentes de ação.
 */
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { wizard } from '../../../strings/wizard.ts';
import type { WizardStep, WizardStepId } from './wizard-progress.ts';

const STEP_LABEL: Record<WizardStepId, string> = {
	config: wizard.trilha.passos.config,
	sul: wizard.trilha.passos.sul,
	direcoes8: wizard.trilha.passos.direcoes8,
	pronto: wizard.trilha.passos.pronto,
};

const STATUS_SR: Record<WizardStep['status'], string> = {
	done: wizard.trilha.concluido,
	active: wizard.trilha.atual,
	todo: wizard.trilha.pendente,
	failed: wizard.trilha.falhou,
};

export function StepTrail({ steps }: { readonly steps: readonly WizardStep[] }) {
	return (
		<nav aria-label={wizard.trilha.ariaLabel}>
			<ol className="flex flex-wrap items-center gap-x-3 gap-y-2">
				{steps.map((step, i) => (
					<li key={step.id} className="flex items-center gap-3">
						{i > 0 ? (
							<span aria-hidden className="h-px w-6 bg-border" />
						) : null}
						<span
							className={cn(
								'flex items-center gap-2 text-sm',
								step.status === 'todo' && 'text-muted-foreground',
							)}
							aria-current={step.status === 'active' ? 'step' : undefined}
						>
							<span
								aria-hidden
								className={cn(
									'flex size-6 items-center justify-center rounded-full border text-xs font-medium',
									step.status === 'done' &&
										'border-primary bg-primary text-primary-foreground',
									step.status === 'failed' &&
										'border-destructive bg-destructive text-destructive-foreground',
									step.status === 'active' && 'border-primary text-foreground',
									step.status === 'todo' && 'border-border',
								)}
							>
								{step.status === 'done' ? (
									<Check className="size-3.5" />
								) : step.status === 'failed' ? (
									<X className="size-3.5" />
								) : (
									i + 1
								)}
							</span>
							{STEP_LABEL[step.id]}
							<span className="sr-only">({STATUS_SR[step.status]})</span>
						</span>
					</li>
				))}
			</ol>
		</nav>
	);
}
