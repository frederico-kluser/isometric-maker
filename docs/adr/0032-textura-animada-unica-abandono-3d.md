# ADR 0032 — Textura animada única: abandono das 4 vistas 3D em favor de animação por `animate-with-text-v3`

> **Quick Start (TL;DR)**
>
> Abandonamos as 4 vistas por bloco (molde encadeado `chained` e rotate via v3 `rotated`)
> em favor de UMA textura animada por bloco, gerada pelo `/animate-with-text-v3` a partir
> de uma imagem plana do topo e um texto de ação gerado por LLM. A câmera continua girando
> (ADR 0021/0030), mas a arte do bloco não muda com a perspectiva — é uma textura, não um
> volume. Número de frames configurável (4, 8 ou 16).
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && node --test server/world-block.test.ts
> cd /home/ondokai/Projects/isometric-maker/packages/iso-core && node --test src/rotation.test.ts
> ```

**Status:** aceita · **Data:** 2026-08-02
**Substitui:** ADR 0029 (as técnicas `chained` e `rotated`)

## Contexto

A ADR 0029 estabeleceu que todo bloco teria 4 vistas distintas (norte, leste, sul, oeste),
geradas por duas técnicas: `chained` (molde encadeado, 4 gerações de tile) e `rotated`
(1 tile + 1 v3). A rotação de câmera (ADR 0021/0030) seleciona a face com
`(facing + rotation) mod 4`, dando a ilusão de volume.

O resultado prático não convenceu: a PixelLab não produz vistas consistentes — a aresta
vertical varia de face para face, o material muda de cor, e o bloco não lê como o mesmo
objeto visto de ângulos diferentes. A ADR 0029 já declarava que "não foi verificado que o
v3 rotacione bem um cubo" e que "a orientação por texto é convenção, não capacidade
verificada". Cinco blocos foram pagos sob essas regras e arquivados.

O usuário decidiu abandonar a abordagem 3D. O pedido: uma imagem plana única, animada,
que funciona como textura do bloco independentemente do ponto de vista.

## Decisão

**1. Cada bloco tem UMA textura animada, não quatro vistas.** A técnica `texture`
substitui `chained` e `rotated`. O bloco mostra a mesma animação de qualquer ângulo de
câmera — é uma textura, não um volume.

**2. O fluxo de geração tem três etapas:**

   a. **Imagem base.** Gera UMA imagem plana do material via `create-image-pixflux`
      (síncrono, 48×48 px, vista top-down). Esta imagem é a textura de referência.
   
   b. **Descrição da animação via LLM.** O texto de descrição do bloco é enviado a um
      LLM com o prompt: "Given a block described as '{descrição}', write a short animation
      action for a pixel-art sprite animation API. Describe subtle ambient motion
      appropriate for this material. Keep it under 200 characters. Respond with only the
      action text, no explanation." O resultado é o campo `action` do
      `/animate-with-text-v3`.
   
   c. **Animação.** A imagem base vai como `first_frame` do `/animate-with-text-v3`,
      com o `action` gerado pelo LLM e `frame_count` configurável (4, 8 ou 16, sempre par).
      O endpoint devolve os frames como `background_job_id`; os PNGs são baixados e
      empacotados em spritesheet.

**3. O número de frames é configurável.** `frameCount` ∈ {4, 8, 16} (padrão 8).
O `frame_count` do endpoint tem que ser par, e o pixel budget é
`width × height × frame_count ≤ 524288`. Com 48×48: 48×48×16 = 36864 — cabe folgado.

**4. A câmera continua girando, mas a arte não muda.** O mecanismo de rotação da
ADR 0030 (snapshot rígido do quadro composto) permanece. A diferença é que
`textureFor(blockId, rotation)` sempre devolve a mesma textura animada,
independentemente de `rotation`. O bloco é um decalque, não um volume.

**5. O manifesto sobe para versão 3.** `block.json` versão 3 inclui:
`technique: 'texture'`, `frameCount`, `action` (o texto gerado pelo LLM),
`fps` (padrão 8), e `spritesheet` (caminho do atlas). As 4 faces somem do manifesto.

**6. O LLM é chamado pelo servidor, com fallback determinístico.** Se a chamada ao
LLM falhar (sem chave, sem rede), o sistema gera um `action` por template:
mapeia palavras-chave da descrição para verbos de animação
(ex.: `water` → "water rippling and flowing gently", `grass` → "grass swaying softly in the breeze").
O hash inclui o `action` final — fallback diferente = cache separado.

## Alternativas descartadas

**Manter as 4 vistas como opção.** O usuário rejeitou: as duas técnicas da ADR 0029
não produziram resultado utilizável. Manter código que só existe para uma comparação
que já aconteceu é dívida.

**Usar `animate-character` com template.** Exigiria um `character_id` — o bloco não é
um personagem. O `/animate-with-text-v3` aceita uma imagem solta como `first_frame` e
anima a partir dela, que é exatamente o que queremos.

**Usar `create-isometric-tile` como etapa 1.** O tile gera um cubo isométrico 3D, que
é o oposto do que queremos. Uma imagem plana via `create-image-pixflux` é mais barata
(síncrona, sem job) e produz exatamente a textura que vai ser animada.

**Pular o LLM e só usar template.** O usuário pediu explicitamente que o texto da
animação fosse gerado via LLM a partir da descrição do bloco. O fallback por template
existe para o caso de o LLM estar indisponível, não como caminho principal.

## Consequências

- **Custo por bloco: 1 imagem (pixflux) + 1 animação (animate-with-text-v3).**
  Preço estimado: ~2 gerações por bloco, comparado com 4 (chained) ou 2 (rotated).
  O guard de orçamento (ADR 0012) continua informando e nunca recusando.
- **O `init_image` quebrado do tile deixa de ser problema.** Não usamos mais
  `/create-isometric-tile` para blocos novos.
- **Blocos existentes (versão 2) continuam funcionando.** O map-builder detecta
  `technique` no manifesto e escolhe o caminho de renderização: `texture` → animado,
  `chained`/`rotated` → 4 faces (legado).
- **A cena do map-builder ganha um ticker de animação.** O `scene.ts` atual não tem
  loop contínuo — renderiza sob demanda. Blocos animados precisam de um
  `app.ticker.add` que atualiza os frames dos sprites animados.
- **O LLM precisa de chave de API.** A chamada usa `ANTHROPIC_API_KEY` do ambiente.
  Sem ela, cai no fallback determinístico.
- **O catálogo de skills precisa de atualização.** `animating-pixellab-sprites`
  ganha o fluxo de textura animada; `rotating-isometric-camera` registra que a
  rotação agora só afeta a câmera, não a arte dos blocos.

## Referências

- [`ADR 0029`](0029-quatro-vistas-molde-encadeado-e-rotate.md) — substituída: as técnicas `chained` e `rotated` saem
- [`ADR 0021`](0021-rotacao-de-camera-em-quatro-vistas.md) — a rotação discreta como parâmetro de vista, vigente
- [`ADR 0030`](0030-giro-rigido-do-quadro-composto.md) — o giro do quadro composto, vigente
- [`ADR 0012`](0012-guard-de-orcamento-informativo.md) — guard de orçamento, vigente
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/world-block.ts` — a nova técnica `texture`
- `/home/ondokai/Projects/isometric-maker/tools/map-builder/src/scene.ts` — renderização de blocos animados
- `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/openapi/openapi-v2.json` — spec vendorizado, única fonte sobre os endpoints

**Última atualização:** 2026-08-02
