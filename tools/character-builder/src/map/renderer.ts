/**
 * Renderizador isométrico do mapa — F2-05.
 *
 * Desenha um {@link MapData} usando PixiJS 8.19.0 com ordenação de profundidade
 * de F2-03 (`sortByDepth`).
 *
 * ## Regras
 *
 * - NENHUMA edição neste módulo.  Apenas renderização.
 * - `scaleMode 'nearest'` e `mipmaps` desligados ANTES do primeiro `Assets.load`.
 * - Escala do palco **INTEIRA** (sem subpíxeis).
 * - Culling com `cullArea`.
 * - Teardown completo: `destroy` remove texturas, ticker e canvas.
 *
 * ## Ordem de desenho
 *
 * Células e arestas são recolhidas, ordenadas por `sortByDepth` (F2-03) e
 * desenhadas nessa ordem.  Sprites são reutilizados via pool para evitar
 * alocações por frame.
 */

import {
  Application,
  Container,
  Texture,
  Sprite,
  Rectangle,
} from 'pixi.js';
import {
  sortByDepth,
  type DepthItem,
} from '../../../../packages/iso-core/src/depth.ts';
import type { MapData } from '../../../../packages/iso-core/src/map.ts';

// ------------------------------------------------------------------ tipos locais (evita importar geometry.ts → project.ts que usa node:crypto)

/** Geometria da projecção isométrica. */
interface ProjectGeometry {
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly zStep: number;
}

interface ScreenPoint {
  readonly sx: number;
  readonly sy: number;
}

/**
 * Converte coordenadas de mundo para ecrã (projecção dimétrica 2:1).
 * Função inline para evitar a dependência de geometry.ts → project.ts → node:crypto.
 */
function worldToScreen(
  x: number,
  y: number,
  z: number,
  geom: ProjectGeometry,
): ScreenPoint {
  const halfW = geom.tileWidth / 2;
  const halfH = geom.tileHeight / 2;
  return {
    sx: (x - y) * halfW,
    sy: (x + y) * halfH - z * geom.zStep,
  };
}

// ------------------------------------------------------------------ tipos

/** Configuração do renderizador. */
export interface RendererConfig {
  /** Geometria da projecção isométrica. */
  readonly geometry: ProjectGeometry;
  /** Escala do palco (inteira, ex.: 1, 2, 3). */
  readonly stageScale: number;
  /** Offset da câmara em píxeis (após escala). */
  readonly cameraOffset: { readonly x: number; readonly y: number };
  /** Cor de fundo (hex, ex.: 0x1a1a2e). */
  readonly backgroundColor: number;
}

/** Estado do renderizador. */
export interface MapRenderer {
  /** Container raiz do PixiJS. */
  readonly stage: Container;
  /** Aplicação PixiJS. */
  readonly app: Application;
  /** Redesenha o mapa com os dados fornecidos. */
  render(map: MapData): void;
  /** Liberta todos os recursos (texturas, ticker, canvas). */
  destroy(): void;
}

// ------------------------------------------------------------------ factory

/**
 * Cria o renderizador isométrico.
 *
 * Inicialização assíncrona: o `Application.init` do PixiJS 8 é async.
 * O ticker do PixiJS é separado do relógio de lógica — este renderizador
 * só desenha quando `render()` é chamado.
 *
 * @param canvas - Elemento canvas a usar (se omitido, o PixiJS cria um).
 * @param config - Configuração do renderizador.
 */
export async function createMapRenderer(
  canvas: HTMLCanvasElement,
  config: RendererConfig,
): Promise<MapRenderer> {
  // --- Cria a aplicação ---
  const app = new Application();
  await app.init({
    canvas,
    background: config.backgroundColor,
    antialias: false,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  // --- Escala do palco (INTEIRA) ---
  const stage = new Container();
  stage.scale.set(config.stageScale);
  app.stage.addChild(stage);

  // --- Offset da câmara ---
  stage.x = config.cameraOffset.x;
  stage.y = config.cameraOffset.y;

  // --- Culling ---
  const cullRect = new Rectangle(
    -config.cameraOffset.x / config.stageScale,
    -config.cameraOffset.y / config.stageScale,
    app.canvas.width / config.stageScale,
    app.canvas.height / config.stageScale,
  );
  stage.cullArea = cullRect;
  stage.cullable = true;

  // --- Pool de sprites ---
  const spritePool: Sprite[] = [];
  let usedSpriteCount = 0;

  function acquireSprite(): Sprite {
    if (usedSpriteCount < spritePool.length) {
      const sprite = spritePool[usedSpriteCount]!;
      sprite.visible = true;
      usedSpriteCount++;
      return sprite;
    }
    const sprite = new Sprite();
    spritePool.push(sprite);
    stage.addChild(sprite);
    usedSpriteCount++;
    return sprite;
  }

  function releaseAllSprites(): void {
    for (let i = usedSpriteCount; i < spritePool.length; i++) {
      spritePool[i]!.visible = false;
    }
    usedSpriteCount = 0;
  }

  // --- Cache de texturas de cor ---
  const textureCache = new Map<string, Texture>();

  function getColorTexture(color: number): Texture {
    const key = `color_${color.toString(16).padStart(6, '0')}`;
    let tex = textureCache.get(key);
    if (!tex) {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      ctx.fillRect(0, 0, 1, 1);
      tex = Texture.from(c);
      // scaleMode 'nearest' (ANTES de usar)
      tex.source.scaleMode = 'nearest';
      textureCache.set(key, tex);
    }
    return tex;
  }

  // --- Mapa de cores por tipo de bloco ---
  const BLOCK_COLORS: Record<string, number> = {
    grass: 0x4caf50,
    dirt: 0x8d6e63,
    stone: 0x78909c,
    sand: 0xf4d03f,
    water: 0x3498db,
    wood: 0xa0522d,
    default: 0x888888,
  };

  function blockColor(type: string): number {
    return BLOCK_COLORS[type] ?? BLOCK_COLORS.default!;
  }

  // ------------------------------------------------------------------
  // render
  // ------------------------------------------------------------------

  const render = (_map: MapData): void => {
    releaseAllSprites();

    // Recolhe todos os itens de profundidade
    const items: (DepthItem & { blockType?: string; edgeType?: string })[] = [];

    // --- Blocos ---
    const blocks = _map.blocks;
    for (const [key, runs] of Object.entries(blocks)) {
      const [xs, ys] = key.split(':');
      const x = Number(xs!);
      const y = Number(ys!);
      if (Number.isNaN(x) || Number.isNaN(y)) continue;

      let z = 0;
      for (const run of runs) {
        if (run.block !== '') {
          for (let i = 0; i < run.count; i++) {
            items.push({
              kind: 'cell',
              x,
              y,
              z: z + i,
              blockType: run.block,
            });
          }
        }
        z += run.count;
      }
    }

    // --- Arestas ---
    for (const edge of _map.edges) {
      items.push({
        kind: 'edge',
        x: edge.x,
        y: edge.y,
        z: edge.z,
        lado: edge.lado,
        edgeType: edge.tipo,
      });
    }

    // --- Ordena por profundidade (F2-03) ---
    sortByDepth(items);

    // --- Desenha ---
    const geom = config.geometry;

    for (const item of items) {
      const screen = worldToScreen(item.x, item.y, item.z, geom);
      const sprite = acquireSprite();

      if (item.kind === 'cell') {
        const color = blockColor(item.blockType ?? 'default');
        sprite.texture = getColorTexture(color);
        sprite.width = geom.tileWidth;
        sprite.height = geom.tileHeight;
        sprite.x = screen.sx - geom.tileWidth / 2;
        sprite.y = screen.sy;
        sprite.alpha = 1;
      } else {
        sprite.texture = getColorTexture(0xffffff);
        sprite.width = geom.tileWidth;
        sprite.height = 2;
        sprite.x = screen.sx - geom.tileWidth / 2;
        sprite.y = screen.sy;
        sprite.alpha = 0.5;
      }
    }

    // --- Culling update ---
    const scale = config.stageScale;
    cullRect.x = -config.cameraOffset.x / scale;
    cullRect.y = -config.cameraOffset.y / scale;
    cullRect.width = app.canvas.width / scale;
    cullRect.height = app.canvas.height / scale;
    stage.cullArea = cullRect;
  };

  // ------------------------------------------------------------------
  // destroy
  // ------------------------------------------------------------------

  const destroy = (): void => {
    for (const tex of textureCache.values()) {
      tex.destroy();
    }
    textureCache.clear();

    for (const sprite of spritePool) {
      sprite.destroy();
    }
    spritePool.length = 0;

    app.destroy(true, {
      children: true,
      texture: true,
      textureSource: true,
    });
  };

  return {
    stage,
    app,
    render,
    destroy,
  };
}
