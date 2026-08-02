/**
 * Editor de recorte quadrado para a imagem de referência.
 *
 * Abre como modal sobre o wizard da face sul. O usuário arrasta um quadrado
 * sobre a imagem original, ajusta o zoom (1–4×) e vê o preview em tempo real
 * no tamanho de saída (nearest-neighbor). Três modos: crop livre, fit width,
 * fit height.
 *
 * ## Por que canvas puro e não PixiJS
 *
 * É um canvas pequeno (≤256 px de output, imagem original no tamanho que o
 * navegador der conta). Sem sprites, sem cena, sem ticker — o PixiJS seria
 * overkill. Nearest-neighbor + `drawImage` é tudo que precisa.
 *
 * ## Por que modal e não inline
 *
 * O editor de recorte é uma interação focada: o usuário escolhe o arquivo,
 * recorta, confirma. Um modal mantém o fluxo linear e não compete com o resto
 * do formulário do wizard por espaço.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  SegmentedToggle,
  SegmentedToggleOption,
} from '@/components/motion-ui/segmented-toggle';
import { wizard } from '../../../strings/wizard.ts';
import {
  centerToRect,
  clampCenter,
  cropSize,
  extractCroppedBase64,
  fitHeightRect,
  fitWidthRect,
  initialCrop,
  renderCropPreview,
  screenToImage,
  ZOOM_STEPS,
  type CropCenter,
  type CropMode,
  type CropRect,
  type CropZoom,
} from '../../../image-crop.ts';

export interface ReferenceCropEditorProps {
  /** Data URI da imagem original. */
  readonly imageDataUri: string;
  /** Tamanho do quadrado de saída (vem de character.size). */
  readonly outputSize: number;
  /** Chamado com o base64 do PNG cropado (sem prefixo data:). */
  readonly onConfirm: (base64: string) => void;
  readonly onCancel: () => void;
}

export function ReferenceCropEditor({
  imageDataUri,
  outputSize,
  onConfirm,
  onCancel,
}: ReferenceCropEditorProps) {
  const displayRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragging = useRef(false);
  const imgLoaded = useRef(false);

  const [zoom, setZoom] = useState<CropZoom>(1);
  const [mode, setMode] = useState<CropMode>('crop');
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  // Centro do quadrado em coordenadas da imagem original.
  const [center, setCenter] = useState<CropCenter | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Carrega a imagem.
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      imgRef.current = img;
      imgLoaded.current = true;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      setImgSize({ w, h });
      // Centro inicial: meio da imagem.
      setCenter({ cx: w / 2, cy: h / 2 });
    };
    img.onerror = () => {
      if (!cancelled) setError('não foi possível carregar a imagem');
    };
    img.src = imageDataUri;
    return () => {
      cancelled = true;
    };
  }, [imageDataUri]);

  // Calcula o retângulo de crop atual.
  const cropRect = (): CropRect | null => {
    if (!imgSize || !center) return null;
    if (mode === 'fitWidth') return fitWidthRect(imgSize.w, imgSize.h);
    if (mode === 'fitHeight') return fitHeightRect(imgSize.w, imgSize.h);
    const side = cropSize(zoom, outputSize);
    return centerToRect(center.cx, center.cy, side);
  };

  // Desenha o canvas de exibição (imagem original + overlay do quadrado).
  const drawDisplay = useCallback(() => {
    const canvas = displayRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imgSize) return;
    const ctx = canvas.getContext('2d')!;
    const rect = cropRect();
    if (!rect) return;

    // Ajusta o canvas ao container.
    const parent = canvas.parentElement;
    if (parent) {
      const w = parent.clientWidth;
      const h = Math.min(parent.clientHeight, 400);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }

    // Desenha a imagem original cabendo no canvas (mantém aspecto).
    const scale = Math.min(canvas.width / imgSize.w, canvas.height / imgSize.h);
    const offsetX = (canvas.width - imgSize.w * scale) / 2;
    const offsetY = (canvas.height - imgSize.h * scale) / 2;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Fundo xadrez para ver transparência (útil nos modos fit).
    const checkerSize = 8;
    for (let cy = 0; cy < canvas.height; cy += checkerSize) {
      for (let cx = 0; cx < canvas.width; cx += checkerSize) {
        ctx.fillStyle =
          ((cx / checkerSize) + (cy / checkerSize)) % 2 === 0 ? '#333' : '#222';
        ctx.fillRect(cx, cy, checkerSize, checkerSize);
      }
    }

    ctx.drawImage(img, offsetX, offsetY, imgSize.w * scale, imgSize.h * scale);

    // Overlay escuro fora do crop.
    const cx1 = offsetX + rect.x * scale;
    const cy1 = offsetY + rect.y * scale;
    const cs = rect.w * scale;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, canvas.width, cy1);                          // topo
    ctx.fillRect(0, cy1, cx1, cs);                                   // esquerda
    ctx.fillRect(cx1 + cs, cy1, canvas.width - cx1 - cs, cs);       // direita
    ctx.fillRect(0, cy1 + cs, canvas.width, canvas.height - cy1 - cs); // base

    // Borda do quadrado.
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx1, cy1, cs, cs);
  }, [imgSize, center, zoom, mode, outputSize]);

  // Desenha o preview.
  const drawPreview = useCallback(() => {
    const canvas = previewRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imgSize) return;
    const rect = cropRect();
    if (!rect) return;
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext('2d')!;
    renderCropPreview(img, imgSize.w, imgSize.h, rect, outputSize, ctx);
  }, [imgSize, center, zoom, mode, outputSize]);

  // Redesenha quando o estado muda.
  useEffect(() => {
    drawDisplay();
    drawPreview();
  }, [drawDisplay, drawPreview]);

  // Redesenha no resize.
  useEffect(() => {
    const onResize = (): void => drawDisplay();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [drawDisplay]);

  // Ponteiro: arrastar o quadrado (modo crop).
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (mode !== 'crop') return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragging.current = true;
    },
    [mode],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!dragging.current || mode !== 'crop' || !imgSize) return;
      const canvas = displayRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const pos = screenToImage(sx, sy, canvas.width, canvas.height, imgSize.w, imgSize.h);
      const half = cropSize(zoom, outputSize) / 2;
      const clamped = clampCenter(pos.x, pos.y, half, imgSize.w, imgSize.h);
      setCenter(clamped);
    },
    [imgSize, zoom, mode, outputSize],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      dragging.current = false;
    },
    [],
  );

  // Roda do mouse: zoom (modo crop).
  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    if (mode !== 'crop') return;
    e.preventDefault();
    setZoom((z) => {
      const idx = ZOOM_STEPS.indexOf(z);
      const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, idx + (e.deltaY < 0 ? 1 : -1)))];
      return next ?? z;
    });
  }, [mode]);

  // Confirma: extrai o PNG cropado.
  const handleConfirm = useCallback(() => {
    const img = imgRef.current;
    if (!img || !imgSize) return;
    const rect = cropRect();
    if (!rect) return;
    const base64 = extractCroppedBase64(img, imgSize.w, imgSize.h, rect, outputSize);
    onConfirm(base64);
  }, [imgSize, center, zoom, mode, outputSize, onConfirm]);

  // Teclado: Enter confirma, Escape cancela.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') handleConfirm();
      else if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleConfirm, onCancel]);

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="rounded-lg border border-border bg-card p-6 shadow-lg">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onCancel}>
            {wizard.sul.recorte.cancelar}
          </Button>
        </div>
      </div>
    );
  }

  if (!imgLoaded.current || !imgSize) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="rounded-lg border border-border bg-card p-6 shadow-lg">
          <p className="text-sm text-muted-foreground">Carregando imagem...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="flex max-h-[90dvh] w-[90vw] max-w-3xl flex-col gap-4 rounded-lg border border-border bg-card p-5 shadow-lg">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{wizard.sul.recorte.titulo}</h2>
          <p className="text-xs text-muted-foreground">
            {wizard.sul.recorte.nota.replace('{size}', String(outputSize))}
          </p>
        </div>

        <div className="flex min-h-0 flex-1 gap-4">
          {/* Área de exibição + crop */}
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <canvas
              ref={displayRef}
              className="w-full flex-1 rounded-md border border-border"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={onWheel}
            />
            {/* Controles */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{wizard.sul.recorte.zoom}</span>
              <SegmentedToggle
                value={String(zoom)}
                onChange={(v) => setZoom(Number(v) as CropZoom)}
                ariaLabel={wizard.sul.recorte.zoom}
              >
                {ZOOM_STEPS.map((z) => (
                  <SegmentedToggleOption key={z} value={String(z)}>
                    {z}×
                  </SegmentedToggleOption>
                ))}
              </SegmentedToggle>
              <Separator orientation="vertical" className="h-6" />
              <SegmentedToggle
                value={mode}
                onChange={(v) => setMode(v as CropMode)}
                ariaLabel="Modo"
              >
                <SegmentedToggleOption value="crop">
                  {wizard.sul.recorte.modo.crop}
                </SegmentedToggleOption>
                <SegmentedToggleOption value="fitWidth">
                  {wizard.sul.recorte.modo.fitWidth}
                </SegmentedToggleOption>
                <SegmentedToggleOption value="fitHeight">
                  {wizard.sul.recorte.modo.fitHeight}
                </SegmentedToggleOption>
              </SegmentedToggle>
            </div>
          </div>

          {/* Preview */}
          <div className="flex shrink-0 flex-col items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {outputSize}×{outputSize}
            </span>
            <canvas
              ref={previewRef}
              className="rounded-md border border-border"
              style={{
                width: outputSize * 2,
                height: outputSize * 2,
                imageRendering: 'pixelated',
              }}
            />
          </div>
        </div>

        {/* Botões */}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            {wizard.sul.recorte.cancelar}
          </Button>
          <Button variant="default" size="sm" onClick={handleConfirm}>
            {wizard.sul.recorte.confirmar}
          </Button>
        </div>
      </div>
    </div>
  );
}
