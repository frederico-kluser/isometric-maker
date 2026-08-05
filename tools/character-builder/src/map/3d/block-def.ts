/**
 * Tipos de dados do editor 3D — a peça colocável e a célula.
 *
 * Moravam em `map/scene.ts` (BlockDef/Facing, com a cena PixiJS) e em
 * `map/editor/map-state.ts` (Cell3D). Com o fim do editor 2D (onda 2),
 * esses três tipos são os únicos dados compartilhados pelo editor 3D e
 * ficam num módulo próprio, sem renderizador.
 */

/** As quatro faces de um bloco, na mesma ordem de rotação das vistas. */
export const FACINGS = ['north', 'east', 'south', 'west'] as const;
export type Facing = (typeof FACINGS)[number];

/** Uma peça colocável: arte gerada (4 faces ou textura animada) ou cubo procedural. */
export interface BlockDef {
  readonly id: string;
  readonly label: string;
  /** Hash do asset no catálogo — monta a miniatura da paleta (v3: texture). */
  readonly hash?: string | undefined;
  /** URLs das quatro faces (v2: chained/rotated). Ausente = cubo procedural ou textura. */
  readonly faceUrls?: Readonly<Record<Facing, string>> | undefined;
  /**
   * Candidatas a sprite do bloco, quando há mais de uma vista gravada (v3
   * `rotate8`: oito vistas, e o manifesto declara que a ordem é ASSUMIDA).
   *
   * Quem escolhe é `cube3d.ts`, por casamento de silhueta contra a forma
   * canônica — não por índice. Uma lista, e não uma URL, existe justamente
   * porque o índice certo não é conhecido de antemão.
   */
  readonly spriteUrls?: readonly string[] | undefined;
  /**
   * Matiz HSL do cubo procedural. Ausente, um cinza neutro — derivar do id dá
   * cor estável, mas sem relação com o material (foi como "Grama" saiu
   * vermelha).
   */
  readonly hue?: number | undefined;
  /**
   * URL da spritesheet da animação (v3: texture, ADR 0032) — uma tira
   * horizontal com todos os quadros, sem calha.
   *
   * **Quem lê é `cube3d.ts`**, que a transforma numa textura com
   * `repeat.x = 1/frameCount`; trocar de quadro é mexer no `offset.x`. Até
   * 2026-08-04 este campo (e os quatro abaixo) atravessava o catálogo inteiro
   * sem ninguém ler: o mapa desenhava o `base.png`, um quadro parado de uma
   * animação que o usuário pagou.
   */
  readonly spritesheetUrl?: string | undefined;
  /**
   * URL do sidecar de animação com fps e frameCount.
   *
   * Quem consome é a prévia do laboratório, que busca o JSON para saber quantos
   * quadros a API de fato devolveu. O editor 3D não busca: `frameCount`, `fps`
   * e `pingPong` já vêm resolvidos abaixo, na mesma resposta do catálogo.
   */
  readonly animationUrl?: string | undefined;
  /** Número de frames da animação (v3: texture). 0 ou 1 = estático. */
  readonly frameCount?: number | undefined;
  /** FPS da animação (v3: texture). Ausente = 8, o default do servidor. */
  readonly fps?: number | undefined;
  /** Ping-pong: vai-e-volta em vez de loop com reset. Default true. */
  readonly pingPong?: boolean | undefined;
  /** false = bloco estático, sem animação. Default true. */
  readonly animated?: boolean | undefined;
  /**
   * URL da imagem base (estática).
   *
   * Existe mesmo no bloco animado, e não é sobra: é a miniatura da paleta, é a
   * régua que confere a folha (o quadro dela tem de ter este tamanho) e é o que
   * o mapa desenha quando a folha não serve.
   */
  readonly baseUrl?: string | undefined;
}

/** Célula do mapa no editor 3D. */
export interface Cell3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
