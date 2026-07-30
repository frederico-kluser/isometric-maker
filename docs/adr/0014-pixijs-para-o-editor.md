# ADR 0014 — PixiJS 8 continua, agora contra o argumento oposto

> **Quick Start (TL;DR)**
>
> PixiJS 8 + Vite + TypeScript continua sendo o renderizador. Mas a justificativa da [ADR 0001](0001-pixijs-em-vez-de-cocos.md) morreu com o MMORPG, e o argumento que ela usava contra o Cocos agora **favorece** o Cocos. A decisão se sustenta por outro motivo: num editor, o editor de cena é o produto — e produto não se terceiriza.
>
> ```bash
> node /home/ondokai/Projects/isometric-maker/tools/pixi-reference/scripts/vendor-types.mjs --check
> ```

**Status:** aceita · **Data:** 2026-07-30
**Substitui:** ADR 0001

## Contexto

A ADR 0001 escolheu PixiJS em vez de Cocos Creator com um raciocínio inteiramente moldado pelo MMORPG: *num MMO a lógica autoritativa vive no servidor e o mundo é montado a partir de dados de rede, então um editor de cena rende pouco e ainda força uma segunda stack.*

A [ADR 0010](0010-pivo-para-editor-isometrico.md) apagou a premissa. Não há servidor, não há dados de rede, e o mundo **não** é montado a partir de rede — é montado à mão, numa tela, por uma pessoa. Ou seja: o único argumento que a ADR 0001 apresentou contra o Cocos agora aponta para o lado contrário. O Cocos tem editor de cena pronto, inspetor de propriedades, hierarquia visual e serialização de prefab — exatamente as peças que este projeto acabou de declarar como sendo o produto.

Uma decisão cuja justificativa inverteu precisa ser reexaminada de verdade, não confirmada por inércia. É o que este documento faz.

## Decisão

**PixiJS 8 + Vite + TypeScript, mantido.**

O argumento novo tem três partes.

**1. O editor de cena não é uma peça que podemos reaproveitar — é o produto.** O Cocos entrega um editor genérico de cena 3D/2D, com hierarquia de nós e transformações. O que este projeto precisa é um editor de mapa isométrico com Z discreto, autotiling por máscara de bits, picking pela diagonal `(+1,+1,+1)` e um formato de projeto próprio. Nada disso sai de graça de um editor genérico; tudo isso teria que ser escrito como extensão de um editor que não é nosso, numa API de extensão que ninguém aqui conhece. Adotar o Cocos trocaria "escrever o editor" por "escrever o editor dentro de outro editor".

**2. O que a ADR 0001 registrou como custo aceito virou vantagem.** Ela escreveu: *"PixiJS é apenas renderer. Cena, tilemap, colisão, câmera e UI são nossos."* Para um MMO isso era ônus. Para um editor cujo produto **é** cena, tilemap, colisão e câmera, controlar essas quatro coisas é o requisito, não o preço.

**3. O investimento em conhecimento já foi feito e é verificável.** A [ADR 0009](0009-conhecimento-pixijs-vendorizado.md) fixou `pixi.js` em 8.19.0 sob `/home/ondokai/Projects/isometric-maker/tools/pixi-reference/`, com os tipos completos, as 26 skills oficiais que o próprio pacote publica, proveniência com sha256 e um verificador que reprova qualquer afirmação sobre símbolo inexistente ou depreciado. Trocar de motor joga fora essa superfície inteira e recria, contra um alvo sem equivalente vendorizado, o mesmo risco de escrever de memória que este repositório já documentou como sua armadilha principal.

Some-se que o empacotador de atlas em `src/atlas.ts` já emite TexturePacker JSON Hash na forma que o PixiJS 8 lê, com extrusão e ordem de frame determinística — e ele foi escrito e testado antes de existir qualquer cliente.

## Alternativas consideradas

**Cocos Creator 3.8 LTS.** Agora tem um argumento real a favor, e é por isso que esta ADR existe. Perde por (1): o editor genérico dele não encurta o caminho até um editor isométrico especializado, e a distância entre "editor de cena" e "editor de mapa com Z discreto e autotiling" é praticamente todo o trabalho. Custo adicional: descartar a superfície de conhecimento vendorizada da ADR 0009.

**Tiled como editor de mapa, PixiJS só como runtime.** É a alternativa mais forte que existe — o Tiled já faz isométrico com camadas e exporta um formato que o ecossistema entende. Rejeitada porque o produto é o construtor. Se o mapa é feito no Tiled, o que sobra deste projeto é um gerador de sprite e um carregador, e a parte que o usuário pediu para construir deixa de existir. Vale como referência de formato e de ergonomia, não como dependência.

**Motor próprio sobre canvas ou WebGL cru.** Rejeitada pelo mesmo motivo de sempre: batching, gerenciamento de textura e ciclo de vida de GPU são trabalho resolvido, e resolvê-lo de novo não aproxima o produto.

## Consequências

- **A cena, o tilemap, a câmera, o picking, o desfazer/refazer e a UI do editor são todos nossos.** Isso agora é uma escolha consciente, não um custo aceito a contragosto.
- **O pino de versão vira restrição real.** O `pixi.js` instalado no construtor tem que ser exatamente `8.19.0`, igual ao vendorizado, ou o verificador da ADR 0009 passa a validar afirmações contra uma versão que ninguém executa. Isso exige uma checagem automática de pino.
- **Área menos resolvida:** desenhar milhares de tiles. A skill `rendering-pixi-tilemap` declara três perguntas em aberto, entre elas o `boundsArea` vazio do `ParticleContainer`, que **remove o chão inteiro do desenho sem erro nenhum**. É risco conhecido e não mitigado.
- **A ADR 0001 não é apagada.** Fica no lugar, sem alteração, como o registro do raciocínio que esta substitui. É a entrada deste documento, não o seu erro.

## Referências

- [`ADR 0001`](0001-pixijs-em-vez-de-cocos.md) — a decisão que esta substitui, e a comparação com Cocos, Godot e Bevy que continua sendo a base
- [`ADR 0009`](0009-conhecimento-pixijs-vendorizado.md) — o pino 8.19.0 e a superfície vendorizada
- `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/src/atlas.ts` — o contrato de atlas já escrito para o PixiJS 8

**Não verificado:** nenhum quadro foi renderizado neste repositório até hoje. Toda afirmação de desempenho é hipótese até a primeira tela existir.

**Última atualização:** 2026-07-30
