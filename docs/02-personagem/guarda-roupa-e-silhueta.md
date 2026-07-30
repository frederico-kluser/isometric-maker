# Guarda-roupa: peças em 8 direções e a restrição de silhueta

> **Quick Start (TL;DR)**
>
> **A API do PixelLab não resolve isso.** Não existe primitiva de equipamento entre personagens, e o `transfer-outfit-v2` é limitado a **3 frames por job** acima de 80px. Todo jogo 2D que faz paper-doll de verdade resolve fora do gerador, e os três mecanismos que funcionam estão abaixo.
>
> ```bash
> cd /home/ondokai/Projects/power-abuse/tools/sprite-studio && npm run dev
> ```

## O problema

Vestir um personagem em 8 direções significa que cada peça precisa existir em 8 ângulos, e que a ordem de desenho muda conforme a direção — o braço passa na frente do corpo virado para um lado e atrás virado para o outro.

E há o problema combinatório: N peças × M corpos × 8 direções × K animações não é uma matriz que se gere por força bruta.

## O que a API oferece, e onde para

| Caminho | O que faz | Limite |
|---|---|---|
| `create-character-state` | Aplica uma edição de texto nas 8 rotações do personagem e salva como personagem **novo**, ligado ao original por um `group_id` de primeira classe. Tem `use_color_palette_from_reference` contra deriva de cor | Gera um personagem **inteiro vestido**, não uma camada. Custa 20–40 gerações |
| `transfer-outfit-v2` | Transfere a aparência de uma referência para frames de animação | **Máximo 3 frames por job acima de 80px.** Uma caminhada de 8 direções × 8 frames a 96px precisaria de ~22 jobs |
| — | **Não existe** endpoint de equipamento entre personagens | — |

Conclusão operacional: o `create-character-state` é excelente para **variantes completas** — e é o que o Sprite Studio usa —, mas não produz a camada separada que um paper-doll de tempo de execução precisa.

## As três soluções que jogos reais usam

Todas verificadas em fonte primária. As três são transplantáveis para um renderizador PixiJS.

### 1. Ultima Online / ClassicUO — reordenar **um** slot por direção

O achado que economiza trabalho: eles não reordenam a pilha inteira. Reordenam **exatamente um slot** conforme a direção — a capa.

- virado **de costas** para o observador → a capa vai por **cima** de tudo
- virado **de frente** → a capa vai **atrás** do corpo
- nas demais direções → logo **abaixo do elmo**

Todo o resto da pilha tem z fixo. É a solução mais barata das três, e sugere que a ordem por direção é um problema muito menor do que parece: quase sempre é um único slot que precisa mudar.

### 2. LPC — assar a oclusão em `fg/` e `bg/`

O Liberated Pixel Cup não reordena em tempo de execução. Ele **pré-divide cada peça** em duas folhas: `fg/` (o que fica na frente do corpo) e `bg/` (o que fica atrás), cada uma com z fixo.

A oclusão por direção fica assada no asset em vez de resolvida no renderizador. Custa mais espaço em disco e mais trabalho de autoria; em troca, o renderizador é trivial e nunca erra.

**E o LPC também prova que o custo combinatório é inevitável:** 87% das suas 768 definições de item apontam para pastas compartilhadas por tipo de corpo, e um item que omite um tipo de corpo é **irrenderizável** nele. Não há truque — só compartilhamento de silhueta.

### 3. Tibia / OTClient — máscara com recolorização

Guarda **2 camadas em disco** e expande em memória para o corpo base mais **4 recolorizações do mesmo template de máscara**: cabeça, corpo, pernas, pés.

É o mais econômico em disco e o que gera mais variedade por asset — mas amarra o visual a um esquema de 4 regiões recoloríveis, o que é uma decisão estética forte, não neutra.

## A consequência para o editor

**Uma peça gerada é reutilizável apenas entre personagens que compartilham a mesma silhueta base.** Isso não é limitação da nossa ferramenta, é o que o maior projeto aberto de paper-doll demonstra na prática.

E é por isso que a silhueta é uma restrição de **autoria**, não de renderização: o editor tem que recusar a combinação impossível **antes de gastar**, porque depois de gerar já se pagou por uma peça que nunca vai servir em ninguém.

O Sprite Studio já faz isso — modela `silhouette` como campo de primeira classe em `Character` e em `WardrobeItem`, e recusa aplicar uma peça a um corpo de silhueta diferente antes de submeter. O tipo tem quatro valores: `humano-medio`, `humano-corpulento`, `humano-esguio`, `quadrupede`. Nenhum código novo é necessário para honrar esta doc; ela explica por que o código existente está certo.

O caminho recomendado, em ordem:

1. **Poucas silhuetas.** Cada silhueta nova multiplica o catálogo de peças. Duas ou três humanas é o teto razoável.
2. **Comece por variantes completas** via `create-character-state`. É o que a API faz bem, e é o suficiente para um projeto de demonstração.
3. **Migre para camadas quando o número de combinações justificar** — e quando migrar, siga o LPC: asse `fg`/`bg` no pipeline em vez de reordenar em tempo de execução, e reserve a reordenação dinâmica para o punhado de slots que realmente precisa dela, como a capa da Ultima Online.

## O que não foi verificado

- Se existe formato/convenção padrão de spritesheet em camadas fora do LPC.
- O comportamento exato de `transfer-outfit-v2` abaixo de 80px.
- Como Stardew Valley e RPG Maker resolvem oclusão por direção — apareceram na pesquisa mas não sobreviveram à verificação adversarial.
- Como a oclusão por direção se comporta sob perspectiva isométrica com altura, onde o personagem pode estar parcialmente atrás de uma parede além de parcialmente atrás da própria capa.

## Referências

- `api.pixellab.ai/v2/openapi.json` — `create-character-state` (`group_id`, `use_color_palette_from_reference`), `transfer-outfit-v2` (limite de frames); spec vendorizado, capturado 2026-07-29
- Universal-LPC-Spritesheet — a divisão `fg/`/`bg/` e o aliasing de tipo de corpo
- ClassicUO — a regra de reordenação da capa por direção
- OTClient — as 2 camadas em disco e as 4 regiões recoloríveis
- [`/home/ondokai/Projects/power-abuse/tools/sprite-studio/README.md`](../../tools/sprite-studio/README.md) — a ferramenta que implementa a restrição de silhueta

**Última atualização:** 2026-07-30
