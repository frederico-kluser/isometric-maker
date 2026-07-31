/**
 * Faixa de prévia das oito direções de uma peça.
 *
 * Uma célula por direção, na ordem canônica do model. Quando a direção tem
 * mais de um frame, o hover anima o ciclo (como o painel antigo fazia, a
 * ~9fps) e o mouseleave devolve o primeiro frame. Direção sem arte fica um
 * placeholder tracejado; `loading` troca a faixa inteira por bones do
 * skeleton do registry @motion.
 */
import { useEffect, useRef, useState } from 'react';
import {
  DIRECTIONS,
  DIR_SHORT,
  type Direction,
} from '../../../../server/model.ts';
import { Skeleton } from '@/components/motion-ui/skeleton';

/** Cadência do ciclo no hover — a mesma do painel antigo. */
const FRAME_MS = 110;

export type StripSize = 'sm' | 'lg';

interface DirectionStripProps {
  /** Frames por direção (paths `/assets/…`), ou undefined quando não há arte. */
  readonly frames: Record<string, string[]> | undefined;
  /** true mostra bones animados no lugar dos thumbs (peça gerando). */
  readonly loading?: boolean;
  readonly size?: StripSize;
}

function DirectionThumb({
  dir,
  frames,
}: {
  readonly dir: Direction;
  readonly frames: readonly string[];
}) {
  const [frame, setFrame] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  const stop = (): void => {
    if (timer.current !== undefined) window.clearInterval(timer.current);
    timer.current = undefined;
    setFrame(0);
  };

  // Se a peça trocar de personagem/estado com o timer no ar, o ciclo morre junto.
  useEffect(() => stop, []);

  const start = (): void => {
    if (frames.length < 2 || timer.current !== undefined) return;
    timer.current = window.setInterval(
      () => setFrame((f) => (f + 1) % frames.length),
      FRAME_MS,
    );
  };

  const src = frames[frame] ?? frames[0];
  if (!src) return null;
  return (
    <img
      src={src}
      alt={dir}
      title={dir}
      draggable={false}
      onMouseEnter={start}
      onMouseLeave={stop}
      className="size-full object-contain [image-rendering:pixelated]"
    />
  );
}

function StripCell({
  dir,
  frames,
  loading,
  dim,
}: {
  readonly dir: Direction;
  readonly frames: readonly string[] | undefined;
  readonly loading: boolean;
  readonly dim: string;
}) {
  const hasArt = !loading && frames !== undefined && frames.length > 0;
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`${dim} overflow-hidden rounded-md border bg-muted/40 ${
          hasArt || loading ? 'border-border' : 'border-dashed border-border'
        }`}
      >
        {loading ? (
          <Skeleton className="size-full rounded-md" />
        ) : hasArt ? (
          <DirectionThumb dir={dir} frames={frames} />
        ) : null}
      </div>
      <span className="text-[10px] leading-none font-medium text-muted-foreground">
        {DIR_SHORT[dir]}
      </span>
    </div>
  );
}

export function DirectionStrip({
  frames,
  loading = false,
  size = 'sm',
}: DirectionStripProps) {
  const dim = size === 'lg' ? 'size-16' : 'size-9';
  return (
    <div className="flex flex-wrap items-start gap-1.5">
      {DIRECTIONS.map((dir) => (
        <StripCell
          key={dir}
          dir={dir}
          frames={frames?.[dir]}
          loading={loading}
          dim={dim}
        />
      ))}
    </div>
  );
}
