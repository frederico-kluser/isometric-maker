/**
 * Card de uma peça do guarda-roupa.
 *
 * A parte superior é o ExpandCardTrigger (clique abre o detalhe); a barra
 * inferior fica FORA do trigger porque um <button> não pode viver dentro de
 * outro — visualmente é um card só. Peça de silhueta incompatível ganha borda
 * tracejada destrutiva, badge "Não serve neste corpo" e o Gerar desabilitado:
 * a recusa acontece na UI antes de qualquer gasto, como no servidor.
 */
import { useEffect, useRef } from 'react';
import { CheckIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ExpandCardTrigger } from '@/components/motion-ui/expand-card';
import { MultiStateButton } from '@/components/motion-ui/multi-state-button';
import type { Cell, Character, WardrobeItem } from '../../../../server/model.ts';
import { S } from '../../../strings.ts';
import {
  silhuetaIncompativelDetalhe,
  tooltipSilhuetaIncompativel,
  ariaAbrirDetalhe,
} from '../../../strings/itens.ts';
import { itemStatus, type ItemStatus } from './item-state.ts';
import { DirectionStrip } from './direction-strip.tsx';

export interface WardrobeCardProps {
  readonly item: WardrobeItem;
  readonly cell: Cell | undefined;
  readonly character: Character;
  readonly onGenerate: () => void;
}

function SpinnerGlyph() {
  return (
    <svg
      className="size-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.2-8.56" />
    </svg>
  );
}

/** Linha de estado exibida ao lado do botão Gerar. */
export function statusLine(status: ItemStatus): string {
  if (status.availability === 'mismatch') return S.itens.gerar.naoServe;
  if (status.availability === 'no-base') return S.itens.estado.semBase;
  switch (status.action) {
    case 'working':
      return S.itens.estado.gerando;
    case 'done':
      return S.itens.estado.pronto;
    case 'retry':
      return S.itens.estado.falhou;
    default:
      return S.itens.estado.vazio;
  }
}

/**
 * Botão Gerar com os estados idle/working/done/retry/blocked. O feedback
 * (pop/shake) só toca numa TRANSIÇÃO de estado — na montagem o botão abre
 * quieto, senão toda peça pronta daria pop ao abrir a aba.
 */
export type GenerateButtonProps = WardrobeCardProps & {
  readonly status: ItemStatus;
};

export function GenerateButton({
  item,
  character,
  status,
  onGenerate,
}: GenerateButtonProps) {
  const prev = useRef(status.action);
  const transitioned = prev.current !== status.action;
  useEffect(() => {
    prev.current = status.action;
  }, [status.action]);
  const feedback = !transitioned
    ? 'none'
    : status.action === 'done'
      ? 'pop'
      : status.action === 'retry'
        ? 'shake'
        : 'none';

  const label =
    status.action === 'working'
      ? S.itens.gerar.working
      : status.action === 'done'
        ? S.itens.gerar.done
        : status.action === 'retry'
          ? S.itens.gerar.retry
          : S.itens.gerar.idle;

  const surface =
    status.action === 'done' || status.action === 'working'
      ? 'bg-secondary text-secondary-foreground'
      : status.action === 'retry'
        ? 'bg-destructive/15 text-destructive'
        : status.action === 'blocked'
          ? 'bg-muted text-muted-foreground'
          : 'bg-primary text-primary-foreground';

  const tooltip =
    status.availability === 'mismatch'
      ? tooltipSilhuetaIncompativel(
          S.itens.silhuetas[item.silhouette],
          S.itens.silhuetas[character.silhouette],
        )
      : status.availability === 'no-base'
        ? S.itens.gerar.semBase
        : status.action === 'done'
          ? S.itens.gerar.jaGerada
          : undefined;

  const icon =
    status.action === 'working' ? (
      <SpinnerGlyph />
    ) : status.action === 'done' ? (
      <CheckIcon className="size-3.5" />
    ) : undefined;

  const button = (
    <MultiStateButton
      state={status.action}
      surfaceClassName={surface}
      pillClassName="rounded-md px-3 py-1.5 text-xs font-medium"
      feedback={feedback}
      disabled={!status.canGenerate}
      onClick={onGenerate}
      icon={icon}
    >
      {label}
    </MultiStateButton>
  );

  // O botão desabilitado fica pointer-events-none — o tooltip precisa de um
  // invólucro que continue recebendo hover.
  if (tooltip === undefined) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        {button}
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function WardrobeCard(props: WardrobeCardProps) {
  const { item, cell } = props;
  const status = itemStatus(item, props.character, cell);
  const mismatch = status.availability === 'mismatch';

  return (
    <div
      className={`flex h-full flex-col overflow-hidden rounded-xl border bg-card ${
        mismatch ? 'border-dashed border-destructive/50' : 'border-border'
      }`}
    >
      <ExpandCardTrigger
        id={item.id}
        aria-label={ariaAbrirDetalhe(item.label, S.itens.slots[item.slot])}
        className="flex h-full flex-1 flex-col gap-3 p-4 transition-colors hover:bg-accent/40"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="leading-snug font-medium">{item.label}</h3>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <Badge variant="secondary">{S.itens.slots[item.slot]}</Badge>
            {mismatch && (
              <Badge variant="destructive">{S.itens.gerar.naoServe}</Badge>
            )}
          </div>
        </div>
        <p className="line-clamp-2 text-sm text-muted-foreground">
          “{item.editDescription}”
        </p>
        <div className="mt-auto pt-1">
          {mismatch ? (
            <p className="text-xs text-destructive/90">
              {silhuetaIncompativelDetalhe(
                S.itens.silhuetas[item.silhouette],
                S.itens.silhuetas[props.character.silhouette],
              )}
            </p>
          ) : status.action === 'working' ? (
            <DirectionStrip frames={undefined} loading />
          ) : status.action === 'done' ? (
            <DirectionStrip frames={cell?.frames} />
          ) : (
            <div className="flex flex-col gap-2">
              <DirectionStrip frames={undefined} />
              {status.action === 'retry' && (
                <p className="text-xs text-destructive">
                  {cell?.error ?? S.itens.estado.falhou}
                </p>
              )}
            </div>
          )}
        </div>
      </ExpandCardTrigger>
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
        <span
          className={`text-xs ${status.action === 'retry' ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {statusLine(status)}
        </span>
        <GenerateButton {...props} status={status} />
      </div>
    </div>
  );
}
