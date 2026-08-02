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
  /**
   * Número de frames da animação. 0 (Estático), 4, 8 ou 16
   * (padrão do servidor: 8).
   */
  readonly frameCount?: number;
  /** FPS da animação (1–60; padrão do servidor: 8). */
  readonly fps?: number;
  /**
   * Ação da animação (técnica 'texture'). O texto que vai no `action` do
   * /animate-with-text-v3. Ausente: o servidor gera via LLM a partir da
   * descrição.
   */
  readonly action?: string;
  /**
   * Otimizar o action via `enhance_prompt` do /animate-with-text-v3. O painel
   * envia SEMPRE — o default do endpoint é false, e omitir mentiria o toggle.
   */
  readonly enhancePrompt: boolean;
  /**
   * Loop vai-e-volta no playback. Só pós-processamento: não gera nada e não
   * entra no hash do servidor.
   */
  readonly pingPong: boolean;
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
  /** Número de frames da animação (técnica 'texture'). 0 = Estático. */
  readonly frameCount?: 0 | 4 | 8 | 16;
  /** FPS da animação (técnica 'texture'). */
  readonly fps?: number;
  /** Ação da animação — texto livre do movimento. Em branco: servidor gera via IA. */
  readonly action?: string;
  /** Otimizar o action via enhance_prompt (default do painel: ligado). */
  readonly enhancePrompt: boolean;
  /** Loop vai-e-volta no playback (default do painel: ligado). */
  readonly pingPong: boolean;
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
 *
 * Os toggles booleanos (enhancePrompt, pingPong) são exceção: o painel é dono
 * deles e envia SEMPRE — o default do endpoint (enhance_prompt=false) não é o
 * default do painel (ligado), e omitir faria a geração divergir do toggle.
 */
export function buildWorldBlockBody(input: BlockFormInput): BuildResult {
  const description = input.description.trim();
  if (description === '') return { ok: false, code: 'description-missing' };

  const action = input.action?.trim() ?? '';

  return {
    ok: true,
    body: {
      description,
      technique: 'texture',
      ...(input.frameCount !== undefined ? { frameCount: input.frameCount } : {}),
      ...(input.fps !== undefined ? { fps: input.fps } : {}),
      ...(action !== '' ? { action } : {}),
      enhancePrompt: input.enhancePrompt,
      pingPong: input.pingPong,
    },
  };
}
