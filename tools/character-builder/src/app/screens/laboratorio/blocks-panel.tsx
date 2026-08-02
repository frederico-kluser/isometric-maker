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
 */
import { useEffect, useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MultiStateButton } from '@/components/motion-ui/multi-state-button';
import {
  SegmentedToggle,
  SegmentedToggleOption,
} from '@/components/motion-ui/segmented-toggle';
import { Skeleton } from '@/components/motion-ui/skeleton';
import {
  buildWorldBlockBody,
  type BlockErrorCode,
  type WorldBlockAccepted,
  type WorldBlockResult,
  type WorldBlockStatus,
} from './blocks-body.ts';

const CLIENT_ERROR_TEXT: Record<BlockErrorCode, string> = {
  'description-missing': SB.erros.descricaoObrigatoria,
};

type ButtonState = 'idle' | 'running' | 'done' | 'error';

interface CatalogEntry {
  readonly hash: string;
  readonly description: string;
  readonly shape: string;
  readonly technique: 'chained' | 'rotated' | 'texture';
  readonly faceUrls?: Record<BlockFacing, string>;
  readonly spritesheetUrl?: string;
  readonly frameCount?: number;
  readonly fps?: number;
}

export function BlocksPanel() {
  const [description, setDescription] = useState('');
  const [frameCount, setFrameCount] = useState<4 | 8 | 16>(8);
  const [fps, setFps] = useState(8);

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

  const running = buttonState === 'running';

  const loadCatalog = (): void => {
    void api<{ blocks: CatalogEntry[] }>('world-blocks')
      .then((r) => setCatalog(r.blocks))
      .catch(() => setCatalog([]));
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
    const built = buildWorldBlockBody({ description, frameCount, fps });
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
              <CardTitle>{SB.animacao.cartao}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Badge variant="secondary" className="w-fit">
                {SB.form.custo}
              </Badge>
              <div className="flex flex-col gap-1.5">
                <Label>{SB.form.frameCountRotulo}</Label>
                <SegmentedToggle
                  value={String(frameCount)}
                  onChange={(v) => setFrameCount(Number(v) as 4 | 8 | 16)}
                  ariaLabel={SB.form.frameCountRotulo}
                >
                  {[4, 8, 16].map((n) => (
                    <SegmentedToggleOption key={n} value={String(n)}>
                      {n}
                    </SegmentedToggleOption>
                  ))}
                </SegmentedToggle>
                <p className="text-xs text-muted-foreground">{SB.form.frameCountNota}</p>
              </div>
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
                  <img
                    src={`/world-blocks/${result.hash}/frames/frame_000.png`}
                    alt={description}
                    className="max-h-24 w-full object-contain [image-rendering:pixelated]"
                  />
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
                    {catalog.map((b) => (
                      <div
                        key={b.hash}
                        className="flex flex-col items-center gap-1 rounded-lg border border-border bg-muted/30 p-2"
                      >
                        <img
                          src={b.technique === 'texture'
                            ? `/world-blocks/${b.hash}/frames/frame_000.png`
                            : (b.faceUrls?.north ?? '')}
                          alt={b.description}
                          className="h-16 w-16 object-contain [image-rendering:pixelated]"
                        />
                        <span className="line-clamp-2 text-center text-xs leading-tight">
                          {b.description}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {b.technique === 'texture'
                            ? `${b.frameCount ?? '?'}f ${b.fps ?? '?'}fps`
                            : b.shape}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {SB.catalogo.tecnica[b.technique as 'chained' | 'rotated' | 'texture'] ?? b.technique}
                        </Badge>
                      </div>
                    ))}
                  </div>
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
