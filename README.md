# isometric-maker

Um **construtor de jogos isométricos**: monta o personagem a partir de uma imagem, desenha um mapa com altura, e roda o resultado. Arte gerada pela PixelLab, desenho na tela em PixiJS 8. Roda na sua máquina, para você.

> **Quick Start (TL;DR)**
>
> A ferramenta de arte já funciona; o editor ainda não existe. Comece pelo pipeline, que planeja custo sem gastar nada.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline
> npm install
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

Quatro partes, construídas nesta ordem:

1. **Construtor de personagem.** Você anexa uma imagem e informa a altura. O editor gera as 8 direções, estima o esqueleto para você aprovar, e produz andar, correr e pular. A prévia mostra o personagem animado com seletor de direção e ação.
2. **Construtor de mapa.** Grade isométrica com eixo Z **inteiro**: blocos empilhados, paredes em aresta, degraus. Tile de 64×32, um nível de altura vale 16 px.
3. **Mecânicas.** Movimento, colisão, e salto cuja altura determina quais níveis são alcançáveis.
4. **Runtime.** Carrega o projeto exportado e roda, sem interface de edição.

O artefato final é **um projeto em JSON mais os atlas de sprite**. Nada de nuvem, nada de conta, nada de sincronização.

## O que ele não é

Sem servidor, sem multiplayer, sem netcode, sem anti-cheat, sem moderação. Não há jogadores — há um usuário, na própria máquina. Isso é escopo declarado, não omissão: ver [ADR 0010](docs/adr/0010-pivo-para-editor-isometrico.md) e [`docs/00-produto/visao.md`](docs/00-produto/visao.md).

Este repositório já foi um MMORPG hardcore. O pivô aconteceu em 2026-07-30, antes de qualquer asset ter sido gerado e antes de uma linha de jogo existir — que é a razão de ele ter custado uma varredura de texto em vez de uma refatoração.

## Requisitos

| Requisito | Detalhe |
| --- | --- |
| `PIXELLAB_SECRET` | **Obrigatório.** Token de `https://pixellab.ai/account`. Fica só no processo Node, nunca chega ao navegador. Ponte no `.env` do estúdio ou exporte na shell |
| `PIXELLAB_TIER` | `free` \| `t1` \| `t2` \| `t3`, default `t1`. Define quantos jobs correm em paralelo (1 / 2 / 4 / 20) |
| Node.js | **≥ 24.** Executa `.ts` direto, sem passo de build |
| Crédito na PixelLab | 1 crédito = US$ 1,00. Todo asset gerado gasta dinheiro real, e o preço é sempre **estimado** |

O guard de orçamento **informa e nunca recusa**: estima o custo, mostra o acumulado da sessão e do mês, e pede confirmação. Quem decide parar é você ([ADR 0012](docs/adr/0012-guard-de-orcamento-informativo.md)).

## Estado atual

| Parte | Estado |
| --- | --- |
| Pipeline de assets | **funcional** — 9 comandos, idempotente, guard de custo, empacotador de atlas |
| Sprite Studio (vira o construtor de personagem) | **funcional** — gera personagem em 8 direções, poses e guarda-roupa |
| Conhecimento vendorizado (PixelLab + PixiJS) | **funcional** — dois specs com proveniência, 29 skills verificadas |
| Documentação | **28 docs escritos.** O índice não lista arquivo inexistente |
| Construtor de personagem (prévia PixiJS, editor de esqueleto) | **funcional** — estúdio com editor de esqueleto e diálogo de custo |
| Construtor de mapa (geometria, tiles, autoladrilhamento) | **funcional** — `packages/iso-core` (5.612 linhas) + `tools/map-builder` (2.716 linhas) |
| Runtime (renderizador, exportação, preview) | **funcional** — `tools/runtime` (795 linhas) |
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

**Última atualização:** 2026-07-30
