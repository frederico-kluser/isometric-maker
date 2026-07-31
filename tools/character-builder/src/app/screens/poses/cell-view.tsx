import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Skeleton } from '@/components/motion-ui/skeleton';
import type { Cell, Direction } from '../../../../server/model.ts';
import { poses as t } from '../../../strings/poses.ts';
import { DirectionThumb } from './direction-thumb.tsx';

interface CellViewProps {
  /** Célula (character × pose) ou (character × direções8); ausente = vazio. */
  readonly cell: Cell | undefined;
  /** Direção desta coluna da grade. */
  readonly direction: Direction;
  /** Base do texto alternativo da thumbnail (ex.: "Parado · sul"). */
  readonly alt: string;
}

/**
 * Uma célula da grade poses × 8 direções. Os quatro estados visíveis:
 * pronto (thumbnail que anima no hover), gerando (skeleton), falhou
 * (selo com o erro em tooltip) e vazio/na-fila (placeholder tracejado).
 */
export function CellView({ cell, direction, alt }: CellViewProps) {
  const frames = cell?.frames?.[direction];

  if (cell?.status === 'pronto' && frames !== undefined && frames.length > 0) {
    return <DirectionThumb frames={frames} alt={alt} />;
  }

  if (cell?.status === 'gerando') {
    return <Skeleton className="size-16" />;
  }

  if (cell?.status === 'falhou') {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              tabIndex={0}
              className="flex size-16 items-center justify-center rounded-md border border-destructive/40"
            />
          }
        >
          <Badge variant="destructive">{t.statusFalhou}</Badge>
        </TooltipTrigger>
        <TooltipContent>{cell.error ?? t.erroDesconhecido}</TooltipContent>
      </Tooltip>
    );
  }

  const queued = cell?.status === 'na-fila';
  return (
    <div
      className="flex size-16 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground"
      title={queued ? t.statusNaFila : t.statusVazio}
    >
      {queued ? '·' : ''}
    </div>
  );
}
