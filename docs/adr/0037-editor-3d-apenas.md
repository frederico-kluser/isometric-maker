# ADR 0037 — O editor de mapa é 3D (Three.js), o 2D do PixiJS saiu

> **Quick Start (TL;DR)**
>
> O editor de mapa 2D do PixiJS foi **removido** (commit `3f4c47e`,
> 2026-08-03): 24 arquivos apagados e ~6,3 mil linhas a menos, e o `pixi.js`
> saiu do `character-builder`. O editor de mapa agora é **só o 3D do
> Three.js** (raycasting, `BoxGeometry`), e `#/mundo` é a rota única —
> `#/mundo3d` virou apelido de compatibilidade para favoritos antigos. O
> PixiJS continua vivo em `tools/runtime` (jogável) e em `tools/pixi-reference`
> (conhecimento vendorizado).
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && npm test
> cd /home/ondokai/Projects/isometric-maker/packages/iso-core && npm test
> ```

**Status:** aprovada · **Data:** 2026-08-03

## Contexto

O editor de mapa nasceu 2D, com PixiJS 8 ([ADR 0014](0014-pixijs-para-o-editor.md)):
uma cena isométrica desenhava um `Sprite` por célula, vindos de um pool, com
ordem de desenho por `depthAt`, `nearest` sem mipmap e escala de palco inteira
(ADR 0013). A geometria era a do sprite isométrico 48×53 sobre o tile 48×24 —
a conta documentada em `docs/03-mapa/cubo-e-molde.md`.

Em paralelo, um editor **3D** com Three.js nasceu na branch `3d` (commit
`1f0d57a`, "3D map editor with Three.js — raycast-based block placement") e
foi fundido ao character-builder pelos merges `4981218`, `e9babf3`, `7430799`
e `eb638ad` (branch `3d-slow`), com os ajustes de grid, desentortamento da
face do sprite e colocação estilo Minecraft (`19fb4df`, `b3807f7`, `ec7bd97`).
Durante a janela de coexistência, os dois editores viviam lado a lado: o 2D na
rota `#/mundo` e o 3D na `#/mundo3d`.

Manter os dois era custo dobrado de renderização, picking, colocação e testes
para uma mesma pergunta — "como o bloco fica no mapa?". A Onda 2 decidiu
**fechar o 2D** e deixar o 3D como o único editor de mapa.

## Decisão

**1. O editor 2D do PixiJS foi removido.** O commit `3f4c47e` apaga **24
arquivos** e o diff inteiro é de **35 arquivos, +104/−6294 linhas**. Foram
deletados: `scene.ts`, `renderer.ts`, `app.ts`, `cube.ts`, `camera.ts`,
`picking.ts`, `placement.ts`, `actor.ts`, `autotile.ts`, `export.ts`,
`collision-map.ts`, `pick3d.ts`, `tools/{paint,stack,wall}.ts`,
`map-editor.tsx`, `compass.tsx` e os testes correspondentes (`actor.test.ts`,
`autotile.test.ts`, `camera.test.ts`, `export.test.ts`, `picking.test.ts`,
`placement.test.ts`). O editor de mapa passa a ser **exclusivamente o 3D**:
Three.js `^0.185.1` com `BoxGeometry` e picking por raycaster
(`map/3d/pick3d-raycaster.ts`).

**2. Tipos compartilhados extraídos.** `BlockDef`, `Facing` e `Cell3D` saem
para `map/3d/block-def.ts`; os helpers de canvas do cubo saem de `cube.ts`
para `map/3d/cube-canvas.ts`; `columnHeight` foi movido de `pick3d.ts` para
`map/editor/map-state.ts`. O 3D deixa de ser "um protótipo na pasta 3d" e
passa a ser a casa do editor.

**3. Rotas consolidadas.** `#/mundo` é a rota canônica do editor de mapa;
`mundo3d` deixou de ser rota própria e virou **apelido de compatibilidade**
(`ROUTE_OF_PATH`), para quem salvou favorito em `#/mundo3d` continuar caindo
no editor.

**4. PixiJS removido do character-builder.** A dependência `pixi.js` saiu do
`package.json` e não sobra **nenhum** import do PixiJS no `src/`. O PixiJS
8.19.0 permanece em `tools/runtime` (o jogável exportado) e em
`tools/pixi-reference` (tipos e skills vendorizados, ADR 0009) — são os
únicos consumidores do conhecimento PixiJS que sobra.

**5. Efeitos colaterais registrados.** O commit corrige 2 erros de tipo
pré-existentes em `server/api.ts` (necessários para o typecheck fechar) e
reescreve a skill `editing-isometric-maps` para o editor 3D apenas
(`9248fca`); as skills de Three.js são formalizadas (`74d1df9`), com a
correção do caminho de `cube-canvas.ts` logo depois (`572c084`).

## Alternativas consideradas

**Manter os dois editores.** Rejeitado: cada feature de mapa (picking,
colocação, autotile, exportação, teste) teria que existir duas vezes, e o 2D
não tinha caminho para as mecânicas do 3D (empilhar por face, girar a câmera,
ADR 0021/0030).

**Manter o 2D e derrubar o 3D.** Rejeitado: a colocação por raycaster
(face de cima → topo da coluna; face lateral → célula adjacente) e a câmera
girável são o futuro do editor; o 2D era o passado.

## Consequências

- **O modo teste perdeu o ator 2D.** `collision-map.ts` (103 linhas, a ponte
  `MapData → CollisionMap`) e `actor.ts` (231 linhas, direção, entrada e
  escolha de animação) foram deletados com o 2D. No editor 3D, só existe o
  **setter** do personagem de teste (`setTestPlayer` em
  `map-editor-3d.tsx`) — comentário explícito: "o modo teste (onda futura)
  escreve aqui. Hoje só o setter existe: nada lê a posição ainda". O modo
  teste **precisa ser reimplementado no 3D**, apoiado na colisão sólida da
  ADR 0038.
- **Testes diminuíram de 459 para 362** no character-builder (registrado no
  commit; hoje 364/364 passando) — o 2D levou junto os testes de autotile,
  export, picking, placement, actor e camera. O iso-core seguiu com 473 e,
  com a colisão da Onda 3, chegou a 504.
- **Sem contradição com a ADR 0032.** O "abandono do 3D" da 0032 é a técnica
  de **arte** (as 4 vistas por bloco via `chained`/`rotated`); o 3D desta ADR
  é o **motor de renderização** (Three.js). São planos diferentes: a arte do
  bloco é textura animada única, o mapa é renderizado em 3D.
- **Docs do 2D ficam como história.** `docs/03-mapa/cubo-e-molde.md` descreve
  a renderização do editor 2D (escala não uniforme, pool de sprites); a doc
  não é atualizada retroativamente — é registro do que o editor foi.
- **O conhecimento PixiJS não morre.** `tools/runtime` e `tools/pixi-reference`
  continuam consumindo PixiJS 8.19.0; as skills de PixiJS do repo seguem
  valendo para eles.

## Referências

- [`ADR 0014`](0014-pixijs-para-o-editor.md) — PixiJS 8 como renderizador do editor (era 2D)
- [`ADR 0032`](0032-textura-animada-unica-abandono-3d.md) — "abandono do 3D" na arte; escopo distinto desta ADR
- [`ADR 0038`](0038-colisao-solida-aabb.md) — a colisão que o modo teste 3D vai consumir
- Commit `3f4c47e` — "onda2-remove-2d: remove 2D sprite map editor, keep only 3D (Three.js)"
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/3d/` — o editor 3D: `block-def.ts`, `cube3d.ts`, `pick3d-raycaster.ts`, `map-editor-3d.tsx`
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/app/router.ts` — `#/mundo` canônica e o apelido `mundo3d`

**Última atualização:** 2026-08-03
