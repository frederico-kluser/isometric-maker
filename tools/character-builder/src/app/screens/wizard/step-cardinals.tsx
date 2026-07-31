/**
 * Passo 3 — cardeais: um botão dispara as três rotações. Cada célula mostra
 * o seu estado: skeleton enquanto gera, a arte quando pronta, e um placeholder
 * tracejado antes de começar. A nota deixa explícito que E e N saem em
 * paralelo e W só depois — é a ordem do servidor, não da tela.
 */
import { Skeleton } from '@/components/motion-ui/skeleton';
import { cardealAria, wizard } from '../../../strings/wizard.ts';
import { DIR_SHORT } from '../../../../server/model.ts';
import { api } from '../../studio-store.tsx';
import { ActionButton } from './action-button.tsx';
import { useAction } from './use-action.ts';
import {
	CARDINAL_DIRECTIONS,
	type CardinalDirection,
	type WizardProgress,
} from './wizard-progress.ts';

const DIR_SIGLA: Record<CardinalDirection, string> = {
	east: DIR_SHORT.east,
	north: DIR_SHORT.north,
	west: DIR_SHORT.west,
};

export function CardinalsStep({
	progress,
	refresh,
	busy,
}: {
	readonly progress: WizardProgress;
	readonly refresh: () => Promise<void>;
	readonly busy: boolean;
}) {
	const action = useAction(refresh);

	return (
		<>
			<div className="flex flex-wrap gap-3">
				{CARDINAL_DIRECTIONS.map((d) => {
					const cell = progress.cardinalCells[d];
					const src = cell?.frames?.[d]?.[0];
					const generating =
						cell?.status === 'gerando' || cell?.status === 'na-fila';
					return (
						<div
							key={d}
							className="flex flex-col items-center gap-1"
							aria-label={cardealAria(DIR_SIGLA[d])}
						>
							{cell?.status === 'pronto' && src ? (
								<img
									src={src}
									alt={`${wizard.cardeais.altPronta} ${DIR_SIGLA[d]}`}
									className="size-24 rounded-md bg-muted [image-rendering:pixelated]"
								/>
							) : generating ? (
								<Skeleton className="size-24" />
							) : (
								<div
									aria-hidden
									className="flex size-24 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground"
								>
									{DIR_SIGLA[d]}
								</div>
							)}
							<span className="text-xs text-muted-foreground">
								{DIR_SIGLA[d]}
							</span>
						</div>
					);
				})}
			</div>
			{!progress.cardinalsReady ? (
				<ActionButton
					state={action.state}
					message={action.message}
					generating={progress.cardinalsGenerating}
					label={wizard.cardeais.gerar}
					disabled={!progress.southReady || busy}
					onClick={() =>
						void action.run(() =>
							api('wizard/cardinals', {
								method: 'POST',
								body: JSON.stringify({ characterId: progress.character.id }),
							}),
						)
					}
				/>
			) : null}
		</>
	);
}
