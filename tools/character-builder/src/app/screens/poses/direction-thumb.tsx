import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { hoverAnima } from '../../../strings/poses.ts';

/**
 * Cadastro do ciclo no hover — o mesmo da grade antiga (~110ms por frame),
 * rápido o bastante para julgar uma animação sem abrir nada.
 */
const HOVER_FRAME_MS = 110;

interface DirectionThumbProps {
  /** Frames da direção, em paths `/assets/…`; o primeiro é o repouso. */
  readonly frames: readonly string[];
  /** Texto alternativo da imagem (pose ou base + direção). */
  readonly alt: string;
}

/**
 * Thumbnail de uma direção. Com mais de um frame, anima em ciclo no hover
 * e volta ao frame de repouso ao sair — comportamento portado da grade
 * vanilla. Sob `prefers-reduced-motion` o ciclo não roda: o hover mostra
 * sempre o frame de repouso.
 */
export function DirectionThumb({ frames, alt }: DirectionThumbProps) {
  const [index, setIndex] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const reducedMotion = useReducedMotion() ?? false;
  const canCycle = frames.length > 1 && !reducedMotion;

  const stop = (): void => {
    window.clearInterval(timer.current);
    timer.current = undefined;
    setIndex(0);
  };

  const start = (): void => {
    if (!canCycle || timer.current !== undefined) return;
    timer.current = window.setInterval(() => {
      setIndex((i) => (i + 1) % frames.length);
    }, HOVER_FRAME_MS);
  };

  useEffect(() => () => window.clearInterval(timer.current), []);

  const current = frames[Math.min(index, frames.length - 1)] ?? frames[0];
  if (current === undefined) return null;

  return (
    <div
      className="flex size-16 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40"
      onMouseEnter={start}
      onMouseLeave={stop}
      title={canCycle ? `${alt} — ${hoverAnima(frames.length)}` : alt}
    >
      <img
        src={current}
        alt={alt}
        draggable={false}
        className="size-16 object-contain [image-rendering:pixelated]"
      />
    </div>
  );
}
