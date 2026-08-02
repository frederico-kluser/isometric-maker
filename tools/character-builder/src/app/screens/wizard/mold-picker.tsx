/**
 * Seletor do molde de proporção da face sul: nenhum, adulto ou criança.
 *
 * O molde diz onde o corpo assenta no quadro e quanto do quadro ele ocupa —
 * posição e tamanho, nada mais. Aparência continua vindo do texto do usuário.
 *
 * As prévias vêm de `GET /api/molde/<id>.png`, que serve o PNG versionado em
 * `packages/game-assets/moldes/` direto do disco. Não há cópia em `assets/`:
 * molde é asset do projeto, não arte gerada.
 *
 * "Nenhum" não é enfeite — é o caminho histórico, em que a referência do
 * usuário volta a ser `init_image`. Mantê-lo escolhível é o que permite ligar o
 * molde sem tirar do usuário o comportamento que ele já conhecia.
 */
import type { MoldId } from '../../../../server/model.ts';
import { MOLD_IDS } from '../../../../server/model.ts';
import { cn } from '@/lib/utils';
import { wizard } from '../../../strings/wizard.ts';

export interface MoldPickerProps {
	/** Molde escolhido; `null` quando nenhum. */
	readonly value: MoldId | null;
	readonly onChange: (value: MoldId | null) => void;
	readonly disabled?: boolean;
}

const OPCOES: readonly (MoldId | null)[] = [null, ...MOLD_IDS];

function nomeDe(id: MoldId | null): string {
	if (id === null) return wizard.sul.moldeNomes.nenhum;
	return id === 'adulto'
		? wizard.sul.moldeNomes.adulto
		: wizard.sul.moldeNomes.crianca;
}

export function MoldPicker({
	value,
	onChange,
	disabled = false,
}: MoldPickerProps): React.JSX.Element {
	return (
		<div
			role="radiogroup"
			aria-label={wizard.sul.moldeRotulo}
			className="flex flex-wrap gap-2"
		>
			{OPCOES.map((id) => {
				const nome = nomeDe(id);
				const escolhido = value === id;
				return (
					<button
						key={id ?? '__nenhum__'}
						type="button"
						role="radio"
						aria-checked={escolhido}
						disabled={disabled}
						onClick={() => onChange(id)}
						className={cn(
							'flex w-24 flex-col items-center gap-1 rounded-md border p-2 text-xs transition-colors',
							'disabled:cursor-not-allowed disabled:opacity-50',
							escolhido
								? 'border-primary bg-primary/10 text-foreground'
								: 'border-border text-muted-foreground hover:bg-muted',
						)}
					>
						<span className="flex h-20 w-full items-center justify-center">
							{id === null ? (
								<span aria-hidden className="text-2xl leading-none">
									—
								</span>
							) : (
								<img
									src={`/api/molde/${id}.png`}
									alt={wizard.sul.moldeAlt(nome)}
									className="max-h-20 max-w-full object-contain [image-rendering:pixelated]"
								/>
							)}
						</span>
						<span>{nome}</span>
					</button>
				);
			})}
		</div>
	);
}
