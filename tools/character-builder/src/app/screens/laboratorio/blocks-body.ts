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
 *
 * O laboratório só gera cubos por textura animada (ADR 0032): a técnica é
 * FIXA em `texture` e os campos de tile (shape, outline, shading, detail,
 * guidance, seed) não se aplicam — o servidor os ignora nessa técnica.
 */

/** Erros que a tela detecta sozinha. O resto vem em pt-BR do servidor. */
export type BlockErrorCode = 'description-missing';

export interface WorldBlockBody {
  readonly description: string;
  /** Técnica fixa: única forma de gerar bloco no laboratório hoje (ADR 0032). */
  readonly technique: 'texture';
  /** Número de frames da animação. 4, 8 ou 16 (padrão do servidor: 8). */
  readonly frameCount?: number;
  /** FPS da animação (1–60; padrão do servidor: 8). */
  readonly fps?: number;
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
  /** Número de frames da animação (técnica 'texture'). */
  readonly frameCount?: 4 | 8 | 16;
  /** FPS da animação (técnica 'texture'). */
  readonly fps?: number;
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

  return {
    ok: true,
    body: {
      description,
      technique: 'texture',
      ...(input.frameCount !== undefined ? { frameCount: input.frameCount } : {}),
      ...(input.fps !== undefined ? { fps: input.fps } : {}),
    },
  };
}
