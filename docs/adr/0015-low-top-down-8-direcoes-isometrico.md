# ADR 0015 — `low top-down`, 8 direções, e o endpoint que o isométrico obriga

> **Quick Start (TL;DR)**
>
> `view: "low top-down"` e 8 direções na ordem canônica `S, SW, W, NW, N, NE, E, SE` continuam — justificadas agora por navegação nos eixos isométricos, não por leitura de equipamento em PvP. E uma consequência nova e forçada: o construtor usa `/create-character-with-8-directions`, porque é o **único** endpoint de personagem que tem o campo `isometric` **e** o mapa `directions`.
>
> ```bash
> node /home/ondokai/Projects/isometric-maker/.agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs \
>   /home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/openapi/openapi-v2.json --list
> ```

**Status:** aceita · **Data:** 2026-07-30
**Substitui:** ADR 0005

## Contexto

A [ADR 0005](0005-low-top-down-8-direcoes.md) fixou `low top-down` e 8 direções por um motivo de gameplay: *"o equipamento define a classe — então o outro jogador precisa conseguir ler visualmente o que você está vestindo"*. A [ADR 0010](0010-pivo-para-editor-isometrico.md) apagou os outros jogadores. A conclusão continua certa; o argumento não existe mais.

E a mudança para isométrico levanta uma pergunta que a 0005 não precisava responder: **a PixelLab gera personagem isométrico, ou só terreno isométrico?**

A resposta veio do spec vendorizado, e ela força uma decisão de endpoint que a 0005 deixava livre.

## Decisão

### A perspectiva

`view: "low top-down"` em personagens e em tilesets. As 8 direções, na ordem canônica `S, SW, W, NW, N, NE, E, SE`.

**A justificativa nova:** num mundo isométrico com Z discreto, o jogador navega em quatro diagonais de tela que são os quatro eixos do grid, mais as quatro ortogonais. Oito direções não é escolha estética — é a cardinalidade do próprio espaço de movimento. E `low top-down` (3/4, cerca de 20° acima da horizontal, segundo a descrição do próprio spec) é a perspectiva que casa com a dimétrica 2:1 da [ADR 0013](0013-geometria-isometrica-64x32-z16.md): alta o suficiente para o chão ter profundidade, baixa o suficiente para a parede ter face.

### O endpoint, que agora é obrigatório e não opcional

O campo `isometric` (booleano, default `false`, descrito como *"Generate in isometric view"*) existe em `CreateCharacterWith8DirectionsRequest`, `CreateCharacterWith4DirectionsRequest`, `CreateCharacterAnimationRequest`, `AnimateWithSkeletonRequest`, `RotateRequest`, `InpaintRequest` e `ResizeRequest`.

**Ele não existe em `CreateCharacterV3Request` nem em `CreateCharacterProRequest`.**

O mapa `directions` — que entrega uma imagem de referência por direção, congela as fornecidas e gera as ausentes — existe **somente** em `/create-character-with-8-directions`. O `create-character-v3` tem um `reference_image` único e nada mais.

Isso decide a arquitetura do construtor de personagem:

- **`/create-character-with-8-directions`, `mode: "standard"`, `isometric: true`.** É o único caminho que aceita as quatro artes cardeais como referência congelada e ainda pede isométrico. Custa 1 geração.
- `/create-character-v3` está **fora**, apesar de ser o que o estúdio usa hoje: sem `isometric` e sem `directions`.
- `/create-character-pro` está fora por preço: 20 a 40 gerações.
- `/generate-8-rotations-v3` está fora porque não cria `character_id`, e sem ele não há como chamar `/animate-character` depois.

### A ordem das direções: ler por nome, nunca por índice

Três ordenações convivem no mesmo spec. O schema compartilhado `Direction` começa no norte. O mapa `directions` do endpoint de 8 direções enumera a partir do sul em sentido horário. O endpoint de animação de objeto enumera a partir do sul em sentido anti-horário. E a descrição de `/create-character-with-8-directions` diz *"Fixed 8-rotation layout in clockwise order starting from south"* — que é o **espelho** da ordem canônica deste repositório.

`GET /characters/{character_id}` devolve `rotation_urls` **chaveado por nome de direção**. É essa a forma de ler.

**Ler frame por índice é bug silencioso.** Se o payload vier na ordem horária documentada e o código fatiar assumindo a anti-horária, leste e oeste trocam: nada estoura, nenhum teste falha, e o sintoma aparece meses depois como "o personagem anda de lado".

## Consequências

- **O estúdio muda de endpoint.** `tools/sprite-studio/server/api.ts` chama `create-character-v3` hoje. Trocar é trabalho da primeira onda, e descobrir isso no meio dela significaria jogar fora tudo que já tivesse sido gerado.
- **`isometric` entra em `params`, logo entra no `specHash`.** Virar esse booleano depois de gerar invalida cada personagem do catálogo e cobra tudo de novo. Por isso a comparação com e sem isométrico tem que ser a **primeira despesa do projeto**, antes de qualquer produção.
- **Os tamanhos apertam.** `/create-character-with-8-directions` limita `image_size` a 16–128 por lado — contra 32–256 do v3 — e avisa que *"canvas will be ~40% larger to make room for animations"*. Pedir 64 devolve cerca de 90 px, que **não é nenhum** dos tamanhos aceitos pelos endpoints de esqueleto (16, 32, 64, 128, 256). Entre uma etapa e outra é preciso **preencher com borda até 128×128, nunca reamostrar**, e recortar de volta depois. Reamostrar destrói pixel art; `/resize` custaria dinheiro para fazer a coisa errada.
- **A armadilha de default da ADR 0005 sobrevive, e ganhou uma irmã.** `TilesetCameraView` aceita `low top-down` mas o endpoint de tileset usa `high top-down` por default. Já `/create-tiles-pro` tem default `low top-down` no `tile_view`. **Defaults diferentes na mesma família** — passar explicitamente em ambos é obrigatório.
- **Referência tem que olhar para o sul.** Onde há imagem de referência, o sul é obrigatório e as dimensões precisam bater exatamente com `image_size`, sob pena de 422. A validação disso é local e grátis, e tem que acontecer antes da chamada.
- Continua valendo o truque da 0005: em personagem simétrico, espelhar uma diagonal ruim pela oposta economiza uma geração.

## Referências

- `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/openapi/openapi-v2.json` — `CreateCharacterWith8DirectionsRequest`, `CreateCharacterV3Request`, `CreateCharacterProRequest`, `CameraView`, `TilesetCameraView`, `Direction`
- `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/src/endpoints.ts` — `DIRECTIONS_8`, a ordem canônica deste repositório
- [`ADR 0005`](0005-low-top-down-8-direcoes.md) — a decisão que esta substitui
- [`ADR 0013`](0013-geometria-isometrica-64x32-z16.md) — a geometria em que estes personagens se assentam

**Não verificado, e é a incógnita de maior aposta do pivô:** o que `isometric: true` faz de fato. O spec o descreve em cinco palavras. Não se sabe se ele muda a projeção para dimétrica de verdade ou apenas enviesa o prompt; se compõe com `view` ou o sobrescreve; nem se as 8 direções continuam sendo as mesmas 8 direções de bússola sob esse modo. Duas gerações de 64×64, uma com e uma sem, respondem — e devem ser a primeira coisa paga.

**Última atualização:** 2026-07-30
