/**
 * Painel "Blocos do mundo" — bancada das duas técnicas de bloco (ADR 0029).
 *
 * Mesma forma do painel de sprite sul: POST devolve 202 {key, hash} e o
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
import {
  BLOCK_FACINGS,
  BLOCK_TECHNIQUES,
  TILE_DETAILS,
  TILE_OUTLINES,
  TILE_SHADINGS,
  TILE_SHAPES,
  TILE_UNIT_SIZES,
  type BlockFacing,
} from '../../../../server/model.ts';
// Módulo PURO do iso-core: só a geometria, para mostrar o molde em escala.
import { CANONICAL_CUBE } from '../../../../../../packages/iso-core/src/iso-cube.ts';
import { blocos as SB, custoEstimado } from '../../../strings/blocos.ts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  'seed-invalid': SB.erros.seedInvalida,
  'guidance-invalid': SB.erros.guidanceInvalida,
};

/** Base UI Select não aceita item com value "" — 'default' vira "não enviar". */
const API_DEFAULT = 'default';

/**
 * O gatilho do Select mostra o VALOR selecionado, não o rótulo do item — então
 * sem isto a tela exibia `default` cru, em inglês, apesar de a lista mostrar
 * "padrão da API". Todo texto que o usuário lê é pt-BR (ADR 0016), e o gatilho
 * é texto que o usuário lê.
 */
const rotulo = (v: unknown, sufixo = ''): string =>
  v === API_DEFAULT || v === null || v === undefined
    ? SB.form.padraoApi
    : `${String(v)}${sufixo}`;

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
  const [shape, setShape] = useState<string>('block');
  const [tileUnit, setTileUnit] = useState(API_DEFAULT);
  const [outline, setOutline] = useState(API_DEFAULT);
  const [shading, setShading] = useState(API_DEFAULT);
  const [detail, setDetail] = useState(API_DEFAULT);
  const [guidanceText, setGuidanceText] = useState('');
  const [seedText, setSeedText] = useState('');
  const [technique, setTechnique] = useState<string>('chained');
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
    const built = buildWorldBlockBody({
      description,
      shape,
      tileUnitSize: tileUnit === API_DEFAULT ? '' : tileUnit,
      outline: outline === API_DEFAULT ? '' : outline,
      shading: shading === API_DEFAULT ? '' : shading,
      detail: detail === API_DEFAULT ? '' : detail,
      guidanceText,
      seedText,
      technique,
      frameCount: technique === 'texture' ? frameCount : undefined,
      fps: technique === 'texture' ? fps : undefined,
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

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="bloco-shape">{SB.form.formaRotulo}</Label>
                  <Select
                    value={shape}
                    onValueChange={(v) => {
                      if (v !== null) setShape(v);
                    }}
                  >
                    <SelectTrigger id="bloco-shape" className="w-full">
                      <SelectValue>{(v) => rotulo(v)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {TILE_SHAPES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="bloco-unit">{SB.form.unidadeRotulo}</Label>
                  <Select
                    value={tileUnit}
                    onValueChange={(v) => {
                      if (v !== null) setTileUnit(v);
                    }}
                  >
                    <SelectTrigger id="bloco-unit" className="w-full">
                      <SelectValue>{(v) => rotulo(v)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={API_DEFAULT}>{SB.form.padraoApi}</SelectItem>
                      {TILE_UNIT_SIZES.map((s) => (
                        <SelectItem key={s} value={String(s)}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {SB.form.formaNota} {SB.form.unidadeNota}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{SB.form.cartaoTecnica}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>{SB.form.tecnicaRotulo}</Label>
                <SegmentedToggle
                  value={technique}
                  onChange={(v) => setTechnique(v)}
                  ariaLabel={SB.form.tecnicaRotulo}
                >
                  {BLOCK_TECHNIQUES.map((t) => (
                    <SegmentedToggleOption key={t} value={t}>
                      {t === 'chained' ? SB.form.tecnicaEncadeada
                        : t === 'rotated' ? SB.form.tecnicaRotate
                        : SB.form.tecnicaTextura}
                    </SegmentedToggleOption>
                  ))}
                </SegmentedToggle>
                <p className="text-xs text-muted-foreground">
                  {technique === 'chained'
                    ? SB.form.tecnicaEncadeadaNota
                    : technique === 'rotated'
                    ? SB.form.tecnicaRotateNota
                    : SB.form.tecnicaTexturaNota}
                </p>
              </div>

              <Badge variant="secondary" className="w-fit">
                {custoEstimado(technique)}
              </Badge>
            </CardContent>
          </Card>

          {technique === 'texture' && (
            <Card>
              <CardHeader>
                <CardTitle>{SB.animacao.cartao}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
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
          )}

          {technique !== 'texture' && (
          <Card>
            <CardHeader>
              <CardTitle>{SB.form.cartaoQualidade}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-3">
                {(
                  [
                    ['bloco-outline', SB.form.outlineRotulo, outline, setOutline, TILE_OUTLINES],
                    ['bloco-shading', SB.form.shadingRotulo, shading, setShading, TILE_SHADINGS],
                    ['bloco-detail', SB.form.detailRotulo, detail, setDetail, TILE_DETAILS],
                  ] as const
                ).map(([id, label, value, setter, options]) => (
                  <div key={id} className="flex flex-col gap-1.5">
                    <Label htmlFor={id}>{label}</Label>
                    <Select
                      value={value}
                      onValueChange={(v) => {
                        if (v !== null) (setter as (s: string) => void)(v);
                      }}
                    >
                      <SelectTrigger id={id} className="w-full">
                        <SelectValue>{(v) => rotulo(v)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={API_DEFAULT}>{SB.form.padraoApi}</SelectItem>
                        {options.map((o) => (
                          <SelectItem key={o} value={o}>
                            {o}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="bloco-guidance">{SB.form.guidanceRotulo}</Label>
                  <Input
                    id="bloco-guidance"
                    type="number"
                    step={0.5}
                    min={1}
                    max={20}
                    value={guidanceText}
                    onChange={(e) => setGuidanceText(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{SB.form.guidanceNota}</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="bloco-seed">{SB.form.seedRotulo}</Label>
                  <Input
                    id="bloco-seed"
                    type="number"
                    step={1}
                    placeholder={SB.form.seedPlaceholder}
                    value={seedText}
                    onChange={(e) => setSeedText(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{SB.form.seedNota}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          )}

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
                  <div className="grid grid-cols-4 gap-2">
                    {BLOCK_FACINGS.map((f) => (
                      <Skeleton key={f} className="h-24 w-full" />
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground" role="status">
                    {SB.resultado.aguardando}
                  </p>
                </>
              ) : result === null ? (
                <p className="text-sm text-muted-foreground">{SB.resultado.vazio}</p>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-2">
                    {result.faces.map((f) => (
                      <div key={f.facing} className="flex flex-col items-center gap-1">
                        <img
                          src={`data:image/png;base64,${f.pngB64}`}
                          alt={SB.resultado.face[f.facing]}
                          className="max-h-24 w-full object-contain [image-rendering:pixelated]"
                        />
                        <span className="text-xs text-muted-foreground">
                          {SB.resultado.face[f.facing]}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {SB.catalogo.tecnica[result.technique as 'chained' | 'rotated' | 'texture'] ??
                        result.technique}
                    </Badge>
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
