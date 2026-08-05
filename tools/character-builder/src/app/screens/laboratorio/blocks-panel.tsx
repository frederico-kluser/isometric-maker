/**
 * Painel "Blocos do mundo" — bancada do cubo pixel art (ADR 0032).
 *
 * Uma única técnica: pixflux gera a textura plana da face do cubo (o molde é
 * a referência de forma e tamanho) e animate-with-text-v3 anima a partir de
 * uma ação gerada por LLM da descrição. POST devolve 202 {key, hash} e o
 * resultado chega por GET /api/world-block/{hash}, que responde 200 com um
 * status NOMEADO ('gerando' | 'pronto' | 'falhou' | 'desconhecido'). Andamento
 * nunca é 404 — foi essa confusão que fez o Sprite Studio parecer quebrado
 * enquanto estava só trabalhando.
 *
 * A montagem e a validação do body ficam no módulo puro ./blocks-body.ts
 * (testado com node --test); aqui é só DOM e coleta de inputs.
 *
 * Cada card do catálogo tem um botão de apagar (DELETE /api/world-block/{hash},
 * em ./delete-block-button.tsx). Apagar é irreversível e o dinheiro da geração
 * não volta, então o gesto é pressionar-e-segurar e o retorno diz exatamente o
 * que saiu do disco — inclusive quando junto foi embora trabalho já pago.
 */
import { useEffect, useMemo, useState } from 'react';
import { CheckIcon, LoaderCircleIcon, RefreshCwIcon, XIcon } from 'lucide-react';
import { api } from '../../studio-store.tsx';
// Do módulo PURO server/model.ts, nunca de server/world-block.ts: aquele
// importa node:crypto e node:fs, e o navegador não tem nenhum dos dois.
import type { BlockFacing } from '../../../../server/model.ts';
// Módulo PURO do iso-core: só a geometria, para mostrar o molde em escala.
import { CANONICAL_CUBE } from '../../../../../../packages/iso-core/src/iso-cube.ts';
import { blocos as SB } from '../../../strings/blocos.ts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MultiStateButton } from '@/components/motion-ui/multi-state-button';
import {
  SegmentedToggle,
  SegmentedToggleOption,
} from '@/components/motion-ui/segmented-toggle';
import { Skeleton } from '@/components/motion-ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  buildWorldBlockBody,
  DETAIL_OPTIONS,
  OUTLINE_OPTIONS,
  SHADING_OPTIONS,
  TILE_DEFAULTS,
  type BlockErrorCode,
  type DetailOption,
  type OutlineOption,
  type ShadingOption,
  type WorldBlockAccepted,
  type WorldBlockResult,
  type WorldBlockStatus,
} from './blocks-body.ts';
import { DeleteBlockButton, type BlockDeletionReport } from './delete-block-button.tsx';

/** Id único do parágrafo da dica — o `aria-describedby` de cada botão aponta para ele. */
const REMOVAL_HINT_ID = 'blocos-remocao-dica';

const CLIENT_ERROR_TEXT: Record<BlockErrorCode, string> = {
  'description-missing': SB.erros.descricaoObrigatoria,
};

type ButtonState = 'idle' | 'running' | 'done' | 'error';

/** Opções do seletor de frames: 0 = bloco estático (sem animação). */
type FrameCountOption = 0 | 4 | 8 | 16;

interface CatalogEntry {
  readonly hash: string;
  readonly description: string;
  readonly shape: string;
  readonly technique: 'chained' | 'rotated' | 'texture';
  readonly faceUrls?: Record<BlockFacing, string>;
  readonly spritesheetUrl?: string;
  /** true para textura animada; false para bloco estático (frameCount 0). */
  readonly animated?: boolean;
  /** Loop vai-e-volta gravado no sidecar (playback do editor). */
  readonly pingPong?: boolean;
  /** Imagem estática do bloco (frameCount 0): o cubo base. */
  readonly baseUrl?: string;
  readonly frameCount?: number;
  readonly fps?: number;
}

export function BlocksPanel() {
  const [description, setDescription] = useState('');
  const [action, setAction] = useState('');
  // Knobs de estilo do tile: começam no default do fornecedor, e o body só os
  // envia quando saem dele (ver blocks-body.ts).
  const [textGuidanceScale, setTextGuidanceScale] = useState<number>(
    TILE_DEFAULTS.textGuidanceScale,
  );
  const [outline, setOutline] = useState<OutlineOption>(TILE_DEFAULTS.outline);
  const [shading, setShading] = useState<ShadingOption>(TILE_DEFAULTS.shading);
  const [detail, setDetail] = useState<DetailOption>(TILE_DEFAULTS.detail);
  const [frameCount, setFrameCount] = useState<FrameCountOption>(8);
  const [fps, setFps] = useState(8);
  const [enhancePrompt, setEnhancePrompt] = useState(true);
  const [pingPong, setPingPong] = useState(true);

  const [buttonState, setButtonState] = useState<ButtonState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pendingHash, setPendingHash] = useState<string | null>(null);
  const [result, setResult] = useState<WorldBlockResult | null>(null);
  /**
   * true SÓ quando o POST devolveu o resultado na hora — ou seja, quando nada
   * foi submetido nesta execução.
   *
   * Não dá para tirar isso de `result.fromCache`: o GET lê o manifesto do
   * disco e sempre reporta `fromCache: true`, inclusive logo depois de uma
   * geração recém-paga. Num repositório cuja regra dura é "nada de custo
   * surpresa", dizer "nenhuma chamada saiu" sobre uma chamada que saiu é o
   * pior tipo de mentira de interface.
   */
  const [semGasto, setSemGasto] = useState(false);
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  /** Retorno da última remoção — o que saiu do disco e o que isso implica. */
  const [removalNotice, setRemovalNotice] = useState<string | null>(null);
  const [removalError, setRemovalError] = useState<string | null>(null);

  const running = buttonState === 'running';

  const loadCatalog = (): void => {
    void api<{ blocks: CatalogEntry[] }>('world-blocks')
      .then((r) => setCatalog(r.blocks))
      .catch(() => setCatalog([]));
  };

  /**
   * Retorno da remoção, sem eufemismo: o que foi apagado, se junto foi embora
   * trabalho já pago, e o que muda num mapa que já usava o bloco.
   */
  const handleDeleted = (report: BlockDeletionReport, description: string): void => {
    const parts = [
      report.existed ? SB.remocao.apagado(description) : SB.remocao.naoExistia,
    ];
    if (report.pendingDiscarded) parts.push(SB.remocao.pendenteDescartado);
    if (report.existed) parts.push(SB.remocao.avisoMapa);
    setRemovalError(null);
    setRemovalNotice(parts.join(' '));
    // O bloco apagado não pode continuar no cartão de resultado: a imagem
    // viraria um 404 na tela.
    if (result?.hash === report.hash) setResult(null);
    loadCatalog();
  };

  const handleRemovalError = (message: string): void => {
    setRemovalNotice(null);
    setRemovalError(SB.remocao.falhou(message));
  };

  useEffect(loadCatalog, []);

  // Sondagem do resultado. 200 com status nomeado — o console do navegador
  // fica limpo e uma falha real aparece na hora.
  useEffect(() => {
    if (pendingHash === null) return;
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/world-block/${pendingHash}`);
        const body = (await res.json().catch(() => ({}))) as {
          status?: WorldBlockStatus;
          error?: string;
          result?: WorldBlockResult;
        };
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        if (body.status === 'gerando') return;
        if (body.status === 'falhou' || body.status === 'desconhecido') {
          throw new Error(body.error ?? SB.erros.jobFalhou);
        }
        if (body.status !== 'pronto' || body.result === undefined) {
          throw new Error(body.error ?? SB.erros.jobFalhou);
        }
        setResult(body.result);
        setPendingHash(null);
        setButtonState('done');
        loadCatalog();
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setPendingHash(null);
        setButtonState('error');
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pendingHash]);

  const handleGenerate = async (): Promise<void> => {
    const built = buildWorldBlockBody({
      description,
      action,
      textGuidanceScale,
      outline,
      shading,
      detail,
      frameCount,
      fps,
      enhancePrompt,
      pingPong,
    });
    if (!built.ok) {
      setError(CLIENT_ERROR_TEXT[built.code]);
      setButtonState('error');
      return;
    }

    setError(null);
    setButtonState('running');
    setResult(null);
    setSemGasto(false);
    try {
      const accepted = await api<WorldBlockAccepted | { status: string; result: WorldBlockResult }>(
        'world-block',
        { method: 'POST', body: JSON.stringify(built.body) },
      );
      // Cache total: o servidor já responde 200 com o resultado pronto.
      if ('result' in accepted) {
        setResult(accepted.result);
        setSemGasto(true);
        setButtonState('done');
        loadCatalog();
        return;
      }
      setPendingHash(accepted.hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setButtonState('error');
    }
  };

  const buttonLabel =
    buttonState === 'running'
      ? SB.form.gerando
      : buttonState === 'done'
        ? SB.form.pronto
        : buttonState === 'error'
          ? SB.form.falhou
          : SB.form.gerar;

  const buttonIcon =
    buttonState === 'running' ? (
      <LoaderCircleIcon className="size-4 animate-spin" />
    ) : buttonState === 'done' ? (
      <CheckIcon className="size-4" />
    ) : buttonState === 'error' ? (
      <XIcon className="size-4" />
    ) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-balance text-xl font-semibold">{SB.titulo}</h2>
        <p className="max-w-prose text-pretty text-sm text-muted-foreground">
          {SB.descricao}
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* ──────────────── formulário ──────────────── */}
        <div className="flex flex-col gap-4">
          {/* ─── molde ─── */}
          <Card>
            <CardHeader>
              <CardTitle>{SB.molde.titulo}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-start gap-4">
              <img
                src="/api/block-mould.png"
                alt={SB.molde.titulo}
                width={CANONICAL_CUBE.spriteWidth * 2}
                height={CANONICAL_CUBE.spriteHeight * 2}
                className="shrink-0 rounded border border-border bg-muted/40 [image-rendering:pixelated]"
              />
              <div className="flex flex-col gap-1.5">
                <p className="text-sm">{SB.molde.descricao}</p>
                <p className="text-xs text-muted-foreground">
                  {SB.molde.geometria(
                    CANONICAL_CUBE.tileWidth,
                    CANONICAL_CUBE.tileHeight,
                    CANONICAL_CUBE.cubeHeight,
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{SB.molde.porQueCinza}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{SB.form.cartaoBloco}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bloco-desc">{SB.form.descricaoRotulo}</Label>
                <Textarea
                  id="bloco-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={SB.form.descricaoPlaceholder}
                />
                <p className="text-xs text-muted-foreground">{SB.form.descricaoNota}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{SB.form.estiloCartao}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-xs text-muted-foreground">{SB.form.estiloNota}</p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bloco-guidance">{SB.form.guidanceRotulo}</Label>
                <input
                  id="bloco-guidance"
                  type="number"
                  min={1}
                  max={20}
                  value={textGuidanceScale}
                  onChange={(e) =>
                    setTextGuidanceScale(
                      Number(e.target.value) || TILE_DEFAULTS.textGuidanceScale,
                    )
                  }
                  className="w-20 rounded border px-2 py-1 text-sm"
                />
                <p className="text-xs text-muted-foreground">{SB.form.guidanceNota}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bloco-outline">{SB.form.outlineRotulo}</Label>
                <Select
                  value={outline}
                  onValueChange={(v) => {
                    if (v !== null) setOutline(v as OutlineOption);
                  }}
                >
                  <SelectTrigger id="bloco-outline" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {/* O VALOR é o enum do spec (inglês, vai no request); o
                        rótulo é pt-BR e mora em src/strings (ADR 0016). */}
                    {OUTLINE_OPTIONS.map((o) => (
                      <SelectItem key={o} value={o}>
                        {SB.form.outlineOpcoes[o]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bloco-shading">{SB.form.shadingRotulo}</Label>
                <Select
                  value={shading}
                  onValueChange={(v) => {
                    if (v !== null) setShading(v as ShadingOption);
                  }}
                >
                  <SelectTrigger id="bloco-shading" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHADING_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {SB.form.shadingOpcoes[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bloco-detail">{SB.form.detailRotulo}</Label>
                <Select
                  value={detail}
                  onValueChange={(v) => {
                    if (v !== null) setDetail(v as DetailOption);
                  }}
                >
                  <SelectTrigger id="bloco-detail" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DETAIL_OPTIONS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {SB.form.detailOpcoes[d]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{SB.animacao.cartao}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Badge variant="secondary" className="w-fit">
                {frameCount === 0 ? SB.form.custoEstatico : SB.form.custo}
              </Badge>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bloco-acao">{SB.form.acaoRotulo}</Label>
                <Textarea
                  id="bloco-acao"
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                  placeholder={SB.form.acaoPlaceholder}
                />
                <p className="text-xs text-muted-foreground">{SB.form.acaoNota}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="flex items-center gap-2">
                  <Checkbox
                    checked={enhancePrompt}
                    onCheckedChange={(checked) => setEnhancePrompt(checked)}
                  />
                  {SB.form.enhanceRotulo}
                </Label>
                <p className="text-xs text-muted-foreground">{SB.form.enhanceNota}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{SB.form.frameCountRotulo}</Label>
                <SegmentedToggle
                  value={String(frameCount)}
                  onChange={(v) => setFrameCount(Number(v) as FrameCountOption)}
                  ariaLabel={SB.form.frameCountRotulo}
                >
                  <SegmentedToggleOption value="0">{SB.form.estatico}</SegmentedToggleOption>
                  {[4, 8, 16].map((n) => (
                    <SegmentedToggleOption key={n} value={String(n)}>
                      {n}
                    </SegmentedToggleOption>
                  ))}
                </SegmentedToggle>
                <p className="text-xs text-muted-foreground">{SB.form.frameCountNota}</p>
              </div>
              {frameCount !== 0 && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label>{SB.form.fpsRotulo}</Label>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={fps}
                      onChange={(e) => setFps(Number(e.target.value) || 8)}
                      className="w-20 rounded border px-2 py-1 text-sm"
                    />
                    <p className="text-xs text-muted-foreground">{SB.form.fpsNota}</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="flex items-center gap-2">
                      <Checkbox
                        checked={pingPong}
                        onCheckedChange={(checked) => setPingPong(checked)}
                      />
                      {SB.form.pingPongRotulo}
                    </Label>
                    <p className="text-xs text-muted-foreground">{SB.form.pingPongNota}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col items-start gap-3">
            <MultiStateButton
              state={buttonState}
              onClick={() => void handleGenerate()}
              disabled={running}
              icon={buttonIcon}
              feedback={buttonState === 'done' ? 'pop' : buttonState === 'error' ? 'shake' : 'none'}
              surfaceClassName={
                buttonState === 'error'
                  ? 'bg-destructive/15 text-destructive'
                  : 'bg-primary text-primary-foreground'
              }
              announce={buttonLabel}
              aria-label={SB.form.ariaLabel}
            >
              {buttonLabel}
            </MultiStateButton>
            {error !== null && (
              <p
                role="alert"
                className="w-full rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}
          </div>
        </div>

        {/* ──────────────── resultado + catálogo ──────────────── */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{SB.resultado.titulo}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {running ? (
                <>
                  <Skeleton className="h-24 w-full" />
                  <p className="text-sm text-muted-foreground" role="status">
                    {SB.resultado.aguardando}
                  </p>
                </>
              ) : result === null ? (
                <p className="text-sm text-muted-foreground">{SB.resultado.vazio}</p>
              ) : (
                <>
                  {frameCount === 0 ? (
                    // Bloco estático: o cubo base, sem animação.
                    <img
                      src={`/world-blocks/${result.hash}/base.png`}
                      alt={description}
                      className="max-h-24 w-full object-contain [image-rendering:pixelated]"
                    />
                  ) : (
                    <AnimPreview
                      hash={result.hash}
                      frameCount={frameCount}
                      fps={fps}
                      pingPong={pingPong}
                      alt={description}
                      className="max-h-24 w-full object-contain [image-rendering:pixelated]"
                    />
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{SB.catalogo.tecnica.texture}</Badge>
                    {semGasto && (
                      <Badge variant="outline">{SB.resultado.doCache}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{SB.resultado.aviso}</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{SB.catalogo.titulo}</CardTitle>
              <Button variant="ghost" size="sm" onClick={loadCatalog}>
                <RefreshCwIcon className="size-4" />
                {SB.catalogo.recarregar}
              </Button>
            </CardHeader>
            <CardContent>
              {catalog === null ? (
                <Skeleton className="h-16 w-full" />
              ) : catalog.length === 0 ? (
                <p className="text-sm text-muted-foreground">{SB.catalogo.vazio}</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    {catalog.map((b) => {
                      const isAnimated =
                        b.animated ?? (b.frameCount !== undefined && b.frameCount > 1);
                      return (
                        <div
                          key={b.hash}
                          className="flex flex-col items-center gap-1 rounded-lg border border-border bg-muted/30 p-2"
                        >
                          {b.technique === 'texture' ? (
                            isAnimated ? (
                              <AnimPreview
                                hash={b.hash}
                                frameCount={b.frameCount}
                                fps={b.fps}
                                pingPong={b.pingPong}
                                alt={b.description}
                                className="h-16 w-16 object-contain [image-rendering:pixelated]"
                              />
                            ) : (
                              <img
                                src={b.baseUrl ?? `/world-blocks/${b.hash}/base.png`}
                                alt={b.description}
                                className="h-16 w-16 object-contain [image-rendering:pixelated]"
                              />
                            )
                          ) : (
                            <img
                              src={b.faceUrls?.north ?? ''}
                              alt={b.description}
                              className="h-16 w-16 object-contain [image-rendering:pixelated]"
                            />
                          )}
                          <span className="line-clamp-2 text-center text-xs leading-tight">
                            {b.description}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {b.technique === 'texture'
                              ? isAnimated
                                ? `${b.frameCount ?? '?'}f ${b.fps ?? '?'}fps`
                                : SB.form.estatico
                              : b.shape}
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {SB.catalogo.tecnica[b.technique as 'chained' | 'rotated' | 'texture'] ?? b.technique}
                          </Badge>
                          <DeleteBlockButton
                            hash={b.hash}
                            description={b.description}
                            hintId={REMOVAL_HINT_ID}
                            onDeleted={(report) => handleDeleted(report, b.description)}
                            onError={handleRemovalError}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <p id={REMOVAL_HINT_ID} className="mt-3 text-xs text-muted-foreground">
                    {SB.remocao.dica}
                  </p>
                  {removalNotice !== null && (
                    <p
                      role="status"
                      className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs"
                    >
                      {removalNotice}
                    </p>
                  )}
                  {removalError !== null && (
                    <p
                      role="alert"
                      className="mt-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                    >
                      {removalError}
                    </p>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">
                    {SB.catalogo.comparacaoNota}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * Prévia animada de um bloco 'texture' (ADR 0032): faz loop pelos frames de
 * /world-blocks/<hash>/frames/ em vez de mostrar só o primeiro frame.
 *
 * O fps, a contagem e o ping-pong REAIS vêm do sidecar animation.json — a API
 * pode devolver menos frames que os pedidos, e o sidecar grava o que chegou
 * (packSpritesheet usa frames.length). Os props são só o fallback imediato
 * enquanto o sidecar não chega. Bloco estático (frameCount <= 1) renderiza o
 * <img> único: frame_000 quando existe um frame, o cubo base (base.png) quando
 * não existe nenhum.
 */
interface AnimPreviewProps {
  readonly hash: string;
  /** Fallback imediato; o sidecar animation.json é a fonte da verdade. */
  readonly frameCount?: number | undefined;
  /** Fallback imediato; o sidecar animation.json é a fonte da verdade. */
  readonly fps?: number | undefined;
  /** Fallback imediato; o sidecar animation.json é a fonte da verdade. */
  readonly pingPong?: boolean | undefined;
  readonly alt?: string;
  readonly className?: string;
}

/** FPS padrão da bancada — o mesmo default do servidor (server/model.ts). */
const DEFAULT_ANIM_FPS = 8;

interface AnimSidecar {
  readonly fps?: number;
  readonly frameCount?: number;
  /** Loop vai-e-volta gravado pelo servidor no animation.json. */
  readonly pingPong?: boolean;
}

function frameUrl(hash: string, index: number): string {
  return `/world-blocks/${hash}/frames/frame_${String(index).padStart(3, '0')}.png`;
}

function AnimPreview({ hash, frameCount, fps, pingPong, alt, className }: AnimPreviewProps) {
  const [meta, setMeta] = useState<{
    fps: number;
    frameCount: number;
    pingPong: boolean;
  } | null>(null);
  const [loaded, setLoaded] = useState(0);
  /** Tick do loop (1 por frame no FPS do sidecar). O índice é derivado. */
  const [tick, setTick] = useState(0);

  // Sidecar primeiro; os props seguram o preview enquanto ele não chega.
  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    void fetch(`/world-blocks/${hash}/animation.json`)
      .then((res) => (res.ok ? (res.json() as Promise<AnimSidecar>) : Promise.resolve(null)))
      .then((sidecar) => {
        if (cancelled) return;
        const sideCount = sidecar?.frameCount;
        const sideFps = sidecar?.fps;
        const sidePingPong = sidecar?.pingPong;
        const count =
          typeof sideCount === 'number' && sideCount >= 1
            ? sideCount
            : typeof frameCount === 'number' && frameCount >= 1
              ? frameCount
              : 0;
        if (count === 0) return;
        setMeta({
          fps: typeof sideFps === 'number' && sideFps >= 1 ? sideFps : (fps ?? DEFAULT_ANIM_FPS),
          frameCount: count,
          pingPong: typeof sidePingPong === 'boolean' ? sidePingPong : (pingPong ?? true),
        });
      })
      .catch(() => {
        if (cancelled) return;
        if (typeof frameCount === 'number' && frameCount >= 1) {
          setMeta({ fps: fps ?? DEFAULT_ANIM_FPS, frameCount, pingPong: pingPong ?? true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hash, frameCount, fps, pingPong]);

  const count =
    meta?.frameCount ?? (typeof frameCount === 'number' && frameCount >= 1 ? frameCount : 0);
  const pingPongEnabled = meta?.pingPong ?? pingPong ?? true;

  const urls = useMemo(
    () => Array.from({ length: count }, (_, i) => frameUrl(hash, i)),
    [hash, count],
  );

  // Índice derivado do tick: linear quando ping-pong está desligado, vai-e-volta
  // quando ligado (0→1→2→3→2→1→0→…). Período do ping-pong: 2×(count−1).
  const frameIndex = useMemo(() => {
    if (!pingPongEnabled) return tick % count;
    const period = 2 * (count - 1);
    const m = tick % period;
    return m >= count ? period - m : m;
  }, [tick, count, pingPongEnabled]);

  // Pré-carrega todos os frames — sem isso o loop piscaria imagens vazias no
  // primeiro ciclo. Frame ausente conta como "carregado": um 404 não trava o
  // loop inteiro.
  useEffect(() => {
    let cancelled = false;
    let done = 0;
    setLoaded(0);
    setTick(0);
    for (const url of urls) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (cancelled) return;
        done += 1;
        setLoaded(done);
      };
      img.onerror = () => {
        if (cancelled) return;
        done += 1;
        setLoaded(done);
      };
      img.src = url;
    }
    return () => {
      cancelled = true;
    };
  }, [urls]);

  // Loop com o FPS do sidecar; só começa depois de todos os frames na mão.
  // frameCount <= 1 é frame único — o <img> estático abaixo cobre o caso.
  useEffect(() => {
    if (count <= 1 || loaded < count) return;
    const intervalMs = Math.max(1, Math.round(1000 / (meta?.fps ?? DEFAULT_ANIM_FPS)));
    const timer = window.setInterval(() => {
      setTick((t) => t + 1);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [count, loaded, meta?.fps]);

  if (count <= 1) {
    const src = count === 1 ? frameUrl(hash, 0) : `/world-blocks/${hash}/base.png`;
    return <img src={src} alt={alt ?? ''} className={className} />;
  }

  const src = urls[frameIndex] ?? urls[0] ?? '';
  return <img src={src} alt={alt ?? ''} className={className} />;
}
