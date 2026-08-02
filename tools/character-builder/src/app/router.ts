/**
 * Roteador por hash — o menor que resolve o problema.
 *
 * O editor é um aplicativo local de usuário único servido por UM Vite (ADR
 * 0010). Não há servidor que responda a caminhos, então `#/` é o que funciona
 * sem configuração: o navegador nunca pede a rota ao servidor, e recarregar
 * `#/mundo` volta para o editor de mapa em vez de dar 404.
 *
 * Nenhuma dependência nova. `react-router` traria roteamento aninhado, data
 * loaders e transições que três telas sem parâmetro não usam — e o repositório
 * congela dependências de propósito.
 *
 * A rota é uma string primitiva, então `useSyncExternalStore` compara por
 * identidade sem precisar de cache de snapshot.
 */
import { useSyncExternalStore } from 'react';

/** As telas de primeiro nível. `inicio` é a raiz. */
export const ROUTES = ['inicio', 'personagem', 'mundo', 'mundo3d'] as const;
export type Route = (typeof ROUTES)[number];

/**
 * Hash canônico de cada rota. O caminho é em português porque aparece na barra
 * de endereço, que é texto que o usuário lê (ADR 0008).
 */
export const ROUTE_HASH: Record<Route, string> = {
  inicio: '#/',
  personagem: '#/personagem',
  mundo: '#/mundo',
  mundo3d: '#/mundo3d',
};

const ROUTE_OF_PATH = new Map<string, Route>(
  ROUTES.map((r) => [ROUTE_HASH[r].slice(1), r]),
);

/** Qualquer hash desconhecido cai na tela inicial — inclusive o hash vazio. */
export function routeFromHash(hash: string): Route {
  const path = hash.startsWith('#') ? hash.slice(1) : hash;
  const normalized = path === '' ? '/' : path;
  return ROUTE_OF_PATH.get(normalized) ?? 'inicio';
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function getSnapshot(): Route {
  return routeFromHash(window.location.hash);
}

/** Rota atual, re-renderizando quando o hash muda. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'inicio' as Route);
}

/**
 * Troca de tela.
 *
 * Escrever em `location.hash` empilha no histórico, então o botão "voltar" do
 * navegador funciona sem código nosso.
 */
export function navigate(route: Route): void {
  window.location.hash = ROUTE_HASH[route];
}
