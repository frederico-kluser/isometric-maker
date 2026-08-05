# ADR 0044 — O bloqueio do wizard tem escopo: o dono do job sai do PREFIXO da chave, não da classificação dela

> **Quick Start (TL;DR)**
>
> `StudioState.busy` era **global**: qualquer job, de qualquer personagem, da
> bancada de sprites ou de um bloco do mundo, desabilitava **11 botões** na etapa
> da face sul e 2 na etapa das 8 direções. Gerar um bloco no Laboratório congelava
> o wizard do personagem. O campo deixou de existir — ele era a pergunta errada.
> A pergunta certa não é "algo está gerando?" e sim "**algo que impede ESTA ação**
> está em andamento?", e a resposta sai da **chave** do job, num módulo puro.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && node --test src/app/job-scope.test.ts
> ```

**Status:** aceita · **Data:** 2026-08-05

## Contexto

O estúdio publicava um booleano `busy` derivado de "existe alguma célula em
`'gerando'`", e o wizard inteiro apagava quando ele era verdadeiro. Isso já era
ruim; com a fila FIFO da [ADR 0041](0041-fila-fifo-persistente-de-geracao.md) ficaria
pior, porque os jobs passam a **serializar** — a janela em que algo está
`'gerando'` ou `'na-fila'` cresce, e com ela o tempo de tela congelada por
trabalho que não tem relação nenhuma com o que o usuário está fazendo.

Manter o campo e só filtrar melhor no consumidor não era opção: enquanto o
booleano global existisse, alguém o reintroduziria.

## Decisão

**1. `StudioState.busy` foi removido.** Quem decide bloqueio pergunta pela chave
do job, não por um agregado.

**2. A chave do job já carrega o dono, e a gramática dela é conhecida:**

| Forma da chave | O que é |
|---|---|
| `<personagem>::<pose>` | pose |
| `<personagem>::wardrobe::<peça>` | peça de guarda-roupa |
| `<personagem>::__south__` | wizard, face sul |
| `<personagem>::__directions8__` | wizard, 8 direções |
| `<personagem>::__cardinal-<dir>__`, `<personagem>::__cardinals__` | wizard, dado v2 legado |
| `sprite-lab::<hash>` | bancada de sprites |
| `world-block::<hash>` | bancada de blocos |

As sentinelas do wizard são **derivadas das funções de `server/model.ts`**, não
copiadas como literais. O teste homônimo pega mudança **estrutural** da convenção
(sentinela virar prefixo, outro separador, um segmento a mais) e **não** pega
renome do token — o que é correto: módulo e teste derivam ambos da mesma função e
continuam de acordo, então não há nada para falhar porque nada quebrou.

**3. O dono sai do PREFIXO, não da classificação da chave inteira. Este é o item
que importa.** `sprite-lab::<hash>` tem exatamente a forma de uma chave de célula
`<personagem>::<pose>`. E o id de personagem colidente **é criável**: a rota de
criação faz `id = slug(label)`, com `slug` sendo `toLowerCase()` mais
`[^a-z0-9]+ → '-'`, e o campo de label na UI só valida não-vazio. Um personagem
chamado **"Sprite Lab"** recebe o id `sprite-lab`. A rota de importação copia o
mesmo `slug`.

Com a classificação por precedência de bancada aplicada à chave inteira, **todos
os jobs desse personagem viravam bancada**: o wizard nunca bloqueava, e dava para
disparar um `POST /create-character-v3` pago sobre a face sul que estava sendo
substituída. Por isso a decisão de bloqueio compara
`chave.startsWith(personagem + '::')` — o mesmo teste que o cabeçalho do
personagem já fazia para impedir apagar alguém com job em voo — e só depois
reclassifica o **sufixo** sob um id-sonda.

**4. As duas camadas erram para lados OPOSTOS, de propósito.**

- A leitura da chave sozinha, na dúvida, chama de **bancada**: assim um job de
  bancada nunca vira pose de personagem nenhum, que era o congelamento global que
  motivou o módulo.
- A decisão de bloqueio, que já sabe de quem é o wizard, na dúvida **bloqueia** —
  porque a dúvida ali vale uma geração paga em cima de uma referência trocada.

**O preço, explícito:** para um personagem cujo id seja literalmente `sprite-lab`
ou `world-block`, os jobs da bancada bloqueiam o wizard dele. Isso é espera
indevida num caso de nome colidente; o outro lado era gasto.

**5. Dois motivos de bloqueio, e o segundo é conservador por decisão.**

- **Mesma etapa** é o mutex que não pode ser afrouxado: pedir a face sul duas
  vezes ao mesmo tempo é pagar duas vezes pela mesma imagem.
- **Mesmo personagem** bloqueia qualquer outra etapa, pose ou peça do mesmo
  personagem. A cadeia do wizard é derivativa — as 8 direções nascem da sul ativa,
  e as poses e peças nascem do id remoto que as 8 direções escrevem. Dois
  trabalhos do mesmo personagem em voo produzem arte que já não combina com o
  corpo que a gerou. Errar para o lado de bloquear custa espera; errar para o lado
  de permitir custa geração paga que sai errada.

**6. `'na-fila'` conta como ocupado.** O status novo da fila significa "ainda vai
rodar", não "não vai rodar". Para efeito de bloqueio vale tanto quanto
`'gerando'`; para efeito de **texto na tela** os dois são estados diferentes, e é
por isso que a decisão devolve o status em vez de só um booleano.

**7. A varredura é por chave ordenada, e a mesma-etapa tem precedência.** Duas
telas com o mesmo snapshot mostram a mesma mensagem — ordem de iteração de objeto
não é contrato.

**8. O módulo é puro, sem React.** O repositório não tem jsdom nem
testing-library, e instalar qualquer um dos dois é proibido; o padrão de módulo
puro para lógica de tela já existia em seis lugares.

## Alternativas consideradas

**Perguntar "de quem é este job?" e comparar com o personagem da tela.** É a
forma óbvia, e é exatamente a que quebra no caso do id colidente: a função que lê
a chave sozinha responde "bancada" para `sprite-lab::__south__`, e o wizard de um
personagem chamado "Sprite Lab" ficaria sem mutex. O prefixo é a única leitura que
não depende de adivinhar o sufixo.

**Proibir os ids `sprite-lab` e `world-block` na criação de personagem.** Fecha
esta colisão e nenhuma outra: o namespace das bancadas pode crescer, e a
validação ficaria longe do lugar que depende dela. Além disso quebraria a
importação de pacotes já existentes.

**Bloquear só a mesma etapa.** Mais permissivo e mais barato de implementar. Foi
rejeitado pela cadeia derivativa do item 5 — o resultado é arte paga que não
combina com o corpo.

## Consequências

- **Gerar um bloco do mundo não congela mais o wizard**, nem a bancada de sprites,
  nem o trabalho de outro personagem.
- **A mensagem na tela passou a poder dizer *por que* e *o quê***: o motivo, o
  status e o rótulo do job que segura.
- **Um personagem chamado "Sprite Lab" espera à toa.** Declarado acima; é o lado
  barato do desempate.
- **O bloqueio ficou mais restritivo dentro do mesmo personagem** do que era em
  intenção — antes o congelamento global escondia essa regra, agora ela é
  explícita e visível.
- **Quatro testes fixam o caso do id colidente**, e os quatro falham contra o
  módulo anterior. Sem eles, a "simplificação" de voltar a classificar a chave
  inteira passaria despercebida.

## O que não foi verificado

- **Que 11 e 2 sejam os números exatos de botões afetados hoje.** Foram contados
  nas duas telas do wizard no momento da mudança; a contagem envelhece a cada
  botão novo e **não há verificador que a sustente**.
- **Que a lista de formas de chave esteja completa.** Ela foi levantada dos call
  sites existentes. Uma forma nova que ninguém registre cai no caso "não sei ler",
  que **não bloqueia** — o lado permissivo, e é a única parte deste módulo que
  erra para o lado do gasto.

## Referências

- [`ADR 0041`](0041-fila-fifo-persistente-de-geracao.md) — a fila, e o status `'na-fila'` que passou a existir
- [`ADR 0016`](0016-ui-ptbr-strings-centralizadas.md) — o texto da tela em pt-BR, centralizado
- [`ADR 0019`](0019-create-character-v3-e-o-caminho-do-personagem.md) — a geração paga que o mutex da face sul protege
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/app/job-scope.ts` — a leitura da chave e a decisão de bloqueio
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/model.ts` — as funções de chave de onde as sentinelas são derivadas

**Última atualização:** 2026-08-05
