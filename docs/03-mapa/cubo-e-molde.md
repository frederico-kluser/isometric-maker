# O cubo isométrico, o molde e a perspectiva no mapa

> **Quick Start (TL;DR)**
>
> Um cubo de verdade em dimétrica 2:1 tem aresta vertical `d = W·√6/4 ≈ 0,6124·W`. A geometria do projeto é **tile 48×24 px, aresta 29 px, sprite 48×53 px**, definida uma vez em `iso-cube.ts`. O molde desenhado por código acompanha toda geração, e a arte que volta é alinhada à âncora canônica antes de virar textura.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/packages/iso-core && npm test
> cd /home/ondokai/Projects/isometric-maker/tools/map-builder && npm test
> curl -s http://localhost:5174/api/block-geometry
> ```

## A conta, do começo

A projeção é a dimétrica 2:1 do gênero:

```text
sx = (x − y) · W/2
sy = (x + y) · H/2 − z · d
```

com `H = W/2`. Ela é uma projeção ortográfica de verdade se as duas linhas da matriz forem ortogonais e de mesmo módulo:

```text
linha_x = ( W/2, −W/2,  0 )
linha_y = ( H/2,  H/2, −d )

linha_x · linha_y = 0                    vale sempre
|linha_x|² = |linha_y|²  ⟹  W²/2 = H²/2 + d²
```

Logo:

```text
d = sqrt((W² − H²) / 2)         forma geral
d = W · √6 / 4 ≈ 0,6124 · W     com H = W/2
altura do sprite = H + d ≈ 1,1124 · W
```

Um sprite de cubo correto é **11,24 % mais alto que quadrado**. Os dois palpites comuns estão ambos errados:

| Palpite | `d` para `W = 48` | Altura real do bloco |
| --- | --- | --- |
| `d = W/2` ("sprite quadrado") | 24 | 81,6 % de um cubo |
| `d = tileHeight/2` (o antigo `zStep`) | 12 | 40,8 % de um cubo |
| **`d = W·√6/4`** | **29,39 → 29** | **100 % (−1,34 % de arredondamento)** |

### Não existe aresta inteira exata

Aresta inteira exigiria `3W²/8` ser quadrado perfeito, o que pede `W = 2m√6` — irracional para todo `m` inteiro. **Nenhuma largura de tile inteira em 2:1 tem aresta vertical inteira.** Arredondar é obrigatório e é inócuo: `d` é uma constante única aplicada igual em todos os níveis, então não há erro acumulado ao empilhar.

### A armadilha do sprite quadrado

Com `d = H`, subir um nível desloca o sprite exatamente o mesmo tanto que recuar uma diagonal `(x−1, y−1)` — e as duas situações caem no **mesmo pixel**. "Em cima" fica indistinguível de "atrás". Com `d = 1,2247·H` isso deixa de acontecer, e há teste que falsifica a volta do problema.

## Os três erros clássicos de perspectiva

Todos os três estavam neste editor, e todos os três se parecem com "a arte está errada".

**1. Escala não uniforme.** A cena desenhava `sprite.width = tileWidth × zoom` e `sprite.height = (tileHeight + zStep) × zoom` sobre uma textura de 48×48: 1,333× na horizontal, 1,0× na vertical. Sobre pixel art isso não é "um pouco esticado" — o losango do topo deixa de ser 2:1, e um losango que não é 2:1 não costura com o vizinho. A escala tem de ser **um número só**.

**2. Âncora inferida do bounding box.** A fórmula de projeção devolve o **vértice superior do losango do topo** — não o canto do sprite, não o centro do losango. A fórmula sozinha nunca diz onde ancorar; a âncora precisa ser declarada. Aqui ela é campo da geometria: `anchorX = W/2`, `anchorY = 0`.

**3. Passo de altura diferente da altura desenhada.** Se a arte tem face lateral de 22 px e o editor sobe 16 px por nível, blocos empilhados se enterram uns nos outros. `zStep` **é** a aresta vertical do cubo, e não pode ser outra coisa.

## O molde

`/create-isometric-tile` não tem parâmetro de proporção — só `isometric_tile_shape`, com três degraus descritos como "~15 %, ~25 %, ~50 % da altura do canvas". Medido nos cinco blocos pagos deste projeto (48×48, `shape='block'`): losango 2:1 nos cinco, aresta vertical **entre 20 e 22 px**, vértice superior entre a linha 2 e a linha 4.

A única alavanca que o endpoint oferece é `init_image` mais `init_image_strength`. Então o molde é a alavanca.

```text
       (24, 0)
       /     \          topo:     losango 48×24
  (0,12)     (48,12)    esquerda: paralelogramo, aresta 29
    |  \     /  |       direita:  espelho da esquerda
    |  (24,24)  |
    |     |     |       sprite: 48×53, bounding box exato do cubo
 (0,41)   |  (48,41)
       \  |  /
       (24,53)
```

Três detalhes que não são detalhe:

- **O molde é acromático.** `init_image` carrega forma **e** cor; um molde colorido faria todo bloco nascer da cor dele.
- **`init_image_strength` tem polaridade invertida em relação ao Stable Diffusion.** Inteiro 1–999, default 300; **maior** significa **menos** ruído, logo mais perto da referência. Quem aplicar a intuição do `denoising_strength` ajusta para o lado errado. O projeto usa 480 — escolha nossa, **não verificada** contra documentação do fornecedor.
- **`style_image` e `style_strength` não existem neste endpoint**, e o schema declara `additionalProperties: false`: mandá-los é rejeição, não silêncio. Eles existem em outros endpoints da mesma API, o que torna fácil supor que existam aqui.

### Referência do usuário

Substitui o molde **só se tiver a mesma proporção** — razão `altura/largura`, tolerância de 2 %, em qualquer tamanho. 96×106 passa (é o molde em dobro); 48×48 não passa. A mesma função valida no navegador e no servidor.

### Alinhamento

A arte que volta é alinhada antes de virar textura:

1. Acha a **cintura** — a primeira linha em que a arte atinge sua largura máxima. É onde ficam os vértices esquerdo e direito do losango do topo, e existe com ou sem enfeite. O bounding box não serve: ele inclui a grama que estoura para cima.
2. Translada para a âncora canônica.
3. Recorta o que cai fora da silhueta. Arte que transborda a célula é sprite multi-célula com outro nome, e sprite multi-célula produz oclusão cíclica.
4. Completa a base das faces laterais quando a arte veio mais baixa que o molde — senão o bloco aparece com uma fatia transparente embaixo, que no mapa se lê como buraco no chão.

Nos cinco blocos pagos deste projeto, o alinhamento deu cobertura de 98,1 % a 99,9 %, deslocamentos de 0 a 4 px e 270 a 410 pixels de base completada.

**Alinhar arte já paga não custa nada e não gera arte nova:** `POST /api/world-block/{hash}/canon` grava em `<hash>/canon/<face>.png` e nunca toca no PNG original.

## Iluminação e as quatro vistas

A luz é presa à **câmera**, não ao mundo: topo mais claro, direita intermediária, esquerda mais escura, sempre, nas quatro vistas. Prender a luz ao mundo exigiria quatro artes só para o sombreamento e faria a mesma peça mudar de cor ao girar — o que se lê como bug, não como iluminação.

**Nada de sombra projetada.** Numa cena com câmera girável a sombra teria de girar junto, e sprite pré-renderizado não gira: a sombra apontaria para o lado errado em três das quatro vistas. O volume vem só do degradê das três faces.

O que muda entre as vistas é o **desenho do material**. Cubos procedurais variam isso de graça, mantendo o tom de cada face. Arte gerada em modo `uniform` tem uma arte só nas quatro vistas — é o que significa uniforme, e é o que faz um bloco custar uma geração em vez de quatro. Quatro vistas realmente distintas exigem o modo `oriented`.

## Armadilhas e limitações

- **A tabela de materiais é escolha deste projeto**, não convenção herdada. Atrito, densidade e custo de movimento são ponto de partida plausível; só as densidades têm relação com o mundo real.
- **O material de um bloco gerado é adivinhado por palavra-chave na descrição.** Heurística assumida. Quando nada casa, vira pedra.
- **Não foi verificado** que a PixelLab respeite a proporção do `init_image` com fidelidade de pixel. O spec não promete, e não há como saber sem gastar. A normalização existe justamente por isso.
- **A duração e a curva do giro de câmera não têm respaldo externo.** A pesquisa feita para esta tarefa não encontrou nenhuma fonte que sobrevivesse à verificação sobre como jogos isométricos comerciais fazem essa transição. 280 ms e suavização cúbica são escolha nossa.
- **A oclusão continua imperfeita.** Uma cena acíclica de uma vista pode ser cíclica de outra, e o meio do giro é onde isso mais aparece. A restrição de sprite de célula única é o que segura o problema.
- **Projetos salvos antes disto abrem com a geometria antiga**, porque o `project.json` grava o campo `geometria`. O que mudou é o default de projetos novos.

## Referências

- [`ADR 0024`](../adr/0024-cubo-isometrico-canonico.md) — a geometria canônica e a correção do `zStep`
- [`ADR 0025`](../adr/0025-molde-como-referencia-de-geracao.md) — o molde como referência de toda geração
- [`ADR 0026`](../adr/0026-giro-de-camera-animado.md) — o giro animado da câmera
- [`ADR 0027`](../adr/0027-exportacao-v2-instancias-e-materiais.md) — a exportação com instâncias e materiais
- [`ADR 0013`](../adr/0013-geometria-isometrica-64x32-z16.md) — a geometria original, vigente exceto pelos números
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/iso-cube.ts` — a definição e a derivação
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/cube-normalize.ts` — o alinhamento
- `/home/ondokai/Projects/isometric-maker/tools/map-builder/src/placement.ts` — escala uniforme e âncora declarada

**Última atualização:** 2026-08-01
