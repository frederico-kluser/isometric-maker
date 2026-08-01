/**
 * Paleta de peças do editor.
 *
 * Os blocos gerados moram no character-builder (é lá que a geração acontece e
 * onde o PNG pago é gravado). O Vite do map-builder faz proxy de `/api` e
 * `/world-blocks` para lá — asset pago tem UMA cópia, e ela fica onde nasceu.
 *
 * Quando o character-builder não está no ar, ou quando ainda não se gerou
 * nada, o editor cai nas peças procedurais. Isso é decisão, não degradação:
 * um editor que só abre depois de gastar dinheiro na API não pode ser testado
 * sem gastar dinheiro na API.
 */
import type { BlockDef, Facing } from '../scene.ts';

interface WorldBlockSummary {
  readonly hash: string;
  readonly description: string;
  readonly size: number;
  readonly shape: string;
  readonly facingMode: string;
  readonly faceUrls: Record<Facing, string>;
}

/**
 * Peças de reserva, desenhadas por código.
 *
 * O matiz é DECLARADO por peça, não derivado do id. Derivar do texto dá uma cor
 * estável, o que já foi bom o bastante — até "Grama" sair vermelha e "Água",
 * roxa. Cor que contradiz o nome é pior do que cor aleatória, porque o usuário
 * confia nela e erra. Os valores abaixo são graus na roda HSL.
 */
export const FALLBACK_BLOCKS: readonly BlockDef[] = [
  { id: 'grama', label: 'Grama', hue: 105 },
  { id: 'terra', label: 'Terra', hue: 28 },
  { id: 'pedra', label: 'Pedra', hue: 215 },
  { id: 'areia', label: 'Areia', hue: 48 },
  { id: 'agua', label: 'Água', hue: 195 },
  { id: 'madeira', label: 'Madeira', hue: 18 },
];

export interface PaletteLoad {
  readonly blocks: readonly BlockDef[];
  /** Quantas peças vieram de arte gerada (o resto é procedural). */
  readonly generatedCount: number;
  /** Preenchido quando o catálogo não pôde ser lido — a UI mostra verbatim. */
  readonly warning?: string;
}

/** Rótulo curto a partir da descrição — prompt inteiro não cabe numa paleta. */
function shortLabel(description: string): string {
  const clean = description.trim().replace(/\s+/g, ' ');
  return clean.length <= 28 ? clean : `${clean.slice(0, 27)}…`;
}

export async function loadPalette(): Promise<PaletteLoad> {
  try {
    const res = await fetch('/api/world-blocks');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { blocks?: WorldBlockSummary[] };
    const generated = (body.blocks ?? []).map<BlockDef>((b) => ({
      id: `wb:${b.hash}`,
      label: shortLabel(b.description),
      faceUrls: b.faceUrls,
    }));
    return {
      blocks: [...generated, ...FALLBACK_BLOCKS],
      generatedCount: generated.length,
    };
  } catch (err) {
    return {
      blocks: FALLBACK_BLOCKS,
      generatedCount: 0,
      warning:
        'Não deu para ler o catálogo de blocos gerados ' +
        `(${err instanceof Error ? err.message : String(err)}). ` +
        'O Sprite Studio precisa estar no ar em http://localhost:5174. ' +
        'As peças procedurais continuam disponíveis.',
    };
  }
}
