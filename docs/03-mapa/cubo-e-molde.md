# O cubo isométrico, o molde e a perspectiva no mapa

> **Quick Start (TL;DR)**
>
> Um cubo de verdade em dimétrica 2:1 tem aresta vertical `d = W·√6/4 ≈ 0,6124·W`. A geometria do projeto é **tile 48×24 px, aresta 29 px, sprite 48×53 px**, definida uma vez em `iso-cube.ts`. O molde desenhado por código abre toda geração de bloco como `init_image` da primeira face; dali, ou o resultado dela vira o molde das outras três (técnica `chained`), ou o v3 a rotaciona para 8 direções (técnica `rotated`) — todo bloco tem as quatro vistas com arte própria ([ADR 0029](../adr/0029-quatro-vistas-molde-encadeado-e-rotate.md)).
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

## O molde, e o encadeamento

`/create-isometric-tile` não tem parâmetro de proporção — só `isometric_tile_shape`, com três degraus descritos como "~15 %, ~25 %, ~50 % da altura do canvas". Medido nos cinco blocos pagos da era uniforme (48×48, `shape='block'`): losango 2:1 nos cinco, aresta vertical **entre 20 e 22 px**, vértice superior entre a linha 2 e a linha 4.

A única alavanca que o endpoint oferece é `init_image` mais `init_image_strength`. Então o molde é a alavanca — e ele é **encadeado**: a face norte nasce do molde cinza, e o **resultado dela** vai como `init_image` (e `color_image`) das faces leste, sul e oeste. É o encadeamento que carrega forma **e** paleta de uma vista para as outras sem pós-processamento.

Na técnica `rotated`, a mesma norte de tile vira `reference_image` do `/create-character-v3`, que a rotaciona para 8 direções — as imagens chegam separadas em `rotation_urls`, e as 4 vistas saem de lá ([ADR 0029](../adr/0029-quatro-vistas-molde-encadeado-e-rotate.md)).

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

### O que NÃO existe mais

O "ajuste ao molde" — a normalização que achava a cintura do losango, transladava para a âncora e completava a base — **foi removido por decisão do usuário**, junto com a referência própria e o modo legado ([ADR 0029](../adr/0029-quatro-vistas-molde-encadeado-e-rotate.md) substitui a [ADR 0025](../adr/0025-molde-como-referencia-de-geracao.md)). Sem alinhamento, o encaixe da arte no grid depende de o modelo honrar o molde; se blocos voltarem a não empilhar, a resposta é regenerar ou reintroduzir alinhamento por ADR nova.

## Iluminação e as quatro vistas

A luz é presa à **câmera**, não ao mundo: topo mais claro, direita intermediária, esquerda mais escura, sempre, nas quatro vistas. Prender a luz ao mundo exigiria quatro artes só para o sombreamento e faria a mesma peça mudar de cor ao girar — o que se lê como bug, não como iluminação.

**Nada de sombra projetada.** Numa cena com câmera girável a sombra teria de girar junto, e sprite pré-renderizado não gira: a sombra apontaria para o lado errado em três das quatro vistas. O volume vem só do degradê das três faces.

O que muda entre as vistas é o **desenho do material**. Cubos procedurais variam isso de graça, mantendo o tom de cada face. Arte gerada tem **sempre quatro vistas distintas** desde a [ADR 0029](../adr/0029-quatro-vistas-molde-encadeado-e-rotate.md) — o modo uniforme, que reusava uma arte nas quatro, foi removido porque anulava exatamente esse efeito de volume.

## Armadilhas e limitações

- **A tabela de materiais é escolha deste projeto**, não convenção herdada. Atrito, densidade e custo de movimento são ponto de partida plausível; só as densidades têm relação com o mundo real.
- **O material de um bloco gerado é adivinhado por palavra-chave na descrição.** Heurística assumida. Quando nada casa, vira pedra.
- **Não foi verificado** que a PixelLab respeite a proporção do `init_image` com fidelidade de pixel. O spec não promete, e não há como saber sem gastar. Sem a normalização, não há mais rede de segurança para isso — o custo dessa remoção está declarado na [ADR 0029](../adr/0029-quatro-vistas-molde-encadeado-e-rotate.md).
- **Não foi verificado** que o `create-character-v3` rotacione bem um cubo (é endpoint de personagem), nem o sentido leste/oeste do mapeamento facing→direção — trocar a constante e rederivar de `v3/` é grátis.
- **A duração e a curva do giro de câmera não têm respaldo externo.** A pesquisa feita para esta tarefa não encontrou nenhuma fonte que sobrevivesse à verificação sobre como jogos isométricos comerciais fazem essa transição. 280 ms e suavização cúbica são escolha nossa.
- **A oclusão continua imperfeita.** Uma cena acíclica de uma vista pode ser cíclica de outra, e o meio do giro é onde isso mais aparece. A restrição de sprite de célula única é o que segura o problema.
- **Projetos salvos antes disto abrem com a geometria antiga**, porque o `project.json` grava o campo `geometria`. O que mudou é o default de projetos novos.

## Referências

- [`ADR 0024`](../adr/0024-cubo-isometrico-canonico.md) — a geometria canônica e a correção do `zStep`
- [`ADR 0029`](../adr/0029-quatro-vistas-molde-encadeado-e-rotate.md) — as quatro vistas, o molde encadeado e a técnica `rotated`
- [`ADR 0026`](../adr/0026-giro-de-camera-animado.md) — o giro animado da câmera
- [`ADR 0027`](../adr/0027-exportacao-v2-instancias-e-materiais.md) — a exportação com instâncias e materiais
- [`ADR 0013`](../adr/0013-geometria-isometrica-64x32-z16.md) — a geometria original, vigente exceto pelos números
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/iso-cube.ts` — a definição e a derivação
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/world-block.ts` — as duas cadeias de geração
- `/home/ondokai/Projects/isometric-maker/tools/map-builder/src/placement.ts` — escala uniforme e âncora declarada

**Última atualização:** 2026-08-01
