/**
 * Passo 2 — face sul: geração por texto, preview pixelado, loop de edição
 * por prompt, faixa de versões (tooltip com o prompt de cada uma) e desfazer.
 *
 * O histórico vem de wizard.southVersions; os arquivos seguem o contrato
 * /assets/wizard/<charId>/south-v<i>.png. Personagem importado chega sem
 * histórico — nesse caso só o preview aparece (editar/undo exigem versão).
 */
import { useState } from 'react';
import { Skeleton } from '@/components/motion-ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { versaoSulAria, wizard } from '../../../strings/wizard.ts';
import { api } from '../../studio-store.tsx';
import { ActionButton } from './action-button.tsx';
import { useAction } from './use-action.ts';
import type { WizardProgress } from './wizard-progress.ts';

export function SouthStep({
	progress,
	refresh,
	busy,
}: {
	readonly progress: WizardProgress;
	readonly refresh: () => Promise<void>;
	readonly busy: boolean;
}) {
	if (!progress.southReady) {
		return (
			<SouthGenerate progress={progress} refresh={refresh} busy={busy} />
		);
	}
	return <SouthReview progress={progress} refresh={refresh} busy={busy} />;
}

// ------------------------------------------------------------------ gerar

function SouthGenerate({
	progress,
	refresh,
	busy,
}: {
	readonly progress: WizardProgress;
	readonly refresh: () => Promise<void>;
	readonly busy: boolean;
}) {
	const [description, setDescription] = useState(progress.character.description);
	const action = useAction(refresh);
	const generating = progress.southGenerating;

	return (
		<>
			{generating ? (
				<Skeleton className="size-48" />
			) : null}
			<div className="flex flex-col gap-2">
				<Label htmlFor="wizard-sul-descricao">
					{wizard.sul.descricaoRotulo}
				</Label>
				<Textarea
					id="wizard-sul-descricao"
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					placeholder={wizard.sul.placeholderDescricao}
					disabled={generating || busy}
				/>
			</div>
			<ActionButton
				state={action.state}
				message={action.message}
				generating={generating}
				label={wizard.sul.gerar}
				disabled={description.trim() === '' || busy}
				onClick={() =>
					void action.run(() =>
						api('wizard/south', {
							method: 'POST',
							body: JSON.stringify({
								characterId: progress.character.id,
								description: description.trim(),
							}),
						}),
					)
				}
			/>
		</>
	);
}

// ------------------------------------------------------------------ revisar

function SouthReview({
	progress,
	refresh,
	busy,
}: {
	readonly progress: WizardProgress;
	readonly refresh: () => Promise<void>;
	readonly busy: boolean;
}) {
	const [prompt, setPrompt] = useState('');
	const edit = useAction(refresh);
	const undo = useAction(refresh);

	const { wizard: wiz, character } = progress;
	const versions = wiz.southVersions;
	const southSrc = progress.southCell?.frames?.['south']?.[0];

	return (
		<>
			{progress.southGenerating ? (
				<Skeleton className="size-48" />
			) : southSrc ? (
				<img
					src={southSrc}
					alt={wizard.sul.altPreview}
					className="size-48 rounded-md bg-muted [image-rendering:pixelated]"
				/>
			) : null}

			{versions.length > 0 ? (
				<>
					<div className="flex flex-col gap-2">
						<Label htmlFor="wizard-sul-edicao">{wizard.sul.editarRotulo}</Label>
						<Input
							id="wizard-sul-edicao"
							value={prompt}
							onChange={(e) => setPrompt(e.target.value)}
							placeholder={wizard.sul.placeholderEdicao}
							disabled={busy}
						/>
					</div>
					<div className="flex flex-wrap items-start gap-3">
						<ActionButton
							state={edit.state}
							message={edit.message}
							generating={progress.southGenerating}
							label={wizard.sul.editar}
							disabled={prompt.trim() === '' || busy}
							onClick={() =>
								void edit.run(() =>
									api('wizard/south/edit', {
										method: 'POST',
										body: JSON.stringify({
											characterId: character.id,
											prompt: prompt.trim(),
										}),
									}),
								)
							}
						/>
						{wiz.activeSouth > 0 ? (
							<ActionButton
								state={undo.state}
								message={undo.message}
								label={wizard.sul.desfazer}
								loadingLabel={wizard.acoes.aguarde}
								idleSurface="bg-secondary text-secondary-foreground"
								disabled={busy}
								onClick={() =>
									void undo.run(() =>
										api('wizard/south/undo', {
											method: 'POST',
											body: JSON.stringify({ characterId: character.id }),
										}),
									)
								}
							/>
						) : (
							<Tooltip>
								<TooltipTrigger render={<span className="inline-flex" />}>
									<span className="inline-flex cursor-not-allowed rounded-md bg-muted px-5 py-3 text-sm font-medium text-muted-foreground">
										{wizard.sul.desfazer}
									</span>
								</TooltipTrigger>
								<TooltipContent>{wizard.sul.desfazerBloqueado}</TooltipContent>
							</Tooltip>
						)}
					</div>
					<div className="flex flex-col gap-2">
						<span className="text-sm font-medium">{wizard.sul.versoes}</span>
						<div className="flex flex-wrap gap-2">
							{versions.map((v, i) => (
								<Tooltip key={`${i}-${v.at}`}>
									<TooltipTrigger
										render={
											<span
												className={cn(
													'inline-flex rounded-md',
													i === wiz.activeSouth && 'ring-2 ring-primary',
												)}
											/>
										}
									>
										<img
											src={`/assets/wizard/${character.id}/south-v${i}.png`}
											alt={versaoSulAria(i)}
											className="size-12 rounded-md bg-muted [image-rendering:pixelated]"
										/>
									</TooltipTrigger>
									<TooltipContent>{v.prompt}</TooltipContent>
								</Tooltip>
							))}
						</div>
					</div>
				</>
			) : null}
		</>
	);
}
