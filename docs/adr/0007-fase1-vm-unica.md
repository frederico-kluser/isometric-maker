# ADR 0007 — Fase 1 em VM única, com gatilho numérico para GKE + Agones

> **Quick Start (TL;DR)**
>
> Fase 1: uma VM em São Paulo com docker compose, alvo 200–500 CCU. Fase 2: GKE + Agones. **Mesmo código nas duas** — o servidor nasce shardado por zona.

**Status:** aceita · **Data:** 2026-07-29

## Contexto

`gcloud` e `kubectl` estão instalados na máquina; `aws` e `flyctl` não. Mas montar GKE + Agones antes de existir um jogador significa semanas em infra em vez de gameplay, com custo fixo alto.

## Decisão

Duas fases, um código. O processo de zona é autoritativo e stateless na borda desde o primeiro commit, então migrar é configuração.

Migrar quando **qualquer** condição se sustentar por 7 dias: p95 de ms/tick acima de 60% do orçamento na zona mais quente; pico de CCU acima de 400 em 3 dos últimos 7 dias; uma zona sozinha exigindo mais de 4 vCPU; ou requisito novo de produto (deploy sem derrubar jogador, segunda região).

**Anti-gatilhos** — não migre por: "Kubernetes é mais profissional", pico isolado de fim de semana, ou custo (GKE + Agones é **mais** caro).

## Consequências

- Primeiro jogador em dias, não semanas.
- **Achado que precisa ser confirmado antes de fechar provedor:** os dois desenhos técnicos independentes chegaram à mesma conclusão de que **egress domina a conta, não CPU**. A ordem de grandeza estimada é de alguns TB/mês a 500 CCU sustentado, o que em preço de egress de São Paulo fica na casa de centenas de dólares mensais — comparável ou superior à própria VM. Se confirmar, o campo "bytes por snapshot" do netcode vale mais em reais que a escolha de máquina, e um provedor com trânsito incluso pode ser ordens de magnitude mais barato para a fase 1. **Isso ainda não foi verificado no Pricing Calculator e não deve ser tratado como número final.**
- Asset estático (atlas, JSON, cliente) sai de CDN, nunca da VM.

## Referências

- [`docs/04-cloud/`](../04-cloud/)

**Última atualização:** 2026-07-29
