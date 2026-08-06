/**
 * Ponto de entrada do browser — runtime Three.js.
 *
 * Inicializa o renderizador 3D, carrega o projeto via `/__project__.json`, e
 * arranca o laço de jogo com passo fixo de lógica e interpolação visual.
 *
 * ## O personagem colide com os cubos
 *
 * Até 2026-08-05 o runtime chamava `step`, que **não tem mapa**: o personagem
 * atravessava paredes e andava sobre o vazio, porque a função sem mapa não
 * tem a quem perguntar "posso entrar aqui?". Agora chama `stepWithMap` com um
 * `CollisionMap` construído do mapa do projeto — a mesma colisão varrida que
 * o modo teste do editor usa, vinda do mesmo `iso-core`.
 */
import type { ProjectV1 } from '@isometric-maker/iso-core/project';
import type { MapData } from '@isometric-maker/iso-core/map';
import {
  createMovementState,
  DEFAULT_CONFIG,
  type MovementState,
  type MovementInput,
} from '@isometric-maker/iso-core/movement';
import { stepWithMap } from '@isometric-maker/iso-core/simulate';
import {
  buildCollisionMap,
  spawnZAt,
} from '@isometric-maker/iso-core/collision-map';
import {
  createRenderContext,
  createCharacterRender,
  createFpsCounter,
  drawMap,
  followCamera,
  positionCharacter,
  resizeRenderer,
  updateCharacterAnim,
  updateFps,
  type CharacterRender,
} from './render.ts';

// ------------------------------------------------------------------ tipos da resposta do servidor

interface ProjectPayload {
  readonly project: ProjectV1;
  readonly sidecars: Record<string, {
    readonly fps: Record<string, number>;
    readonly anchor: { readonly x: number; readonly y: number };
    readonly anchorSource: 'medida' | 'padrao';
  }>;
  readonly atlasSheets: readonly string[];
}

// ------------------------------------------------------------------ constantes

const MOVEMENT_CONFIG = {
  ...DEFAULT_CONFIG,
  speed: 6, // unidades/s (ligeiramente mais rápido que o default de 4)
};

// ------------------------------------------------------------------ main

async function main(): Promise<void> {
  // 1. Busca os dados do projeto injetados pelo play.ts.
  const resp = await fetch('/__project__.json');
  if (!resp.ok) {
    document.body.textContent =
      'Erro: não foi possível carregar o projeto. ' +
      'Execute o runtime via "npm run play -- <project.json>".';
    return;
  }
  const payload: ProjectPayload = await resp.json();
  const { project, sidecars, atlasSheets } = payload;

  // 2. Cria o canvas e o renderizador Three.js.
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const ctx = createRenderContext(canvas, project.geometria);
  resizeRenderer(ctx, window.innerWidth, window.innerHeight);
  window.addEventListener('resize', () => {
    resizeRenderer(ctx, window.innerWidth, window.innerHeight);
  });

  // 3. Desenha o mapa e monta o índice de colisão a partir dele.
  const mapa: MapData = project.mapa ?? { blocks: {}, edges: [] };
  drawMap(ctx, mapa);
  const colisao = buildCollisionMap(mapa);

  // 4. Carrega o personagem (primeiro atlas disponível).
  let char: CharacterRender | undefined;
  const sheetKeys = Object.keys(sidecars);
  if (atlasSheets.length > 0 && sheetKeys.length > 0) {
    const sheetUrl = atlasSheets[0]!;
    const sidecar = sidecars[sheetKeys[0]!]!;
    char = await createCharacterRender(ctx, sheetUrl, sidecar);
  }

  // 5. Estado de movimento. O z inicial é o topo livre da coluna (0,0): pôr o
  //    personagem em z=0 dentro de um mapa com chão o enterraria no primeiro
  //    bloco.
  let movementState = createMovementState(0, 0, spawnZAt(colisao, 0, 0));

  const input = createKeyboardInput();
  const fpsCounter = createFpsCounter();

  // 6. Laço de jogo.
  let prevState = movementState;
  let lastTime = performance.now();

  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    // Passo fixo de lógica, agora COM mapa — o personagem bate nos cubos.
    movementState = stepWithMap(
      movementState,
      input.getInput(),
      dt,
      MOVEMENT_CONFIG,
      colisao,
    );

    // Interpolação visual (apenas no desenho).
    const alpha = movementState.accumulator / MOVEMENT_CONFIG.fixedDt;
    const renderX =
      prevState.pos.x + (movementState.pos.x - prevState.pos.x) * alpha;
    const renderY =
      prevState.pos.y + (movementState.pos.y - prevState.pos.y) * alpha;

    if (char) {
      positionCharacter(char.sprite, renderX, renderY, movementState.z);
      updateCharacterAnim(char, movementState, now);
    }

    followCamera(ctx, renderX, renderY, movementState.z);
    ctx.renderer.render(ctx.scene, ctx.camera);
    updateFps(fpsCounter, ctx.renderer);

    prevState = movementState;
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ teclado

interface KeyboardInputState {
  getInput(): MovementInput;
}

function createKeyboardInput(): KeyboardInputState {
  const keys = new Set<string>();

  window.addEventListener('keydown', (e) => {
    keys.add(e.key);
    // Previne scroll da página com setas e espaço.
    if (
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)
    ) {
      e.preventDefault();
    }
  });

  window.addEventListener('keyup', (e) => {
    keys.delete(e.key);
  });

  // Restaura o estado quando a janela perde o foco.
  window.addEventListener('blur', () => keys.clear());

  return {
    getInput(): MovementInput {
      let dx = 0;
      let dy = 0;

      if (keys.has('ArrowRight') || keys.has('d') || keys.has('D')) dx += 1;
      if (keys.has('ArrowLeft') || keys.has('a') || keys.has('A')) dx -= 1;
      if (keys.has('ArrowDown') || keys.has('s') || keys.has('S')) dy += 1;
      if (keys.has('ArrowUp') || keys.has('w') || keys.has('W')) dy -= 1;

      const jump = keys.has(' ');
      const stepUp = keys.has('e') || keys.has('E');
      const stepDown = keys.has('q') || keys.has('Q');

      // Normaliza a direção.
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        dx /= len;
        dy /= len;
      }

      return { dir: { x: dx, y: dy }, jump, stepUp, stepDown };
    },
  };
}

// ------------------------------------------------------------------ arranque

main().catch((err) => {
  console.error('Erro fatal no runtime:', err);
  document.body.textContent = `Erro: ${String(err)}`;
});
