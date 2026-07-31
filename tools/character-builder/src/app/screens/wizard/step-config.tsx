/**
 * Passo 1 — configuração da base (frameCount/fps/size/silhueta).
 *
 * Editável enquanto studio.lock não existe; depois vira o badge travado.
 * O lock é global: vale para o manequim e para todo personagem derivado.
 * O pai monta este componente com key={character.id} para o formulário
 * reiniciar na troca de personagem.
 */
import { Lock } from 'lucide-react';
import { useState } from 'react';
import {
	SegmentedToggle,
	SegmentedToggleOption,
} from '@/components/motion-ui/segmented-toggle';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import type { MannequinLock, Silhouette } from '../../../../server/model.ts';
import { configTravada, wizard } from '../../../strings/wizard.ts';
import { api } from '../../studio-store.tsx';
import { ActionButton } from './action-button.tsx';
import { useAction } from './use-action.ts';
import type { WizardProgress } from './wizard-progress.ts';

const FRAME_COUNTS = ['4', '8', '16'] as const;
type FrameCountKey = (typeof FRAME_COUNTS)[number];

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
				{configTravada(lock.frameCount, lock.fps, lock.size)}
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
	const [size, setSize] = useState(String(progress.character.size));
	const [silhouette, setSilhouette] = useState<Silhouette>(
		progress.character.silhouette,
	);
	const action = useAction(refresh);

	const fpsNum = Number(fps);
	const sizeNum = Number(size);
	const canSubmit =
		Number.isFinite(fpsNum) &&
		fpsNum > 0 &&
		Number.isInteger(sizeNum) &&
		sizeNum >= 16 &&
		sizeNum <= 128;

	return (
		<>
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
			<div className="flex flex-wrap gap-4">
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
					<Label htmlFor="wizard-config-size">{wizard.config.tamanho}</Label>
					<Input
						id="wizard-config-size"
						type="number"
						min={16}
						max={128}
						value={size}
						onChange={(e) => setSize(e.target.value)}
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
			</div>
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
								size: sizeNum,
								silhouette,
							}),
						}),
					)
				}
			/>
		</>
	);
}
