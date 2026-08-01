/**
 * Painel "Sprite sul (v3)" — bancada do create-character-v3.
 *
 * Gera N candidatos (1–4) da pose SUL em paralelo: POST /api/sprite-lab
 * devolve 202 {key, hash} na hora e o resultado chega depois por
 * GET /api/sprite-lab/{hash} (404 = ainda pendente) — a v3 é assíncrona e
 * leva minutos. O andamento e a falha do job vêm de studio.jobs[key], como
 * no wizard; os erros 400 do servidor já chegam em pt-BR e são exibidos
 * verbatim.
 *
 * Montagem/validação do body e do bundle de export vivem no módulo puro
 * ./studio-body.ts (testado com node --test); o cálculo do auto-resize da
 * referência (limite de 256×256 da v3) no módulo puro ./image-fit.ts — aqui
 * ficam só o DOM (canvas, download) e a coleta dos inputs.
 */
import { useEffect, useRef, useState } from 'react';
import { CheckIcon, DownloadIcon, LoaderCircleIcon, XIcon } from 'lucide-react';
import { api, useStudio } from '../../studio-store.tsx';
import {
	DETAIL_OPTIONS,
	OUTLINE_OPTIONS,
	TEMPLATE_OPTIONS,
	VIEW_OPTIONS,
} from '../../../../server/model.ts';
import {
	laboratorio as SL,
	imagemAjustadaReferencia,
	nomeArquivoSpriteLab,
	resumoStudio,
	rotuloCandidato,
	usoGeracoes,
	usoUsd,
} from '../../../strings/laboratorio.ts';
import { Badge } from '@/components/ui/badge';
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
import { Textarea } from '@/components/ui/textarea';
import { MultiStateButton } from '@/components/motion-ui/multi-state-button';
import {
	SegmentedToggle,
	SegmentedToggleOption,
} from '@/components/motion-ui/segmented-toggle';
import { Skeleton } from '@/components/motion-ui/skeleton';
import { ImageDropzone, type LoadedImage } from './dropzone.tsx';
import { HistoryPanel, type HistoryEntry } from './history-panel.tsx';
import {
	buildLabBundle,
	buildSpriteLabBody,
	DEFAULT_SIZE,
	MAX_OUTPUTS,
	SIZE_PRESETS,
	type SpriteLabAccepted,
	type SpriteLabBody,
	type SpriteLabResult,
	type StudioErrorCode,
} from './studio-body.ts';
import { fitWithinLimit } from './image-fit.ts';

/** Erros locais → mensagem pt-BR (validação do servidor vem pronta em err.message). */
const CLIENT_ERROR_TEXT: Record<StudioErrorCode, string> = {
	'description-missing': SL.studio.erros.descricaoObrigatoria,
	'view-invalid': SL.studio.erros.viewInvalida,
	'size-invalid': SL.studio.erros.tamanhoInvalido,
	'seed-invalid': SL.studio.erros.seedInvalida,
	'outputs-range': SL.studio.erros.saidasInvalidas,
};

/**
 * Sentinela das selects de qualidade/template: Base UI Select não aceita
 * item com value "" — na montagem do body, 'default' vira "não enviar".
 */
const API_DEFAULT = 'default';

/**
 * O gatilho do Select mostra o VALOR selecionado, não o rótulo do item — então
 * sem isto a tela exibia `default` cru, em inglês, apesar de a lista mostrar
 * "padrão da API". Todo texto que o usuário lê é pt-BR (ADR 0016), e o gatilho
 * é texto que o usuário lê.
 */
const rotuloSelect = (v: unknown, sufixo = ''): string =>
	v === API_DEFAULT || v === null || v === undefined
		? SL.studio.form.padraoApi
		: `${String(v)}${sufixo}`;

type ButtonState = 'idle' | 'running' | 'done' | 'error';

interface PendingRun {
	readonly key: string;
	readonly hash: string;
}

/** Redimensiona no cliente com smoothing DESLIGADO — pixel art não pode borrar. */
async function resizeReference(
	img: LoadedImage,
	width: number,
	height: number,
): Promise<LoadedImage> {
	const el = await new Promise<HTMLImageElement>((resolve, reject) => {
		const i = new Image();
		i.onload = () => resolve(i);
		i.onerror = () => reject(new Error('decode falhou'));
		i.src = img.dataUri;
	});
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (ctx === null) throw new Error('canvas 2d indisponível');
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(el, 0, 0, width, height);
	const dataUri = canvas.toDataURL('image/png');
	return {
		dataUri,
		base64: dataUri.slice(dataUri.indexOf(',') + 1),
		width,
		height,
		name: img.name,
	};
}

export function StudioPanel() {
	// ── formulário da bancada ──
	const [description, setDescription] = useState('');
	const [view, setView] = useState('low top-down');
	const [sizeText, setSizeText] = useState(String(DEFAULT_SIZE));
	const [outputsText, setOutputsText] = useState('1');
	const [seedText, setSeedText] = useState('');
	const [noBackground, setNoBackground] = useState(true);
	const [enhancePrompt, setEnhancePrompt] = useState(false);
	const [outline, setOutline] = useState(API_DEFAULT);
	const [detail, setDetail] = useState(API_DEFAULT);
	const [templateId, setTemplateId] = useState(API_DEFAULT);
	const [reference, setReference] = useState<LoadedImage | null>(null);
	const [resizeWarning, setResizeWarning] = useState<string | null>(null);

	// ── execução, resultado e histórico ──
	const [buttonState, setButtonState] = useState<ButtonState>('idle');
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState<PendingRun | null>(null);
	const [runBody, setRunBody] = useState<SpriteLabBody | null>(null);
	const [runSummary, setRunSummary] = useState('');
	const [result, setResult] = useState<SpriteLabResult | null>(null);
	/**
	 * true SÓ quando o POST resolveu na hora — nada foi submetido nesta
	 * execução. `result.fromCache` não serve: o GET lê o manifesto do disco e
	 * reporta `fromCache: true` mesmo logo depois de uma geração paga.
	 */
	const [semGasto, setSemGasto] = useState(false);
	const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
	const [history, setHistory] = useState<HistoryEntry[]>([]);
	const nextId = useRef(1);
	const resetTimer = useRef<number | undefined>(undefined);

	// Andamento/falha do job, como no wizard: studio.jobs é a fonte fresca.
	const { studio } = useStudio();
	const job = pending !== null ? studio?.jobs?.[pending.key] : undefined;

	const scheduleReset = (): void => {
		window.clearTimeout(resetTimer.current);
		resetTimer.current = window.setTimeout(() => setButtonState('idle'), 2600);
	};
	useEffect(() => () => window.clearTimeout(resetTimer.current), []);

	const running = buttonState === 'running';

	// Sondagem do resultado. O servidor responde 200 com um status NOMEADO
	// ('gerando' | 'pronto' | 'falhou' | 'desconhecido'); andamento não é mais
	// 404, então o console do navegador fica limpo e uma falha de verdade
	// aparece na hora. O tick inicial roda já: cache hit resolve sem espera.
	useEffect(() => {
		if (pending === null) return;
		let cancelled = false;
		const finish = (message: string): void => {
			setError(message);
			setPending(null);
			setButtonState('error');
			scheduleReset();
		};
		const tick = async (): Promise<void> => {
			try {
				const res = await fetch(`/api/sprite-lab/${pending.hash}`);
				const body = (await res.json().catch(() => ({}))) as {
					status?: string;
					error?: string;
					result?: SpriteLabResult;
				};
				if (cancelled) return;
				if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
				if (body.status === 'gerando') return;
				if (body.status === 'falhou' || body.status === 'desconhecido') {
					finish(body.error ?? SL.studio.erros.jobFalhou);
					return;
				}
				const r = body.result;
				if (body.status !== 'pronto' || r === undefined) {
					throw new Error(body.error ?? SL.studio.erros.jobFalhou);
				}
				const first = r.candidates[0];
				setResult(r);
				setSelectedIndex(first?.index ?? null);
				setPending(null);
				setButtonState('done');
				if (first !== undefined) {
					setHistory((h) => [
						{
							id: nextId.current++,
							at: new Date(),
							thumbDataUri: `data:image/png;base64,${first.southB64}`,
							summary: runSummary,
							fromCache: r.fromCache,
						},
						...h,
					]);
				}
				scheduleReset();
			} catch (err) {
				if (cancelled) return;
				finish(err instanceof Error ? err.message : String(err));
			}
		};
		void tick();
		const timer = window.setInterval(() => void tick(), 3000);
		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
		// scheduleReset é estável (só toca ref + setState).
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pending, runSummary]);

	// Falha do job chega por studio.jobs antes de qualquer 200/404 útil.
	useEffect(() => {
		if (pending !== null && job?.status === 'falhou') {
			setError(job.message ?? SL.studio.erros.jobFalhou);
			setPending(null);
			setButtonState('error');
			scheduleReset();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pending, job]);

	// A detecção de "servidor reiniciou no meio da geração" saiu daqui: era uma
	// heurística de 15 s sobre a ausência da chave em studio.jobs, e ela nunca
	// disparava porque dependia de um snapshot que não era renovado. Agora o
	// próprio servidor responde status 'desconhecido' nessa situação, e o tick
	// acima trata na hora.

	const handleReferenceLoad = (img: LoadedImage): void => {
		const fit = fitWithinLimit(img.width, img.height);
		if (fit === null || !fit.resized) {
			setReference(img);
			setResizeWarning(null);
			return;
		}
		void resizeReference(img, fit.width, fit.height)
			.then((resized) => {
				setReference(resized);
				setResizeWarning(
					imagemAjustadaReferencia(img.width, img.height, fit.width, fit.height),
				);
			})
			.catch(() => {
				// Canvas indisponível: vai a original — o servidor valida o limite
				// da v3 e responde 400 em pt-BR antes de gastar.
				setReference(img);
				setResizeWarning(null);
			});
	};

	const handleGenerate = async (): Promise<void> => {
		const built = buildSpriteLabBody({
			description,
			view,
			size: Number(sizeText),
			seedText,
			noBackground,
			outline: outline === API_DEFAULT ? '' : outline,
			detail: detail === API_DEFAULT ? '' : detail,
			enhancePrompt,
			templateId: templateId === API_DEFAULT ? '' : templateId,
			referenceImageBase64: reference?.base64 ?? null,
			outputs: Number(outputsText),
		});
		if (!built.ok) {
			setError(CLIENT_ERROR_TEXT[built.code]);
			setButtonState('error');
			scheduleReset();
			return;
		}

		setError(null);
		setButtonState('running');
		setSemGasto(false);
		try {
			const accepted = await api<SpriteLabAccepted | { status: string; result: SpriteLabResult }>('sprite-lab', {
				method: 'POST',
				body: JSON.stringify(built.body),
			});
			// O body que gerou o lote é congelado aqui: o bundle documenta o que
			// foi gerado, não o que está no formulário agora.
			setRunBody(built.body);
			setRunSummary(resumoStudio(built.body.size, built.body.view, built.body.outputs));
			setSelectedIndex(null);
			// Cache total: o servidor devolve o resultado direto, sem job.
			if ('result' in accepted) {
				const r = accepted.result;
				setResult(r);
				setSemGasto(true);
				setSelectedIndex(r.candidates[0]?.index ?? null);
				setButtonState('done');
				scheduleReset();
				return;
			}
			setResult(null);
			setPending({ key: accepted.key, hash: accepted.hash });
		} catch (err) {
			// Erros 400 do servidor já chegam em pt-BR (SpriteLabValidationError).
			setError(err instanceof Error ? err.message : String(err));
			setButtonState('error');
			scheduleReset();
		}
	};

	const handleDownload = (): void => {
		if (result === null || runBody === null || selectedIndex === null) return;
		const bundle = buildLabBundle({
			body: runBody,
			candidates: result.candidates,
			selectedIndex,
		});
		if (bundle === null) return;
		const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], {
			type: 'application/json',
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = nomeArquivoSpriteLab(result.hash);
		a.click();
		URL.revokeObjectURL(url);
	};

	const buttonLabel =
		buttonState === 'running'
			? SL.studio.executar.gerando
			: buttonState === 'done'
				? SL.studio.executar.pronto
				: buttonState === 'error'
					? SL.studio.executar.falhou
					: SL.studio.executar.gerar;

	const buttonIcon =
		buttonState === 'running' ? (
			<LoaderCircleIcon className="size-4 animate-spin" />
		) : buttonState === 'done' ? (
			<CheckIcon className="size-4" />
		) : buttonState === 'error' ? (
			<XIcon className="size-4" />
		) : undefined;

	const selectedCandidate = result?.candidates.find((c) => c.index === selectedIndex);
	const selectedUsage = selectedCandidate?.usage;

	return (
		<div className="flex flex-col gap-6">
			<header className="flex flex-col gap-1">
				<h2 className="text-balance text-xl font-semibold">{SL.studio.titulo}</h2>
				<p className="max-w-prose text-pretty text-sm text-muted-foreground">
					{SL.studio.descricao}
				</p>
			</header>

			<div className="grid items-start gap-6 lg:grid-cols-2">
				{/* ──────────────────── coluna do formulário ──────────────────── */}
				<div className="flex flex-col gap-4">
					<Card>
						<CardHeader>
							<CardTitle>{SL.studio.form.cartaoPersonagem}</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-4">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="studio-description">
									{SL.studio.form.descricaoRotulo}
								</Label>
								<Textarea
									id="studio-description"
									value={description}
									onChange={(e) => setDescription(e.target.value)}
									placeholder={SL.studio.form.descricaoPlaceholder}
								/>
								<p className="text-xs text-muted-foreground">
									{SL.studio.form.descricaoNota}
								</p>
							</div>

							<div className="grid grid-cols-2 gap-3">
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="studio-view">{SL.studio.form.viewRotulo}</Label>
									<Select
										value={view}
										onValueChange={(v) => {
											if (v !== null) setView(v);
										}}
									>
										<SelectTrigger id="studio-view" className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{VIEW_OPTIONS.map((v) => (
												<SelectItem key={v} value={v}>
													{v}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="studio-size">{SL.studio.form.tamanhoRotulo}</Label>
									<Select
										value={sizeText}
										onValueChange={(v) => {
											if (v !== null) setSizeText(v);
										}}
									>
										<SelectTrigger id="studio-size" className="w-full">
											<SelectValue>{(v) => rotuloSelect(v, ' px')}</SelectValue>
										</SelectTrigger>
										<SelectContent>
											{SIZE_PRESETS.map((s) => (
												<SelectItem key={s} value={String(s)}>
													{s} px
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>
							<p className="text-xs text-muted-foreground">
								{SL.studio.form.viewNota} {SL.studio.form.tamanhoNota}
							</p>

							<div className="flex flex-col gap-1.5">
								<Label>{SL.studio.form.saidasRotulo}</Label>
								<SegmentedToggle
									value={outputsText}
									onChange={(v) => setOutputsText(v)}
									ariaLabel={SL.studio.form.saidasAriaLabel}
								>
									{Array.from({ length: MAX_OUTPUTS }, (_, i) => String(i + 1)).map(
										(n) => (
											<SegmentedToggleOption key={n} value={n}>
												{n}
											</SegmentedToggleOption>
										),
									)}
								</SegmentedToggle>
								<p className="text-xs text-muted-foreground">
									{SL.studio.form.saidasNota}
								</p>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>{SL.studio.form.cartaoQualidade}</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-4">
							<div className="grid grid-cols-2 gap-3">
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="studio-outline">
										{SL.studio.form.outlineRotulo}
									</Label>
									<Select
										value={outline}
										onValueChange={(v) => {
											if (v !== null) setOutline(v);
										}}
									>
										<SelectTrigger id="studio-outline" className="w-full">
											<SelectValue>{(v) => rotuloSelect(v)}</SelectValue>
										</SelectTrigger>
										<SelectContent>
											<SelectItem value={API_DEFAULT}>
												{SL.studio.form.padraoApi}
											</SelectItem>
											{OUTLINE_OPTIONS.map((o) => (
												<SelectItem key={o} value={o}>
													{o}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="studio-detail">{SL.studio.form.detailRotulo}</Label>
									<Select
										value={detail}
										onValueChange={(v) => {
											if (v !== null) setDetail(v);
										}}
									>
										<SelectTrigger id="studio-detail" className="w-full">
											<SelectValue>{(v) => rotuloSelect(v)}</SelectValue>
										</SelectTrigger>
										<SelectContent>
											<SelectItem value={API_DEFAULT}>
												{SL.studio.form.padraoApi}
											</SelectItem>
											{DETAIL_OPTIONS.map((d) => (
												<SelectItem key={d} value={d}>
													{d}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>
							<p className="text-xs text-muted-foreground">
								{SL.studio.form.qualidadeNota}
							</p>

							<div className="flex flex-col gap-1.5">
								<Label htmlFor="studio-template">
									{SL.studio.form.templateRotulo}
								</Label>
								<Select
									value={templateId}
									onValueChange={(v) => {
										if (v !== null) setTemplateId(v);
									}}
								>
									<SelectTrigger id="studio-template" className="w-full">
										<SelectValue>{(v) => rotuloSelect(v)}</SelectValue>
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={API_DEFAULT}>
											{SL.studio.form.padraoApi}
										</SelectItem>
										{TEMPLATE_OPTIONS.map((t) => (
											<SelectItem key={t} value={t}>
												{t}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<p className="text-xs text-muted-foreground">
									{SL.studio.form.templateNota}
								</p>
							</div>

							<div className="flex flex-col gap-1.5">
								<Label htmlFor="studio-seed">{SL.studio.form.seedRotulo}</Label>
								<Input
									id="studio-seed"
									type="number"
									step={1}
									placeholder={SL.studio.form.seedPlaceholder}
									value={seedText}
									onChange={(e) => setSeedText(e.target.value)}
								/>
								<p className="text-xs text-muted-foreground">
									{SL.studio.form.seedNota}
								</p>
							</div>

							<div className="flex flex-col gap-3">
								<div className="flex flex-col gap-1.5">
									<div className="flex items-center gap-2">
										<Checkbox
											id="studio-no-background"
											checked={noBackground}
											onCheckedChange={(c) => setNoBackground(c === true)}
										/>
										<Label htmlFor="studio-no-background">
											{SL.studio.form.semFundo}
										</Label>
									</div>
									<p className="text-xs text-muted-foreground">
										{SL.studio.form.semFundoNota}
									</p>
								</div>
								<div className="flex flex-col gap-1.5">
									<div className="flex items-center gap-2">
										<Checkbox
											id="studio-enhance-prompt"
											checked={enhancePrompt}
											onCheckedChange={(c) => setEnhancePrompt(c === true)}
										/>
										<Label htmlFor="studio-enhance-prompt">
											{SL.studio.form.melhorarPrompt}
										</Label>
									</div>
									<p className="text-xs text-muted-foreground">
										{SL.studio.form.melhorarPromptNota}
									</p>
								</div>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>{SL.studio.form.referenciaRotulo}</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-3">
							<ImageDropzone
								image={reference}
								onLoad={handleReferenceLoad}
								emptyText={SL.studio.form.referenciaVazio}
								loadedHint={SL.upload.trocar}
							/>
							{resizeWarning !== null && (
								<p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
									{resizeWarning}
								</p>
							)}
							<p className="text-xs text-muted-foreground">
								{SL.studio.form.referenciaNota}
							</p>
							{reference !== null && (
								<div>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => {
											setReference(null);
											setResizeWarning(null);
										}}
									>
										{SL.studio.form.referenciaRemover}
									</Button>
								</div>
							)}
						</CardContent>
					</Card>

					<div className="flex flex-col items-start gap-3">
						<MultiStateButton
							state={buttonState}
							onClick={() => void handleGenerate()}
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
							aria-label={SL.studio.executar.ariaLabel}
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
					<Card>
						<CardHeader>
							<CardTitle>{SL.studio.resultado.titulo}</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-4">
							{running ? (
								<>
									<div className="grid grid-cols-2 gap-3">
										{Array.from({ length: Number(outputsText) }, (_, i) => (
											<Skeleton key={i} className="h-40 w-full" />
										))}
									</div>
									<p className="text-sm text-muted-foreground" role="status">
										{job?.message ?? SL.studio.executar.aguardando}
									</p>
								</>
							) : result === null ? (
								<p className="text-sm text-muted-foreground">
									{SL.studio.resultado.vazio}
								</p>
							) : (
								<>
									<div className="grid grid-cols-2 gap-3">
										{result.candidates.map((c) => {
											const selected = c.index === selectedIndex;
											return (
												<button
													key={c.index}
													type="button"
													onClick={() => setSelectedIndex(c.index)}
													className={`flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-colors ${
														selected
															? 'border-primary ring-2 ring-primary'
															: 'border-border bg-muted/30 hover:bg-accent/60'
													}`}
												>
													<img
														src={`data:image/png;base64,${c.southB64}`}
														alt={rotuloCandidato(c.index, c.seed)}
														className="max-h-40 max-w-full object-contain [image-rendering:pixelated]"
													/>
													<span className="flex items-center gap-2 text-xs text-muted-foreground">
														{rotuloCandidato(c.index, c.seed)}
														{selected && (
															<Badge variant="secondary">
																{SL.studio.resultado.selecionado}
															</Badge>
														)}
													</span>
												</button>
											);
										})}
									</div>
									{semGasto ? (
										<Badge variant="outline">{SL.studio.resultado.doCache}</Badge>
									) : selectedUsage !== undefined ? (
										<div className="flex flex-wrap items-center gap-2 text-sm">
											{typeof selectedUsage.usd === 'number' && (
												<Badge variant="secondary">
													{usoUsd(selectedUsage.usd)}
												</Badge>
											)}
											{typeof selectedUsage.generations === 'number' && (
												<Badge variant="secondary">
													{usoGeracoes(selectedUsage.generations)}
												</Badge>
											)}
										</div>
									) : null}
									<div className="flex flex-col items-start gap-2">
										<Button
											variant="secondary"
											onClick={handleDownload}
											disabled={selectedIndex === null}
										>
											<DownloadIcon className="size-4" />
											{SL.studio.resultado.baixarJson}
										</Button>
										<p className="text-xs text-muted-foreground">
											{SL.studio.resultado.notaWizard}
										</p>
									</div>
								</>
							)}
						</CardContent>
					</Card>
					<HistoryPanel entries={history} />
				</div>
			</div>
		</div>
	);
}
