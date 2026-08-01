/**
 * Exportação do bundle do wizard na etapa pronto: o servidor monta o
 * `sprite-wizard-directions` (sul + 8 direções em base64 + config + remoteId)
 * e a tela baixa o JSON recebido via Blob + a.click, sem plugin. Vale para
 * qualquer personagem pronto — manequim ou derivado; é este arquivo que
 * poses, itens e o próprio wizard importam depois. Erro do servidor aparece
 * verbatim no multi-state-button.
 */
import { wizard } from '../../../strings/wizard.ts';
import { api } from '../../studio-store.tsx';
import { ActionButton } from './action-button.tsx';
import { useAction } from './use-action.ts';

export function ExportButton({
	characterId,
	refresh,
}: {
	readonly characterId: string;
	readonly refresh: () => Promise<void>;
}) {
	const exportAction = useAction(refresh);

	return (
		<div className="flex flex-col gap-2">
			<ActionButton
				state={exportAction.state}
				message={exportAction.message}
				label={wizard.pronto.exportarJson}
				loadingLabel={wizard.acoes.aguarde}
				onClick={() =>
					void exportAction.run(async () => {
						const bundle = await api<unknown>('wizard/export', {
							method: 'POST',
							body: JSON.stringify({ characterId }),
						});
						downloadJson(bundle, `${characterId}-wizard.json`);
					})
				}
			/>
			<p className="max-w-prose text-sm text-muted-foreground">
				{wizard.pronto.exportarJsonNota}
			</p>
		</div>
	);
}

/** Baixa o JSON devolvido pelo servidor como um arquivo, sem plugin. */
function downloadJson(bundle: unknown, fileName: string): void {
	const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], {
		type: 'application/json',
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	a.click();
	URL.revokeObjectURL(url);
}
