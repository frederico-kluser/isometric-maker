/**
 * Passo 1 — configuração da base: preset de qualidade (tamanho + estilo),
 * frames, fps e silhueta. Travam juntos antes da primeira geração; depois
 * vira o badge travado. O lock é global: vale para o manequim e para todo
 * personagem derivado. O pai monta este componente com key={character.id}
 * para o formulário reiniciar na troca de personagem.
 *
 * Os presets são atalhos que preenchem tamanho + detail/shading/outline/
 * guidance de uma vez (valores em quality.ts); mexer no Avançado depois
 * desbanca o preset — o toggle fica sem seleção, porque nenhum preset
 * representa mais os valores. O Avançado mostra o valor EXATO do spec em
 * texto miúdo sob cada select, e a nota repete o aviso do vendor: os
 * controles de estilo são inclinação fraca, não garantia.
 *
 * O POST envia os campos de qualidade junto — o servidor que não os
 * conhece os ignora (readBody tipado), então a tela não quebra enquanto a
 * integração do lock novo não chega.
 */
import { Lock } from 'lucide-react';
import { useState } from 'react';
import {
	Accordion,
	AccordionItem,
	AccordionPanel,
	AccordionTrigger,
} from '@/components/motion-ui/accordion';
import {
	SegmentedToggle,
	SegmentedToggleOption,
} from '@/components/motion-ui/segmented-toggle';
import { Badge } from '@/components/ui/badge';
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
	DETAIL_OPTIONS,
	type DetailOption,
	type MannequinLock,
	OUTLINE_OPTIONS,
	type OutlineOption,
	type Silhouette,
	TEMPLATE_OPTIONS,
	type TemplateOption,
	VIEW_OPTIONS,
	type ViewOption,
} from '../../../../server/model.ts';
import { configTravada, wizard } from '../../../strings/wizard.ts';
import { api } from '../../studio-store.tsx';
import { ActionButton } from './action-button.tsx';
import {
	matchPreset,
	QUALITY_PRESETS,
	QUALITY_PRESET_IDS,
	type QualityPresetId,
	type QualityValues,
} from './quality.ts';
import { useAction } from './use-action.ts';
import type { WizardProgress } from './wizard-progress.ts';

const FRAME_COUNTS = ['4', '8', '16'] as const;
type FrameCountKey = (typeof FRAME_COUNTS)[number];

type PresetValue = QualityPresetId | '';

const SILHOUETTES: readonly Silhouette[] = [
	'humano-medio',
	'humano-corpulento',
	'humano-esguio',
	'quadrupede',
];

export function ConfigStep({
	progress,
	lock,
	refresh,
}: {
	readonly progress: WizardProgress;
	readonly lock: MannequinLock | undefined;
	readonly refresh: () => Promise<void>;
}) {
	if (lock) {
		return (
			<Badge variant="secondary" className="w-fit gap-1.5 px-3 py-1.5 text-sm">
				<Lock aria-hidden className="size-3.5" />
				{configTravada(lock.frameCount, lock.fps, lock.size, lock.detail)}
			</Badge>
		);
	}
	return <ConfigForm progress={progress} refresh={refresh} />;
}

function ConfigForm({
	progress,
	refresh,
}: {
	readonly progress: WizardProgress;
	readonly refresh: () => Promise<void>;
}) {
	const [frameCount, setFrameCount] = useState<FrameCountKey>('8');
	const [fps, setFps] = useState('8');
	// Default Máxima (decisão do usuário, TASK_PLAN): 128px, qualidade máxima.
	const [quality, setQuality] = useState<QualityValues>(QUALITY_PRESETS.maxima);
	const [view, setView] = useState<ViewOption>('low top-down');
	const [templateId, setTemplateId] = useState<TemplateOption>('mannequin');
	// Vazio = campo omitido do request, que é o default da API (F0-09).
	const [cobertura, setCobertura] = useState('');
	const [preencher, setPreencher] = useState(true);
	const [silhouette, setSilhouette] = useState<Silhouette>(
		progress.character.silhouette,
	);
	const action = useAction(refresh);

	const fpsNum = Number(fps);
	const coberturaNum = cobertura.trim() === '' ? undefined : Number(cobertura);
	const coberturaOk =
		coberturaNum === undefined ||
		(Number.isFinite(coberturaNum) && coberturaNum >= 0 && coberturaNum <= 100);
	const canSubmit = Number.isFinite(fpsNum) && fpsNum > 0 && coberturaOk;
	const preset = matchPreset(quality);

	return (
		<>
			<div className="flex flex-col gap-2">
				<span className="text-sm font-medium">{wizard.config.qualidade}</span>
				<SegmentedToggle
					value={preset ?? ''}
					onChange={(v: PresetValue) => {
						if (v !== '') setQuality(QUALITY_PRESETS[v]);
					}}
					ariaLabel={wizard.config.qualidadeAria}
				>
					{QUALITY_PRESET_IDS.map((id) => (
						<SegmentedToggleOption key={id} value={id}>
							{wizard.config.presets[id]}
						</SegmentedToggleOption>
					))}
				</SegmentedToggle>
			</div>
			<div className="flex flex-wrap gap-4">
				<div className="flex flex-col gap-2">
					<span className="text-sm font-medium">{wizard.config.frames}</span>
					<SegmentedToggle
						value={frameCount}
						onChange={(v: FrameCountKey) => setFrameCount(v)}
						ariaLabel={wizard.config.framesAria}
					>
						{FRAME_COUNTS.map((n) => (
							<SegmentedToggleOption key={n} value={n}>
								{n}
							</SegmentedToggleOption>
						))}
					</SegmentedToggle>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor="wizard-config-fps">{wizard.config.fps}</Label>
					<Input
						id="wizard-config-fps"
						type="number"
						min={1}
						max={60}
						value={fps}
						onChange={(e) => setFps(e.target.value)}
						className="w-28"
					/>
				</div>
				<div className="flex flex-col gap-2">
					<span className="text-sm font-medium">{wizard.config.silhueta}</span>
					<Select
						value={silhouette}
						onValueChange={(v) => {
							if (typeof v === 'string') setSilhouette(v as Silhouette);
						}}
					>
						<SelectTrigger className="w-48">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{SILHOUETTES.map((s) => (
								<SelectItem key={s} value={s}>
									{wizard.silhuetas[s]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex flex-col gap-2">
					<span className="text-sm font-medium">{wizard.config.view}</span>
					<Select
						value={view}
						onValueChange={(v) => {
							if (typeof v === 'string') setView(v as ViewOption);
						}}
					>
						<SelectTrigger className="w-44">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{VIEW_OPTIONS.map((v) => (
								<SelectItem key={v} value={v}>
									{wizard.config.viewRotulos[v]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex flex-col gap-2">
					<span className="text-sm font-medium">{wizard.config.template}</span>
					<Select
						value={templateId}
						onValueChange={(v) => {
							if (typeof v === 'string') setTemplateId(v as TemplateOption);
						}}
					>
						<SelectTrigger className="w-44">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{TEMPLATE_OPTIONS.map((t) => (
								<SelectItem key={t} value={t}>
									{wizard.config.templateRotulos[t]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<span className="max-w-xs text-xs text-muted-foreground">
						{wizard.config.templateNota}
					</span>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor="wizard-config-cobertura">
						{wizard.config.cobertura}
					</Label>
					<Input
						id="wizard-config-cobertura"
						type="number"
						min={0}
						max={100}
						value={cobertura}
						onChange={(e) => setCobertura(e.target.value)}
						className="w-28"
					/>
					<span className="max-w-xs text-xs text-muted-foreground">
						{wizard.config.coberturaNota}
					</span>
				</div>
			</div>
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<Checkbox
						id="wizard-config-preencher"
						checked={preencher}
						onCheckedChange={(v: boolean) => setPreencher(v)}
					/>
					<Label htmlFor="wizard-config-preencher">
						{wizard.config.preencher}
					</Label>
				</div>
				<p className="max-w-prose text-xs text-muted-foreground">
					{wizard.config.preencherNota}
				</p>
			</div>
			<Accordion className="rounded-xl border border-border bg-card">
				<AccordionItem value="avancado">
					<AccordionTrigger className="px-4 py-3 text-sm font-medium" inset>
						{wizard.config.avancadoTitulo}
					</AccordionTrigger>
					<AccordionPanel className="flex flex-col gap-4 px-4 pb-4">
						<div className="flex flex-wrap gap-4">
							<StyleSelect
								id="wizard-config-detail"
								label={wizard.config.detail}
								value={quality.detail}
								options={DETAIL_OPTIONS}
								labels={wizard.config.detailRotulos}
								onChange={(detail) => setQuality({ ...quality, detail })}
							/>
							<StyleSelect
								id="wizard-config-outline"
								label={wizard.config.outline}
								value={quality.outline}
								options={OUTLINE_OPTIONS}
								labels={wizard.config.outlineRotulos}
								onChange={(outline) => setQuality({ ...quality, outline })}
							/>
						</div>
						<p className="max-w-prose text-xs text-muted-foreground">
							{wizard.config.estiloNota}
						</p>
					</AccordionPanel>
				</AccordionItem>
			</Accordion>
			<ActionButton
				state={action.state}
				message={action.message}
				label={wizard.config.travar}
				loadingLabel={wizard.acoes.aguarde}
				disabled={!canSubmit}
				onClick={() =>
					void action.run(() =>
						api('wizard/config', {
							method: 'POST',
							body: JSON.stringify({
								characterId: progress.character.id,
								frameCount: Number(frameCount),
								fps: fpsNum,
								size: quality.size,
								silhouette,
								detail: quality.detail,
								outline: quality.outline,
								view,
								templateId,
								...(coberturaNum !== undefined
									? { coverage: coberturaNum }
									: {}),
								fitFrames: preencher,
							}),
						}),
					)
				}
			/>
		</>
	);
}

/** Select de estilo do Avançado: rótulo amigável na opção, valor exato do
 *  spec em texto miúdo sob o campo — é o valor que vai no lock e na API. */
function StyleSelect<T extends string>({
	id,
	label,
	value,
	options,
	labels,
	onChange,
}: {
	readonly id: string;
	readonly label: string;
	readonly value: T;
	readonly options: readonly T[];
	readonly labels: Record<T, string>;
	readonly onChange: (value: T) => void;
}) {
	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor={id}>{label}</Label>
			<Select
				value={value}
				onValueChange={(v) => {
					if (typeof v === 'string') onChange(v as T);
				}}
			>
				<SelectTrigger id={id} className="w-48">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{options.map((o) => (
						<SelectItem key={o} value={o}>
							{labels[o]}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<span className="text-xs text-muted-foreground">{value}</span>
		</div>
	);
}
