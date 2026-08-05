# ADR 0043 — Retomada sem repagar: o stub em disco, o estado `'interrompido'` e a janela irredutível

> **Quick Start (TL;DR)**
>
> A regra 1 da [ADR 0023](0023-caminho-de-volta-ao-artefato-pago.md) — *toda
> geração paga registra o caminho de volta ao artefato* — valia num ramo só. Nos
> outros seis, uma retomada após reinício **ressubmetia trabalho já comprado**.
> Agora o mecanismo é um **stub em disco ao lado do artefato**
> (`<artefato>.pending.json`), gravado logo depois da submissão e procurado antes
> de submeter; **seis dos sete ramos** retomam de graça. O sétimo, `wizard-south`,
> **não pode** e para num estado terminal novo, `'interrompido'`, que devolve a
> decisão ao usuário. A janela entre a submissão ser aceita e o identificador
> chegar ao disco **continua aberta e está declarada**.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && node --test server/api-queue.test.ts server/world-block.test.ts
> ```

**Status:** aceita · **Data:** 2026-08-05

## Contexto

Com a fila da [ADR 0041](0041-fila-fifo-persistente-de-geracao.md), o registro do
job passou a sobreviver ao reinício do Vite. Isso fechou um buraco e abriu outro,
pior: a reconciliação devolvia todo job `'gerando'` para `'na-fila'` com `paid` e
`remote` intactos, e a fila voltava a drenar. **O executor rodava do zero.**

O comentário da época prometia que "o executor vê `job.paid === true` e re-sonda".
Não havia quem cumprisse a promessa: `dispatch` nunca leu `ctx.job.paid` nem
`ctx.job.remote` em nenhum dos sete ramos. Medido com um `PIXELLAB_SECRET`
presente — a condição normal de uso — a retomada de um job **já pago** mandava um
`POST /animate-character` novo. Como o Vite reinicia sozinho ao salvar qualquer
`server/*.ts` (ADR 0023), isso é uma cobrança por salvamento. Era **regressão**
frente ao `Map` volátil, que apenas *perdia* o job.

Um segundo defeito, mais antigo, só apareceu quando o primeiro foi atacado — ver
"O bug de dinheiro que a correção revelou", abaixo.

## Decisão

**1. O caminho de volta mora em disco, ao lado do artefato.** Um arquivo
`<artefato>.pending.json`, JSON de uma linha, com o mesmo formato que
`server/world-block.ts` já gravava sozinho — o idioma dele virou o módulo
`server/pending-stub.ts`, que os outros ramos passaram a usar. **`world-block.ts`
continua com a implementação própria**, e a escolha foi deliberada: mexer no
único ramo que já funcionava seria arriscar o que estava certo para ganhar
elegância. O formato do arquivo é o mesmo dos dois lados, de propósito — quem for
limpar o disco vê um padrão só. Três gestos, e os três são obrigatórios juntos:

1. **Gravar** o identificador remoto assim que a resposta da submissão chega,
   antes do primeiro poll e antes de qualquer download.
2. **Procurar** esse identificador antes de submeter. Achando, re-sondar:
   `GET /background-jobs/{job_id}` e `GET /characters/{character_id}` não custam
   nada, e uma submissão nova custa a geração inteira de novo.
3. **Descartar** só depois de o artefato estar em disco.

**2. O stub, e não o campo da fila, e a razão é o Sprite Studio.** A fila também
guarda um identificador (`QueuedJob.remote`) e ele continua sendo lido onde
existe. Mas ele é **um objeto plano por job**, e o Sprite Studio tem um
`character_id` **por candidato** — até quatro. Não há onde pôr isso sem mexer na
fila. Duas outras razões seguram a escolha:

- Os módulos geradores são chamados direto pelos próprios testes e não dependem
  da fila para nada; uma retomada que só morasse em `job-queue.json` evaporaria
  fora dela.
- **O caminho do stub deriva do caminho do artefato.** Um pedido diferente escreve
  um artefato diferente e por construção não acha o stub do outro. Onde o caminho
  não identifica o pedido — o wizard grava `south-v3.png` para dois prompts de
  edição diferentes — uma impressão curta do pedido entra no **nome** do stub.
  Um campo plano numa chave de fila estável não tem essa propriedade e poderia
  retomar o id errado, entregando a arte de outro pedido.

**3. Seis dos sete ramos declaram retomada gratuita.**

| Ramo | Grava | Lê antes de submeter |
|---|---|---|
| `world-block` | stub do tile, da animação e do v3 | o stub |
| `sprite-lab` | um stub **por candidato** | o stub do candidato |
| `wizard-directions8` | stub com `character_id` + `background_job_id` | o stub |
| `wizard-south-edit` | stub com `background_job_id` | o stub |
| `pose` | stub com os N `background_job_id` (um por direção) | o stub, e `ctx.job.remote` |
| `wardrobe` | stub com `background_job_id` + `character_id` | o stub, e `ctx.job.remote` |

`pose` e `wardrobe` leem **também** `ctx.job.remote` porque já existem registros
em disco com o identificador na fila e sem stub nenhum: uma leitura a mais só pode
evitar uma submissão.

**4. `wizard-south` continua de fora, e isso é decisão, não pendência.**
`/create-image-bitforge` é síncrono e a resposta declarada no spec vendorizado
(`CreateImageBitforgeResponse`) tem exatamente dois campos: `usage` e `image`.
**Sem identificador de job, sem id de personagem, e sem rota GET que reentregue a
imagem.** Não há o que gravar na submissão, logo não há o que procurar depois. Um
teste existe para impedir que alguém "conserte" isso ligando o ramo.

**5. O estado `'interrompido'` é terminal, e nomeado.** Quando a reconciliação
encontra um job que já invocou o executor e cujo ramo não declara retomada
gratuita, ela **para**:

- Não é `'falhou'`, porque nada falhou. O processo morreu com o job em voo e a
  fila não consegue saber se a submissão chegou a sair. Chamar isso de falha
  convidaria a próxima pessoa a "corrigir" o caminho com uma retentativa.
- É terminal e mapeia para a célula `'falhou'`, que é onde a UI oferece "gerar de
  novo" — o clique deliberado do usuário, que é exatamente a decisão que o
  servidor se recusa a tomar por ele.
- A mensagem em pt-BR é **diferente** para pago e não pago, e nenhuma das duas
  afirma que nada foi gasto.

**6. O sinal é `attempts > 0`.** `attempts` sobe em um ponto só, o único que chama
o executor. `attempts === 0` significa que nada saiu desta máquina e o job é
drenado normalmente, de graça. `startedAt` e `remote` foram considerados e não
servem sozinhos: o primeiro some no caminho de retentativa e o segundo só existe
quando o executor cooperou.

**7. Um job com `paid: true` nunca é retentado nem ressubmetido — só re-sondado.**
E `paid: false` significa **"não consta"**, nunca "é de graça".

## A janela irredutível

Entre a submissão ser aceita e o identificador chegar ao disco existe um intervalo
em que **o dinheiro já saiu e nada foi anotado**. Se o processo morrer aí, a fila
reabre um job cobrado marcado como grátis, e **não tem como saber disso**: nada do
que ela observa distingue "nunca submeteu" de "submeteu e morreu antes de anotar".

A janela é irredutível nesta camada — o identificador só existe **depois** da
resposta, então não há o que gravar antes dela. Gravar o stub na primeira linha
após a submissão encolhe a janela ao mínimo possível; não a elimina. Só uma chave
de idempotência aceita pelo fornecedor fecharia o buraco de verdade, e **o spec
vendorizado não documenta nenhuma**.

É a mesma janela que `world-block` sempre teve. **Dizer que a retomada é gratuita
é aceitar essa janela, não negá-la.** É por isso que a mensagem do caso não-pago
foi reescrita: ela dizia "nada foi gasto ainda", e isso é falso exatamente aí.

## O bug de dinheiro que a correção revelou

`collectJobIds` — a função que lê os identificadores de job de uma resposta —
testava a chave com `/job_id$/i` e descia para dentro do resto. O spec vendorizado
declara, em `CreateCharacterAnimationResponse` (`/animate-character`), o campo
**`background_job_ids`**: array de strings, **obrigatório**, descrito como *"List
of background job IDs (one per direction)"*. Não existe campo singular.

Como `background_job_ids` termina em `ids`, a chave **não casava**; e a varredura,
ao receber o array, visitava strings, que ela ignora. Resultado na resposta real:
**zero ids**. A geração de pose marcava a submissão como paga — correto, o
dinheiro saiu — e morria em seguida com "a API não devolveu nenhum job id", sem
nada anotado para voltar. Era o cenário da ADR 0023 outra vez: cobrado,
irrecuperável.

**Nenhum fixture do repositório modelava a resposta de `/animate-character`** — o
mesmo defeito de suíte que a própria ADR 0023 registrou, num endpoint diferente.
A função passou a aceitar singular **e** plural, e o plural não é defesa
preventiva: é a forma que o spec declara para o endpoint que ela existe para ler.

## Alternativas consideradas

**Deixar a fila re-sondar sozinha.** É a promessa que já existia e não tinha quem
a cumprisse. A fila não sabe o caminho do artefato de nenhum ramo; quem sabe é o
módulo gerador. Por isso a reconciliação **pergunta**, e sem um "sim" explícito
para.

**Marcar tudo como `'falhou'` e deixar a UI oferecer "gerar de novo".** É o que
acontece na prática para `wizard-south`, mas como estado geral apagaria a
distinção entre "quebrou" e "o servidor parou de propósito" — e é essa distinção
que impede a próxima pessoa de adicionar uma retentativa automática.

**Guardar o identificador só na fila.** Rejeitado pelas três razões do item 2:
o Sprite Studio tem um id por candidato, os módulos são chamados fora da fila, e
uma chave de fila estável não isola pedidos diferentes.

## Consequências

- **Cinco ramos deixaram de repagar após um reinício.** O sexto, `world-block`, já
  não repagava — o que ele ganhou foi a fila parando de desfazer isso, e a dívida
  declarada de haver **duas implementações do mesmo formato de stub** em disco.
- **`wizard-south` ainda obriga o usuário a reclicar.** É o preço declarado de um
  endpoint que não devolve identificador nenhum.
- **`markPaid` passou a ser chamado nos sete ramos**, inclusive naquele que não
  sabe retomar: saber que houve cobrança é útil mesmo quando não dá para voltar.
- **Um 429 vindo do POLL depois de uma submissão aceita deixou de virar segunda
  submissão.** Travado por teste dos dois lados: uma submissão no primeiro clique,
  zero submissões novas no reclique que conclui.
- **O registro de um job interrompido não some.** `paid` e `remote` ficam, a poda
  e a limpeza o protegem, e a fila continua enxergando o caminho de volta ao
  artefato que já custou dinheiro.
- **O log de retomada declara a incerteza** em vez de afirmar que nada foi gasto.
  É verborrágico de propósito.
- **Sobra lixo em disco no caminho de erro.** Um stub que não foi descartado é
  relido na próxima execução e leva a uma sondagem gratuita; derrubar o processo
  ali perderia um artefato que já chegou, então a falha ao apagar é engolida.

## O que continua não verificado

- **Que a janela irredutível seja irredutível em qualquer camada.** É a
  expectativa, não uma verificação: o spec vendorizado **não foi consultado sobre
  chave de idempotência** de forma exaustiva, e a ausência de documentação não é
  prova de ausência de suporte.
- **Que os seis ramos retomem contra a API real.** Os testes usam `fetch`
  interceptado e um token falso. O que está verificado é que **nenhuma submissão
  nova sai** no caminho de retomada — não que o fornecedor reentregue o artefato.
- **Quanto tempo o fornecedor guarda um `background_job_id` ou um
  `character_id`.** Se houver expiração, o stub aponta para algo que não existe
  mais e a retomada vira submissão nova. Não há nada no spec vendorizado sobre
  isso, e **não foi medido**.

## Referências

- [`ADR 0023`](0023-caminho-de-volta-ao-artefato-pago.md) — a regra 1, que esta ADR implementa nos ramos que faltavam
- [`ADR 0041`](0041-fila-fifo-persistente-de-geracao.md) — a fila que reconcilia, e o `attempts` que serve de sinal
- [`ADR 0012`](0012-guard-de-orcamento-informativo.md) — o guard informa e nunca recusa
- [`ADR 0019`](0019-create-character-v3-e-o-caminho-do-personagem.md) — por que os pixels da v3 moram em `GET /characters/{character_id}`
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/pending-stub.ts` — os três gestos, e a impressão do pedido
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/api.ts` — a tabela dos sete ramos e a leitura dos ids
- `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/openapi/openapi-v2.json` — `CreateImageBitforgeResponse` e `CreateCharacterAnimationResponse`

**Última atualização:** 2026-08-05
