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
 *
 * ## Duas coisas diferentes com o mesmo nome
 *
 * `BlockDef` é o que a CENA precisa: rótulo, URLs das faces, matiz. É
 * aparência. `BlockDefinition` (do iso-core) é o que a FÍSICA precisa: tipo e
 * material. Este módulo produz os dois a partir da mesma lista, e mantê-los
 * separados é o que impede "a Água ficou roxa" de virar "a Água ficou sólida".
 */
import {
  DEFAULT_BLOCKS,
  makeCatalog,
  type BlockCatalog,
  type BlockDefinition,
  type BlockKind,
  type MaterialId,
} from '@isometric-maker/iso-core/block-catalog';
import type { BlockDef, Facing } from '../scene.ts';

interface WorldBlockSummary {
  readonly hash: string;
  readonly description: string;
  readonly shape: string;
  /** 'chained' | 'rotated' | 'texture'. 'texture' = textura animada (ADR 0032). */
  readonly technique: string;
  /** v2: 4 faces. Ausente em v3 (texture). */
  readonly faceUrls?: Record<Facing, string>;
  /** v3 (texture): spritesheet da animação. */
  readonly spritesheetUrl?: string;
  /** v3 (texture): sidecar com fps e frameCount. */
  readonly animationUrl?: string;
  /** v3 (texture): número de frames. */
  readonly frameCount?: number;
  /** v3 (texture): FPS da animação. */
  readonly fps?: number;
  readonly geometry?: {
    readonly tileWidth: number;
    readonly tileHeight: number;
    readonly cubeHeight: number;
  };
}

/**
 * Peças de reserva, desenhadas por código.
 *
 * O matiz é DECLARADO por peça, não derivado do id. Derivar do texto dá uma cor
 * estável, o que já foi bom o bastante — até "Grama" sair vermelha e "Água",
 * roxa. Cor que contradiz o nome é pior do que cor aleatória, porque o usuário
 * confia nela e erra. Os valores abaixo são graus na roda HSL.
 */
const HUES: Readonly<Record<string, number>> = {
  grama: 105,
  terra: 28,
  pedra: 215,
  areia: 48,
  agua: 195,
  madeira: 18,
};

export const FALLBACK_BLOCKS: readonly BlockDef[] = DEFAULT_BLOCKS.map((d) => ({
  id: d.id,
  label: d.label,
  hue: HUES[d.id] ?? 0,
}));

/**
 * Palavras que denunciam o material na descrição do bloco gerado.
 *
 * É heurística, e é assumida como tal: o prompt é texto livre em inglês e nada
 * garante que "mossy cobblestone path block" contenha a palavra certa. Quando
 * nenhuma casa, o material vira `pedra` — sólido e neutro, que é o palpite que
 * menos surpreende. O usuário corrige na paleta.
 */
const PISTAS: ReadonlyArray<[RegExp, MaterialId, BlockKind]> = [
  [/\b(grass|turf|lawn|meadow)\b/i, 'grama', 'solid'],
  [/\b(dirt|soil|mud|earth)\b/i, 'terra', 'solid'],
  [/\b(sand|desert|dune)\b/i, 'areia', 'solid'],
  [/\b(wood|plank|timber|log|crate)\b/i, 'madeira', 'solid'],
  [/\b(metal|iron|steel|copper)\b/i, 'metal', 'solid'],
  [/\b(ice|frost|frozen)\b/i, 'gelo', 'solid'],
  [/\b(water|sea|ocean|river|lake)\b/i, 'agua', 'liquid'],
  [/\b(lava|magma)\b/i, 'lava', 'liquid'],
  [/\b(glass|crystal)\b/i, 'vidro', 'solid'],
  [/\b(leaf|leaves|foliage|bush|hedge)\b/i, 'folhagem', 'decoration'],
  [/\b(stone|rock|cobble|granite|brick)\b/i, 'pedra', 'solid'],
];

export function guessMaterial(description: string): { material: MaterialId; kind: BlockKind } {
  for (const [re, material, kind] of PISTAS) {
    if (re.test(description)) return { material, kind };
  }
  return { material: 'pedra', kind: 'solid' };
}

export interface PaletteLoad {
  readonly blocks: readonly BlockDef[];
  /** O que a física consome: id → tipo e material. */
  readonly catalog: BlockCatalog;
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

const FALLBACK_CATALOG: BlockCatalog = makeCatalog(DEFAULT_BLOCKS);

export async function loadPalette(): Promise<PaletteLoad> {
  try {
    const res = await fetch('/api/world-blocks');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { blocks?: WorldBlockSummary[] };
    const summaries = body.blocks ?? [];

    const generated = summaries.map<BlockDef>((b) => ({
      id: `wb:${b.hash}`,
      label: shortLabel(b.description),
      faceUrls: b.faceUrls as Record<Facing, string> | undefined,
      spritesheetUrl: b.spritesheetUrl,
      animationUrl: b.animationUrl,
      frameCount: b.frameCount,
      fps: b.fps,
    }));

    const definitions: BlockDefinition[] = [
      ...summaries.map<BlockDefinition>((b) => {
        const { material, kind } = guessMaterial(b.description);
        return {
          id: `wb:${b.hash}`,
          label: shortLabel(b.description),
          kind,
          material,
          sourceHash: b.hash,
        };
      }),
      ...DEFAULT_BLOCKS,
    ];

    return {
      blocks: [...generated, ...FALLBACK_BLOCKS],
      catalog: makeCatalog(definitions),
      generatedCount: generated.length,
    };
  } catch (err) {
    return {
      blocks: FALLBACK_BLOCKS,
      catalog: FALLBACK_CATALOG,
      generatedCount: 0,
      warning:
        'Não deu para ler o catálogo de blocos gerados ' +
        `(${err instanceof Error ? err.message : String(err)}). ` +
        'O Sprite Studio precisa estar no ar em http://localhost:5174. ' +
        'As peças procedurais continuam disponíveis.',
    };
  }
}
