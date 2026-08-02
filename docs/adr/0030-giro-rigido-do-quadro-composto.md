# ADR 0030 — O giro é do quadro composto: dois snapshots sob a mesma afim, nunca peça por peça

> **Quick Start (TL;DR)**
>
> O giro de câmera deixa de interpolar a posição de cada bloco e passa a girar o **quadro
> composto inteiro** como corpo rígido: a vista de origem e a de destino são fotografadas em
> `RenderTexture` e as duas recebem a **mesma** transformação afim
> (`L(τ) = P ∘ R(τ) ∘ P⁻¹`, o squash–rotate–unsquash do plano do chão), com cross-fade.
> Tween, duração de 280 ms, caminho curto e cursor desligado continuam os da ADR 0026.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/packages/iso-core && node --test src/rotation-rigid.test.ts
> ```

**Status:** aceita · **Data:** 2026-08-01
**Substitui:** ADR 0026

## Contexto

A [ADR 0026](0026-giro-de-camera-animado.md) animou o giro interpolando a **posição**: a
coordenada de grid rotaciona por um ângulo contínuo, é projetada pela fórmula única, e a face
troca por cross-fade por bloco. A matemática está certa — e é por isso que a tela fica errada.
No meio do giro, `P ∘ R(θ)` comprime e estica o reticulado projetado, mas cada sprite mantém o
próprio tamanho: o espaçamento muda e o desenho não. Vizinhos abrem fresta, sobrepõem, e a
ordem de profundidade troca bloco a bloco. O usuário descreveu o sintoma com precisão: *"cada
bloco roda individualmente, dá uma leve bugada — o mapa deve rodar"*.

A pesquisa pedida para esta tarefa (como o Doom clássico resolveu rotação) trouxe dois
precedentes verificados e um vazio:

- **Doom (1993), verificado no código-fonte** (`r_things.c`): sprite nunca gira na tela — o
  motor **seleciona** uma das até 8 rotações pré-desenhadas pelo ângulo entre o facing do
  objeto e o vetor observador→objeto, e a projeção faz todo o movimento. Correção honesta: os
  *flats* (chão/teto) **são** reamostrados por ângulo a cada quadro (`r_plane.c`) — "nunca
  reamostra" vale para paredes e sprites, não para o chão.
- **Mode 7 / Contra III, verificado em fontes secundárias**: o cenário composto gira como
  **camada única** enquanto os sprites usam rotações pré-desenhadas. É o padrão desta ADR,
  transplantado.
- **Nenhuma fonte** descreve transição animada em isométrico de sprites puros: SimCity 3000 e
  RollerCoaster Tycoon cortam seco entre 4 vistas; OpenTTD e Age of Empires nem rotacionam;
  quem anima (Final Fantasy Tactics) tem terreno 3D de verdade por baixo. O
  squash–rotate–unsquash não foi encontrado documentado em lugar nenhum — a construção abaixo
  é **derivação deste projeto**, fixada por teste, não convenção externa.

## Decisão

**1. A transição fotografa os dois extremos e transforma os snapshots, nunca as peças.** No
início do giro a cena desenha a vista de origem (como está, pan incluído) e a vista de destino
(já reenquadrada) em duas `RenderTexture`; durante os 280 ms só as duas fotos existem na tela,
sob a mesma família de transformações, com cross-fade (origem opaca embaixo, destino por cima
com o progresso suavizado). No fim, o desenho discreto normal reassume — o último quadro da
transição é, por construção, idêntico ao primeiro quadro parado.

**2. A transformação é a conjugação da rotação pelo achatamento do chão.** Com
`P(x, y) = ((x−y)·A, (x+y)·B)` e `A/B = tileWidth/tileHeight`:

```text
L(τ) = P ∘ R(τ) ∘ P⁻¹ = [ cos φ         −(A/B)·sin φ ]     φ = −τ·π/2
                        [ (B/A)·sin φ    cos φ        ]
```

É o caminho que as posições já percorriam na ADR 0026 — agora aplicado aos **pixels** do quadro
inteiro, que é o que faz o mapa se mover como um corpo só. Nos `τ` inteiros o seno e o cosseno
são cravados em {−1, 0, 1} e a concordância com `rotatePoint` é **exata, por igualdade
estrita** (`/home/ondokai/Projects/isometric-maker/packages/iso-core/src/rotation-rigid.test.ts`).

**3. O que a afim não cobre fica escondido no cross-fade, e isso é declarado.** `L(τ)` é exata
para o plano z = 0. O deslocamento vertical de `z` não comuta com ela no meio do caminho:
paredes inclinam de leve durante a varredura, e a troca de profundidade entre vistas não é
recalculada por bloco — é o fade quem a carrega, como no corte suavizado do Mode 7. Em troca
somem os artefatos de espaçamento e as trocas de profundidade peça a peça, que eram exatamente
a reclamação.

**4. Os snapshots usam filtro `linear`, e só eles.** A varredura reamostra o quadro composto de
qualquer forma; `nearest` sobre afim fracionária vira serrilhado fervilhando, `linear` lê como
borrão de movimento de câmera. Parado, nada disso existe: o desenho volta ao caminho normal,
`nearest`, pixel-perfeito. A regra da ADR 0026 sobrevive com enunciado mais preciso: **a arte
de uma peça nunca é reamostrada isoladamente** — o que se transforma é o quadro composto, uma
vez, durante 280 ms.

**5. O que a ADR 0026 acertou continua.** O tween (`startTween`/`sampleTween`), os 280 ms, a
suavização cúbica, o caminho sempre curto, e o cursor desligado durante o giro (`screenToCell`
lê a rotação discreta) ficam como estavam. O reenquadramento por quadro reduz-se a uma
translação do pivô, interpolada com o mesmo progresso.

## Alternativas descartadas

**Manter a interpolação por posição.** É o estado que motivou a ADR: geometricamente correta e
visualmente errada para sprites que não se deformam junto.

**Corte seco entre vistas.** É o que os isométricos de sprites históricos fazem, e é o que a
ADR 0026 já tinha rejeitado: 90° num quadro se lê como corte de câmera e o usuário perde o
lugar. O pedido explícito foi "a rotação deve ser boa".

**Girar o container da cena ao vivo (sem snapshot).** Rotação rígida de tela pura não leva a
vista A à vista B — a transformação correta é anisotrópica (`L`), e aplicá-la ao container
vivo re-renderizaria e re-ordenaria cada bloco por quadro para nenhum ganho visual sobre a
foto. O snapshot congela a ordenação certa de cada extremo e custa duas texturas.

## Consequências

- **O meio do giro é uma imagem em movimento, não uma cena.** Durante 280 ms não há células,
  profundidade nem oclusão recalculadas — havia, e era o que aparecia como bug. O preço: o que
  estiver fora do viewport no instante da foto não entra no giro (a borda varrida aparece nos
  cantos), e um mapa muito maior que a tela mostra recorte na varredura. Não verificado em mapa
  grande — o enquadramento atual centraliza o conteúdo antes de girar, o que mitiga.
- **Duas `RenderTexture` do tamanho do viewport por giro**, criadas no início e destruídas no
  fim. Pico de memória de GPU proporcional à tela, não ao mapa; o pool de sprites deixa de
  dobrar durante o giro (a ADR 0026 desenhava dois sprites por célula).
- **`rotatePointContinuous` e `continuousDepthKey` ficam sem uso no desenho** — continuam no
  iso-core, testadas, como a matemática de posição que `L` conjugou; remover é decisão para
  quando alguém precisar do espaço.
- **O filtro `linear` do snapshot é escolha estética deste projeto, sem respaldo externo** —
  está numa constante nomeada (`SNAPSHOT_SCALE_MODE`, `scene.ts`) e custa uma linha trocar.
- **A skill `rotating-isometric-camera` guarda a regra antiga** ("interpole a posição,
  cross-fade a face") e precisa de atualização no passo de evolução — feito nesta tarefa.

## Referências

- [`ADR 0026`](0026-giro-de-camera-animado.md) — substituída: tween, duração e cursor ficam; o mecanismo do meio do giro sai
- [`ADR 0021`](0021-rotacao-de-camera-em-quatro-vistas.md) — a rotação discreta como parâmetro de vista, vigente
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/rotation-rigid.ts` — a matriz, a trigonometria cravada e a derivação
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/rotation-rigid.test.ts` — concordância exata, pivô, composição, det = 1
- `/home/ondokai/Projects/isometric-maker/tools/map-builder/src/scene.ts` — snapshots, cross-fade e o ciclo de vida das texturas
- Fabien Sanglard, *Doom Classic renderer review* — paredes por colunas, texturas pré-rotacionadas 90°
- id-Software/DOOM, `linuxdoom-1.10/r_things.c` e `r_plane.c` — seleção de rotação de sprite; flats reamostrados
- *Mode 7* (Wikipedia/espelhos) — fundo composto gira, sprites usam rotações pré-desenhadas (Contra III)

**Última atualização:** 2026-08-01
