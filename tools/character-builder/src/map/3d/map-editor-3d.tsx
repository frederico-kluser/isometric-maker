/**
 * Editor de mapa 3D — Three.js.
 *
 * Segunda versão do map builder, usando Three.js com raycasting real
 * para colocação de blocos estilo Minecraft (clique na face do cubo
 * define onde o novo bloco é colocado).
 *
 * ## O que é igual ao editor 2D
 *
 * - Estado do mapa: `map-state.ts` (RLE, undo/redo)
 * - Paleta: `blocks-api.ts`
 * - Rotação: `iso-core/rotation.ts` (4 vistas discretas)
 * - UI: mesma barra de ferramentas, paleta lateral, status
 *
 * ## O que é diferente
 *
 * - Renderização: Three.js (cena 3D) em vez de PixiJS (sprites 2D)
 * - Picking: Raycaster (interseção de mesh) em vez de aritmética diagonal
 * - Câmera: OrthographicCamera 3D em vez de projeção 2:1
 * - Colocação: face normal → célula adjacente (Minecraft-style)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  Grid3x3Icon,
  HammerIcon,
  Layers2Icon,
  Maximize2Icon,
  PaintBucketIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  RedoIcon,
  RotateCwIcon,
  StepForwardIcon,
  Trash2Icon,
  UndoIcon,
  ZoomInIcon,
  ZoomOutIcon,
  CheckIcon,
  XIcon,
} from 'lucide-react';
import type { CollisionMap } from '../../../../../packages/iso-core/src/collision.ts';
import {
  createMovementState,
  DEFAULT_CONFIG,
  type MovementInput,
  type MovementState,
} from '../../../../../packages/iso-core/src/movement.ts';
import { stepWithMap } from '../../../../../packages/iso-core/src/simulate.ts';
import { visualOffsetY } from '../../../../../packages/iso-core/src/jump.ts';
import type { MapData } from '../../../../../packages/iso-core/src/map.ts';
import {
  ROTATION_LABELS,
  turn,
  type Rotation,
} from '../../../../../packages/iso-core/src/rotation.ts';
import { buildCollisionMap, spawnZAt } from '../collision-map.ts';
import {
  actionFor,
  directionNameFor,
  frameUrl,
  viewDirectionIndex,
  worldDirectionFromKeys,
  type ActorFrames,
  type HeldDirections,
} from '../actor.ts';
import type { Studio } from '../../../server/model.ts';
import { buildExport } from '../../../../../packages/iso-core/src/map-instances.ts';
import {
  pushPlayerOutOfCell,
  type PlayerCell,
} from '../../../../../packages/iso-core/src/collision-box.ts';
import {
  initBlockPhysics,
  resolveMapAfterSimulation,
  stepBlockPhysics,
  DEFAULT_BLOCK_PHYSICS_CONFIG,
  type BlockWorld,
  type FallingBlock,
} from '../../../../../packages/iso-core/src/block-physics.ts';
import {
  DEFAULT_BLOCKS,
  makeCatalog,
  type BlockCatalog,
} from '../../../../../packages/iso-core/src/block-catalog.ts';
import {
  pick3d,
  pickColumnTop as pickColumnTopRaycaster,
  type Pick3DCell,
  type Pick3DResult,
} from './pick3d-raycaster.ts';
import {
  createIsoScene3D,
  spawnParticles,
  normalizeWheel,
  clampZoom,
  type IsoScene3D,
} from './scene3d.ts';
import { canonicalSpriteUrl } from './cube3d.ts';
import type { BlockDef } from './block-def.ts';
import {
  canRedo,
  canUndo,
  columnHeight as mapColumnHeight,
  countBlocks,
  initHistory,
  occupiedCells,
  paintBlock,
  placeBlock,
  pushHistory,
  redo,
  removeBlock,
  starterMap,
  undo,
  type History,
} from '../editor/map-state.ts';
import { FALLBACK_BLOCKS, loadPalette } from '../editor/blocks-api.ts';
import { BackToHome } from '../../app/home/back-to-home.tsx';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  SegmentedToggle,
  SegmentedToggleOption,
} from '@/components/motion-ui/segmented-toggle';
import { Skeleton } from '@/components/motion-ui/skeleton';
import { HoldToConfirmButton } from '@/components/motion-ui/hold-to-confirm';
import { ToastStack, Toast } from '@/components/motion-ui/toast-stack';
import { useMessages } from '../editor/toast-messages.ts';
import { editor as T } from '../strings.ts';

const ROTATIONS = [0, 1, 2, 3] as const;

/**
 * Quanto um clique no botão de zoom multiplica o zoom.
 *
 * Multiplicativo, e não aditivo, pelo mesmo motivo da roda: passo fixo é enorme
 * perto do mínimo e imperceptível perto do máximo.
 */
const ZOOM_BUTTON_FACTOR = 1.35;

/**
 * Duas leituras de picking são iguais?
 *
 * Existe para NÃO chamar `setPickState` a cada `pointermove`. O ponteiro
 * dispara dezenas de eventos por segundo, e quase todos caem na mesma célula;
 * sem esta comparação cada um deles reconciliava a árvore React inteira e
 * disparava um desenho. Comparar três inteiros é o que separa "o editor
 * engasga ao mover o mouse" de "o editor não faz nada quando nada mudou".
 */
function samePick(a: Pick3DResult | null, b: Pick3DResult | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.hitFace !== b.hitFace) return false;
  if (
    a.placement.x !== b.placement.x ||
    a.placement.y !== b.placement.y ||
    a.placement.z !== b.placement.z
  ) {
    return false;
  }
  if (a.hit === null || b.hit === null) return a.hit === b.hit;
  return (
    a.hit.x === b.hit.x &&
    a.hit.y === b.hit.y &&
    a.hit.z === b.hit.z &&
    a.hit.block === b.hit.block
  );
}

const TOOLS = ['empilhar', 'colocar', 'pintar', 'remover'] as const;
type Tool = (typeof TOOLS)[number];

const TOOL_ICON: Record<Tool, typeof HammerIcon> = {
  empilhar: Layers2Icon,
  colocar: HammerIcon,
  pintar: PaintBucketIcon,
  remover: Trash2Icon,
};

export function MapEditor3D() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scene3dRef = useRef<IsoScene3D | null>(null);

  const [blocks, setBlocks] = useState<readonly BlockDef[]>(FALLBACK_BLOCKS);
  const [selectedBlock, setSelectedBlock] = useState<string>(FALLBACK_BLOCKS[0]!.id);
  const [paletteLoading, setPaletteLoading] = useState(true);
  const [generatedCount, setGeneratedCount] = useState(0);
  const catalogRef = useRef<BlockCatalog>(makeCatalog(DEFAULT_BLOCKS));

  const [tool, setTool] = useState<Tool>('empilhar');
  const [history, setHistory] = useState<History>(() =>
    initHistory(starterMap(FALLBACK_BLOCKS[0]!.id)),
  );
  const [rotation, setRotation] = useState<Rotation>(0);
  const [zoom, setZoom] = useState<number>(2);
  const [pickState, setPickState] = useState<Pick3DResult | null>(null);
  const [ready, setReady] = useState(false);
  const toasts = useMessages();

  /**
   * Personagem de teste — o modo teste escreve aqui, e colocar um bloco sólido
   * sobre ele empurra-o para fora (push-out), em vez de o deixar dentro da
   * pedra. Nada lê a posição ainda; o estado existe para o push-out ter dados.
   */
  const [, setTestPlayer] = useState<PlayerCell | null>(null);
  const lastPlayerCellRef = useRef<PlayerCell | null>(null);

  // Modo do editor: 'editar' edita o mapa; 'testar' roda o personagem com WASD;
  // 'simular' roda a simulação de física de blocos (queda por falta de suporte).
  const [mode, setMode] = useState<'editar' | 'testar' | 'simular'>('editar');
  const [actorState, setActorState] = useState<MovementState | null>(null);

  // ─── simulação de física de blocos ───
  // Estado da simulação: 'running' | 'paused'.
  const [simState, setSimState] = useState<'running' | 'paused'>('running');
  // Mapa original (snapshot ao entrar no modo simular) — para "Descartar".
  const simOriginalMapRef = useRef<MapData | null>(null);
  // Blocos que estão a cair neste instante.
  const [simFalling, setSimFalling] = useState<readonly FallingBlock[]>([]);
  // Blocos que aterraram (acumulado).
  const simLandedRef = useRef<FallingBlock[]>([]);
  // Acumulador de passos desde a última descida.
  const simAccumulatorRef = useRef(0);
  // Referência ao mapa de colisão da simulação.
  const simCollisionRef = useRef<CollisionMap | null>(null);
  // Blocos ocupados do mundo (snapshot do MapData ao entrar).
  const simOccupiedRef = useRef<readonly { x: number; y: number; z: number; blockType: string }[]>([]);
  // rAF ref da simulação (separado do modo teste).
  const simRafRef = useRef<number | null>(null);
  // Último timestamp do laço de simulação.
  const simLastTimeRef = useRef(0);

  // Refs do ticker: o laço roda fora do React (requestAnimationFrame) e lê o
  // valor atual destes refs — reconciliar a árvore 60×/s por causa da posição
  // do personagem seria pagar caro por um estado que só o desenho consome.
  const actorRef = useRef<MovementState | null>(null);
  const actorFramesRef = useRef<ActorFrames | null>(null);
  const actorBaseRef = useRef<Record<string, readonly string[]> | null>(null);
  const collisionRef = useRef<CollisionMap | null>(null);
  const heldRef = useRef<HeldDirections>({
    up: false,
    down: false,
    left: false,
    right: false,
  });
  const jumpRef = useRef(false);
  const crouchRef = useRef(false);
  const walkRef = useRef(false);
  const testTickRef = useRef(0);
  const lastTickTimeRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  /** true entre o clique em Testar e o fim do fetch — evita dois laços. */
  const enteringTestRef = useRef(false);

  // Pinça (trackpad/touch): dois dedos, distância inicial → fator de zoom.
  const pinchRef = useRef<{
    initialDist: number;
    initialZoom: number;
    centerX: number;
    centerY: number;
  } | null>(null);

  // Gesture events do Safari (gesturestart/gesturechange/gestureend).
  const gestureRef = useRef<{ initialZoom: number } | null>(null);

  const map = history.present;

  // Refs espelhando o estado para os handlers de ponteiro
  const stateRef = useRef({ map, rotation, tool, selectedBlock, zoom, mode });
  stateRef.current = { map, rotation, tool, selectedBlock, zoom, mode };

  // ---------------------------------------------------------------- paleta

  useEffect(() => {
    let cancelled = false;
    void loadPalette().then((loaded) => {
      if (cancelled) return;
      setBlocks(loaded.blocks);
      catalogRef.current = loaded.catalog;
      setGeneratedCount(loaded.generatedCount);
      setPaletteLoading(false);
      const first = loaded.blocks[0];
      if (first) setSelectedBlock(first.id);
      if (loaded.warning) toasts.push(loaded.warning);
      else if (loaded.generatedCount > 0) {
        toasts.push(T.toast.paletaCarregada(loaded.generatedCount));
      } else toasts.push(T.toast.semBlocosGerados);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- cena 3D

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    let disposed = false;
    let scene3d: IsoScene3D | null = null;

    void createIsoScene3D(canvas).then((created) => {
      if (disposed) {
        created.destroy();
        return;
      }
      scene3d = created;
      scene3dRef.current = created;
      // A HUD do zoom acompanha a cena, não o contrário: a roda escreve no
      // alvo de zoom da câmera imediatamente e só depois avisa o React. Assim
      // um giro de roda nunca espera por uma reconciliação para aparecer.
      created.onZoomChange(setZoom);
      created.resize(host.clientWidth, host.clientHeight);
      setZoom(created.zoomTarget());
      setReady(true);
    });

    return () => {
      disposed = true;
      scene3dRef.current = null;
      scene3d?.destroy();
    };
  }, []);

  // Paleta nova → materiais novos
  useEffect(() => {
    const s3d = scene3dRef.current;
    if (!s3d || !ready) return;
    void s3d.setPalette(blocks).then(() => {
      s3d.render({
        map: stateRef.current.map,
        rotation: stateRef.current.rotation,
        preview: null,
        highlight: null,
      });
    });
  }, [blocks, ready]);

  // Redimensionamento
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => {
      scene3dRef.current?.resize(host.clientWidth, host.clientHeight);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // Desenho: uma chamada por mudança de estado
  useEffect(() => {
    const s3d = scene3dRef.current;
    if (!s3d || !ready) return;
    // No modo teste e simular o ticker desenha a cada quadro — este efeito não compete.
    if (mode === 'testar' || mode === 'simular') return;

    let previewCell: Pick3DCell | null = null;
    let previewInvalid = false;
    if (pickState) {
      if (tool === 'remover') {
        previewCell = pickState.hit ?? null;
        previewInvalid = true;
      } else if (tool === 'pintar') {
        previewCell = pickState.hit ?? pickState.placement;
      } else {
        previewCell = pickState.placement;
      }
    }

    s3d.render({
      map,
      rotation,
      preview: previewCell,
      previewInvalid,
      highlight: pickState?.hit ?? null,
    });
    // Nota: a rotação da câmera é controlada por animateRotation/rotateTo,
    // não por este efeito — senão o render queimaria a animação em curso.
  }, [map, rotation, pickState, tool, ready, mode]);

  // O CollisionMap é um índice do documento: reconstruir quando o mapa muda
  // durante o teste (o push-out e a física precisam do índice novo).
  useEffect(() => {
    if (mode !== 'testar') return;
    collisionRef.current = buildCollisionMap(map);
  }, [map, mode]);

  // ---------------------------------------------------------------- ponteiro

  const pickAt = useCallback(
    (clientX: number, clientY: number): Pick3DResult | null => {
      const canvas = canvasRef.current;
      const s3d = scene3dRef.current;
      if (!canvas || !s3d) return null;
      // DDA opera direto sobre MapData — não precisa de meshes.
      const s = stateRef.current;
      const map = s.map;

      if (s.tool === 'empilhar') {
        return pickColumnTopRaycaster(
          clientX,
          clientY,
          canvas,
          s3d.camera,
          map,
          (x: number, y: number) => mapColumnHeight(map, x, y),
        );
      }
      return pick3d(clientX, clientY, canvas, s3d.camera, map);
    },
    [],
  );

  const applyTool = useCallback((result: Pick3DResult) => {
    const { tool: t, selectedBlock: block } = stateRef.current;
    const current = stateRef.current.map;
    let next: MapData = current;
    // Célula onde a operação mexeu — as partículas explodem nela (R9).
    let affected: Pick3DCell | null = null;
    if (t === 'remover') {
      if (result.hit) {
        next = removeBlock(current, result.hit);
        affected = result.hit;
      }
    } else if (t === 'pintar') {
      if (result.hit) {
        next = paintBlock(current, result.hit, block);
        affected = result.hit;
      } else {
        next = placeBlock(current, result.placement, block);
        affected = result.placement;
      }
    } else if (t === 'colocar') {
      // Colocar: usa a posição adjacente exata do raycaster (face normal)
      // NÃO força o topo da coluna — o bloco vai para a face onde o mouse bateu
      next = placeBlock(current, result.placement, block);
      affected = result.placement;
    } else {
      // Empilhar: o pickColumnTopRaycaster já resolveu o placement pela face
      // atingida — face de cima → topo da coluna; face lateral → célula
      // adjacente no mesmo nível (Minecraft-style). Aqui só aplicamos.
      next = placeBlock(current, result.placement, block);
      affected = result.placement;
    }
    setHistory((h) => pushHistory(h, next));

    // Partículas no bloco colocado/removido (R9). O guard `next !== current`
    // é o sinal de mudança real: placeBlock/removeBlock devolvem a MESMA
    // referência num no-op, e sem isso cada clique sobre célula já ocupada
    // explodiria partículas em vão (e o laço rAF das partículas é
    // render-on-demand — o custo extra só deve existir quando algo mudou).
    if (next !== current && affected) {
      const s3d = scene3dRef.current;
      if (s3d) {
        // Mapa x,y,z → mundo 3D: X = x, Y = z (altura) + meio cubo (centro
        // do bloco), Z = y — a mesma convenção do render() em scene3d.ts.
        spawnParticles(
          s3d.scene,
          new THREE.Vector3(affected.x, affected.z + 0.5, affected.y),
        );
      }
    }

    // Push-out: colocar (ou pintar de sólido) um bloco sobre o personagem de
    // teste empurra-o para fora — colocar bloco sobre personagem nunca o
    // deixa dentro da pedra. Células de água/lava/folhagem não são sólidas e
    // não empurram (o `solidAt` honra o catálogo).
    const cell: Pick3DCell | null =
      t === 'remover'
        ? null
        : t === 'pintar' && result.hit
          ? result.hit
          : result.placement;
    if (cell) {
      setTestPlayer((p) => {
        if (!p) return p;
        const pushed = pushPlayerOutOfCell(next, catalogRef.current, p, cell);
        return pushed ?? p;
      });
    }
  }, []);

  const dragging = useRef(false);
  const panning = useRef<{ x: number; y: number } | null>(null);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (panning.current) {
        const s3d = scene3dRef.current;
        if (!s3d) return;
        const host = hostRef.current;
        if (!host) return;
        const dx = e.clientX - panning.current.x;
        const dy = e.clientY - panning.current.y;
        panning.current = { x: e.clientX, y: e.clientY };
        s3d.pan(-dx, dy, host.clientWidth, host.clientHeight);
        return;
      }
      // No modo teste e simular o ponteiro não edita — só o pan (já tratado acima).
      if (stateRef.current.mode === 'testar' || stateRef.current.mode === 'simular') return;
      const result = pickAt(e.clientX, e.clientY);
      setPickState((prev) => (samePick(prev, result) ? prev : result));
      if (dragging.current && result) applyTool(result);
    },
    [applyTool, pickAt],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      // No modo teste e simular o ponteiro não edita: botão esquerdo e do meio pan.
      if (stateRef.current.mode === 'testar' || stateRef.current.mode === 'simular') {
        if (e.button === 0 || e.button === 1) {
          panning.current = { x: e.clientX, y: e.clientY };
        }
        return;
      }
      // Botão do meio ou shift+arrasto = pan
      if (e.button === 1 || e.shiftKey) {
        panning.current = { x: e.clientX, y: e.clientY };
        return;
      }
      if (e.button !== 0) return;
      dragging.current = true;
      const result = pickAt(e.clientX, e.clientY);
      if (result) applyTool(result);
    },
    [applyTool, pickAt],
  );

  const endPointer = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      dragging.current = false;
      panning.current = null;
    },
    [],
  );

  /**
   * Roda do mouse → zoom.
   *
   * Sem throttle e sem degraus. O que havia antes era um throttle de 80 ms
   * sobre quatro passos inteiros, e o passo só aparecia na tela no
   * `pointermove` seguinte, porque `zoom()` mudava a matriz e não desenhava.
   * Agora cada evento empurra o ALVO de zoom; a cena persegue esse alvo com
   * amortecimento no seu próprio quadro. Eventos demais num quadro só deixam o
   * alvo mais longe — nunca enfileiram desenhos.
   *
   * `deltaMode` importa: Firefox manda `deltaY` em LINHAS (modo 1) e não em
   * pixels, e sem a conversão a roda ficaria ~16× mais lenta lá.
   */
  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    const s3d = scene3dRef.current;
    if (!s3d) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    s3d.wheelZoom(normalizeWheel(e.deltaY, e.deltaMode), ndcX, ndcY);
  }, []);

  // ---------------------------------------------------------------- pinça

  const onTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2) {
      const t0 = e.touches[0]!;
      const t1 = e.touches[1]!;
      const dx = t1.clientX - t0.clientX;
      const dy = t1.clientY - t0.clientY;
      pinchRef.current = {
        initialDist: Math.hypot(dx, dy),
        initialZoom: scene3dRef.current?.zoomTarget() ?? 2,
        centerX: (t0.clientX + t1.clientX) / 2,
        centerY: (t0.clientY + t1.clientY) / 2,
      };
    } else {
      pinchRef.current = null;
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    const pinch = pinchRef.current;
    if (!pinch || e.touches.length !== 2) return;
    const s3d = scene3dRef.current;
    if (!s3d) return;

    const t0 = e.touches[0]!;
    const t1 = e.touches[1]!;
    const dx = t1.clientX - t0.clientX;
    const dy = t1.clientY - t0.clientY;
    const dist = Math.hypot(dx, dy);

    // Threshold de 5px para evitar zoom acidental
    if (dist < 5 || pinch.initialDist < 5) return;

    const factor = dist / pinch.initialDist;
    const newZoom = clampZoom(pinch.initialZoom * factor);

    const rect = e.currentTarget.getBoundingClientRect();
    const ndcX = ((pinch.centerX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((pinch.centerY - rect.top) / rect.height) * 2 + 1;

    s3d.setZoomAnchored(newZoom, ndcX, ndcY);
  }, []);

  const onTouchEnd = useCallback(() => {
    pinchRef.current = null;
  }, []);

  // ---------------------------------------------------------------- gesture (Safari)

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureRef.current = {
        initialZoom: scene3dRef.current?.zoomTarget() ?? 2,
      };
    };

    const onGestureChange = (e: Event) => {
      const ge = e as { scale?: number };
      if (ge.scale === undefined || !gestureRef.current) return;
      e.preventDefault();
      const s3d = scene3dRef.current;
      if (!s3d) return;
      const newZoom = clampZoom(gestureRef.current.initialZoom * ge.scale);
      // Safari não expõe o centro do gesto — ancora no centro da tela.
      s3d.setZoomAnchored(newZoom, 0, 0);
    };

    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureRef.current = null;
    };

    canvas.addEventListener('gesturestart', onGestureStart);
    canvas.addEventListener('gesturechange', onGestureChange);
    canvas.addEventListener('gestureend', onGestureEnd);
    return () => {
      canvas.removeEventListener('gesturestart', onGestureStart);
      canvas.removeEventListener('gesturechange', onGestureChange);
      canvas.removeEventListener('gestureend', onGestureEnd);
    };
  }, []);

  // ---------------------------------------------------------------- rotação

  const rotateTo = useCallback((rot: Rotation) => {
    setRotation(rot);
    setPickState(null);
    scene3dRef.current?.animateRotation(rot);
  }, []);

  const zoomBy = useCallback((direction: 1 | -1) => {
    scene3dRef.current?.zoomByFactor(
      direction > 0 ? ZOOM_BUTTON_FACTOR : 1 / ZOOM_BUTTON_FACTOR,
    );
  }, []);

  const zoomToFitMap = useCallback(() => {
    const s3d = scene3dRef.current;
    const host = hostRef.current;
    if (!s3d || !host) return;
    // maxHeight: altura máxima dos blocos. A cena rastreia do syncBlocks.
    // Usamos um valor seguro; a cena vai usar lastMaxHeight internamente.
    // Como o método zoomToFit pede maxHeight explicitamente, calculamos
    // do mapa corrente.
    const currentMap = stateRef.current.map;
    let maxH = 0;
    for (const [, runs] of Object.entries(currentMap.blocks)) {
      let top = 0;
      for (const run of runs) top += run.count;
      if (top > maxH) maxH = top;
    }
    s3d.zoomToFit(maxH, host.clientWidth, host.clientHeight);
  }, []);

  // ---------------------------------------------------------------- modo teste

  const enterTestMode = useCallback(async () => {
    // Clique duplo antes do fetch terminar criaria dois laços rAF: o segundo
    // sobrescreveria o frameId do primeiro e o exit não conseguiria cancelá-lo.
    if (enteringTestRef.current || rafRef.current !== null) return;
    enteringTestRef.current = true;
    try {
      const res = await fetch('/api/studio');
      if (!res.ok) throw new Error(`${res.status}`);
      const studio: Studio = await res.json();
      const character = studio.characters[0];
      if (!character) {
        toasts.push(T.modo.semPersonagem);
        return;
      }

      // Monta ActorFrames a partir das células do estúdio: cada pose embutida
      // é uma ação (parado, caminhando, ...) com quadros por direção.
      const frames: Record<string, Readonly<Record<string, readonly string[]>>> = {};
      for (const pose of studio.poses) {
        const cell = studio.cells[`${character.id}::${pose.id}`];
        if (cell?.frames) frames[pose.id] = cell.frames;
      }
      // Direções base: as 8 estáticas que sempre existem depois do wizard.
      const baseKey = `${character.id}::__directions8__`;
      const baseCell = studio.cells[baseKey];
      const baseDirs: Record<string, readonly string[]> =
        (baseCell?.frames as Record<string, readonly string[]> | undefined) ?? {};

      actorFramesRef.current = frames;
      actorBaseRef.current = Object.keys(baseDirs).length > 0 ? baseDirs : null;

      const colisao = buildCollisionMap(stateRef.current.map);
      collisionRef.current = colisao;

      const z = spawnZAt(colisao, 5, 5);
      const initial = createMovementState(5, 5, z);
      actorRef.current = initial;
      setActorState(initial);
      setTestPlayer({ x: 5, y: 5, z });
      lastPlayerCellRef.current = { x: 5, y: 5, z };
      testTickRef.current = 0;
      lastTickTimeRef.current = performance.now();
      setPickState(null);

      // Laço por requestAnimationFrame: o editor 3D não tem ticker próprio
      // (o 2D usava o do PixiJS). O laço lê refs e escreve só na cena — o
      // React recebe a posição apenas quando a célula do personagem muda.
      const tick = (now: number): void => {
        const s3d = scene3dRef.current;
        const col = collisionRef.current;
        const actor = actorRef.current;
        const framesNow = actorFramesRef.current;
        if (!s3d || !col || !actor || !framesNow) return;

        // dt clampado: voltar de uma aba inativa daria um dt enorme e o
        // motor processaria centenas de passos de uma vez.
        const dt = Math.min((now - lastTickTimeRef.current) / 1000, 0.1);
        lastTickTimeRef.current = now;

        const held = heldRef.current;
        const dir = worldDirectionFromKeys(held, stateRef.current.rotation);
        const input: MovementInput = {
          dir,
          jump: jumpRef.current,
          stepUp: false,
          stepDown: false,
          ...(walkRef.current ? { walk: true as const } : {}),
          ...(crouchRef.current ? { crouch: true as const } : {}),
        };
        const next = stepWithMap(actor, input, dt, DEFAULT_CONFIG, col);
        actorRef.current = next;

        // Push-out (bloco colocado sobre o personagem) só precisa do React
        // quando a célula muda — reconciliar a árvore 60×/s seria jogado fora.
        const cell: PlayerCell = {
          x: Math.floor(next.pos.x),
          y: Math.floor(next.pos.y),
          z: next.z,
        };
        const prev = lastPlayerCellRef.current;
        if (!prev || prev.x !== cell.x || prev.y !== cell.y || prev.z !== cell.z) {
          lastPlayerCellRef.current = cell;
          setTestPlayer(cell);
          setActorState(next);
        }

        const action = actionFor(next);
        const vIdx = viewDirectionIndex(next.facing, stateRef.current.rotation);
        const vName = directionNameFor(vIdx);
        const url = frameUrl(
          framesNow,
          actorBaseRef.current ?? undefined,
          action,
          vName,
          testTickRef.current,
        );
        testTickRef.current += 1;

        if (url) {
          // y dos pés = nível z do iso-core + arco visual do pulo (o sinal
          // inverte: visualOffsetY é em coordenada de tela, Y cresce para
          // baixo lá e para cima aqui).
          // A sombra não sobe com o sprite: floorY é o z do iso-core SEM o
          // offset do pulo, e directionIndex é a direção de TELA já
          // reindexada pela rotação da câmera (vIdx).
          s3d.render({
            map: stateRef.current.map,
            rotation: stateRef.current.rotation,
            preview: null,
            highlight: null,
            actor: {
              url,
              x: next.pos.x,
              y: next.z - visualOffsetY(next.jump.progress, 1),
              z: next.pos.y,
              directionIndex: vIdx,
              jumpProgress: next.jump.progress,
              floorY: next.z,
            },
          });
        }
        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
      setMode('testar');
    } catch (err) {
      toasts.push(T.modo.erroCarregar);
      // eslint-disable-next-line no-console
      console.error('[test-mode] erro ao carregar personagem:', err);
    } finally {
      enteringTestRef.current = false;
    }
  }, [toasts]);

  const exitTestMode = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    actorRef.current = null;
    collisionRef.current = null;
    actorFramesRef.current = null;
    actorBaseRef.current = null;
    heldRef.current = { up: false, down: false, left: false, right: false };
    jumpRef.current = false;
    crouchRef.current = false;
    walkRef.current = false;
    lastPlayerCellRef.current = null;
    setTestPlayer(null);
    setActorState(null);
    setMode('editar');
    // Redesenha sem o personagem.
    scene3dRef.current?.render({
      map: stateRef.current.map,
      rotation: stateRef.current.rotation,
      preview: null,
      highlight: null,
      actor: null,
    });
  }, []);

  // ──────────────────────────────────────────────────────────────── modo simular

  /**
   * Constrói um {@link BlockWorld} a partir do mapa actual.
   *
   * Extrai todas as células ocupadas e o índice de colisão — o que a função
   * {@link stepBlockPhysics} precisa para avançar a simulação.
   */
  const buildBlockWorld = useCallback((map: MapData): BlockWorld => {
    const colisao = buildCollisionMap(map);
    const occupied: { x: number; y: number; z: number; blockType: string }[] = [];
    for (const [chave, runs] of Object.entries(map.blocks)) {
      const [xs, ys] = chave.split(':');
      const x = Number(xs);
      const y = Number(ys);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      let z = 0;
      for (const run of runs) {
        if (run.block !== '') {
          for (let i = 0; i < run.count; i += 1) {
            occupied.push({ x, y, z: z + i, blockType: run.block });
          }
        }
        z += run.count;
      }
    }
    return { occupied, collisionMap: colisao };
  }, []);

  /** Entra no modo de simulação de física de blocos. */
  const enterSimulateMode = useCallback(() => {
    const currentMap = stateRef.current.map;
    simOriginalMapRef.current = currentMap;
    const world = buildBlockWorld(currentMap);
    simOccupiedRef.current = world.occupied;
    simCollisionRef.current = world.collisionMap;
    simLandedRef.current = [];
    simAccumulatorRef.current = 0;

    const init = initBlockPhysics(world);
    setSimFalling(init.falling);
    setSimState('running');
    setMode('simular');
    setPickState(null);
    simLastTimeRef.current = performance.now();

    // Laço de simulação: tick a cada 100ms (~10 quadros/s para visualização).
    const tick = (): void => {
      if (simRafRef.current === null) return; // cancelado
      simRafRef.current = requestAnimationFrame(tick);

      if (simStateRef.current !== 'running') return;

      const now = performance.now();
      const dt = now - simLastTimeRef.current;
      simLastTimeRef.current = now;
      // Tick a cada ~100ms. Acumula passos se o delta for maior.
      const tickInterval = 100; // ms entre passos de simulação
      const stepsToRun = Math.min(Math.floor(dt / tickInterval), 10); // cap de segurança
      // Se dt < tickInterval, não avança — espera acumular.
      if (stepsToRun === 0) return;

      const world = { occupied: simOccupiedRef.current, collisionMap: simCollisionRef.current! };
      let falling: readonly FallingBlock[] = simFallingRef.current;
      let acc = simAccumulatorRef.current;
      let landed = simLandedRef.current;

      for (let i = 0; i < stepsToRun; i++) {
        acc = (acc + 1) % DEFAULT_BLOCK_PHYSICS_CONFIG.fallInterval;
        const result = stepBlockPhysics(
          world,
          falling,
          acc === 0 ? DEFAULT_BLOCK_PHYSICS_CONFIG.fallInterval - 1 : acc - 1,
          null,
          DEFAULT_BLOCK_PHYSICS_CONFIG,
        );
        falling = result.falling;
        landed = [...landed, ...result.landed];
        if (falling.length === 0) {
          setSimState('paused');
          break;
        }
      }

      simFallingRef.current = falling;
      simLandedRef.current = landed;
      simAccumulatorRef.current = acc;
      setSimFalling(falling);

      // Redesenha a cena com os blocos em queda visíveis.
      const s3d = scene3dRef.current;
      if (s3d) {
        // Constrói um MapData virtual com as posições atuais dos blocos.
        const resolved = resolveMapAfterSimulation(world, falling, landed);
        const virtualBlocks: Record<string, typeof currentMap.blocks[string]> = {};
        for (const cell of resolved) {
          const key = `${cell.x}:${cell.y}`;
          if (!virtualBlocks[key]) virtualBlocks[key] = [];
          (virtualBlocks[key] as { block: string; count: number }[]).push({ block: cell.blockType, count: 1 });
        }
        // Simplificação: usa o RLE real para os blocos que não caíram e
        // sobrepõe as posições dos blocos que estão a cair/aterraram.
        // Na prática, reconstruímos o mapa virtual para renderização.
        const virtualMap: MapData = { blocks: {}, edges: currentMap.edges };
        // Agrupa por coluna e ordena por z.
        const byColumn = new Map<string, { x: number; y: number; cells: { z: number; blockType: string }[] }>();
        for (const cell of resolved) {
          const cKey = `${cell.x}:${cell.y}`;
          let col = byColumn.get(cKey);
          if (!col) { col = { x: cell.x, y: cell.y, cells: [] }; byColumn.set(cKey, col); }
          col.cells.push({ z: cell.z, blockType: cell.blockType });
        }
        for (const col of byColumn.values()) {
          col.cells.sort((a, b) => a.z - b.z);
          const runs: { block: string; count: number }[] = [];
          for (const c of col.cells) {
            // Preenche gaps com ar
            while (runs.length > 0 ? (runs.reduce((s, r) => s + r.count, 0)) < c.z : c.z > 0) {
              const currentZ = runs.reduce((s, r) => s + r.count, 0);
              if (currentZ < c.z) runs.push({ block: '', count: c.z - currentZ });
              else break;
            }
            runs.push({ block: c.blockType, count: 1 });
          }
          virtualMap.blocks[`${col.x}:${col.y}`] = runs;
        }

        s3d.render({
          map: virtualMap,
          rotation: stateRef.current.rotation,
          preview: null,
          highlight: null,
        });
      }
    };

    simRafRef.current = requestAnimationFrame(tick);
  }, [buildBlockWorld]);

  const exitSimulateMode = useCallback((apply: boolean) => {
    if (simRafRef.current !== null) cancelAnimationFrame(simRafRef.current);
    simRafRef.current = null;

    if (apply) {
      // Aplica as mudanças: constrói um MapData com as posições finais dos
      // blocos (aterrados + ainda a cair).
      const world = { occupied: simOccupiedRef.current, collisionMap: simCollisionRef.current! };
      const resolved = resolveMapAfterSimulation(world, simFallingRef.current, simLandedRef.current);

      // Reconstrói o MapData a partir das posições resolvidas.
      const newBlocks: Record<string, MapData['blocks'][string]> = {};
      const byColumn = new Map<string, { z: number; blockType: string }[]>();
      for (const cell of resolved) {
        const cKey = `${cell.x}:${cell.y}`;
        let col = byColumn.get(cKey);
        if (!col) { col = []; byColumn.set(cKey, col); }
        col.push({ z: cell.z, blockType: cell.blockType });
      }
      for (const [key, cells] of byColumn) {
        cells.sort((a, b) => a.z - b.z);
        const runs: { block: string; count: number }[] = [];
        let currentZ = 0;
        for (const c of cells) {
          if (c.z < currentZ) continue; // bloco duplicado ou abaixo do anterior
          if (c.z > currentZ) {
            // Preenche gap com ar.
            // Para simplificar, não escrevemos ar no meio — só empilhamos.
          }
          runs.push({ block: c.blockType, count: 1 });
          currentZ = c.z + 1;
        }
        if (runs.length > 0) newBlocks[key] = runs;
      }

      const newMap: MapData = { blocks: newBlocks, edges: stateRef.current.map.edges };
      setHistory((h) => pushHistory(h, newMap));
    }

    // Limpa o estado da simulação.
    simFallingRef.current = [];
    simLandedRef.current = [];
    simOccupiedRef.current = [];
    simCollisionRef.current = null;
    simOriginalMapRef.current = null;
    setSimFalling([]);
    setMode('editar');

    // Redesenha o mapa original (ou aplicado).
    scene3dRef.current?.render({
      map: stateRef.current.map,
      rotation: stateRef.current.rotation,
      preview: null,
      highlight: null,
    });
  }, []);

  // Ref espelho do estado de simulação para o laço rAF ler sem reconciliação.
  const simStateRef = useRef(simState);
  simStateRef.current = simState;
  const simFallingRef = useRef<readonly FallingBlock[]>(simFalling);
  simFallingRef.current = simFalling;

  // Avança um passo na simulação.
  const simStep = useCallback(() => {
    const world = { occupied: simOccupiedRef.current, collisionMap: simCollisionRef.current! };
    let falling: readonly FallingBlock[] = simFallingRef.current;
    let acc = simAccumulatorRef.current;
    let landed = simLandedRef.current;

    acc = (acc + 1) % DEFAULT_BLOCK_PHYSICS_CONFIG.fallInterval;
    const result = stepBlockPhysics(
      world,
      falling,
      acc === 0 ? DEFAULT_BLOCK_PHYSICS_CONFIG.fallInterval - 1 : acc - 1,
      null,
      DEFAULT_BLOCK_PHYSICS_CONFIG,
    );
    falling = result.falling;
    landed = [...landed, ...result.landed];

    simFallingRef.current = falling;
    simLandedRef.current = landed;
    simAccumulatorRef.current = acc;
    setSimFalling(falling);

    if (falling.length === 0) setSimState('paused');
  }, []);

  // Os laços de teste e simulação não podem sobreviver ao desmonte do editor.
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (simRafRef.current !== null) cancelAnimationFrame(simRafRef.current);
      simRafRef.current = null;
    },
    [],
  );

  // Teclado: Esc sai do teste, R gira, Z/Y desfazem, 1-4 escolhem vista.
  // A rotação funciona nos dois modos; editar (desfazer/refazer) só no modo
  // de edição.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (e.key === 'Escape') {
        if (stateRef.current.mode === 'testar') {
          exitTestMode();
          return;
        }
        if (stateRef.current.mode === 'simular') {
          exitSimulateMode(false); // descarta mudanças
          return;
        }
      }
      if (e.key === 'r' || e.key === 'R') {
        rotateTo(turn(stateRef.current.rotation, e.shiftKey ? -1 : 1));
        return;
      }
      if (/^[1-4]$/.test(e.key)) {
        rotateTo((Number(e.key) - 1) as Rotation);
        return;
      }
      // Camera pan com setas (modo edição). 10% do viewport por passo.
      if (stateRef.current.mode === 'editar') {
        const s3d = scene3dRef.current;
        const host = hostRef.current;
        if (s3d && host) {
          const step = Math.min(host.clientWidth, host.clientHeight) * 0.1;
          switch (e.key) {
            case 'ArrowLeft':
              e.preventDefault();
              s3d.pan(step, 0, host.clientWidth, host.clientHeight);
              return;
            case 'ArrowRight':
              e.preventDefault();
              s3d.pan(-step, 0, host.clientWidth, host.clientHeight);
              return;
            case 'ArrowUp':
              e.preventDefault();
              s3d.pan(0, step, host.clientWidth, host.clientHeight);
              return;
            case 'ArrowDown':
              e.preventDefault();
              s3d.pan(0, -step, host.clientWidth, host.clientHeight);
              return;
          }
        }
      }
      if (stateRef.current.mode === 'testar' || stateRef.current.mode === 'simular') return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        setHistory((h) => (e.shiftKey ? redo(h) : undo(h)));
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        setHistory(redo);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rotateTo, exitTestMode]);

  // Teclas do personagem: WASD/setas + modificadores. Rastreia keydown/keyup
  // para movimento contínuo — keydown sozinho não sabe quando a tecla soltou.
  useEffect(() => {
    const updateHeld = (key: string, pressed: boolean): boolean => {
      switch (key) {
        case 'w': case 'W': case 'ArrowUp':
          heldRef.current = { ...heldRef.current, up: pressed }; return true;
        case 's': case 'S': case 'ArrowDown':
          heldRef.current = { ...heldRef.current, down: pressed }; return true;
        case 'a': case 'A': case 'ArrowLeft':
          heldRef.current = { ...heldRef.current, left: pressed }; return true;
        case 'd': case 'D': case 'ArrowRight':
          heldRef.current = { ...heldRef.current, right: pressed }; return true;
        case ' ': jumpRef.current = pressed; return true;
        case 'Control': crouchRef.current = pressed; return true;
        case 'Shift': walkRef.current = pressed; return true;
      }
      return false;
    };

    const onDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (updateHeld(e.key, true)) e.preventDefault();
    };
    const onUp = (e: KeyboardEvent): void => {
      updateHeld(e.key, false);
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  // ---------------------------------------------------------------- render

  const total = useMemo(() => countBlocks(map), [map]);
  const selected = blocks.find((b) => b.id === selectedBlock);

  const handleClear = useCallback(() => {
    setHistory((h) => pushHistory(h, { blocks: {}, edges: [] }));
    toasts.push(T.toast.mapaLimpo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleExport = useCallback(() => {
    const dados = buildExport(stateRef.current.map, catalogRef.current, {
      tileWidth: 48,
      tileHeight: 24,
      cubeHeight: 29,
    });
    const blob = new Blob([`${JSON.stringify(dados, null, 2)}\n`], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mapa.json';
    a.click();
    URL.revokeObjectURL(url);
    toasts.push(T.toast.exportado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-dvh w-full flex-col bg-background text-foreground">
      {/* ─────────────────── barra superior ─────────────────── */}
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2">
        <BackToHome />

        <div className="flex items-center gap-2">
          <Grid3x3Icon className="size-5 text-primary" />
          <h1 className="text-sm font-semibold">{T.titulo} 3D</h1>
        </div>

        <Separator orientation="vertical" className="h-6" />

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{T.camera.rotulo}</span>
          <SegmentedToggle
            value={String(rotation)}
            onChange={(v) => rotateTo(Number(v) as Rotation)}
            ariaLabel={T.camera.ariaLabel}
          >
            {ROTATIONS.map((r) => (
              <SegmentedToggleOption key={r} value={String(r)}>
                {ROTATION_LABELS[r]}
              </SegmentedToggleOption>
            ))}
          </SegmentedToggle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => rotateTo(turn(rotation, 1))}
            aria-label={T.camera.girar}
            title={T.camera.girarDica}
          >
            <RotateCwIcon className="size-4" />
          </Button>
        </div>

        <Separator orientation="vertical" className="h-6" />

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{T.ferramenta.rotulo}</span>
          <SegmentedToggle
            value={tool}
            onChange={(v) => setTool(v as Tool)}
            ariaLabel={T.ferramenta.ariaLabel}
          >
            {TOOLS.map((t) => {
              const Icon = TOOL_ICON[t];
              return (
                <SegmentedToggleOption key={t} value={t}>
                  <span className="flex items-center gap-1.5">
                    <Icon className="size-3.5" />
                    {T.ferramenta.nomes[t]}
                  </span>
                </SegmentedToggleOption>
              );
            })}
          </SegmentedToggle>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {mode === 'simular' ? (
            <>
              {/* Simulação: Play/Pause */}
              <Button
                variant="default"
                size="sm"
                onClick={() =>
                  setSimState((s) => {
                    const next = s === 'running' ? 'paused' : 'running';
                    if (next === 'running') simLastTimeRef.current = performance.now();
                    return next;
                  })
                }
                aria-label={simState === 'running' ? 'Pausar' : 'Continuar'}
              >
                {simState === 'running' ? (
                  <PauseIcon className="size-4" />
                ) : (
                  <PlayIcon className="size-4" />
                )}
                <span className="ml-1.5">
                  {simState === 'running' ? 'Pausar' : 'Continuar'}
                </span>
              </Button>
              {/* Simulação: Step */}
              <Button
                variant="outline"
                size="sm"
                onClick={simStep}
                aria-label="Avançar um passo"
              >
                <StepForwardIcon className="size-4" />
                <span className="ml-1.5">Passo</span>
              </Button>
              <Separator orientation="vertical" className="h-6" />
              {/* Aplicar mudanças */}
              <Button
                variant="default"
                size="sm"
                onClick={() => exitSimulateMode(true)}
                aria-label="Aplicar física"
              >
                <CheckIcon className="size-4" />
                <span className="ml-1.5">Aplicar</span>
              </Button>
              {/* Descartar mudanças */}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => exitSimulateMode(false)}
                aria-label="Descartar física"
              >
                <XIcon className="size-4" />
                <span className="ml-1.5">Descartar</span>
              </Button>
            </>
          ) : mode === 'testar' ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={exitTestMode}
              aria-label={T.modo.botaoEditar}
            >
              <PencilIcon className="size-4" />
              <span className="ml-1.5">{T.modo.botaoEditar}</span>
            </Button>
          ) : (
            <>
              <Button
                variant="default"
                size="sm"
                onClick={() => void enterTestMode()}
                disabled={!ready}
                aria-label={T.modo.botaoTestar}
              >
                <PlayIcon className="size-4" />
                <span className="ml-1.5">{T.modo.botaoTestar}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={enterSimulateMode}
                disabled={!ready}
                aria-label="Simular física"
              >
                <PlayIcon className="size-4" />
                <span className="ml-1.5">Simular</span>
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setHistory(undo)}
            disabled={!canUndo(history)}
            aria-label={T.acoes.desfazer}
            title={T.acoes.desfazerDica}
          >
            <UndoIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setHistory(redo)}
            disabled={!canRedo(history)}
            aria-label={T.acoes.refazer}
          >
            <RedoIcon className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={zoomToFitMap} aria-label={T.camera.enquadrar} title={T.camera.enquadrarDica}>
            <Maximize2Icon className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => zoomBy(-1)} aria-label={T.camera.diminuir}>
            <ZoomOutIcon className="size-4" />
          </Button>
          <Badge variant="outline">{zoom.toFixed(1)}×</Badge>
          <Button variant="ghost" size="sm" onClick={() => zoomBy(1)} aria-label={T.camera.aumentar}>
            <ZoomInIcon className="size-4" />
          </Button>
          <Button variant="secondary" size="sm" onClick={handleExport}>
            {T.acoes.exportar}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ─────────────────── paleta ─────────────────── */}
        <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">{T.paleta.titulo}</h2>
            <Badge variant="secondary">{T.paleta.contagem(generatedCount)}</Badge>
          </div>

          {paletteLoading ? (
            <div className="grid grid-cols-2 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {blocks.map((b) => {
                const active = b.id === selectedBlock;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelectedBlock(b.id)}
                    className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-xs transition-colors ${
                      active
                        ? 'border-primary ring-2 ring-primary'
                        : 'border-border bg-muted/30 hover:bg-accent/60'
                    }`}
                    aria-pressed={active}
                  >
                    <BlockThumb b={b} />
                    <span className="line-clamp-2 text-center leading-tight">{b.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          <p className="text-xs text-muted-foreground">{T.paleta.nota}</p>

          <Separator />

          <HoldToConfirmButton onConfirm={handleClear} className="w-full">
            {T.acoes.limpar}
          </HoldToConfirmButton>
        </aside>

        {/* ─────────────────── viewport ─────────────────── */}
        <main ref={hostRef} className="relative min-w-0 flex-1">
          <canvas
            ref={canvasRef}
            className="block size-full touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onPointerLeave={(e) => {
              endPointer(e);
              setPickState(null);
            }}
            onWheel={onWheel}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
            onContextMenu={(e) => e.preventDefault()}
          />

          {/* Status */}
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 rounded-lg border border-border bg-card/85 px-3 py-2 text-xs backdrop-blur">
            <span>
              {T.status.vista}{' '}
              <strong>{ROTATION_LABELS[rotation]}</strong>
            </span>
            {mode === 'testar' && actorState ? (
              <span>
                Personagem{' '}
                <strong>
                  x {actorState.pos.x.toFixed(1)} · y {actorState.pos.y.toFixed(1)} · z{' '}
                  {actorState.z}
                </strong>
              </span>
            ) : mode === 'simular' ? (
              <span>
                Simulação{' '}
                <strong>
                  {simState === 'running' ? 'rodando' : 'pausada'} · {simFalling.length} caindo · {simLandedRef.current.length} aterrados
                </strong>
              </span>
            ) : (
              <span>
                {T.status.alvo}{' '}
                <strong>
                  {pickState
                    ? `x ${pickState.placement.x} · y ${pickState.placement.y} · z ${pickState.placement.z}`
                    : '—'}
                </strong>
              </span>
            )}
            <span>
              {T.status.pecas} <strong>{total}</strong>
              {selected ? ` · ${selected.label}` : ''}
            </span>
          </div>

          <div className="pointer-events-none absolute bottom-3 right-3 rounded-lg border border-border bg-card/85 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
            {mode === 'testar'
              ? T.modo.atalhos
              : mode === 'simular'
                ? 'Play/Pause/Step controla a simulação · Esc descarta e sai'
                : T.status.atalhos}
          </div>
        </main>
      </div>

      <ToastStack>
        {toasts.toasts.map((id) => (
          <Toast key={id}>
            <button
              type="button"
              onClick={() => toasts.dismiss(id)}
              className="text-left text-sm"
            >
              {toasts.textOf(id)}
            </button>
          </Toast>
        ))}
      </ToastStack>
    </div>
  );
}

// ------------------------------------------------------------------ miniatura

function BlockThumb({ b }: { b: BlockDef }) {
  const [failed, setFailed] = useState(false);
  // A miniatura mostra a MESMA sprite que o cubo vai mostrar. Adivinhar a URL
  // aqui foi o que fazia bloco de várias vistas aparecer como quadrado colorido
  // na paleta e como arte no mapa.
  const [src, setSrc] = useState<string>('');
  useEffect(() => {
    let alive = true;
    void canonicalSpriteUrl(b).then((url) => {
      if (alive && url) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [b]);
  if (failed || !src) {
    return (
      <span
        aria-hidden
        className="h-12 w-12 rounded"
        style={{ background: `hsl(${b.hue ?? hueOf(b.id)} 45% 47%)` }}
      />
    );
  }
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className="h-12 w-12 object-contain [image-rendering:pixelated]"
    />
  );
}

function hueOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}
