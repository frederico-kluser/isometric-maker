# isometric-maker

Um **construtor de jogos isométricos**: monta o personagem a partir de uma imagem, desenha um mapa com altura, e roda o resultado. Arte gerada pela PixelLab; o editor de mapa desenha em Three.js desde a [ADR 0037](docs/adr/0037-editor-3d-apenas.md), e o PixiJS 8 sobrou no runtime e no empacotador de atlas. Roda na sua máquina, para você.

> **Quick Start (TL;DR)**
>
> O editor inteiro já funciona: tela inicial, estúdio de personagem e editor de
> mapa — tudo em **um aplicativo só**, que o `npm run dev` da raiz sobe num
> processo. O pipeline planeja custo sem gastar nada.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker
> npm run dev                          # o editor inteiro, em http://localhost:5174/
> cd tools/pixellab-pipeline
> export PIXELLAB_SECRET="seu-token"   # https://pixellab.ai/account
> node src/cli.ts doctor               # confere ambiente e spec vendorizado
> node src/cli.ts plan                 # estima o catálogo SEM gastar
> ```

| Quero… | Vá para |
| --- | --- |
| Entender o produto em 5 minutos | [`docs/00-produto/visao.md`](docs/00-produto/visao.md) |
| Saber o que cada termo significa | [`docs/00-produto/glossario.md`](docs/00-produto/glossario.md) |
| Usar o PixelLab (a fonte de toda a arte) | [`docs/01-pixellab/README.md`](docs/01-pixellab/README.md) |
| Gerar assets agora | [`tools/pixellab-pipeline/`](tools/pixellab-pipeline/) |
| Saber por que as decisões foram tomadas | [`docs/adr/`](docs/adr/) |
| Ver a documentação inteira | [`docs/README.md`](docs/README.md) |

## O que o editor faz

Quatro partes, construídas nesta ordem — e, desde 2026-08-02, todas dentro de
**um aplicativo só** ([ADR 0034](docs/adr/0034-aplicativo-unificado-com-tela-inicial.md)):
tela inicial com duas portas, `#/personagem` (estúdio) e `#/mundo` (editor de
mapa), roteamento por hash, e o `npm run dev` da raiz sobe tudo num processo:

1. **Construtor de personagem.** Você anexa uma imagem e informa a altura. O editor gera as 8 direções, estima o esqueleto para você aprovar, e produz andar, correr e pular. A prévia mostra o personagem animado com seletor de direção e ação. O molde de proporção adulto/criança controla a silhueta ([ADR 0035](docs/adr/0035-molde-de-proporcao-como-referencia-de-geracao.md)).
2. **Construtor de mapa.** Grade isométrica com eixo Z **inteiro**: blocos empilhados, paredes em aresta, degraus. Tile de 48×24, um nível de altura vale 29 px — a aresta vertical do cubo canônico (ADR 0024). O editor de mapa mora em `tools/character-builder/src/map/`, junto com o estúdio.
3. **Mecânicas.** Movimento, colisão, e salto cuja altura determina quais níveis são alcançáveis. O personagem é jogável no mapa: marchas (corrida, andar, agachar), gravidade e degrau ([ADR 0036](docs/adr/0036-fisica-de-marchas-agachar-e-gravidade.md)).
4. **Runtime.** Carrega o projeto exportado e roda, sem interface de edição.

O artefato final é **um projeto em JSON mais os atlas de sprite**. Nada de nuvem, nada de conta, nada de sincronização.

## O que ele não é

Sem servidor, sem multiplayer, sem netcode, sem anti-cheat, sem moderação. Não há jogadores — há um usuário, na própria máquina. Isso é escopo declarado, não omissão: ver [ADR 0010](docs/adr/0010-pivo-para-editor-isometrico.md) e [`docs/00-produto/visao.md`](docs/00-produto/visao.md).

Este repositório já foi um MMORPG hardcore. O pivô aconteceu em 2026-07-30, antes de qualquer asset ter sido gerado e antes de uma linha de jogo existir — que é a razão de ele ter custado uma varredura de texto em vez de uma refatoração.

## Requisitos

| Requisito | Detalhe |
| --- | --- |
| `PIXELLAB_SECRET` | **Obrigatório.** Token de `https://pixellab.ai/account`. Fica só no processo Node, nunca chega ao navegador. Ponte no `.env` do estúdio ou exporte na shell |
| `PIXELLAB_TIER` | `free` \| `t1` \| `t2` \| `t3`. **Não é o tier da sua conta — é um teto que você declara.** Resolve para 1 / 2 / 4 / 20 **chamadas simultâneas** à API. O CLI do pipeline assume `t1` quando a variável está ausente; o editor, não — ele cai no default próprio de 8 ([ADR 0042](docs/adr/0042-teto-de-concorrencia-mede-chamadas.md)). Declará-la **diminui** o teto do editor em `free`, `t1` e `t2` |
| `CHARACTER_BUILDER_JOB_CONCURRENCY` | Opcional, inteiro ≥ 1. Teto de **chamadas simultâneas** da fila de geração do editor; tem precedência sobre `PIXELLAB_TIER`. Ausente, vale 8 — que é **inferência declarada, não medição** ([ADR 0042](docs/adr/0042-teto-de-concorrencia-mede-chamadas.md)) |
| `CHARACTER_BUILDER_JOB_QUEUE_JSON` | Opcional. Onde a fila de geração persiste o estado. Ausente, é `job-queue.json` dentro de `tools/character-builder/` ([ADR 0041](docs/adr/0041-fila-fifo-persistente-de-geracao.md)) |
| `ANTHROPIC_API_KEY` | Opcional. Normaliza a descrição do bloco e escreve a ação da animação. Ausente, os dois caem num fallback determinístico, sem rede e sem custo ([ADR 0046](docs/adr/0046-prompt-do-bloco-respeita-a-descricao.md)) |
| Node.js | **≥ 24.** Executa `.ts` direto, sem passo de build |
| Crédito na PixelLab | 1 crédito = US$ 1,00. Todo asset gerado gasta dinheiro real, e o preço é sempre **estimado** |

O guard de orçamento **informa e nunca recusa**: estima o custo, mostra o acumulado da sessão e do mês, e pede confirmação. Quem decide parar é você ([ADR 0012](docs/adr/0012-guard-de-orcamento-informativo.md)).

## Estado atual

| Parte | Estado |
| --- | --- |
| Pipeline de assets | **funcional** — 9 comandos, idempotente, guard de custo, empacotador de atlas |
| Sprite Studio (o motor do estúdio de personagem) | **funcional** — gera personagem em 8 direções, poses e guarda-roupa |
| Conhecimento vendorizado (PixelLab + PixiJS) | **funcional** — dois specs com proveniência, 39 skills verificadas |
| Documentação | **59 arquivos em `docs/`, 43 ADRs.** O índice não lista arquivo inexistente |
| Fila de geração | **funcional** — FIFO persistente, sobrevive ao reinício do Vite, retomada sem repagar em seis dos sete ramos ([ADR 0041](docs/adr/0041-fila-fifo-persistente-de-geracao.md), [0043](docs/adr/0043-retomada-sem-repagar-e-o-estado-interrompido.md)) |
| Aplicativo único (tela inicial + estúdio + editor de mapa) | **funcional** — `tools/character-builder` (459 testes), roteador por hash com 3 rotas (ADR 0034); o `tools/map-builder` foi fundido nele |
| Mapa e mecânicas (geometria, autoladrilhamento, física) | **funcional** — `packages/iso-core` (473 testes) + editor de mapa em `tools/character-builder/src/map/` |
| Runtime (renderizador, exportação, preview) | **funcional** — `tools/runtime` (795 linhas em `src/`) |
| Assets gerados | **zero.** O lockfile não existe e o ledger está vazio |

## Convenções

- **Documentação e todo texto que o usuário lê: português do Brasil.**
- **Código, identificadores, nomes de arquivo de código e mensagens de commit: inglês.**
- Todo documento abre com um Quick Start (TL;DR) em blockquote e fecha com `## Referências`.
- Fatos sobre APIs externas são checados contra fonte primária e **datados**. Nada de memória.
- Repositório, pasta local e escopo npm são o mesmo nome: `isometric-maker` ([ADR 0017](docs/adr/0017-nome-unico-isometric-maker.md)).

## Referências

- [`PLANO-DE-EXECUCAO.md`](PLANO-DE-EXECUCAO.md) — a árvore de tarefas: 46 cards em 18 ondas, com o prompt de cada um. **Comece pelo card `I-01`**
- [`docs/README.md`](docs/README.md) — índice completo da documentação
- [`AGENTS.md`](AGENTS.md) — instruções para agentes de código
- [`docs/adr/`](docs/adr/) — as decisões e seus motivos

**Última atualização:** 2026-08-05
