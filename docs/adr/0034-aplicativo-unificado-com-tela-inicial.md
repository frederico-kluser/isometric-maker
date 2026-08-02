# ADR 0034 — Aplicativo unificado com tela inicial

> **Quick Start (TL;DR)**
>
> O `tools/map-builder` foi fundido no `tools/character-builder`, que virou o
> editor inteiro: tela inicial (`#/`), estúdio de personagem (`#/personagem`) e
> editor de mapa (`#/mundo`). Roteador por hash escrito à mão, sem dependência
> nova, e a tela inativa é **desmontada**, não escondida. `npm run dev` na raiz
> sobe tudo num processo só, em `http://localhost:5174/`.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker && npm run dev
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && npm test
> ```

**Status:** aceita · **Data:** 2026-08-02

## Contexto

Até 2026-08-02 o repositório tinha **dois construtores em duas portas**:
`tools/map-builder` (editor de mapa, app Vite separado) e
`tools/character-builder` (estúdio de personagem). O character-builder já era o
único com servidor — `server/api.ts` montado como middleware do Vite —, com
`assets/`, `studio.json` e `.env`; o map-builder consumia o servidor do outro
para o catálogo de blocos do mundo. Subir o editor exigia dois terminais e um
`scripts/dev-all.sh`.

O usuário decidiu unificar: o character-builder passa a ser **o aplicativo
inteiro**, e o código do map-builder muda para
`tools/character-builder/src/map/` (commits `e83e9fa` e `a2276d3`). A pasta
`tools/map-builder` ficou vazia — sobrou só `node_modules/`, aguardando
remoção.

## Decisão

**1. Um aplicativo Vite só.** O character-builder serve o editor inteiro. O
código do mapa vive em `src/map/` (editor, autotile, placement, export,
picking, cena, câmera), ao lado do estúdio.

**2. Roteamento por hash, escrito à mão.** `src/app/router.ts` (~60 linhas,
`useSyncExternalStore` + `hashchange`), com três rotas:

| Rota | Tela | Arquivo |
| --- | --- | --- |
| `#/` | inicial — as duas portas (personagem e mundo) | `src/app/home/home-screen.tsx` |
| `#/personagem` | estúdio (wizard / poses / itens / laboratório) | `src/app/shell.tsx` |
| `#/mundo` | editor de mapa | `src/map/editor/map-editor.tsx` |

**Nenhuma dependência nova** — o repositório congela dependências de propósito,
e o router cabe num arquivo pequeno. Hash, e não history, para rotas profundas
funcionarem sem configurar fallback de servidor.

**3. A tela inativa é desmontada, não escondida.** O `App.tsx` monta só a tela
da rota ativa. Com as duas montadas, o editor de mapa continuaria sondando o
catálogo de blocos (`api/world-blocks`) a cada 3 s enquanto o usuário desenha
no estúdio — sondagem de tela desmontada é impossível por construção.

**4. Um processo, um comando.** O `package.json` da raiz (criado em
2026-08-02) tem `dev` = `cd tools/character-builder && npm run dev`;
`scripts/dev-all.sh` foi apagado. Tudo em `http://localhost:5174/`.

## Alternativas descartadas

**Manter os dois apps em duas portas.** Continuava com dois processos e o
`dev-all.sh`; e o map-builder já dependia do servidor do character-builder,
então a separação era custo sem fronteira real.

**Esconder a tela inativa em vez de desmontar.** Mantém o estado da tela ao
voltar — mas o editor de mapa sondaria a cada 3 s mesmo invisível, e o canvas
PixiJS continuaria vivo com o usuário no estúdio. Desmontar resolve os dois
por construção.

**History routing em vez de hash.** Exigiria config de fallback no servidor
Vite e num host estático; o hash mantém as rotas profundas sem isso.

## Consequências

- **Fluxo de dev mais simples:** um `npm run dev` na raiz, uma porta, e o
  `gate.sh` passou a rodar os testes do mapa no stage do character-builder
  (459 testes, incluindo os que eram do map-builder: autotile, export,
  picking).
- **Sem sondagem de tela desmontada**, e voltar para `#/` derruba o canvas
  (verificado em Chromium headless em 2026-08-02).
- **Adicionar uma rota toca quatro pontos:** um item em `ROUTES` e um em
  `ROUTE_HASH` no `router.ts`; um ramo no ternário do `App.tsx`; uma seção em
  `src/strings/inicio.ts` e um `<HomeEntry>` no `home-screen.tsx`. É
  proposital — rota é decisão de produto, não configuração.
- **A pasta `tools/map-builder` deixou de existir**; só sobrou o
  `node_modules/` stale, que ainda não foi apagado.
- **O texto do usuário continua centralizado** (ADR 0016): as strings da tela
  inicial moram em `src/strings/inicio.ts`, pt-BR.

## Referências

- [`ADR 0010`](0010-pivo-para-editor-isometrico.md) — o produto é um editor local, de um usuário só
- [`ADR 0016`](0016-ui-ptbr-strings-centralizadas.md) — UI em pt-BR com strings centralizadas
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/app/router.ts` — o roteador por hash
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/app/home/home-screen.tsx` — a tela inicial
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/editor/map-editor.tsx` — o editor de mapa
- `/home/ondokai/Projects/isometric-maker/package.json` — o atalho `dev` na raiz

**Última atualização:** 2026-08-02
