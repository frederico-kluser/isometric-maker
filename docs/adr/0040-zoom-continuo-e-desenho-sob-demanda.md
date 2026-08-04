# ADR 0040 — Zoom contínuo com âncora no cursor, e um desenho sob demanda que separa mundo de câmera

> **Quick Start (TL;DR)**
>
> O zoom do editor 3D deixou de ser **4 degraus inteiros com throttle de 80 ms**
> e virou **contínuo, amortecido e ancorado no cursor**. O motivo do "lag" não
> era lentidão: `zoom()` mudava a matriz e **não desenhava**, então a tela só
> atualizava no `pointermove` seguinte. Agora há **um laço de quadro só**, que
> coalesce pedidos e **para sozinho**, e o desenho separa "mudou o MUNDO" de
> "mudou a CÂMERA". O shadow map passou a `autoUpdate = false`.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && npm run typecheck && npm test
> ```

**Status:** aprovada · **Data:** 2026-08-04

## Contexto

O usuário relatou lag no zoom. A causa medida não foi desempenho de GPU — foram
quatro defeitos somados, todos no caminho de controle:

1. **O zoom não desenhava.** `s3d.zoom()` chamava `updateProjectionMatrix()` e
   parava aí. O efeito React que desenha não dependia de `zoom`. A tela só
   mudava quando outra coisa mudava — na prática, o `pointermove` seguinte.
2. **Throttle de 80 ms sobre 4 degraus inteiros** (`[1,2,3,4]`). Girar a roda
   três vezes rápido produzia um passo. O passo era aditivo, então era enorme
   perto do mínimo e imperceptível perto do máximo.
3. **Todo movimento de mouse reconstruía o mundo.** `render(state)` varria o
   mapa RLE inteiro, recriava o cubo de preview e recalculava uma
   `EdgesGeometry` para o realce, redimensionava grid e planos, e re-renderizava
   um shadow map de **2048×2048** — a cada evento de ponteiro.
4. **O picking varria o grafo da cena** (`scene.traverse`) a cada `pointermove`,
   e cada leitura virava `setPickState`, reconciliando a árvore React inteira
   mesmo quando o cursor continuava na mesma célula.

A regra de "zoom inteiro" que impedia o zoom fracionário vinha do palco 2D do
PixiJS, removido pela [ADR 0037](0037-editor-3d-apenas.md).

## Decisão

**1. Zoom contínuo, geométrico, amortecido e ancorado no cursor.**

- **Geométrico**: `zoom *= e^(−deltaY·k)`. Cada clique de roda muda a mesma
  *fração*, em qualquer ponto da faixa (0,3 a 12).
- **Amortecido**: o zoom corrente persegue o alvo com `1 − e^(−dt/τ)`, τ = 0,09 s.
  Independente da taxa de quadros — um `lerp` de fator fixo fica lento a 60 Hz e
  nervoso a 144 Hz.
- **Ancorado**: o ponto do mundo sob o cursor não sai do lugar.
  `target₁ = target₀ + (right·nx·halfW + up·ny·halfH)·(1/zoom₀ − 1/zoom₁)`.
- **Sem throttle.** Eventos demais num quadro só deixam o alvo mais longe; nunca
  enfileiram desenhos.
- `deltaMode` é convertido: o Firefox manda `deltaY` em LINHAS, e sem a conversão
  a roda ficaria ~16× mais lenta lá.

**2. Zoom fracionário é permitido.** O motivo do veto era o palco 2D do PixiJS,
onde escala não inteira serrilha pixel art. Aqui a arte é textura sobre
geometria, amostrada com `NearestFilter`: não existe grade de pixels do palco
para desalinhar. O que sobra é cintilar de amostragem em textura muito reduzida —
**o preço declarado** de um zoom fluido.

**3. Dois caminhos de atualização, explicitamente separados.**

| Mudou | Chamada | Custo |
|---|---|---|
| o MUNDO — blocos, preview, realce | `render(state)` | varre o mapa, sincroniza meshes, marca o shadow map |
| a CÂMERA — pan, zoom, giro | `requestDraw()` | um `renderer.render` |

`syncBlocks` sai cedo quando o mapa é o mesmo objeto de antes: o modo teste
chama `render` 60×/s com mapa idêntico.

**4. Um laço de quadro só, que para sozinho.** Zoom amortecido e giro de 280 ms
correm no mesmo `tick`. Pedidos de desenho no mesmo quadro viram **um** desenho.
Sem nada animando e nada pendente, **nenhum rAF é agendado** — render-on-demand
de verdade. O `dt` é limitado a 50 ms, senão voltar de uma aba inativa faria o
amortecimento saltar direto ao alvo.

**5. `shadowMap.autoUpdate = false`.** Como nenhum material da cena é iluminado
(ADR 0039), mover a câmera não muda sombra nenhuma. `needsUpdate = true` é ligado
só quando o mapa muda. A sombra é desenhada por um plano `ShadowMaterial`, que
renderiza **só** a sombra — a opacidade É o escurecimento, sem depender da
fotometria das luzes.

**6. Preview e realce são criados uma vez** e reposicionados; a `EdgesGeometry` é
compartilhada. **A lista de meshes para o raycaster é mantida**, não descoberta
por varredura. **`setPickState` só dispara quando a célula muda** de verdade.

**7. A câmera orbita um ALVO.** Pan move o alvo. Antes, `lookAt(0,0,0)` fixo
jogava a vista de volta à origem a cada giro — o usuário perdia o lugar onde
estava trabalhando, uma vez por giro.

## Consequências

- **O zoom responde ao gesto**, ancorado onde o cursor está, sem degraus e sem
  espera.
- **Girar depois de arrastar mantém o lugar.**
- **Pintar um bloco passou a aparecer.** O sincronizador comparava só a chave da
  célula, então trocar o tipo do bloco no mesmo lugar mantinha o mesh antigo.
  Agora compara o `blockId`.
- **Cubo não recebe sombra.** Material sem iluminação ignora shadow map. A sombra
  cai no chão e nos planos; uma estrutura alta não escurece os blocos sob ela.
  O caminho de volta está documentado na skill `casting-threejs-shadows`: um quad
  `ShadowMaterial` sobre o topo de cada cubo, ao preço de um draw a mais por cubo.
- **Nada disto é medido em FPS.** Não há baseline de desempenho neste repositório,
  e esta ADR não cria um. O que está medido é *o que era feito por evento* — a
  varredura, a realocação e o passe de sombra —, não quantos milissegundos custava.
- **Constantes visuais permanecem não verificadas**: τ do zoom, sensibilidade da
  roda, 280 ms do giro, opacidade da sombra e os dois *bias*. São escolha, e estão
  declaradas como escolha.

## Referências

- [`ADR 0037`](0037-editor-3d-apenas.md) — a remoção do palco 2D, que é o que libera o zoom fracionário
- [`ADR 0039`](0039-sprite-unica-sobre-tres-faces.md) — as faces sem iluminação, que é o que torna o shadow map independente da câmera
- [`ADR 0026`](0026-giro-de-camera-animado.md) — o giro animado de 280 ms
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/3d/controls3d.ts` — passo geométrico, amortecimento, âncora, pan
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/3d/scene3d.ts` — o laço único, `syncBlocks`, o frustum da sombra
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/3d/grid3d.ts` — os quatro planos do chão e o `ShadowMaterial`

**Última atualização:** 2026-08-04
