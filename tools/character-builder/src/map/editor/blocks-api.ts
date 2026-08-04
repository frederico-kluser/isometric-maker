/**
 * Paleta de peças do editor.
 *
 * Os blocos gerados moram no mesmo aplicativo (é lá que a geração acontece e
 * onde o PNG pago é gravado). Desde a unificação das duas telas num Vite só,
 * `/api` e `/world-blocks` são mesma origem — não há mais proxy. O asset pago
 * continua tendo UMA cópia, e ela fica onde nasceu.
 *
 * Quando o servidor não responde, ou quando ainda não se gerou
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
} from '../../../../../packages/iso-core/src/block-catalog.ts';
import type { BlockDef, Facing } from '../3d/block-def.ts';

interface WorldBlockSummary {
  readonly hash: string;
  readonly description: string;
  readonly shape: string;
  /** 'chained' | 'rotated' | 'texture' | 'views'. 'views' = vistas numeradas em disco. */
  readonly technique: string;
  /** v2: 4 faces. Ausente em v3 (texture). */
  readonly faceUrls?: Record<Facing, string>;
  /** Vistas candidatas quando nenhuma é declarada canônica ('views'). */
  readonly spriteUrls?: string[];
  /** v3 (texture): spritesheet da animação. */
  readonly spritesheetUrl?: string;
  /** v3 (texture): sidecar com fps e frameCount. */
  readonly animationUrl?: string;
  /** v3 (texture): número de frames. 0 = estático. */
  readonly frameCount?: number;
  /** v3 (texture): FPS da animação. */
  readonly fps?: number;
  /** v3 (texture): ping-pong (vai-e-volta). */
  readonly pingPong?: boolean;
  /** v3 (texture): false = estático, sem animação. */
  readonly animated?: boolean;
  /** v3 (texture): URL da imagem base quando estático. */
  readonly baseUrl?: string;
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
      hash: b.hash,
      faceUrls: b.faceUrls as Record<Facing, string> | undefined,
      spriteUrls: b.spriteUrls,
      spritesheetUrl: b.spritesheetUrl,
      animationUrl: b.animationUrl,
      frameCount: b.frameCount,
      fps: b.fps,
      pingPong: b.pingPong,
      animated: b.animated,
      baseUrl: b.baseUrl,
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
        'As peças procedurais continuam disponíveis.',
    };
  }
}
