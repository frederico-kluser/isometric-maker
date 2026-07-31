# Índice da documentação

> **Quick Start (TL;DR)**
>
> Quer entender o produto? [`00-produto/visao.md`](00-produto/visao.md). Quer gerar arte? [`01-pixellab/README.md`](01-pixellab/README.md). Quer saber por que algo é do jeito que é? [`adr/`](adr/).
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline && node src/cli.ts plan
> ```

Estado em **2026-07-31**: **27 arquivos (25 docs + README + índice)**. Esta tabela não lista documento que não foi escrito.

As pastas são numeradas na ordem em que o produto é construído: o que ele é, de onde vem a arte, o personagem, o mapa, as mecânicas, o runtime.

## 00 — Produto

| Arquivo | Descrição |
| --- | --- |
| [`visao.md`](00-produto/visao.md) | O que o editor é, **o que ele não é**, as quatro partes e os requisitos de ambiente |
| [`glossario.md`](00-produto/glossario.md) | O mesmo conceito em português e em inglês, e as armadilhas de vocabulário |

## 01 — PixelLab

A API que gera a arte. Ela **muda sem versionar**, então a prosa aqui é mínima por decisão: o que envelhece mal fica no spec vendorizado e nas skills, que têm verificação automática contra ele.

| Arquivo | Descrição |
| --- | --- |
| [`README.md`](01-pixellab/README.md) | Os cinco fatos, as seis superfícies do produto, os três erros que os blogs cometem |
| [`custos-e-limites.md`](01-pixellab/custos-e-limites.md) | Preço estimado e limite de tamanho por endpoint, e o orçamento de um projeto |
| [`modelo-assincrono.md`](01-pixellab/modelo-assincrono.md) | `202` mais job id, poll, os códigos estranhos (423, 410, 529), concorrência |
| [`licenca-e-termos.md`](01-pixellab/licenca-e-termos.md) | Posse do asset, uso comercial, Open RAIL-M, ausência de indenização de IP |
| [`delta-vs-guia-antigo.md`](01-pixellab/delta-vs-guia-antigo.md) | Errata de 15 itens contra o guia antigo em `tech-docs/games/5.md` |

## 02 — Personagem

| Arquivo | Descrição |
|---|---|
| [`guarda-roupa-e-silhueta.md`](02-personagem/guarda-roupa-e-silhueta.md) | Por que a API não faz paper-doll, as três soluções que jogos reais usam, e por que silhueta é restrição de autoria |

## Plano de execução

| Arquivo | Descrição |
| --- | --- |
| [`plano/README.md`](plano/README.md) | Estado do plano de execução |
| [`plano/experimentos/E1.md`](plano/experimentos/E1.md) | Experimento 1 |
| [`plano/experimentos/E2.md`](plano/experimentos/E2.md) | Experimento 2 |
| [`plano/experimentos/E5.md`](plano/experimentos/E5.md) | Experimento 5 |

## Pastas reservadas

Numeração reservada. A convenção 12 diz que doc de infra escrita antes de existir infra é ficção — a documentação nasce junto com o código ou depois, nunca antes.

| Pasta | O que mora ali | Código correspondente |
| --- | --- | --- |
| `03-mapa/` | Projeção e coordenadas, o formato do mapa XYZ, autoladrilhamento | `packages/iso-core` + `tools/map-builder` — **código existe, doc pendente** |
| `04-mecanicas/` | Movimento, colisão, degrau e salto por altura | `packages/iso-core` — **código existe, doc pendente** |
| `05-runtime/` | Como o projeto exportado é carregado e executado | `tools/runtime` — **código existe, doc pendente** |
| `06-editor/` | Arquitetura do editor, o formato do arquivo de projeto, strings e i18n | — |

## Ferramentas

| Ferramenta | O que faz | Estado |
| --- | --- | --- |
| [`tools/pixellab-pipeline`](../tools/pixellab-pipeline/) | Geração em lote, idempotente, com guard de custo e empacotador de atlas | **funcional** |
| [`tools/character-builder`](../tools/character-builder/README.md) | Tela de autoria: corpo base nas 8 direções, poses, guarda-roupa. Evolui para o construtor de personagem | **funcional** |
| [`tools/pixi-reference`](../tools/pixi-reference/README.md) | **Não é o cliente.** Fixa o PixiJS 8.19.0 e vendoriza tipos e as 26 skills oficiais, para as skills citarem em vez de lembrar | **funcional** |

## ADR — decisões registradas

Nunca editadas. Uma decisão revista gera ADR novo que substitui a anterior, e a antiga fica exatamente como foi escrita. A ADR nova declara `**Substitui:** ADR NNNN` numa linha logo abaixo do Status; a coluna `Situação` abaixo é o único lugar onde a supersessão aparece para quem lê o índice.

| ADR | Decisão | Situação |
| --- | --- | --- |
| [`0001`](./adr/0001-pixijs-em-vez-de-cocos.md) | PixiJS 8 + Vite no cliente, divergindo da pesquisa própria que apontava Cocos Creator | substituída por 0014 |
| [`0002`](./adr/0002-cliente-rest-gerado-do-openapi.md) | Cliente REST do OpenAPI vendorizado, não o SDK oficial | vigente |
| `0003` | Permadeath total | apagada — escopo removido pela 0010 |
| `0004` | Combate travado no alvo com zonas oscilantes | apagada — escopo removido pela 0010 |
| [`0005`](./adr/0005-low-top-down-8-direcoes.md) | `view: "low top-down"`, 8 direções, ordem canônica S,SW,W,NW,N,NE,E,SE | substituída por 0015 |
| [`0006`](./adr/0006-animacao-em-template-mode.md) | Animação em `mode='template'`; `pro` proibido sem decisão explícita | vigente |
| `0007` | Fase 1 em VM única, com gatilho numérico para GKE | apagada — escopo removido pela 0010 |
| [`0008`](./adr/0008-idioma-docs-ptbr-codigo-en.md) | Docs em pt-BR; código e commits em inglês | vigente |
| [`0009`](./adr/0009-conhecimento-pixijs-vendorizado.md) | Tipos e skills oficiais do PixiJS 8.19.0 vendorizados; skills citam, não reescrevem a API | vigente |
| [`0010`](./adr/0010-pivo-para-editor-isometrico.md) | **O produto é um editor isométrico, não um MMORPG** | vigente |
| [`0011`](./adr/0011-repo-isometric-maker-pasta-power-abuse.md) | Repositório `isometric-maker`, pasta local continua `power-abuse` | substituída por 0017 |
| [`0012`](./adr/0012-guard-de-orcamento-informativo.md) | O guard de orçamento informa e nunca recusa | vigente |
| [`0013`](./adr/0013-geometria-isometrica-64x32-z16.md) | Tile 64×32, nível Z de 16 px, Z inteiro e discreto | vigente |
| [`0014`](./adr/0014-pixijs-para-o-editor.md) | PixiJS 8 continua, agora contra o argumento oposto | vigente |
| [`0015`](./adr/0015-low-top-down-8-direcoes-isometrico.md) | `low top-down`, 8 direções, e o endpoint que o isométrico obriga | vigente |
| [`0016`](./adr/0016-ui-ptbr-strings-centralizadas.md) | UI em pt-BR com strings centralizadas desde o primeiro commit | vigente |
| [`0017`](./adr/0017-nome-unico-isometric-maker.md) | Um nome só: `isometric-maker` no repositório, na pasta e nos pacotes | vigente |
| [`0018`](./adr/0018-artefato-de-exportacao.md) | O artefato de exportação: `project.json` v1 | vigente |

## Skills

**29 skills** em [`.agents/skills/`](../.agents/skills/), indexadas em [`catalog.md`](../.agents/skills/catalog.md). O caminho `.claude/skills` é symlink para lá, então qualquer agente vê os mesmos arquivos.

Dois roteadores: [`project-router`](../.agents/skills/project-router/SKILL.md), por onde toda tarefa passa, e [`routing-pixijs-work`](../.agents/skills/routing-pixijs-work/SKILL.md), para qualquer coisa que toque o renderizador. Dez skills cobrem os 79 endpoints do PixelLab, dez cobrem o PixiJS, e o restante é tarefa e meta.

`enforcing-server-authority` foi **retirada com o pivô e não tem sucessora** — o assunto dela deixou de existir.

## Histórico

| Data | O que mudou |
| --- | --- |
| 2026-07-29 | Documentação inicial: manual do PixelLab, design de combate, as oito primeiras ADRs |
| 2026-07-30 | Sprite Studio; conhecimento do PixelLab e do PixiJS vendorizado em vinte skills; ADR 0009 |
| 2026-07-30 | **Pivô para o isometric-maker** ([ADR 0010](./adr/0010-pivo-para-editor-isometrico.md)): docs e ADRs de MMORPG apagados, sete ADRs novas, índice reescrito sem entrada inexistente |

## Referências

- [`/home/ondokai/Projects/isometric-maker/README.md`](../README.md) — visão geral do repositório
- [`/home/ondokai/Projects/isometric-maker/AGENTS.md`](../AGENTS.md) — instruções para agentes, e as 12 convenções de documentação
- [`/home/ondokai/Projects/isometric-maker/scripts/check-docs.sh`](../scripts/check-docs.sh) — o que é verificado automaticamente nesta pasta
- [`/home/ondokai/Projects/isometric-maker/.agents/skills/catalog.md`](../.agents/skills/catalog.md) — o índice das skills

**Última atualização:** 2026-07-31
