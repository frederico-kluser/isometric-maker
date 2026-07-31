/**
 * Caixa de falha de um passo do wizard: a mensagem do servidor (role="alert",
 * ela já vem em pt-BR) e o botão "Tentar de novo", que re-chama a MESMA rota
 * do passo. A idempotência do servidor não bloqueia a nova tentativa — a
 * célula não está `pronto`, então a rota refaz só o que faltou.
 *
 * O erro chega por dois caminhos, já fundidos em wizard-progress.ts: o job
 * `falhou` em studio.jobs (sinal mais fresco) e a célula `falhou` (o que
 * sobrevive a um restart). Antes desta caixa, a tela lia só a célula — que
 * o servidor nunca marca durante a geração — e a falha passava invisível.
 */
import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { wizard } from '../../../strings/wizard.ts';

export interface FailureNoticeProps {
	/** Mensagem do servidor (pt-BR), sem prefixo. */
	readonly message: string;
	/** O botão de retry (ActionButton do passo, com a mesma rota). */
	readonly children?: ReactNode;
}

export function FailureNotice({ message, children }: FailureNoticeProps) {
	return (
		<div
			role="alert"
			className="flex flex-col items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3"
		>
			<p className="flex items-start gap-2 text-sm text-destructive">
				<CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
				<span>
					{wizard.erroCelula} {message}
				</span>
			</p>
			{children}
		</div>
	);
}
