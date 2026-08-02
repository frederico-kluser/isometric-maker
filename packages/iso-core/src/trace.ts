/**
 * Traço de entrada — execução determinística de uma sequência de entradas
 * contra o motor de movimento com verificação de colisão.
 *
 * Um "traço" (trace) é uma sequência de "quadros de entrada" (trace frames).
 * Cada quadro tem uma duração (em segundos) e um input. O motor processa
 * cada quadro e produz um estado final determinístico.
 *
 * ## Regras
 *
 * - xy move-se continuamente com a velocidade do modo de locomoção
 *   (correr é o padrão; `walk` anda, `crouch` agacha e não pula).
 * - z só muda por degrau (step up/down), pulo ou gravidade.
 * - Colisão de célula e aresta é verificada a cada passo.
 * - Se o movimento horizontal colidir com uma parede ou célula ocupada,
 *   o personagem PARA na posição antes da colisão.
 * - Determinismo: mesma sequência de entradas no mesmo mapa → mesmo resultado.
 *
 * ## O traço reporta a posição de repouso
 *
 * No fim do traço o `z` é resolvido contra a gravidade (`groundZAt`). Um
 * traço que termina — ou que é bloqueado — a meio do ar devolve o nível onde
 * o personagem **aterra**, não o nível onde a simulação parou. É isso que
 * torna "pular contra uma parede de dois níveis devolve o personagem ao z de
 * origem" uma asserção estável em vez de uma corrida contra o cronómetro.
 *
 * ## O passo de lógica não vive aqui
 *
 * `runTrace` é um **invólucro**: o passo de lógica é `fixedStepWithMap`, em
 * `simulate.ts`, e é a mesma função que `stepWithMap` corre num laço de quadro
 * ao vivo. O que continua a ser deste ficheiro é a leitura de uma lista de
 * quadros gravados e a resolução final do pulo até ao solo.
 *
 * ## Nota de reconciliação (por fazer)
 *
 * Continuam a existir dois modelos de pulo: `movement.ts` sobe o z no
 * instante 0 e `jump.ts` troca o z a meio do progresso. O passo com mapa usa o
 * de `jump.ts`, e testa a colisão em `jump.zDest` durante **todo** o pulo —
 * não em `zOrigin` durante a subida, como o comentário de `jump.ts` declara.
 * Não foi unificado de propósito: testar a subida em `zOrigin` faria o
 * personagem bater de frente no degrau em vez de aterrar em cima dele, o que
 * quebraria o requisito "pular sobre um degrau de um nível". Unificar os dois
 * modelos é trabalho por fazer, e exige decidir qual das duas semânticas fica.
 */

import {
	createMovementState,
	DEFAULT_CONFIG,
	type MovementState,
	type MovementInput,
	type MovementConfig,
} from "./movement.ts";
import type { CollisionMap } from "./collision.ts";
import { groundZAt } from "./gravity.ts";
import { isJumpComplete, NO_JUMP } from "./jump.ts";
import { fixedStepWithMap } from "./simulate.ts";

// ------------------------------------------------------------------ tipos

/** Um quadro de entrada: input mantido por `duration` segundos. */
export interface TraceFrame {
	/** Duração em segundos durante a qual o input é mantido. */
	readonly duration: number;
	/** Entrada do jogador neste quadro. */
	readonly input: MovementInput;
}

/** Resultado da execução de um traço. */
export interface TraceResult {
	/** Estado final do movimento após o traço. */
	readonly finalState: MovementState;
	/** Número total de passos de lógica executados. */
	readonly totalSteps: number;
	/** Tempo total simulado (soma das durações). */
	readonly totalTime: number;
	/** true se o traço foi bloqueado por colisão no último quadro. */
	readonly blocked: boolean;
	/** Posição onde o traço foi bloqueado (se blocked=true). */
	readonly blockedAt?: {
		readonly x: number;
		readonly y: number;
		readonly z: number;
	};
}

// ------------------------------------------------------------------ execução

export function runTrace(
	map: CollisionMap,
	startX: number,
	startY: number,
	startZ: number,
	frames: readonly TraceFrame[],
	config: MovementConfig = DEFAULT_CONFIG,
): TraceResult {
	let state = createMovementState(startX, startY, startZ);
	let totalSteps = 0;
	let totalTime = 0;
	let blocked = false;
	let blockedAt: { x: number; y: number; z: number } | undefined;

	for (const frame of frames) {
		if (blocked) break;

		let remaining = frame.duration;
		totalTime += frame.duration;

		while (remaining >= config.fixedDt && !blocked) {
			remaining -= config.fixedDt;

			// O passo de lógica é `fixedStepWithMap` — a MESMA função que
			// `stepWithMap` corre no laço de quadro ao vivo. O traço não tem
			// resolução de colisão própria; se tivesse, as duas divergiriam.
			const outcome = fixedStepWithMap(state, frame.input, config, map);
			state = outcome.state;

			if (state.blocked) {
				blocked = true;
				blockedAt = outcome.blockedAt;
				break;
			}

			totalSteps++;
		}
	}

	// Um pulo interrompido a meio do ar — porque o traço acabou ou porque o
	// personagem bateu numa parede — é resolvido até ao solo: o resultado
	// reporta onde ele **aterra**, não a altura onde a simulação parou. Sem
	// isto, "pular contra uma parede de dois níveis devolve o personagem ao z
	// de origem" seria uma corrida contra o cronómetro do traço.
	//
	// Isto é pós-processamento **do traço**, não do passo de lógica: um laço de
	// quadro ao vivo não pode fazê-lo, porque um pulo a meio do ar no fim do
	// quadro é precisamente um pulo que tem de continuar no quadro seguinte.
	//
	// Uma queda em curso NÃO é resolvida: essa o passo de lógica já trata, e
	// esconder o meio da queda tiraria a única forma de a observar.
	const semPuloActivo = isJumpComplete(state.jump);
	const finalZ = semPuloActivo
		? state.z
		: groundZAt(
				map,
				Math.floor(state.pos.x),
				Math.floor(state.pos.y),
				state.jump.zDest,
			);

	return {
		finalState: semPuloActivo
			? state
			: {
					...state,
					z: finalZ,
					falling: false,
					fallProgress: 0,
					jump: NO_JUMP,
					airborne: false,
					jumpTime: 0,
					vz: null,
				},
		totalSteps,
		totalTime,
		blocked,
		...(blockedAt !== undefined ? { blockedAt } : {}),
	};
}

// ------------------------------------------------------------------ utilitários

export const NO_DIR = { x: 0, y: 0 };

export const NO_INPUT: MovementInput = {
	dir: NO_DIR,
	jump: false,
	stepUp: false,
	stepDown: false,
};

export function dirInput(dx: number, dy: number): MovementInput {
	const len = Math.sqrt(dx * dx + dy * dy);
	if (len === 0) return { ...NO_INPUT };
	return {
		dir: { x: dx / len, y: dy / len },
		jump: false,
		stepUp: false,
		stepDown: false,
	};
}

export function jumpInput(dx: number, dy: number): MovementInput {
	const base = dirInput(dx, dy);
	return { ...base, jump: true };
}

export function stepUpInput(dx: number, dy: number): MovementInput {
	const base = dirInput(dx, dy);
	return { ...base, stepUp: true };
}

export function stepDownInput(dx: number, dy: number): MovementInput {
	const base = dirInput(dx, dy);
	return { ...base, stepDown: true };
}

/** Entrada a andar (Shift): mais devagar do que `dirInput`, que corre. */
export function walkInput(dx: number, dy: number): MovementInput {
	const base = dirInput(dx, dy);
	return { ...base, walk: true };
}

/** Entrada agachada: mais devagar do que a andar, e sem pulo. */
export function crouchInput(dx: number, dy: number): MovementInput {
	const base = dirInput(dx, dy);
	return { ...base, crouch: true };
}
