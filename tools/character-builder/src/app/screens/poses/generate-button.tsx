import { useEffect, useRef, useState } from 'react';
import { MultiStateButton } from '@/components/motion-ui/multi-state-button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cellKey, type Cell, type Pose } from '../../../../server/model.ts';
import { isBusyStatus } from '../../job-scope.ts';
import { api } from '../../studio-store.tsx';
import { gerarPose, poses as t } from '../../../strings/poses.ts';

/** Quanto o estado de erro do envio fica visível antes de voltar ao repouso. */
const ERROR_STATE_MS = 1600;

interface GenerateButtonProps {
  readonly characterId: string;
  /** Sem remoteId não há personagem remoto para animar — botão bloqueado. */
  readonly hasRemoteId: boolean;
  readonly pose: Pose;
  readonly cell: Cell | undefined;
  /** Recarrega o estúdio depois do pedido. */
  readonly onDone: () => Promise<void>;
  /** Avisa a tela que um POST saiu, para o contador de lote seguir esta chave. */
  readonly onDispatched?: (key: string) => void;
}

/**
 * Botão de geração de uma pose. Vai direto ao POST /api/generate — sem
 * diálogo de custo: o servidor estima, loga e escreve no ledger (ADR 0012).
 *
 * A máquina de estados é derivada da célula: `pronto` não gera de novo
 * (idempotência — gerar de novo gastaria sem necessidade), `gerando` trava
 * o botão, `falhou` vira "Tentar de novo".
 */
export function GenerateButton({
  characterId,
  hasRemoteId,
  pose,
  cell,
  onDone,
  onDispatched,
}: GenerateButtonProps) {
  const [posting, setPosting] = useState(false);
  const [postFailed, setPostFailed] = useState(false);
  const failTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(failTimer.current), []);

  // O bloqueio é da PRÓPRIA célula — esta pose, deste personagem. Nunca de um
  // job qualquer do estúdio. `isBusyStatus` é a mesma regra que o wizard usa
  // (`src/app/job-scope.ts`): 'na-fila' conta como ocupado, porque o job
  // enfileirado ainda vai rodar e gerar de novo pagaria duas vezes.
  const busy = posting || isBusyStatus(cell?.status);
  const state = postFailed
    ? 'erro'
    : busy
      ? 'gerando'
      : cell?.status === 'falhou'
        ? 'falhou'
        : cell?.status === 'pronto'
          ? 'pronto'
          : 'idle';

  const blocked = !hasRemoteId;
  const disabled = blocked || busy || state === 'pronto';

  // Bloqueia igual, se escreve diferente: 'na-fila' é trabalho que AINDA não
  // começou. O botão continua no estado visual 'gerando' (o multi-state-button
  // é vendorizado e não tem estado próprio para fila), mas o rótulo não mente.
  const queued = cell?.status === 'na-fila';
  const label =
    state === 'gerando'
      ? queued
        ? t.statusNaFila
        : t.gerando
      : state === 'pronto'
        ? t.pronto
        : state === 'falhou'
          ? t.tentarDeNovo
          : state === 'erro'
            ? t.erroEnvio
            : t.gerar;

  const surface =
    state === 'pronto'
      ? 'bg-secondary text-secondary-foreground'
      : state === 'falhou' || state === 'erro'
        ? 'bg-destructive/10 text-destructive'
        : 'bg-primary text-primary-foreground';

  const click = async (): Promise<void> => {
    if (disabled) return;
    setPosting(true);
    try {
      await api<{ key: string }>('generate', {
        method: 'POST',
        body: JSON.stringify({ characterId, poseId: pose.id }),
      });
      // O contador de lote passa a seguir esta chave — inclusive no retry.
      onDispatched?.(cellKey(characterId, pose.id));
      // Recarrega ainda em `posting`, para o estado "gerando" do servidor
      // assumir sem piscar pelo repouso.
      await onDone();
    } catch {
      setPostFailed(true);
      window.clearTimeout(failTimer.current);
      failTimer.current = window.setTimeout(
        () => setPostFailed(false),
        ERROR_STATE_MS,
      );
    } finally {
      setPosting(false);
    }
  };

  const button = (
    <MultiStateButton
      state={state}
      feedback={state === 'falhou' || state === 'erro' ? 'shake' : 'none'}
      surfaceClassName={surface}
      pillClassName="rounded-md px-3 py-1.5 text-xs font-medium"
      widthMorph={false}
      disabled={disabled}
      onClick={() => void click()}
      aria-label={gerarPose(pose.label)}
    >
      {label}
    </MultiStateButton>
  );

  if (!blocked) return button;

  // O botão desabilitado não recebe hover (pointer-events-none), então o
  // tooltip mora num wrapper — assim o motivo do bloqueio continua visível.
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span tabIndex={0} className="inline-flex" />}
      >
        {button}
      </TooltipTrigger>
      <TooltipContent>{t.bloqueioSemBase}</TooltipContent>
    </Tooltip>
  );
}
