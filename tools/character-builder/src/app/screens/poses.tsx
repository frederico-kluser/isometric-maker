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
import {
  DIRECTION_LABELS,
  apenasFps,
  detalheAcao,
  framesEFps,
  idRemotoCurto,
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
import { GenerateButton } from './poses/generate-button.tsx';
import { PoseForm } from './poses/pose-form.tsx';

interface PoseRowProps {
  readonly pose: Pose;
  readonly cell: Cell | undefined;
  readonly character: Character;
  /** frameCount efetivo: o do lock quando existe, senão o legado da pose. */
  readonly frameCount: number | undefined;
  readonly onDone: () => Promise<void>;
}

/** Uma linha da grade: rótulo da pose, 8 células de direção e as ações. */
function PoseRow({ pose, cell, character, frameCount, onDone }: PoseRowProps) {
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
  const { studio, refresh, busy, error } = useStudio();
  const { characterId, setCharacterId } = useSelectedCharacter();

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
        {busy ? (
          <p className="text-xs text-muted-foreground">
            {t.geracaoEmAndamento}
          </p>
        ) : null}
        {error !== null ? (
          <p className="text-xs text-destructive">
            {t.erroCarga}: {error}
          </p>
        ) : null}

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t.gridTitle}</h2>
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
