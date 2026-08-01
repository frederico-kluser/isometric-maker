# ADR 0020 — A diagonal do picking avança `zStep/tileHeight` por nível, não uma célula

> **Quick Start (TL;DR)**
>
> A [ADR 0013](0013-geometria-isometrica-64x32-z16.md) afirma que o raio da câmera em espaço de grid é a diagonal `(+1,+1,+1)`. Com a geometria que ela própria fixa — tile 64×32, `zStep` 16 — o valor correto é `(+0,5, +0,5)` por nível. A decisão da 0013 continua vigente; apenas essa consequência está errada, e código escrito a partir dela erra o picking por um fator de dois.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/packages/iso-core && npm test
> ```

**Status:** aceita · **Data:** 2026-08-01
**Corrige:** ADR 0013

## Contexto

A ADR 0013 fixou tile de 64×32 px e nível de Z valendo 16 px. Na seção Consequências, ela escreveu:

> **O picking fica exato e barato.** Vale a identidade `screenToWorld(sx, sy, z+1) === screenToWorld(sx, sy, z) + (1, 1)`: o raio da câmera em espaço de grid é exatamente a diagonal `(+1,+1,+1)`.

A conclusão prática — picking é aritmética, caminha-se a diagonal do topo para baixo até achar o
primeiro bloco sólido, sem raycast e sem heurística — está certa. O número está errado.

`packages/iso-core/src/geometry.ts` e `tools/map-builder/src/picking.ts` implementam o valor correto,
e `geometry.test.ts` o testa na forma geral. Ou seja: **o código nunca seguiu a ADR**, e a ADR é que
ficou de fora. Um agente que leia a decisão registrada e escreva picking a partir dela produz código
que erra a célula por um nível a cada dois.

## A aritmética

Da própria ADR 0013:

```text
worldToScreen(x,y,z):   sx = (x−y)·32          sy = (x+y)·16 − z·16
screenToWorld(sx,sy,z): a = sx/32   b = (sy + z·16)/16   x = (b+a)/2   y = (b−a)/2
```

Substituindo `z+1`:

```text
b′ = (sy + (z+1)·16)/16 = (sy + z·16)/16 + 1 = b + 1
x′ = (b + 1 + a)/2 = x + 0,5
y′ = (b + 1 − a)/2 = y + 0,5
```

O deslocamento é meia célula em cada eixo. `(+1,+1)` só valeria se um nível de Z valesse uma altura
de tile inteira — e a ADR 0013 escolheu deliberadamente metade disso, para que três ou quatro níveis
empilhados ainda coubessem na tela.

## Decisão

**A identidade é geral, e o caso 2:1 é um caso particular dela:**

```text
screenToWorld(sx, sy, z+1, geom) ≡ screenToWorld(sx, sy, z, geom) + (zStep/tileHeight, zStep/tileHeight)
```

Com a geometria deste projeto — `tileHeight` 32, `zStep` 16 — isso é `(+0,5, +0,5)` por nível, e são
necessários **dois níveis de Z para atravessar uma célula completa**.

A forma geral é a que se escreve em código e em skill. Escrever o caso particular convida o próximo
leitor a repetir exatamente este erro quando a geometria mudar.

**A ADR 0013 permanece vigente e não é substituída.** A decisão dela — 64×32, `zStep` 16, Z inteiro e
discreto — está correta e continua em vigor. Só a consequência citada acima está errada.

## Sobre o campo `**Corrige:**`

O repositório tinha um mecanismo só: decisão revista gera ADR nova com `**Substitui:**`, e a antiga é
marcada como substituída no índice. Aqui isso seria falso — marcaria como obsoleta uma decisão que
está certa e em uso.

`**Corrige:**` é o mecanismo para o caso em que a decisão se sustenta e um fato declarado ao lado dela
não. Ele obedece à mesma regra unidirecional: **o arquivo novo ganha um campo, o antigo nunca é
tocado**. No índice, a ADR corrigida continua `vigente`, com a correção anotada.

## Consequências

- `tools/map-builder/src/picking.ts` já caminha `(−0,5, −0,5)` por nível e está certo. Nada a mudar
  no código.
- A skill que documenta `iso-core` carrega a forma geral, com `geometry.test.ts` como sinal de
  verificação — o teste falsifica a afirmação, o que a prosa da ADR não fazia.
- Vale a pena notar por que o erro passou: `Math.floor` é a única regra de arredondamento que
  preserva a propriedade da diagonal, e `geometry.ts` documenta isso. A ADR falava da diagonal sem
  falar do arredondamento, então a checagem cruzada nunca aconteceu.

## Referências

- [`ADR 0013`](0013-geometria-isometrica-64x32-z16.md) — a decisão de geometria, vigente
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/geometry.ts` — `screenToWorld`, `screenToCell` e a regra de piso
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/geometry.test.ts` — a suíte `propriedade da diagonal`, que testa a forma geral em três geometrias
- `/home/ondokai/Projects/isometric-maker/tools/map-builder/src/picking.ts` — o consumidor da identidade

**Última atualização:** 2026-08-01
