# ADR 0028 — O manequim é prompt, não `template_id`; e o quadro cheio é pós-processamento

> **Quick Start (TL;DR)**
>
> Escolher "manequim" no seletor de corpo nunca gerou um manequim, e nunca ia gerar: `template_id` escolhe o **esqueleto** que o animador encaixa, não a aparência. E o personagem sai pequeno no centro do quadro porque a `create-character-v3` estufa a moldura ~2x de propósito. As duas coisas se resolvem fora do lugar onde o usuário procurava: uma no prompt da sul, outra depois do download.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && npm run typecheck && npm test
> ```

**Status:** aceita · **Data:** 2026-08-01

## Contexto

Duas queixas chegaram juntas, e a intuição dizia que eram a mesma. São duas causas separadas.

### O seletor de corpo mentia

A UI mostrava um seletor rotulado `Corpo` com a opção `Humano (manequim)`. Quem lê isso conclui —
razoavelmente — que existe um modo manequim. O campo por trás é o `template_id` do
`create-character-v3`, e o spec vendorizado
(`/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/openapi/openapi-v2.json`,
capturado em 2026-08-01) descreve assim:

> "Body type for **skeleton reconstruction**. Picks the 3D template the skeleton estimator fits to
> the generated frames so the character can be animated. Use `mannequin` for bipedal subjects or one
> of `bear`/`cat`/`dog`/`horse`/`lion` for quadrupeds."

O único efeito de `template_id` sobre o desenho está documentado em `/create-character-pro`, e é para
quadrúpedes: "Quadruped templates also append `, on all fours` to the description". Para `mannequin`
não há efeito nenhum. O valor `mannequin` significa "bípede", e nada mais.

A aparência sai inteira do `description` do `/create-image-bitforge`, o passo da face sul. E ali havia
dois campos declarados no spec que este projeto nunca enviou:

- **`negative_description`** — "Text description of what to avoid in the generated image".
- **`coverage_percentage`** — "Percentage of the canvas to cover", 0–100. Existe **só** nesse endpoint.

Sem negativo, "sem roupa" no positivo é um pedido fraco: o modelo desenha roupa porque quase todo
personagem do treino tem roupa. O positivo sozinho não segura.

### A moldura estufada não é bug

O `create-character-v3` documenta: "Final canvas is padded ~2x for animation room (capped at 256)".
Medido nos PNGs já pagos deste repositório:

| Arquivo | Moldura | bbox do sprite | Altura ocupada | Área ocupada |
|---|---|---|---|---|
| `wizard/manequim/south-v0.png` (bitforge, pedido 128) | 128×128 | 107×101 | 79% | 66% |
| `wizard/manequim_directions8_/south-00.png` (v3) | **172×172** | 95×113 | **66%** | 36% |
| `wizard/manequim_directions8_/south-east-00.png` (v3) | 172×172 | 55×115 | 67% | 21% |

Não existe parâmetro para desligar o padding — `image_size` é explicitamente *advisory* em modo
reference ("the model derives output size from the input"). Pedir e torcer não é opção.

## Decisão

**1. O modo manequim é um andaime de prompt, e mora no personagem.**

`Character.mannequin` liga um modo em que o texto do usuário passa a ser tratado como **estilo**: o
corpo vem de uma constante (`server/mannequin-prompt.ts`) e o `negative_description` vem de uma lista
fixa somada ao negativo próprio do personagem. É por personagem e não global, porque o corpo-base é um
manequim e todo personagem derivado dele precisa continuar vestido.

A descrição **efetiva** — estilo mais andaime — é a que fica em `Character.description` e a que segue
para o `description` do `create-character-v3`. Mandar o texto cru ali reintroduziria no giro a roupa
que a sul não tem.

**2. `coverage_percentage` passa a ser enviado, com 92 como padrão do modo manequim.**

92 e não 100: o contorno precisa de um pixel de folga para não encostar na borda, e sprite encostado na
borda perde contorno quando vira atlas. Fora do modo manequim o campo é **omitido** quando não
configurado (F0-09) — ausente é o default da API, e mandar o default muda o `specHash` sem mudar a
arte.

**3. O quadro cheio é recorte pós-download, com uma bbox só para as oito direções.**

`server/frame-fit.ts` decodifica os oito PNGs, calcula a caixa de alfa **unida**, expande para
quadrado, e reamostra tudo com o **mesmo** retângulo para exatamente `lock.size`. A união é o ponto:
recortar cada direção com a bbox própria seria o caminho óbvio e faria o personagem mudar de tamanho a
cada rotação, porque a silhueta de sudeste é metade da largura da de sul.

A reamostragem é nearest-neighbor para o tamanho exato, não escala inteira. Escala inteira preserva
melhor a grade de pixels e não alcança o quadro cheio (recorte de 123 px num alvo de 128 daria fator 1
e deixaria a folga de volta) — e o pedido era preencher.

**4. O PNG pago é copiado para `raw/` antes de o recorte sobrescrever.**

O recorte é destrutivo e a geração já foi cobrada. Uma segunda passada lê de `raw/`, nunca do arquivo
já recortado: sem isso, rodar duas vezes recortaria o recorte e o personagem encolheria a cada
execução.

**5. O rótulo do seletor passa a dizer o que o campo é.**

`Corpo` → `Esqueleto para animação`, com uma nota que aponta para o modo manequim. O rótulo antigo era
a causa raiz da confusão, e um rótulo errado é um defeito como qualquer outro.

## Consequências

**O modo manequim não é idempotente com o texto anterior, de propósito.** Ligar o modo sem mudar o
texto muda o que sai no request, então a geração precisa sair de novo — e sai. A comparação de
idempotência passou a ser sobre a descrição **efetiva**; versões gravadas antes do modo existir não
têm o campo e caem no texto cru, o que preserva o comportamento antigo.

**O recorte nunca derruba uma geração paga.** Se a decodificação falhar, os PNGs originais já estão em
disco e continuam servíveis — o erro vai para o log e o fluxo segue. Perder a arte para salvar o
enquadramento seria o pior negócio possível.

**O recorte usa o decodificador que já existe em `server/png.ts`** (`decodePngToRgba`, trazido pela
0025 junto com o molde do cubo): 8 bits por canal, sem entrelaçamento, tipos de cor 0, 2, 4 e 6.
Paleta levanta erro nomeado e o recorte é abortado sem perder a arte — decodificar errado um PNG
pago produz um sprite corrompido que só aparece na tela. Esta branch chegou a ter um segundo
decodificador (`server/png-decode.ts`), escrito antes de a 0025 entrar em `main`; ele foi apagado no
merge. Duas cópias da mesma regra é como uma delas fica para trás ([ADR 0023](0023-caminho-de-volta-ao-artefato-pago.md)).

**`lock.fitFrames: false` desliga tudo isso** e devolve o comportamento anterior, sem `raw/`.

## O que continua não verificado

- **Nenhuma geração foi feita para validar esta ADR.** Todo número de moldura e de bbox veio de PNGs
  já pagos e medidos localmente; o efeito do `negative_description` e do `coverage_percentage` na arte
  **não foi observado contra a API real**. O que está verificado é que os campos existem no spec, que
  o request os carrega, e que o recorte faz o que promete sobre imagens sintéticas.
- **A cobertura de 92% é escolha, não medição.** Não há amostra que diga qual porcentagem produz o
  melhor enquadramento.
- **O fator de estufamento não é fixo.** O spec diz "~2x"; a medição deu 172 para um pedido de 128
  (1,34x). Como o recorte parte da bbox real e não do fator, isso não afeta o resultado — mas também
  não permite prever o tamanho da moldura antes de gerar.

## Referências

- [`tools/character-builder/server/mannequin-prompt.ts`](../../tools/character-builder/server/mannequin-prompt.ts) — o andaime e a lista de negativos
- [`tools/character-builder/server/frame-fit.ts`](../../tools/character-builder/server/frame-fit.ts) — a bbox unida e a reamostragem
- [`tools/character-builder/server/png.ts`](../../tools/character-builder/server/png.ts) — o decodificador único, `decodePngToRgba`
- [`docs/02-personagem/manequim-e-enquadramento.md`](../02-personagem/manequim-e-enquadramento.md) — o guia de uso
- [ADR 0019](0019-create-character-v3-e-o-caminho-do-personagem.md) — a decisão de usar a v3
- [ADR 0023](0023-caminho-de-volta-ao-artefato-pago.md) — nunca perder o artefato pago, que é o motivo do `raw/`
- [ADR 0012](0012-guard-de-orcamento-informativo.md) — o guard informa e nunca recusa

**Última atualização:** 2026-08-01
