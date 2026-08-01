/**
 * Card de importação no topo da trilha do wizard: a entrada alternativa que
 * não gera nada. Aceita só os dois bundles do estúdio — a sul pronta do
 * Laboratório (o wizard continua nas 8 direções) ou um personagem completo
 * exportado pelo próprio Wizard. A pré-checagem do `kind` é local e recusa
 * qualquer outro JSON antes de incomodar o servidor; a validação de verdade
 * (pixels, lock, remoteId) é do /api/wizard/import, e o erro dele aparece
 * verbatim, como todo erro HTTP da tela.
 */
import { FileJson } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { wizard } from '../../../strings/wizard.ts';
import { api, useSelectedCharacter } from '../../studio-store.tsx';
import { useAction } from './use-action.ts';

/** Os únicos `kind` que o /api/wizard/import aceita — recusa local antes do POST. */
const ACCEPTED_KINDS: readonly string[] = [
	'sprite-lab-south',
	'sprite-wizard-directions',
];

export function ImportCard({
	refresh,
}: {
	readonly refresh: () => Promise<void>;
}) {
	const { characterId } = useSelectedCharacter();
	const importAction = useAction(refresh);
	const fileRef = useRef<HTMLInputElement>(null);
	const [fileError, setFileError] = useState<string | null>(null);

	const onFile = async (file: File): Promise<void> => {
		setFileError(null);
		let bundle: unknown;
		try {
			bundle = JSON.parse(await file.text()) as unknown;
		} catch {
			setFileError(wizard.importar.arquivoInvalido);
			return;
		}
		const kind =
			typeof bundle === 'object' && bundle !== null
				? (bundle as Record<string, unknown>)['kind']
				: undefined;
		if (typeof kind !== 'string' || !ACCEPTED_KINDS.includes(kind)) {
			setFileError(wizard.importar.tipoDesconhecido);
			return;
		}
		await importAction.run(() =>
			api('wizard/import', {
				method: 'POST',
				body: JSON.stringify({ characterId, bundle }),
			}),
		);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-base">
					<FileJson aria-hidden className="size-4" />
					{wizard.importar.titulo}
				</CardTitle>
				<CardDescription className="max-w-prose text-pretty">
					{wizard.importar.texto}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col items-start gap-3">
				<Button variant="outline" onClick={() => fileRef.current?.click()}>
					<FileJson aria-hidden />
					{wizard.importar.escolher}
				</Button>
				<input
					ref={fileRef}
					type="file"
					accept=".json,application/json"
					className="hidden"
					onChange={(e) => {
						const file = e.target.files?.[0];
						e.target.value = '';
						if (file) void onFile(file);
					}}
				/>
				{fileError ? (
					<p role="alert" className="max-w-prose text-sm text-destructive">
						{fileError}
					</p>
				) : null}
				{importAction.state === 'error' && importAction.message ? (
					<p role="alert" className="max-w-prose text-sm text-destructive">
						{importAction.message}
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}
