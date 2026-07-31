import { motion } from 'motion/react';
import { useHoldToConfirm } from '@/components/motion-ui/hold-to-confirm';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { Pose } from '../../../../server/model.ts';
import { api } from '../../studio-store.tsx';
import { excluirPose, poses as t } from '../../../strings/poses.ts';

interface DeletePoseButtonProps {
  readonly pose: Pose;
  /** Recarrega o estúdio depois da exclusão. */
  readonly onDone: () => Promise<void>;
}

/**
 * Exclusão de pose não-builtin (DELETE /api/poses). Usa o hook headless
 * `useHoldToConfirm` do registry com superfície própria — o HoldToConfirmButton
 * pronto tem largura fixa de formulário (w-60) e não cabe na coluna de ação
 * da grade. O preenchimento destrutivo é o progresso do gesto; soltar antes
 * cancela.
 */
export function DeletePoseButton({ pose, onDone }: DeletePoseButtonProps) {
  const { progress, holdHandlers } = useHoldToConfirm({
    holdSeconds: 1,
    onConfirm: () => {
      void (async () => {
        try {
          await api('poses', {
            method: 'DELETE',
            body: JSON.stringify({ id: pose.id }),
          });
        } finally {
          await onDone();
        }
      })();
    },
  });

  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        aria-label={excluirPose(pose.label)}
        className="relative inline-flex h-7 touch-none items-center justify-center overflow-hidden rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors outline-none select-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
        {...holdHandlers}
      >
        {t.excluir}
        <motion.span
          aria-hidden="true"
          style={{ scaleX: progress }}
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-destructive"
        />
      </TooltipTrigger>
      <TooltipContent>{t.excluirHint}</TooltipContent>
    </Tooltip>
  );
}
