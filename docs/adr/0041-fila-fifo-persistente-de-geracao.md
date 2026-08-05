# ADR 0041 — A fila de geração é FIFO, persistente, e o job carrega um descritor serializável

> **Quick Start (TL;DR)**
>
> O registro de jobs do servidor era um `Map` em memória alimentado por
> `spawn(key, label, work)`: **sem ordem, sem payload e sem disco**. Um reinício
> do Vite — que acontece ao salvar qualquer `server/*.ts` (ADR 0023) — perdia
> tudo e deixava células presas em `'gerando'` para sempre. Agora existe uma
> fila: array com `seq` monótono **persistido**, um **descritor serializável**
> por tipo de job, escrita atômica em disco, e o status `'na-fila'` — que já
> existia no modelo e já era renderizado pela UI — finalmente ganha quem o
> escreva.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && node --test server/job-queue.test.ts server/api-queue.test.ts
> ```

**Status:** aceita · **Data:** 2026-08-05

## Contexto

`server/api.ts` tinha uma função só para disparar trabalho pago:
`spawn(key, label, work)` gravava `{status: 'gerando'}` num `Map` volátil e
disparava `void (async () => {})()` na hora. Sete rotas usavam isso — a face sul
do wizard, a edição dela, as 8 direções, a bancada de sprites, o bloco do mundo,
a peça de guarda-roupa e a pose. Três defeitos saem daí, e nenhum é cosmético:

**1. Não havia admissão.** Seis poses viravam seis submissões simultâneas, cada
uma sondando oito direções — 48 requisições concorrentes contra um teto de conta
que rende 429. O único lugar do produto que reconhecia o limite era
`server/sprite-lab.ts`, que trava `outputs` em 1–4 com a mensagem
*"Acima de 4 a v3 responde 429 Concurrency limit reached"*.

**2. O job não sabia o que rodar.** Só o closure sabia, e o closure morre com o
processo. Não havia como redespachar nada a partir do disco, porque o disco não
tinha o pedido — tinha, no máximo, o status.

**3. O registro era volátil.** A [ADR 0023](0023-caminho-de-volta-ao-artefato-pago.md)
já havia registrado que editar `tools/character-builder/server/*.ts` reinicia o
Vite (o `vite.config.ts` importa `server/api.ts`) e mata geração em voo. O que
ela não fechou foi o rastro: sem registro em disco, a célula ficava `'gerando'`
para sempre e a tela mentia até alguém apagar o `studio.json` na mão.

E havia um encaixe pronto que ninguém usava. `CellStatus`
(`/home/ondokai/Projects/isometric-maker/tools/character-builder/server/model.ts`)
declara `'na-fila'` desde sempre, e **quatro módulos da UI já o renderizavam** —
`app/screens/poses/cell-view.tsx`, `app/screens/poses/generate-button.tsx`,
`app/screens/itens/item-state.ts` e `app/screens/wizard/wizard-progress.ts`.
Nenhum código escrevia esse valor. O estado existia na tela e não existia no
servidor.

## Decisão

**1. O estado da fila é um ARRAY com `seq` monótono persistido.** É o `seq` que
define o FIFO — não a ordem de iteração de objeto, que o V8 reordena para chaves
numéricas, e não o relógio, que empata e anda para trás. Na leitura do disco,
`nextSeq` nunca regride: um arquivo truncado que o deixasse para trás faria dois
jobs nascerem com o mesmo número e o FIFO viraria empate não determinístico.

**2. O job carrega um descritor serializável.** É o defeito 2 fechado de frente:
sobreviver a um reinício exige saber **o que** rodar, não só o status.

| Rota | Descritor | O que ele guarda |
|---|---|---|
| `POST /api/wizard/south` | `wizard-south` | id do personagem, prompt, referência de cor |
| `POST /api/wizard/south/edit` | `wizard-south-edit` | id do personagem, prompt da edição |
| `POST /api/wizard/directions8` | `wizard-directions8` | id do personagem |
| `POST /api/sprite-lab` | `sprite-lab` | hash + a config inteira |
| `POST /api/world-block` | `world-block` | hash + a config inteira |
| `POST /api/generate` (peça) | `wardrobe` | id do personagem, id da peça |
| `POST /api/generate` (pose) | `pose` | id do personagem, id da pose |

A regra por trás da tabela: **id de entidade do estúdio, nunca o objeto inteiro**
— o `studio.json` é a fonte da verdade e pode ter mudado entre o enfileiramento e
a execução. As duas bancadas não têm entidade no estúdio, então para elas a
config **é** o pedido e vai junto.

**3. O estado vai a disco por escrita atômica, e não pelo helper do pipeline.**
`writeFileAtomic` (`tools/pixellab-pipeline/src/util.ts`) monta o nome temporário
com `pid` + milissegundo; duas escritas do mesmo processo no mesmo milissegundo
colidem no mesmo caminho. A fila usa `randomBytes(6)` mais `rename`. O caminho do
arquivo sai de `CHARACTER_BUILDER_JOB_QUEUE_JSON`, com o mesmo idioma de costura
de teste que `CHARACTER_BUILDER_STUDIO_JSON` e `CHARACTER_BUILDER_ASSETS_DIR` já
seguiam.

**4. `'na-fila'` passa a ser escrito.** `JobStatus` é `CellStatus` mais dois
estados que só existem do lado do servidor (`'cancelado'` e `'interrompido'`, este
último decidido na [ADR 0043](0043-retomada-sem-repagar-e-o-estado-interrompido.md)),
e `cellStatusFor` faz a tradução num ponto só.

**5. O módulo é PURO.** Nada acontece ao importar, nenhum cliente real é criado, o
executor entra por injeção, e nenhuma célula do `studio.json` é escrita por ele —
a fiação com o estúdio mora em `server/api.ts`. É o que permite testar dinheiro
sem rede.

**6. `stillNeeded` é obrigatório, e avaliado na DRENAGEM.** Um job parado dez
minutos na fila pode ter virado redundante — a célula ficou `'pronto'`, o hash
apareceu em disco. O default anterior seria `() => true`, isto é, "sempre execute",
que é a direção do gasto: num módulo que gasta dinheiro real, a omissão tem de
doer no compilador e não na fatura.

**7. A abertura é preguiçosa e a promessa é guardada.** `JobQueue.open` lê disco,
reconcilia o que um reinício deixou pela metade e volta a drenar — trabalho que
não pode acontecer só porque alguém importou `api.ts` (um `npm run typecheck` não
pode disparar retomada de job pago). Guardar a promessa garante **uma** fila; e a
promessa **rejeitada** é esquecida, porque enquanto ela ficava no cache um soluço
de disco derrubava a tela até alguém reiniciar o Vite.

**8. Reuso do pipeline, não reimplementação.** `WeightedSemaphore`,
`AdaptiveLimiter` e `TIER_CONCURRENCY` vêm de `tools/pixellab-pipeline`. O limitador
existe para que um 429 desacelere a **fila inteira**, não só o job que tomou o
erro: sem isso, N workers retentando em paralelo mantêm a conta permanentemente
limitada.

**9. `429` e `529` são a única classe retentável.** Recusa explícita, custo zero.
Retentar 5xx desfaria, uma camada acima, a decisão deliberada do cliente HTTP
(*"the request may have been processed and billed but the response was lost"*).
O pior caso foi reproduzido em teste: submissão **aceita**, só o poll caindo com
500, três gerações pagas por um clique.

**10. Cancelamento real por `AbortController`.** Inclui trabalho já em execução.

## Alternativas consideradas

**Manter o `Map` e só ordenar as chaves.** Resolve a ordem e não resolve nada
mais: sem descritor não há redespacho, e sem disco o reinício continua apagando o
registro. Ordem era o menor dos três defeitos.

**Guardar o closure serializado.** Não existe forma honesta de serializar uma
função com o ambiente dela. O descritor é a mesma ideia com a fronteira no lugar
certo — dado, não código.

**Usar o `seq` do relógio.** `Date.now()` empata sob rajada (dois cliques no
mesmo milissegundo) e pode andar para trás. Contador monótono persistido não tem
nenhum dos dois problemas.

## Consequências

- **Um reinício do Vite deixa de apagar o registro.** O que ele ainda não faz
  sozinho é retomar — ver [ADR 0043](0043-retomada-sem-repagar-e-o-estado-interrompido.md).
- **A tela ganha um estado que já sabia desenhar.** Nenhum componente novo: os
  quatro módulos que já tratavam `'na-fila'` passaram a receber o valor.
- **Um bug real do `WeightedSemaphore` do pipeline ficou exposto e travado por
  teste:** `acquire(peso)` fica esperando para sempre quando o peso pedido passa
  da capacidade. Isso é carga estrutural aqui, porque existiam pesos maiores que
  o teto — a fila clampa o peso no teto e loga a admissão solitária.
- **Cancelar não cancela igual em todo lugar.** `pose` e `wardrobe` repassam o
  `signal` ao `submit` e a cada `pollJob`. Nos outros cinco ramos, cujos módulos
  geradores estão fora do escopo desta decisão, cancelar **relabela o job e o
  executor segue até o fim** — está documentado na rota, e é dívida declarada,
  não comportamento pretendido.
- **A idempotência é rechecada duas vezes**, no enfileiramento e na drenagem, e
  isso é de propósito: entre as duas há tempo suficiente para o artefato aparecer.
- **O custo desta decisão é um arquivo a mais para corromper.** `job-queue.json`
  passa a ser estado do servidor que sobrevive ao processo; um arquivo editado à
  mão com status desconhecido produz job **invisível** — fora de `pending()`,
  fora de `running()`, nunca drenado e nunca podado. O conjunto fechado de status
  na leitura existe por causa disso, e o comportamento é conservador de propósito:
  um job invisível não gasta.

## O que continua não verificado

- **O teto de admissão não é medição.** O número e o que ele mede estão na
  [ADR 0042](0042-teto-de-concorrencia-mede-chamadas.md), com as duas
  aproximações declaradas lá.
- **Nada aqui foi medido em tempo de parede.** Não existe baseline de desempenho
  neste repositório e esta ADR não cria um. O que está medido é o número de
  executores em voo, contado em teste.
- **A fila não foi exercitada contra a API real sob rajada.** Todos os números de
  admissão vêm de executores dublados; o comportamento do fornecedor sob oito
  chamadas concorrentes **não foi verificado**.

## Referências

- [`ADR 0012`](0012-guard-de-orcamento-informativo.md) — o guard informa e nunca recusa
- [`ADR 0023`](0023-caminho-de-volta-ao-artefato-pago.md) — o caminho de volta ao artefato pago, e o reinício do Vite que motivou esta fila
- [`ADR 0042`](0042-teto-de-concorrencia-mede-chamadas.md) — o que o teto de admissão mede
- [`ADR 0043`](0043-retomada-sem-repagar-e-o-estado-interrompido.md) — o que a fila faz com o que um reinício deixou pela metade
- [`ADR 0044`](0044-bloqueio-do-wizard-por-escopo.md) — quem o estado `'na-fila'` bloqueia na tela
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/job-queue.ts` — a fila, pura e testada
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/api.ts` — as sete rotas e a fiação com o estúdio
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/model.ts` — `CellStatus`, onde `'na-fila'` já morava
- [`README.md`](../../README.md) — as variáveis de ambiente, incluindo `CHARACTER_BUILDER_JOB_QUEUE_JSON`

**Última atualização:** 2026-08-05
