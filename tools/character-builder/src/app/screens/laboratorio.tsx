/**
 * Aba Laboratório — playground livre do endpoint /rotate.
 *
 * Uma execução = UMA chamada POST /api/rotate-lab (síncrona, 15–40 s). O
 * formulário espelha o RotateLabInput do servidor: o modo escolhido no
 * segmented-toggle decide o XOR do /rotate (par from/to_direction + views
 * OU direction_change/view_change em graus), e a montagem/validação local
 * do body vive no módulo puro ./body.ts (testado com node --test).
 *
 * Sem fala de orçamento: o único número exibido é o usage que a própria
 * chamada devolve, apresentado como dado.
 */
import { useEffect, useRef, useState } from 'react';
import { CheckIcon, LoaderCircleIcon, XIcon } from 'lucide-react';
import { api } from '../studio-store.tsx';
import { DIRECTIONS, DIR_SHORT, type Direction } from '../../../server/model.ts';
import type { RotateLabResult } from '../../../server/rotate-lab.ts';
import {
	laboratorio as SL,
	dimensoesDetectadas,
	resumoAngulos,
	resumoDirecoes,
} from '../../strings/laboratorio.ts';
import { Button } from '@/components/ui/button';
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import {
	Accordion,
	AccordionItem,
	AccordionPanel,
	AccordionTrigger,
} from '@/components/motion-ui/accordion';
import { MultiStateButton } from '@/components/motion-ui/multi-state-button';
import {
	SegmentedToggle,
	SegmentedToggleOption,
} from '@/components/motion-ui/segmented-toggle';
import {
	buildRotateLabBody,
	type BodyErrorCode,
	type RotateMode,
} from './laboratorio/body.ts';
import { ImageDropzone, type LoadedImage } from './laboratorio/dropzone.tsx';
import { ResultPanel, type ResultPair } from './laboratorio/result-panel.tsx';
import { HistoryPanel, type HistoryEntry } from './laboratorio/history-panel.tsx';

/** CameraView do spec vendorizado — os três únicos valores aceitos pelo /rotate. */
const CAMERA_VIEWS = ['side', 'low top-down', 'high top-down'] as const;

/** Erros locais → mensagem pt-BR (validação do servidor vem pronta em err.message). */
const CLIENT_ERROR_TEXT: Record<BodyErrorCode, string> = {
	'image-missing': SL.erros.imagemObrigatoria,
	'size-range': SL.erros.tamanhoForaDaFaixa,
	'direction-change-range': SL.erros.giroForaDaFaixa,
	'view-change-range': SL.erros.inclinacaoForaDaFaixa,
	'seed-invalid': SL.erros.seedInvalida,
};

type ButtonState = 'idle' | 'running' | 'done' | 'error';

export function LaboratorioScreen() {
	// ── imagem principal + imageSize (preenchido pela detecção, editável) ──
	const [image, setImage] = useState<LoadedImage | null>(null);
	const [widthText, setWidthText] = useState('');
	const [heightText, setHeightText] = useState('');

	// ── modo e parâmetros da rotação ──
	const [mode, setMode] = useState<RotateMode>('directions');
	const [fromDirection, setFromDirection] = useState<Direction>('south');
	const [toDirection, setToDirection] = useState<Direction>('east');
	const [fromView, setFromView] = useState<string>('side');
	const [toView, setToView] = useState<string>('side');
	const [directionChangeText, setDirectionChangeText] = useState('90');
	const [viewChangeText, setViewChangeText] = useState('0');

	// ── avançado ──
	const [initImage, setInitImage] = useState<LoadedImage | null>(null);
	const [strength, setStrength] = useState(300);
	const [seedText, setSeedText] = useState('');
	const [isometric, setIsometric] = useState(false);

	// ── execução, resultado e histórico ──
	const [buttonState, setButtonState] = useState<ButtonState>('idle');
	const [error, setError] = useState<string | null>(null);
	const [pair, setPair] = useState<ResultPair | null>(null);
	const [history, setHistory] = useState<HistoryEntry[]>([]);
	const nextId = useRef(1);
	const resetTimer = useRef<number | undefined>(undefined);

	const scheduleReset = (): void => {
		window.clearTimeout(resetTimer.current);
		resetTimer.current = window.setTimeout(() => setButtonState('idle'), 2600);
	};
	useEffect(() => () => window.clearTimeout(resetTimer.current), []);

	const running = buttonState === 'running';

	// Aviso do fornecedor sobre trocar a view — só aparece quando a troca está pedida.
	const viewChanges =
		mode === 'directions' ? fromView !== toView : Number(viewChangeText) !== 0;

	const handleRun = async (): Promise<void> => {
		const currentImage = image;
		if (!currentImage) {
			setError(SL.erros.imagemObrigatoria);
			setButtonState('error');
			scheduleReset();
			return;
		}
		const built = buildRotateLabBody({
			imageBase64: currentImage.base64,
			widthText,
			heightText,
			mode,
			fromDirection,
			toDirection,
			fromView,
			toView,
			directionChangeText,
			viewChangeText,
			initImageBase64: initImage?.base64 ?? null,
			initImageStrength: strength,
			seedText,
			isometric,
		});
		if (!built.ok) {
			setError(CLIENT_ERROR_TEXT[built.code]);
			setButtonState('error');
			scheduleReset();
			return;
		}

		setError(null);
		setButtonState('running');
		try {
			const result = await api<RotateLabResult>('rotate-lab', {
				method: 'POST',
				body: JSON.stringify(built.body),
			});
			const summary =
				mode === 'directions'
					? resumoDirecoes(DIR_SHORT[fromDirection], DIR_SHORT[toDirection], fromView, toView)
					: resumoAngulos(Number(directionChangeText), Number(viewChangeText));
			setPair({ originalDataUri: currentImage.dataUri, summary, result });
			setHistory((h) => [
				{
					id: nextId.current++,
					at: new Date(),
					thumbDataUri: `data:image/png;base64,${result.image}`,
					summary,
					// Sem usage na resposta = o PNG já existia para o mesmo hash.
					fromCache: result.usage === undefined,
				},
				...h,
			]);
			setButtonState('done');
		} catch (err) {
			// Erros 400 do servidor já chegam em pt-BR (RotateLabValidationError).
			setError(err instanceof Error ? err.message : String(err));
			setButtonState('error');
		} finally {
			scheduleReset();
		}
	};

	const buttonLabel =
		buttonState === 'running'
			? SL.executar.rotacionando
			: buttonState === 'done'
				? SL.executar.pronto
				: buttonState === 'error'
					? SL.executar.falhou
					: SL.executar.rotacionar;

	const buttonIcon =
		buttonState === 'running' ? (
			<LoaderCircleIcon className="size-4 animate-spin" />
		) : buttonState === 'done' ? (
			<CheckIcon className="size-4" />
		) : buttonState === 'error' ? (
			<XIcon className="size-4" />
		) : undefined;

	return (
		<div className="flex flex-col gap-6">
			<header className="flex flex-col gap-1">
				<h2 className="text-balance text-xl font-semibold">{SL.titulo}</h2>
				<p className="max-w-prose text-pretty text-sm text-muted-foreground">
					{SL.descricao}
				</p>
			</header>

			<div className="grid items-start gap-6 lg:grid-cols-2">
				{/* ──────────────────── coluna do formulário ──────────────────── */}
				<div className="flex flex-col gap-4">
					<Card>
						<CardHeader>
							<CardTitle>{SL.upload.titulo}</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-3">
							<ImageDropzone
								image={image}
								onLoad={(img) => {
									setImage(img);
									setWidthText(String(img.width));
									setHeightText(String(img.height));
								}}
								emptyText={SL.upload.vazio}
								loadedHint={
									image
										? `${dimensoesDetectadas(image.width, image.height)} — ${SL.upload.trocar}`
										: SL.upload.trocar
								}
							/>
							<div className="grid grid-cols-2 gap-3">
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="lab-width">{SL.upload.largura}</Label>
									<Input
										id="lab-width"
										type="number"
										min={16}
										max={200}
										step={1}
										value={widthText}
										onChange={(e) => setWidthText(e.target.value)}
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="lab-height">{SL.upload.altura}</Label>
									<Input
										id="lab-height"
										type="number"
										min={16}
										max={200}
										step={1}
										value={heightText}
										onChange={(e) => setHeightText(e.target.value)}
									/>
								</div>
							</div>
							<p className="text-xs text-muted-foreground">{SL.upload.notaTamanho}</p>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>{SL.modo.rotulo}</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-4">
							<SegmentedToggle
								value={mode}
								onChange={(v) => setMode(v)}
								ariaLabel={SL.modo.ariaLabel}
							>
								<SegmentedToggleOption value="directions">
									{SL.modo.porDirecao}
								</SegmentedToggleOption>
								<SegmentedToggleOption value="angles">
									{SL.modo.porAngulos}
								</SegmentedToggleOption>
							</SegmentedToggle>

							{mode === 'directions' ? (
								<div className="grid grid-cols-2 gap-3">
									<div className="flex flex-col gap-1.5">
										<Label htmlFor="lab-from-dir">{SL.direcoes.de}</Label>
										<Select
											value={fromDirection}
											onValueChange={(v) => setFromDirection(v as Direction)}
										>
											<SelectTrigger id="lab-from-dir" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{DIRECTIONS.map((d) => (
													<SelectItem key={d} value={d}>
														{SL.directions[d]}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
									<div className="flex flex-col gap-1.5">
										<Label htmlFor="lab-to-dir">{SL.direcoes.para}</Label>
										<Select
											value={toDirection}
											onValueChange={(v) => setToDirection(v as Direction)}
										>
											<SelectTrigger id="lab-to-dir" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{DIRECTIONS.map((d) => (
													<SelectItem key={d} value={d}>
														{SL.directions[d]}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
									<div className="flex flex-col gap-1.5">
										<Label htmlFor="lab-from-view">{SL.direcoes.viewDe}</Label>
										<Select
											value={fromView}
											onValueChange={(v) => {
												if (v !== null) setFromView(v);
											}}
										>
											<SelectTrigger id="lab-from-view" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{CAMERA_VIEWS.map((v) => (
													<SelectItem key={v} value={v}>
														{v}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
									<div className="flex flex-col gap-1.5">
										<Label htmlFor="lab-to-view">{SL.direcoes.viewPara}</Label>
										<Select
											value={toView}
											onValueChange={(v) => {
												if (v !== null) setToView(v);
											}}
										>
											<SelectTrigger id="lab-to-view" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{CAMERA_VIEWS.map((v) => (
													<SelectItem key={v} value={v}>
														{v}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								</div>
							) : (
								<div className="flex flex-col gap-3">
									<div className="grid grid-cols-2 gap-3">
										<div className="flex flex-col gap-1.5">
											<Label htmlFor="lab-dir-change">{SL.angulos.giro}</Label>
											<Input
												id="lab-dir-change"
												type="number"
												min={-180}
												max={180}
												step={1}
												value={directionChangeText}
												onChange={(e) => setDirectionChangeText(e.target.value)}
											/>
										</div>
										<div className="flex flex-col gap-1.5">
											<Label htmlFor="lab-view-change">{SL.angulos.inclinacao}</Label>
											<Input
												id="lab-view-change"
												type="number"
												min={-90}
												max={90}
												step={1}
												value={viewChangeText}
												onChange={(e) => setViewChangeText(e.target.value)}
											/>
										</div>
									</div>
									<p className="text-xs text-muted-foreground">{SL.angulos.nota}</p>
								</div>
							)}

							{viewChanges && (
								<p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
									{SL.direcoes.avisoTrocaView}
								</p>
							)}
						</CardContent>
					</Card>

					<Accordion className="rounded-xl border border-border bg-card">
						<AccordionItem value="avancado">
							<AccordionTrigger className="px-4 py-3 text-sm font-medium" inset>
								{SL.avancado.titulo}
							</AccordionTrigger>
							<AccordionPanel className="flex flex-col gap-4 px-4 pb-4">
								<div className="flex flex-col gap-1.5">
									<Label>{SL.avancado.initTitulo}</Label>
									<ImageDropzone
										image={initImage}
										onLoad={setInitImage}
										emptyText={SL.avancado.initVazio}
										loadedHint={SL.upload.trocar}
										compact
									/>
									{initImage && (
										<div>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setInitImage(null)}
											>
												{SL.avancado.initRemover}
											</Button>
										</div>
									)}
								</div>

								{/* Slider: não há slider entre os componentes instalados (shadcn
								    ui/ nem registry @motion) — input range nativo com classes
								    semânticas, justificado pela cascata da skill. */}
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="lab-strength">
										{SL.avancado.forca}: {strength}
									</Label>
									<input
										id="lab-strength"
										type="range"
										min={1}
										max={999}
										step={1}
										value={strength}
										onChange={(e) => setStrength(Number(e.target.value))}
										className="w-full accent-primary"
									/>
									<p className="text-xs text-muted-foreground">
										{SL.avancado.forcaNota}
									</p>
								</div>

								<div className="flex flex-col gap-1.5">
									<Label htmlFor="lab-seed">{SL.avancado.seed}</Label>
									<Input
										id="lab-seed"
										type="number"
										step={1}
										placeholder={SL.avancado.seedPlaceholder}
										value={seedText}
										onChange={(e) => setSeedText(e.target.value)}
									/>
									<p className="text-xs text-muted-foreground">
										{SL.avancado.seedNota}
									</p>
								</div>

								<div className="flex flex-col gap-1.5">
									<div className="flex items-center gap-2">
										<Checkbox
											id="lab-isometric"
											checked={isometric}
											onCheckedChange={(c) => setIsometric(c === true)}
										/>
										<Label htmlFor="lab-isometric">
											{SL.avancado.isometrico}
										</Label>
									</div>
									<p className="text-xs text-muted-foreground">
										{SL.avancado.isometricoNota}
									</p>
								</div>
							</AccordionPanel>
						</AccordionItem>
					</Accordion>

					<div className="flex flex-col items-start gap-3">
						<MultiStateButton
							state={buttonState}
							onClick={() => void handleRun()}
							disabled={running}
							icon={buttonIcon}
							feedback={
								buttonState === 'done'
									? 'pop'
									: buttonState === 'error'
										? 'shake'
										: 'none'
							}
							surfaceClassName={
								buttonState === 'error'
									? 'bg-destructive/15 text-destructive'
									: 'bg-primary text-primary-foreground'
							}
							announce={buttonLabel}
							aria-label={SL.executar.ariaLabel}
						>
							{buttonLabel}
						</MultiStateButton>
						{error !== null && (
							<p
								role="alert"
								className="w-full rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
							>
								{error}
							</p>
						)}
					</div>
				</div>

				{/* ──────────────────── coluna do resultado ──────────────────── */}
				<div className="flex flex-col gap-4">
					<ResultPanel pair={pair} running={running} />
					<HistoryPanel entries={history} />
				</div>
			</div>
		</div>
	);
}
