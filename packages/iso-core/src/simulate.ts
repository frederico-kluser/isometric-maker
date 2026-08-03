/**
 * Simulação de um quadro contra o mapa — movimento **com** colisão.
 *
 * Este módulo é o miolo que estava escondido dentro de `runTrace`. Existiam
 * dois caminhos e nenhum servia para um personagem jogável ao vivo:
 *
 * - `step` (em `movement.ts`) recebe e devolve {@link MovementState}, tem
 *   marchas, degrau e gravidade — e **não faz colisão horizontal**. O
 *   personagem atravessa a parede.
 * - `runTrace` (em `trace.ts`) faz colisão, degrau e pulo — mas recebe
 *   `(x, y, z)` escalares e uma lista de quadros. Não recebe estado, portanto
 *   perde a velocidade, o `facing` e a continuidade do pulo entre chamadas.
 *   É replay determinístico em lote, não entrada ao vivo.
 *
 * {@link stepWithMap} é a terceira porta: um quadro, estado a entrar e estado
 * a sair, com a colisão de `runTrace`. E é literalmente a mesma colisão —
 * ambos chamam {@link fixedStepWithMap}. Se as duas divergirem alguma vez, é
 * porque alguém duplicou a lógica em vez de a partilhar, e o teste de
 * equivalência em `simulate.test.ts` falha.
 *
 * ## O pulo vive no estado, não no simulador
 *
 * O {@link JumpState} era uma variável local de `runTrace`. Num laço de quadro
 * ao vivo isso é fatal: o pulo nasce no quadro 1 e é esquecido antes do quadro
 * 2. Agora vive em `state.jump`, e `runTrace` lê-o de lá — a assinatura
 * pública de `runTrace` não mudou.
 *
 * ## Sair da beirada é cair, não bater
 *
 * A resolução de colisão recusava entrar numa célula sem suporte, o que
 * prendia o personagem na borda de uma plataforma em vez de o deixar cair.
 * Num editor onde o utilizador quer testar pulos entre blocos, isso está
 * errado. Ver {@link resolveCollision}.
 */

import {
  canEnter,
  edgesAllowCross,
  type CollisionMap,
} from './collision.ts';
import {
  PLAYER_HALF,
  pressedCells,
  resolveMovement,
  type EntityBox,
  type MovementResult,
} from './collision-box.ts';
import { fallStep, groundZAt, DEFAULT_FALL_SPEED } from './gravity.ts';
import {
  advanceJump,
  createJump,
  effectiveZ,
  isJumpComplete,
  type JumpState,
} from './jump.ts';
import {
  jumpRise,
  resolveGait,
  speedFor,
  type MovementConfig,
  type MovementInput,
  type MovementState,
} from './movement.ts';
import { stepZOnCross } from './step-up.ts';

// ------------------------------------------------------------------ tipos

/** Célula onde um passo foi recusado. */
export interface BlockedCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Resultado de um passo de lógica contra o mapa.
 *
 * O facto "foi bloqueado" está em `state.blocked` — é o consumidor ao vivo que
 * o quer, e cabe no estado. A célula exacta do bloqueio sai à parte porque só
 * `runTrace` a reporta, e enfiá-la no estado obrigaria todos os outros passos
 * a carregar um campo permanentemente indefinido.
 */
export interface MapStepOutcome {
  readonly state: MovementState;
  readonly blockedAt?: BlockedCell;
}

// ------------------------------------------------------------------ movimento horizontal puro

/**
 * Aplica a velocidade horizontal do modo de locomoção durante um passo fixo.
 *
 * Não consulta o mapa: é a intenção de movimento, que a colisão a seguir
 * aceita ou recusa.
 */
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
    crouching: gait === 'crouch',
  };
}

// ------------------------------------------------------------------ resolução de colisão

/**
 * Aceita, recusa ou clampa o movimento horizontal que a caixa propôs.
 *
 * ## A colisão é por caixa, não por ponto
 *
 * O teste histórico era `map.hasBlock(Math.floor(pos))` — o centro do
 * personagem contra a célula. Agora o corpo é uma {@link EntityBox} de meia
 * largura `PLAYER_HALF` (0,325 → caixa ~0,65) e o movimento horizontal já vem
 * resolvido por {@link resolveMovement}: varredura por eixo que clampa a face
 * no primeiro sólido, com sliding natural (bloquear X não trava Y). Este
 * ponto de resolução julga o resto: o chão, a aresta e o flag de bloqueio.
 *
 * ## Sair da beirada é cair
 *
 * A versão anterior recusava qualquer célula que `canEnter` reprovasse, e
 * `canEnter` reprova uma célula vazia sem bloco por baixo. O efeito era o
 * personagem **travar na borda de uma plataforma** em vez de cair dela — e,
 * pelo mesmo motivo, não conseguir sobrevoar um vão a meio de um pulo. Num
 * editor onde o utilizador quer testar pulo entre blocos, isso é o oposto do
 * que ele pediu.
 *
 * A regra é: uma célula **sem bloco** e **sem suporte** é atravessável desde
 * que exista chão alcançável por baixo. A gravidade resolve a descida no
 * passo seguinte, e o `z` continua discreto em todo o instante.
 *
 * Continua proibido:
 *   - entrar numa célula **ocupada por bloco** (a caixa clampa na face — é o
 *     `blockedX/blockedY` de {@link resolveMovement});
 *   - atravessar uma aresta com **parede**;
 *   - descer abaixo do plano de chão (`z < 0`);
 *   - entrar numa coluna onde **nenhuma** célula até ao chão é ocupável — o
 *     personagem estaria dentro de sólido, e não há queda que o resolva.
 *
 * **`canEnter` não mudou.** A pergunta "esta célula é ocupável e apoiada?"
 * continua a ser a mesma para `canStepUp`, `canStepDown` e `canCross`. A
 * permissão de queda entra aqui, no ponto de resolução, e só aqui.
 *
 * A aresta continua a ser julgada pela travessia do **centro**: uma parede é
 * uma superfície sem espessura, e a recusa histórica (voltar à posição
 * anterior) preserva-se — só os blocos, que têm volume, produzem o clamping
 * de face.
 */
function resolveCollision(
  map: CollisionMap,
  prevPos: { x: number; y: number },
  nextState: MovementState,
  moved: MovementResult,
  z: number,
  airborne: boolean,
): { blocked: boolean; state: MovementState } {
  const refuse = (): { blocked: boolean; state: MovementState } => ({
    blocked: true,
    state: { ...nextState, pos: prevPos, vel: { x: 0, y: 0 } },
  });

  // Sair do mapa por baixo não é uma queda, é um buraco no modelo.
  if (z < 0) return refuse();

  const nextCellX = Math.floor(moved.x);
  const nextCellY = Math.floor(moved.y);

  // Sem suporte: permitido se houver chão por baixo para onde cair.
  if (!airborne && !canEnter(map, nextCellX, nextCellY, z)) {
    if (groundZAt(map, nextCellX, nextCellY, z) >= z) {
      // `groundZAt` devolve o próprio z quando nada abaixo é ocupável — o
      // caso degenerado de "dentro de sólido". Não há queda a oferecer.
      return refuse();
    }
  }

  // Aresta. Só a pergunta das paredes: `canCross` recusaria também o destino
  // sem suporte, que é exactamente o que acabámos de permitir. A caixa não
  // vê paredes — elas são superfícies sem volume —, portanto a travessia do
  // centro continua a ser o juiz delas.
  const fromCell = { x: Math.floor(prevPos.x), y: Math.floor(prevPos.y), z };
  const toCell = { x: nextCellX, y: nextCellY, z };
  if ((fromCell.x !== toCell.x || fromCell.y !== toCell.y) &&
      !edgesAllowCross(map, fromCell, toCell)) {
    return refuse();
  }

  // Clamping de face: a caixa encostou num sólido. Fica na posição clampada
  // (desliza no eixo livre) e zera a velocidade — `blocked` descreve a
  // chamada, como sempre.
  if (moved.blockedX || moved.blockedY) {
    return {
      blocked: true,
      state: { ...nextState, pos: { x: moved.x, y: moved.y }, vel: { x: 0, y: 0 } },
    };
  }
  return { blocked: false, state: nextState };
}

// ------------------------------------------------------------------ estado do pulo

/**
 * Reflecte o {@link JumpState} nos campos que quem desenha lê.
 *
 * `airborne`, `jumpTime` e `vz` são derivados, nunca fonte: derivá-los aqui é
 * o que impede o estado de dizer uma coisa e o pulo outra.
 */
function withJump(
  state: MovementState,
  jump: JumpState,
  config: MovementConfig,
): MovementState {
  const airborne = !isJumpComplete(jump);
  return {
    ...state,
    jump,
    airborne,
    jumpTime: airborne ? (1 - jump.progress) * config.jumpDuration : 0,
    vz: airborne ? (jump.zDest - jump.zOrigin) / config.jumpDuration : null,
  };
}

// ------------------------------------------------------------------ passo de lógica

/**
 * Avança **um** passo fixo de lógica contra o mapa: pulo, gravidade,
 * movimento horizontal, degrau na travessia e colisão.
 *
 * É a única implementação desta sequência no repositório. `runTrace` e
 * {@link stepWithMap} são dois invólucros à volta dela — um que consome uma
 * lista de quadros gravados, outro que consome o `dt` real de um laço de
 * quadro. Duplicar esta função é a forma de fazer os dois divergirem em
 * silêncio.
 *
 * A ordem das operações é a de `runTrace` e não é arbitrária: o degrau
 * acontece **na travessia da aresta**, depois da gravidade, para que as duas
 * regras julguem sempre a mesma célula (ver `step-up.ts`).
 */
export function fixedStepWithMap(
  state: MovementState,
  input: MovementInput,
  config: MovementConfig,
  map: CollisionMap,
): MapStepOutcome {
  let jump = state.jump;
  let fallProgress = state.fallProgress;
  let falling = false;

  const z = isJumpComplete(jump) ? state.z : effectiveZ(jump);
  const cellX = Math.floor(state.pos.x);
  const cellY = Math.floor(state.pos.y);

  let newZ = z;

  // Inicia pulo — agachado não pula, e um tecto sólido também não deixa.
  if (input.jump && input.crouch !== true && isJumpComplete(jump)) {
    const target = newZ + jumpRise(config);
    if (!map.hasBlock(cellX, cellY, target)) {
      jump = createJump(newZ, target);
    }
  }

  // Gravidade — só no chão, e sobre a célula onde o personagem está.
  // Como o degrau já não sobe o z antecipadamente, esta avaliação e a do
  // degrau nunca olham para células diferentes.
  if (isJumpComplete(jump)) {
    const fall = fallStep(
      map,
      cellX,
      cellY,
      newZ,
      fallProgress,
      config.fixedDt,
      config.fallSpeed ?? DEFAULT_FALL_SPEED,
    );
    newZ = fall.z;
    fallProgress = fall.fallProgress;
    falling = fall.falling;
  } else {
    fallProgress = 0;
    falling = false;
  }

  // Avança pulo.
  if (!isJumpComplete(jump)) {
    jump = advanceJump(jump, config.fixedDt, config.jumpDuration);
  }

  // Movimento horizontal — a intenção, que a colisão a seguir aceita, recusa
  // ou clampa.
  const prevPos = state.pos;
  const moved = applyHorizontal({ ...state, z: newZ }, input, config);

  // Colisão por caixa: resolve o movimento contra os sólidos ANTES do degrau,
  // para que a face pressionada possa propor o degrau. A caixa de 0,65 encosta
  // no degrau 0,325 célula antes de o centro cruzar a aresta; se o degrau
  // esperasse pela travessia do centro, o personagem ficaria preso na parede.
  // Durante o pulo, a caixa vive no z de destino (é lá que o corpo estará).
  const zForCollision = isJumpComplete(jump) ? newZ : jump.zDest;
  const airborne = !isJumpComplete(jump);
  const dx = moved.pos.x - prevPos.x;
  const dy = moved.pos.y - prevPos.y;
  const box: EntityBox = { cx: prevPos.x, cy: prevPos.y, z: zForCollision, half: PLAYER_HALF };
  const movedBox = resolveMovement(map, box, dx, dy);
  const blockedByBox = movedBox.blockedX || movedBox.blockedY;

  // Degrau — acontece NA travessia da aresta (comportamento histórico) e,
  // quando a caixa está pressionada contra um sólido, na célula da face
  // bloqueada. As duas portas existem porque um corpo de 0,65 encosta antes
  // de o centro cruzar; sem a porta da face, nenhum degrau seria escalável.
  const nextCellX = Math.floor(moved.pos.x);
  const nextCellY = Math.floor(moved.pos.y);
  const crossing = nextCellX !== cellX || nextCellY !== cellY;

  let steppedZ = newZ;
  if (isJumpComplete(jump) && !input.jump) {
    if (crossing) {
      steppedZ = stepZOnCross(
        map,
        { x: cellX, y: cellY, z: newZ },
        nextCellX,
        nextCellY,
        input.stepUp,
        input.stepDown,
      );
    }
    if (steppedZ === newZ && blockedByBox && input.stepUp) {
      for (const pressed of pressedCells(box, movedBox, dx, dy)) {
        const stepped = stepZOnCross(
          map,
          { x: cellX, y: cellY, z: newZ },
          pressed.x,
          pressed.y,
          true,
          false,
        );
        if (stepped !== newZ) {
          steppedZ = stepped;
          break;
        }
      }
    }
  }

  if (steppedZ !== newZ) {
    // `canStepUp`/`canStepDown` já validaram o destino e as arestas nos dois
    // níveis — é por isso que o degrau não passa por `canCross`, que exigiria
    // o destino entrável ao mesmo z. Ver `step-up.ts`.
    return {
      state: withJump(
        { ...moved, z: steppedZ, falling, fallProgress, blocked: false },
        jump,
        config,
      ),
    };
  }

  // Colisão. A caixa já resolveu os sólidos em `movedBox`; aqui ficam o chão,
  // a aresta e o flag de bloqueio.
  const resolved = resolveCollision(map, prevPos, moved, movedBox, zForCollision, airborne);

  const next = withJump(
    { ...resolved.state, falling, fallProgress, blocked: resolved.blocked },
    jump,
    config,
  );

  if (resolved.blocked) {
    return {
      state: next,
      blockedAt: {
        x: Math.floor(prevPos.x),
        y: Math.floor(prevPos.y),
        z: zForCollision,
      },
    };
  }

  return { state: next };
}

// ------------------------------------------------------------------ controlador ao vivo

/**
 * Avança o movimento **com colisão** usando o `dt` real de um laço de quadro.
 *
 * É o `step` de `movement.ts` com o que lhe faltava: colisão horizontal,
 * degrau na travessia e um pulo que sobrevive ao quadro. A mesma resolução de
 * `runTrace`, porque é literalmente a mesma função ({@link fixedStepWithMap}).
 *
 * O `dt` é real e variável — o do `ticker` do PixiJS. O passo fixo interno
 * continua a ser `config.fixedDt`: o excedente fica em `state.accumulator`
 * para a chamada seguinte, e é ele que dá o `alpha` de interpolação visual
 * (`state.accumulator / config.fixedDt`).
 *
 * ## O que ler do estado devolvido
 *
 * | Campo | Para quê |
 * |---|---|
 * | `pos`, `z` | posição no modelo; `z` é sempre inteiro |
 * | `facing` | ângulo em radianos → escolher uma das 8 direcções |
 * | `gait` | `run` / `walk` / `crouch` → escolher a animação |
 * | `airborne`, `jump.progress` | pulo em curso; `visualOffsetY(progress, px)` |
 * | `falling` | queda em curso |
 * | `blocked` | o último passo bateu em alguma coisa |
 * | `accumulator` | `alpha` de interpolação entre o passo anterior e este |
 *
 * @param dt - Tempo real decorrido no quadro, em segundos.
 * @param map - Mapa de colisão. **Obrigatório** — é o que distingue esta
 *   função de `step`. Sem mapa não há colisão nem chão, e a pergunta "posso
 *   entrar aqui?" não tem resposta.
 */
export function stepWithMap(
  state: MovementState,
  input: MovementInput,
  dt: number,
  config: MovementConfig,
  map: CollisionMap,
): MovementState {
  const total = state.accumulator + dt;

  // floor em vez de subtracção repetida: 1/60 não é representável em binário
  // e o `while` acumularia o erro.
  const stepsToRun = Math.floor(total / config.fixedDt);

  let current = state;
  let blocked = false;
  for (let i = 0; i < stepsToRun; i++) {
    current = fixedStepWithMap(current, input, config, map).state;
    if (current.blocked) blocked = true;
  }

  const remainder = total - stepsToRun * config.fixedDt;

  // `blocked` descreve **esta chamada**: se qualquer um dos passos fixos
  // consumidos foi recusado, o quadro bateu em alguma coisa. Um quadro curto
  // de mais para consumir um passo devolve `false`, que é a verdade.
  return { ...current, accumulator: remainder, blocked };
}
