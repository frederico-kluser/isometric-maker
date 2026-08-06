# ADR 0049 — Física de blocos no editor: queda determinística, efeito dominó, e modo "Simular"

> **Quick Start (TL;DR)**
>
> Colocar um bloco no ar ou remover o bloco que sustentava outros cria uma
> situação que o formato do mapa permite mas a física real não tolera. Agora o
> editor detecta blocos sem suporte, simula a queda em passos discretos (1 nível
> a cada `fallInterval` passos fixos), propaga o efeito dominó quando um bloco
> que cai deixa outro sem suporte, e empurra o personagem para fora do caminho
> (MTV). Tudo em `iso-core`, sem Three.js. O editor tem um modo "Simular" com
> Play/Pause/Step/Apply/Discard.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/packages/iso-core && npm test
> ```

**Status:** aprovada · **Data:** 2026-08-06

## Contexto

O editor permite colocar e remover blocos livremente. Colocar um bloco no ar — ou
remover um bloco que sustentava outros — cria uma configuração que o formato RLE
do mapa representa sem erro (coluna com ar explícito por baixo) mas que desafia a
física: o bloco deveria cair até encontrar suporte, e os blocos que dependiam dele
deveriam cair junto.

Até aqui, o editor não modelava essa consequência. O usuário removia a base de
uma torre e a torre continuava flutuando — o mapa aceitava, a cena desenhava, e
só o olho denunciava.

A [ADR 0036](0036-fisica-de-marchas-agachar-e-gravidade.md) já tinha modelado
física para o personagem (marchas, agachar, gravidade, degrau). A [ADR
0038](0038-colisao-solida-aabb.md) deu ao personagem um corpo (caixa AABB de 0,65
célula). Faltava o outro lado: o que acontece com os blocos.

## Decisão

**1. O modelo de suporte é binário e discreto.**

Um bloco em `(x, y, z)` tem suporte se `z = 0` (o chão é sempre sólido) ou se
existe bloco em `(x, y, z-1)` (`hasSupport` em `block-physics.ts:80-89`).
Nenhuma outra condição — sem cálculo de centro de massa, sem suporte parcial, sem
balanço.

**2. A queda é determinística: 1 nível por `fallInterval` passos fixos.**

`stepBlockPhysics` (`block-physics.ts:164-282`) avança a simulação um passo fixo
de cada vez. Cada bloco sem suporte acumula progresso num contador; quando o
acumulador atinge `fallInterval` (default 6, com `fixedDt = 1/60` resulta em 100
ms por nível), o bloco desce 1 nível. Se a nova posição tiver suporte, o bloco
aterra. Se não, continua caindo.

A queda é puramente vertical — sem deslocamento horizontal, sem avalanche
lateral. A física modela "o que está em cima cai para baixo", não "o que está do
lado desmorona".

**3. Efeito dominó: a simulação detecta novos blocos sem suporte a cada passo.**

Quando um bloco aterra numa posição nova dentro da mesma coluna, o bloco que
estava acima dele perde o suporte. `stepBlockPhysics` chama `findUnsupported` a
cada descida, filtrando as colunas que já estão na simulação para não duplicar. O
bloco recém-descoberto entra na lista de `falling` e começa a cair no passo
seguinte. O dominó é consequência de reaplicar a regra de suporte, não uma regra
separada.

**4. O bloco que cai sobre o personagem empurra-o para fora (MTV).**

Se um bloco em queda aterrissa na mesma célula que o personagem, o personagem é
empurrado na direção de menor penetração via `pushOutOf` (`collision-box.ts`), a
mesma função que resolve o personagem enterrado em sólido. O bloco não é
empurrado — a suposição é que o bloco é mais massivo e aterra onde cai
(`entity-collision.ts:88-113`).

**5. `BlockWorld` encapsula o mapa para a simulação.**

A simulação não conhece `MapData` nem o formato RLE. `BlockWorld`
(`block-physics.ts:142-147`) é a interface mínima: uma lista de células ocupadas
(`{x, y, z, blockType}`) e um `CollisionMap` para consultar suporte e
sólido. Quem traduz entre RLE e `BlockWorld` é o editor
(`map-editor-3d.tsx`).

**6. O editor ganha o modo "Simular" com Play/Pause/Step/Apply/Discard.**

O estado `mode` do editor (`map-editor-3d.tsx:213`) agora aceita três valores:
`'editar'`, `'testar'` e `'simular'`. No modo simular:

- Ao entrar, o editor tira um snapshot do mapa (`originalMapRef`).
- `initBlockPhysics` detecta os blocos sem suporte.
- Um `rAF` exclusivo roda `stepBlockPhysics` a cada passo fixo.
- **Play/Pause** (`simState: 'running' | 'paused'`): controla se o `rAF` avança
  ou não.
- **Step**: avança exatamente um passo fixo da simulação com a física pausada.
- **Apply**: escreve o resultado de `resolveMapAfterSimulation` de volta no mapa
  real, substituindo as colunas afetadas.
- **Discard**: restaura o snapshot original. Nenhuma célula do mapa foi alterada.

**7. API de consulta espacial: raycast, overlap, sweep — tudo em iso-core.**

Três funções em `physics-query.ts` complementam a simulação com consultas
espaciais que não dependem de Three.js:

- **`raycast`** (`physics-query.ts:98-180`): Amanatides-Woo DDA contra o
  `CollisionMap`. Devolve a primeira célula ocupada, a normal da face e a
  distância.
- **`overlap` / `overlapMap`** (`physics-query.ts:210-266`): testa um AABB contra
  uma lista de entidades ou diretamente contra o `CollisionMap`. Itera o
  sub-volume de células que intersectam a caixa.
- **`sweep`** (`physics-query.ts:294-460`): varre um `EntityBox` ao longo de um
  vetor de velocidade com sliding por eixo (X, Y, Z), mesma ordem de
  `resolveMovement`. Devolve o tempo de colisão (0–1), a normal e a célula
  atingida.

**8. Colisão entre entidades: o bloco que cai empurra o ator.**

`entity-collision.ts` acrescenta entidade-vs-entidade ao modelo que antes só
conhecia entidade-vs-mundo:

- `fallingBlockHitsPlayer`: o bloco está na mesma célula que o personagem?
- `pushPlayerFromFallingBlock`: empurra o personagem para fora via MTV. O bloco
  não se move.
- `pushPlayerFromFallingBlocks`: processa todos os blocos caindo em ordem
  determinística (por z decrescente), aplicando push-out em sequência.

## Alternativas consideradas

**Física contínua com engine externa (Rapier, Matter.js, Planck).** Rejeitada. O
mundo é um grid de inteiros com Z discreto — a terceira dimensão é uma pilha, não
um espaço contínuo. Uma engine 2D simulando o plano XY deixaria Z inteiramente de
fora, e as regras de suporte e borda teriam que ser reimplementadas à mão sobre a
engine. O ganho seria o quê? Fricção e inércia lateral que este projeto não tem e
não pediu.

**Mover os blocos que caem diretamente no `MapData`, sem simulação separada.**
Rejeitada. Escrever no mapa a cada passo misturaria simulação com edição: o
histórico de undo gravaria cada nível de queda como uma operação do usuário, e
"desfazer" depois de "aplicar" teria que desfazer N passos de simulação. A
separação entre `BlockWorld` (volátil, da simulação) e `MapData` (persistente, do
documento) é o que permite "aplicar" como uma operação atômica e "descartar" como
zero operações.

**Simular colisão horizontal entre blocos (avalanche).** Rejeitada por escopo. A
física de blocos modela queda vertical porque é o que resolve o problema visível
(blocos flutuando). Avalanche lateral — um bloco que cai e empurra o vizinho —
exigiria um modelo de estabilidade lateral que este projeto não tem, e o custo de
implementação (física de contato entre N corpos rígidos) é desproporcional ao
ganho.

## Consequências

- **Blocos sem suporte caem.** Colocar um bloco no ar inicia a queda; remover a
  base de uma torre derruba a torre inteira.
- **O personagem é empurrado para fora do caminho de um bloco que cai.** Não é
  morto, não perde vida — o editor não tem sistema de dano. O push-out é a única
  resposta.
- **O modo "Simular" é não-destrutivo até o "Aplicar".** O usuário pode ver a
  física acontecer, pausar, avançar passo a passo, e decidir se aplica ou
  descarta. Nenhuma célula do mapa é alterada antes da confirmação.
- **A simulação é testável sem navegador.** `stepBlockPhysics`, `findUnsupported`
  e `resolveMapAfterSimulation` são funções puras em `iso-core`. Mesma entrada,
  mesma saída — verificável com `node --test`.
- **A física de blocos não está acoplada ao renderizador.** `BlockWorld` é uma
  interface; o editor fornece os dados, e o `rAF` do modo simular chama
  `stepBlockPhysics` e desenha o resultado. Sem dependência circular entre
  `iso-core` e `character-builder`.
- **O bloco que cai não danifica outros blocos.** Só o personagem sofre push-out.
  Dois blocos que caem um sobre o outro não colidem entre si — o de cima continua
  caindo até encontrar suporte ou o chão.

## O que NÃO foi verificado

- **O desempenho da simulação com milhares de blocos caindo.** `findUnsupported`
  varre todas as células ocupadas; num mapa grande com muitos blocos flutuando, o
  custo é linear no número de células. O pior caso **não foi medido**.
- **Que o `rAF` do modo simular e o `rAF` do modo teste não interfiram entre
  si.** Os dois modos usam `rAF` separados e nunca estão ativos ao mesmo tempo
  (o `mode` é exclusivo), mas a interação entre dois laços de quadro no mesmo
  `renderer` **não foi testada** com os dois competindo pelo mesmo frame.

## Referências

- [`ADR 0036`](0036-fisica-de-marchas-agachar-e-gravidade.md) — física do personagem: marchas, agachar, gravidade
- [`ADR 0038`](0038-colisao-solida-aabb.md) — caixa AABB de 0,65 célula, varredura por eixo, push-out MTV
- [`ADR 0047`](0047-renderizador-unico-threejs.md) — um renderizador só, física de colisão passa a fazer sentido nos dois lados
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/block-physics.ts` — `hasSupport`, `findUnsupported`, `initBlockPhysics`, `stepBlockPhysics`, `resolveMapAfterSimulation`, `BlockWorld`
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/physics-query.ts` — `raycast`, `overlap`, `overlapMap`, `sweep`
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/entity-collision.ts` — `fallingBlockHitsPlayer`, `pushPlayerFromFallingBlock`, `pushPlayerFromFallingBlocks`
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/collision-box.ts` — `pushOutOf`, `PLAYER_HALF`, `solidAtOf`
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/3d/map-editor-3d.tsx` — modo simular: Play/Pause/Step/Apply/Discard

**Última atualização:** 2026-08-06
