/**
 * Aba Itens — o guarda-roupa do estúdio.
 *
 * Uma peça é uma edição aplicada sobre o corpo base e propagada nas oito
 * direções; vale para qualquer personagem da MESMA silhueta. A tela gira em
 * torno disso: seletor de personagem com a silhueta dele sempre visível,
 * cards com a prévia das oito direções (hover anima o ciclo), criação guiada
 * em sheet e Gerar direto por peça — sem diálogo de custo, e sem deixar gerar
 * o que a silhueta ou a falta de base remota tornariam desperdício.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/motion-ui/skeleton';
import {
  StaggerReveal,
  StaggerRevealHeadline,
  StaggerRevealItem,
} from '@/components/motion-ui/stagger-reveal';
import {
  ExpandCards,
  ExpandCardPanel,
} from '@/components/motion-ui/expand-card';
import { wardrobeKey } from '../../../server/model.ts';
import { api, useSelectedCharacter, useStudio } from '../studio-store.tsx';
import { S } from '../../strings.ts';
import {
  geracoesEmAndamento,
  progressoGeracoes,
  resumoDisparoPecas,
} from '../../strings/itens.ts';
import { ImportCharacterButton } from './import-character-button.tsx';
import { WardrobeCard } from './itens/wardrobe-card.tsx';
import { ItemDetail } from './itens/item-detail.tsx';
import { CreateItemSheet } from './itens/create-item-sheet.tsx';
import {
  GenerateAllItemsButton,
  type DispatchOutcome,
} from './itens/generate-all-button.tsx';
import {
  countGenerating,
  fittingWardrobeItems,
  mergeBatch,
  pendingWardrobeItems,
  type BatchDispatch,
} from './itens/generation-batch.ts';

/** Resumo do último disparo em lote — exibido até o personagem trocar. */
interface BatchSummary {
  readonly characterId: string;
  readonly dispatched: number;
  readonly alreadyReady: number;
  readonly alreadyRunning: number;
  readonly failed: number;
  readonly firstError?: string;
}

function ShirtGlyph() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-muted-foreground"
    >
      <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" />
    </svg>
  );
}

/**
 * Painel de guarda-roupa vazio. Código novo porque o catálogo @motion não tem
 * empty state de painel interno (as seções do registry são de página inteira)
 * — tokens semânticos shadcn, sem CSS de layout novo.
 */
function EmptyState({ onCta }: { readonly onCta: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center">
      <ShirtGlyph />
      <h3 className="text-base font-medium">{S.itens.vazio.titulo}</h3>
      <p className="max-w-md text-pretty text-sm text-muted-foreground">
        {S.itens.vazio.texto}
      </p>
      <Button className="mt-2" onClick={onCta}>
        {S.itens.vazio.cta}
      </Button>
    </div>
  );
}

function ItensLoading() {
  return (
    <div
      className="flex flex-col gap-6"
      aria-busy="true"
      aria-label={S.itens.carregando}
    >
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-4 w-full max-w-lg" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-52" />
        <Skeleton className="h-52" />
      </div>
    </div>
  );
}

export function ItensScreen() {
  const { studio, refresh, error } = useStudio();
  const { characterId, setCharacterId } = useSelectedCharacter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchDispatch | null>(null);
  const [summary, setSummary] = useState<BatchSummary | null>(null);

  if (!studio) return <ItensLoading />;

  // O contexto pode apontar para um personagem que ainda não chegou; cai no
  // primeiro da lista sem tocar no contexto durante o render.
  const character =
    studio.characters.find((c) => c.id === characterId) ?? studio.characters[0];
  if (!character) return null; // o seed sempre traz o manequim

  /** POST solto (Gerar/Tentar de novo) também entra no lote rastreado. */
  const trackDispatch = (key: string): void => {
    setBatch((prev) => mergeBatch(prev, character.id, [key], studio.jobs));
  };

  const generate = async (itemId: string): Promise<void> => {
    setActionError(null);
    try {
      await api<{ key: string }>('generate', {
        method: 'POST',
        body: JSON.stringify({ characterId: character.id, wardrobeId: itemId }),
      });
      trackDispatch(wardrobeKey(character.id, itemId));
      // O 202 já marcou a célula "gerando" — recarrega para o card virar
      // skeleton na hora; o poll de 3s do store cuida do resto.
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionError(`${S.itens.erroGerar} ${message}`);
    }
  };

  // O lote só conhece peças que SERVEM na silhueta — incompatível nunca
  // entra, nem no disparo nem nas contagens do resumo.
  const fitting = fittingWardrobeItems(studio.wardrobe, character);
  const pending = pendingWardrobeItems(studio.wardrobe, character, studio.cells);

  /**
   * Dispara todas as peças pendentes EM PARALELO — um POST /api/generate por
   * peça, Promise.allSettled no cliente e spawn independente por rota no
   * servidor. Célula pronta nunca entra: idempotência não se fura pela UI.
   */
  const generateAllPending = async (): Promise<DispatchOutcome> => {
    const keys = pending.map((w) => wardrobeKey(character.id, w.id));
    setBatch((prev) => mergeBatch(prev, character.id, keys, studio.jobs));
    const alreadyReady = fitting.filter(
      (w) => studio.cells[wardrobeKey(character.id, w.id)]?.status === 'pronto',
    ).length;
    const alreadyRunning = fitting.length - pending.length - alreadyReady;
    const results = await Promise.allSettled(
      pending.map((w) =>
        api<{ key: string }>('generate', {
          method: 'POST',
          body: JSON.stringify({ characterId: character.id, wardrobeId: w.id }),
        }),
      ),
    );
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    const first = rejected[0];
    const firstError =
      first === undefined
        ? undefined
        : first.reason instanceof Error
          ? first.reason.message
          : String(first.reason);
    setSummary({
      characterId: character.id,
      dispatched: results.length - rejected.length,
      alreadyReady,
      alreadyRunning,
      failed: rejected.length,
      ...(firstError !== undefined ? { firstError } : {}),
    });
    await refresh();
    return { total: results.length, failed: rejected.length };
  };

  // Contador de progresso: o lote rastreado dá o "X de Y"; sem lote (página
  // recarregada no meio, por exemplo) cai na contagem simples dos jobs de
  // peça do personagem que ainda estão gerando.
  const tracked = batch !== null && batch.characterId === character.id ? batch : null;
  const trackedRunning =
    tracked !== null ? countGenerating(tracked.keys, studio.jobs) : 0;
  const allRunning = countGenerating(
    studio.wardrobe.map((w) => wardrobeKey(character.id, w.id)),
    studio.jobs,
  );
  const running = trackedRunning > 0 ? trackedRunning : allRunning;
  const progressText =
    running === 0
      ? null
      : tracked !== null && trackedRunning > 0 && tracked.keys.length > running
        ? progressoGeracoes(running, tracked.keys.length)
        : geracoesEmAndamento(running);

  const summaryText =
    summary !== null && summary.characterId === character.id
      ? resumoDisparoPecas(
          summary.dispatched,
          summary.alreadyReady,
          summary.alreadyRunning,
          summary.failed,
          summary.firstError,
        )
      : null;

  const screenError = actionError ?? error;

  return (
    <TooltipProvider delay={200}>
      <StaggerReveal className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex max-w-prose flex-col gap-2">
            <StaggerRevealHeadline
              as="h2"
              className="text-balance text-xl font-semibold"
            >
              {S.itens.titulo}
            </StaggerRevealHeadline>
            <StaggerRevealItem
              as="p"
              className="text-pretty text-sm text-muted-foreground"
            >
              {S.itens.notaGuardaRoupa}
            </StaggerRevealItem>
          </div>
          <StaggerRevealItem className="flex flex-wrap items-center gap-2.5">
            <Select
              value={character.id}
              onValueChange={(v) => {
                if (v !== null) setCharacterId(v);
              }}
            >
              <SelectTrigger
                className="w-52"
                aria-label={S.itens.personagem}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {studio.characters.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="outline">
              {S.itens.silhuetas[character.silhouette]}
            </Badge>
            <ImportCharacterButton strings={S.itens.importar} refresh={refresh} />
            {studio.wardrobe.length > 0 && (
              <GenerateAllItemsButton
                hasRemoteId={character.remoteId !== undefined}
                pendingCount={pending.length}
                onGenerateAll={generateAllPending}
              />
            )}
            <Button onClick={() => setSheetOpen(true)}>
              {S.itens.novaPeca}
            </Button>
          </StaggerRevealItem>
        </div>

        {progressText !== null && (
          <p role="status" className="text-xs text-muted-foreground">
            {progressText}
          </p>
        )}
        {summaryText !== null && (
          <p role="status" className="text-xs text-muted-foreground">
            {summaryText}
          </p>
        )}

        {studio.wardrobe.length === 0 ? (
          <StaggerRevealItem>
            <EmptyState onCta={() => setSheetOpen(true)} />
          </StaggerRevealItem>
        ) : (
          <ExpandCards>
            <div role="list" className="grid items-stretch gap-4 sm:grid-cols-2">
              {studio.wardrobe.map((item) => (
                <StaggerRevealItem key={item.id} className="h-full">
                  <div role="listitem" className="h-full">
                    <WardrobeCard
                      item={item}
                      cell={studio.cells[wardrobeKey(character.id, item.id)]}
                      character={character}
                      onGenerate={() => void generate(item.id)}
                    />
                  </div>
                </StaggerRevealItem>
              ))}
            </div>
            <ExpandCardPanel
              className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl"
              contentClassName="flex max-h-[85vh] flex-col gap-5 overflow-y-auto p-6"
              labelledBy={(id) => `item-${id}-titulo`}
            >
              {({ id }) => {
                const item = studio.wardrobe.find((w) => w.id === id);
                if (!item) return null;
                return (
                  <ItemDetail
                    item={item}
                    cell={studio.cells[wardrobeKey(character.id, item.id)]}
                    character={character}
                    onGenerate={() => void generate(item.id)}
                  />
                );
              }}
            </ExpandCardPanel>
          </ExpandCards>
        )}

        {screenError !== null && (
          <p role="alert" className="text-sm text-destructive">
            {screenError}
          </p>
        )}

        <CreateItemSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          silhouette={character.silhouette}
          onCreated={refresh}
        />
      </StaggerReveal>
    </TooltipProvider>
  );
}
