# ADR 0022 — Blocos do mundo vêm do `/create-isometric-tile`, e o default é uma geração por bloco

> **Quick Start (TL;DR)**
>
> As peças de terreno do editor são geradas pelo endpoint `/create-isometric-tile`, com `isometric_tile_shape: 'block'`. Ele **não tem parâmetro de orientação**: as quatro vistas saem de uma geração reusada (modo uniforme, o default) ou de quatro gerações guiadas por texto com paleta travada (modo orientado). O endpoint devolve **pixels RGBA crus**, não um arquivo PNG — a codificação é nossa.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && npm test
> ```

**Status:** aceita · **Data:** 2026-08-01

## Contexto

O editor de mapa precisava de peças. Até aqui ele desenhava retângulos coloridos, e a única arte que o
repositório sabia gerar era personagem. Um bloco de terreno isométrico é outro problema: ele tem que
costurar no grid, mostrar as três faces do gênero (topo, esquerda, direita) e existir nas quatro
vistas da câmera ([ADR 0021](0021-rotacao-de-camera-em-quatro-vistas.md)).

## Decisão

**Usar `/create-isometric-tile`, com `isometric_tile_shape: 'block'` como default.**

O spec vendorizado descreve a altura ocupada por forma: `thin tile` ~15% do canvas, `thick tile` ~25%,
`block` ~50%. `block` é o cubo. As três formas ficam expostas na bancada porque peça mais fina permite
mais variação de altura no mapa pelo mesmo custo.

**As quatro vistas têm dois modos, e o barato é o default.**

O endpoint **não tem** `facing`, `direction` nem `rotation` no schema — verificado no spec
vendorizado. Portanto:

- **uniforme** (default): UMA geração, e a mesma arte serve as quatro vistas. É o certo para grama,
  pedra, terra e areia, onde as quatro vistas são visualmente a mesma peça.
- **orientado**: uma geração POR vista, com sufixo de texto descrevendo qual lado encara a câmera, e
  `color_image` travando a paleta na primeira face. Só vale quando o bloco TEM um lado distinto — uma
  porta, uma quina de muralha, um brasão.

Que orientação por texto funcione é **convenção deste repositório, não capacidade verificada do
endpoint**. O que é verificado é o custo: 1 geração contra 4.

**Sem paleta travada, as quatro vistas param de parecer o mesmo bloco.** `color_image` existe no
schema justamente para isso, e o modo orientado o usa por default.

## A armadilha que custou uma geração

**`/create-isometric-tile` devolve pixels RGBA crus em base64, não um arquivo PNG.** Verificado contra
a API em 2026-08-01: um tile 48×48 chega com exatamente 9216 bytes — que é 48 × 48 × 4 — e os bytes
começam em `00 00 00 00` em vez da assinatura `89 50 4E 47`.

Gravar isso num arquivo `.png` produz um arquivo que navegador nenhum abre, e o erro só aparece na
hora de desenhar — depois de a geração ter sido paga. `server/png.ts` codifica RGBA em PNG (8 bits,
RGBA, filtro 0), e `toPngBytes` deixa passar o que já é PNG.

**A diferença é por endpoint, não por API.** Os endpoints de personagem entregam URLs de PNGs de
verdade; este entrega pixels. Não há como saber qual é qual sem olhar os bytes.

## Consequências

**A rotação de câmera não multiplica o orçamento de arte.** Quatro faces por bloco, escolhidas com
`(facing + rotation) mod 4`, cobrem as quatro vistas — e em modo uniforme as quatro faces são o mesmo
arquivo. A skill de rotação avisava que o orçamento de arte era o custo real e não estava medido;
agora está, e para terreno ele é 1×.

**O editor funciona antes de qualquer geração.** Peças sem arte caem num cubo isométrico desenhado por
código (`tools/map-builder/src/cube.ts`), construído da mesma projeção do grid. Sem isso, o editor só
seria testável depois de gastar dinheiro na API — o que contraria a regra de custo deste repositório.

**`facingMode` entra no hash.** Uniforme e orientado não compartilham cache: reusar arte uniforme como
se fosse orientada seria mentir sobre o que está em disco.

**O `tile_id` vai ao ledger e ao manifesto.** É o caminho de volta ao artefato pago quando o download
falha. A ausência desse campo é o que tornou irrecuperáveis, a partir do histórico, as 14 submissões
de `create-character-v3` de 2026-08-01.

**Asset gerado não pode depender do `publicDir` do Vite.** O `publicDir` monta a listagem no boot, e
todo arquivo criado depois cai no fallback do `index.html` — o navegador recebe HTML com status 200 no
lugar do PNG. Os assets gerados são servidos pela própria API, lendo do disco a cada requisição.

## Alternativas descartadas

**`create-8-direction-object` / `map-objects`.** São para props, não terreno: não costuram no grid e
custam mais. `map-objects` ainda se apaga sozinho 8 h depois de criado.

**`create-tileset` (Wang).** Resolve transição entre terrenos vizinhos, que é outro problema —
autotiling, não peça. Continua sendo o endpoint certo quando o autotile do editor for ligado.

**Gerar as quatro vistas sempre.** Quadruplica o custo de todo bloco para benefício zero em material
uniforme, que é a esmagadora maioria do terreno.

## Referências

- [`tools/character-builder/server/world-block.ts`](../../tools/character-builder/server/world-block.ts) — a bancada, os dois modos e a idempotência por face
- [`tools/character-builder/server/png.ts`](../../tools/character-builder/server/png.ts) — o codificador que o formato da resposta obriga
- [`tools/pixellab-pipeline/openapi/openapi-v2.json`](../../tools/pixellab-pipeline/openapi/openapi-v2.json) — o spec vendorizado, única fonte sobre o endpoint
- [ADR 0012](0012-guard-de-orcamento-informativo.md) — o guard que informa e nunca recusa
- [ADR 0021](0021-rotacao-de-camera-em-quatro-vistas.md) — as quatro vistas que estas faces alimentam

**Última atualização:** 2026-08-01
