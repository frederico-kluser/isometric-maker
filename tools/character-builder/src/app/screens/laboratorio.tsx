/**
 * Aba Laboratório — Sprite Studio.
 *
 * Container de duas seções, escolhidas no toggle do topo:
 *   - "Sprite sul (v3)" (default): bancada do create-character-v3, gera N
 *     candidatos da pose sul em paralelo e exporta o bundle JSON que o
 *     Wizard importa (laboratorio/studio-panel.tsx);
 *   - "Blocos do mundo": criação de cubos pixel art — textura animada única
 *     (pixflux + animate-with-text-v3, ADR 0032) para o editor de mapa
 *     (laboratorio/blocks-panel.tsx).
 *
 * Os dois painéis ficam MONTADOS (o inativo recebe `hidden`): o painel v3 não
 * perde o hash do job em andamento — é ele que destrava o resultado em
 * GET /api/sprite-lab/{hash}.
 */
import { useState } from 'react';
import { laboratorio as SL } from '../../strings/laboratorio.ts';
import { blocos as SB } from '../../strings/blocos.ts';
import {
	SegmentedToggle,
	SegmentedToggleOption,
} from '@/components/motion-ui/segmented-toggle';
import { StudioPanel } from './laboratorio/studio-panel.tsx';
import { BlocksPanel } from './laboratorio/blocks-panel.tsx';

type LabSection = 'studio' | 'blocos';

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
					<SegmentedToggleOption value="blocos">
						{SB.titulo}
					</SegmentedToggleOption>
				</SegmentedToggle>
			</div>
			<div className={section === 'studio' ? undefined : 'hidden'}>
				<StudioPanel />
			</div>
			<div className={section === 'blocos' ? undefined : 'hidden'}>
				<BlocksPanel />
			</div>
		</div>
	);
}
