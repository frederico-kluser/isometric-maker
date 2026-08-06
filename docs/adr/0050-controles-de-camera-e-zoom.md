# ADR 0050 — Controles de câmera expandidos: teclado, toque, pinça, zoom-to-fit, coalescência de roda e amortecimento exponencial

> **Quick Start (TL;DR)**
>
> A [ADR 0040](0040-zoom-continuo-e-desenho-sob-demanda.md) consertou o zoom
> contínuo com âncora no cursor e o laço único que para sozinho. Faltavam os
> controles que um editor de verdade precisa: pan por teclado (setas, 10% do
> viewport por passo), zoom por pinça no trackpad/touch (`setZoomAnchored` com
> zoom absoluto), gestos do Safari (`gesturestart`/`gesturechange`/`gestureend`),
> botão de enquadrar tudo (`zoomToFit`, 8 vértices da bounding box, eixo mais
> restritivo, 10% de margem), coalescência de eventos de roda (delta acumulado
> entre quadros, aplicado uma vez por frame) e normalização de `deltaMode`
> (LINE x17, PAGE x800). Tudo no mesmo laço de quadro que já unificava zoom,
> giro e animação de bloco.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && npm run typecheck && npm test
> ```

**Status:** aprovada · **Data:** 2026-08-06

## Contexto

A [ADR 0040](0040-zoom-continuo-e-desenho-sob-demanda.md) estabeleceu o zoom
contínuo, geométrico, amortecido e ancorado no cursor, com um laço de quadro
único que coalesce pedidos e para sozinho. O que ela entregou foi o **mecanismo**
— a função `zoomStep`, a constante de tempo `tau = 0.09 s`, a âncora que mantém
o ponto sob o cursor parado.

Mas o mecanismo só era acessível por um caminho: a roda do mouse
(`wheelZoom(deltaY, ndcX, ndcY)`). Um editor que só responde à roda é um editor
que não responde ao teclado (acessibilidade), ao trackpad (usuários de laptop),
ao touch (tablets) e à pergunta "cadê meu mapa?" (zoom-to-fit). Cada um desses
caminhos tem uma forma diferente de expressar "mover a câmera", e todos precisam
desaguar no mesmo laço.

## Decisão

**1. Pan por teclado: setas movem 10% do viewport por passo.**

`map-editor-3d.tsx:1114-1137` conecta `ArrowUp`/`ArrowDown`/`ArrowLeft`/
`ArrowRight` ao `pan(dx, dy, viewportW, viewportH)`. O deslocamento é `±0.1 *
viewportSize` por evento `keydown`. Um `keydown` repetido (segurada) dispara na
taxa de repetição do sistema operacional — não há throttle próprio, e o laço
único já coalesce múltiplos pans no mesmo quadro.

**2. Zoom por pinça (trackpad/touch): `setZoomAnchored(newZoom, ndcX, ndcY)`.**

Diferente da roda, que dá um **delta** incremental, a pinça dá um **zoom
absoluto**: a distância entre dois dedos no evento `touchmove` dividida pela
distância inicial (`touchstart`) vezes o zoom no início do gesto. O editor chama
`setZoomAnchored` (`scene3d.ts:156`), que atualiza o `zoomGoal`, move o `target`
com `anchorZoom` e agenda o laço. Um threshold de 5 px de movimento evita zoom
acidental ao tocar a tela (`map-editor-3d.tsx:569-613`).

Quando um gesto de pinça chega, o delta de roda pendente é descartado
(`hasPendingWheel = false`) — a pinça substitui a roda, não compete com ela.

**3. Gestos do Safari: `gesturestart`/`gesturechange`/`gestureend`.**

O Safari em macOS emite eventos de gesto proprietários para o trackpad.
`gesturechange` carrega uma propriedade `scale` (o fator de zoom acumulado desde
`gesturestart`), mas **não** expõe o centro do gesto. O editor trata a escala
como zoom absoluto ancorado no centro da tela (`map-editor-3d.tsx:617-652`).

**4. Zoom-to-fit: 8 vértices da bounding box, eixo mais restritivo, 10% de
margem.**

`zoomToFit` (`controls3d.ts:312-378`) recebe os bounds XZ do mapa, a altura
máxima, o tamanho do viewport, o yaw corrente e uma margem (default `0.1`).

O algoritmo projeta os 8 vértices do paralelepípedo `[minX..maxX] x [0..maxHeight]
x [minZ..maxZ]` no espaço da câmera, calcula a extensão máxima em cada eixo da
tela (right/up), e deriva o zoom pelo eixo mais restritivo: `zoomX = halfW /
extentX` e `zoomY = halfH / extentY`, com `zoom = min(zoomX, zoomY) * (1 -
margin)`. O target é o centro geométrico da caixa.

É isto que o botão "Enquadrar" chama, e também o que a tecla `F` pode disparar
(`map-editor-3d.tsx:668-684`).

**5. Coalescência de delta de roda: acumula entre quadros, aplica uma vez por
frame.**

O problema: N eventos de roda em 16 ms (um quadro a 60 Hz) produzem N chamadas a
`zoomStep` + `anchorZoom`. Se todas usarem o mesmo `camera.zoom` de partida, a
âncora estará errada para todos os eventos depois do primeiro — cada um
calcularia o deslocamento do target como se o zoom ainda fosse o inicial.

A solução (`scene3d.ts:291-294`): `wheelZoom` acumula `deltaY` em
`pendingWheelDeltaY` e guarda o NDC do último evento. O `tick`, uma vez por
frame, aplica o delta acumulado com `zoomStep(zoomGoal, pendingWheelDeltaY)` e
depois zera o acumulador. Um evento, cem eventos — um `zoomStep`, uma `anchorZoom`,
com o zoom corrente correto.

**6. Normalização de `deltaMode`: LINE x17, PAGE x800.**

O Firefox manda `deltaMode = 1` (LINHAS), o Chrome manda `0` (PIXELS), e o
Safari alterna conforme o dispositivo. Sem normalização, a roda no Firefox seria
~17x mais lenta que no Chrome.

`normalizeWheel` (`controls3d.ts:287-291`): `deltaMode === 1` multiplica por 17
(CSS line-height padrão); `deltaMode === 2` multiplica por 800 (viewport típico);
`deltaMode === 0` devolve o valor como está.

**7. Tudo no mesmo laço de quadro.**

A coalescência de roda, o amortecimento do zoom (`approach` com `tau = 0.09 s`),
o giro animado (280 ms, ease-in-out cúbico) e a animação de bloco (8 fps) são
todos processados no mesmo `tick` (`scene3d.ts:318-395`). A ordem dentro do tick
é: coalescência de roda, amortecimento do zoom, giro, animação de bloco, desenho.
Se nada está animando e nada foi pedido, o laço para — `render-on-demand` de
verdade.

## Alternativas consideradas

**Throttle de 80 ms na roda em vez de coalescência por frame.** Rejeitada. Era o
que existia antes da [ADR 0040](0040-zoom-continuo-e-desenho-sob-demanda.md):
girar a roda três vezes rápido produzia um passo só. Throttle descarta
informação; coalescência acumula e aplica junta. O resultado visual é diferente:
com throttle o zoom parece ignorar gestos rápidos; com coalescência ele responde
ao total acumulado no quadro.

**Zoom-to-fit só no plano XZ, ignorando a altura.** Rejeitada. Uma torre de 10
blocos teria a mesma bounding box no plano que um bloco só. Projetar os 8
vértices do volume completo (incluindo `maxHeight`) faz a torre inteira caber na
tela, não só a base.

**`setZoomAnchored` sem descartar o delta de roda pendente.** Rejeitada. Um
usuário girando a roda enquanto faz pinça produziria dois comandos de zoom
concorrentes no mesmo frame — o amortecimento tentaria perseguir dois alvos
diferentes. Descartar o delta pendente quando chega um zoom absoluto resolve a
disputa: o último gesto ganha.

## Consequências

- **O editor responde a teclado, mouse, trackpad e touch.** Arrow keys para pan;
  roda para zoom incremental; pinça para zoom absoluto; gestos do Safari para
  trackpad; botão/tecla para enquadrar tudo.
- **O zoom-to-fit encontra o mapa mesmo depois de um pan muito longo.** O alvo
  vai para o centro geométrico do conteúdo, não para a origem.
- **A coalescência de roda elimina o "lag" de múltiplos eventos no mesmo
  quadro.** O delta acumulado é aplicado com a âncora no zoom corrente correto,
  não no zoom do primeiro evento.
- **`normalizeWheel` conserta o Firefox sem afetar o Chrome.** O valor `17` é a
  altura de linha CSS padrão; o `800` é a altura típica de viewport. Ambos são
  escolhas declaradas, não derivadas de especificação.
- **Nenhum novo `rAF` foi criado.** Tudo consome o laço único que já existia.
- **As constantes permanecem não verificadas por estudo de usabilidade.**
  `tau = 0.09 s`, o passo de 10% do viewport para pan por teclado, a margem de
  10% do zoom-to-fit, o threshold de 5 px da pinça — todos são valores que
  ficaram bons no uso, não foram medidos com usuários.

## O que NÃO foi verificado

- **O gesto do Safari com `scale` acumulado ao longo de vários eventos.**
  `gesturechange` dispara múltiplas vezes durante um gesto, e cada evento carrega
  a escala **acumulada** desde `gesturestart`. Se `setZoomAnchored` for chamado
  com a escala acumulada a cada evento, o zoom dá saltos — porque a escala já
  inclui o delta dos eventos anteriores. **Não foi medido** no Safari real.
- **Zoom-to-fit com mapa muito alongado (ex: 100x1).** O eixo mais restritivo
  pode produzir um zoom que deixa a dimensão longa cortada ou a dimensão curta
  minúscula. A margem de 10% é aplicada depois do `min(zoomX, zoomY)`, não antes
  — um mapa 100:1 teria 10% de margem no eixo curto e zero no longo.

## Referências

- [`ADR 0040`](0040-zoom-continuo-e-desenho-sob-demanda.md) — zoom contínuo, amortecido, ancorado, laço único
- [`ADR 0047`](0047-renderizador-unico-threejs.md) — um renderizador só; o zoom fracionário é permitido porque o palco 2D não existe mais
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/3d/controls3d.ts` — `zoomToFit`, `normalizeWheel`, `approach`, `ZOOM_SMOOTHING_TAU`, `anchorZoom`, `panTarget`
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/3d/scene3d.ts` — `tick`, `wheelZoom`, `setZoomAnchored`, `zoomToFit`, coalescência (`pendingWheelDeltaY`)
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/3d/map-editor-3d.tsx` — keyDown (setas), touch (pinça), gesture (Safari), botão enquadrar

**Última atualização:** 2026-08-06
