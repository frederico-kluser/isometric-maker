# ADR 0038 — Colisão sólida: AABB varrida por eixo com push-out MTV

> **Quick Start (TL;DR)**
>
> O personagem ganhou **corpo**: uma caixa AABB de **~0,65 célula**
> (`PLAYER_HALF = 0,325`), varrida por eixo estilo Minecraft — X primeiro,
> depois Y — com **sliding de parede** natural e **push-out por MTV** quando o
> editor coloca um bloco sobre ele. A flag `solid` do catálogo de materiais
> passou a ser honrada via `blocksMovement`: **água, lava e folhagem não
> bloqueiam**. O degrau passou a ser proposto pela **face pressionada**, não
> pela travessia do centro (commit `1e14447`, 2026-08-03).
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/packages/iso-core && node --test src/collision-box.test.ts
> cd /home/ondokai/Projects/isometric-maker/packages/iso-core && npm test   # 504/504
> ```

**Status:** aprovada · **Data:** 2026-08-03

## Contexto

A colisão histórica do iso-core (`collision.ts`) testa o **centro** do
personagem contra a célula (`Math.floor(pos)` contra `hasBlock`). O corpo é
um ponto: a quina de um bloco só pára o personagem quando o centro cruza a
fronteira da célula, e um personagem encostado numa parede "flutua" a meio
corpo de distância. O ator 2D do editor (removido na
[ADR 0037](0037-editor-3d-apenas.md)) herdava essa colisão; o editor 3D não
tinha colisão nenhuma.

A flag `solid` do catálogo de materiais (`packages/iso-core/src/block-catalog.ts`)
existia desde o commit que tornou o bloco um cubo de verdade (`5167aca`), com
`friction`, `density` e `movementCost` — mas **nenhum consumidor** a lia:
todo bloco barrava a passagem, inclusive água e lava.

A pesquisa da Onda 1 já apontava o caminho. No gamedev Stack Exchange, a
pergunta 88298 mostra o engano clássico do swept AABB em mundo de voxel: com
vários voxels na parede, a **ordem das colisões e normais é imprevisível** e o
personagem engasga em toda quina — a resposta prática é resolver por eixo, um
de cada vez. No Minecraft, a entidade de movimento é uma **bounding box**, não
um ponto (MC-73837), e a física do gênero voxel desliza na parede em vez de
travar. A biblioteca de referência `voxel-aabb-sweep` (fenomas) implementa o
padrão de "zerar o eixo bloqueado e seguir nos outros" — exatamente o sliding.

## Decisão

**1. A caixa.** A entidade é uma `EntityBox` com centro contínuo (cx, cy),
nível `z` inteiro e meia-largura `PLAYER_HALF = 0.325` → caixa total de
**~0,65 célula**. A caixa é mais estreita que a célula (0,65 < 1): o
personagem cabe no corredor de uma célula e encosta na parede quando a face
da caixa chega à fronteira — 0,325 célula **antes** de o centro a cruzar. O
módulo documenta a premissa `half < 0.5` (varredura por face, ver abaixo).

**2. Varrimento por eixo (swept AABB), estilo Minecraft.** `resolveMovement`
move **X primeiro**, atualiza a caixa, e move **Y** em cima do resultado.
Cada eixo marcha as células que a face dianteira atravessaria (`sweepX`/
`sweepY`) e **clampa na primeira sólida**. Bloquear um eixo não bloqueia o
outro: encostar numa parede em diagonal **desliza ao longo dela**. É o
padrão da resposta à pergunta 88298 e o comportamento de Minecraft — a
anisotropia (X sempre resolvido antes de Y) é o preço aceito do design.

**3. Z fica fora do varrimento.** A caixa ocupa `[z, z+1)` — meio-aberta em
cima, um bloco em `z+1` é tecto, não parede. O Z continua resolvido por
degrau, pulo e gravidade (ADR 0036); o que a varredura consulta é
`solidAt(x, y, z)`.

**4. A flag `solid` é honrada.** `solidAt` responde "esta célula barra a
passagem?". A implementação canônica é `solidAtFromBlocks`, via
`blocksMovement` (`kind !== 'decoration' && material.solid`): água e lava
(`solid: false`) não barram, folhagem (`kind: 'decoration'`) também não. O
`CollisionMap` ganhou `solidAt` **opcional**; sem ele, o padrão cai para
`hasBlock` — o comportamento histórico, **retrocompatível**.

**5. Degrau pela face pressionada.** A caixa de 0,65 encosta no degrau 0,325
célula antes de o centro cruzar a aresta; se o degrau esperasse a travessia
do centro, o personagem ficaria preso na parede. `pressedCells` devolve as
células sólidas em contato com a face bloqueada, e `fixedStepWithMap` propõe
o degrau por elas (`blockedByBox && input.stepUp`), além da porta histórica
da travessia.

**6. Push-out por MTV.** Se a caixa já intersecta um sólido (estado inválido
criado pelo editor, por exemplo), a varredura devolve movimento zero — não
empurra nem deixa aprofundar. Quem resolve o encaixe é `pushOut`: empurra no
**eixo de menor penetração** até encostar na fronteira, **um passo**, limitado
a `MAX_PUSH = 0.9` célula. Com o `PLAYER_HALF`, a penetração máxima possível
é 0,65 — dentro do limite. No editor 3D, `pushPlayerOutOfCell` roda depois de
`placeBlock`/pintar: colocar um bloco sólido sobre o personagem de teste o
empurra para fora; água/lava/folhagem não empurram.

## Alternativas consideradas

**Motor de física (Rapier, matter.js).** Rejeitado: o movimento do jogo é em
grid, determinístico por passo fixo (ADR 0036); um motor de corpo rígido
introduz dependência pesada, resolução iterativa com ordem indefinida e um
replay que deixa de ser simples. A skill `simulating-isometric-physics`
registrava a ausência de decisão; esta ADR fecha a lacuna.

**Raycasting (DDA) para a colisão.** Rejeitado: raycast resolve visibilidade
e picking, não resposta de colisão — não há "o que fazer" quando o raio bate
na parede. A varredura de caixa responde com o deslocamento efetivo; o
raycaster do editor 3D (`pick3d-raycaster.ts`) continua no seu papel, o
picking.

**Biblioteca `voxel-aabb-sweep` (fenomas).** Rejeitado como dependência: o
varrimento por eixo que ela critica ("impreciso para movimentos grandes") é
exatamente o que o passo fixo de 0,067 célula do nosso motor torna irrelevante
(ver Consequências), e portá-la traria a anisotropia dela em vez da nossa.

**Manter o ponto.** Rejeitado por medição: o personagem continuaria a
"flutuar" a meio corpo da parede e o degrau dependeria do centro — o oposto
da jogabilidade de Minecraft que o editor 3D quer.

## Consequências

- **504/504 testes no iso-core**, incluindo 28 novos em `collision-box.test.ts`
  (+31 contando os acrescidos em `simulate.test.ts` e `trace.test.ts`,
  registrado no commit). Bloquear na parede passou a ter **quadro exato**: o
  teste histórico bloqueava quando o centro cruzava a fronteira; a caixa
  bloqueia quando a face encosta — medido no teste, o primeiro bloqueio sai
  do passo 7 para o passo 2.
- **Sliding de parede** coberto por teste ("bloquear X não trava Y"); a quina
  não se corta (o segundo eixo vê a célula do canto).
- **Tunneling impossível com o passo de 0,067.** A velocidade máxima é 4
  células/s e o passo fixo é 1/60 s → no máximo **0,067 célula por passo**,
  muito menos que a parede mínima de 1 célula; e a varredura marcha célula a
  célula da face dianteira, então uma parede de 1 célula **não pode ser
  pulada** — nem por um salto de velocidade. Número derivado da configuração;
  o comportamento em si é coberto por testes.
- **Anisotropia X-bias aceita.** Quando os dois eixos estão bloqueados, X é
  resolvido primeiro; o desvio é o preço do sliding determinístico, igual ao
  Minecraft. Não medido em jogo (ver não-verificado na doc de colisão).
- **Replay determinístico preservado** (ADR 0036): a caixa vive dentro do
  passo fixo; `trace.ts` e `stepWithMap` seguem sendo a mesma simulação.
- **O modo teste 3D ainda não existe** (ADR 0037): o `pushPlayerOutOfCell` é
  chamado com o personagem de teste, mas nada lê a posição ainda — a colisão
  está pronta para quando a Onda futura o implementar.
- **O runtime continua sem colisão**: `tools/runtime/src/main.ts` chama
  `step` sem mapa — fronteira zelada por `check-runtime-boundary`, inalterada.
- **Skill atualizada:** `simulating-isometric-physics` ganhou as citações
  novas (half, varredura, push-out) no mesmo commit.
- **A flag `solid` ganhou seu primeiro consumidor.** O catálogo já declarava
  `solid: false` para água/lava/folhagem desde `5167aca`; agora a colisão lê
  o valor — água e lava são atravessáveis por design, e `movementCost`
  (infinito para lava) é a camada seguinte, ainda sem consumidor.

## Referências

- [`ADR 0036`](0036-fisica-de-marchas-agachar-e-gravidade.md) — marchas, gravidade e degrau na travessia; o degrau por face estende esta decisão
- [`ADR 0037`](0037-editor-3d-apenas.md) — o editor 3D e a perda do ator 2D; o modo teste futuro consumirá esta colisão
- Commit `1e14447` — "onda3-solid-collision: implement AABB swept per-axis collision with push-out"
- https://gamedev.stackexchange.com/questions/88298 — swept AABB em mundo de voxel: engasgo nas quinas e a resposta por eixo (pesquisa da Onda 1)
- https://bugs.mojang.com/browse/MC-73837 — a colisão de entidade do Minecraft é bounding box, não ponto (pesquisa da Onda 1)
- https://github.com/fenomas/voxel-aabb-sweep — varrimento AABB contra voxels com o padrão "zerar o eixo bloqueado" (pesquisa da Onda 1)
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/collision-box.ts` — caixa, varredura, `pushOut` e `solidAtFromBlocks`
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/simulate.ts` — `fixedStepWithMap`, a porta da face pressionada
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/map-instances.ts` — `blocksMovement` (`kind !== 'decoration' && material.solid`)

**Última atualização:** 2026-08-03
