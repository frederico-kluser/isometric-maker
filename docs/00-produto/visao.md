# O que o isometric-maker é, e o que ele não é

> **Quick Start (TL;DR)**
>
> Um **editor de jogos isométricos** local, de usuário único: constrói o personagem a partir de uma imagem, desenha um mapa com altura, e roda o resultado. Sem servidor, sem multiplayer, sem netcode. Este documento existe para que o MMORPG que este repositório era **não volte a crescer**.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && npm run dev
> ```

## O produto em um parágrafo

O isometric-maker é a ferramenta que constrói o jogo, não o jogo. Um usuário anexa uma imagem de personagem, o editor a rotaciona nas 8 direções, ele aprova o esqueleto, e sai um personagem que anda, corre e pula. Depois desenha um mapa isométrico com altura — chão, paredes, degraus — e move o personagem por ele. O artefato final é um **projeto em JSON mais os atlas de sprite**, que um runtime simples carrega e executa.

A arte vem da [PixelLab](../01-pixellab/README.md). O desenho na tela vem do Three.js. Tudo roda na máquina do usuário.

## O que ele não é

Esta lista é a razão de ser do documento. Cada item foi uma decisão registrada do produto anterior, e cada um deles **saiu do escopo** com a [ADR 0010](../adr/0010-pivo-para-editor-isometrico.md):

- **Não tem servidor autoritativo.** Não há um. O editor é um processo local; o que ele grava é arquivo em disco.
- **Não tem multiplayer, netcode, protocolo de rede nem sharding de zona.** Não há partida, não há tick de servidor, não há reconciliação de estado.
- **Não tem permadeath, full loot, nem economia entre jogadores.** Não há jogadores no plural.
- **Não tem anti-cheat nem moderação.** Não existe GM porque não existe contra quem moderar. Quem usa a ferramenta é dono da própria máquina e do próprio projeto.
- **Não é um motor de jogo genérico.** É um editor isométrico com eixo Z discreto e projeção 2:1 fixa. Fazer um jogo de plataforma ou de topo puro com ele é usar a ferramenta errada.
- **Não é um serviço.** Não há conta, não há nuvem, não há sincronização. A chave da PixelLab é do usuário e mora na shell dele.

Reintroduzir qualquer um desses itens exige ADR nova. E não é só prosa: `/home/ondokai/Projects/isometric-maker/scripts/check-docs.sh` falha se os termos de MMORPG reaparecerem em `docs/`.

## As quatro partes, na ordem em que são construídas

| Parte | O que entrega | Onde a doc mora |
|---|---|---|
| **Construtor de personagem** | Imagem base → 8 direções → esqueleto aprovado → andar, correr, pular → prévia com seletor de direção e ação | `docs/02-personagem/` |
| **Construtor de mapa** | Grade isométrica com Z inteiro, blocos empilhados, paredes de aresta, degraus | `docs/03-mapa/` — reservada |
| **Mecânicas** | Movimento, colisão, salto que alcança N níveis de altura | `docs/04-mecanicas/` — reservada |
| **Runtime** | Carrega o projeto exportado e roda, sem UI de edição | `docs/05-runtime/` — reservada |

As três pastas reservadas **não existem em disco**, e isso é deliberado: a convenção 12 diz que doc de infra escrita antes de existir infra é ficção. Elas são reserva de numeração, não promessa.

## O que o usuário precisa ter

| Requisito | Detalhe |
|---|---|
| `PIXELLAB_SECRET` | **Obrigatório.** Token de `https://pixellab.ai/account`. Lido só no servidor, nunca chega ao navegador. Não há dependência de dotenv: exporte na shell |
| `PIXELLAB_TIER` | `free` \| `t1` \| `t2` \| `t3`, default `t1`. Define a concorrência de jobs |
| Node.js | **≥ 24.** Executa `.ts` direto, sem passo de build |
| Crédito na PixelLab | 1 crédito = US$ 1,00. Todo asset gerado gasta dinheiro real |

O guard de orçamento **informa e nunca recusa** ([ADR 0012](../adr/0012-guard-de-orcamento-informativo.md)): antes de cada geração ele estima o custo e mostra o acumulado da sessão e do mês. Quem decide parar é o usuário.

## O nome

Repositório, pasta local e escopo npm são o mesmo nome: **`isometric-maker`**. Todo caminho absoluto na documentação aponta para `/home/ondokai/Projects/isometric-maker/`.

Houve um intervalo em que não era assim: a [ADR 0011](../adr/0011-repo-isometric-maker-pasta-power-abuse.md) manteve a pasta com o nome anterior para não quebrar worktrees, e a [ADR 0017](../adr/0017-nome-unico-isometric-maker.md) reverteu essa decisão. O nome antigo sobrevive apenas no **arquivo** da 0011, que nomeia a decisão desfeita.

## O que não foi verificado

- **Nada neste repositório jamais renderizou um quadro.** Toda afirmação sobre desempenho, ordenação de desenho ou culling é hipótese até a primeira tela existir.
- **Nenhum asset jamais foi gerado.** O lockfile não existe, o cache está vazio e o ledger está zerado. O formato exato das respostas da API é leitura de spec, não observação.
- O significado do campo `isometric` nos endpoints de personagem — ver [ADR 0015](../adr/0015-low-top-down-8-direcoes-isometrico.md). É a incógnita de maior aposta do projeto.

## Referências

- [`ADR 0010`](../adr/0010-pivo-para-editor-isometrico.md) — o pivô, e a lista do que saiu do escopo
- [`ADR 0013`](../adr/0013-geometria-isometrica-64x32-z16.md) — a geometria: 64×32, Z de 16 px, inteiro
- [`docs/README.md`](../README.md) — o índice da documentação
- [`glossario.md`](glossario.md) — os termos, em português e em inglês

**Última atualização:** 2026-07-30
