/**
 * Botão "Gerar todas as pendentes" da grade de poses.
 *
 * Dispara um POST /api/generate por pose vazia ou falha do personagem, em
 * paralelo (Promise.allSettled no pai; o servidor faz spawn independente por
 * rota). Sem diálogo de custo: o guard de orçamento vive no servidor
 * (ADR 0012) e nunca aparece aqui.
 *
 * Bloqueios, na hierarquia do botão por pose: sem remoteId não há personagem
 * remoto para animar; sem pendente não há o que pedir.
 */
import { useEffect, useRef, useState } from 'react';
import { MultiStateButton } from '@/components/motion-ui/multi-state-button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { poses as t } from '../../../strings/poses.ts';

/** Quanto o estado de erro do disparo fica visível antes de voltar ao repouso. */
const ERROR_STATE_MS = 1600;

/** Resultado do disparo em lote — o botão vira erro só se TUDO falhou. */
export interface DispatchOutcome {
  readonly total: number;
  readonly failed: number;
}

interface GenerateAllButtonProps {
  /** Sem remoteId não há personagem remoto para animar — botão bloqueado. */
  readonly hasRemoteId: boolean;
  /** Poses vazias ou com falha; zero desabilita o lote. */
  readonly pendingCount: number;
  /** Dispara o POST de todas as pendentes em paralelo; resolve no allSettled. */
  readonly onGenerateAll: () => Promise<DispatchOutcome>;
}

export function GenerateAllButton({
  hasRemoteId,
  pendingCount,
  onGenerateAll,
}: GenerateAllButtonProps) {
  const [posting, setPosting] = useState(false);
  const [postFailed, setPostFailed] = useState(false);
  const failTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(failTimer.current), []);

  const blockedReason = !hasRemoteId
    ? 'sem-base'
    : pendingCount === 0
      ? 'nada-pendente'
      : undefined;
  const state = postFailed ? 'erro' : posting ? 'gerando' : 'idle';
  const disabled = blockedReason !== undefined || posting;

  const label =
    state === 'gerando'
      ? t.colocandoNaFila
      : state === 'erro'
        ? t.erroEnvio
        : t.gerarTodasPendentes;

  const surface =
    state === 'erro'
      ? 'bg-destructive/10 text-destructive'
      : 'bg-primary text-primary-foreground';

  const fail = (): void => {
    setPostFailed(true);
    window.clearTimeout(failTimer.current);
    failTimer.current = window.setTimeout(
      () => setPostFailed(false),
      ERROR_STATE_MS,
    );
  };

  const click = async (): Promise<void> => {
    if (disabled) return;
    setPosting(true);
    try {
      const outcome = await onGenerateAll();
      // Falha parcial aparece no resumo do disparo; o botão só treme se
      // NENHUM pedido entrou na fila.
      if (outcome.total > 0 && outcome.failed === outcome.total) fail();
    } catch {
      fail();
    } finally {
      setPosting(false);
    }
  };

  const button = (
    <MultiStateButton
      state={state}
      feedback={state === 'erro' ? 'shake' : 'none'}
      surfaceClassName={surface}
      pillClassName="rounded-md px-3 py-1.5 text-xs font-medium"
      widthMorph={false}
      disabled={disabled}
      onClick={() => void click()}
      aria-label={t.gerarTodasPendentes}
    >
      {label}
    </MultiStateButton>
  );

  if (blockedReason === undefined) return button;

  // O botão desabilitado não recebe hover (pointer-events-none), então o
  // tooltip mora num wrapper — assim o motivo do bloqueio continua visível.
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
        {button}
      </TooltipTrigger>
      <TooltipContent>
        {blockedReason === 'sem-base' ? t.bloqueioSemBase : t.nadaPendente}
      </TooltipContent>
    </Tooltip>
  );
}
