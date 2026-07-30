# Índice da documentação

> **Quick Start (TL;DR)**
>
> Comece por [`01-pixellab/README.md`](./01-pixellab/README.md) se vai gerar arte, ou por [`02-design/combate-zonas-oscilantes.md`](./02-design/combate-zonas-oscilantes.md) se quer entender o que torna este jogo diferente.
>
> ```bash
> cd /home/ondokai/Projects/ferro-e-cinzas/tools/pixellab-pipeline
> node src/cli.ts plan     # nunca gasta
> ```

Estado em **2026-07-29**. As pastas são numeradas do concreto (o jogo) para o abstrato (infra), seguindo o padrão de `/home/ondokai/Projects/config`.

## 00 — Visão geral

| Arquivo | Descrição | Estado |
|---|---|---|
| `conceito.md` | O jogo em cinco regras e por que cada uma existe | pendente |
| `pilares-de-design.md` | Os quatro pilares e a regra de veto: feature que reduz risco é rejeitada por default | pendente |
| `glossario.md` | Vocabulário pt-BR do jogo e do código | pendente |

## 01 — PixelLab (o manual)

A parte mais profunda. Toda arte do jogo vem daqui, e a documentação pública sobre esta API é sistematicamente errada.

| Arquivo | Descrição | Estado |
|---|---|---|
| [`README.md`](./01-pixellab/README.md) | Índice, as seis superfícies do produto, os três erros que os blogs cometem | **pronto** |
| [`custos-e-limites.md`](./01-pixellab/custos-e-limites.md) | Preço estimado e limite de tamanho por endpoint, as três armadilhas de custo, orçamento do jogo | **pronto** |
| `autenticacao-e-saldo.md` | Bearer, `PIXELLAB_SECRET`, `GET /balance`, as duas unidades de cobrança | pendente |
| [`modelo-assincrono.md`](./01-pixellab/modelo-assincrono.md) | `202` + `background_job_id`, poll, os códigos 423/410/529, concorrência por tier | **pronto** |
| `endpoints-personagens.md` | 8 direções, v3, Pro, `create-character-state`, proporções, templates de corpo | pendente |
| `endpoints-animacao.md` | `template` vs `v3` vs `pro`, biblioteca de animações, custo por direção | pendente |
| `endpoints-tilesets.md` | Wang tiles, `corners`, `pattern_4x4`, encadeamento de biomas | pendente |
| `endpoints-imagem.md` | pixflux, pixen, bitforge, inpaint, rotate | pendente |
| `endpoints-objetos-ui.md` | `map-objects` e a expiração em 8 h, UI, fonte, retrato | pendente |
| `consistencia-estilo.md` | Como fazer 2.700 imagens parecerem do mesmo jogo | pendente |
| `autotiling.md` | Do `pattern_4x4` ao terreno desenhado no PixiJS | pendente |
| `cookbook.md` | Receitas contra o nosso pipeline | pendente |
| `limitacoes.md` | O que não funciona bem, sem marketing | pendente |
| [`licenca-e-termos.md`](./01-pixellab/licenca-e-termos.md) | Posse dos assets, uso comercial, Open RAIL-M, ausência de indenização de IP | **pronto** |
| [`delta-vs-guia-antigo.md`](./01-pixellab/delta-vs-guia-antigo.md) | Errata de 15 itens contra `/home/ondokai/Projects/tech-docs/games/5.md`, e o que dele continua válido | **pronto** |

## 02 — Design (GDD)

| Arquivo | Descrição | Estado |
|---|---|---|
| [`combate-zonas-oscilantes.md`](./02-design/combate-zonas-oscilantes.md) | A mecânica central: alvo travado, zonas oscilantes, dano por ângulo, anti-cheat e o risco de não ser divertido | **pronto** |
| `permadeath-e-full-loot.md` | O que é apagado, o corpo saqueável, e a curva de reengajamento pós-morte | pendente |
| `equipamento-define-classe.md` | Build é equipamento; perder o set é perder a classe | pendente |
| `pocoes-e-regeneracao.md` | Cura lenta e gradual como fluxo de regeneração, não cura instantânea, e o efeito disso no PvP | pendente |
| `stamina-descanso-sono.md` | Consumo, descanso, sono e o acampamento como objetivo | pendente |
| `zonas-e-pvp.md` | Faixas de risco e por que alguém entraria na pior delas | pendente |
| `criaturas-e-monstros.md` | Bestiário: é a fonte que alimenta o catálogo de assets | pendente |
| `missoes.md` | Contratos e recompensas sem ponto de exclamação | pendente |

## 03 — Arquitetura

| Arquivo | Descrição | Estado |
|---|---|---|
| `servidor-autoritativo.md` | Loop de tick, predição só do jogador local, o que o cliente nunca decide | pendente |
| `netcode-e-protocolo.md` | WebSocket binário, orçamento de bytes/s por jogador como KPI de custo | pendente |
| `interest-management-aoi.md` | Grid espacial e o caso patológico de 80 jogadores no mesmo tile | pendente |
| `sharding-de-zonas.md` | Uma zona = um processo; handoff com escrow de inventário | pendente |
| `banco-de-dados.md` | DDL de `character`, `item`, `item_ledger`, `corpse`, `consignment_listing` | pendente |
| `transacao-de-morte-e-loot.md` | Morte + full loot atômicos e à prova de duplicação | pendente |
| `efeitos-por-tick.md` | Regeneração e stamina sem um timer por jogador por efeito | pendente |
| [`paper-doll-e-equipamento.md`](./03-arquitetura/paper-doll-e-equipamento.md) | Equipamento visível em 8 direções: o que a API não resolve e as 3 soluções de jogos reais | **pronto** |

## 04 — Cloud

Escrito por último, de propósito: doc de infra antes de existir infra é ficção.

| Arquivo | Descrição | Estado |
|---|---|---|
| `fase-1-vm-unica.md` | Uma VM em São Paulo, docker compose, 200–500 CCU | pendente |
| `fase-2-gke-agones.md` | GKE + Agones, e o que **não** melhora ao migrar | pendente |
| `custos-brl.md` | Custo mensal em BRL. Achado central: **egress domina a conta, não CPU** | pendente |
| `gatilho-de-migracao.md` | Critério numérico para sair da fase 1, e os anti-gatilhos | pendente |

## 05 — Economia

| Arquivo | Descrição | Estado |
|---|---|---|
| `economia-player-driven.md` | Nenhum item entra no mundo sem passar por um jogador | pendente |
| `consignacao-npc.md` | O NPC não cria e não compra: só revende item de jogador | pendente |
| `sinks-e-inflacao.md` | Reparo, taxa, decomposição, e a morte como o maior sink do jogo | pendente |
| `anti-rmt.md` | RMT é inevitável: detectar e tornar caro | pendente |

## 06 — Anti-cheat e moderação

| Arquivo | Descrição | Estado |
|---|---|---|
| `sem-gms.md` | O que substitui cada ticket de GM, e o que explicitamente não terá remédio | pendente |
| `validacao-server-side.md` | Movimento, cooldown, plausibilidade estatística de acerto por zona | pendente |
| `anti-bot.md` | Detecção comportamental e por que CAPTCHA em MMO é ruim | pendente |
| `anti-dupe.md` | Trigger que torna `UPDATE` ad-hoc de item estruturalmente impossível | pendente |

## 07 — Pipeline de assets

| Arquivo | Descrição | Estado |
|---|---|---|
| `catalogo-e-idempotencia.md` | As três hashes e a tabela de decisão de invalidação | pendente |
| `atlas-e-pixijs.md` | Spritesheet, extrusão, e as cinco regras de pixel-perfect | pendente |
| `orcamento-e-tempo.md` | Quanto custa e quanto demora a biblioteca completa | pendente |

### Ferramentas

| Ferramenta | O que faz | Estado |
|---|---|---|
| [`tools/pixellab-pipeline`](../tools/pixellab-pipeline/) | Geração em lote, idempotente, com guard de orçamento e atlas | **funcional** |
| [`tools/sprite-studio`](../tools/sprite-studio/README.md) | Tela de autoria: corpo base 8 direções, poses, guarda-roupa | **funcional** |

## ADR — decisões registradas

Nunca editadas. Uma decisão revista gera ADR novo que substitui a anterior.

| ADR | Decisão | Estado |
|---|---|---|
| [`0001`](./adr/0001-pixijs-em-vez-de-cocos.md) | PixiJS 8 + Vite no cliente, divergindo da pesquisa própria que apontava Cocos Creator | **pronto** |
| [`0002`](./adr/0002-cliente-rest-gerado-do-openapi.md) | Cliente REST do OpenAPI vendorizado, não o SDK oficial | **pronto** |
| [`0003`](./adr/0003-permadeath-total.md) | Permadeath total, sem exceção, sem restauração | **pronto** |
| [`0004`](./adr/0004-combate-alvo-travado-zonas-oscilantes.md) | Combate travado no alvo com zonas oscilantes | **pronto** |
| [`0005`](./adr/0005-low-top-down-8-direcoes.md) | `view: "low top-down"`, 8 direções, ordem canônica S,SW,W,NW,N,NE,E,SE | **pronto** |
| [`0006`](./adr/0006-animacao-em-template-mode.md) | Animação em `mode='template'`; `pro` proibido sem decisão explícita | **pronto** |
| [`0007`](./adr/0007-fase1-vm-unica.md) | Fase 1 VM única em São Paulo, com gatilho numérico para GKE + Agones | **pronto** |
| [`0008`](./adr/0008-idioma-docs-ptbr-codigo-en.md) | Docs e texto de jogo em pt-BR; código e commits em inglês | **pronto** |

## Skills

Duas Agent Skills em `/home/ondokai/Projects/ferro-e-cinzas-skills/`, instaladas por symlink em todos os agentes da máquina:

| Skill | Cobre |
|---|---|
| `pixellab-assets` | Gerar pixel art sem torrar crédito. Inclui `inspect-spec.mjs`, que responde sobre a API lendo o spec |
| `ferro-engine` | A engine: netcode, combate, anti-dupe, moderação sem GM |

## Histórico

- **2026-07-29** — Repositório criado. Spec v2 do PixelLab vendorizado (sha256 `5b11c9a7afa1…`). Pipeline com `plan`/`estimate`/`balance`/`verify`/`doctor` funcionando. Manual de custos e limites, doc de combate e as 8 ADRs escritos.

## Referências

- [`/home/ondokai/Projects/ferro-e-cinzas/AGENTS.md`](../AGENTS.md) — regras para agentes, incluindo as 12 convenções de documentação
- [`/home/ondokai/Projects/config/CLAUDE.md`](/home/ondokai/Projects/config/CLAUDE.md) — origem das 8 convenções obrigatórias de doc
- [`/home/ondokai/Projects/tech-docs/games/5.md`](/home/ondokai/Projects/tech-docs/games/5.md) — guia anterior do PixelLab, **defasado**; ver `01-pixellab/delta-vs-guia-antigo.md`

**Última atualização:** 2026-07-29
