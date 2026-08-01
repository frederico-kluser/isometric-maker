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

export interface StudioJobEntry {
	readonly status: string;
	readonly label: string;
	readonly message?: string;
}

export interface StudioResponse extends Studio {
	readonly jobs: Record<string, StudioJobEntry>;
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

export interface StudioState {
	readonly studio: StudioResponse | undefined;
	readonly refresh: () => Promise<void>;
	/** true enquanto QUALQUER job estiver gerando. */
	readonly busy: boolean;
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

	const busy = Object.values(studio?.jobs ?? {}).some(
		(j) => j.status === "gerando",
	);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	// Sondagem INCONDICIONAL — e isso é uma correção, não desleixo.
	//
	// A versão anterior só ligava o intervalo quando `busy` já era true, e
	// `busy` sai do próprio snapshot. Um job que nasce DEPOIS da montagem
	// nunca aparecia: sem sondagem não chega snapshot novo, sem snapshot novo
	// `busy` fica false, e sem `busy` não liga a sondagem. O Sprite Studio
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

	return { studio, refresh, busy, error };
}

// ---------------------------------------------------------------- personagem

interface SelectedCharacter {
	readonly characterId: string;
	readonly setCharacterId: (id: string) => void;
}

const SelectedCharacterContext = createContext<SelectedCharacter>({
	characterId: "manequim",
	setCharacterId: () => undefined,
});

export function SelectedCharacterProvider({
	children,
}: {
	readonly children: ReactNode;
}) {
	const [characterId, setCharacterId] = useState("manequim");
	const value = useMemo(() => ({ characterId, setCharacterId }), [characterId]);
	return (
		<SelectedCharacterContext.Provider value={value}>
			{children}
		</SelectedCharacterContext.Provider>
	);
}

export const useSelectedCharacter = (): SelectedCharacter =>
	useContext(SelectedCharacterContext);
