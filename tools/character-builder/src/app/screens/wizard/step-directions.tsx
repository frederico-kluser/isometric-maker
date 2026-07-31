/**
 * Passo 4 — oito direções: um botão dispara a geração (diagonais geradas,
 * cardeais congeladas). Durante o job a grade mostra 8 skeletons; ao concluir,
 * a grade real com as siglas DIR_SHORT e o confetti do registry — disparado
 * só na transição gerando→pronto, nunca na carga inicial da página.
 *
 * Andamento e falha vêm do progress: o servidor nunca marca a célula como
 * `gerando`, então o skeleton e o estado de trabalho do botão seguem o JOB
 * (studio.jobs), não o ciclo do POST. Falha vira caixa com a mensagem do
 * servidor e "Tentar de novo" na mesma rota — a célula não está `pronto`,
 * então a idempotência não bloqueia a nova tentativa.
 */
import { useEffect, useRef } from 'react';
import {
	Confetti,
	type ConfettiHandle,
} from '@/components/motion-ui/confetti';
import { Skeleton } from '@/components/motion-ui/skeleton';
import { DIRECTIONS, DIR_SHORT } from '../../../../server/model.ts';
import { direcaoAria, wizard } from '../../../strings/wizard.ts';
import { api } from '../../studio-store.tsx';
import { ActionButton } from './action-button.tsx';
import { FailureNotice } from './failure-notice.tsx';
import { useAction } from './use-action.ts';
import type { WizardProgress } from './wizard-progress.ts';

export function DirectionsStep({
	progress,
	refresh,
	busy,
}: {
	readonly progress: WizardProgress;
	readonly refresh: () => Promise<void>;
	readonly busy: boolean;
}) {
	const action = useAction(refresh);
	const confettiRef = useRef<ConfettiHandle>(null);
	const prevReady = useRef<boolean | undefined>(undefined);

	useEffect(() => {
		if (prevReady.current === false && progress.dir8Ready) {
			confettiRef.current?.burst();
		}
		prevReady.current = progress.dir8Ready;
	}, [progress.dir8Ready]);

	const generating = progress.dir8Generating;
	const failure = generating ? undefined : progress.dir8Error;

	const generate = (): void =>
		void action.run(() =>
			api('wizard/directions8', {
				method: 'POST',
				body: JSON.stringify({ characterId: progress.character.id }),
			}),
		);

	return (
		<div className="relative flex flex-col gap-4">
			<Confetti ref={confettiRef} />
			{progress.dir8Ready || generating ? (
				<div className="grid max-w-md grid-cols-4 gap-3">
					{DIRECTIONS.map((d) => {
						const src = progress.dir8Cell?.frames?.[d]?.[0];
						return (
							<div
								key={d}
								className="flex flex-col items-center gap-1"
								aria-label={direcaoAria(DIR_SHORT[d])}
							>
								{progress.dir8Ready && src ? (
									<img
										src={src}
										alt={`${wizard.direcoes8.altPronta} ${DIR_SHORT[d]}`}
										className="size-20 rounded-md bg-muted [image-rendering:pixelated]"
									/>
								) : (
									<Skeleton className="size-20" animate={generating} />
								)}
								<span className="text-xs text-muted-foreground">
									{DIR_SHORT[d]}
								</span>
							</div>
						);
					})}
				</div>
			) : null}
			{!progress.dir8Ready ? (
				<>
					{failure !== undefined ? (
						<FailureNotice message={failure}>
							<ActionButton
								state={action.state}
								message={action.message}
								label={wizard.acoes.tentarDeNovo}
								disabled={!progress.cardinalsReady || !progress.locked || busy}
								onClick={generate}
							/>
						</FailureNotice>
					) : (
						<ActionButton
							state={action.state}
							message={action.message}
							generating={generating}
							label={wizard.direcoes8.gerar}
							disabled={!progress.cardinalsReady || !progress.locked || busy}
							onClick={generate}
						/>
					)}
					{!progress.locked ? (
						<p className="text-sm text-muted-foreground">
							{wizard.direcoes8.faltaConfig}
						</p>
					) : null}
				</>
			) : null}
		</div>
	);
}
