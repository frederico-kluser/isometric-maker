# ADR 0045 — A sprite animada do bloco passa a ser desenhada no mapa, sem quebrar o desenho sob demanda

> **Quick Start (TL;DR)**
>
> O usuário **pagou** por blocos animados ([ADR 0032](0032-textura-animada-unica-abandono-3d.md))
> e o editor 3D nunca desenhou a animação: `spritesheetUrl`, `fps`, `frameCount` e
> `pingPong` atravessavam o catálogo e a definição do bloco inteiros para morrer
> sem serem lidos — o mapa mostrava um quadro parado. Agora a folha vira **UMA**
> textura com `repeat.x = 1/n`, e trocar de quadro é mexer no `offset.x`. Isto
> **condiciona** a promessa da [ADR 0040](0040-zoom-continuo-e-desenho-sob-demanda.md)
> ("o laço para sozinho") sem revogá-la, **não invalida o shadow map** de
> propósito, e re-empacota as folhas legadas a partir de `frames/` **sem chamar a
> API**.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && node --test src/map/3d/block-animation.test.ts
> ```

**Status:** aceita · **Data:** 2026-08-05

## Contexto

A [ADR 0032](0032-textura-animada-unica-abandono-3d.md) decidiu que cada bloco tem
uma textura **animada**. A geração foi implementada e cobrada; o desenho, não. Até
2026-08-04 a tela principal do mapa desenhava `base.png`, um quadro parado de uma
animação paga. Só a prévia do Laboratório animava, e ela anima por **outro
caminho** — os PNGs soltos de `frames/`, num `setInterval` próprio.

Havia ainda um segundo problema, em disco. O empacotador de folha foi corrigido
numa onda anterior para usar a dimensão **real** do quadro, mas as duas folhas já
gravadas ficaram com o antigo 48×48 fixo: uma é 432×48 (9 quadros) e a outra
240×48 (5 quadros), enquanto os `frames/*.png` e o `base.png` ao lado estão
íntegros em **48×53**. O `spritesheet.json` desses dois **contradiz os PNGs ao
lado**. Enquanto ninguém lia a folha isso era inofensivo; a partir do momento em
que o mapa lê, uma folha 48×48 esticada sobre um cubo de 48×53 mostraria arte
comprada com as cinco linhas da base cortadas — e nada reclamaria.

## Decisão

**1. Uma folha, uma textura, uma fase.** `repeat.x = 1/frameCount` e
`offset.x = índice/frameCount`. O UV 0..1 que a geometria do cubo escreve
([ADR 0039](0039-sprite-unica-sobre-tres-faces.md)) cai exatamente dentro de um
quadro. **Não há troca de material, não há UV novo e não há recompilação de
shader**: quem anda é a matriz da textura. A geometria sai do **quadro** medido,
nunca da folha, então o bloco animado cai na mesma chave de cache do parado.

Como todos os cubos do mesmo bloco compartilham o material, **todas as cópias
animam em fase**. É consequência do desenho existente, não descuido: um material
por instância multiplicaria as draw calls por bloco colocado.

**2. A aritmética mora num módulo puro, sem Three.js e sem DOM.** O que decide
**qual** quadro aparece — tempo, fps, vai-e-volta, e se a folha em disco descreve
mesmo o cubo — é aritmética, e o repositório não tem jsdom nem testing-library.
O que sobra para a camada de GPU é exatamente o que precisa de GPU.

O período do vai-e-volta é `2·(n−1)`, não `2n`: com `2n` os extremos apareceriam
dois tiques seguidos e a animação daria uma travadinha nas pontas. A fórmula é a
**mesma** da prévia do Laboratório, de propósito — o bloco não pode animar de um
jeito na bancada e de outro no mapa. A diferença é só a origem do tique.

**3. O contrato com o desenho sob demanda: duas perguntas separadas, e quem
decide é o laço.**

| Pergunta | Resposta | Para que serve |
|---|---|---|
| "algum bloco TROCOU de quadro?" | `true` só quando trocou | a 8 fps num monitor de 60 Hz, **sete de cada oito voltas não desenham nada** |
| "ainda existe animação viva?" | `true` enquanto houver | é isso que mantém o `rAF` agendado, e é isso que o deixa **parar** |

**Registrado não é ativo.** A lista de blocos animados recebe os ids que o
sincronizador **de fato colocou na cena**, não os da paleta. Sem isso, abrir o
editor com um bloco animado na paleta e um mapa vazio queimaria GPU para sempre
desenhando um mapa parado.

**4. O shadow map NÃO é invalidado pela animação, de propósito.** A animação troca
**cor** de textura, não silhueta, e o recorte por alfa do cubo é do material, não
do passe de profundidade. Marcar o shadow map como sujo a cada quadro traria de
volta o passe de 2048² por quadro que o `autoUpdate = false` da ADR 0040 existe
para evitar.

**5. As folhas legadas são re-empacotadas a partir de `frames/`, e isso não custa
nada.** A decisão é por **conteúdo**, não por flag de migração: comparar o
`spritesheet.json`, o cabeçalho do `spritesheet.png` e os quadros em disco. Rodar
de novo não faz nada, então não é migração de mão única e não há flag de "já
migrei" para ficar mentindo. A verificação roda na **leitura do catálogo**, que é
o único ponto por onde todo bloco passa antes de o editor tentar desenhá-lo.

**6. Um bloco cuja folha continue discordando degrada para o quadro parado**, em
vez de quebrar o mapa. A comparação é contra os **pixels** do quadro parado, não
contra a geometria declarada no manifesto: declaração é o que já estava errado nos
dois blocos; pixel é o que está certo neles.

**7. `animated === false` e `frameCount < 2` não animam.** Um quadro só é uma
imagem parada, e tratá-lo como animação manteria o laço de quadro acordado para
nunca trocar nada.

## Relação com a ADR 0040

Esta ADR é **complemento, não substituição**. A ADR 0040 continua valendo palavra
por palavra: sem nada animando e nada pendente, nenhum quadro é agendado. O que
muda é que **passa a existir uma categoria a mais de "algo animando"** — um bloco
animado no mapa —, e ela tem começo e fim bem definidos: o laço volta a parar
quando o último bloco animado sai do mapa, quando a paleta troca, ou quando o
usuário pede menos movimento.

Nenhum fato declarado na ADR 0040 ficou falso, então esta ADR **não a corrige**.

## Alternativas consideradas

**Um material por quadro, trocado a cada tique.** Recompila shader e força troca
de estado no renderizador. A matriz da textura faz o mesmo trabalho sem nada
disso.

**Um `setInterval` próprio, como o da prévia do Laboratório.** Funciona na
bancada, onde há um elemento só e o laço de quadro não é compartilhado. No mapa
brigaria de frente com o desenho sob demanda: o intervalo não sabe se houve troca
de quadro, então pediria desenho oito vezes por segundo mesmo quando nada mudou.

**Reagerar as folhas erradas pela API.** Custaria as duas gerações de novo, e os
`frames/` ao lado já contêm exatamente os pixels comprados. Re-empacotar é
gratuito e verificável.

## Consequências

- **A animação paga passou a aparecer no mapa**, pelo mesmo caminho de UV do bloco
  parado.
- **Duas folhas em disco foram reescritas sem gastar nada.** A conferência contra
  uma cópia dos dois blocos pagos deu 9/9 e 5/5 quadros idênticos pixel a pixel,
  com sidecar e frames byte-idênticos.
- **A escrita da folha passou a ser atômica e com trava por bloco.** A versão
  anterior usava escrita direta dentro de um caminho de **leitura**, e leituras
  concorrentes pegavam PNG truncado numa fração mensurável das vezes. A ordem
  "PNG antes do atlas" virou desenho declarado: na janela entre os dois renames, o
  atlas velho autodenuncia a folha nova e o conserto se completa sozinho.
- **A checagem de obsolescência lê cabeçalho, não pixels.** Decodificar todos os
  quadros de cada bloco a cada leitura de catálogo era regressão medida; ler o
  cabeçalho de três arquivos por bloco custa uma fração disso.
- **Duas correções de custo entraram junto:** a estimativa da animação ignorava o
  `frame_count`, e o orçamento do endpoint é `largura × altura × frame_count`;
  e o catálogo sobrescrevia a geometria gravada no ramo da textura.
- **O custo desta decisão é um laço que acorda mais.** Um mapa com um bloco
  animado desenha 8 vezes por segundo enquanto estiver aberto. É o preço de
  desenhar o que foi comprado, e ele é proporcional ao número de blocos animados
  **em cena**, não ao catálogo.

## Armadilhas e o que NÃO foi verificado

- **Nada aqui foi medido em quadros por segundo.** Não há baseline de desempenho
  neste repositório. O que está medido é o número de decodificações e de escritas,
  não o custo em milissegundos de desenhar.
- **O ganho de tempo da checagem por cabeçalho é uma ordem de grandeza observada
  numa máquina só**, não um benchmark: leia como "deixou de decodificar os
  quadros", não como número.
- **A fração de leituras que pegavam PNG truncado** foi observada num teste de
  concorrência sintético. Ela depende de disco e de agendamento e **não se
  reproduz igual em outra máquina**.
- **Só duas folhas legadas existem em disco**, e as duas foram conferidas. Uma
  terceira forma de folha errada que ninguém tenha visto cairia no caminho de
  degradação para o quadro parado — que é o comportamento seguro, mas silencioso
  para quem não lê o log.

## Referências

- [`ADR 0032`](0032-textura-animada-unica-abandono-3d.md) — uma textura animada por bloco; esta ADR é o desenho dela
- [`ADR 0039`](0039-sprite-unica-sobre-tres-faces.md) — o UV canto-a-canto em que o quadro é amostrado
- [`ADR 0040`](0040-zoom-continuo-e-desenho-sob-demanda.md) — o laço único que para sozinho, que esta ADR condiciona sem revogar
- [`ADR 0012`](0012-guard-de-orcamento-informativo.md) — o guard, cuja estimativa de animação foi corrigida junto
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/3d/block-animation.ts` — a aritmética, pura e testada
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/3d/cube3d.ts` — a textura da folha e o `offset.x`
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/3d/scene3d.ts` — o laço, e o shadow map que a animação não invalida
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/world-block.ts` — o re-empacotamento por conteúdo

**Última atualização:** 2026-08-05
