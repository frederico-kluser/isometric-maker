# ADR 0029 — Todo bloco tem quatro vistas: molde encadeado, e rotate via v3 para comparar

> **Quick Start (TL;DR)**
>
> Toda geração de bloco produz **as quatro vistas da câmera, cada uma com arte própria** — o modo uniforme foi removido. Duas técnicas, comparáveis lado a lado no catálogo: **`chained`** (a norte nasce do molde do cubo como `init_image`, e o resultado dela vira o molde das outras três — 4 gerações de tile) e **`rotated`** (a mesma norte vai como `reference_image` do `/create-character-v3`, que rotaciona para 8 direções — 1 tile + 1 v3). O "ajuste ao molde" (canonização) foi removido por decisão do usuário; o molde ficou.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && node --test server/world-block.test.ts
> curl -sO http://localhost:5174/api/block-mould.png
> ```

**Status:** aceita · **Data:** 2026-08-01
**Substitui:** ADR 0022, ADR 0025 · **Corrige:** ADR 0021

## Contexto

A [ADR 0022](0022-blocos-do-mundo-isometricos.md) fixou o modo uniforme como default — uma geração, a mesma arte nas quatro vistas — e descartou "gerar as quatro vistas sempre" por custo. A [ADR 0025](0025-molde-como-referencia-de-geracao.md) somou o molde como `init_image` de toda geração, com normalização e canonização da arte que voltava.

Os cinco blocos pagos sob essas decisões não serviram. Todos uniformes, a rotação da câmera mostrava sempre a mesma perspectiva — a cena já trocava a face por rotação (`(facing + rotation) mod 4`, `tools/map-builder/src/scene.ts`), mas as quatro faces eram o mesmo arquivo, e o giro lia como a mesma figura deslizando. O usuário rejeitou o resultado e rejeitou nominalmente a feature de "ajuste ao molde" (o alinhamento pós-geração), mantendo o molde: *"não vamos jogar nosso molde fora"*.

O pedido que esta ADR registra: tudo que for gerado existe **para os 4 lados**; o molde é **encadeado** (o resultado da primeira face vira o molde das seguintes); e há um **segundo caminho via rotação do v3**, para comprar os mesmos blocos nas duas técnicas e comparar.

## Decisão

**1. Toda geração de bloco produz quatro vistas distintas.** `facingMode` deixou de existir; não há mais modo de uma geração. O contrato do catálogo é `block.json` versão 2, e manifesto de versão anterior não é lido.

**2. Técnica `chained` — o molde encadeado.** A face norte nasce do molde do cubo ([ADR 0024](0024-cubo-isometrico-canonico.md)) como `init_image` do `/create-isometric-tile`, força 480. O **resultado da norte** vira `init_image` **e** `color_image` das faces leste, sul e oeste, geradas com sufixo de face no prompt. O canvas é o bounding box do molde (48×53) — o seletor de tamanho saiu, porque o molde já decide o canvas.

**3. Técnica `rotated` — rotate via v3.** A mesma norte de tile é gravada como `source.png` e vai como `reference_image` do `/create-character-v3` (`view: 'low top-down'`, `no_background`, ADR 0015). O job devolve só metadado; os pixels vêm de `GET /characters/{character_id}`, campo `rotation_urls` — **8 PNGs separados, lidos por chave**, nunca por índice ([ADR 0023](0023-caminho-de-volta-ao-artefato-pago.md), `server/frames.ts`). Não há extração de GIF porque não é preciso: as imagens já vêm separadas. As 8 ficam em `v3/`; as 4 vistas saem do mapeamento `FACING_TO_V3_DIRECTION` e são desestufadas **juntas** com `fitFrames` (o v3 infla o canvas ~2×, [ADR 0028](0028-modo-manequim-e-preenchimento-do-quadro.md)) — recorte comum é o que mantém a escala igual entre vistas. Rederivar as faces de `v3/` não custa nada.

**4. O "ajuste ao molde" foi removido.** `cube-normalize.ts`, a rota de canonização, as pastas `canon/`, o botão "Alinhar ao molde", o modo `legado` e o upload de referência própria saíram. A força alta do `init_image` é a única alavanca de forma que restou.

**5. A técnica entra no hash.** O mesmo prompt nas duas técnicas são dois artefatos com caches separados — é o que permite comprar os dois e comparar. Os cinco blocos uniformes pagos foram **arquivados** em `/home/ondokai/Projects/isometric-maker/tools/character-builder/assets/arquivado-blocos-uniformes-2026-08-01/`, nunca destruídos (ADR 0023); os `tile_id` continuam nos manifestos e no ledger.

## Alternativas descartadas

**Manter o modo uniforme como opção barata.** Era o default da ADR 0022 e é o que produziu o problema: quatro vistas iguais anulam o efeito de volume da rotação. O usuário decidiu pagar as quatro.

**Extrair as vistas de um GIF.** Desnecessário: `rotation_urls` entrega as 8 direções como imagens separadas. A regra combinada foi "só extrair de GIF se não houver imagens separadas" — há.

**`/rotate` por vista (3 chamadas).** O `/rotate` é uma imagem por chamada; o v3 faz as 8 numa submissão. Preço estimado favorece o v3 para este tamanho de sprite, mas é estimativa — a coluna de preço da própria PixelLab avisa que varia com o tempo de GPU.

**Normalizar/alinhar a arte que volta.** Existia (ADR 0025) e foi removida por decisão explícita do usuário. O custo dessa remoção está declarado abaixo.

## Consequências

- **Custo por bloco subiu de propósito.** `chained`: 4 gerações de tile. `rotated`: 1 tile + 1 v3 (preço estimado). O guard continua informando antes de cada execução e nunca recusa (ADR 0012). Isso **corrige a consequência da [ADR 0021](0021-rotacao-de-camera-em-quatro-vistas.md)** que dizia "a arte não fica quatro vezes mais cara" apoiada no modo uniforme — a decisão de rotação segue vigente; o que mudou foi o custo de arte por bloco.
- **Sem alinhamento, o encaixe depende do modelo honrar o molde.** **Não verificado** que a PixelLab respeite a proporção do `init_image` com fidelidade de pixel — a ADR 0025 media aresta de 20 a 22 px sem molde. Se blocos voltarem a não empilhar, a resposta agora é regenerar ou reintroduzir alinhamento por ADR nova, não silenciosamente.
- **O sentido leste/oeste do mapeamento facing→direção é convenção não verificada.** `north → south` é fixo (o `reference_image` do v3 é lido como a vista sul); o resto segue a regra das skills de rotação: o sinal só se confirma olhando o resultado. Trocar a constante e rederivar de `v3/` é grátis.
- **Não foi verificado que o v3 rotacione bem um cubo** — o endpoint é de personagem. É exatamente o experimento que a técnica `rotated` existe para responder, pagando uma vez.
- **`init_image` + `color_image` juntos na `chained` são redundância proposital.** O `init_image` da norte já carrega forma e cor; o `color_image` reforça a paleta. **Não verificado** qual dos dois domina — mandar os dois é o caminho conservador.
- **Que orientação por texto funcione continua sendo convenção**, herdada da ADR 0022 e agora reforçada pelo encadeamento. O que é verificado é o custo.

## Referências

- [`ADR 0022`](0022-blocos-do-mundo-isometricos.md) — substituída: o endpoint e a armadilha do RGBA cru continuam valendo; o default uniforme não
- [`ADR 0025`](0025-molde-como-referencia-de-geracao.md) — substituída: o molde continua; canonização, legado e referência não
- [`ADR 0024`](0024-cubo-isometrico-canonico.md) — a geometria de que o molde é desenhado
- [`ADR 0028`](0028-modo-manequim-e-preenchimento-do-quadro.md) — a moldura estufada do v3 e o recorte comum
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/world-block.ts` — as duas cadeias, o hash e a idempotência
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/cube-mould.ts` — o molde
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/character-detail.ts` — por que os pixels do v3 moram no CharacterDetail
- `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/openapi/openapi-v2.json` — o spec vendorizado, única fonte sobre os endpoints

**Última atualização:** 2026-08-01
