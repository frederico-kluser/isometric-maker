# Colisão sólida no mapa: a caixa AABB varrida por eixo

> **Quick Start (TL;DR)**
>
> O personagem deixou de ser um ponto: é uma **caixa AABB de ~0,65 célula**
> (`PLAYER_HALF = 0.325`) varrida por eixo — X primeiro, depois Y —, com
> **sliding de parede** natural (bloquear um eixo não trava o outro) e
> **push-out por MTV** quando o editor coloca um bloco sobre ele. A flag
> `solid` do catálogo de materiais é honrada via `blocksMovement`: **água,
> lava e folhagem não bloqueiam**. O degrau é proposto pela **face
> pressionada**, não pela travessia do centro. Decisão registrada na
> [ADR 0038](../adr/0038-colisao-solida-aabb.md).
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/packages/iso-core && node --test src/collision-box.test.ts
> cd /home/ondokai/Projects/isometric-maker/packages/iso-core && npm test   # 504/504
> ```

## O que a colisão era, e o que ela virou

A colisão histórica testava o **centro** do personagem contra a célula
(`Math.floor(pos)` contra `hasBlock`). As consequências eram visíveis no
jogo: a quina de um bloco só parava o personagem quando o centro cruzava a
fronteira da célula, e um personagem encostado numa parede "flutuava" a meio
corpo de distância dela. A caixa resolve as duas coisas: o corpo tem largura
de verdade e encosta na parede quando a **face** da caixa chega à fronteira.

Onde tudo mora:

- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/collision-box.ts` — caixa, varredura, push-out, `solidAt`
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/simulate.ts` — `fixedStepWithMap`, que consome a varredura
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/3d/map-editor-3d.tsx` — o push-out do editor 3D

## A caixa: 0,65 célula, mais estreita que o corredor

A entidade é uma `EntityBox` com centro contínuo `(cx, cy)`, nível `z`
inteiro (o piso) e meia-largura `PLAYER_HALF = 0.325`. A caixa total é de
**~0,65 célula**:

- É mais estreita que a célula (0,65 < 1): cabe no corredor de uma célula.
- Encosta na parede 0,325 célula **antes** de o centro cruzar a fronteira —
  que é exatamente o que o degrau por face aproveita (ver abaixo).
- O código documenta a premissa `half < 0.5`: a varredura assume caixa mais
  estreita que a célula. Um `half` maior exigiria revisitar a varredura.
- Em Z a caixa ocupa `[z, z+1)` — meio-aberta em cima: um bloco em `z+1` é
  **tecto**, não parede.

## A varredura por eixo e o sliding

`resolveMovement` move **X primeiro**, atualiza a caixa, e move **Y** em cima
do resultado. Cada eixo marcha as células que a face dianteira atravessaria e
**clampa na primeira sólida** — `sweepX`/`sweepY` devolvem o deslocamento
efetivo. Bloquear num eixo **não** bloqueia o outro: encostar numa parede em
diagonal desliza ao longo dela. É o comportamento de Minecraft, e a resposta
à pergunta clássica do gamedev SE 88298 (com vários voxels na parede, a ordem
das colisões e normais de um varrimento "inteiro" é imprevisível e o jogador
engasga em toda quina; resolver um eixo de cada vez elimina o engasgo).

O `MovementResult` expõe `blockedX`/`blockedY`, que a simulação usa para
zerar a velocidade e propor o degrau.

## O degrau pela face (não pelo centro)

A caixa de 0,65 encosta no degrau 0,325 célula antes de o centro cruzar a
aresta. Se o degrau esperasse a travessia do centro — como na física da
[ADR 0036](../adr/0036-fisica-de-marchas-agachar-e-gravidade.md) —, o
personagem ficaria preso na parede: nenhum degrau seria escalável. Por isso
`fixedStepWithMap` tem **duas portas**:

1. a **travessia do centro** (comportamento histórico, intacto);
2. a **face pressionada**: `pressedCells` devolve as células sólidas em
   contato com a face bloqueada e, com `input.stepUp`, o degrau é proposto
   por elas (`blockedByBox && input.stepUp` em `simulate.ts`).

## O push-out (MTV), para o editor

Se a caixa já intersecta um sólido no início do passo — estado inválido que
só o editor cria, colocando um bloco sobre o personagem —, a varredura
devolve **movimento zero**: ela não empurra nem deixa aprofundar. Quem
resolve o encaixe é `pushOut`:

- empurra no **eixo de menor penetração** (MTV — minimum translation vector);
- é **um passo**, não uma resolução iterativa;
- é limitado a `MAX_PUSH = 0.9` célula; penetração maior devolve `null` e o
  chamador decide. Com o `PLAYER_HALF`, a penetração máxima possível é 0,65
  — dentro do limite.
- no editor 3D, `pushPlayerOutOfCell` roda depois de `placeBlock`/pintar:
  colocar um bloco **sólido** sobre o personagem de teste o empurra para
  fora; água/lava/folhagem não empurram.

## A flag `solid` do catálogo, finalmente consumida

O catálogo de materiais (`packages/iso-core/src/block-catalog.ts`) já
declarava `solid` para cada material — água e lava com `solid: false`,
folhagem como `kind: 'decoration'` —, mas **nenhum consumidor lia o valor**:
todo bloco barrava a passagem. Agora `solidAt` responde "esta célula barra a
passagem?" e a implementação canônica é `solidAtFromBlocks`, via
`blocksMovement` (`kind !== 'decoration' && material.solid`):

| Material | `solid` | Bloqueia? |
| --- | --- | --- |
| terra, grama, pedra, areia, madeira, metal, gelo, vidro | `true` | sim |
| água, lava | `false` | não |
| folhagem | `false` (`kind: 'decoration'`) | não |

O `CollisionMap` ganhou `solidAt` **opcional**: sem ele, o padrão cai para
`hasBlock` — o comportamento histórico —, então nenhum consumidor antigo
quebra. `movementCost` (infinito para a lava) é a camada seguinte — ainda sem
consumidor, não é colisão.

## Armadilhas

**Tunneling impossível com o passo de 0,067.** No pior caso (correndo), o
deslocamento máximo por passo fixo é `4 células/s × 1/60 s ≈ 0,067 célula` —
muito menos que a parede mínima de 1 célula. Além disso, a varredura marcha
**célula a célula** a partir da face dianteira: para pular uma parede, o
movimento teria que atravessar uma célula inteira num único passo, e o passo
nunca anda mais que 0,067. O número é **derivado** da configuração; o
comportamento é coberto por testes.

**Push-out limitado a 0,9.** Penetração maior que `MAX_PUSH` não é resolvida
em um passo — devolve `null` e o chamador decide o que fazer. Com o
`PLAYER_HALF` isso não acontece (máximo possível é 0,65); o limite existe
para caixas maiores.

**Degrau por face, não por centro.** A porta da face é o que torna degraus
escaláveis, mas o teste de "subir degrau" histórico continua sendo o da
travessia. Uma parede de aresta (superfície sem espessura) continua sendo
julgada pelo **centro** — `edgesAllowCross` — e a recusa histórica (voltar à
posição anterior) se preserva: só blocos, que têm volume, produzem clamping
de face.

**Anisotropia: X sempre primeiro.** Quando os dois eixos estão bloqueados
simultaneamente, X é resolvido antes de Y. É o preço do sliding determinístico
(igual ao Minecraft), e é um viés **não medido** em jogo real (ver abaixo).

**Caixa embutida não anda.** Se a caixa começa o passo dentro de um sólido,
a varredura devolve movimento zero — o comportamento "pregado" é o aviso de
estado inválido, não um bug da varredura. Quem resolve é `pushOut`.

**Meio-aberta em cima.** A caixa ocupa `[z, z+1)`: subir um nível com um
bloco em cima não é "bater no teto" — é **tecto**, e a varredura não o vê. O
Z é resolvido por degrau/pulo/gravidade, nunca pela varredura.

**Degrau diagonal não sobe.** `canStepUp` exige adjacência cardinal —
comportamento herdado da ADR 0036, inalterado.

## Verificado, derivado e não verificado

**Verificado (testes rodados em 2026-08-03):**

- `node --test src/collision-box.test.ts`: 28/28 passando (varredura, sliding,
  `solidAt` honrando o catálogo, `pressedCells`, push-out, `MAX_PUSH`).
- `node --test src/*.test.ts` no iso-core: **504/504** passando.
- `npm test` no character-builder: **364/364** passando.

**Derivado (aritmética da configuração, não medido):**

- O passo de 0,067 célula: `DEFAULT_CONFIG.speed = 4` × `fixedDt = 1/60`.
- A penetração máxima possível com `PLAYER_HALF` é 0,65 < `MAX_PUSH` de 0,9.
- O corpo "encosta 0,325 antes do centro": `PLAYER_HALF` sobre a fronteira da
  célula.

**Não verificado:**

- O **caminho do degrau pela face pressionada** em `simulate.ts` (linha ~355)
  não tem teste dedicado de integração em `simulate.test.ts` — só os testes
  unitários de `pressedCells` em `collision-box.test.ts`. Existe o teste do
  bloqueio pela face (simulate.test.ts, "o bloqueio tem um quadro exato"),
  mas não o de subir o degrau **pressionado**.
- O **viés X-bias** em jogo: o desvio anisotrópico não foi sentido nem medido
  com o personagem de teste — porque o **modo teste 3D ainda não existe**
  (ADR 0037): nada lê a posição do personagem de teste no editor.
- O comportamento em **corredor de 1 célula**: a geometria garante (0,65 < 1),
  mas não há teste de jogo com um personagem atravessando um corredor de uma
  célula.
- `movementCost` (custo de travessia, infinito para lava) continua sem
  consumidor.

## Referências

- [ADR 0038 — Colisão sólida: AABB varrida por eixo com push-out MTV](../adr/0038-colisao-solida-aabb.md) — a decisão
- [ADR 0036 — Física de marchas, agachar e gravidade](../adr/0036-fisica-de-marchas-agachar-e-gravidade.md) — a física que a caixa estende
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/collision-box.ts` — caixa, varredura, push-out e `solidAt`
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/simulate.ts` — `fixedStepWithMap` e a porta da face pressionada
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/block-catalog.ts` — a flag `solid` dos materiais
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/map-instances.ts` — `blocksMovement`
- https://gamedev.stackexchange.com/questions/88298 — swept AABB em mundo de voxel e a resposta por eixo (pesquisa da Onda 1)
- https://bugs.mojang.com/browse/MC-73837 — bounding box de entidade no Minecraft (pesquisa da Onda 1)
- https://github.com/fenomas/voxel-aabb-sweep — referência de varredura AABB com o padrão "zerar o eixo bloqueado" (pesquisa da Onda 1)

**Última atualização:** 2026-08-03
