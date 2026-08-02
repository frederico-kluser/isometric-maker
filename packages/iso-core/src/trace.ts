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
 * ## Nota de reconciliação (por fazer)
 *
 * Continuam a existir dois modelos de pulo: `movement.ts` sobe o z no
 * instante 0 e `jump.ts` troca o z a meio do progresso. Este ficheiro usa o
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
	resolveGait,
	speedFor,
	jumpRise,
	type MovementState,
	type MovementInput,
	type MovementConfig,
} from "./movement.ts";
import { canEnter, canCross, type CollisionMap } from "./collision.ts";
import { resolveStepZ } from "./step-up.ts";
import { fallStep, groundZAt, DEFAULT_FALL_SPEED } from "./gravity.ts";
import {
	createJump,
	advanceJump,
	effectiveZ,
	isJumpComplete,
	type JumpState,
	NO_JUMP,
} from "./jump.ts";

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

// ------------------------------------------------------------------ movimento horizontal puro

function applyHorizontal(
	state: MovementState,
	input: MovementInput,
	config: MovementConfig,
): MovementState {
	const hasInput = input.dir.x !== 0 || input.dir.y !== 0;
	const gait = resolveGait(input);
	const speed = speedFor(gait, config);
	let vel: { x: number; y: number };
	let facing: number;

	if (hasInput) {
		const len = Math.sqrt(
			input.dir.x * input.dir.x + input.dir.y * input.dir.y,
		);
		const nx = input.dir.x / len;
		const ny = input.dir.y / len;
		vel = { x: nx * speed, y: ny * speed };
		facing = Math.atan2(ny, nx);
	} else {
		vel = { x: 0, y: 0 };
		facing = state.facing;
	}

	return {
		...state,
		pos: {
			x: state.pos.x + vel.x * config.fixedDt,
			y: state.pos.y + vel.y * config.fixedDt,
		},
		vel,
		facing,
		gait,
		crouching: gait === "crouch",
	};
}

// ------------------------------------------------------------------ resolução de colisão

function resolveCollision(
	map: CollisionMap,
	prevPos: { x: number; y: number },
	nextState: MovementState,
	z: number,
	airborne: boolean,
): { blocked: boolean; state: MovementState } {
	const prevCellX = Math.floor(prevPos.x);
	const prevCellY = Math.floor(prevPos.y);
	const nextCellX = Math.floor(nextState.pos.x);
	const nextCellY = Math.floor(nextState.pos.y);

	if (prevCellX === nextCellX && prevCellY === nextCellY) {
		return { blocked: false, state: nextState };
	}

	// Célula de destino ocupada por bloco → sempre bloqueado
	if (map.hasBlock(nextCellX, nextCellY, z)) {
		return {
			blocked: true,
			state: { ...nextState, pos: prevPos, vel: { x: 0, y: 0 } },
		};
	}

	// Se não estiver no ar, verifica suporte (walkability completa)
	if (!airborne && !canEnter(map, nextCellX, nextCellY, z)) {
		return {
			blocked: true,
			state: { ...nextState, pos: prevPos, vel: { x: 0, y: 0 } },
		};
	}

	// Verifica aresta
	const fromCell = { x: prevCellX, y: prevCellY, z };
	const toCell = { x: nextCellX, y: nextCellY, z };

	if (!canCross(map, fromCell, toCell)) {
		return {
			blocked: true,
			state: { ...nextState, pos: prevPos, vel: { x: 0, y: 0 } },
		};
	}

	return { blocked: false, state: nextState };
}

// ------------------------------------------------------------------ step up / down

/**
 * Tenta subir ou descer um degrau a partir da célula actual.
 *
 * A regra vive em `step-up.ts` — aqui é só a adaptação da entrada. Ter uma
 * cópia da escolha de direcção aqui e outra em `movement.ts` era como o
 * degrau e a gravidade acabavam a discordar sobre onde é o chão.
 */
function tryStep(
	map: CollisionMap,
	cellX: number,
	cellY: number,
	z: number,
	input: MovementInput,
): number {
	return resolveStepZ(
		map,
		cellX,
		cellY,
		z,
		input.dir.x,
		input.dir.y,
		input.stepUp,
		input.stepDown,
	);
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
	let jump: JumpState = NO_JUMP;
	let totalSteps = 0;
	let totalTime = 0;
	let blocked = false;
	let blockedAt: { x: number; y: number; z: number } | undefined;
	let fallProgress = 0;
	let falling = false;
	const fallSpeed = config.fallSpeed ?? DEFAULT_FALL_SPEED;

	for (const frame of frames) {
		if (blocked) break;

		let remaining = frame.duration;
		totalTime += frame.duration;

		while (remaining >= config.fixedDt && !blocked) {
			remaining -= config.fixedDt;

			const z = isJumpComplete(jump) ? state.z : effectiveZ(jump);
			const cellX = Math.floor(state.pos.x);
			const cellY = Math.floor(state.pos.y);

			// Step up/down (só no chão, sem pulo activo)
			let newZ = z;
			if (isJumpComplete(jump) && !frame.input.jump) {
				newZ = tryStep(map, cellX, cellY, z, frame.input);
			}

			// Inicia pulo — agachado não pula, e um tecto sólido também não deixa.
			if (
				frame.input.jump &&
				frame.input.crouch !== true &&
				isJumpComplete(jump)
			) {
				const target = newZ + jumpRise(config);
				if (!map.hasBlock(cellX, cellY, target)) {
					jump = createJump(newZ, target);
				}
			}

			// Gravidade — só no chão. Durante o pulo o z é do pulo.
			if (isJumpComplete(jump)) {
				const fall = fallStep(
					map,
					cellX,
					cellY,
					newZ,
					fallProgress,
					config.fixedDt,
					fallSpeed,
				);
				newZ = fall.z;
				fallProgress = fall.fallProgress;
				falling = fall.falling;
			} else {
				fallProgress = 0;
				falling = false;
			}

			// Avança pulo
			if (!isJumpComplete(jump)) {
				jump = advanceJump(jump, config.fixedDt, config.jumpDuration);
			}

			// Movimento horizontal
			const prevPos = state.pos;
			state = applyHorizontal({ ...state, z: newZ }, frame.input, config);

			// Colisão
			// Durante o pulo, usa o z de destino para permitir pular sobre obstáculos.
			const zForCollision = isJumpComplete(jump) ? newZ : jump.zDest;
			const airborne = !isJumpComplete(jump);
			const resolved = resolveCollision(
				map,
				prevPos,
				state,
				zForCollision,
				airborne,
			);

			if (resolved.blocked) {
				blocked = true;
				blockedAt = {
					x: Math.floor(prevPos.x),
					y: Math.floor(prevPos.y),
					z: zForCollision,
				};
				state = resolved.state;
				break;
			}

			state = resolved.state;
			totalSteps++;
		}
	}

	// Um pulo interrompido a meio do ar — porque o traço acabou ou porque o
	// personagem bateu numa parede — é resolvido até ao solo: o resultado
	// reporta onde ele **aterra**, não a altura onde a simulação parou. Sem
	// isto, "pular contra uma parede de dois níveis devolve o personagem ao z
	// de origem" seria uma corrida contra o cronómetro do traço.
	//
	// Uma queda em curso NÃO é resolvida: essa o passo de lógica já trata, e
	// esconder o meio da queda tiraria a única forma de a observar.
	const semPuloActivo = isJumpComplete(jump);
	const finalZ = semPuloActivo
		? state.z
		: groundZAt(
				map,
				Math.floor(state.pos.x),
				Math.floor(state.pos.y),
				jump.zDest,
			);

	return {
		finalState: {
			...state,
			z: finalZ,
			falling: semPuloActivo ? falling : false,
			fallProgress: semPuloActivo ? fallProgress : 0,
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
