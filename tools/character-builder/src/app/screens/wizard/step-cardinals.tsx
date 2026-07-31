/**
 * Passo 3 — cardeais: um botão dispara as três rotações. Cada célula mostra
 * o seu estado: skeleton enquanto o LOTE gera, a arte quando pronta, um X
 * quando falhou e um placeholder tracejado antes de começar. A nota deixa
 * explícito que E e N saem em paralelo e W só depois — é a ordem do
 * servidor, não da tela.
 *
 * O skeleton NÃO lê o status da célula: o spawn do servidor nunca marca
 * célula do wizard como `gerando` — o andamento vive no job do lote
 * (cardinalsBatchKey), já fundido em progress.cardinalsGenerating. Falha do
 * lote vira caixa com a mensagem do servidor e "Tentar de novo", que
 * re-chama a mesma rota — a idempotência é POR DIREÇÃO, então a nova
 * tentativa refaz só o que não ficou pronto.
 */
import { Skeleton } from '@/components/motion-ui/skeleton';
import { X } from 'lucide-react';
import { cardealAria, wizard } from '../../../strings/wizard.ts';
import { DIR_SHORT } from '../../../../server/model.ts';
import { api } from '../../studio-store.tsx';
import { ActionButton } from './action-button.tsx';
import { FailureNotice } from './failure-notice.tsx';
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
	const generating = progress.cardinalsGenerating;
	const failure = generating ? undefined : progress.cardinalsError;

	const generate = (): void =>
		void action.run(() =>
			api('wizard/cardinals', {
				method: 'POST',
				body: JSON.stringify({ characterId: progress.character.id }),
			}),
		);

	return (
		<>
			<div className="flex flex-wrap gap-3">
				{CARDINAL_DIRECTIONS.map((d) => {
					const cell = progress.cardinalCells[d];
					const src = cell?.frames?.[d]?.[0];
					// O job do lote cobre as três: enquanto ele gera, toda célula
					// não-pronta é trabalho em andamento (W incluso — sai por último).
					const cellGenerating = generating && cell?.status !== 'pronto';
					const failed = cell?.status === 'falhou';
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
							) : cellGenerating ? (
								<Skeleton className="size-24" />
							) : failed ? (
								<div
									aria-hidden
									className="flex size-24 items-center justify-center rounded-md border border-destructive border-dashed text-sm text-destructive"
								>
									<X className="size-6" />
								</div>
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
				failure !== undefined ? (
					<FailureNotice message={failure}>
						<ActionButton
							state={action.state}
							message={action.message}
							label={wizard.acoes.tentarDeNovo}
							disabled={!progress.southReady || busy}
							onClick={generate}
						/>
					</FailureNotice>
				) : (
					<ActionButton
						state={action.state}
						message={action.message}
						generating={generating}
						label={wizard.cardeais.gerar}
						disabled={!progress.southReady || busy}
						onClick={generate}
					/>
				)
			) : null}
		</>
	);
}
