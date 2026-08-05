# ADR 0042 — O teto de concorrência da fila mede CHAMADAS simultâneas, não custo de servidor

> **Quick Start (TL;DR)**
>
> O peso de admissão da fila vinha de `COST_TABLE[...].concurrencyWeight`, uma
> coluna calibrada para o CLI do pipeline — onde um item do catálogo é **uma**
> chamada e o peso expressa "quanto de servidor esta chamada consome". Aplicada a
> jobs do editor, ela fazia **todo peso maior que 1 saturar o teto sozinho**: a
> fila da [ADR 0041](0041-fila-fifo-persistente-de-geracao.md) entregaria menos
> simultaneidade que o servidor sem limite nenhum que ela substitui. O peso passa
> a ser o **pico de chamadas simultâneas** que o job faz à API, e o teto default
> passa de 4 para 8. O 8 é **inferência declarada, não medição**.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && node --test server/job-queue.test.ts
> ```

**Status:** aceita · **Data:** 2026-08-05

## Contexto

O semáforo da fila é ponderado, e o peso decidia quantos jobs entram juntos. A
primeira versão foi buscar esse peso onde já havia um: a coluna
`concurrencyWeight` da `COST_TABLE`
(`/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/src/cost.ts`).

Aquela coluna está certa para o que ela foi feita. No CLI do pipeline, um item do
catálogo vira **uma** chamada, e o peso diz quanto daquela chamada é caro:
`create-character-pro` pesa 6 porque custa 20–40 gerações. É um modelo de **custo
de servidor por chamada**.

O editor não tem essa forma. Um job do editor pode ser **quatro** chamadas —
`server/sprite-lab.ts` dispara um `Promise.all` sobre `outputs` candidatos, cada
um um `POST /create-character-v3`. E o semáforo contava jobs enquanto a PixelLab
conta chamadas. As duas consequências erravam na mesma direção, a de estrangular:

- `wardrobe` pesava 6 num teto de 4. Clampado, rodava **sempre sozinho**, mesmo
  fazendo uma única chamada.
- `sprite-lab` pesava 3 num teto de 4: **um por vez**, fizesse ele 1 ou 4
  chamadas. O `outputs` que o usuário escolhia não mudava nada na admissão.

Isso é regressão medida, não percebida: os números do "antes" desta ADR saem de
rodar a mesma fila com o peso antigo, não de constante escrita à mão.

## Decisão

**1. Peso de admissão = pico de CHAMADAS SIMULTÂNEAS que o job faz à API.**
Como o descritor carrega a config (ADR 0041), onde o fan-out é conhecido o peso é
função dele:

| Descritor | Peso | De onde sai o número |
|---|---|---|
| `sprite-lab` | `config.outputs`, clampado em 1–4 | `Promise.all` sobre `outputs` candidatos, cada um um `POST /create-character-v3` |
| `world-block` | 3 na técnica `chained`, 1 nas outras | `chained` faz a face norte sozinha e as três irmãs num `Promise.all`; `texture` e `rotated` são seriais |
| `pose` | 1 | uma submissão `POST /animate-character` |
| `wardrobe` | 1 | uma submissão `POST /create-character-state` |
| `wizard-south` | 1 | uma submissão |
| `wizard-south-edit` | 1 | uma submissão |
| `wizard-directions8` | 1 | uma submissão `POST /create-character-v3` |

O peso nunca é zero: descritor desconhecido, ou config adulterada, vale 1.

**2. O teto default é 8, e a precedência é declarada:**

1. `CHARACTER_BUILDER_JOB_CONCURRENCY` — inteiro ≥ 1, override direto.
2. `PIXELLAB_TIER` — `free` | `t1` | `t2` | `t3`, a mesma variável que o CLI do
   pipeline já lê, resolvida por `TIER_CONCURRENCY` (1 / 2 / 4 / 20).
3. `DEFAULT_CONCURRENCY` = 8.

Note o efeito que parece errado e está certo: **declarar `PIXELLAB_TIER=t2`
DIMINUI o teto para 4**. É o número da conta contra o palpite do editor, e o
número da conta ganha. A fila também publica de **onde** o teto veio
(`concurrencySource`), porque "4 simultâneas" significa coisas diferentes quando é
palpite e quando é declaração do usuário.

**3. O peso é clampado no teto, e a admissão solitária é logada.** Sem o clamp,
`WeightedSemaphore.acquire(4)` sob `PIXELLAB_TIER=free` (teto 1) esperaria para
sempre. Com ele, o job roda sozinho — e passa do limite da conta, o que é
consciente: o alternativo é travar a fila.

**4. Errar para CIMA é o lado barato, e é por isso que 8 é aceitável.** Um 429 na
submissão custa **US$ 0,00**: a chamada foi recusada, nada foi gerado, nada foi
cobrado — o dinheiro só sai numa submissão aceita. O 429 é classificado como
`rate-limited`, o job volta para a fila (ele não está `paid`) e o `AdaptiveLimiter`
corta a taxa da fila inteira pela metade. Admitir demais custa lentidão e uma
retentativa; admitir de menos custou exatamente a reclamação que originou esta
decisão.

## O que é medido, o que é do fornecedor e o que é inferência

Esta separação é a parte importante da ADR, e ela é desconfortável de propósito.

**MEDIDO — uma observação só, desta conta, gravada no código.**
`server/sprite-lab.ts` trava `outputs` em 1–4 com a mensagem *"Acima de 4 a v3
responde 429 Concurrency limit reached"*. Ou seja: quatro `POST /create-character-v3`
concorrentes passam, cinco não. É o **único** número medido que este repositório
tem, e ele fala de um endpoint — o mais pesado de todos.

**DOCUMENTADO PELO FORNECEDOR, e não aplicável a nós sem confirmação.** O tier de
US$ 50/mês declara "até 20 jobs simultâneos". Sobre o resto,
[`custos-e-limites.md`](../01-pixellab/custos-e-limites.md) é explícito: *"a
concorrência dos tiers menores não está documentada e precisa ser medida"*. Os
valores `free: 1, t1: 2, t2: 4` de `TIER_CONCURRENCY` são **modelo do projeto**,
não número lido do fornecedor. **Em qual tier esta conta está não foi verificado.**

**INFERIDO — é daqui que sai o 8.** Dobrar a medição da família mais pesada para
uma carga **mista**. O job típico do editor não é `create-character-v3`: é
`animate-character` em `mode='template'` (uma geração por direção, [ADR 0006](0006-animacao-em-template-mode.md))
ou `create-isometric-tile`. Admitir oito chamadas de trabalho leve onde quatro de
trabalho pesado passaram é **aposta deliberada**. Que 8 seja também o tamanho do
lote natural do editor — as oito direções, as oito poses que o usuário dispara de
uma vez — é conveniência, não evidência.

## Os números observados

Medidos contando executores em voo, nos dois modelos de peso, no mesmo cenário.
O braço "antes" roda a fila com o peso antigo, então ele muda junto se a
`COST_TABLE` do pipeline mudar.

| Cenário | Antes (teto 4, peso da `COST_TABLE`) | Depois (teto 8, peso = chamadas) |
|---|---|---|
| 8 poses | 2 | **8** |
| 1 guarda-roupa + 4 poses | 1 | **5** |
| 8 bancadas `sprite-lab` com `outputs: 1` | 1 | **8** |
| 8 bancadas `sprite-lab` com `outputs: 2` | 1 | **4** |
| 2 bancadas `sprite-lab` com `outputs: 4` | 1 | **2** |
| 4 blocos de mundo `chained` | 2 | **2** |

A última linha é a honesta: **não melhorou, e o motivo mudou.** Antes eram 2 por
acidente de tabela (`create-isometric-tile` pesava 2 num teto de 4). Agora são 2
porque cada bloco `chained` já dispara três `POST /create-isometric-tile` em
paralelo dentro de si — dois blocos são 6 chamadas concorrentes, já acima das 4
que são a única evidência medida. Admitir os quatro seriam 12, e isso seria
inventar folga que ninguém mediu.

## Alternativas consideradas

**Contar jobs do servidor da PixelLab em vez de submissões nossas.** Uma
submissão de `animate-character` cria um background job **por direção** (até
oito), e o servidor faz um poll por direção em paralelo. Se o teto da conta contar
jobs do servidor, oito poses concorrentes são 64 jobs. Rejeitada porque a única
evidência medida fala em submissões, e porque adotar esse modelo entregaria
**menos** simultaneidade que o servidor sem limite nenhum que a fila substitui.

**Manter `concurrencyWeight` e só subir o teto.** Não resolve o defeito de forma:
com `wardrobe` pesando 6, subir o teto para 8 continuaria admitindo um
guarda-roupa mais nada de peso 3. O problema era a unidade, não a escala.

**Medir o limite real da conta antes de decidir.** É a coisa certa a fazer e
custa dinheiro — medir onde o 429 começa exige submeter até ele começar. A decisão
foi declarar a inferência e deixar as variáveis de ambiente mandarem, em vez de
gastar para descobrir um número que o usuário pode simplesmente declarar.

## Armadilhas e o que NÃO foi verificado

- **`pose` pode valer muito mais que 1, e não temos como saber.** Se o teto da
  conta contar jobs do servidor, o erro é de **até 8×** para menos. O sintoma é
  429 com o limitador derrubando a taxa da fila — e não custa dinheiro, porque
  submissão recusada não gera nada.
- **`sprite-lab` e `world-block` contam o pico, não o instante.** Um candidato já
  em disco resolve sem chamada, então um job de peso 4 pode fazer zero chamadas.
  O erro é superestimar em até o peso inteiro, o que só desperdiça vaga.
- **O 8 não foi medido.** Está escrito acima em três lugares porque é o fato mais
  fácil de citar errado depois.
- **Nenhuma destas medições tocou a API.** São executores dublados contados em
  teste; o que o fornecedor faz sob oito chamadas concorrentes continua
  desconhecido.
- **`ENDPOINT_BY_KIND` continua exportado e não é mais a fonte do peso.** Hoje o
  único consumidor é o teste, que reconstrói com ele o modelo antigo para a coluna
  "antes" da tabela acima. Se a comparação sair do teste, o export sai junto.

## Referências

- [`ADR 0041`](0041-fila-fifo-persistente-de-geracao.md) — a fila cujo teto esta ADR calibra
- [`ADR 0012`](0012-guard-de-orcamento-informativo.md) — o guard informa e nunca recusa; nada aqui recusa nada
- [`ADR 0006`](0006-animacao-em-template-mode.md) — `mode='template'`, que é o que torna a carga do editor leve
- [`custos-e-limites.md`](../01-pixellab/custos-e-limites.md) — o preço estimado por endpoint e a frase sobre a concorrência não documentada
- [`modelo-assincrono.md`](../01-pixellab/modelo-assincrono.md) — 429, 529 e o que é retentável
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/job-queue.ts` — `weightForDescriptor`, `resolveConcurrencyDecision`, `DEFAULT_CONCURRENCY`
- `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/src/cost.ts` — `COST_TABLE` e `TIER_CONCURRENCY`, o modelo do projeto
- [`README.md`](../../README.md) — `PIXELLAB_TIER` e `CHARACTER_BUILDER_JOB_CONCURRENCY`

**Última atualização:** 2026-08-05
