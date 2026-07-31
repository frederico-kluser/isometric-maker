/**
 * Ponto de entrada do browser — F4-02.
 *
 * Inicializa o PixiJS, carrega o projecto via `/__project__.json`, e
 * arranca o loop de jogo com passo fixo de lógica e interpolação visual.
 */
import { Application } from 'pixi.js';
import type { ProjectV1 } from '@isometric-maker/iso-core/project';
import type { MapData } from '@isometric-maker/iso-core/map';
import {
  createMovementState,
  step,
  DEFAULT_CONFIG,
  type MovementState,
  type MovementInput,
} from '@isometric-maker/iso-core/movement';
import {
  createRenderContext,
  drawMap,
  createCharacterRender,
  updateCharacterAnim,
  positionCharacter,
  createFpsCounter,
  updateFps,
  type RenderContext,
  type CharacterRender,
  type FpsCounter,
} from './render';

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
  // 1. Busca os dados do projecto injectados pelo play.ts.
  const resp = await fetch('/__project__.json');
  if (!resp.ok) {
    document.body.textContent =
      'Erro: não foi possível carregar o projecto. ' +
      'Execute o runtime via "npm run play -- <project.json>".';
    return;
  }
  const payload: ProjectPayload = await resp.json();
  const { project, sidecars, atlasSheets } = payload;
  const geom = project.geometria;

  // 2. Cria a aplicação PixiJS.
  const app = new Application();
  await app.init({
    resizeTo: window,
    backgroundColor: 0x1a1a2e,
    antialias: false,
    resolution: 1,
    autoDensity: false,
  });
  document.body.appendChild(app.canvas);

  // 3. Inicializa o contexto de renderização.
  const ctx = createRenderContext(app, geom);

  // 4. Desenha o mapa.
  const mapa: MapData = project.mapa ?? { blocks: {}, edges: [] };
  drawMap(ctx, mapa);

  // 5. Carrega o personagem (primeiro atlas disponível).
  let char: CharacterRender | undefined;
  const sheetKeys = Object.keys(sidecars);
  if (atlasSheets.length > 0 && sheetKeys.length > 0) {
    const sheetUrl = atlasSheets[0]!;
    const sidecar = sidecars[sheetKeys[0]!]!;
    char = await createCharacterRender(sheetUrl, sidecar);
    ctx.entityLayer.addChild(char.sprite);
  }

  // 6. Configura o estado de movimento do personagem.
  //    Posição inicial: centro do mapa ou (0,0,0).
  let movementState = createMovementState(0, 0, 0);

  // 7. Configura a câmara: desloca o stage para centrar o personagem.
  positionStage(ctx, movementState.pos.x, movementState.pos.y);

  // 8. Entrada de teclado.
  const input = createKeyboardInput();

  // 9. Contador de FPS.
  const fpsCounter = createFpsCounter();

  // 10. Loop de jogo.
  let prevState = movementState;
  app.ticker.add(() => {
    const dt = app.ticker.deltaMS / 1000;

    // Passo fixo de lógica (F3-01)
    movementState = step(movementState, input.getInput(), dt, MOVEMENT_CONFIG);

    // Interpolação visual (apenas no desenho)
    const alpha = movementState.accumulator / MOVEMENT_CONFIG.fixedDt;
    const renderX =
      prevState.pos.x + (movementState.pos.x - prevState.pos.x) * alpha;
    const renderY =
      prevState.pos.y + (movementState.pos.y - prevState.pos.y) * alpha;

    // Posiciona o personagem
    if (char) {
      positionCharacter(char.sprite, renderX, renderY, movementState.z, geom);
      updateCharacterAnim(char, movementState);
    }

    // Ajusta a câmara
    positionStage(ctx, renderX, renderY);

    // FPS
    updateFps(fpsCounter, app.renderer);

    prevState = movementState;
  });
}

// ------------------------------------------------------------------ câmara

function positionStage(
  ctx: RenderContext,
  x: number,
  y: number,
): void {
  const geom = ctx.geom;
  const hw = geom.tileWidth / 2;
  const hh = geom.tileHeight / 2;
  const sx = (x - y) * hw;
  const sy = (x + y) * hh;

  // Centra o personagem no ecrã.
  ctx.app.stage.x = ctx.app.screen.width / 2 - sx;
  ctx.app.stage.y = ctx.app.screen.height / 3 - sy;
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

      // Normaliza a direcção.
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
