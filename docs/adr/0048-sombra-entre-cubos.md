# ADR 0048 — Sombra entre cubos: um quad `ShadowMaterial` filho por cubo, com opacidade desacoplada da fotometria

> **Quick Start (TL;DR)**
>
> O chão já recebia sombra via um plano `ShadowMaterial` (`grid3d.ts`). Com a
> [ADR 0047](0047-renderizador-unico-threejs.md), sombra passou a fazer sentido em
> cubos também: uma torre sem sombra do bloco de cima no de baixo lê-se como
> "flutuando". A solução é um quad `ShadowMaterial` filho, ancorado logo acima da
> face +Y de cada cubo — geometria e material compartilhados, um draw call a mais
> por cubo visível. A opacidade da sombra (`CUBE_SHADOW_OPACITY = 0.42`) é
> independente da fotometria da luz porque o material do cubo é `MeshBasicMaterial`
> e ignora iluminação.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && npm run typecheck && npm test
> ```

**Status:** aprovada · **Data:** 2026-08-06

## Contexto

A [ADR 0040](0040-zoom-continuo-e-desenho-sob-demanda.md) configurou o shadow map
com `autoUpdate = false` e deixou a sombra funcionando no chão — um plano
`ShadowMaterial` que desenha só a sombra, sem geometria visível. A
[ADR 0039](0039-sprite-unica-sobre-tres-faces.md) decidiu que os cubos usam
`MeshBasicMaterial`: sem iluminação, a pixel art já tem o sombreamento assado
(topo claro, laterais médio e escuro), e `receiveShadow` em material iluminado
mudaria a cor da arte — pior, mudaria diferente a cada giro de câmera.

Isso deixou um buraco: o chão recebe sombra, mas um cubo não recebe do cubo acima
dele. Uma torre de três blocos projeta sombra no chão; o bloco do meio e o de
baixo ficam igualmente claros. Visualmente, a torre não lê peso.

A [ADR 0047](0047-renderizador-unico-threejs.md) tirou o PixiJS do repositório
inteiro e unificou o renderizador em Three.js. Com um renderizador só, sombra
entre cubos — que era impossível no runtime 2D — passou a ser possível nos dois
lados: editor e jogo exportado.

## Decisão

**1. Cada cubo ganha um quad filho com `ShadowMaterial` logo acima da face +Y.**

O quad é criado por `createCubeShadowQuad()` (`cube3d.ts:136-156`): uma
`PlaneGeometry(1,1)` girada −90° em X para deitar no plano XZ (topo do cubo),
com `ShadowMaterial({ color: 0x000000, opacity: CUBE_SHADOW_OPACITY,
depthWrite: false })`. Geometria e material são **compartilhados** entre todos os
cubos — a fábrica devolve sempre o mesmo par, e a posição world-space de cada
quad sai da hierarquia do grafo de cena (o quad é filho do mesh do cubo).

**2. A opacidade da sombra é desacoplada da fotometria da luz.**

`CUBE_SHADOW_OPACITY = 0.42` (`cube3d.ts:112`). É o mesmo valor do catcher do
chão em `grid3d.ts`, para consistência visual: a sombra que um cubo projeta no
bloco de baixo tem a mesma intensidade da sombra que ele projeta no chão.

A luz (`DirectionalLight` em `scene3d.ts`) existe para PROJETAR sombra, não para
iluminar — todos os materiais da cena são `Basic`/`Sprite`/`Shadow`, que ignoram
iluminação. Por isso a intensidade da luz (`1`) e a opacidade da sombra (`0.42`)
não têm relação matemática entre si: são dois números independentes que produzem
o resultado visual desejado, e mudar um não implica mudar o outro.

**3. O quad fica `SHADOW_QUAD_EPS = 0.001` acima do topo.**

Distância suficiente para evitar z-fighting com a face +Y do cubo, pequena o
bastante para não descolar visualmente. O valor é minúsculo porque a câmera é
ortográfica e o ângulo de visada (~30° de elevação) comprime a separação
vertical — um epsilon grande seria visível como um halo claro entre o cubo e a
sombra.

**4. `depthWrite: false` no quad de sombra.**

Onde não há sombra o quad é transparente (o `ShadowMaterial` devolve preto com
alfa igual à opacidade onde o shadow map marca sombra, e transparente onde não
marca). Se escrevesse profundidade, um quad transparente ocluiria o grid e os
cubos atrás dele — ou seja, a ausência de sombra numa face de cima esconderia o
que está abaixo.

**5. O cubo continua `castShadow = true, receiveShadow = false`.**

`createCubeMesh` (`cube3d.ts:556-568`) configura o mesh principal com
`castShadow = true` (projeta sombra no chão e nos cubos abaixo) e
`receiveShadow = false` (o material `MeshBasicMaterial` ignora shadow map). Quem
recebe é o quad filho, não o cubo.

**6. O shadow map continua `autoUpdate = false`.**

O chão precisa de `needsUpdate = true` quando o mapa muda. Os quads de sombra
entre cubos não mudam essa regra: adicionar ou remover um cubo muda o mapa, e
`syncBlocks` já marca `needsUpdate`. A sombra **entre** cubos não adiciona
nenhuma condição nova de invalidação — ela usa o mesmo shadow map, a mesma luz e
a mesma câmera de sombra.

## Alternativas consideradas

**Iluminar os cubos com `MeshLambertMaterial` e usar `receiveShadow` nativo.**
Rejeitada. A pixel art já tem sombreamento assado nas três faces — iluminar por
cima escurece a arte duas vezes. Pior: a iluminação depende do ângulo entre a
normal da face e a luz, e como a luz é fixa no mundo enquanto a câmera gira (os
cubos giram junto, [ADR 0039](0039-sprite-unica-sobre-tres-faces.md)), a mesma
face mudaria de cor a cada giro — o usuário leria como bug, não como iluminação.

**Um plano `ShadowMaterial` por coluna em vez de por cubo.** Rejeitada. Uma
coluna de 5 cubos com um plano só no topo receberia a sombra do cubo acima do
topo, mas o 3º cubo não receberia sombra do 4º. Cada nível da pilha precisa do
seu próprio receptor.

**`depthWrite: true` no quad.** Rejeitada. O quad cobre 1 unidade quadrada; onde
não há sombra ele é transparente, mas com `depthWrite: true` escreveria
profundidade de qualquer jeito, ocluindo tudo atrás dele — grid, cubos em outras
colunas, o chão. O resultado é um buraco preto de 1×1 na cena.

## Consequências

- **Torres de blocos passam a ter peso visual.** Um cubo projeta sombra no cubo
  de baixo com a mesma intensidade com que projeta no chão.
- **Um draw call a mais por cubo visível.** O InstancedMesh desenha o cubo num
  draw call; o quad de sombra é um mesh separado, não-instanced, e cada um é um
  draw call. Para 10 mil cubos visíveis são 10 mil draws de sombra — o perfil de
  desempenho disso **não foi medido**. A estimativa é que `ShadowMaterial` é um
  shader barato (uma amostra de textura, uma multiplicação), mas afirmar o custo
  sem medir seria inventar.
- **Cubos no runtime também têm sombra entre si.** A [ADR
  0047](0047-renderizador-unico-threejs.md) reescreveu o runtime em Three.js; o
  mesmo `createCubeShadowQuad` serve aos dois lados.
- **Nada muda para o shadow map em si.** Mesma luz (`SUN_OFFSET`), mesmo
  frustum, mesmo `autoUpdate = false`, mesma resolução (2048²). O quad só
  adiciona um consumidor novo do mapa que já existia.
- **As constantes visuais continuam sendo escolha.** `0.42` de opacidade e
  `0.001` de epsilon não foram derivados de nenhuma grandeza física — são valores
  que ficaram bons no olho, declarados como tal.

## Referências

- [`ADR 0039`](0039-sprite-unica-sobre-tres-faces.md) — `MeshBasicMaterial` nas faces, sem iluminação
- [`ADR 0040`](0040-zoom-continuo-e-desenho-sob-demanda.md) — `shadowMap.autoUpdate = false`
- [`ADR 0047`](0047-renderizador-unico-threejs.md) — um renderizador só, sombra passa a fazer sentido nos dois lados
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/3d/cube3d.ts` — `createCubeShadowQuad`, `CUBE_SHADOW_OPACITY`, `SHADOW_QUAD_EPS`, `createCubeMesh`
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/3d/scene3d.ts` — luz, `shadowMap.autoUpdate`, `SUN_OFFSET`, `sizeShadowFrustum`
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/3d/grid3d.ts` — o catcher do chão, mesma opacidade

**Última atualização:** 2026-08-06
