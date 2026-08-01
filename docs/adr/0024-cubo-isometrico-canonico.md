# ADR 0024 — O cubo isométrico canônico: tile 48×24, aresta vertical 29

> **Quick Start (TL;DR)**
>
> Um cubo de verdade na projeção dimétrica 2:1 tem aresta vertical `d = sqrt((W² − H²)/2)`, que com `H = W/2` vale **`W·√6/4 ≈ 0,6124·W`** — nunca `W/2`. A geometria do projeto passa a ser **tile 48×24 px, aresta 29 px, sprite 48×53 px**, definida uma vez em `iso-cube.ts` e derivada em todo lugar. O `zStep = 16` da [ADR 0013](0013-geometria-isometrica-64x32-z16.md) desenhava blocos com **40,8 % da altura de um cubo**.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/packages/iso-core && npm test
> ```

**Status:** aceita · **Data:** 2026-08-01
**Corrige:** ADR 0013

## Contexto

A ADR 0013 fixou tile de 64×32 px e nível de Z valendo 16 px, com o argumento de que 16 é "meio tile" e produz uma parede com metade da altura do losango. A escolha foi feita por proporção visual, não por geometria — e a geometria tem uma resposta única.

A projeção deste projeto é:

```text
sx = (x − y) · W/2
sy = (x + y) · H/2 − z · d
```

Ela é uma projeção ortográfica de verdade se, e somente se, as duas linhas da matriz forem ortogonais e de mesmo módulo:

```text
linha_x = ( W/2, −W/2,  0 )
linha_y = ( H/2,  H/2, −d )

linha_x · linha_y = 0                    vale para qualquer W, H, d
|linha_x|² = |linha_y|²  ⟹  W²/2 = H²/2 + d²  ⟹  d = sqrt((W² − H²)/2)
```

Com a razão 2:1 (`H = W/2`) isso é `d = W·√6/4 ≈ 0,6124·W`. Para `W = 64` o valor é **39,19**, não 16. Um bloco com `d = 16` num tile de 64 tem `16 / 39,19 = 40,8 %` da altura de um cubo: uma laje.

O erro não era invisível. Era exatamente o sintoma relatado — "os blocos não ficam em perspectiva correta no mapa" —, e ele foi atribuído à arte gerada. A arte estava mais perto do certo que o editor: medidos os cinco blocos pagos em disco (48×48, `/create-isometric-tile`), o losango do topo saiu 2:1 nos cinco e a aresta vertical veio entre 20 e 22 px, contra os 29 de um cubo. O editor desenhava 16.

Havia também uma segunda geometria viva no mesmo repositório: `iso-cube.ts` nasceu com a conta certa enquanto `project.ts`, `camera.ts`, `app.ts` e `renderer.ts` seguiam repetindo `64 / 32 / 16`.

## Decisão

**Uma geometria canônica, definida uma vez em `packages/iso-core/src/iso-cube.ts`, e derivada em todos os consumidores: tile 48×24 px, aresta vertical 29 px, sprite 48×53 px.**

Nenhum módulo repete os números. `project.ts`, `camera.ts`, `app.ts` e o rasterizador importam de `iso-cube.ts`.

**Por que arredondar 29,3939 para 29, e por que isso é inócuo.** Aresta inteira exigiria `3W²/8` ser quadrado perfeito, o que pede `W = 2m√6` — irracional para todo `m` inteiro. **Não existe largura de tile inteira em 2:1 com aresta vertical inteira exata.** O arredondamento é obrigatório, e não acumula: `d` é uma constante única aplicada igual em todos os níveis, então empilhar dez blocos erra os mesmos 1,34 % que empilhar um.

**Por que 48 e não 56 ou 64.** O sprite mede `1,1124 · W`, e as duas dimensões precisam caber na faixa 16–64 px do `image_size` do `/create-isometric-tile`. `W = 56` (56×62) é o maior que cabe; `W = 64` (64×71) **não cabe**. 48 é múltiplo de 4 — meia-altura de losango inteira —, fica bem acima dos 24 px que o próprio spec recomenda como piso de qualidade, e é o tamanho da arte já paga, o que mantém a escala.

**Por que o sprite é exatamente o bounding box do cubo, sem margem.** O formato de mapa proíbe sprite multi-célula (ADR 0013) porque oclusão cíclica não tem ordem linear correta. Arte que transborda a célula é sprite multi-célula com outro nome.

**Por que a âncora é declarada.** A fórmula de projeção devolve o **vértice superior do losango do topo** — não o canto do bounding box e não o centro do losango. A fórmula sozinha nunca diz onde ancorar o sprite; quem assume "canto superior esquerdo" desloca o mapa inteiro por meia largura de tile. A âncora vira campo de `IsoCubeGeometry` (`anchorX = W/2`, `anchorY = 0`).

## Consequências

- **A ambiguidade entre "em cima" e "atrás" desaparece.** Com `d = H` — o palpite do "sprite quadrado" — subir um nível desloca o sprite exatamente o mesmo tanto que recuar uma diagonal `(x−1, y−1)`, e as duas situações caem no mesmo pixel. Com `d = 1,2247·H` isso deixa de acontecer. Há teste: `placement.test.ts`, `subir um nível NÃO é o mesmo que recuar uma diagonal`.
- **A escala do sprite tem de ser uniforme.** A cena desenhava `width = tileWidth × zoom` e `height = (tileHeight + zStep) × zoom` sobre uma textura de 48×48 — 1,333× na horizontal e 1,0× na vertical. Escala não uniforme sobre pixel art destrói a razão 2:1 do losango e é o que fazia os blocos não costurarem. A conta agora mora em `placement.ts`, com teste.
- **A diagonal do picking muda de valor.** A [ADR 0020](0020-identidade-da-diagonal-de-picking.md) estabeleceu a forma geral `zStep/tileHeight` por nível; ela continua vigente e o valor passa de 0,5 para `29/24 ≈ 1,2083`. Nada no código precisou mudar porque a implementação sempre foi geral.
- **`project.json` escrito antes disto abre com a geometria antiga.** O campo `geometria` é gravado no arquivo, então um projeto anterior continua carregável e continua descrevendo a projeção em que foi feito. O que muda é o default de projetos novos.
- **A arte paga não foi regerada.** O alinhamento ao molde ([ADR 0025](0025-molde-como-referencia-de-geracao.md)) reposiciona a arte existente sobre a âncora canônica sem chamar a API.
- **A ADR 0013 continua vigente em tudo o mais**: dimétrica 2:1, Z inteiro e discreto, blocos empilhados por célula. O que esta ADR corrige são os três números.

## Referências

- [`ADR 0013`](0013-geometria-isometrica-64x32-z16.md) — a geometria original; vigente exceto pelos números
- [`ADR 0020`](0020-identidade-da-diagonal-de-picking.md) — a forma geral da diagonal do picking
- [`ADR 0025`](0025-molde-como-referencia-de-geracao.md) — o molde desenhado a partir desta geometria
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/iso-cube.ts` — a definição, a derivação e a prova de que nenhum inteiro serve
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/iso-cube.test.ts` — 21 testes, incluindo a ortogonalidade da projeção
- `/home/ondokai/Projects/isometric-maker/tools/map-builder/src/placement.ts` — escala uniforme e âncora declarada

**Última atualização:** 2026-08-01
