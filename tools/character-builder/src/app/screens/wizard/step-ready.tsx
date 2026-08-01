/**
 * Passo 5 — pronto: corpo-base fechado nas 8 direções.
 *
 * Todo personagem pronto exporta o bundle do wizard em JSON (ExportButton —
 * é o arquivo que poses, itens e o próprio wizard importam). No manequim há
 * ainda as duas ações do contrato: exportar como default do projeto (o
 * servidor grava packages/game-assets/manequim e devolve o bundle, que a tela
 * baixa como .json via Blob) e refazer o manequim — destrutivo, por isso
 * hold-to-confirm em vez de clique simples. Personagem derivado pronto não
 * tem essas duas: o default é sempre o manequim.
 */
import { Download, RotateCcw } from 'lucide-react';
import { HoldToConfirmButton } from '@/components/motion-ui/hold-to-confirm';
import { Separator } from '@/components/ui/separator';
import { wizard } from '../../../strings/wizard.ts';
import { api } from '../../studio-store.tsx';
import { ActionButton } from './action-button.tsx';
import { ExportButton } from './export-button.tsx';
import { useAction } from './use-action.ts';
import type { WizardProgress } from './wizard-progress.ts';

const EXPORT_FILE_NAME = 'mannequin-bundle.json';

export function ReadyStep({
	progress,
	refresh,
}: {
	readonly progress: WizardProgress;
	readonly refresh: () => Promise<void>;
}) {
	const isMannequin = progress.character.id === 'manequim';
	const exportAction = useAction(refresh);
	const resetAction = useAction(refresh);

	return (
		<>
			<p className="max-w-prose text-pretty text-sm text-muted-foreground">
				{isMannequin
					? wizard.pronto.textoManequim
					: wizard.pronto.textoDerivado}
			</p>
			<ExportButton characterId={progress.character.id} refresh={refresh} />
			{isMannequin ? (
				<>
					<Separator />
					<div className="flex flex-col gap-2">
						<ActionButton
							state={exportAction.state}
							message={exportAction.message}
							label={wizard.pronto.exportar}
							loadingLabel={wizard.acoes.aguarde}
							onClick={() =>
								void exportAction.run(async () => {
									const bundle = await api<unknown>('mannequin/export', {
										method: 'POST',
										body: '{}',
									});
									downloadBundle(bundle);
								})
							}
						/>
						<p className="max-w-prose text-sm text-muted-foreground">
							{wizard.pronto.exportarNota}
						</p>
					</div>
					<Separator />
					<div className="flex flex-col gap-2">
						<HoldToConfirmButton
							holdSeconds={2}
							aria-describedby="wizard-refazer-ajuda"
							onConfirm={() =>
								void resetAction.run(() =>
									api('mannequin/reset', { method: 'POST', body: '{}' }),
								)
							}
						>
							<RotateCcw aria-hidden className="size-4" />
							{wizard.pronto.refazer}
						</HoldToConfirmButton>
						<p
							id="wizard-refazer-ajuda"
							className="max-w-prose text-sm text-muted-foreground"
						>
							{wizard.pronto.refazerAjuda}
						</p>
						{resetAction.state === 'error' && resetAction.message ? (
							<p role="alert" className="text-sm text-destructive">
								{resetAction.message}
							</p>
						) : null}
					</div>
				</>
			) : null}
		</>
	);
}

/** Baixa o bundle devolvido pelo servidor como um .json, sem plugin. */
function downloadBundle(bundle: unknown): void {
	const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], {
		type: 'application/json',
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = EXPORT_FILE_NAME;
	a.click();
	URL.revokeObjectURL(url);
}
