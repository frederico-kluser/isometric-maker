# ADR 0031 — O canvas da API é múltiplo de 4, e o init_image do tile está quebrado no fornecedor

> **Quick Start (TL;DR)**
>
> Duas restrições do `/create-isometric-tile` que **não estão no spec**, descobertas pagando
> $0 (jobs falhos não cobram): o canvas precisa de lados **múltiplos de 4** (48×53 morre com
> `code 3006`), e o `init_image`/`color_image` está **inutilizável hoje** — a validação exige
> um arquivo que o Pillow abra, o worker exige RGBA cru; nenhum payload satisfaz os dois.
> Resposta: gerar em 48×56 com recorte de volta ao quadro canônico 48×53, e um fallback que
> resubmete **sem** referência de imagem quando o 422 síncrono apontar os campos de imagem.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && node --test server/world-block.test.ts
> ```

**Status:** aceita · **Data:** 2026-08-01
**Corrige:** ADR 0029

## Contexto

A [ADR 0029](0029-quatro-vistas-molde-encadeado-e-rotate.md) definiu o canvas do bloco como o
bounding box exato do molde (48×53) e o molde encadeado como `init_image` de toda geração,
anotando honestamente: *"Não verificado que a PixelLab respeite a proporção do init_image"*.
A primeira tentativa real de gerar sob essas decisões (2026-08-01) falhou **sete submissões
seguidas em duas sessões**, todas com `usd: 0`, e o diagnóstico só apareceu lendo
`GET /background-jobs/{job_id}` dos jobs falhos:

1. **`code 3006 — "Canvas width and height must be divisible by 4 (got 48x53)"`.** O schema
   vendorizado diz apenas `16–64` por lado, sem `multipleOf`. Os cinco blocos uniformes pagos
   eram 48×48 — múltiplo de 4 por acidente — e por isso a restrição nunca tinha aparecido.
2. **Com o canvas corrigido para 48×56, o `init_image` revelou uma incompatibilidade
   interna do fornecedor.** Mandando PNG, a submissão passa e o *worker* morre:
   `get_image_from_byte` faz `Image.frombytes(mode="RGBA", size=image_size)` sobre os bytes —
   só aceita RGBA cru (traceback completo capturado, `generate_pixelart_flux.py:411`).
   Mandando RGBA cru, a **validação** recusa com 422 síncrono: *"decodes but is not a readable
   image. Send PNG (or another format Pillow can open)"*. Validação e worker exigem formatos
   mutuamente exclusivos para o mesmo campo.

Nenhuma geração bem-sucedida deste repositório jamais tinha enviado `init_image` ao endpoint
de tile — os cinco uniformes foram gerados **sem** molde (é a medição de aresta 20–22 px da
ADR 0025 que o comprova). O canal do molde nunca tinha sido exercitado; quando foi, não
existia. `info.version: "dev"` — o aviso do `AGENTS.md` sobre nunca escrever sobre esta API de
memória é exatamente sobre isso.

## Decisão

**1. Dois canvas, com contrato explícito** (`cube-mould.ts`): o **quadro canônico** (48×53,
bounding box do cubo) continua sendo o contrato do disco, do manifesto e do map-builder; o
**canvas da API** (`apiImageSize()`) é o canônico arredondado para cima a múltiplos de 4
(48×56). Toda submissão acolchoa o topo na ida (conteúdo assentado na base, céu transparente)
e recorta na volta, com ida-e-volta coberta por teste byte a byte.

**2. Referências de imagem viram tentativa-com-fallback** (`world-block.ts`, `generateTile`):
a submissão sai com `init_image`/`color_image` (RGBA cru acolchoado — o formato que o worker
consome); se o 422 síncrono apontar esses campos, resubmete **sem** referência de imagem, com
aviso gritante no log. O 422 não cria job, não cobra e não entra no ledger — a tentativa é
gratuita. Quando o fornecedor consertar o campo, a primeira tentativa volta a valer e o
fallback simplesmente deixa de disparar.

**3. A sondagem de tile pendente consulta o job.** `fetchTilePngById` recebia só o `tile_id` e
sondava 423 às cegas — um tile cujo job falhou responde 423/410 para sempre, e a cegueira
custou 2 minutos de espera e uma resubmissão por ciclo antes do diagnóstico. Agora cada 423 é
acompanhado de um `GET /background-jobs/{job_id}` (grátis), e job `failed` derruba a sondagem
na hora, com o `detail` do fornecedor na mensagem.

## Alternativas descartadas

**Mudar a geometria canônica para um bounding box múltiplo de 4.** Mexeria no cubo da
[ADR 0024](0024-cubo-isometrico-canonico.md) — aresta, zStep, física, molde — para acomodar
uma restrição de GPU alheia. O acolchoamento resolve no transporte e não toca o mundo.

**Desistir do molde e remover o canal de init_image do código.** O molde é decisão mantida
nominalmente pelo usuário (*"não vamos jogar nosso molde fora"*, ADR 0029). O canal fica no
código, testado, esperando o fornecedor — o fallback é a diferença entre "quebrado hoje" e
"removido para sempre".

**Formatos exóticos que passem nos dois estágios** (BMP, TGA, PPM…). Qualquer contêiner tem
cabeçalho, e `Image.frombytes` consome o buffer inteiro como pixels — não existe arquivo que o
Pillow abra E cujos bytes sejam exatamente `width×height×4`.

## Consequências

- **A técnica `chained` degrada para encadeamento por prompt enquanto o fornecedor não
  conserta**: sem `init_image`, a forma fica por conta do texto e da sorte — a variância de
  aresta de 20–22 px medida na ADR 0025 volta a valer. O nome da técnica e o hash não mudam:
  o artefato registra o que foi possível comprar no dia.
- **Blocos gerados hoje não empilham com fidelidade garantida.** Já era consequência declarada
  da ADR 0029 (sem canonização, o encaixe depende do modelo); sem molde, mais ainda. A
  resposta continua sendo regenerar quando o canal voltar — retomada nunca repaga o que tem
  `tile_id`.
- **`padPngToApiCanvas` emite RGBA cru** — o nome diz "canvas", o formato é o do worker. Se o
  fornecedor passar a aceitar PNG, é uma linha para reencodar.
- **Não verificado:** se a regra do múltiplo de 4 vale para outros endpoints (o
  `create-character-v3` recebe o mesmo 48×56 por precaução); se o fallback sem `color_image`
  prejudica a coerência de paleta entre faces mais do que o prompt sozinho já prejudica.

## Referências

- [`ADR 0029`](0029-quatro-vistas-molde-encadeado-e-rotate.md) — corrigida: as duas técnicas e o hash ficam; o canvas e o canal do molde ganham a realidade acima
- [`ADR 0024`](0024-cubo-isometrico-canonico.md) — a geometria canônica que o acolchoamento preserva
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/cube-mould.ts` — `blockImageSize()` × `apiImageSize()`
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/world-block.ts` — acolchoar/recortar, fallback de 422, sondagem com job
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/world-block.test.ts` — ida-e-volta byte a byte e o fallback simulado
- `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/openapi/openapi-v2.json` — o spec que NÃO documenta nenhuma das duas restrições

**Última atualização:** 2026-08-01
