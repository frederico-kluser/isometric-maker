/**
 * Botão de ação do wizard: o multi-state-button instalado já vem com a
 * coreografia (crossfade, morph, shake/pop) — este wrapper só amarra a
 * máquina do useAction aos rótulos pt-BR de S.wizard.acoes e mostra a
 * mensagem de erro do servidor embaixo.
 */
import { Check, CircleAlert, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { MultiStateButton } from '@/components/motion-ui/multi-state-button';
import { wizard } from '../../../strings/wizard.ts';
import type { ActionState } from './use-action.ts';

const SURFACES: Record<ActionState, string> = {
	idle: 'bg-primary text-primary-foreground',
	loading: 'bg-secondary text-secondary-foreground',
	success: 'bg-primary text-primary-foreground',
	error: 'bg-destructive/15 text-destructive',
};

const ICONS: Record<ActionState, ReactNode> = {
	idle: undefined,
	loading: <LoaderCircle aria-hidden className="size-4 animate-spin" />,
	success: <Check aria-hidden className="size-4" />,
	error: <CircleAlert aria-hidden className="size-4" />,
};

export interface ActionButtonProps {
	readonly state: ActionState;
	/** Mensagem do servidor (pt-BR) quando state === 'error'. */
	readonly message?: string | null;
	/** Força o estado loading enquanto a célula correspondente gera (poll). */
	readonly generating?: boolean;
	/** Rótulo do estado idle — a ação em si ("Gerar cardeais"). */
	readonly label: string;
	/** Rótulo de loading; default "Gerando…" (S.wizard.acoes.gerando). */
	readonly loadingLabel?: string;
	/** Superfície do estado idle; default bg-primary (ação secundária: bg-secondary). */
	readonly idleSurface?: string;
	readonly onClick: () => void;
	readonly disabled?: boolean;
}

export function ActionButton({
	state,
	message,
	generating = false,
	label,
	loadingLabel,
	idleSurface,
	onClick,
	disabled = false,
}: ActionButtonProps) {
	const effective: ActionState =
		generating || state === 'loading' ? 'loading' : state;
	const labels: Record<ActionState, string> = {
		idle: label,
		loading: loadingLabel ?? wizard.acoes.gerando,
		success: wizard.acoes.sucesso,
		error: wizard.acoes.falha,
	};
	const surfaces: Record<ActionState, string> = {
		...SURFACES,
		...(idleSurface !== undefined ? { idle: idleSurface } : {}),
	};
	return (
		<div className="flex flex-col items-start gap-2">
			<MultiStateButton
				state={effective}
				icon={ICONS[effective]}
				surfaceClassName={surfaces[effective]}
				feedback={
					effective === 'success'
						? 'pop'
						: effective === 'error'
							? 'shake'
							: 'none'
				}
				disabled={disabled || effective === 'loading'}
				onClick={onClick}
				aria-label={labels[effective]}
			>
				{labels[effective]}
			</MultiStateButton>
			{effective === 'error' && message ? (
				<p role="alert" className="max-w-prose text-sm text-destructive">
					{message}
				</p>
			) : null}
		</div>
	);
}
