# ADR 0005 — Perspectiva low top-down, 8 direções

> **Quick Start (TL;DR)**
>
> `view: "low top-down"` em personagens **e** em tilesets, 8 direções na ordem canônica `S, SW, W, NW, N, NE, E, SE`.

**Status:** aceita · **Data:** 2026-07-29

## Contexto

O PixelLab exige um `view` fixo em quase todo endpoint, e a escolha trava o pipeline de arte inteiro. As opções são `side`, `low top-down` e `high top-down`.

No jogo, **o equipamento define a classe** — então o outro jogador precisa conseguir ler visualmente o que você está vestindo. Isso é requisito de gameplay, não estética.

## Decisão

`low top-down` (visão 3/4), 8 direções.

Detalhe que quase passou: o enum `TilesetCameraView` do spec aceita `low top-down`, mas o **default do endpoint é `high top-down`**. Precisa ser passado explicitamente ou o terreno sai numa perspectiva diferente dos personagens.

## Consequências

- Rosto, peitoral, elmo e arma na mão ficam visíveis: leitura de ameaça alta em PvP, e a zona de cabeça faz sentido visualmente.
- Terreno e personagens compartilham a mesma perspectiva.
- **Ordem canônica importa:** `generate-8-rotations-v3` devolve os frames em `S, SW, W, NW, N, NE, E, SE`. Nomear na ordem errada faz o sprite andar de lado, e é um bug silencioso.
- **Custo:** mais oclusão e mapa mais trabalhoso que `high top-down`.
- Truque da comunidade que continua válido: para personagem simétrico, se uma diagonal sai ruim e a oposta sai boa, espelhar horizontalmente resolve e economiza uma geração.

## Referências

- `openapi/openapi-v2.json` — enums `CameraView`, `TilesetCameraView`, `Direction`

**Última atualização:** 2026-07-29
