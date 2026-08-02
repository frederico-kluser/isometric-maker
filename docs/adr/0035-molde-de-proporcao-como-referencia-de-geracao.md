# ADR 0035 — Molde de proporção como referência de geração

> **Quick Start (TL;DR)**
>
> Molde adulto/criança como `init_image` com força 320 — e **não** 500, para a
> fidelidade ao boneco de madeira não trazer a textura da madeira junto com a
> proporção. A referência do usuário passa a `style_image` com força 50, e o
> `negative_description` ganha `MOLD_NEGATIVE`, que nomeia o boneco para o
> modelo evitá-lo. Sem molde, nada muda: a referência volta a `init_image` com
> força 500, o comportamento histórico.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && node --test server/mold.test.ts
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && node --test server/mannequin.test.ts
> ```

**Status:** aceita · **Data:** 2026-08-02

## Contexto

Gerar "adulto" ou "criança" por texto não controla proporção: a descrição
sugere, o modelo decide. O estúdio precisava de um controle geométrico
explícito para o passo da sul (oito direções), e a única alavanca que os
endpoints de personagem oferecem é imagem de referência com força.

Os dois PNGs que estavam na raiz do repositório foram para
`/home/ondokai/Projects/isometric-maker/packages/game-assets/moldes/{adulto,crianca}.png`,
**convertidos para RGBA** — os originais eram colorType 3 (paleta), e o
decodificador de PNG deste repositório só lê os colorTypes 0, 2, 4 e 6.

Medido nos arquivos, quadro de 256×256:

| Molde | caixa opaca | altura | linha de chão |
| --- | --- | --- | --- |
| adulto | x 85–232, y 18–251 | 233 px | y = 251 |
| criança | x 93–226, y 103–251 | 148 px | y = 251 |

Mesma linha de chão, alturas diferentes — é a **única** informação que um
molde carrega, e há teste travando isso. Um molde é geometria da silhueta
dentro do quadro, não aparência.

Pesquisa feita no spec vendorizado em 2026-08-02: o `/create-image-bitforge`
declara **cinco** campos de imagem independentes (`init_image`, `style_image`,
`color_image`, `inpainting_image`, `mask_image`), e o wizard usava dois.
Nenhum endpoint de personagem aceita array de imagens — a divisão de papéis
tem que caber nos campos individuais de uma chamada só.

## Decisão

**1. Com molde selecionado (Adulto ou Criança), os campos se dividem por papel:**

| Campo do `/create-image-bitforge` | O que vai | Força |
| --- | --- | --- |
| `init_image` | o molde — posição e tamanho | `MOLD_INIT_STRENGTH = 320` |
| `style_image` | a referência do usuário — aparência | `REFERENCE_STYLE_STRENGTH = 50` |
| `negative_description` | ganha `MOLD_NEGATIVE` | — |

**2. Força 320, e não 500.** A faixa 400–600 é a de "variação fiel", e
fidelidade a um boneco de madeira traria a **madeira** junto com a proporção.
320 mantém a orientação geométrica e deixa o modelo livre no material.

**3. `MOLD_NEGATIVE` nomeia o boneco.** O negativo diz explicitamente o que é
o manequim de madeira, para o modelo desenhar o personagem **no lugar** do
boneco, não com a aparência dele.

**4. Sem molde, nada muda.** A referência do usuário volta a `init_image` com
força 500 — o comportamento histórico, inalterado. Há teste para os dois
caminhos (com e sem molde).

**5. O seletor tem três opções no passo da sul:** `Nenhum / Adulto / Criança`.

## Alternativas descartadas

**Força 500 para o molde.** Era o primeiro impulso (a faixa "fiel"), mas o
teste prático mostrou o problema: o modelo reproduz o boneco de madeira, e
madeira aparece na proporção que se queria controlar.

**Molde como `style_image`.** `style_image` controla aparência, não
posição/tamanho da silhueta — exatamente o que um molde não quer ensinar. O
papel geométrico exige `init_image`.

**Referência e molde juntos em `init_image`.** O campo é único — não há array.
Como o molde é o dado geométrico, ele é quem ocupa o `init_image`; a
referência (aparência) vai para `style_image`.

## Consequências

- **Proporção controlada:** personagem adulto e criança saem com as alturas
  medidas (233 px e 148 px no quadro de 256), na mesma linha de chão.
- **Risco de artefato do molde em forças altas.** É por isso que a força é
  320 e não 500; se o boneco vazar, o negativo o nomeia e a força é a chave de
  ajuste.
- **Com molde, a referência passa a mandar só em aparência.** Quem usava a
  referência no `init_image` esperando posição/tamanho perde isso quando um
  molde está ativo — sem molde, o comportamento é o histórico.
- **A ADR 0025 não é tocada.** Ela trata do molde do **bloco** (o cubo); esta
  é a primeira decisão sobre molde de **proporção de personagem**, domínio
  novo.
- **O catálogo de skills ganha o fluxo de molde:** `generating-pixellab-characters`
  precisa registrar o papel de cada campo e os dois caminhos testados.

## Referências

- [`ADR 0025`](0025-molde-como-referencia-de-geracao.md) — molde do bloco como referência de geração, vigente (domínio diferente)
- [`ADR 0019`](0019-create-character-v3-e-o-caminho-do-personagem.md) — o caminho do personagem pela v3
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/mold.ts` — `MOLD_INIT_STRENGTH`, `REFERENCE_STYLE_STRENGTH` e `MOLD_NEGATIVE`
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/mannequin.ts` — onde os campos entram no corpo da chamada
- `/home/ondokai/Projects/isometric-maker/packages/game-assets/moldes/` — `adulto.png` e `crianca.png`, RGBA
- `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/openapi/openapi-v2.json` — spec vendorizado, única fonte sobre os endpoints

**Última atualização:** 2026-08-02
