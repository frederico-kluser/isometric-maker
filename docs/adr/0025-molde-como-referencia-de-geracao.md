# ADR 0025 — O molde do cubo acompanha toda geração de bloco

> **Quick Start (TL;DR)**
>
> Um cubo desenhado por código, na geometria da [ADR 0024](0024-cubo-isometrico-canonico.md), vai como `init_image` em **toda** geração de bloco. Referência do usuário só substitui o molde se tiver a mesma proporção. O que volta é alinhado à âncora canônica antes de virar textura, e alinhar arte já paga não custa nada.
>
> ```bash
> curl -s http://localhost:5174/api/block-geometry
> curl -sO http://localhost:5174/api/block-mould.png
> ```

**Status:** aceita · **Data:** 2026-08-01

## Contexto

O `/create-isometric-tile` não tem parâmetro de proporção. Tem `isometric_tile_shape`, com três degraus que o spec descreve como "~15 %, ~25 %, ~50 % da altura do canvas" — uma indicação grosseira, não uma geometria.

Medido nos cinco blocos pagos deste projeto, todos com `isometric_tile_shape='block'` e canvas 48×48: o losango do topo saiu 2:1 nos cinco, e a aresta vertical veio **entre 20 e 22 px** conforme o bloco. O vértice superior variou entre a linha 2 e a linha 4, dependendo de o bloco ter ou não tufos de grama estourando para cima.

Blocos que não compartilham altura não empilham. Blocos cujo vértice está em linhas diferentes não costuram. E nada no endpoint permite pedir uma altura.

O que o endpoint **tem** é `init_image` mais `init_image_strength` (inteiro 1–999, default 300). O schema declara `additionalProperties: false` e **não** tem `style_image` nem `style_strength` — mandá-los seria rejeitado, não ignorado. Esses campos existem em outros endpoints da mesma API (`create-image-bitforge`, `generate-image-v2`, `create-tiles-pro`, entre outros), o que torna fácil supor que existam aqui.

Uma armadilha de polaridade acompanha o parâmetro: `init_image_strength` **não** é o `denoising_strength` do Stable Diffusion invertido. Valor **maior** significa **menos** ruído adicionado, logo saída **mais próxima** da referência. Quem aplicar a intuição do SD ajusta para o lado errado.

## Decisão

**Um molde de cubo desenhado por código acompanha toda geração de bloco como `init_image`, com `init_image_strength = 480`.**

O molde sai do mesmo rasterizador que desenha a arte de reserva e o cubo de preview do editor — `packages/iso-core/src/cube-raster.ts`. Uma forma, três consumidores.

**Por que o molde é acromático.** `init_image` carrega forma **e** cor. Um molde colorido puxaria a paleta de toda geração para a cor dele, e todo bloco nasceria cinza-esverdeado independentemente do prompt. Acromático é a única escolha que transporta geometria sem contrabandear paleta.

**Por que 480 e não o default 300.** O molde precisa mandar na forma, e o prompt no material. Com 300 o modelo trata a referência como sugestão e a aresta vertical volta a variar. **Não verificado:** qual valor a PixelLab considera "forte" — 480 é escolha deste projeto, ajustável por configuração, não número lido de documentação.

**A referência do usuário substitui o molde só se tiver a mesma proporção.** A checagem é sobre a razão `altura/largura`, com 2 % de tolerância, não sobre o tamanho absoluto: uma referência de 96×106 é o mesmo molde em dobro e passa. Uma quadrada de 48×48 não passa — não é outro estilo, é outra projeção, e outra projeção não encaixa no mesmo grid. A mesma função valida no navegador e no servidor.

**O que volta é alinhado antes de virar textura.** `normalizeCubeSprite` acha a **cintura** do losango — a primeira linha em que a arte atinge sua largura máxima —, translada para a âncora canônica, recorta o que cai fora da silhueta e completa a base das faces laterais quando a arte veio mais baixa que o molde. O marco é a cintura e não o bounding box porque o bounding box inclui o enfeite; alinhar por ele é alinhar pela grama.

**Alinhar arte já paga é um passo separado e gratuito.** `POST /api/world-block/{hash}/canon` grava em `<hash>/canon/<face>.png` e **nunca toca no PNG original**. O catálogo prefere a versão alinhada quando as quatro faces existem.

**A geometria antiga continua acessível por `geometry: 'legado'`.** Ela reproduz byte a byte a string hasheada anterior, e é isso que faz os cinco blocos já pagos continuarem batendo com o cache. Mudar o hash de um asset pago não é refatoração: é gerá-lo de novo, e gerar de novo custa dinheiro.

## Consequências

- **Geração canônica e geração legada têm caches separados.** É correto: são artefatos diferentes. O custo é que o primeiro bloco canônico de cada descrição é uma geração nova.
- **O alinhamento nunca derruba uma geração.** Ele roda depois de o PNG pago estar em disco, dentro de `try`. Perder a execução inteira por um pós-processamento seria jogar dinheiro fora por um problema que dá para refazer de graça.
- **A cobertura vira número, não impressão.** O relatório traz deslocamento, cobertura da silhueta, pixels recortados e linhas completadas. Nos cinco blocos pagos: cobertura de 98,1 % a 99,9 %, deslocamentos de 0 a 4 px, e 270 a 410 pixels de base completada.
- **Não foi verificado que a PixelLab respeite a proporção do `init_image` com fidelidade de pixel.** O spec não promete isso e não há como saber sem gastar. É justamente por isso que a normalização existe: ela conserta o que a referência apenas sugeriu.
- **O modo `uniform` continua reusando uma arte nas quatro vistas.** É o que significa uniforme e é o que faz um bloco custar uma geração em vez de quatro. Quatro vistas realmente distintas de arte gerada exigem `oriented`. Os cubos procedurais, esses, variam por vista de graça.
- **O decodificador de PNG do projeto cresceu.** Alinhar arte em disco exige lê-la; o decodificador cobre 8 bits, sem entrelaçamento, nos tipos de cor 0, 2, 4 e 6. Paleta (tipo 3) fica de fora.

## Referências

- [`ADR 0024`](0024-cubo-isometrico-canonico.md) — a geometria de que o molde é desenhado
- [`ADR 0022`](0022-blocos-do-mundo-isometricos.md) — a decisão de gerar blocos pelo `/create-isometric-tile`
- [`ADR 0023`](0023-caminho-de-volta-ao-artefato-pago.md) — por que o artefato pago nunca é sobrescrito
- `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/openapi/openapi-v2.json` — `CreateIsometricTileRequest`, com `init_image`, `init_image_strength` e `additionalProperties: false`
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/cube-mould.ts` — o molde, a referência e a normalização
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/cube-normalize.ts` — o alinhamento, com a cintura como marco

**Última atualização:** 2026-08-01
