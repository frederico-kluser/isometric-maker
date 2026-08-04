/**
 * O personagem no mapa: para onde ele olha, para onde ele anda e qual animação
 * tocar. Módulo puro — nada de PixiJS, nada de DOM, nada de rede.
 *
 * ## As duas conversões que existem aqui, e por que são duas
 *
 * O documento guarda o mundo numa orientação só; a câmera olha de quatro
 * ângulos (ADR 0021). Isso obriga a converter em **duas direções opostas**, e
 * confundi-las é o defeito clássico:
 *
 * - **Entrada**: a tecla é intenção de TELA ("vai para cima"). Vira direção de
 *   MUNDO com `unrotatePoint`. Sem isso, girar a câmera faz o W andar de lado.
 * - **Desenho**: `facing` é ângulo de MUNDO. Vira índice de direção da VISTA
 *   girando o vetor com a mesma `rotatePointContinuous` que `cellToScreen` usa.
 *   Sem isso, o sprite olha para um lado e caminha para outro.
 *
 * A segunda poderia usar `rotateDirectionIndex` do iso-core. Não usa de
 * propósito: girar o próprio vetor é auto-consistente com a projeção por
 * construção, e não depende de acertar o sinal de uma convenção separada.
 *
 * ## Onde o sul fica
 *
 * Na projeção deste editor, `sx = (x−y)·halfW` e `sy = (x+y)·halfH`. Portanto
 * crescer `x+y` desce na tela, e descer na tela é vir na direção do observador:
 * **sul é o vetor (+1, +1)**, ângulo π/4. As oito direções de `DIRECTIONS`
 * (sul, sudoeste, oeste, noroeste, norte, nordeste, leste, sudeste) avançam de
 * π/4 em π/4 a partir daí.
 */
import {
  rotatePointContinuous,
} from '../../../../packages/iso-core/src/rotation-tween.ts';
import {
  unrotatePoint,
  type Rotation,
} from '../../../../packages/iso-core/src/rotation.ts';
import type { MovementState } from '../../../../packages/iso-core/src/movement.ts';

/** Quantas direções o personagem tem. Fixo em 8 pela ADR 0015. */
export const DIRECTION_COUNT = 8;

/**
 * Nomes das direções na ordem canônica do estúdio (`model.ts:DIRECTIONS`).
 * Repetido aqui, e não importado, porque `model.ts` é módulo de servidor e este
 * arquivo roda no navegador.
 */
export const DIRECTION_NAMES = [
  'south',
  'south-west',
  'west',
  'north-west',
  'north',
  'north-east',
  'east',
  'south-east',
] as const;

export type DirectionName = (typeof DIRECTION_NAMES)[number];

/** Ângulo do sul, em radianos. Origem da numeração das direções. */
const SOUTH_ANGLE = Math.PI / 4;
const STEP = (Math.PI * 2) / DIRECTION_COUNT;

/** Normaliza para `[0, 2π)`, inclusive para ângulo negativo. */
function normalizeAngle(a: number): number {
  const t = a % (Math.PI * 2);
  return t < 0 ? t + Math.PI * 2 : t;
}

/**
 * Índice de direção (0..7) a partir de um ângulo **já no espaço da vista**.
 *
 * Use {@link viewDirectionIndex} quando tiver o `facing` de mundo — é ele que
 * aplica a rotação da câmera antes de cair aqui.
 */
export function directionIndexFromAngle(angle: number): number {
  const rel = normalizeAngle(angle - SOUTH_ANGLE + STEP / 2);
  return Math.floor(rel / STEP) % DIRECTION_COUNT;
}

/**
 * Índice de direção que o sprite deve mostrar, dado o ângulo de MUNDO e o giro
 * contínuo da câmera.
 *
 * `turn` é o mesmo campo que a cena usa para desenhar (fracionário durante uma
 * transição), então o sprite troca de direção no mesmo instante em que o mapa
 * troca de vista.
 */
export function viewDirectionIndex(facing: number, turn: number): number {
  const v = rotatePointContinuous(Math.cos(facing), Math.sin(facing), turn);
  return directionIndexFromAngle(Math.atan2(v.y, v.x));
}

export function directionNameFor(index: number): DirectionName {
  const i = ((index % DIRECTION_COUNT) + DIRECTION_COUNT) % DIRECTION_COUNT;
  return DIRECTION_NAMES[i]!;
}

// ------------------------------------------------------------------ visual do ator (sombra + seta)

/** Raio da sombra do personagem em unidades de mundo (~proporcional ao corpo). */
export const SHADOW_RADIUS = 0.3;

/** Dados visuais da sombra e da seta de direção — puros, sem Three.js. */
export interface ActorVisual {
  /** Opacidade da sombra, 0..1 — 1 no chão, 0 no ápice do pulo. */
  readonly shadowOpacity: number;
  /** Raio da sombra em unidades de mundo. */
  readonly shadowRadius: number;
  /** Nível do piso onde a sombra assenta (z do iso-core, sem o pulo). */
  readonly floorY: number;
  /** Ângulo da seta no plano XZ do mundo, em radianos, no sentido da direção de tela. */
  readonly directionAngle: number;
}

/**
 * Dados visuais da sombra e da seta de direção para um estado do personagem.
 *
 * A opacidade acompanha a **altura** da parábola do pulo, não o relógio do
 * pulo: no chão (progresso 0 e 1) a sombra é plena e no ápice (0.5) some.
 * `1 - progress` literal erraria duas vezes — apagaria a sombra do
 * personagem parado (em pé, `NO_JUMP` tem progresso 1.0) e não a devolveria
 * no pouso.
 *
 * O ângulo da seta usa a mesma numeração do sprite exibido: `directionIndex`
 * é direção de TELA (0=sul, 1=sudoeste, ...), e `sul` no plano XZ do mundo é
 * π/4 — mesma origem de `directionIndexFromAngle`.
 *
 * A seta vive no mundo 3D, e `directionIndex` é direção de TELA — os dois só
 * coincidem na vista 0. `cameraTurn` desfaz o giro da câmera: cada giro de
 * 90° (cameraYaw = BASE_YAW + cameraTurn·π/2, controls3d.ts) desloca o
 * "sul" de tela por −cameraTurn·π/2 no plano XZ, e subtrair isso reconverte
 * a direção de tela para o ângulo de mundo correto nas quatro vistas.
 */
export function buildActorVisual(
  directionIndex: number,
  floorY: number,
  jumpProgress: number,
  cameraTurn = 0,
): ActorVisual {
  const idx =
    ((directionIndex % DIRECTION_COUNT) + DIRECTION_COUNT) % DIRECTION_COUNT;
  const height = 4 * jumpProgress * (1 - jumpProgress);
  const opacity = Math.min(1, Math.max(0, 1 - height));
  return {
    shadowOpacity: opacity,
    shadowRadius: SHADOW_RADIUS,
    floorY,
    directionAngle: normalizeAngle(
      SOUTH_ANGLE + idx * STEP - cameraTurn * (Math.PI / 2),
    ),
  };
}

// ------------------------------------------------------------------ entrada

/** Teclas de direção pressionadas agora, em intenção de TELA. */
export interface HeldDirections {
  readonly up: boolean;
  readonly down: boolean;
  readonly left: boolean;
  readonly right: boolean;
}

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const NO_DIRECTION: Vec2 = { x: 0, y: 0 };

/**
 * Converte teclas em direção de MUNDO, já descontando a rotação da câmera.
 *
 * Os quatro vetores de vista são os que apontam para cima, baixo, esquerda e
 * direita **na tela**: subir a tela é `(−1,−1)`, ir para a direita é `(+1,−1)`.
 * Teclas opostas se cancelam.
 */
export function worldDirectionFromKeys(
  held: HeldDirections,
  rotation: Rotation,
): Vec2 {
  let vx = 0;
  let vy = 0;
  if (held.up) {
    vx -= 1;
    vy -= 1;
  }
  if (held.down) {
    vx += 1;
    vy += 1;
  }
  if (held.left) {
    vx -= 1;
    vy += 1;
  }
  if (held.right) {
    vx += 1;
    vy -= 1;
  }
  if (vx === 0 && vy === 0) return NO_DIRECTION;
  const w = unrotatePoint(vx, vy, rotation);
  // O motor normaliza, mas devolver o vetor cru faria a diagonal andar mais
  // rápido em qualquer consumidor que não normalize. Normalizar aqui é barato e
  // fecha a porta.
  const len = Math.hypot(w.x, w.y);
  return { x: w.x / len, y: w.y / len };
}

// ------------------------------------------------------------------ animação

/**
 * Ação a desenhar. São os nomes das poses embutidas do estúdio (`model.ts`),
 * mais `agachado`, que **não tem pose embutida** — a biblioteca de templates da
 * PixelLab não traz agachar e o estúdio nunca gerou uma. Quem consome cai para
 * `parado` quando a pose não existe, e é por isso que a lista inclui uma ação
 * que talvez nunca tenha quadro.
 */
export type ActorAction =
  | 'parado'
  | 'caminhando'
  | 'correndo'
  | 'pulando'
  | 'agachado';

/**
 * Escolhe a ação a partir do estado do motor.
 *
 * Lê `gait`, nunca a velocidade: `config.speed` é configurável, e comparar
 * números para descobrir se o personagem está correndo quebra no primeiro valor
 * novo. Pulo e queda ganham a mesma ação porque só existe uma animação de ar.
 */
export function actionFor(state: MovementState): ActorAction {
  if (state.airborne || state.falling) return 'pulando';
  const parado = state.vel.x === 0 && state.vel.y === 0;
  if (state.gait === 'crouch') return 'agachado';
  if (parado) return 'parado';
  return state.gait === 'walk' ? 'caminhando' : 'correndo';
}

/**
 * Ordem em que procurar quadros quando a ação pedida não foi gerada.
 *
 * Cada degrau é uma degradação honesta, não um palpite: correr cai para andar
 * (mesmo ciclo, ritmo diferente), agachar cai para parado (não há agachar), e
 * tudo cai por último nas 8 direções estáticas, que é o único conjunto que
 * sempre existe depois do wizard.
 */
export const ACTION_FALLBACK: Readonly<Record<ActorAction, readonly string[]>> =
  {
    parado: ['parado'],
    caminhando: ['caminhando', 'parado'],
    correndo: ['correndo', 'caminhando', 'parado'],
    pulando: ['pulando', 'parado'],
    agachado: ['agachado', 'parado'],
  };

/** Quadros de um personagem: ação → direção → lista de URLs, na ordem do ciclo. */
export type ActorFrames = Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
>;

/**
 * URL do quadro a desenhar, ou `null` quando o personagem não tem arte nenhuma.
 *
 * @param frames    Quadros disponíveis, por ação e direção.
 * @param base      Quadros estáticos das 8 direções — o último recurso.
 * @param action    Ação pedida.
 * @param direction Nome da direção da vista.
 * @param tick      Contador de quadros da animação; o resto decide o ciclo.
 */
export function frameUrl(
  frames: ActorFrames,
  base: Readonly<Record<string, readonly string[]>> | undefined,
  action: ActorAction,
  direction: DirectionName,
  tick: number,
): string | null {
  for (const candidata of ACTION_FALLBACK[action]) {
    const lista = frames[candidata]?.[direction];
    if (lista && lista.length > 0) {
      return lista[Math.abs(Math.floor(tick)) % lista.length] ?? null;
    }
  }
  const estatica = base?.[direction];
  if (estatica && estatica.length > 0) return estatica[0] ?? null;
  return null;
}
