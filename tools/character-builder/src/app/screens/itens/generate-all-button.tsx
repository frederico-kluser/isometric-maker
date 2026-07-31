/**
 * Botão "Gerar todas as pendentes" do guarda-roupa.
 *
 * Dispara um POST /api/generate por peça pendente QUE SERVE na silhueta do
 * personagem — incompatível nunca entra no lote (o servidor recusaria depois
 * de cobrar). Paralelo: Promise.allSettled no pai, spawn independente por
 * rota no servidor. Sem diálogo de custo: o guard vive no servidor (ADR 0012).
 *
 * Irmão deste componente em poses/generate-all-button.tsx — duplicado de
 * propósito: cada tela é dona das suas strings e dos seus bloqueios.
 */
import { useEffect, useRef, useState } from 'react';
import { MultiStateButton } from '@/components/motion-ui/multi-state-button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { S } from '../../../strings.ts';

/** Quanto o estado de erro do disparo fica visível antes de voltar ao repouso. */
const ERROR_STATE_MS = 1600;

/** Resultado do disparo em lote — o botão vira erro só se TUDO falhou. */
export interface DispatchOutcome {
  readonly total: number;
  readonly failed: number;
}

interface GenerateAllItemsButtonProps {
  /** Sem remoteId não há corpo remoto para aplicar a edição — bloqueado. */
  readonly hasRemoteId: boolean;
  /** Peças que servem na silhueta e estão vazias ou falhas; zero desabilita. */
  readonly pendingCount: number;
  /** Dispara o POST de todas as pendentes em paralelo; resolve no allSettled. */
  readonly onGenerateAll: () => Promise<DispatchOutcome>;
}

export function GenerateAllItemsButton({
  hasRemoteId,
  pendingCount,
  onGenerateAll,
}: GenerateAllItemsButtonProps) {
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
      ? S.itens.lote.colocandoNaFila
      : state === 'erro'
        ? S.itens.lote.erroEnvio
        : S.itens.lote.gerarTodas;

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
      pillClassName="rounded-lg px-2.5 py-1.5 text-sm font-medium"
      widthMorph={false}
      disabled={disabled}
      onClick={() => void click()}
      aria-label={S.itens.lote.gerarTodas}
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
        {blockedReason === 'sem-base'
          ? S.itens.gerar.semBase
          : S.itens.lote.nadaPendente}
      </TooltipContent>
    </Tooltip>
  );
}
