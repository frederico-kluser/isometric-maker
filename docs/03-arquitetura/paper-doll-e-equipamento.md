# Paper-doll: equipamento visível em 8 direções

> **Quick Start (TL;DR)**
>
> **A API do PixelLab não resolve isso.** Não existe primitiva de equipamento entre personagens, e o `transfer-outfit-v2` é limitado a **3 frames por job** acima de 80px. Todo jogo 2D que faz paper-doll de verdade resolve fora do gerador, e os três mecanismos que funcionam estão abaixo.

## O problema

"Equipamento define a classe" exige que o outro jogador **veja** o que você está vestindo. Em 8 direções, isso significa que cada peça precisa existir em 8 ângulos, e que a ordem de desenho muda conforme a direção — o braço passa na frente do corpo virado para um lado e atrás virado para o outro.

E há o problema combinatório: 400 peças × N corpos × 8 direções × M animações não é uma matriz que se gere por força bruta.

## O que a API oferece, e onde para

| Caminho | O que faz | Limite |
|---|---|---|
| `create-character-state` | Aplica uma edição de texto nas 8 rotações do personagem e salva como personagem **novo**, ligado ao original por um `group_id` de primeira classe. Tem `use_color_palette_from_reference` contra deriva de cor | Gera um personagem **inteiro vestido**, não uma camada. Custa 20–40 gerações |
| `transfer-outfit-v2` | Transfere a aparência de uma referência para frames de animação | **Máximo 3 frames por job acima de 80px.** Uma caminhada de 8 direções × 8 frames a 96px precisaria de ~22 jobs |
| — | **Não existe** endpoint de equipamento entre personagens | — |

Conclusão operacional: o `create-character-state` é excelente para **variantes completas** — e é o que o Sprite Studio usa —, mas não produz a camada separada que um paper-doll de runtime precisa.

## As três soluções que jogos reais usam

Todas verificadas em fonte primária. As três são transplantáveis para o nosso cliente PixiJS.

### 1. Ultima Online / ClassicUO — reordenar **um** slot por direção

O achado que economiza trabalho: eles não reordenam a pilha inteira. Reordenam **exatamente um slot** conforme a direção — a capa.

- virado **de costas** para o observador → a capa vai por **cima** de tudo
- virado **de frente** → a capa vai **atrás** do corpo
- nas demais direções → logo **abaixo do elmo**

Todo o resto da pilha tem z fixo. É a solução mais barata das três, e sugere que a ordem por direção é um problema muito menor do que parece: quase sempre é um único slot que precisa mudar.

### 2. LPC — assar a oclusão em `fg/` e `bg/`

O Liberated Pixel Cup não reordena em tempo de execução. Ele **pré-divide cada peça** em duas folhas: `fg/` (o que fica na frente do corpo) e `bg/` (o que fica atrás), cada uma com z fixo.

A oclusão por direção fica assada no asset em vez de resolvida no renderer. Custa mais espaço em disco e mais trabalho de autoria; em troca, o renderer é trivial e nunca erra.

**E o LPC também prova que o custo combinatório é inevitável:** 87% das suas 768 definições de item apontam para pastas compartilhadas por tipo de corpo, e um item que omite um tipo de corpo é **irrenderizável** nele. Não há truque — só compartilhamento de silhueta.

### 3. Tibia / OTClient — máscara com recolorização

Guarda **2 camadas em disco** e expande em memória para o corpo base mais **4 recolorizações do mesmo template de máscara**: cabeça, corpo, pernas, pés.

É o mais econômico em disco e o que gera mais variedade por asset — mas amarra o visual a um esquema de 4 regiões recoloríveis, o que é uma decisão estética forte, não neutra.

## A consequência para Ferro e Cinzas

**Uma peça gerada é reutilizável apenas entre personagens que compartilham a mesma silhueta base.** Isso não é limitação da nossa ferramenta, é o que o maior projeto aberto de paper-doll demonstra na prática.

Por isso o Sprite Studio modela `silhouette` como campo de primeira classe em `Character` e em `WardrobeItem`, e **recusa** aplicar uma peça a um corpo de silhueta diferente — antes de gastar. O tipo tem quatro valores: `humano-medio`, `humano-corpulento`, `humano-esguio`, `quadrupede`.

O caminho recomendado, em ordem:

1. **Poucas silhuetas.** Cada silhueta nova multiplica o catálogo de peças. Duas ou três humanas é o teto razoável.
2. **Para o jogo, comece por variantes completas** via `create-character-state`. É o que a API faz bem, e cobre "equipamento define a classe" sem renderer de camadas.
3. **Migre para camadas quando o número de combinações justificar** — e quando migrar, siga o LPC: asse `fg`/`bg` no pipeline em vez de reordenar em runtime, e reserve a reordenação dinâmica para o punhado de slots que realmente precisa dela, como a capa da Ultima Online.

## O que não foi verificado

- Se existe formato/convenção padrão de spritesheet em camadas fora do LPC.
- O comportamento exato de `transfer-outfit-v2` abaixo de 80px.
- Como Stardew Valley e RPG Maker resolvem oclusão por direção — apareceram na pesquisa mas não sobreviveram à verificação adversarial.

## Referências

- `api.pixellab.ai/v2/openapi.json` — `create-character-state` (`group_id`, `use_color_palette_from_reference`), `transfer-outfit-v2` (limite de frames); spec vendorizado, capturado 2026-07-29
- Universal-LPC-Spritesheet — a divisão `fg/`/`bg/` e o aliasing de tipo de corpo
- ClassicUO — a regra de reordenação da capa por direção
- OTClient — as 2 camadas em disco e as 4 regiões recoloríveis
- [`/home/ondokai/Projects/ferro-e-cinzas/tools/sprite-studio/README.md`](../../tools/sprite-studio/README.md) — a ferramenta que implementa a restrição de silhueta

**Última atualização:** 2026-07-30
