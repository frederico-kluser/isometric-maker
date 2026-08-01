# ADR 0021 — Rotação de câmera em quatro vistas, como parâmetro de vista

> **Quick Start (TL;DR)**
>
> O editor gira a câmera em quatro vistas de 90°. A rotação é um inteiro `0..3` aplicado à coordenada **antes** da projeção única, nunca gravado no documento: `BlockStore`, `EdgeStore` e o arquivo de projeto não mudam quando a câmera gira. `z` é invariante e a chave de profundidade é recalculada por vista. A oclusão continua imperfeita, e isso está declarado.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/packages/iso-core && npm test
> cd /home/ondokai/Projects/isometric-maker/tools/map-builder && npm test
> ```

**Status:** aceita · **Data:** 2026-08-01

## Contexto

Até aqui o editor tinha uma vista só. A skill
[`rotating-isometric-camera`](../../.agents/skills/rotating-isometric-camera/SKILL.md) reuniu o que é
verificável sobre girar um mundo isométrico — lido do OpenRCT2 e do Godot — e registrou explicitamente
que a adoção seria **decisão de arquitetura, não ticket**, porque toca geometria, profundidade,
entrada, orçamento de arte e o formato do projeto de uma vez. Esta ADR toma a decisão.

O pedido concreto era ver o mapa dos quatro ângulos, porque o produto é 2D com perspectiva 3D.

## Decisão

**Adotar rotação de câmera em quatro vistas discretas de 90°.**

Cinco escolhas, todas em `packages/iso-core/src/rotation.ts`:

1. **A rotação é um inteiro `0..3`, não um ângulo.** Normalizada com `& 3`, que também trata negativo
   do jeito certo (`-1 & 3 === 3`, enquanto `% 4` daria `-1`). Sem matriz e sem trigonometria em
   nenhum ponto do caminho.

2. **A rotação pré-transforma a coordenada; a projeção não muda.** Existe UMA fórmula de projeção
   (`camera.ts:viewToWorldPx`) e a rotação acontece antes dela. Não há variante de projeção por vista.

3. **O documento nunca é reescrito.** Girar a câmera não toca uma linha do mapa. A rotação é
   parâmetro de vista, e o arquivo exportado é o mesmo nas quatro.

4. **`z` é invariante, e a chave de profundidade é recalculada.** O termo `z` entra igual nas quatro
   vistas; o termo `x + y` **não sobrevive**. Em vez de materializar as quatro expressões equivalentes
   (`x+y`, `y−x`, `−(x+y)`, `x−y`), `rotatedDepthKey` rotaciona `(x, y)` e usa o mesmo `x' + y'` nas
   quatro — um caminho de código em vez de quatro chances de errar um sinal.

5. **Sprite direcional reindexa por aritmética modular.** Para N direções igualmente espaçadas, cada
   giro avança `N/4` índices: 2 para as 8 direções de personagem, 1 para as 4 faces de um bloco do
   mundo. **A magnitude é forçada pela geometria; o sentido não é** — nada no material consultado
   estabelece se a rotação avança horária ou anti-horária em relação à ordem canônica deste projeto.
   O sentido adotado é somar, e o que o fixa são os testes de `rotation.test.ts` mais a conferência
   visual no editor.

## Consequências

**A arte não fica quatro vezes mais cara.** Um bloco do mundo é gerado uma vez em modo uniforme e a
mesma arte serve as quatro vistas; só bloco com lado distinto paga quatro. Ver a
[ADR 0022](0022-blocos-do-mundo-isometricos.md).

**O picking precisa desrotacionar, e isso é o que quebra primeiro.** Tela → célula converte na
coordenada de VISTA, arredonda com `Math.floor` e só então desrotaciona. Fazer na ordem inversa
espalha o erro de arredondamento pelos dois eixos, e o sintoma aparece só depois de girar: a célula
sob o cursor salta na borda em duas das quatro vistas. `camera.test.ts` varre as quatro vistas de
propósito por causa disso.

**A oclusão continua imperfeita, e não se promete o contrário.** O motor isométrico de referência
resolve ordem de desenho por comparação par-a-par de caixas 3D, mantém duas implementações de
ordenação, e o próprio mantenedor descreve a variante estável como algo que "melhora drasticamente o
z-fighting, mas não o torna perfeito". Uma cena acíclica de uma vista pode ser cíclica de outra. A
chave escalar adotada aqui cobre o caso de célula única — que é exatamente o que o formato de mapa
permite (`packages/iso-core/src/map.ts`), e a restrição de sprite de célula única passa a carregar
peso também por causa da rotação.

**Enquadrar de novo a cada giro é obrigatório.** Girar muda o sinal de `x−y`, então o mesmo `pan` que
centrava a vista 0 joga o conteúdo para fora da tela nas outras três. `centerOn` recentra a cada giro;
sem isso a rotação parece teletransporte.

**Zero negativo virou bug de verdade.** `-x` com `x = 0` dá `-0` em JavaScript, e `-0` não é
`deepStrictEqual` a `0`: uma célula `{x: 1, y: -0}` deixa de bater com `{x: 1, y: 0}` numa comparação
de seleção, apesar de as duas virarem a mesma chave `"1:0"`. `rotatePoint` normaliza somando zero.
Foi um teste que achou isso, não a tela.

## Alternativas descartadas

**Reescrever o mapa a cada giro.** Simplificaria o desenho e destruiria o desfazer, o arquivo
exportado e qualquer noção estável de coordenada. O motor de referência também não faz isso.

**Ângulo contínuo.** Exigiria arte por ângulo arbitrário, que não existe e não seria gerável a custo
previsível. Quatro vistas é o que quatro faces cobrem.

**Comparador par-a-par de caixas 3D em vez de chave escalar.** É o que o motor de referência faz, e
custa quatro comparadores especializados mais duas implementações de ordenação — para um ganho que o
próprio autor chama de parcial. Com sprite de célula única a chave escalar basta; se um dia o formato
aceitar multi-célula, esta decisão precisa ser revista por ADR nova.

## Referências

- [`packages/iso-core/src/rotation.ts`](../../packages/iso-core/src/rotation.ts) — a transformação, a chave e o reindexamento
- [`packages/iso-core/src/rotation.test.ts`](../../packages/iso-core/src/rotation.test.ts) — ordem 4, invariância de `z`, acordo entre chave e projeção
- [`tools/map-builder/src/camera.ts`](../../tools/map-builder/src/camera.ts) — os três espaços de coordenada e o enquadramento
- [`tools/map-builder/src/camera.test.ts`](../../tools/map-builder/src/camera.test.ts) — ida e volta do cursor nas quatro vistas
- [ADR 0013](0013-geometria-isometrica-64x32-z16.md) — a geometria que esta rotação pré-transforma
- [ADR 0020](0020-identidade-da-diagonal-de-picking.md) — a diagonal do picking que a rotação preserva
- [`.agents/skills/rotating-isometric-camera/SKILL.md`](../../.agents/skills/rotating-isometric-camera/SKILL.md) — o material lido antes da decisão

**Última atualização:** 2026-08-01
