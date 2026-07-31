/**
 * Primeira execução do manequim (nenhuma versão de sul ainda): boas-vindas
 * e os dois caminhos de import — o default do projeto (quando disponível) e
 * um bundle .json exportado antes. Importar não gera nada: é filesystem e
 * validação no servidor, e o wizard acorda já em "pronto".
 */
import { FileJson, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { wizard } from '../../../strings/wizard.ts';
import { api, type StudioResponse } from '../../studio-store.tsx';
import { ActionButton } from './action-button.tsx';
import { useAction } from './use-action.ts';

export function FirstRun({
	studio,
	refresh,
}: {
	readonly studio: StudioResponse;
	readonly refresh: () => Promise<void>;
}) {
	const importDefault = useAction(refresh);
	const importFile = useAction(refresh);
	const fileRef = useRef<HTMLInputElement>(null);
	const [fileError, setFileError] = useState<string | null>(null);

	const onFile = async (file: File): Promise<void> => {
		setFileError(null);
		let bundle: unknown;
		try {
			bundle = JSON.parse(await file.text()) as unknown;
		} catch {
			setFileError(wizard.boasVindas.arquivoInvalido);
			return;
		}
		await importFile.run(() =>
			api('mannequin/import', {
				method: 'POST',
				body: JSON.stringify({ bundle }),
			}),
		);
	};

	return (
		<Card className="ring-primary/40">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Sparkles aria-hidden className="size-4" />
					{wizard.boasVindas.titulo}
				</CardTitle>
				<CardDescription className="max-w-prose text-pretty">
					{wizard.boasVindas.texto}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<div className="flex flex-wrap items-center gap-3">
					{studio.mannequinDefaultAvailable ? (
						<ActionButton
							state={importDefault.state}
							message={importDefault.message}
							label={wizard.boasVindas.importarDefault}
							loadingLabel={wizard.acoes.aguarde}
							onClick={() =>
								void importDefault.run(
									() =>
										api('mannequin/import', {
											method: 'POST',
											body: JSON.stringify({ source: 'default' }),
										}),
									{ keepSuccess: true },
								)
							}
						/>
					) : null}
					<Button
						variant="outline"
						onClick={() => fileRef.current?.click()}
					>
						<FileJson aria-hidden />
						{wizard.boasVindas.importarArquivo}
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
				</div>
				{studio.mannequinDefaultAvailable ? (
					<p className="max-w-prose text-sm text-muted-foreground">
						{wizard.boasVindas.importarDefaultNota}
					</p>
				) : null}
				{fileError ? (
					<p role="alert" className="text-sm text-destructive">
						{fileError}
					</p>
				) : null}
				{importFile.state === 'error' && importFile.message ? (
					<p role="alert" className="text-sm text-destructive">
						{importFile.message}
					</p>
				) : null}
				<div className="flex items-center gap-3">
					<Separator className="flex-1" />
					<span className="text-sm text-muted-foreground">
						{wizard.boasVindas.ouGereDoZero}
					</span>
					<Separator className="flex-1" />
				</div>
			</CardContent>
		</Card>
	);
}
