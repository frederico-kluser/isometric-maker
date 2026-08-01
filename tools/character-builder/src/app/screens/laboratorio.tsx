/**
 * Aba Laboratório — Sprite Studio.
 *
 * Container de duas seções, escolhidas no toggle do topo:
 *   - "Sprite sul (v3)" (default): bancada do create-character-v3, gera N
 *     candidatos da pose sul em paralelo e exporta o bundle JSON que o
 *     Wizard importa (laboratorio/studio-panel.tsx);
 *   - "Rotação livre (/rotate)": o playground original do /rotate, movido
 *     para cá sem mudança de comportamento (laboratorio/rotate-panel.tsx).
 *
 * Os dois painéis ficam MONTADOS (o inativo recebe `hidden`): o formulário
 * do /rotate não perde as imagens carregadas ao alternar, e o painel v3 não
 * perde o hash do job em andamento — é ele que destrava o resultado em
 * GET /api/sprite-lab/{hash}.
 */
import { useState } from 'react';
import { laboratorio as SL } from '../../strings/laboratorio.ts';
import {
	SegmentedToggle,
	SegmentedToggleOption,
} from '@/components/motion-ui/segmented-toggle';
import { RotatePanel } from './laboratorio/rotate-panel.tsx';
import { StudioPanel } from './laboratorio/studio-panel.tsx';

type LabSection = 'studio' | 'rotate';

export function LaboratorioScreen() {
	const [section, setSection] = useState<LabSection>('studio');

	return (
		<div className="flex flex-col gap-6">
			<div>
				<SegmentedToggle
					value={section}
					onChange={(v) => setSection(v)}
					ariaLabel={SL.studio.secoes.ariaLabel}
				>
					<SegmentedToggleOption value="studio">
						{SL.studio.secoes.spriteSul}
					</SegmentedToggleOption>
					<SegmentedToggleOption value="rotate">
						{SL.studio.secoes.rotacaoLivre}
					</SegmentedToggleOption>
				</SegmentedToggle>
			</div>
			<div className={section === 'studio' ? undefined : 'hidden'}>
				<StudioPanel />
			</div>
			<div className={section === 'rotate' ? undefined : 'hidden'}>
				<RotatePanel />
			</div>
		</div>
	);
}
