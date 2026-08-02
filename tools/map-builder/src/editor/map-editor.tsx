/**
 * Editor de mapa isométrico.
 *
 * O canvas do PixiJS vive fora do React de propósito: React é dono do DOM da
 * interface, e a cena é dona do canvas. O ponto de contato é um `useEffect` que
 * cria a cena uma vez e um `render(state)` chamado quando o estado muda —
 * nenhum nó do Pixi passa por reconciliação.
 *
 * ## Por que este arquivo tem JSX escrito à mão
 *
 * O catálogo do Motion UI cobre página de marketing e componente de aplicação;
 * não há nele nada que seja um viewport de editor com canvas WebGL, cursor de
 * grid e ferramentas de colocação. O que o catálogo TEM é usado: `SegmentedToggle`
 * para vista e ferramenta, `SmoothTabs` para a paleta, `Skeleton` no carregamento,
 * `HoldToConfirmButton` para a ação destrutiva, `ToastStack` para o retorno e
 * `StaggerReveal` na entrada dos painéis. O código novo aqui é o arranjo dessas
 * peças mais o hospedeiro do canvas.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Grid3x3Icon,
  HammerIcon,
  Layers2Icon,
  PaintBucketIcon,
  RedoIcon,
  RotateCwIcon,
  Trash2Icon,
  UndoIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import type { MapData } from '@isometric-maker/iso-core/map';
import {
  ROTATION_LABELS,
  ROTATIONS,
  turn,
  type Rotation,
} from '@isometric-maker/iso-core/rotation';
import {
  DEFAULT_GEOMETRY,
  framedCamera,
  type Camera,
} from '../camera.ts';
import { buildExport } from '@isometric-maker/iso-core/map-instances';
import {
  DEFAULT_BLOCKS,
  makeCatalog,
  type BlockCatalog,
} from '@isometric-maker/iso-core/block-catalog';
import { pick3d, pickColumnTop, type Pick3DResult } from '../pick3d.ts';
import { createIsoScene, type BlockDef, type IsoScene } from '../scene.ts';
import {
  canRedo,
  canUndo,
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
} from './map-state.ts';
import { FALLBACK_BLOCKS, loadPalette } from './blocks-api.ts';
import { Compass } from '@/components/compass';
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
import { useMessages } from './toast-messages.ts';
import { editor as T } from '../strings.ts';

const GEOM = DEFAULT_GEOMETRY;
const ZOOM_STEPS = [1, 2, 3, 4] as const;

/** Ferramentas do editor. Cada uma lê o clique de um jeito diferente. */
const TOOLS = ['empilhar', 'colocar', 'pintar', 'remover'] as const;
type Tool = (typeof TOOLS)[number];

const TOOL_ICON: Record<Tool, typeof HammerIcon> = {
  empilhar: Layers2Icon,
  colocar: HammerIcon,
  pintar: PaintBucketIcon,
  remover: Trash2Icon,
};

export function MapEditor() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<IsoScene | null>(null);

  const [blocks, setBlocks] = useState<readonly BlockDef[]>(FALLBACK_BLOCKS);
  const [selectedBlock, setSelectedBlock] = useState<string>(FALLBACK_BLOCKS[0]!.id);
  const [paletteLoading, setPaletteLoading] = useState(true);
  const [generatedCount, setGeneratedCount] = useState(0);
  // O catálogo é lido só na exportação, então vive num ref: guardá-lo em estado
  // faria a árvore reconciliar por um dado que nenhum componente desenha.
  const catalogRef = useRef<BlockCatalog>(makeCatalog(DEFAULT_BLOCKS));

  const [tool, setTool] = useState<Tool>('empilhar');
  const [history, setHistory] = useState<History>(() =>
    initHistory(starterMap(FALLBACK_BLOCKS[0]!.id)),
  );
  const [camera, setCamera] = useState<Camera>({
    rotation: 0,
    turn: 0,
    panX: 0,
    panY: 0,
    zoom: 2,
  });
  const [pickState, setPickState] = useState<Pick3DResult | null>(null);
  const [ready, setReady] = useState(false);
  const toasts = useMessages();

  const map = history.present;

  // Refs espelhando o estado: os handlers de ponteiro são registrados uma vez
  // e precisam ler o valor atual sem se reinscrever a cada tecla digitada.
  const stateRef = useRef({ map, camera, tool, selectedBlock });
  stateRef.current = { map, camera, tool, selectedBlock };

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
    return () => {
      cancelled = true;
    };
    // toasts.push é estável (useCallback sobre um ref no componente do catálogo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- cena

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    let disposed = false;
    let scene: IsoScene | null = null;

    void createIsoScene(canvas).then((created) => {
      if (disposed) {
        created.destroy();
        return;
      }
      scene = created;
      sceneRef.current = created;
      created.resize(host.clientWidth, host.clientHeight);
      setReady(true);
      // Enquadra o mapa inicial: nascer fora da tela é o jeito mais rápido de
      // um editor parecer quebrado.
      setCamera((c) =>
        framedCamera(
          occupiedCells(stateRef.current.map),
          c.rotation,
          host.clientWidth,
          host.clientHeight,
          c.zoom,
          GEOM,
        ),
      );
    });

    return () => {
      disposed = true;
      sceneRef.current = null;
      scene?.destroy();
    };
  }, []);

  // Paleta nova → texturas novas. Recarregar arte é assíncrono e não pode
  // bloquear o primeiro desenho.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !ready) return;
    void scene.setPalette(blocks).then(() => {
      scene.render({
        map: stateRef.current.map,
        camera: stateRef.current.camera,
        preview: null,
      });
    });
  }, [blocks, ready]);

  // Redimensionamento: o canvas segue o painel, não a janela.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => {
      sceneRef.current?.resize(host.clientWidth, host.clientHeight);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // Desenho: uma chamada por mudança de estado, não um laço por quadro. O
  // documento só muda por comando do usuário (ADR 0010 — editor local).
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !ready) return;
    scene.render({
      map,
      camera,
      preview: pickState?.placement ?? null,
      previewInvalid: tool === 'remover',
      highlight: pickState?.hit ?? null,
    });
  }, [map, camera, pickState, tool, ready]);

  // ---------------------------------------------------------------- ponteiro

  const pickAt = useCallback((clientX: number, clientY: number): Pick3DResult | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const s = stateRef.current;
    return s.tool === 'empilhar'
      ? pickColumnTop(sx, sy, s.map, s.camera, GEOM)
      : pick3d(sx, sy, s.map, s.camera, GEOM);
  }, []);

  const applyTool = useCallback((result: Pick3DResult) => {
    const { tool: t, selectedBlock: block } = stateRef.current;
    setHistory((h) => {
      const current = h.present;
      let next: MapData = current;
      if (t === 'remover') {
        if (result.hit) next = removeBlock(current, result.hit);
      } else if (t === 'pintar') {
        if (result.hit) next = paintBlock(current, result.hit, block);
      } else {
        next = placeBlock(current, result.placement, block);
      }
      return pushHistory(h, next);
    });
  }, []);

  const dragging = useRef(false);
  const panning = useRef<{ x: number; y: number } | null>(null);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (panning.current) {
        const dx = e.clientX - panning.current.x;
        const dy = e.clientY - panning.current.y;
        panning.current = { x: e.clientX, y: e.clientY };
        setCamera((c) => ({ ...c, panX: c.panX + dx, panY: c.panY + dy }));
        return;
      }
      const result = pickAt(e.clientX, e.clientY);
      setPickState(result);
      // Arrastar com o botão pintando é o que torna terreno grande viável.
      if (dragging.current && result) applyTool(result);
    },
    [applyTool, pickAt],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      // Botão do meio ou espaço+arrastar movem a câmera; o esquerdo edita.
      // Pan durante um giro se perde quando a rotação assenta (o settle() usa
      // o pan capturado no início) — o mesmo critério do rotateTo e do onWheel.
      if (e.button === 1 || e.shiftKey) {
        if (sceneRef.current?.isRotating()) return;
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

  const endPointer = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragging.current = false;
    panning.current = null;
  }, []);

  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    // Zoom durante um giro se perde quando a rotação assenta: o settle() é
    // calculado com o zoom capturado no início, e o zoom aplicado no meio
    // some na volta. Bloquear é o mesmo critério do rotateTo.
    if (sceneRef.current?.isRotating()) return;
    // Zoom INTEIRO: fracionário borra a arte e desalinha a costura do losango.
    setCamera((c) => {
      const i = ZOOM_STEPS.indexOf(c.zoom as (typeof ZOOM_STEPS)[number]);
      const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + (e.deltaY < 0 ? 1 : -1)))];
      return next === undefined || next === c.zoom ? c : { ...c, zoom: next };
    });
  }, []);

  // ---------------------------------------------------------------- câmera

  const host = hostRef.current;

  /**
   * Gira a câmera com animação.
   *
   * A animação vive no ticker do PixiJS, não no React: reconciliar a árvore 60
   * vezes por segundo por causa de uma transição de 280 ms seria pagar caro por
   * um efeito visual. O React só recebe o estado UMA vez, quando o giro
   * termina — e a cena, que já está desenhando, devolve a câmera final.
   *
   * Girar durante um giro é ignorado: encadear tweens sobre o mesmo alvo faria
   * a câmera passar do ponto e voltar.
   */
  const rotateTo = useCallback((rotation: Rotation) => {
    const scene = sceneRef.current;
    const box = hostRef.current;
    if (!scene || !box) {
      setCamera((c) => ({ ...c, rotation, turn: rotation }));
      return;
    }
    if (scene.isRotating()) return;
    setPickState(null);
    void scene
      .rotateTo(rotation, {
        cells: occupiedCells(stateRef.current.map),
        viewportWidth: box.clientWidth,
        viewportHeight: box.clientHeight,
      })
      .then(setCamera);
  }, []);

  const zoomBy = useCallback((delta: number) => {
    setCamera((c) => {
      const i = ZOOM_STEPS.indexOf(c.zoom as (typeof ZOOM_STEPS)[number]);
      const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + delta))];
      return next === undefined ? c : { ...c, zoom: next };
    });
  }, []);

  // Teclado: R gira, Z/Y desfazem, 1–4 escolhem a vista.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === 'r' || e.key === 'R') {
        rotateTo(turn(stateRef.current.camera.rotation, e.shiftKey ? -1 : 1));
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        setHistory((h) => (e.shiftKey ? redo(h) : undo(h)));
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        setHistory(redo);
      } else if (/^[1-4]$/.test(e.key)) {
        rotateTo((Number(e.key) - 1) as Rotation);
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

  /**
   * Exporta no formato v2: cada bloco colocado sai com id, posição x,y,z, tipo
   * e material já resolvidos.
   *
   * O formato de AUTORIA continua sendo a coluna RLE — compacta e sem buracos.
   * O de EXPORTAÇÃO é a lista de instâncias, porque quem vai escrever física em
   * cima não deveria precisar decodificar RLE nem carregar a paleta para saber
   * se uma célula é sólida.
   */
  const handleExport = useCallback(() => {
    const dados = buildExport(stateRef.current.map, catalogRef.current, {
      tileWidth: GEOM.tileWidth,
      tileHeight: GEOM.tileHeight,
      cubeHeight: GEOM.zStep,
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
        <div className="flex items-center gap-2">
          <Grid3x3Icon className="size-5 text-primary" />
          <h1 className="text-sm font-semibold">{T.titulo}</h1>
        </div>

        <Separator orientation="vertical" className="h-6" />

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{T.camera.rotulo}</span>
          <SegmentedToggle
            value={String(camera.rotation)}
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
            onClick={() => rotateTo(turn(camera.rotation, 1))}
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
          <Badge variant="outline">{camera.zoom}×</Badge>
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

          {/* Bússola: mostra para onde a câmera olha e acompanha o giro suave. */}
          <Compass rotation={camera.rotation} />

          {/* Leitura do estado: sem isto, "por que a peça caiu ali?" não tem resposta. */}
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 rounded-lg border border-border bg-card/85 px-3 py-2 text-xs backdrop-blur">
            <span>
              {T.status.vista} <strong>{ROTATION_LABELS[camera.rotation]}</strong>
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

/**
 * Miniatura da paleta.
 *
 * v2 (4 faces): a face norte. v3 (texture, ADR 0032): o primeiro frame da
 * animação — o bloco não tem faceUrls, só spritesheet, e o frame individual
 * já é servido pelo character-builder via proxy. Arte que falha ao carregar
 * cai no quadrado colorido: o ícone quebrado do navegador não diz nada sobre
 * a peça, e o quadrado é a mesma reserva que o cubo procedural desenha.
 */
function BlockThumb({ b }: { b: BlockDef }) {
  const [failed, setFailed] = useState(false);
  const src =
    b.faceUrls?.north ?? (b.hash ? `/world-blocks/${b.hash}/frames/frame_000.png` : '');
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

/** Mesmo matiz do cubo procedural — a miniatura da paleta tem que bater com a peça. */
function hueOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}
