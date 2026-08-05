/**
 * Para onde a tela vai quando o painel da fila diz "gerar de novo".
 *
 * ## Por que isto existe
 *
 * O estado `'interrompido'` significa: *o servidor parou no meio, a geração pode
 * ter sido cobrada, e a fila não refaz sozinha para não cobrar de novo — você
 * decide*. Uma tela que só NOMEIA esse estado deixa o usuário sem saída: o botão
 * que refaz o trabalho está em outra aba, e o painel da fila é uma gaveta que
 * flutua por cima de todas elas.
 *
 * Este contexto é o caminho de volta. O `AppShell` passa a controlar qual aba
 * está aberta (o `SmoothTabs` do registry aceita `value` + `onValueChange`) e
 * publica o setter aqui; o painel da fila lê a chave do job, descobre de quem
 * ele é (`src/app/job-scope.ts`), traduz para uma aba
 * (`queue-model.tabForScope`) e leva o usuário até lá — selecionando junto o
 * personagem dono, quando há um.
 *
 * ## O que ele NÃO faz, e por quê
 *
 * Não refaz o job. Não existe rota de "retomar" no servidor, e inventar uma aqui
 * seria disparar geração paga a partir de um painel cujo trabalho é justamente
 * explicar quanto custa cada decisão. O botão que refaz continua sendo o de
 * sempre, na tela dona.
 *
 * Não escolhe a SEÇÃO dentro do Laboratório (o toggle "Sprite sul"/"Blocos do
 * mundo" é estado local de `screens/laboratorio.tsx`). O painel leva até a aba e
 * diz qual seção abrir.
 *
 * O default é um no-op: qualquer componente montado fora do shell (uma tela
 * futura, um teste de render) continua funcionando, e o botão de navegar
 * simplesmente não faz nada em vez de quebrar.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { StudioTab } from './queue/queue-model.ts';

/**
 * As quatro abas do estúdio, nas mesmas chaves de `S.shell.tabs`. O tipo mora no
 * módulo PURO (`queue/queue-model.ts`), que é quem decide a aba de cada job e
 * roda sob `node --test`; aqui ele só é repassado.
 */
export type { StudioTab };

export interface StudioNavigation {
	/** A aba aberta agora. */
	readonly tab: StudioTab;
	/** Abre uma aba. No-op fora do shell. */
	readonly goTo: (tab: StudioTab) => void;
}

const StudioNavigationContext = createContext<StudioNavigation>({
	tab: 'wizard',
	goTo: () => undefined,
});

export function StudioNavigationProvider({
	tab,
	goTo,
	children,
}: {
	readonly tab: StudioTab;
	readonly goTo: (tab: StudioTab) => void;
	readonly children: ReactNode;
}) {
	const value = useMemo<StudioNavigation>(() => ({ tab, goTo }), [tab, goTo]);
	return (
		<StudioNavigationContext.Provider value={value}>
			{children}
		</StudioNavigationContext.Provider>
	);
}

export const useStudioNavigation = (): StudioNavigation =>
	useContext(StudioNavigationContext);
