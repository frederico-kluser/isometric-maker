# ADR 0006 — Animação em `mode='template'`; `pro` proibido sem decisão explícita

> **Quick Start (TL;DR)**
>
> `template` custa **1 geração por direção**. `pro` custa **20–40 por direção**, ou seja **160–320 para as 8** — e a própria API diz que é pior. O guard recusa `pro` por default.

**Status:** aceita · **Data:** 2026-07-29

## Contexto

O spec vendorizado traz este aviso, verbatim, em `/objects/{object_id}/animations`:

> **Cost warning**: when generating on a subscription, `mode='pro'` costs 20-40 generations per direction (160-320 for a full 8-direction animation). Prefer `mode='v3'` (default) — it usually produces higher quality results and is cheaper.

Os três modos de `animate-character`:

| Modo | Custo | Nota |
|---|---|---|
| `template` | **1 geração/direção** | esqueleto a partir de `template_animation_id` |
| `v3` | ~1/direção até 96px; 128px ≈ 2; 160px ≈ 4; 256px ≈ 8 | ação por texto livre |
| `pro` | **20–40/direção** | gera direções em sequência usando as prontas como referência |

A biblioteca de templates já inclui o que um jogo medieval de combate corpo a corpo precisa: `attack`, `attack-back`, `attack-left`, `attack-right`, `breathing-idle`, `crouched-walking`, `angry`.

## Decisão

`mode='template'` como default do catálogo. `pro` exige decisão registrada. O guard de orçamento tem um teto por asset (`maxAssetUsd`) justamente para pegar um `pro` acidental antes de submeter.

## Consequências

- 60 criaturas × 4 animações × 8 direções custa ~US$ 28 em vez de ~US$ 4.500.
- **Custo aceito:** ficamos restritos ao vocabulário de animação dos templates. Ações fora dele usam `v3`, com custo maior e escalando por tamanho.
- Animação é enfileirada como **um job por direção** — 1.920 jobs para 60 criaturas. É o que torna a fila retomável obrigatória, não opcional.

## Referências

- `openapi/openapi-v2.json` — descrição de `/animate-character` e `/objects/{id}/animations`
- [`docs/01-pixellab/custos-e-limites.md`](../01-pixellab/custos-e-limites.md)

**Última atualização:** 2026-07-29
