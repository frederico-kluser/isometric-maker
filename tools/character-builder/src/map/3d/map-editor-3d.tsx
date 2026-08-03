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
import {
  Grid3x3Icon,
  HammerIcon,
  Layers2Icon,
  PaintBucketIcon,
  PencilIcon,
  PlayIcon,
  RedoIcon,
  RotateCwIcon,
  Trash2Icon,
  UndoIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import type { MapData } from '../../../../../packages/iso-core/src/map.ts';
import {
  ROTATION_LABELS,
  turn,
  type Rotation,
} from '../../../../../packages/iso-core/src/rotation.ts';
import { buildExport } from '../../../../../packages/iso-core/src/map-instances.ts';
import {
  pushPlayerOutOfCell,
  type PlayerCell,
} from '../../../../../packages/iso-core/src/collision-box.ts';
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
import { createIsoScene3D, collectBlockMeshes, type IsoScene3D } from './scene3d.ts';
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

const ZOOM_STEPS = [1, 2, 3, 4] as const;
const ROTATIONS = [0, 1, 2, 3] as const;

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
   * Personagem de teste — o modo teste (onda futura) escreve aqui. Enquanto
   * existir, colocar um bloco sólido sobre ele empurra-o para fora (push-out),
   * em vez de o deixar dentro da pedra. Hoje só o setter existe: nada lê a
   * posição ainda.
   */
  const [, setTestPlayer] = useState<PlayerCell | null>(null);

  const map = history.present;

  // Refs espelhando o estado para os handlers de ponteiro
  const stateRef = useRef({ map, rotation, tool, selectedBlock, zoom });
  stateRef.current = { map, rotation, tool, selectedBlock, zoom };

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
      created.resize(host.clientWidth, host.clientHeight);
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
  }, [map, rotation, pickState, tool, ready]);

  // ---------------------------------------------------------------- ponteiro

  const pickAt = useCallback(
    (clientX: number, clientY: number): Pick3DResult | null => {
      const canvas = canvasRef.current;
      const s3d = scene3dRef.current;
      if (!canvas || !s3d) return null;
      const meshes = collectBlockMeshes(s3d.scene);
      const s = stateRef.current;

      if (s.tool === 'empilhar') {
        return pickColumnTopRaycaster(
          clientX,
          clientY,
          canvas,
          s3d.camera,
          s3d.scene,
          meshes,
          (x: number, y: number) => mapColumnHeight(s.map, x, y),
        );
      }
      return pick3d(clientX, clientY, canvas, s3d.camera, s3d.scene, meshes);
    },
    [],
  );

  const applyTool = useCallback((result: Pick3DResult) => {
    const { tool: t, selectedBlock: block } = stateRef.current;
    const current = stateRef.current.map;
    let next: MapData = current;
    if (t === 'remover') {
      if (result.hit) next = removeBlock(current, result.hit);
    } else if (t === 'pintar') {
      if (result.hit) next = paintBlock(current, result.hit, block);
      else next = placeBlock(current, result.placement, block);
    } else if (t === 'colocar') {
      // Colocar: usa a posição adjacente exata do raycaster (face normal)
      // NÃO força o topo da coluna — o bloco vai para a face onde o mouse bateu
      next = placeBlock(current, result.placement, block);
    } else {
      // Empilhar: o pickColumnTopRaycaster já resolveu o placement pela face
      // atingida — face de cima → topo da coluna; face lateral → célula
      // adjacente no mesmo nível (Minecraft-style). Aqui só aplicamos.
      next = placeBlock(current, result.placement, block);
    }
    setHistory((h) => pushHistory(h, next));

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
      const result = pickAt(e.clientX, e.clientY);
      setPickState(result);
      if (dragging.current && result) applyTool(result);
    },
    [applyTool, pickAt],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
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

  // Throttle do wheel: no máximo um passo a cada 80 ms (~12.5 passos/s).
  // O evento de scroll dispara dezenas de vezes por segundo; sem throttle
  // cada disparo causa re-render do React, saturando o ciclo.
  const lastWheelTime = useRef(0);

  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    const now = performance.now();
    if (now - lastWheelTime.current < 80) return;
    lastWheelTime.current = now;

    const s3d = scene3dRef.current;
    const currentZoom = stateRef.current.zoom;
    const i = ZOOM_STEPS.indexOf(currentZoom as (typeof ZOOM_STEPS)[number]);
    const delta = e.deltaY < 0 ? 1 : -1;
    const next =
      ZOOM_STEPS[
        Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + delta))
      ];
    if (next === undefined || next === currentZoom) return;

    // Aplica na câmera imediatamente (responsivo)
    s3d?.zoom(next);
    // Atualiza React para o badge
    setZoom(next);
  }, []);

  // ---------------------------------------------------------------- rotação

  const rotateTo = useCallback((rot: Rotation) => {
    setRotation(rot);
    setPickState(null);
    scene3dRef.current?.animateRotation(rot);
  }, []);

  const zoomBy = useCallback((delta: number) => {
    setZoom((z) => {
      const i = ZOOM_STEPS.indexOf(z as (typeof ZOOM_STEPS)[number]);
      const next =
        ZOOM_STEPS[
          Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + delta))
        ];
      if (next === undefined) return z;
      const s3d = scene3dRef.current;
      if (s3d) s3d.zoom(next);
      return next;
    });
  }, []);

  // Teclado: R gira, Z/Y desfazem, 1-4 escolhem vista
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (e.key === 'r' || e.key === 'R') {
        rotateTo(turn(stateRef.current.rotation, e.shiftKey ? -1 : 1));
        return;
      }
      if (/^[1-4]$/.test(e.key)) {
        rotateTo((Number(e.key) - 1) as Rotation);
        return;
      }
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
  }, [rotateTo]);

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
          <Button variant="ghost" size="sm" onClick={() => zoomBy(-1)} aria-label={T.camera.diminuir}>
            <ZoomOutIcon className="size-4" />
          </Button>
          <Badge variant="outline">{zoom}×</Badge>
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
            onContextMenu={(e) => e.preventDefault()}
          />

          {/* Status */}
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 rounded-lg border border-border bg-card/85 px-3 py-2 text-xs backdrop-blur">
            <span>
              {T.status.vista}{' '}
              <strong>{ROTATION_LABELS[rotation]}</strong>
            </span>
            <span>
              {T.status.alvo}{' '}
              <strong>
                {pickState
                  ? `x ${pickState.placement.x} · y ${pickState.placement.y} · z ${pickState.placement.z}`
                  : '—'}
              </strong>
            </span>
            <span>
              {T.status.pecas} <strong>{total}</strong>
              {selected ? ` · ${selected.label}` : ''}
            </span>
          </div>

          <div className="pointer-events-none absolute bottom-3 right-3 rounded-lg border border-border bg-card/85 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
            {T.status.atalhos}
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
  const src =
    b.faceUrls?.north ??
    (b.animated === false || b.frameCount === 0
      ? (b.baseUrl ?? (b.hash ? `/world-blocks/${b.hash}/base.png` : ''))
      : (b.hash ? `/world-blocks/${b.hash}/frames/frame_000.png` : ''));
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
