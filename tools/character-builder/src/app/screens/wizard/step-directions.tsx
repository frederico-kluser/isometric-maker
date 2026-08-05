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
 *
 * O `block` chega resolvido para ESTE personagem e ESTA etapa
 * (`src/app/job-scope.ts`) — a bancada e os outros personagens não travam mais
 * este botão. Quando ele bloqueia, a nota diz qual trabalho está segurando.
 */
import { useEffect, useRef, useState } from 'react';
import {
	Confetti,
	type ConfettiHandle,
} from '@/components/motion-ui/confetti';
import { Skeleton } from '@/components/motion-ui/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DIRECTIONS, DIR_SHORT } from '../../../../server/model.ts';
import { directions8Key } from '../../../../server/model.ts';
import { bloqueioWizard, direcaoAria, wizard } from '../../../strings/wizard.ts';
import type { WizardBlock } from '../../job-scope.ts';
import { api } from '../../studio-store.tsx';
import { ActionButton } from './action-button.tsx';
import { FailureNotice } from './failure-notice.tsx';
import { useAction } from './use-action.ts';
import type { WizardProgress } from './wizard-progress.ts';

export function DirectionsStep({
	progress,
	refresh,
	block,
}: {
	readonly progress: WizardProgress;
	readonly refresh: () => Promise<void>;
	readonly block: WizardBlock;
}) {
	const blocked = block.blocked;
	const action = useAction(refresh);
	const [cancelling, setCancelling] = useState(false);
	const confettiRef = useRef<ConfettiHandle>(null);
	const prevReady = useRef<boolean | undefined>(undefined);

	const jobKey = directions8Key(progress.character.id);

	const cancel = async (): Promise<void> => {
		setCancelling(true);
		try {
			await api(`jobs/${encodeURIComponent(jobKey)}`, { method: 'DELETE' });
			await refresh();
		} catch {
			// Melhor esforço — o poll vai corrigir o estado de qualquer jeito.
		} finally {
			setCancelling(false);
		}
	};

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
								disabled={
									!progress.southReady || !progress.locked || blocked
								}
								onClick={generate}
							/>
						</FailureNotice>
					) : (
						<div className="flex items-center gap-3">
							<ActionButton
								state={action.state}
								message={action.message}
								generating={generating}
								label={wizard.direcoes8.gerar}
								disabled={!progress.southReady || !progress.locked || blocked}
								onClick={generate}
							/>
							{generating ? (
								<Button
									variant="ghost"
									disabled={cancelling}
									onClick={() => void cancel()}
								>
									{wizard.header.cancelar}
								</Button>
							) : null}
						</div>
					)}
					{!progress.locked ? (
						<p className="text-sm text-muted-foreground">
							{wizard.direcoes8.faltaConfig}
						</p>
					) : null}
				</>
			) : null}
			<BlockNotice block={block} />
		</div>
	);
}

/**
 * Por que o botão está apagado — o escopo sabe QUAL trabalho está segurando, e
 * se ele já começou ou ainda está na fila.
 *
 * Fica FORA do `!dir8Ready`, ao contrário da versão anterior: em
 * `step-south.tsx` a nota sempre existiu, e dois passos que dizem a mesma coisa
 * não podem dizê-la sob condições diferentes. O container também nasce vazio e
 * nunca desmonta — região live `role="status"` que aparece já preenchida não é
 * anunciada por várias combinações de leitor de tela e navegador; o que dispara
 * o anúncio é a inserção de texto num nó que já estava no DOM. `sr-only`
 * enquanto vazio porque um `<p>` vazio ainda consumiria o `gap-4` do flex
 * (posicionamento absoluto o tira do fluxo; `hidden` recriaria o problema).
 */
function BlockNotice({ block }: { readonly block: WizardBlock }) {
	return (
		<p
			role="status"
			className={cn(
				'text-sm text-muted-foreground',
				!block.blocked && 'sr-only',
			)}
		>
			{block.blocked
				? bloqueioWizard(block.reason, block.status, block.label)
				: null}
		</p>
	);
}
