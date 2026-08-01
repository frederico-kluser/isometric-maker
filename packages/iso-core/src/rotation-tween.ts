/**
 * Rotação CONTÍNUA da câmera — o giro suave entre duas das quatro vistas.
 *
 * ## O problema, dito com precisão
 *
 * `rotation.ts` resolve a rotação discreta: quatro vistas, `(rot + d) & 3`,
 * sem trigonometria. É o modelo certo para o documento — o mapa não sabe de que
 * ângulo está sendo olhado. Mas trocar `rotation` de 0 para 1 num quadro faz o
 * mapa inteiro saltar, e salto de 90° não se lê como giro: se lê como um corte
 * de câmera, e o usuário perde de vista onde estava.
 *
 * ## O que gira, e o que NÃO gira
 *
 * Só a **posição** é interpolada. O sprite não gira: rotacionar pixel art por um
 * ângulo que não seja múltiplo de 90° reamostra a imagem e destrói a grade de
 * pixels — a arte pela qual se pagou vira borrão durante a transição inteira.
 *
 * Então: as coordenadas de grid são rotacionadas por um ângulo contínuo e
 * projetadas pela fórmula de sempre, e a face desenhada é trocada por
 * cross-fade entre a vista de origem e a de destino. O mapa balança; cada peça
 * continua nítida.
 *
 * **Isto é decisão deste projeto, não convenção verificada.** A pesquisa feita
 * para esta tarefa não encontrou nenhuma fonte externa que sobrevivesse à
 * verificação sobre como jogos isométricos comerciais fazem esse giro — nem
 * sobre duração, nem sobre curva de suavização, nem sobre cross-fade. O que
 * está aqui é derivado da geometria e da restrição de não reamostrar pixel art.
 *
 * ## A ordem de desenho durante o giro
 *
 * A chave de profundidade é recalculada a cada quadro a partir das coordenadas
 * CONTÍNUAS. É a resposta honesta: durante um giro de 90° dois blocos realmente
 * trocam de profundidade, e a troca acontece no instante geometricamente certo.
 * Congelar a ordem na vista de origem ou na de destino faria a troca acontecer
 * toda de uma vez, no começo ou no fim.
 */
import { normalizeRotation, type Rotation } from './rotation.ts';

// ---------------------------------------------------------------- suavização

/**
 * Suavização cúbica simétrica: começa devagar, acelera, termina devagar.
 *
 * Linear seria mecânico — o giro pareceria uma peça de máquina. Curva só na
 * saída faria a câmera arrancar. A simétrica é a que se lê como "a câmera
 * girou", e é a mesma forma que `ease-in-out` descreve em CSS.
 *
 * Aceita `t` fora de 0–1 e devolve nos limites: um quadro atrasado não pode
 * fazer a câmera passar do destino.
 */
export function easeInOutCubic(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Duração do giro, em milissegundos.
 *
 * **Escolha deste projeto, sem respaldo externo verificado.** 280 ms é rápido o
 * bastante para não atrapalhar quem está editando e lento o bastante para o
 * olho acompanhar de onde para onde o mapa foi.
 */
export const ROTATION_DURATION_MS = 280;

// ---------------------------------------------------------------- caminho

/**
 * Quantos quartos de volta de `from` até `to`, pelo caminho CURTO.
 *
 * De 3 para 0 são `+1`, não `−3`: girar três quartos para chegar onde meio
 * quarto resolveria é o tipo de detalhe que ninguém nota no código e todo mundo
 * nota na tela.
 *
 * Meia-volta (dois quartos) é ambígua por construção — os dois sentidos custam
 * o mesmo. O desempate é o horário, declarado aqui para ser determinístico em
 * vez de depender do sinal de uma subtração.
 */
export function shortestTurn(from: Rotation, to: Rotation): number {
  const delta = (normalizeRotation(to) - normalizeRotation(from) + 4) % 4;
  return delta === 3 ? -1 : delta;
}

// ---------------------------------------------------------------- estado

export interface RotationTween {
  readonly from: Rotation;
  readonly to: Rotation;
  /** Quartos de volta a percorrer, com sinal. `0` quando não há giro. */
  readonly turns: number;
  readonly durationMs: number;
  /** Instante de início, no mesmo relógio que `sampleTween` vai receber. */
  readonly startedAt: number;
}

export interface TweenSample {
  /**
   * Rotação contínua, em quartos de volta. Vale `from` no início e
   * `from + turns` no fim — que pode ser negativo ou passar de 3, e não deve
   * ser normalizado antes de projetar: normalizar aqui daria um pulo.
   */
  readonly turn: number;
  /** Progresso já suavizado, 0–1. É o alfa do cross-fade. */
  readonly t: number;
  readonly done: boolean;
}

export function startTween(
  from: Rotation,
  to: Rotation,
  now: number,
  durationMs: number = ROTATION_DURATION_MS,
): RotationTween {
  return { from, to, turns: shortestTurn(from, to), durationMs, startedAt: now };
}

/**
 * Onde a câmera está agora.
 *
 * `durationMs <= 0` termina no primeiro quadro — é como se desliga a animação
 * sem ramificar o código de desenho.
 */
export function sampleTween(tween: RotationTween, now: number): TweenSample {
  if (tween.turns === 0 || tween.durationMs <= 0) {
    return { turn: normalizeRotation(tween.to), t: 1, done: true };
  }
  const raw = (now - tween.startedAt) / tween.durationMs;
  const t = easeInOutCubic(raw);
  return {
    turn: tween.from + tween.turns * t,
    t,
    done: raw >= 1,
  };
}

// ---------------------------------------------------------------- geometria

/**
 * Rotaciona `(x, y)` por um número CONTÍNUO de quartos de volta.
 *
 * Concorda exatamente com `rotatePoint` de `rotation.ts` nos inteiros — é o
 * mesmo giro, só que amostrado no meio do caminho. A conferência é um teste, não
 * uma promessa de comentário.
 *
 * O sinal segue a convenção discreta: um quarto de volta leva `(x, y)` a
 * `(y, −x)`, que é uma rotação de −90° na orientação matemática usual.
 */
export function rotatePointContinuous(
  x: number,
  y: number,
  turn: number,
): { x: number; y: number } {
  const phi = -turn * (Math.PI / 2);
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return { x: x * c - y * s + 0, y: x * s + y * c + 0 };
}

/**
 * Chave de profundidade na rotação contínua.
 *
 * Mesma soma de sempre — `x + y + z` — sobre a coordenada já rotacionada. Um
 * caminho de código nas quatro vistas e em tudo que há entre elas.
 */
export function continuousDepthKey(
  cell: { readonly x: number; readonly y: number; readonly z: number },
  turn: number,
): number {
  const r = rotatePointContinuous(cell.x, cell.y, turn);
  return r.x + r.y + cell.z;
}

/**
 * Qual das quatro vistas o sprite deve mostrar, dado um giro em andamento.
 *
 * Durante a transição existem DUAS respostas certas ao mesmo tempo: a face de
 * origem e a de destino. Devolver as duas com um alfa é o que permite o
 * cross-fade — e o alfa é o progresso suavizado, não o cru, para que a troca de
 * imagem acompanhe o movimento em vez de correr na frente dele.
 */
export interface FacingBlend {
  readonly fromRotation: Rotation;
  readonly toRotation: Rotation;
  /** Opacidade da vista de destino, 0–1. A de origem vai por baixo, opaca. */
  readonly alpha: number;
}

export function facingBlend(tween: RotationTween, sample: TweenSample): FacingBlend {
  return {
    fromRotation: normalizeRotation(tween.from),
    toRotation: normalizeRotation(tween.to),
    alpha: sample.t,
  };
}
