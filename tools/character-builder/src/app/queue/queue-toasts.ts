/**
 * Fila de avisos do painel — wrapper fino sobre `useToastStack`.
 *
 * O componente do catálogo é headless de propósito: ele entrega a ordem dos ids
 * e nada mais. O texto (e, aqui, o tom) é responsabilidade de quem usa. Este
 * wrapper existe porque a regra do repositório é clara — editar o source
 * instalado em `components/motion-ui/` é perdê-lo no próximo `shadcn add`. O
 * modelo é `src/map/editor/toast-messages.ts`, que faz o mesmo para o editor de
 * mapa; ele não é reusado porque importar código da árvore do mapa para dentro
 * do estúdio criaria uma dependência entre duas telas que o repositório mantém
 * separadas de propósito (as strings de cada uma já vivem em módulos diferentes).
 *
 * ## O que este wrapper acrescenta ao do mapa
 *
 *   - **Tom.** Um cancelamento que custou dinheiro não pode ter a mesma cara de
 *     um que não custou. O tom viaja com a mensagem.
 *   - **Sumiço sozinho.** O aviso é transitório; segurar na tela um texto sobre
 *     dinheiro que já foi resolvido só confunde. O de dinheiro fica MAIS TEMPO,
 *     porque é o que precisa ser lido inteiro.
 *
 * ## A armadilha que vale registrar
 *
 * `ToastStack` se posiciona com `position: fixed`. Dentro da gaveta, o painel do
 * `Sheet` tem `transform` (a MotionValue `y` do arrasto), e um ancestral
 * transformado vira o bloco de contenção de qualquer `fixed` descendente — ou
 * seja: montado dentro do `SheetPanel`, o poço de avisos se posiciona pela
 * GAVETA, não pela viewport. É exatamente o que se quer aqui (o aviso pertence à
 * gaveta), mas não é o que a documentação do componente descreve, e quem mover
 * este `ToastStack` para fora vai ver o poço saltar para o rodapé da página.
 *
 * Montá-lo fora da gaveta seria pior: o `<dialog>` nativo abre em top layer, e
 * qualquer coisa fora dele fica ATRÁS — o aviso ficaria invisível justamente
 * enquanto o painel está aberto, que é quando o cancelamento acontece.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToastStack, type ToastItem } from '@/components/motion-ui/toast-stack';

/** Como o aviso deve soar. `money` é o que fala de gasto que não volta. */
export type NoticeTone = 'neutral' | 'money' | 'error';

export interface QueueNotice {
	readonly id: ToastItem;
	readonly text: string;
	readonly tone: NoticeTone;
}

export interface QueueNotices {
	readonly notices: readonly QueueNotice[];
	readonly push: (text: string, tone: NoticeTone) => void;
	readonly dismiss: (id: ToastItem) => void;
}

/** Aviso comum some rápido; o que fala de dinheiro fica tempo de ser lido. */
const DISMISS_MS: Record<NoticeTone, number> = {
	neutral: 6000,
	money: 14000,
	error: 12000,
};

export function useQueueNotices(): QueueNotices {
	const stack = useToastStack();
	// As duas funções saem do objeto ANTES de virarem dependência, e isso não é
	// estilo: `useToastStack` devolve `{toasts, add, dismiss}` — objeto literal
	// NOVO a cada render (`components/motion-ui/toast-stack`). Depender de
	// `stack` faria as dependências mudarem sempre e o `useCallback` abaixo não
	// memoizaria nada. `add` e `dismiss` são `useCallback` com deps vazias lá
	// dentro, então são estáveis de verdade.
	const { add, dismiss: dismissFromStack } = stack;
	const [texts, setTexts] = useState<ReadonlyMap<ToastItem, QueueNotice>>(
		new Map(),
	);
	const timers = useRef(new Set<number>());

	useEffect(
		() => () => {
			for (const id of timers.current) window.clearTimeout(id);
			timers.current.clear();
		},
		[],
	);

	const dismiss = useCallback(
		(id: ToastItem): void => {
			setTexts((prev) => {
				if (!prev.has(id)) return prev;
				const next = new Map(prev);
				next.delete(id);
				return next;
			});
			dismissFromStack(id);
		},
		[dismissFromStack],
	);

	const push = useCallback(
		(text: string, tone: NoticeTone): void => {
			const id = add();
			setTexts((prev) => new Map(prev).set(id, { id, text, tone }));
			const timer = window.setTimeout(() => {
				timers.current.delete(timer);
				dismiss(id);
			}, DISMISS_MS[tone]);
			timers.current.add(timer);
		},
		[add, dismiss],
	);

	// A ordem é a do stack (mais novo primeiro); o texto vem do mapa.
	const notices = stack.toasts
		.map((id) => texts.get(id))
		.filter((n): n is QueueNotice => n !== undefined);

	return { notices, push, dismiss };
}
