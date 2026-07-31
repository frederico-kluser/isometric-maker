/**
 * Hook de ação do wizard: a máquina idle/loading/success/error que alimenta
 * o multi-state-button. O erro guarda a mensagem do servidor (já em pt-BR) —
 * a UI nunca traduz nem reescreve erro HTTP.
 *
 * Success volta a idle sozinho depois de um instante (ação repetitiva, como
 * editar a sul), exceto com `keepSuccess` — ações terminais ficam no success
 * até o poll trazer o novo estado e o passo mudar de cena.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type ActionState = 'idle' | 'loading' | 'success' | 'error';

export interface WizardAction {
	readonly state: ActionState;
	/** Mensagem do servidor quando state === 'error'. */
	readonly message: string | null;
	readonly run: (
		fn: () => Promise<unknown>,
		opts?: { readonly keepSuccess?: boolean },
	) => Promise<void>;
}

const SUCCESS_RESET_MS = 2600;

export function useAction(refresh: () => Promise<void>): WizardAction {
	const [state, setState] = useState<ActionState>('idle');
	const [message, setMessage] = useState<string | null>(null);
	const timer = useRef<number | undefined>(undefined);

	useEffect(() => () => window.clearTimeout(timer.current), []);

	const run = useCallback(
		async (
			fn: () => Promise<unknown>,
			opts?: { readonly keepSuccess?: boolean },
		): Promise<void> => {
			window.clearTimeout(timer.current);
			setState('loading');
			setMessage(null);
			try {
				await fn();
				await refresh();
				setState('success');
				if (!opts?.keepSuccess) {
					timer.current = window.setTimeout(
						() => setState('idle'),
						SUCCESS_RESET_MS,
					);
				}
			} catch (err) {
				setState('error');
				setMessage(err instanceof Error ? err.message : String(err));
			}
		},
		[refresh],
	);

	return { state, message, run };
}
