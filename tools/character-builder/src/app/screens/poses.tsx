import { useState } from 'react';
import {
  DIRECTIONS,
  DIR_SHORT,
  cellKey,
  directions8Key,
  type Cell,
  type Character,
  type Pose,
} from '../../../server/model.ts';
import {
  useSelectedCharacter,
  useStudio,
} from '../studio-store.tsx';
import { api } from '../studio-store.tsx';
import {
  DIRECTION_LABELS,
  apenasFps,
  detalheAcao,
  framesEFps,
  geracoesEmAndamento,
  idRemotoCurto,
  progressoGeracoes,
  resumoDisparoPoses,
  poses as t,
} from '../../strings/poses.ts';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/motion-ui/skeleton';
import { CellView } from './poses/cell-view.tsx';
import { DeletePoseButton } from './poses/delete-pose-button.tsx';
import { GenerateAllButton, type DispatchOutcome } from './poses/generate-all-button.tsx';
import { GenerateButton } from './poses/generate-button.tsx';
import { PoseForm } from './poses/pose-form.tsx';
import {
  countGenerating,
  mergeBatch,
  pendingPoses,
  type BatchDispatch,
} from './poses/generation-batch.ts';

/** Resumo do último disparo em lote — exibido até o personagem trocar. */
interface BatchSummary {
  readonly characterId: string;
  readonly dispatched: number;
  readonly alreadyReady: number;
  readonly alreadyRunning: number;
  readonly failed: number;
  readonly firstError?: string;
}

interface PoseRowProps {
  readonly pose: Pose;
  readonly cell: Cell | undefined;
  readonly character: Character;
  /** frameCount efetivo: o do lock quando existe, senão o legado da pose. */
  readonly frameCount: number | undefined;
  readonly onDone: () => Promise<void>;
  /** Encaminha o POST solto (Gerar/Tentar de novo) ao contador de lote. */
  readonly onDispatched: (key: string) => void;
}

/** Uma linha da grade: rótulo da pose, 8 células de direção e as ações. */
function PoseRow({ pose, cell, character, frameCount, onDone, onDispatched }: PoseRowProps) {
  const kindTag =
    pose.kind === 'template'
      ? t.tagTemplate
      : pose.kind === 'action'
        ? t.tagTexto
        : pose.kind;
  const detail =
    pose.kind === 'template'
      ? pose.templateId
      : pose.kind === 'action'
        ? pose.action
        : undefined;

  return (
    <tr className="border-b border-border last:border-0">
      <th scope="row" className="p-2 text-left align-top font-normal">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{pose.label}</span>
          <Badge variant="outline">{kindTag}</Badge>
          {pose.builtin ? (
            <Badge variant="secondary">{t.tagFixa}</Badge>
          ) : null}
        </div>
        <div className="mt-1 text-xs whitespace-nowrap text-muted-foreground">
          {detail !== undefined && detail !== '' ? (
            <span>{detalheAcao(detail)} · </span>
          ) : null}
          {frameCount !== undefined
            ? framesEFps(frameCount, pose.fps)
            : apenasFps(pose.fps)}
        </div>
      </th>
      {DIRECTIONS.map((d) => (
        <td key={d} className="p-1.5 align-top">
          <CellView
            cell={cell}
            direction={d}
            alt={`${pose.label} · ${DIRECTION_LABELS[d]}`}
          />
        </td>
      ))}
      <td className="p-1.5 align-top">
        <div className="flex flex-col items-start gap-1.5">
          <GenerateButton
            characterId={character.id}
            hasRemoteId={character.remoteId !== undefined}
            pose={pose}
            cell={cell}
            onDone={onDone}
            onDispatched={onDispatched}
          />
          {pose.builtin ? null : (
            <DeletePoseButton pose={pose} onDone={onDone} />
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * Aba Poses — grade poses × 8 direções.
 *
 * A tela nunca fala com a PixelLab diretamente: lê o estado do `/api/studio`
 * (com poll de 3s enquanto há geração) e dispara gerações pelo servidor,
 * que é dono do token e do registro de jobs — recarregar a página não perde
 * trabalho que já foi pago. Sem diálogo de custo: o guard de orçamento vive
 * no servidor (ADR 0012) e nunca aparece aqui.
 */
export function PosesScreen() {
  const { studio, refresh, error } = useStudio();
  const { characterId, setCharacterId } = useSelectedCharacter();
  const [batch, setBatch] = useState<BatchDispatch | null>(null);
  const [summary, setSummary] = useState<BatchSummary | null>(null);

  if (studio === undefined) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-44 w-full" />
      </div>
    );
  }

  const character =
    studio.characters.find((c) => c.id === characterId) ??
    studio.characters[0];

  if (character === undefined) {
    return <p className="text-muted-foreground">{t.erroCarga}</p>;
  }

  const lock = studio.lock;
  const baseCell = studio.cells[directions8Key(character.id)];
  const pending = pendingPoses(character.id, studio.poses, studio.cells);

  /** POST solto (Gerar/Tentar de novo) também entra no lote rastreado. */
  const trackDispatch = (key: string): void => {
    setBatch((prev) => mergeBatch(prev, character.id, [key], studio.jobs));
  };

  /**
   * Dispara todas as poses pendentes EM PARALELO — um POST /api/generate por
   * pose, Promise.allSettled no cliente e spawn independente por rota no
   * servidor. Célula pronta nunca entra: idempotência não se fura pela UI.
   */
  const generateAllPending = async (): Promise<DispatchOutcome> => {
    const keys = pending.map((p) => cellKey(character.id, p.id));
    setBatch((prev) => mergeBatch(prev, character.id, keys, studio.jobs));
    const alreadyReady = studio.poses.filter(
      (p) => studio.cells[cellKey(character.id, p.id)]?.status === 'pronto',
    ).length;
    const alreadyRunning =
      studio.poses.length - pending.length - alreadyReady;
    const results = await Promise.allSettled(
      pending.map((p) =>
        api<{ key: string }>('generate', {
          method: 'POST',
          body: JSON.stringify({ characterId: character.id, poseId: p.id }),
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
    // Os 202 já marcaram as células "gerando" — recarrega para a grade virar
    // skeleton na hora; o poll de 3s do store cuida do resto.
    await refresh();
    return { total: results.length, failed: rejected.length };
  };

  // Contador de progresso: o lote rastreado dá o "X de Y"; sem lote (página
  // recarregada no meio, por exemplo) cai na contagem simples dos jobs de
  // pose do personagem que ainda estão gerando.
  const tracked = batch !== null && batch.characterId === character.id ? batch : null;
  const trackedRunning =
    tracked !== null ? countGenerating(tracked.keys, studio.jobs) : 0;
  const allRunning = countGenerating(
    studio.poses.map((p) => cellKey(character.id, p.id)),
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
      ? resumoDisparoPoses(
          summary.dispatched,
          summary.alreadyReady,
          summary.alreadyRunning,
          summary.failed,
          summary.firstError,
        )
      : null;

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>{t.characterLabel}</Label>
            <Select
              value={character.id}
              onValueChange={(value) => setCharacterId(String(value))}
            >
              <SelectTrigger>
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
          </div>
          <PoseForm lock={lock} onDone={refresh} />
        </div>

        {!studio.hasToken ? (
          <p className="text-xs text-muted-foreground">{t.semToken}</p>
        ) : null}
        {progressText !== null ? (
          <p role="status" className="text-xs text-muted-foreground">
            {progressText}
          </p>
        ) : null}
        {error !== null ? (
          <p className="text-xs text-destructive">
            {t.erroCarga}: {error}
          </p>
        ) : null}

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{t.gridTitle}</h2>
            <GenerateAllButton
              hasRemoteId={character.remoteId !== undefined}
              pendingCount={pending.length}
              onGenerateAll={generateAllPending}
            />
          </div>
          {summaryText !== null ? (
            <p role="status" className="text-xs text-muted-foreground">
              {summaryText}
            </p>
          ) : null}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="p-2 text-left font-medium">{t.colPose}</th>
                  {DIRECTIONS.map((d) => (
                    <th
                      key={d}
                      title={DIRECTION_LABELS[d]}
                      className="p-2 font-medium"
                    >
                      {DIR_SHORT[d]}
                    </th>
                  ))}
                  <th className="p-2 text-left font-medium">{t.colAction}</th>
                </tr>
              </thead>
              <tbody>
                {/* A linha base vem primeiro: nada mais pode ser gerado antes
                    dela — toda pose se deriva do modelo base. */}
                <tr className="border-b border-border">
                  <th
                    scope="row"
                    className="p-2 text-left align-top font-normal"
                  >
                    <div className="font-medium">{t.baseTitle}</div>
                    <div className="mt-1 text-xs whitespace-nowrap text-muted-foreground">
                      {character.remoteId !== undefined
                        ? idRemotoCurto(character.remoteId)
                        : t.baseSemId}
                    </div>
                  </th>
                  {DIRECTIONS.map((d) => (
                    <td key={d} className="p-1.5 align-top">
                      <CellView
                        cell={baseCell}
                        direction={d}
                        alt={`${t.baseTitle} · ${DIRECTION_LABELS[d]}`}
                      />
                    </td>
                  ))}
                  <td className="max-w-40 p-1.5 align-top text-xs text-muted-foreground">
                    {t.basePeloWizard}
                  </td>
                </tr>
                {studio.poses.map((pose) => (
                  <PoseRow
                    key={pose.id}
                    pose={pose}
                    cell={studio.cells[cellKey(character.id, pose.id)]}
                    character={character}
                    frameCount={lock?.frameCount ?? pose.frameCount}
                    onDone={refresh}
                    onDispatched={trackDispatch}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </TooltipProvider>
  );
}
