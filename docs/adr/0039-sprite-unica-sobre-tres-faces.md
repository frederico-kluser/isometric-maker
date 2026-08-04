# ADR 0039 — Uma sprite só, esticada sobre as três faces do cubo, girando com a câmera

> **Quick Start (TL;DR)**
>
> Um bloco tem **UMA** sprite isométrica, e ela cobre as três faces visíveis do
> cubo 3D por **UV exato canto-a-canto** — losango no topo, paralelogramo em
> cada lateral. O mesh **gira junto com a câmera**, então a mesma arte fica de
> frente nas quatro vistas e durante o giro animado. As faces são **sem
> iluminação** (`MeshBasicMaterial`), porque a pixel art já tem sombreamento
> assado. E os **6 blocos pagos** que o catálogo não reconhecia voltaram para a
> paleta.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/packages/iso-core && node --test src/iso-cube-uv.test.ts
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && node --test server/world-block.test.ts
> ```

**Status:** aprovada · **Data:** 2026-08-04

## Contexto

A [ADR 0032](0032-textura-animada-unica-abandono-3d.md) decidiu que cada bloco tem
**uma** arte, igual de qualquer ângulo — abandonando as quatro vistas da
[ADR 0029](0029-quatro-vistas-molde-encadeado-e-rotate.md). O editor 3D nunca
implementou isso direito. Três defeitos concretos, todos medidos antes desta
decisão:

**1. O catálogo escondia arte paga.** `listWorldBlocks` só emitia manifestos v2
(4 faces) e v3 `texture`. Os blocos em disco são v3 `rotate8-mould` /
`rotate8-prompt`, com oito `view-N.png` cada — e caíam fora dos dois ramos.
Medida: `listWorldBlocks('./assets')` devolvia **1 bloco de 7**. Seis blocos
pagos existiam em disco e não apareciam na paleta.

**2. O único bloco visível usava o caminho errado.** Sem `faceUrls`, ele caía em
`materialsWithSingleTexture`, que colava a sprite isométrica **inteira** em cada
face lateral e pintava o topo de cor sólida. O bloco aparecia como quatro cópias
esmagadas de si mesmo.

**3. O UV de sprite existente mapeava retângulos.** O topo do cubo é um
**losango** na sprite e um quadrado no UV; as laterais são **paralelogramos de
aresta vertical**, não meias-retângulos. Mapear retângulos alinhados aos eixos
cisalha a arte e sampleia os cantos transparentes do losango. O defeito é do tipo
"quase certo" — lê-se como geração ruim, não como mapeamento errado.

Além disso o mesh nunca girava: a sprite ficava presa em +X/+Y/+Z, e **três das
quatro vistas** mostravam faces cruas.

## Decisão

**1. Uma sprite por bloco, esticada sobre as três faces visíveis, por UV exato.**
A conta é a própria projeção 2:1 do iso-core, escrita para o cubo unitário do
three.js (`packages/iso-core/src/iso-cube-uv.ts`):

```text
x = anchorX + (cx − cz) · tileWidth/2
y = (cx + cz) · tileHeight/2 + (1 − cy) · cubeHeight
u = x / spriteWidth        v = 1 − y / spriteHeight
```

Isso é **exato**, não aproximado. A câmera é ortográfica com yaw 45° e elevação
30°, e a 30° a razão de tela é exatamente 2:1 — a mesma projeção em que a sprite
foi desenhada. Cada face projeta num paralelogramo, e paralelogramo é imagem afim
de quadrado: o mapeamento canto-a-canto é exato nos dois triângulos do quad, sem
cisalhamento e sem costura na diagonal.

**Verificação:** o cubo texturizado foi re-projetado em software e comparado com
a sprite de origem, nas quatro vistas. A saída é indistinguível do original —
tijolos, rachaduras e brilhos de gelo caem no mesmo pixel.

**2. O UV sai da POSIÇÃO do vértice, não do UV default do `BoxGeometry`.** O UV
default depende da ordem em que o three.js emite os vértices de cada face, que é
detalhe interno da biblioteca; a posição é a geometria. Efeito colateral que é o
ponto: os três vértices de um mesmo canto — um por face vizinha — recebem o mesmo
UV, porque as três faces se encontram num único pixel da sprite. É isso que faz
as arestas desenhadas casarem com as arestas geométricas.

**3. O cubo gira junto com a câmera.** `mesh.rotation.y = yaw − BASE_YAW`, em
todos os blocos, **continuamente** (não em degraus de 90°). O cubo é simétrico
sob 90° em Y, então girá-lo devolve o volume à mesma célula do mundo e mantém
+X, +Y e +Z sempre de frente. Em degraus, o giro animado de 280 ms exporia a face
crua ao passar por 45°.

Isto **reverte** a regra anterior ("o cubo nunca gira, só a câmera orbita"), e é
o que a ADR 0032 pedia: a arte não muda com a perspectiva.

**4. As faces do cubo não são iluminadas.** `MeshBasicMaterial`. A pixel art já
tem o sombreamento assado — topo claro, direita média, esquerda escura — e é a
convenção que `cube-raster.ts` declara desde sempre: *"a luz é presa à CÂMERA,
não ao mundo"*. Iluminar por cima escurece duas vezes e faz a mesma peça mudar de
cor ao girar, o que se lê como bug. A sombra projetada continua existindo e cai
no chão — ver [ADR 0040](0040-zoom-continuo-e-desenho-sob-demanda.md).

**5. A vista canônica é MEDIDA, não assumida.** Os manifestos `rotate8` gravam
`frameKeying: "assumed-canonical-order"` — ninguém verificou qual das oito vistas
é a isométrica de três faces (quatro delas são a vista de quina, com duas faces).
`silhouetteMatch` compara o alfa de cada candidata com a silhueta que
`faceAtPixel` define, e a de maior score vence. **Medido nesta arte: a `view-7`
vence em 5 dos 6 blocos** — a ordem assumida (`view-0` primeiro) estava errada.

**6. O catálogo passa a publicar os blocos de vistas numeradas**, com
`technique: 'views'` e a lista inteira de candidatas em `spriteUrls`. `'views'` é
técnica de **catálogo**, não de geração: descreve o que existe em disco e não
entra no enum `BLOCK_TECHNIQUES`, que valida o que o POST sabe produzir.

**7. Um caminho só.** O bloco procedural (sem arte gerada) usa o rasterizador do
iso-core e passa pelo **mesmo** UV. Não há mais três caminhos discordando sobre
o que é a arte de um bloco.

## Consequências

- **A arte do usuário aparece como ele a desenhou**, de todos os ângulos. O que
  ele vê no mapa é a sprite, não uma reinterpretação dela.
- **6 blocos pagos voltaram a ser usáveis** sem gastar um centavo na API.
- **A miniatura da paleta e o cubo nunca mais divergem**: as duas perguntam
  `canonicalSpriteUrl`. Antes a paleta adivinhava a URL e errava exatamente nos
  blocos de várias vistas.
- **Cubo não recebe mais sombra.** Material sem iluminação ignora shadow map.
  É a troca declarada na ADR 0040, com o caminho de volta documentado.
- **Arte que vaza da silhueta canônica é aparada.** O cubo só tem a silhueta; um
  bloco gerado com saliências acima do losango as perde. Medido na re-projeção.
- **Sprite fora de proporção estica.** A geometria sai da própria imagem
  (`spriteGeometryFromImage`), então qualquer tamanho funciona; quanto mais longe
  de `cubeHeight = tileWidth·√6/4`, mais esticada na vertical a arte aparece.
  `spriteStretchError` quantifica isso, e a função **avisa, nunca recusa**.
  Imagem sem aresta vertical nenhuma (`altura ≤ largura/2`) devolve `null` e cai
  no procedural, em vez de espelhar arte sobre um volume que ela não descreve.
- **`blockFaceToBoxGroup` foi apagado.** Era código morto que girava o
  *mapeamento* em vez do mesh.
- **A ADR 0032 continua vigente**, e esta é a sua implementação correta. As
  técnicas `chained` e `rotated` continuam substituídas.

## Referências

- [`ADR 0024`](0024-cubo-isometrico-canonico.md) — a geometria 48×53 e o `d = √((W²−H²)/2)` que esta ADR usa como base
- [`ADR 0029`](0029-quatro-vistas-molde-encadeado-e-rotate.md) — as quatro vistas, substituída pela 0032
- [`ADR 0032`](0032-textura-animada-unica-abandono-3d.md) — uma arte por bloco, igual de qualquer ângulo; esta ADR é a implementação dela no 3D
- [`ADR 0037`](0037-editor-3d-apenas.md) — o editor de mapa é só o 3D
- [`ADR 0040`](0040-zoom-continuo-e-desenho-sob-demanda.md) — a sombra e o desenho sob demanda que acompanham esta decisão
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/iso-cube-uv.ts` — o UV, puro e testado
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/iso-cube.ts` — `silhouetteMatch`, a escolha medida da vista
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/3d/cube3d.ts` — arte, materiais e cache de geometria
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/world-block.ts` — `listWorldBlocks` e a técnica `views`

**Última atualização:** 2026-08-04
