# ADR 0017 — Um nome só: `isometric-maker` no repositório, na pasta e nos pacotes

> **Quick Start (TL;DR)**
>
> A [ADR 0011](0011-repo-isometric-maker-pasta-power-abuse.md) mantinha a pasta local com o nome antigo enquanto o repositório já era `isometric-maker`. Isso acabou: repositório, pasta e escopo npm passam a ser o mesmo nome, e o nome anterior é purgado de todos os caminhos e escopos — **inclusive dentro das ADRs congeladas**, porque um caminho de sistema de arquivos não é uma decisão.
>
> ```bash
> grep -rn "Projects/power-abuse\|@power-abuse/" /home/ondokai/Projects/isometric-maker/   # tem que sair vazio
> ```

**Status:** aceita · **Data:** 2026-07-30
**Substitui:** ADR 0011

## Contexto

A [ADR 0011](0011-repo-isometric-maker-pasta-power-abuse.md) foi escrita horas antes desta. Ela renomeou o repositório no GitHub para `isometric-maker` e **deliberadamente manteve a pasta local** com o nome antigo, porque quatro worktrees dependiam dele e porque dezenas de caminhos absolutos apontavam para lá. O ganho de alinhar era estético; o custo era uma varredura em três árvores com risco de quebrar o caminho do spec vendorizado.

Duas coisas mudaram, e ambas empurram na direção oposta.

**O número de worktrees caiu de quatro para duas.** As worktrees das branches de conhecimento foram removidas quando elas foram mescladas. Sobraram a principal e a de replanejamento — e o `git worktree repair` conserta exatamente esse vínculo, num comando.

**E o custo real foi medido, não estimado:** 89 linhas em 31 arquivos. É uma substituição de duas expressões — `Projects/power-abuse` e `@power-abuse/` — nenhuma delas ambígua.

Contra isso pesava a razão pela qual a 0011 existia: a divergência é o tipo de coisa que um agente futuro "conserta" por reflexo e quebra tudo. Só que essa proteção custava três avisos redundantes escritos em três documentos, e cada um deles era uma explicação de por que o repositório está desalinhado consigo mesmo. **O usuário decidiu que não quer mais o nome anterior.** Alinhar remove a divergência *e* os três avisos que existiam para defendê-la.

## Decisão

**Repositório, pasta local e escopo npm passam a ser `isometric-maker`.**

- `/home/ondokai/Projects/power-abuse/` → `/home/ondokai/Projects/isometric-maker/`
- `/home/ondokai/Projects/power-abuse.worktrees/` → `/home/ondokai/Projects/isometric-maker.worktrees/`
- `@power-abuse/*` → `@isometric-maker/*` nos três `package.json` e nos três `package-lock.json`
- Todo caminho absoluto em documentação, skill, README e comentário

O vínculo das worktrees é reparado com `git worktree repair` a partir do repositório principal, depois da renomeação.

### A parte que precisa ser autorizada explicitamente

**As ADRs congeladas também continham esses caminhos, e foram alteradas.** Isso parece ferir a regra de que ADR não se edita, e não fere — mas a distinção precisa estar escrita, porque sem ela vira precedente para editar qualquer coisa:

> A regra protege **a decisão**: o contexto, as alternativas rejeitadas, o raciocínio, a data. Um caminho de sistema de arquivos não é nada disso — é o endereço de um arquivo, e um endereço que aponta para o nada não preserva registro nenhum, apenas apodrece.

Nenhuma frase de decisão, nenhuma alternativa e nenhuma consequência foi tocada em ADR alguma. A substituição foi mecânica e limitada às duas expressões acima, verificável no `git diff`.

**O que não muda:** o arquivo `0011-repo-isometric-maker-pasta-power-abuse.md` **mantém o nome**. Ele nomeia a decisão que esta ADR desfaz, e renomeá-lo apagaria justamente o registro de que a divergência existiu. É o único lugar do repositório onde o nome anterior sobrevive, e deve continuar assim.

## Alternativas consideradas

**Manter a 0011 e conviver com a divergência.** Era a decisão vigente e tinha um argumento real. Rejeitada porque o custo que a sustentava — quatro worktrees, varredura arriscada — caiu pela metade, e porque manter um repositório desalinhado consigo mesmo exige explicar isso em três documentos, para sempre.

**Alinhar os caminhos mas deixar as ADRs com os caminhos antigos.** Rejeitada: produziria 40 caminhos mortos dentro justamente dos documentos que este repositório trata como fonte de verdade, e o verificador de links isenta `docs/adr/`, então nada apontaria o apodrecimento.

**Tornar os caminhos relativos, eliminando o problema de vez.** Rejeitada porque a convenção 3 exige caminho absoluto, e ela existe por um motivo que continua válido: um caminho relativo copiado para outro contexto mente em silêncio.

## Consequências

- **A varredura de caminho deixa de ser proibida e passa a ser correta.** As três seções que mandavam *não* alinhar os nomes — em `AGENTS.md`, em `docs/00-produto/visao.md` e no `README.md` — foram reescritas. Um agente futuro não encontra mais uma regra dizendo para preservar a divergência.
- **Quem tiver o repositório clonado ou aberto precisa reabrir**: o caminho da pasta mudou. Nenhum histórico é reescrito e nenhum commit muda de sha por causa disto.
- **O hash de 31 arquivos mudou**, o que torna obsoletas as citações de proveniência que apontam para eles. Citação com hash velho é **aviso**, não erro — mas aviso silencioso é como uma skill passa a atestar texto que mudou. Todas foram revalidadas nesta mesma onda.
- **O `skip` de `/home/` em `scripts/check-docs.sh` continua funcionando**, porque casa o prefixo e não o nome do projeto. Nenhuma mudança foi necessária lá.
- Esta ADR estabelece um precedente estreito e explícito: **migração mecânica de caminho é permitida em arquivo congelado; edição de conteúdo de decisão não é.** Qualquer coisa além disso exige ADR nova.

## Referências

- [`ADR 0011`](0011-repo-isometric-maker-pasta-power-abuse.md) — a decisão que esta substitui, e o registro de que a divergência existiu
- [`ADR 0010`](0010-pivo-para-editor-isometrico.md) — o pivô que criou o nome novo, e o mecanismo `**Substitui:**`
- `/home/ondokai/Projects/isometric-maker/AGENTS.md` — a seção "Nome do repositório e caminhos", reescrita

**Não verificado:** se alguma ferramenta externa à máquina — atalho, script pessoal, entrada de editor — guarda o caminho antigo. O `git worktree repair` cobre apenas o que o git conhece.

**Última atualização:** 2026-07-30
