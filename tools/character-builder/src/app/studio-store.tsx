/**
 * Acesso compartilhado ao estado do estúdio.
 *
 * Uma fonte só para o `/api/studio`: quem renderiza usa `useStudio()`, que busca
 * o estado na montagem e volta a buscar a cada 3s enquanto houver geração em
 * andamento — job leva 2 a 5 minutos e já foi pago, então a tela nunca perde
 * trabalho por recarregar.
 *
 * O personagem selecionado é contexto do app inteiro (wizard, poses e itens
 * trabalham sobre o mesmo corpo).
 */
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import type { Studio } from "../../server/model.ts";

/**
 * Espelho cliente de `StudioJobView` (`server/job-queue.ts`).
 *
 * Os três primeiros campos são os que a rota sempre publicou; o resto entrou com
 * a fila e é **opcional aqui de propósito**. Um campo obrigatório novo faria a
 * tela quebrar contra um servidor mais velho em vez de degradar, e o painel da
 * fila já trata ausência como "não sei" em vez de inventar valor
 * (`src/app/queue/queue-model.ts`).
 *
 * A rota é a fronteira: `server/job-queue.ts` importa `node:fs`, então o tipo é
 * espelhado e não importado — mesma regra de `studio-body.ts` e `blocks-body.ts`.
 */
export interface StudioJobEntry {
	readonly status: string;
	readonly label: string;
	readonly message?: string;
	/** Momento em que o job começou (ou entrou na fila). */
	readonly startedAt?: number;
	/** Qual dos sete `JobKind` é este job. */
	readonly kind?: string;
	/** Ordem de chegada, monotônica. */
	readonly seq?: number;
	readonly enqueuedAt?: string;
	/** 1 = próximo a entrar. Ausente quando o job não está mais na fila. */
	readonly queuePosition?: number;
	/** `true` = a submissão paga JÁ consta. `false` é "não consta", não "grátis". */
	readonly paid?: boolean;
	readonly attempts?: number;
}

/** Espelho cliente de `QueueStats` (`server/job-queue.ts`). */
export interface StudioQueueStats {
	readonly queued?: number;
	readonly running?: number;
	readonly done?: number;
	readonly failed?: number;
	readonly cancelled?: number;
	/** Teto EFETIVO de chamadas simultâneas, já resolvido. */
	readonly concurrency?: number;
	readonly concurrencySource?: string;
	/** Soma dos pesos em voo — não é o número de jobs. */
	readonly inFlightWeight?: number;
	readonly availableWeight?: number;
	readonly ratePerSecond?: number;
}

export interface StudioResponse extends Studio {
	readonly jobs: Record<string, StudioJobEntry>;
	/** Estado do teto de admissão. Ausente em servidor anterior à fila. */
	readonly queue?: StudioQueueStats;
	readonly hasToken: boolean;
	readonly mannequinDefaultAvailable: boolean;
}

export const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
	const res = await fetch(`/api/${path}`, {
		...init,
		headers: init?.body ? { "content-type": "application/json" } : {},
	});
	const body = (await res.json()) as T & { error?: string };
	if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
	return body;
};

/**
 * NÃO existe mais um `busy` global aqui, e a ausência é a correção.
 *
 * O campo respondia "algum job está gerando?" — e QUALQUER job servia: um bloco
 * do mundo, uma sprite da bancada, uma pose de outro personagem. O wizard
 * inteiro apagava por causa de trabalho sem relação nenhuma com ele. Com a fila
 * (`server/job-queue.ts`) os jobs passam a ser serializados, então essa janela
 * de congelamento só cresceria.
 *
 * Quem precisa saber se uma ação está impedida pergunta pelo ESCOPO dela, em
 * `src/app/job-scope.ts`, passando `studio.jobs`. Reintroduzir um booleano
 * global aqui é reintroduzir o defeito.
 */
export interface StudioState {
	readonly studio: StudioResponse | undefined;
	readonly refresh: () => Promise<void>;
	readonly error: string | null;
}

export function useStudio(pollMs = 3000): StudioState {
	const [studio, setStudio] = useState<StudioResponse | undefined>();
	const [error, setError] = useState<string | null>(null);
	const timer = useRef<number | undefined>(undefined);

	const refresh = useCallback(async (): Promise<void> => {
		try {
			const s = await api<StudioResponse>("studio");
			setStudio(s);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	// Sondagem INCONDICIONAL — e isso é uma correção, não desleixo.
	//
	// A versão anterior só ligava o intervalo quando havia geração em curso, e
	// isso saía do próprio snapshot. Um job que nasce DEPOIS da montagem
	// nunca aparecia: sem sondagem não chega snapshot novo, sem snapshot novo
	// nada parece em andamento, e sem isso não liga a sondagem. O Sprite Studio
	// ficava sondando o resultado para sempre porque a falha do job existia no
	// servidor e jamais chegava à tela.
	//
	// O custo de sondar sempre é um GET local a cada 3 s numa ferramenta de
	// usuário único. O custo de não sondar foi uma tela travada em cima de
	// geração já paga.
	useEffect(() => {
		timer.current = window.setInterval(() => void refresh(), pollMs);
		return () => window.clearInterval(timer.current);
	}, [pollMs, refresh]);

	return { studio, refresh, error };
}

// ---------------------------------------------------------------- personagem

interface SelectedCharacter {
	readonly characterId: string;
	readonly setCharacterId: (id: string) => void;
}

const SelectedCharacterContext = createContext<SelectedCharacter>({
	characterId: "",
	setCharacterId: () => undefined,
});

export function SelectedCharacterProvider({
	children,
}: {
	readonly children: ReactNode;
}) {
	const [characterId, setCharacterId] = useState("");
	const value = useMemo(() => ({ characterId, setCharacterId }), [characterId]);
	return (
		<SelectedCharacterContext.Provider value={value}>
			{children}
		</SelectedCharacterContext.Provider>
	);
}

export const useSelectedCharacter = (): SelectedCharacter =>
	useContext(SelectedCharacterContext);
