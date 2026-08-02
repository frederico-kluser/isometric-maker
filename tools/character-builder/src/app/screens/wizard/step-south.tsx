/**
 * Passo 2 — face sul: geração por texto (com referência opcional), preview
 * pixelado, loop de edição por prompt, faixa de versões (tooltip com o
 * prompt de cada uma) e desfazer.
 *
 * O histórico vem de wizard.southVersions; os arquivos seguem o contrato
 * /assets/wizard/<charId>/south-v<i>.png. Personagem importado chega sem
 * histórico — nesse caso só o preview aparece (editar/undo exigem versão).
 *
 * Falha e andamento vêm do progress (wizard-progress.ts): o servidor nunca
 * marca a célula como `gerando`, então o skeleton e o estado de trabalho do
 * botão seguem o JOB (studio.jobs), não o ciclo do POST — o POST volta em
 * ~200ms e a geração leva minutos. A caixa de falha tem "Tentar de novo",
 * que re-chama a mesma rota (a idempotência não bloqueia: a célula não
 * está `pronto`; na edição, o prompt diferente também não é idempotente).
 */
import { useState } from 'react';
import { Skeleton } from '@/components/motion-ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { MoldId } from '../../../../server/model.ts';
import { versaoSulAria, wizard } from '../../../strings/wizard.ts';
import { api } from '../../studio-store.tsx';
import { ActionButton } from './action-button.tsx';
import { FailureNotice } from './failure-notice.tsx';
import { MoldPicker } from './mold-picker.tsx';
import {
	ReferencePicker,
	type ReferenceImage,
} from './reference-picker.tsx';
import { ReferenceCropEditor } from './reference-crop-editor.tsx';
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
	// Prefill: o que o usuário escreveu, não a descrição efetiva. Em modo
	// manequim `character.description` já vem com o andaime dentro, e reexibi-lo
	// faria o usuário editar o andaime em vez do estilo.
	const [description, setDescription] = useState(
		progress.wizard.southVersions[progress.wizard.activeSouth]?.prompt ??
			progress.character.description,
	);
	const [refImage, setRefImage] = useState<ReferenceImage | null>(null);
	const [refProbe, setRefProbe] = useState(0);
	// Imagem recém-escolhida que ainda não foi cropada — abre o editor de
	// recorte. null = editor fechado.
	const [pendingCropImage, setPendingCropImage] = useState<ReferenceImage | null>(null);
	// Molde de proporção. Default: o que o personagem já tem. Nenhum molde é
	// escolha válida e é o caminho histórico — não vale forçar "adulto" em quem
	// nunca pediu molde.
	const [mold, setMold] = useState<MoldId | null>(
		progress.character.mold ?? null,
	);
	// O corpo-base começa em modo manequim; personagens derivados, não. É a
	// única combinação em que o default acerta sem o usuário mexer.
	const [mannequin, setMannequin] = useState(
		progress.character.mannequin ?? progress.character.id === 'manequim',
	);
	const [negativo, setNegativo] = useState(
		progress.character.negativePrompt ?? '',
	);
	const action = useAction(refresh);
	const generating = progress.southGenerating;
	const failure = generating ? undefined : progress.southError;

	const generate = (): void =>
		void action.run(async () => {
			await api('wizard/south', {
				method: 'POST',
				body: JSON.stringify({
					characterId: progress.character.id,
					description: description.trim(),
					mannequin,
					// null APAGA o molde no servidor; undefined deixaria o anterior
					// valendo, e o usuário que desmarcou veria a proporção antiga.
					mold,
					negativePrompt: negativo.trim(),
					// b64 puro, sem prefixo data: — o servidor grava o upload em
					// assets/wizard/<charId>/reference.png e usa como init_image.
					...(refImage ? { referenceBase64: refImage.base64 } : {}),
				}),
			});
			if (refImage) {
				// Upload gravado: a escolha local sai de cena e a sondagem
				// re-executa — o preview passa a vir do arquivo em disco.
				setRefImage(null);
				setRefProbe((v) => v + 1);
			}
		});

	const handleCropConfirm = (croppedBase64: string): void => {
		if (!pendingCropImage) return;
		setRefImage({
			dataUri: `data:image/png;base64,${croppedBase64}`,
			base64: croppedBase64,
			name: pendingCropImage.name,
		});
		setPendingCropImage(null);
	};

	return (
		<>
			{generating ? (
				<Skeleton className="size-48" />
			) : null}
			<div className="flex flex-col gap-2">
				<Label>{wizard.sul.referenciaRotulo}</Label>
				<ReferencePicker
					characterId={progress.character.id}
					image={refImage}
					onChange={(img) => {
						if (img) setPendingCropImage(img);
						else setRefImage(null);
					}}
					probeKey={refProbe}
					refresh={refresh}
					disabled={generating || busy}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label>{wizard.sul.moldeRotulo}</Label>
				<MoldPicker
					value={mold}
					onChange={setMold}
					disabled={generating || busy}
				/>
				<p className="max-w-prose text-xs text-muted-foreground">
					{wizard.sul.moldeNota}
				</p>
			</div>
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<Checkbox
						id="wizard-sul-manequim"
						checked={mannequin}
						onCheckedChange={(v: boolean) => setMannequin(v)}
						disabled={generating || busy}
					/>
					<Label htmlFor="wizard-sul-manequim">
						{wizard.sul.manequimRotulo}
					</Label>
				</div>
				<p className="max-w-prose text-xs text-muted-foreground">
					{wizard.sul.manequimNota}
				</p>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor="wizard-sul-descricao">
					{mannequin
						? wizard.sul.estiloRotulo
						: wizard.sul.descricaoRotulo}
				</Label>
				<Textarea
					id="wizard-sul-descricao"
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					placeholder={
						mannequin
							? wizard.sul.placeholderEstilo
							: wizard.sul.placeholderDescricao
					}
					disabled={generating || busy}
				/>
			</div>
			{mannequin ? (
				<div className="flex flex-col gap-2">
					<Label htmlFor="wizard-sul-negativo">
						{wizard.sul.negativoRotulo}
					</Label>
					<Input
						id="wizard-sul-negativo"
						value={negativo}
						onChange={(e) => setNegativo(e.target.value)}
						placeholder={wizard.sul.placeholderNegativo}
						disabled={generating || busy}
					/>
				</div>
			) : null}
			{failure !== undefined ? (
				<FailureNotice message={failure}>
					<ActionButton
						state={action.state}
						message={action.message}
						label={wizard.acoes.tentarDeNovo}
						disabled={description.trim() === '' || busy}
						onClick={generate}
					/>
				</FailureNotice>
			) : (
				<ActionButton
					state={action.state}
					message={action.message}
					generating={generating}
					label={wizard.sul.gerar}
					disabled={description.trim() === '' || busy}
					onClick={generate}
				/>
			)}

			{pendingCropImage ? (
				<ReferenceCropEditor
					imageDataUri={pendingCropImage.dataUri}
					outputSize={progress.character.size}
					onConfirm={handleCropConfirm}
					onCancel={() => setPendingCropImage(null)}
				/>
			) : null}
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
	const generating = progress.southGenerating;
	// Edição falhada: a versão anterior continua pronta — é por isso que o
	// erro aparece aqui mesmo com southReady (o job é a única fonte).
	const failure = generating ? undefined : progress.southError;

	const runEdit = (): void =>
		void edit.run(() =>
			api('wizard/south/edit', {
				method: 'POST',
				body: JSON.stringify({
					characterId: character.id,
					prompt: prompt.trim(),
				}),
			}),
		);

	return (
		<>
			{generating ? (
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
					{failure !== undefined ? (
						<FailureNotice message={failure}>
							<ActionButton
								state={edit.state}
								message={edit.message}
								label={wizard.acoes.tentarDeNovo}
								disabled={prompt.trim() === '' || busy}
								onClick={runEdit}
							/>
						</FailureNotice>
					) : null}
					<div className="flex flex-wrap items-start gap-3">
						{failure === undefined ? (
							<ActionButton
								state={edit.state}
								message={edit.message}
								generating={generating}
								label={wizard.sul.editar}
								disabled={prompt.trim() === '' || busy}
								onClick={runEdit}
							/>
						) : null}
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
