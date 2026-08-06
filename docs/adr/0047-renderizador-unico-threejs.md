# ADR 0047 — Um renderizador só: Three.js no editor e no runtime

> **Quick Start (TL;DR)**
>
> O PixiJS saiu do repositório **inteiro**, em 2026-08-05. O `tools/runtime` —
> o último consumidor — foi reescrito em Three.js; `tools/pixi-reference` foi
> apagado com os tipos vendorizados e as 26 skills oficiais; onze skills-ponte
> e três verificadores foram removidos; o empacotador de atlas continua
> emitindo **TexturePacker JSON Hash**, que nunca foi formato de renderizador
> nenhum. Um verificador novo impede a volta.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker && bash scripts/check-no-pixi.sh --self-test
> cd /home/ondokai/Projects/isometric-maker && bash scripts/check-no-pixi.sh
> cd /home/ondokai/Projects/isometric-maker/tools/runtime && npm run typecheck
> ```

**Status:** aprovada · **Data:** 2026-08-05
**Substitui:** ADR 0001, ADR 0009, ADR 0014

## Contexto

Três ADRs escolheram o PixiJS e uma quarta começou a desfazer a escolha:

- a [0001](0001-pixijs-em-vez-de-cocos.md) o escolheu contra a pesquisa própria,
  que apontava Cocos Creator;
- a [0009](0009-conhecimento-pixijs-vendorizado.md) vendorizou os tipos e as 26
  skills oficiais para as skills do repo **citarem** em vez de lembrar;
- a [0014](0014-pixijs-para-o-editor.md) confirmou a escolha, agora contra o
  argumento oposto;
- a [0037](0037-editor-3d-apenas.md) tirou o PixiJS do editor de mapa, que virou
  Three.js, e **deixou-o vivo** em dois lugares: o runtime do jogo exportado e o
  vendor de conhecimento.

O que sobrou dessa meia-remoção foi o pior arranjo possível: **duas respostas
para "como se desenha aqui"**. O editor mostrava cubos com sombra projetada e
câmera ortográfica; o runtime mostrava losangos 2D coloridos, um objeto de cena
por célula, sem colisão contra o mapa (ele chamava `step`, que não recebe mapa).
O mesmo projeto, aberto no editor e no jogo, era dois mundos diferentes.

O custo do arranjo não era teórico. `tools/pixi-reference` carregava 47.533
linhas de declarações de tipo e 26 skills que ninguém mais consultava; três
verificadores do portão (`check-pixi-pin.mjs`, `check-pixi-claims.mjs`,
`vendor-types.mjs --check`) existiam para manter íntegro um vendor cujo único
consumidor era ele mesmo — e o primeiro deles estava **quebrado desde a 0037**,
porque uma das três fontes do pino tinha deixado de existir. Onze skills
descreviam um renderizador que o produto já não usava para desenhar o mapa.

E havia o pedido concreto que forçou a mão: sombra nos cubos, física de colisão,
muitos cubos texturizados desenhados rápido, zoom melhor. Todo item dessa lista
mora no lado 3D. Nenhum tem resposta do lado 2D.

## Decisão

**1. O PixiJS sai inteiro.** Não há mais dependência `pixi.js` em nenhum
`package.json`, nem import em nenhum arquivo de código.

**2. O runtime foi reescrito em Three.js.** `tools/runtime/src/render.ts` é uma
cena Three.js com a mesma câmera do editor (ortográfica, yaw 45°, elevação 30°),
os mesmos cubos, a mesma luz que só projeta e o mesmo `ShadowMaterial` no chão.
Três mudanças de fundo vieram junto:

- **Um `InstancedMesh`, um draw call.** Antes era um `Graphics` por célula: um
  mapa de 20 mil células custava 20 mil objetos de cena. Agora a cor por célula
  vai no `instanceColor` e o mapa inteiro é um desenho só.
- **Células cercadas nos seis lados não viram instância.** Num mapa maciço isso
  corta a maior parte do trabalho, e o corte é exato.
- **O personagem colide com os cubos.** `main.ts` chama `stepWithMap` com um
  `CollisionMap` construído do próprio mapa do projeto, em vez de `step`, que
  não tem mapa — e por isso deixava o personagem atravessar parede e andar sobre
  o vazio.

**3. `collision-map.ts` mudou de casa.** Ele estava em
`tools/character-builder/src/map/`, e o runtime não pode importar de `tools/`
(a fronteira da F4-03). Foi movido para `packages/iso-core/src/collision-map.ts`,
que é de onde os dois consumidores o leem hoje.

**4. O atlas continua igual, com outro nome nos tipos.** O `.json` que o
`pixellab-pipeline` emite sempre foi **TexturePacker JSON Hash** — um formato de
dados que nenhum renderizador é dono. Os tipos `PixiFrame`/`PixiSpritesheet`
viraram `AtlasFrame`/`AtlasSheet`, e o trecho de código de exemplo passou a
mostrar o leitor que existe: `tools/runtime/src/atlas.ts`, ~80 linhas que
devolvem uma `THREE.Texture` por quadro, com `repeat`/`offset` sobre uma imagem
compartilhada. **Nenhum byte do formato mudou** — os atlas já gerados continuam
válidos.

**5. Onze skills e três verificadores foram apagados.** A sub-router
`routing-pixijs-work` e as dez skills-ponte; `check-pixi-claims.mjs`,
`pixi-index.mjs`, `inspect-pixi.mjs`, `scripts/check-pixi-pin.mjs` e o vendor
inteiro. Três assuntos sobreviveram ao renderizador e mudaram de skill em vez de
morrer: o contrato de atlas de duas partes, o relógio de desenho separado do
relógio de lógica, e o que medir para saber se está lento.

**6. Um verificador novo impede a volta.** `scripts/check-no-pixi.sh` falha se a
dependência, um import, ou uma menção em documentação **viva** reaparecer. Ele
tem autoteste (`--self-test`), que fabrica uma violação e confere que ela é
detectada — sem isso, um verificador que nunca reprova passa por verde.

`docs/adr/` inteiro é **isento** dessa varredura, e isso é decisão, não
descuido: ADR não se edita, e são justamente as ADRs que registram por que o
PixiJS entrou e por que saiu. Um verificador que obrigasse a apagar o nome
apagaria junto a resposta para "por que Three.js?". `PLANO-DE-EXECUCAO.md` e
`ERROS-*.md` são isentos pelo mesmo motivo: são registros datados.

## Alternativas consideradas

**Manter o runtime em PixiJS e só melhorar o editor.** É o estado que existia, e
é o que produziu o desencontro entre o que o editor mostra e o que o jogo mostra.
O runtime não é uma ferramenta secundária: ele é onde o usuário vê se o mapa que
montou funciona. Dois renderizadores significam que essa pergunta tem duas
respostas.

**Trocar por Babylon.js ou PlayCanvas.** Ambos são engines completas e
competentes, e ambos substituiriam os dois lados de uma vez. Foram recusados
pela mesma razão: o editor 3D **já existe**, em Three.js, com sombra, picking,
giro de câmera animado, zoom amortecido, animação de bloco e desenho sob demanda
— milhares de linhas testadas. Trocar a engine do lado que funciona para unificar
com o lado que não funciona é migrar na direção errada. Three.js também não é
concorrente do que se pedia em desempenho: `InstancedMesh` e `BatchedMesh`
resolvem "muitos cubos" no mesmo motor.

**Manter o vendor de conhecimento "por precaução".** Um vendor de 47.533 linhas
que nenhum código consulta não é precaução, é peso morto que os verificadores
precisam manter íntegro. A regra da [0009](0009-conhecimento-pixijs-vendorizado.md)
— vendorizar as skills que uma biblioteca publica, em vez de reescrevê-las —
continua válida e sem sujeito: o `three` não publica skills de agente.

## Consequências

- **O que o editor mostra e o que o jogo mostra passam a ser a mesma coisa.**
  Mesma câmera, mesmos cubos, mesma sombra, mesma colisão.
- **O portão encolheu e ficou honesto.** Saíram duas etapas (uma delas quebrada
  desde a 0037), entrou uma que reprova de verdade e se autotesta.
- **A árvore encolheu muito**: o vendor, onze skills e onze arquivos de eval.
- **O runtime ganhou uma dependência nova** (`three`) e perdeu outra
  (`pixi.js`). O `@types/three` acompanha, pinado na mesma faixa do editor.
- **Os atlas já gerados continuam válidos.** O formato não mudou; só o nome dos
  tipos em TypeScript e o exemplo de cliente.
- **O runtime ficou sem tela de erro para atlas ausente.** O leitor novo lança
  em `fetch` que falha, e quem chama trata; o comportamento anterior — carregar
  via biblioteca e falhar dentro dela — não era melhor, mas era diferente.
  **Não foi verificado** em um projeto com atlas quebrado.
- **Nada disto foi medido em mapa grande de verdade.** O ganho do
  `InstancedMesh` no runtime é estrutural (um draw call em vez de N objetos),
  mas o número de quadros por segundo com dezenas de milhares de células **não
  foi medido**, e afirmá-lo seria inventar.

## Referências

- [`ADR 0001`](0001-pixijs-em-vez-de-cocos.md) — a escolha original, contra a pesquisa própria
- [`ADR 0009`](0009-conhecimento-pixijs-vendorizado.md) — o vendor de conhecimento, agora sem sujeito
- [`ADR 0014`](0014-pixijs-para-o-editor.md) — a confirmação da escolha
- [`ADR 0037`](0037-editor-3d-apenas.md) — o editor de mapa vira 3D; a remoção pela metade
- [`ADR 0010`](0010-pivo-para-editor-isometrico.md) — o produto é um editor local de usuário único
- [`scripts/check-no-pixi.sh`](../../scripts/check-no-pixi.sh) — o verificador que impede a volta

**Última atualização:** 2026-08-05
