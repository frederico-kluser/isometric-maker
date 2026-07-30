# Custos e limites do PixelLab

> **Quick Start (TL;DR)**
>
> O documento que evita prejuízo. Antes de qualquer lote, rode o guard:
>
> ```bash
> cd /home/ondokai/Projects/ferro-e-cinzas/tools/pixellab-pipeline
> node src/cli.ts plan && node src/cli.ts estimate
> ```

- **Duas unidades de cobrança convivem.** Crédito pré-pago, onde **1 crédito = US$ 1,00**, e `generations`, que é cota de assinatura. A resposta da API traz `usage: {type: "usd" | "generations", usd, generations}` — o pipeline soma as duas separadamente e nunca mistura.
- **A diferença entre modos é de até 40×.** Personagem `standard` = **1 geração**; `v3` = **2–9**; `pro` = **20–40**. Animação `template` = **1 geração por direção**; animação `pro` = **20–40 por direção**, ou seja **160–320 para as 8 direções**.
- **Todo preço é estimado.** A PixelLab rotula a coluna como `Estimated Price* (USD)` com a nota: *"All prices are estimates and will vary because of variation in the GPU processing time."* Nunca escreva nem calcule como se fosse fixo.
- **A biblioteca completa deste jogo sai por ~US$ 40** na primeira passada. O gargalo é tempo (~8 h com 20 jobs simultâneos), não dinheiro.

## As três armadilhas de custo

Em ordem de quanto podem doer.

### 1. `mode='pro'` em animação — 160 a 320 gerações

O próprio spec da API traz o aviso, verbatim em `/objects/{object_id}/animations`:

> **Cost warning**: when generating on a subscription, `mode='pro'` costs 20-40 generations per direction (160-320 for a full 8-direction animation). Prefer `mode='v3'` (default) — it usually produces higher quality results and is cheaper.

Ou seja: o modo mais caro **também é pior**. Nosso default é `mode='template'` (1 geração/direção). O pipeline recusa `pro` sem flag explícita.

### 2. `create-8-direction-object` — 20 a 40 gerações por chamada

Objetos usam as Pro Tools. Para props de mapa (barril, tocha, baú, cadáver), use **`/map-objects`** a US$ 0,0099 — cerca de 10 a 20× mais barato. Reserve `create-8-direction-object` para o punhado de objetos que realmente precisam ser vistos de 8 ângulos.

### 3. Confundir `generations` com créditos

Reviews de terceiros escrevem "1 crédito por request, 40 créditos nos modelos novos". **Errado.** O `40` é o campo `generations` (cota de assinatura). Crédito é USD com paridade 1:1. Quem lê `40 créditos` como `US$ 40` erra o orçamento em ~40×.

## Preço estimado por endpoint

Conferido em **2026-07-29** contra `pixellab.ai/pixellab-api`, incluindo o objeto de preços no bundle JS da própria página (`prices:[{size:'64×64',credits:.041,generations:2}, …]`).

### Personagens

| Endpoint | Tamanho | Preço estimado | `generations` |
|---|---|---|---|
| `create-character-with-4-directions` | 48×48 | US$ 0,0105 | 1 |
| | 64×64 | US$ 0,0122 | 1 |
| **`create-character-with-8-directions`** | 48×48 | US$ 0,0133 | **1** |
| | **64×64** | **US$ 0,0173** | **1** |
| `create-character-v3` | 64×64 | US$ 0,041 | 2 |
| | 128×128 | US$ 0,042 | 3 |
| | 168×168 | US$ 0,045 | 5 |
| `create-character-pro` | ≤ 85×85 | US$ 0,095 | 20 |
| | ≤ 113×113 | US$ 0,125 | — |
| | ≤ 168×168 | US$ 0,185 | 40 |
| **`create-character-state`** | ≤ 85 / ≤ 113 / ≤ 168 | US$ 0,095 / 0,125 / 0,185 | 20–40 |

#### Divergência encontrada no `create-character-v3`

A descrição do endpoint no spec traz uma **fórmula exata**: `ceil(w*h*8 / 65536)` gerações. Aplicada:

| Tamanho | Pela fórmula do spec | Publicado na página de preço |
|---|---|---|
| 64×64 | **1** | 2 |
| 128×128 | **2** | 3 |
| 168×168 | **4** | 5 |
| 256×256 | **8** | não publicado |

As duas fontes são da própria PixelLab e **não batem**. A fórmula é mais recente e mais específica; a tabela da página de preço pode estar arredondando para cima ou defasada. Para orçar, use o **maior** dos dois — errar para cima só sobra saldo. Não foi possível determinar qual é a autoritativa sem gerar e conferir o `usage` da resposta, o que custa ~US$ 0,05.

`create-character-with-8-directions` em `mode='standard'` é **o melhor custo-benefício da API inteira**: 1 geração, US$ 0,0173, e devolve as 8 direções de uma vez. É a espinha dorsal do nosso pipeline.

### Rotação

| Endpoint | Tamanho | Preço estimado |
|---|---|---|
| `rotate` | até 200×200 | US$ 0,0106–0,0109 |
| `generate-8-rotations-v3` | 32×32 | US$ 0,0293 |
| | 64×64 | US$ 0,0337 |
| | 128×128 | US$ 0,0345 |
| | 256×256 | US$ 0,0377 |
| `generate-8-rotations` **Pro** | 85 / 113 / 168 | US$ 0,095 / 0,125 / 0,185 |

Note que **`generate-8-rotations-v3` a 64×64 custa quase 2× o `create-character-with-8-directions`** e faz menos (só rotaciona, não cria o personagem com esqueleto animável). Só use quando já existe uma arte de referência que precisa ser rodada.

### Animação

| Endpoint / modo | Tamanho | Preço estimado | `generations` |
|---|---|---|---|
| **`animate-character` `mode='template'`** | — | ~US$ 0,0143 (64×64) | **1 por direção** |
| `animate-character` `mode='v3'`, 4 frames | 64×64 | US$ 0,0129 | ~1 por direção até 96px |
| | 128×128 | US$ 0,0145 | ~2 por direção |
| | 160px | — | ~4 por direção |
| | 256px | — | ~8 por direção |
| `animate-character` `mode='pro'` | — | — | **20–40 por direção** |
| `animate-with-skeleton` | 32×32 | US$ 0,0136 | |
| | 64×64 | US$ 0,01433 | |
| | 128×128 | US$ 0,01572 | |
| `estimate-skeleton` | 16–256 | US$ 0,0051 | |
| `animate-with-text-v3` | — | US$ 0,0221–0,0424 | |

**Animação é cobrada por direção animada e em job separado por direção.** Um personagem "usável" (base + 4 animações × 8 direções) custa materialmente mais que a linha de criação: ~US$ 0,017 de base contra ~US$ 0,46 de animação.

### Imagem, edição, terreno, objetos

| Endpoint | Tamanho | Preço estimado |
|---|---|---|
| `create-image-pixflux` | 16–400 | US$ 0,0079–0,0132 |
| `create-image-pixen` | área máx 512×512, múltiplo de 4 | US$ 0,007–0,0169 |
| **`create-image-bitforge`** (estilo por referência) | 16–200 | **US$ 0,0071–0,0112** |
| `image-to-pixelart` | 64 / 128 / 256 | US$ 0,006 / 0,00666 / 0,01164 |
| `inpaint` | 16–200 | ~US$ 0,0072–0,0112 |
| `resize` | 16–200 | US$ 0,0178 |
| `remove-background` | 1–400 | US$ 0,0055–0,0059 |
| **`create-tileset`** | tiles 16×16 | **US$ 0,0079** |
| | tiles 32×32 | **US$ 0,0099** |
| `create-isometric-tile` | 16–64 | US$ 0,0156–0,0166 |
| **`map-objects`** | 32–400 | **US$ 0,0099** |
| `create-8-direction-object` | 85 / 113 / 168 | US$ 0,095 / 0,125 / 0,185 |
| `enhance-*-prompt` | — | US$ 0,002 |

## Limites de tamanho por endpoint

Extraído do spec vendorizado (`openapi/openapi-v2.json`, capturado 2026-07-29). **Esta tabela é autoritativa** — as páginas de marketing e os blogs divergem entre si.

| Endpoint | Limite |
|---|---|
| `create-character-with-4-directions` | 16–128 · **canvas sai ~40% maior** para caber animação |
| `create-character-with-8-directions` | 16–128 · **canvas sai ~40% maior** |
| `create-character-pro` | 32–168 |
| `create-character-v3` | 32–256 (advisório: o modelo escolhe o próprio tamanho no modo referência) |
| `animate-with-skeleton` | 16–256 |
| `animate-with-text` | **exatamente 64×64** |
| `animate-with-text-v2` | 32–256 |
| `animate-with-text-v3` | `width × height × frame_count ≤ 524.288` |
| `generate-8-rotations-v2` | 32–168 |
| `generate-8-rotations-v3` | `first_frame` até 256×256 |
| `create-image-pixflux` | 16–400 |
| `create-image-pixen` | até 768 por eixo, **área máx 512×512, divisível por 4** |
| `create-image-bitforge` | 16–200 |
| `generate-image-v2` | até 792 × 688, dependente do aspecto |
| `generate-with-style-v2` | 16–512 |
| `edit-image` | 16–400 (tier grátis: máx 200×200) |
| `edit-images-v2` | 32–512 |
| `edit-animation-v2` | 16–256 |
| `interpolation-v2` | 16–128 |
| `transfer-outfit-v2` | 32–256 |
| `inpaint` | 16–200 |
| `inpaint-v3` | máscara 32–512 · `context_image` até 1024 |
| `rotate` | 16–200 |
| `resize` | 16–200 |
| `remove-background` | 1–400 |
| `image-to-pixelart` | 16–1280 |
| `create-isometric-tile` | 16–64 · *"acima de 24px costuma dar melhor resultado"* |
| `create-tileset` | `tile_size` ∈ {16, 32}; **64 exige `mode='pro'`** |
| `create-tiles-pro` | `tile_size` 16–128 (32 recomendado) |
| `create-ui-asset` | 192–688 · quadrado máx 512, 16:9 máx 688 |
| `map-objects` | 32–400 · básico: área máx 400×400 (160.000 px) · **com inpainting: máx 192×192 (36.864 px)** |

### O detalhe do canvas 40% maior

`create-character-with-{4,8}-directions` documenta: *"Character size in pixels. Canvas will be ~40% larger to make room for animations."* Pedir 64×64 devolve um frame de ~90×90 com o personagem de 64px dentro. **O recorte do atlas usa o canvas real, não o valor pedido** — errar isso corta a cabeça dos sprites.

## Latência e concorrência

Verificado em `api.pixellab.ai/mcp/docs` (2026-07-29), strings verbatim:

| Operação | Latência típica |
|---|---|
| Maioria das criações | **2 a 5 minutos** |
| Animação (`animate_character`) | ~2 a 4 minutos |
| Objeto de mapa, 1 direção | **15 a 30 segundos** |
| Objeto de 8 direções | ~2 a 4 minutos |

> *"The tools are non-blocking - they return job IDs immediately and process in the background (typically 2-5 minutes)"*

**Não existe endpoint de lote.** "Lote" significa enfileirar em paralelo até o limite de concorrência do plano. O tier de US$ 50/mês declara **até 20 jobs simultâneos**; a concorrência dos tiers menores não está documentada e precisa ser medida.

Estourar a concorrência devolve **429** (`"Too many concurrent jobs"` / `"Concurrency limit reached"`).

E há o **529** (`"Rate limit exceeded"`), um código fora do padrão que praticamente nenhum cliente HTTP trata como reententável. Ele é declarado em **13 endpoints** — essencialmente toda a família síncrona: `create-image-pixflux`, `create-image-pixen`, `create-image-bitforge`, `animate-with-skeleton`, `animate-with-text`, `estimate-skeleton`, `rotate`, `inpaint`, `tilesets`, `create-tileset`, `tilesets-sidescroller`, `create-tileset-sidescroller`, `create-isometric-tile`. Se o seu cliente só trata 429, ele vai falhar sem retry justo nos endpoints que você mais chama.

Confira você mesmo:

```bash
node scripts/inspect-spec.mjs openapi/openapi-v2.json --list
```

## Planos

| Plano | Preço | Teto de tamanho | Observação |
|---|---|---|---|
| Free trial | US$ 0 | 200×200 | 40 gerações rápidas; o FAQ cita 20 créditos grátis no cadastro |
| Tier 1 — Pixel Apprentice | ~US$ 12/mês | 320×320 | inclui animação, rotação, mapas |
| Tier 2 | ~US$ 24–28/mês | 400×400 | fila prioritária, modelos experimentais |
| Tier 3 — Pixel Architect | ~US$ 50/mês | — | **até 20 jobs simultâneos**, recursos de equipe |

Há desconto por fidelidade que reduz Tier 1 para ~US$ 9 e Tier 2 para ~US$ 22 ao longo de meses consecutivos. **Uso comercial está incluído em todos os planos pagos** — e a licença aparece até na linha do Free trial. Ver [`licenca-e-termos.md`](licenca-e-termos.md).

Quantas `generations` cada tier concede por mês **não foi verificado**. Antes de dimensionar a produção por assinatura, meça.

## Orçamento de Ferro e Cinzas

Alvo: 60 criaturas com 8 direções e 4 animações, 400 itens, ~60 variantes de armadura vestida, 30 tilesets, 200 props de mapa, 40 elementos de UI.

| Bloco | Endpoint / modo | Chamadas | Jobs | Cálculo | USD |
|---|---|---|---|---|---|
| 60 criaturas, base 8 direções | `create-character-with-8-directions` `standard` 64px | 60 | 60 | 60 × 0,0173 | **1,04** |
| 4 animações × 8 direções × 60 | `animate-character` `template` | 240 | **1.920** | 1.920 × 0,01433 | **27,51** |
| 400 ícones de item | `create-image-bitforge` 32px | 400 | 400 | 400 × 0,0071 | **2,84** |
| 60 variantes vestidas | `create-character-state` ≤85px | 60 | 60 | 60 × 0,095 | **5,70** |
| 30 tilesets Wang | `create-tileset` tiles 32px | 30 | 30 | 30 × 0,0099 | **0,30** |
| 200 props | `map-objects` | 200 | 200 | 200 × 0,0099 | **1,98** |
| 40 elementos de UI | `create-ui-asset` / `generate-ui-v2` | 40 | 40 | 40 × ~0,02 | **0,80** |
| **Primeira passada** | | **1.030** | **2.710** | | **~US$ 40** |
| Com 3× de re-roll nos blocos caros | | | ~8.000 | | **~US$ 120** |

**Tempo de parede** — 2.710 jobs a ~3,5 min de média:

| Concorrência | Tempo |
|---|---|
| 20 simultâneos (Tier 3) | **~8 horas** |
| 8 simultâneos | ~20 horas |
| 4 simultâneos | **~40 horas** |

É uma corrida de uma noite no melhor caso e de dois dias no pior. **É por isso que o catálogo idempotente e retomável não é enfeite** — perder o progresso no meio significa pagar tudo de novo.

Uma nota de honestidade: o dinheiro não é o problema deste projeto. US$ 40 gera 2.710 imagens. Fazer 2.710 imagens parecerem do **mesmo jogo** é o trabalho difícil, e nenhum orçamento resolve isso. Ver [`consistencia-estilo.md`](consistencia-estilo.md).

## Referências

- `ferramentas/pixellab-pipeline/openapi/openapi-v2.json` — spec vendorizado, capturado 2026-07-29, sha256 em `PROVENIENCIA.txt` (**fonte autoritativa dos limites de tamanho**)
- [`https://www.pixellab.ai/pixellab-api`](https://www.pixellab.ai/pixellab-api) — tabela de preço estimado; conferida em 2026-07-29 no HTML e no bundle JS
- [`https://api.pixellab.ai/mcp/docs`](https://api.pixellab.ai/mcp/docs) — latências e bandas de `generations`, verificado 2026-07-29
- [`https://www.pixellab.ai/docs/tools/create-8-rotations-pro`](https://www.pixellab.ai/docs/tools/create-8-rotations-pro) — corrobora a banda Pro (20 gen até 85px, 40 até 168px)
- [`https://www.pixellab.ai/docs/faq`](https://www.pixellab.ai/docs/faq) — créditos grátis no cadastro

**Não verificado:** quantas `generations` cada tier concede por mês; a concorrência máxima dos tiers 1 e 2; se os preços estimados variam por região.

**Última atualização:** 2026-07-29
