# ADR 0019 — `create-character-v3` é o caminho do personagem, e o que isso custa

> **Quick Start (TL;DR)**
>
> O personagem sai de `/create-character-v3` com `view: "low top-down"`. A [ADR 0015](0015-low-top-down-8-direcoes-isometrico.md) tinha proibido esse endpoint por falta do campo `isometric`; o campo `view` cobre a perspectiva, e o código migrou para lá em 2026-07-31 sem que a decisão fosse reescrita. Esta ADR alinha a decisão ao código e registra o que se perdeu no caminho: o mapa `directions`, que congelava arte de referência por direção.
>
> ```bash
> S=/home/ondokai/Projects/isometric-maker/.agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs
> node $S endpoint /create-character-v3
> node $S flow /create-character-v3
> ```

**Status:** aceita · **Data:** 2026-08-01
**Substitui:** ADR 0015

## Contexto

A [ADR 0015](0015-low-top-down-8-direcoes-isometrico.md) decidiu, em 2026-07-30, que o construtor de
personagem usaria `/create-character-with-8-directions` com `mode: "standard"` e `isometric: true`.
Ela colocou `/create-character-v3` explicitamente **fora**, com esta frase:

> `/create-character-v3` está **fora**, apesar de ser o que o estúdio usa hoje: sem `isometric` e sem `directions`.

No dia seguinte, o commit `8153d24` migrou o wizard para `/create-character-v3` e removeu o passo de
cardeais. O commit `b954e4b` construiu o Sprite Studio em cima disso. A decisão registrada e o código
divergiram, e a divergência ficou de pé porque ADR não se edita e ninguém escreveu a sucessora.

Esta ADR existe para fechar essa divergência com os fatos na mão, não para racionalizar o que já foi
feito. Dois dos três argumentos da ADR 0015 se sustentam.

## Os fatos, verificados contra o spec de 2026-08-01

Spec revendorizado nesta data, `sha256 d3ba8342c69a33d2bf3b303c8b89c8805c00a35aed229a8df12410ded33e500f`,
`info.version` ainda `"dev"`.

**O que a ADR 0015 acertou.** `CreateCharacterV3Request` realmente **não tem** o campo `isometric`, e
realmente **não tem** o mapa `directions`. Os dois existem em `CreateCharacterWith8DirectionsRequest`.
Nada disso mudou.

**O que a ADR 0015 não sabia.** `CreateCharacterV3Request` tem `view`, um enum **fechado** de
exatamente `["low top-down", "high top-down", "side"]`, com default `low top-down` — que é
precisamente a perspectiva que a ADR 0015 exige e que a [ADR 0013](0013-geometria-isometrica-64x32-z16.md)
casa com a dimétrica 2:1. A perspectiva não se perdeu; ela chega por outra alavanca.

**O custo não decide nada.** Os dois caminhos custam o mesmo no tamanho que este projeto usa. A
descrição de `/create-character-with-8-directions` diz que `mode: "standard"` custa **1 geração**. A
de `/create-character-v3` publica uma fórmula: `ceil(w × h × 8 / 65536)` gerações em modo referência,
que em 64×64 dá `ceil(32768 / 65536)` = **1 geração para as oito direções**. Preço estimado, como
sempre — a própria PixelLab rotula a coluna como estimativa.

**O que se perde de verdade é o `directions`.** É o único campo que aceita arte de referência por
direção, congelando as fornecidas e gerando as ausentes. Sem ele não há como desenhar as quatro
cardeais à mão e mandar a API preencher as diagonais. A migração pagou esse preço e o wizard removeu
o passo de cardeais em consequência, não por engano.

**O que se ganha é o `template_id`.** String aberta, default `mannequin`, valores documentados
`mannequin`, `bear`, `cat`, `dog`, `horse`, `lion`. O spec descreve o campo como *"picks the 3D
template the skeleton estimator fits to the generated frames so the character can be animated"* e
exige que ele *"must match the body type in `reference_image`"*. É seletor de **esqueleto e tipo de
corpo**, nunca de estilo de arte.

## Decisão

**O personagem sai de `/create-character-v3`, com `view: "low top-down"`.**

As oito direções e a ordem canônica `S, SW, W, NW, N, NE, E, SE` da ADR 0015 continuam valendo, e a
justificativa dela continua correta: num mundo isométrico com Z discreto, oito direções é a
cardinalidade do espaço de movimento, não uma escolha estética.

**A arte de referência por direção deixa de existir como recurso.** Quem quiser controlar uma direção
específica gera o personagem, exporta o quadro e reentra por outro endpoint — não há atalho dentro do
v3.

**`/generate-8-rotations-v3` continua fora**, pelo motivo que a ADR 0015 deu e que segue verdadeiro:
ele não cria `character_id`, e sem isso não há como animar depois.

**`/create-character-pro` continua fora**, por preço: o próprio spec diz *"dynamic — typically 20-40
generations"*.

## Consequências

### O risco que esta decisão assume, e que não foi verificado

A descrição de `/animate-character` diz, textualmente, que ele anima personagens *"previously created
using the create-character-with-4-directions or create-character-with-8-directions endpoints"*, e a
seção **Character Requirements** repete: *"character must have been created with 4 or 8 directions"*.
**`create-character-v3` não é nomeado em nenhum dos dois lugares.**

Ao mesmo tempo, o `template_id` do v3 existe declaradamente para que *"the character can be
animated"*, e `/create-character-v3` devolve `character_id`.

O spec se contradiz, e o estúdio já aposta num dos lados: `tools/character-builder/server/api.ts:340`
chama `animate-character` com o `character_id` que veio do wizard v3. **Isto não foi verificado
contra a API real** — nenhuma chamada paga foi feita. Se a prosa estiver certa e o v3 não for
animável por esse endpoint, o pipeline de personagem quebra depois da geração, com o dinheiro já
gasto. É o maior risco aberto deste repositório e só se fecha gastando uma geração de propósito.

### As armadilhas do v3 que passam a valer para todo mundo

- **`additionalProperties: false`.** O schema é fechado em 11 campos, e só `description` é
  obrigatório. `proportions`, `text_guidance_scale`, `shading`, `init_image` e `style_image` **não
  existem** aqui.
- **O MCP da própria PixelLab mente sobre isso.** Ele expõe um `create_character` com assinatura
  superset — `proportions`, `text_guidance_scale`, `n_directions`, `shading` — mais um `mode` com
  valor `"v3"`, e diz que os quatro são ignorados nesse modo. Agente que ler o MCP conclui que o v3
  aceita `proportions`. Não aceita: ele rejeita.
- **`mannequin` é valor, nunca nome de parâmetro.** É o default de `template_id`.
- **`image_size` é advisory em modo referência.** O próprio schema diz que o modelo deriva o tamanho
  da entrada. Não prometa ao usuário que ele controla o tamanho da saída.
- **O canvas final é inflado ~2×**, com teto de 256. O sprite volta maior do que se pediu, e a âncora
  medida da ADR 0013 depende disso.
- **Contradição interna do spec:** a prosa do endpoint diz que o tamanho de from-scratch vai de 16 a
  256, enquanto `V3OutputImageSize` impõe mínimo 32. Uma requisição de 16×16 é documentada como legal
  e inválida pelo schema ao mesmo tempo. Use 32 como piso.
- **`enhance_prompt` é linha de fatura**, não interruptor grátis: custa 0,05 geração adicional, só
  vale em from-scratch, e combiná-lo com `reference_image` devolve 422. O valor volta em
  `enhance_usage`.
- **É assíncrono e não tem escape.** Não existe campo de espera síncrona. Devolve `background_job_id`
  e `character_id` na hora, com a linha do personagem em `status: "pending"` até os quadros existirem
  **e** o esqueleto 3D ser reconstruído. Poll em `/background-jobs/{job_id}`, cadência documentada de
  5 a 10 segundos, tempo típico de 30 a 60 segundos.

### Sobre o nome

`v3` é **nome de geração de modelo, não versão de API**. Não existe base de versão três: os seis
endpoints com esse sufixo são servidos sob `https://api.pixellab.ai/v2`, o summary do próprio
endpoint diz *"Create character with v3 **model**"*, e uma sonda de rede confirma — qualquer caminho
sob `https://api.pixellab.ai/v3` responde 404, enquanto um POST sem credencial para
`https://api.pixellab.ai/v2/create-character-v3` responde 401, provando que a rota existe e só falta
autenticação. Escrever "migramos para a v3 da API" é errado e leva alguém a procurar uma base que não
existe.

## Referências

- `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/openapi/openapi-v2.json` — `CreateCharacterV3Request`, `CreateCharacterAnimationRequest`, `V3OutputImageSize`
- [`ADR 0015`](0015-low-top-down-8-direcoes-isometrico.md) — a decisão que esta substitui
- [`ADR 0013`](0013-geometria-isometrica-64x32-z16.md) — a geometria que a perspectiva precisa casar
- [`ADR 0006`](0006-animacao-em-template-mode.md) — o modo de animação, que esta decisão não toca

**Não verificado:** se `/animate-character` aceita de fato um `character_id` vindo do
`create-character-v3`; se `view: "low top-down"` produz saída visualmente equivalente ao
`isometric: true` do endpoint de 8 direções; e se a API rejeita campos extras em tempo de execução —
`additionalProperties: false` implica 422, mas nenhuma chamada real foi feita.

**Última atualização:** 2026-08-01
