/**
 * Apagar um bloco do catálogo (DELETE /api/world-block/{hash}).
 *
 * Apagar é irreversível e o dinheiro da geração já saiu — por isso o gesto é
 * pressionar-e-segurar, o mesmo padrão que o editor de mapa usa em "limpar".
 * Um clique só não apaga nada.
 *
 * Usa o hook headless `useHoldToConfirm` do registry com superfície própria, e
 * não o `HoldToConfirmButton` pronto, pelo mesmo motivo já registrado em
 * `src/app/screens/poses/delete-pose-button.tsx`: o botão pronto tem largura
 * fixa de formulário (`w-60`, 240 px) e cada card do catálogo ocupa cerca de um
 * terço da coluna. O `className` dele é concatenado, não passa por
 * `tailwind-merge`, então um `w-full` por cima disputaria precedência com
 * `w-60` na ordem do CSS gerado — precedência que não é garantida. A mecânica
 * do gesto (rampa determinística, soltar cancela, Espaço segura) é a MESMA:
 * vem do mesmo hook.
 */
import { useState } from 'react';
import { motion } from 'motion/react';
import { LoaderCircleIcon, Trash2Icon } from 'lucide-react';
import { useHoldToConfirm } from '@/components/motion-ui/hold-to-confirm';
import { api } from '../../studio-store.tsx';
import { blocos as SB } from '../../../strings/blocos.ts';

/** O que o servidor relata sobre a remoção (server/world-block.ts). */
export interface BlockDeletionReport {
  readonly hash: string;
  /** false quando o diretório já não existia — não é erro, é idempotência. */
  readonly existed: boolean;
  readonly removedFiles: number;
  /** Havia stub de trabalho já pago esperando retomada, e ele foi junto. */
  readonly pendingDiscarded: boolean;
}

interface DeleteBlockButtonProps {
  readonly hash: string;
  /** Descrição do bloco — entra no rótulo acessível e na mensagem de retorno. */
  readonly description: string;
  /** Id do parágrafo com a dica do gesto, para o `aria-describedby`. */
  readonly hintId: string;
  readonly onDeleted: (report: BlockDeletionReport) => void;
  readonly onError: (message: string) => void;
}

export function DeleteBlockButton({
  hash,
  description,
  hintId,
  onDeleted,
  onError,
}: DeleteBlockButtonProps) {
  const [busy, setBusy] = useState(false);

  const { progress, holdHandlers, reset } = useHoldToConfirm({
    holdSeconds: 1.5,
    onConfirm: () => {
      void (async () => {
        setBusy(true);
        try {
          // 409 (bloco gerando) e 400 (hash malformado) chegam aqui como
          // Error com a mensagem em pt-BR do servidor — `api` desembrulha
          // `error` do corpo.
          const report = await api<BlockDeletionReport>(`world-block/${hash}`, {
            method: 'DELETE',
          });
          onDeleted(report);
        } catch (err) {
          onError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
          // Solta a trava do gesto: o card pode continuar montado (falha, ou
          // bloco que já não existia) e um segundo gesto tem que funcionar.
          reset();
        }
      })();
    },
  });

  return (
    <button
      type="button"
      aria-label={SB.remocao.ariaLabel(description)}
      aria-describedby={hintId}
      aria-busy={busy || undefined}
      disabled={busy}
      className="relative inline-flex h-6 w-full touch-none items-center justify-center gap-1 overflow-hidden rounded-md text-[10px] font-medium text-muted-foreground transition-colors outline-none select-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      {...holdHandlers}
    >
      {busy ? (
        <LoaderCircleIcon className="size-3 animate-spin" aria-hidden="true" />
      ) : (
        <Trash2Icon className="size-3" aria-hidden="true" />
      )}
      {busy ? SB.remocao.apagando : SB.remocao.acao}
      <motion.span
        aria-hidden="true"
        style={{ scaleX: progress }}
        className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-destructive"
      />
    </button>
  );
}
