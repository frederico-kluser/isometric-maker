/**
 * Montagem e validação local do body de POST /api/world-block.
 *
 * Módulo PURO — sem React, sem DOM — para que a validação seja testável com
 * `node --test`. Espelha o contrato de `server/world-block.ts` sem importá-lo
 * em runtime: o painel roda no navegador, e o módulo do servidor arrasta
 * `node:fs`.
 *
 * A validação aqui NÃO substitui a do servidor. Ela existe para não gastar uma
 * ida ao servidor com um formulário obviamente inválido; quem recusa de
 * verdade, antes de gastar dinheiro, é `validateWorldBlockConfig`.
 */

/** Erros que a tela detecta sozinha. O resto vem em pt-BR do servidor. */
export type BlockErrorCode =
  | 'description-missing'
  | 'seed-invalid'
  | 'guidance-invalid';

export interface WorldBlockBody {
  readonly description: string;
  readonly shape?: string;
  readonly tileUnitSize?: number;
  readonly outline?: string;
  readonly shading?: string;
  readonly detail?: string;
  readonly textGuidanceScale?: number;
  readonly seed?: number;
  /** 'chained' (molde encadeado) ou 'rotated' (rotate via v3). */
  readonly technique?: string;
}

export interface WorldBlockAccepted {
  readonly key: string;
  readonly hash: string;
}

export type WorldBlockStatus = 'gerando' | 'pronto' | 'falhou' | 'desconhecido';

export interface WorldBlockFace {
  readonly facing: 'north' | 'east' | 'south' | 'west';
  readonly seed: number;
  readonly pngB64: string;
  readonly tileId?: string;
}

export interface WorldBlockResult {
  readonly hash: string;
  readonly technique: string;
  readonly faces: readonly WorldBlockFace[];
  readonly fromCache: boolean;
  readonly generated: number;
}

export interface BlockFormInput {
  readonly description: string;
  /** '' = não enviar (usa o default do endpoint). */
  readonly shape: string;
  readonly tileUnitSize: string;
  readonly outline: string;
  readonly shading: string;
  readonly detail: string;
  readonly guidanceText: string;
  readonly seedText: string;
  readonly technique: string;
}

export type BuildResult =
  | { readonly ok: true; readonly body: WorldBlockBody }
  | { readonly ok: false; readonly code: BlockErrorCode };

/**
 * Monta o body a partir do formulário.
 *
 * Campo em branco é OMITIDO do body, nunca enviado como `null` ou `''`: o
 * endpoint tem defaults próprios, e mandar vazio troca o default do fornecedor
 * por um palpite nosso.
 */
export function buildWorldBlockBody(input: BlockFormInput): BuildResult {
  const description = input.description.trim();
  if (description === '') return { ok: false, code: 'description-missing' };

  let seed: number | undefined;
  const seedText = input.seedText.trim();
  if (seedText !== '') {
    const parsed = Number(seedText);
    if (!Number.isInteger(parsed) || parsed < 0) return { ok: false, code: 'seed-invalid' };
    seed = parsed;
  }

  let guidance: number | undefined;
  const guidanceText = input.guidanceText.trim();
  if (guidanceText !== '') {
    const parsed = Number(guidanceText);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 20) {
      return { ok: false, code: 'guidance-invalid' };
    }
    guidance = parsed;
  }

  let tileUnitSize: number | undefined;
  if (input.tileUnitSize !== '') {
    const parsed = Number(input.tileUnitSize);
    if (parsed === 16 || parsed === 32) tileUnitSize = parsed;
  }

  return {
    ok: true,
    body: {
      description,
      ...(input.shape !== '' ? { shape: input.shape } : {}),
      ...(tileUnitSize !== undefined ? { tileUnitSize } : {}),
      ...(input.outline !== '' ? { outline: input.outline } : {}),
      ...(input.shading !== '' ? { shading: input.shading } : {}),
      ...(input.detail !== '' ? { detail: input.detail } : {}),
      ...(guidance !== undefined ? { textGuidanceScale: guidance } : {}),
      ...(seed !== undefined ? { seed } : {}),
      // A técnica entra sempre que informada — ela faz parte do hash: o mesmo
      // prompt nas duas técnicas são dois artefatos, comparáveis lado a lado.
      ...(input.technique !== '' ? { technique: input.technique } : {}),
    },
  };
}
