# ADR 0051 — Blocos com `InstancedMesh` por tipo, culling de células escondidas e picking por DDA contra o `MapData`

> **Quick Start (TL;DR)**
>
> Antes cada célula ocupada do mapa era um `THREE.Mesh` individual — um draw
> call por bloco. Agora cada tipo de bloco ganha UM `THREE.InstancedMesh` que
> desenha todas as células daquele tipo num draw call só. Células completamente
> cercadas nos 6 lados são cortadas (`computeHiddenCells`). Slots liberados
> voltam por lista livre. O picking abandonou o `Raycaster` do Three.js em favor
> do Amanatides-Woo DDA contra o `MapData` diretamente — sem depender de mesh
> nenhuma. O contrato `{hit, placement, hitFace}` foi preservado.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && npm run typecheck && npm test
> cd /home/ondokai/Projects/isometric-maker/packages/iso-core && npm test
> ```

**Status:** aprovada · **Data:** 2026-08-06

## Contexto

A [ADR 0037](0037-editor-3d-apenas.md) removeu o editor 2D e fez o editor de
mapa ser Three.js. A [ADR 0047](0047-renderizador-unico-threejs.md) removeu o
PixiJS do repositório inteiro, deixando Three.js como o único renderizador. Até
aqui, `syncBlocks` em `scene3d.ts` criava um `THREE.Mesh` por célula ocupada: um
bloco, um draw call. Para um mapa de 10 mil blocos de 5 tipos, eram 10 mil draws
— 9.995 dos quais redundantes, porque um draw call por tipo de bloco desenharia
as mesmas 10 mil células.

A [ADR 0040](0040-zoom-continuo-e-desenho-sob-demanda.md) já tinha atacado o
desempenho pelo lado do laço (parar quando nada muda). Faltava atacar pelo lado
da GPU: menos draw calls para o mesmo conteúdo.

E havia um segundo problema, independente: o picking. `Raycaster.intersectObjects`
precisa de meshes. Com `InstancedMesh`, um raycaster ainda funciona (o Three.js
suporta `InstancedMesh` nativamente), mas o custo de intersecção é por
triângulo da geometria, e o resultado precisa ser traduzido de `instanceId` para
coordenadas de mapa. Pior: o picking depende de haver mesh na cena — num editor
que por princípio desenha só o que é visível, uma célula escondida atrás de outra
(coluna cheia) não teria mesh nenhuma para atingir com o raio.

A resposta para os dois problemas veio junta: `InstancedMesh` resolve o draw
call; DDA resolve o picking.

## Decisão

**1. Um `InstancedMesh` por tipo de bloco.**

`BlockInstancing` (`block-instancing.ts`) mantém um mapa `blockId → BlockState`,
onde cada `BlockState` tem um `THREE.InstancedMesh` com geometria e material do
bloco. A geometria é compartilhada por proporção de sprite (cache em `cube3d.ts`);
o material é `MeshBasicMaterial` com a textura do bloco.

`setCell(key, blockId, x, z, y, cubeAngle)` aloca um slot no `InstancedMesh`
correspondente e escreve a matriz de transformação (posição + rotação de yaw). A
capacidade inicial é 1024 instâncias e dobra quando esgota, copiando as matrizes
existentes para o mesh novo.

O resultado: um mapa com 10 tipos de bloco desenhados em 20 mil células = 10 draw
calls para os cubos (um por `InstancedMesh`) mais N draws de sombra (um por quad
`ShadowMaterial`, [ADR 0048](0048-sombra-entre-cubos.md)). Antes eram 20 mil
draws para os cubos. O ganho é proporcional ao número de células, não ao número
de tipos.

**2. Lista livre para reúso de slots.**

Quando uma célula é removida (`removeCell`), seu slot é liberado e o índice entra
numa `freeList`. O slot ganha matriz de escala zero para sumir da tela.
`allocateSlot` consome a lista livre antes de expandir. Slots nunca são
compactados — o `count` do `InstancedMesh` é o maior índice ocupado + 1, e há
espaço vazio entre ele e a capacidade. A fragmentação é o preço de evitar
realocação a cada remoção.

**3. Culling de células escondidas.**

`computeHiddenCells` (`block-instancing.ts:78-119`) faz dois passes sobre
`map.blocks`:

1. Constrói um `Set<string>` de todas as células ocupadas.
2. Para cada célula ocupada, verifica se os 6 vizinhos (x+1, x-1, y+1, y-1,
   z+1, z-1) também estão ocupados. Se todos estiverem, a célula é marcada como
   `hidden` e **não é instanciada**.

O custo é `O(N)` em dois passes sobre as células ocupadas. A economia: num cubo
maciço de 10x10x10 (1000 células), apenas as 488 da superfície são visíveis; 512
do interior nunca seriam vistas. `computeHiddenCells` roda antes de
`syncBlocks` instanciar qualquer coisa.

Esta é uma otimização de CPU e GPU: menos instâncias para o `InstancedMesh`
gerenciar, menos quads de sombra para criar, menos draw calls de sombra.

**4. `instanceColor` para tintura por célula.**

`setCellColor(key, color)` (`block-instancing.ts:356-373`) ativa o
`instanceColor` do `InstancedMesh` sob demanda. O array `Float32Array(N * 3)` é
alocado na primeira célula colorida; as demais células do mesmo tipo continuam
brancas (identidade multiplicativa). Se a última célula colorida é removida, o
`instanceColor` inteiro é descartado, voltando ao material base puro.

O uso imediato: realce de seleção e feedback visual de ferramenta (ex: a célula
que vai ser removida fica vermelha).

**5. Picking por DDA contra o `MapData`, sem mesh nenhuma.**

`pick3d` (`pick3d-raycaster.ts:197-280`) substitui `Raycaster.intersectObjects`
por Amanatides-Woo DDA (`dda-raycast.ts`):

1. Converte `(clientX, clientY)` para NDC com `mouseToNDC`.
2. Dispara `raycaster.setFromCamera(ndc, camera)` **só** para obter o raio
   (`origin` e `direction` em world space).
3. Converte o raio para coordenadas de mapa (`worldToMap`).
4. Chama `ddaRaycast(origin, direction, isOccupied, maxDistance)`, onde
   `isOccupied` consulta o `MapData` via decodificação RLE (`getBlockAt`).

O DDA caminha a grid célula por célula. A primeira célula ocupada que encontra é
o `hit`. A normal da face é derivada do eixo do último passo do DDA (`lastStepAxis`
e `lastStepSign`). A célula de `placement` é `hit + normal` (célula adjacente).

Se o raio não atinge bloco nenhum, calcula a interseção com o plano `z = 0`
(chão) analiticamente e devolve a célula do chão como `placement`, com `hit: null`
e `hitFace: 'ground'`.

**6. O contrato de picking foi preservado.**

A interface `Pick3DResult` (`pick3d-raycaster.ts:44-56`) é idêntica à que existia
com o `Raycaster`: `{hit: {x, y, z, block} | null, placement: {x, y, z}, hitFace:
'top' | 'side' | 'ground' | null}`.

`hitFace` deriva da normal em coordenadas de mapa: `normal.z === 1` é `'top'`
(a face de cima do cubo); qualquer outra normal é `'side'` (face lateral).
`'ground'` é quando o raio atinge o chão sem passar por bloco nenhum.

A ferramenta de empilhar (`pickColumnTop` em `pick3d-raycaster.ts:291-308`)
continua funcionando: quando `hitFace === 'top'`, o `placement` é o topo da
coluna sob o cursor, não a célula adjacente.

## Alternativas consideradas

**Continuar com `Raycaster` contra `InstancedMesh`.** Rejeitada. O `Raycaster`
do Three.js funciona com `InstancedMesh` — ele testa cada instância contra o
raio. Mas:

- O custo é `O(N_instances)` por pick — para 10 mil instâncias, são 10 mil
  testes de interseção raio-caixa a cada movimento do mouse.
- Células escondidas por trás de outras (interior de coluna cheia) não têm mesh
  — o `Raycaster` nunca as encontraria, e clicar numa face lateral de um cubo
  que tem outro cubo atrás acertaria o cubo errado.
- O DDA testa `O(ray_steps)` células (~20-50 passos para um raio típico), não
  `O(N_instances)`. É mais barato por pick e não depende de mesh.

**Um `Raycaster` que lesse o `MapData` em vez dos meshes.** Rejeitada. Seria um
híbrido: o raio viria do Three.js, mas a consulta de ocupação seria contra o
mapa. O DDA já faz exatamente isso — e é um algoritmo publicado, com nome e
referência (Amanatides & Woo, Eurographics '87), em vez de uma adaptação ad-hoc
do Raycaster.

**Um `InstancedMesh` só para o mapa inteiro, com `instanceColor` como substituto
de textura.** Rejeitada. Cada tipo de bloco tem uma textura diferente (sprite
gerada). `InstancedMesh` tem um material só — para desenhar 10 texturas
diferentes num `InstancedMesh` só, seria preciso um atlas de textura e UVs
diferentes por instância, o que exigiria `BatchedMesh` (disponível no Three.js
mas com API diferente) ou custom shader. Um `InstancedMesh` por tipo é mais
simples e o número de tipos de bloco é pequeno (dezenas, não centenas).

## Consequências

- **Draw calls de cubos caíram de `O(células)` para `O(tipos de bloco)`.** Para
  10 tipos e 20 mil células: 10 draws de cubo, contra 20 mil antes. O ganho é
  real e proporcional à densidade do mapa.
- **O picking não depende de mesh nenhuma.** O DDA consulta o `MapData`
  diretamente. Remover todos os meshes da cena não quebraria o picking — o raio
  continua encontrando as células ocupadas.
- **`computeHiddenCells` é um pré-passo barato que corta a maior parte do
  trabalho em mapas densos.** Num cubo maciço de N células, ~`N^(2/3)` são de
  superfície; o resto nunca é instanciado.
- **A lista livre mantém o `InstancedMesh` sem realocar a cada remoção.** O
  trade-off é fragmentação: depois de muitas operações de colocar/remover, slots
  vazios ficam espalhados e o `count` pode ser maior que o número de células
  ativas. A GPU ainda processa os slots de escala zero, mas são descartados cedo
  no vertex shader (todos os vértices colapsam no mesmo ponto).
- **O contrato `{hit, placement, hitFace}` é o mesmo.** Ferramentas que
  consumiam o `Raycaster` não precisaram mudar — só a implementação da função
  `pick3d` mudou.
- **A expansão do `InstancedMesh` (dobrar capacidade) aloca um mesh novo e
  descarta o antigo.** A geometria e o material são compartilhados (não
  descartados), mas o buffer de matrizes é realocado. Para um mapa que cresce
  gradualmente, a expansão acontece `log2(N/1024)` vezes — ~4 vezes para 16 mil
  células.

## O que NÃO foi verificado

- **O desempenho com 100 mil células visíveis.** `InstancedMesh` reduz draw
  calls mas não reduz vértices — 100 mil cubos ainda são 100 mil x 24 vértices
  (compartilhados por tipo) que o vertex shader processa. O limite **não foi
  medido**.
- **Se `computeHiddenCells` compensa em mapas pouco densos.** Para um mapa com
  poucos blocos espalhados, o pré-passo varre todas as células ocupadas e
  encontra zero escondidas — é custo puro sem economia. O ponto de equilíbrio
  **não foi calculado**.
- **A latência de `getBlockAt` (decodificação RLE) no caminho quente do DDA.**
  Cada passo do DDA chama `isOccupied`, que faz uma busca linear nas runs da
  coluna. Para colunas com muitas runs (muitosburacos de ar entre blocos), o
  custo é `O(runs)` por passo. Mapas com RLE muito fragmentado **não foram
  perfilados**.

## Referências

- [`ADR 0037`](0037-editor-3d-apenas.md) — editor 3D, remoção do editor 2D
- [`ADR 0047`](0047-renderizador-unico-threejs.md) — um renderizador só, remoção do PixiJS
- [`ADR 0048`](0048-sombra-entre-cubos.md) — quads de sombra que somam um draw por célula visível
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/3d/block-instancing.ts` — `BlockInstancing`, `computeHiddenCells`, `setCell`, `removeCell`, `applyYaw`, `instanceColor`
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/3d/scene3d.ts` — `syncBlocks` (consome `computeHiddenCells` e `BlockInstancing`)
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/dda-raycast.ts` — Amanatides-Woo DDA, a base do picking
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/3d/pick3d-raycaster.ts` — `pick3d`, `pickColumnTop`, contrato `{hit, placement, hitFace}`
- Amanatides, J., Woo, A. "A Fast Voxel Traversal Algorithm for Ray Tracing." Eurographics '87.

**Última atualização:** 2026-08-06
