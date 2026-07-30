# ADR 0013 — Tile isométrico 64×32, nível Z de 16 px, Z inteiro

> **Quick Start (TL;DR)**
>
> Projeção dimétrica 2:1. Losango de **64×32 px**, um nível de altura vale **16 px**, e o eixo Z é **inteiro e discreto** — blocos empilhados por célula. A altura do pulo define quantos níveis o personagem alcança.
>
> ```text
> worldToScreen(x,y,z):  sx = (x-y)*32          sy = (x+y)*16 - z*16
> screenToWorld(sx,sy,z): a = sx/32   b = (sy+z*16)/16   x = (b+a)/2   y = (b-a)/2
> ```

**Status:** aceita · **Data:** 2026-07-30

## Contexto

A [ADR 0010](0010-pivo-para-editor-isometrico.md) definiu que o produto é um editor isométrico com altura. Três números precisam ser fixados antes de qualquer linha de código de mapa, porque mudá-los depois invalida todo `project.json` escrito e toda arte gerada: a largura do losango, a altura do losango e quanto vale um nível de Z.

"Isométrico" em jogos quase nunca é isometria verdadeira. A isometria de verdade tem razão 2:1,1547 e produz um losango com bordas em ângulo irracional, que serrilha em pixel art. O padrão de fato é a **dimétrica 2:1**: largura exatamente o dobro da altura, borda subindo dois pixels na horizontal para um na vertical, sem serrilha.

O eixo Z tem duas famílias. Altura contínua por célula (heightmap, com rampas suaves) dá visual mais rico e torna ordenação de desenho e colisão substancialmente mais difíceis em 2D. Altura discreta em níveis inteiros — blocos empilhados — é o modelo de Habbo, SimCity e afins: aritmética inteira, ordenação previsível, colisão trivial, e um editor que se consegue usar com o mouse.

## Decisão

**Tile de 64×32 px, um nível de Z valendo 16 px, Z inteiro e discreto.**

Cada célula `(x, y)` tem uma pilha de blocos indexada por `z`. Não existe meia altura. Subir é degrau ou pulo.

**Por que 64×32 e não 32×16 ou 128×64.** Abaixo de 32 px de largura o próprio spec da PixelLab avisa que a qualidade cai, e 16 px de altura de tile deixa margem quase nula para desenhar parede. Acima de 128 px o mapa que cabe na tela encolhe e o atlas passa a esbarrar no teto de 2048 px por página. 64×32 é o ponto onde a arte ainda é legível, a parede tem onde existir e o mapa continua grande.

**Por que 16 px de Z, e não 32.** Meio tile. Um nível de altura precisa ser visível o suficiente para o jogador entender que existe um degrau, e baixo o suficiente para empilhar três ou quatro níveis sem que o sprite saia da tela. Com 16 px, uma parede de um bloco tem metade da altura do losango — a proporção que os kits de construção da PixelLab produzem com `tile_depth_ratio` em torno de um terço.

**Como isso vira pedido à API.** O chão sai de `/create-tiles-pro` com `tile_type: "isometric"`, `tile_size: 64` e `tile_height: 48` — 32 px de face superior mais 16 px de saia, que é o nível de Z. O `tile_flat_top_px` fica em `2`, o losango pontudo clássico; `4` é o topo achatado moderno e produz outra silhueta.

**`/create-isometric-tile` não serve para esta geometria.** O `isometric_tile_size` dele é enum `[16, 32]` e a área máxima é 64×64: **é impossível obter um losango de 64 px de largura por esse endpoint**. Ele continua útil pela alavanca `isometric_tile_shape` (`thin tile` ~15% da altura do canvas, `thick tile` ~25%, `block` ~50%) se o projeto algum dia descer para tiles de 32×16, ou para blocos decorativos avulsos. Está escrito aqui para ninguém gastar descobrindo.

## Consequências

- **A escala de tela tem que ser inteira.** Um upscale de 1,5× destrói a costura do diamante 2:1, e extrusão de borda nenhuma corrige isso. O renderer usa `resolution: 1`, `autoDensity: false` e um único fator inteiro no stage.
- **O picking fica exato e barato.** Vale a identidade `screenToWorld(sx, sy, z+1) === screenToWorld(sx, sy, z) + (1, 1)`: o raio da câmera em espaço de grid é exatamente a diagonal `(+1,+1,+1)`. Selecionar o que está sob o cursor é caminhar essa diagonal do topo para baixo até achar o primeiro bloco sólido. Sem raycast, sem heurística.
- **A ordenação de desenho é `x + y + z`**, e paredes ficam a meia célula — a aresta norte de `(x,y)` está em `(x, y-0,5)` —, então a chave real é `2*(x+y+z)` mais um viés inteiro por aresta. **Onde isso falha:** um sprite mais alto que um nível de Z reivindica uma célula e ocupa quatro na tela, então empata com paredes que deveriam estar atrás; e um objeto que ocupe mais de uma célula produz oclusão cíclica, para a qual **não existe ordem linear correta**. A mitigação é de modelo, não de renderer: **o formato de projeto proíbe sprite multi-célula**, e tudo que ocupa mais de uma célula é fatiado na autoria. Um editor pode impor isso; um jogo herdado não podia.
- **A altura de cada célula é derivada, nunca armazenada.** É o `z` ocupado mais alto, mais um. Guardar mapa de altura *e* mapa de blocos é criar duas verdades sobre o mesmo terreno.
- **A âncora dos sprites de personagem muda.** Com Z discreto, um nível são 16 px; a âncora fixa em `y: 0,875` que o empacotador de atlas usa hoje erra cerca de 11 px num canvas inflado — quase um nível inteiro de deslocamento. Passa a ser medida na bounding box opaca da família.
- **Custo:** mais oclusão que um top-down puro, e o kit de construção precisa de peça para cada configuração de conexão de parede.

## Referências

- `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/openapi/openapi-v2.json` — `CreateTilesProRequest` (`tile_type`, `tile_size`, `tile_height`, `tile_flat_top_px`, `tile_depth_ratio`) e `CreateIsometricTileRequest` (`isometric_tile_size`, `isometric_tile_shape`)
- [`ADR 0015`](0015-low-top-down-8-direcoes-isometrico.md) — a perspectiva dos personagens que se assentam neste chão

**Não verificado:** se `/create-tiles-pro` com `tile_size: 64` e `tile_height: 48` devolve de fato uma face superior de exatamente 64×32 com saia de 16 px, ou se a proporção precisa ser calibrada por `tile_depth_ratio`. Isso só se responde gerando. Também não verificado: o custo desse endpoint, que não tem ponto medido em lugar nenhum.

**Última atualização:** 2026-07-30
