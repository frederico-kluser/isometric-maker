# Errata contra o guia anterior

> **Quick Start (TL;DR)**
>
> `/home/ondokai/Projects/tech-docs/games/5.md` é um guia bom que envelheceu mal. Ele descreve a **v1**, erra o modelo de execução e subestima o custo dos modelos novos em até **20×**. Este documento lista o que mudou, item por item — e o que dele continua válido.

## Por que esta errata existe

O guia antigo não estava errado quando foi escrito. Ficou errado porque a API do PixelLab **muda sem versionar** — o `info.version` do próprio spec OpenAPI é literalmente `"dev"`. É exatamente esse mecanismo que vai fazer *este* documento envelhecer também, e é por isso que o repositório fixa o spec com data e sha256 e roda `scripts/check-docs.sh` para garantir que todo endpoint citado ainda existe.

## O que mudou

| # | O guia antigo diz | O que a v2 diz | Por que importa |
|---|---|---|---|
| 1 | *"os tools MCP são assíncronos… isso difere da API REST v2 que é síncrona"* | **Invertido para a maior parte.** 23 dos 56 endpoints POST devolvem `202` + `background_job_id`. Só a família de imagem e esqueleto é síncrona | Muda a arquitetura inteira do pipeline. Sem fila, poll e estado persistido, você perde jobs **já pagos** |
| 2 | `POST /generate-image-pixflux` | `POST /create-image-pixflux` | Todo snippet do cookbook antigo dá 404 |
| 3 | `POST /animate-skeleton` | `POST /animate-with-skeleton` | idem |
| 4 | *"os seis endpoints core"* | 56 endpoints POST em ~12 famílias | Ignora personagem 8-dir nativo, `create-character-state`, `animate-with-text` v2/v3, `interpolation-v2`, `transfer-outfit-v2`, `create-tiles-pro`, UI, fonte, retrato, lip-sync e os *prompt enhancers* |
| 5 | Custo teto de US$ 0,0157 | Faixa **Pro/v3 de US$ 0,041 a US$ 0,185** | Penhasco de 4 a 20×. Um orçamento feito com a tabela antiga subestima em ~5× |
| 6 | Nada sobre `generations` | Personagem `standard` = 1; `v3` = 2–9; `pro` = **20–40**. Animação `pro` = **20–40 por direção**, 160–320 para as 8 | É a maior armadilha de custo da API, e o próprio spec avisa que o modo caro é **pior** |
| 7 | Nada sobre recursos persistentes | `GET/DELETE /characters/{id}`, `GET /characters/{id}/zip`, `PATCH /characters/{id}/tags` — idem para objetos, tilesets, tiles-pro, isométricos e UI | Re-download é **grátis**; o `zip` economiza centenas de round-trips |
| 8 | `/rotate` como caminho para direções | `create-character-with-8-directions` nativo (1 geração!) e `generate-8-rotations-v3`, com **ordem de retorno documentada**: S, SW, W, NW, N, NE, E, SE | Sem a ordem canônica você nomeia o frame errado e o sprite anda de lado — bug silencioso |
| 9 | `/map-objects` inexistente | Existe, é o caminho **barato** (US$ 0,0099 contra US$ 0,095–0,185) e **auto-deleta em 8 h**, com poll próprio de 423/410/404 | Exige download imediato; não é cache remoto |
| 10 | Tilesets citados sem formato de resposta | 16 tiles, ou 25 com `transition_size=1.0`; cada tile com `corners {NW,NE,SW,SE}` e `pattern_4x4` (`0`/`1`/`2`/`255`=wildcard) | Sem isso não existe autotiling. É a diferença entre "tenho imagens" e "tenho terreno" |
| 11 | Mistura crédito (1 vs 40) com USD por chamada | São duas contabilidades: **1 crédito = US$ 1,00**, e `generations` é cota de assinatura | Misturar erra o orçamento nos dois sentidos |
| 12 | SDK como caminho principal | `@pixellab-code/pixellab@1.0.2` tem `api.pixellab.ai/v1` **hardcoded**, expõe **8** operações, sem release desde **2025-06-15** | Base do [ADR 0002](../adr/0002-cliente-rest-gerado-do-openapi.md) |
| 13 | Nada sobre 529 | **529** (`Rate limit exceeded`) declarado em **13 endpoints** | Quase nenhum cliente HTTP trata 529 como retentável |
| 14 | *"Tier 2 ~US$ 28"* | ~US$ 24–28 conforme a fonte | Divergência menor, mas some no texto novo |
| 15 | Nada sobre `view` de tileset | `TilesetCameraView` aceita `low top-down`, mas o **default é `high top-down`** | Se você não passa explícito, o terreno sai numa perspectiva diferente dos personagens |

## O que continua válido — não descarte o guia antigo

Estas partes de `5.md` seguem corretas e boas, e foram preservadas no manual novo:

- **As cinco alavancas de consistência**, na mesma ordem de força.
- *"Sempre comece com uma init image"*, e `init_image_strength` entre 400 e 600.
- **Ponto ideal 32×32 a 64×64** para personagem; 16×16 é visivelmente pior.
- Limite de referências de estilo caindo com o tamanho: 64 em ≤32px, 16 em 64×64, 4 em 128×128.
- *"`seed` dá muito similar, não idêntico"* — precisamente correto, e é o erro mais comum sobre `seed`.
- A dica de **espelhar horizontalmente** a diagonal oposta em personagem simétrico, economizando uma geração.
- *"fixed head → always"* em animação por esqueleto, contra deriva facial entre frames.
- A tabela de alternativas (Retro Diffusion, Scenario, SD+LoRA) e a ausência de treino de modelo customizado.
- A expectativa honesta de que **consistência nunca é 100%** e conjuntos grandes exigem retoque manual.
- E, ironicamente, o aviso mais importante dele: *"documentação frequentemente desatualizada… o Discord é a fonte mais atualizada"*. Era verdade sobre a doc da PixelLab e virou verdade sobre o próprio guia.

## Como não repetir o erro

Três mecanismos, todos no repositório:

1. **Spec vendorizado** com data e sha256 em `/home/ondokai/Projects/ferro-e-cinzas/tools/pixellab-pipeline/openapi/`.
2. **`scripts/check-docs.sh`**, que falha se alguma doc citar endpoint que não existe no spec — com uma lista explícita de nomes v1 citados de propósito.
3. **`scripts/fetch-spec.mjs --diff`** na skill, que compara o snapshot com a API ao vivo e relata paths adicionados e removidos.

E uma regra escrita em `AGENTS.md`: **nunca escreva sobre esta API de memória.**

## Referências

- `/home/ondokai/Projects/tech-docs/games/5.md` — o guia anterior, lido na íntegra
- O spec vendorizado, capturado 2026-07-29, sha256 em `PROVENIENCIA.txt`

**Última atualização:** 2026-07-29
