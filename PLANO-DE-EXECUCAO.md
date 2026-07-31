# Plano de execução do isometric-maker — 46 cards, 18 ondas, e o prompt de cada um

> **Quick Start (TL;DR)**
>
> Este é o documento operacional do projeto: a árvore de tarefas, o grafo de dependências, as ondas
> derivadas dele e **um prompt pronto por card**. O `analise-projeto-2026-07-30.html` diz *o que* e
> *por quê*; este diz *em que ordem*, *quem escreve em qual arquivo* e *como se prova que ficou pronto*.
> Comece pelo card `I-01` — ele é o único que precisa de você, de um navegador e de um cartão.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker
> node scripts/validate-plan.mjs          # ainda não existe: é a saída do card F0-01
> bash scripts/gate.sh                    # idem
> cd tools/pixellab-pipeline && npm test  # hoje: 6 testes passam
> ```

O método vem do playbook de modernização com agentes em paralelo, adaptado a um projeto que **não é
um legado**: aqui não há sistema antigo para caracterizar, não há golden master a pinar e não há
troca de tráfego. O que transfere é o resto, que é a maior parte: a árvore de cards, a onda derivada
do grafo, a propriedade de arquivo como eixo de paralelismo, a aceitação falsificável, a revisão
adversarial, o ledger de incerteza e o gate depois de **cada** merge.

**A ressalva honesta, na primeira página:** este projeto nunca renderizou um quadro e nunca gerou um
asset. Toda afirmação sobre custo, payload, ordenação de desenho ou desempenho aqui é **leitura de
spec ou leitura de código**, nunca observação. Onde eu não pude verificar, está escrito
`NÃO VERIFICADO`.

---

## 1. Como ler este documento

### 1.1 Fase não é onda

O `analise-projeto-2026-07-30.html` chama de "ondas" W0–W4 aquilo que, no vocabulário do playbook,
são **fases**: um recorte por ordem de risco. A **onda** é outra coisa — é o nível topológico do
grafo de dependências, e não é escolhida, é calculada:

```text
nivel(c) = 0            se c não tem dependência
nivel(c) = 1 + max(nivel(d))  para toda dependência d
```

As duas convivem, e cada card carrega as duas. As cinco fases herdadas do HTML:

| Fase | Nome | O que ela protege |
| --- | --- | --- |
| `F0` | Fundação | fazer depois custa dinheiro real ou quebra identidade de cache |
| `F1` | Construtor de personagem | o fluxo de arte, endpoint por endpoint |
| `F2` | Construtor de mapa XYZ | a geometria, o modelo de dados e o desenho |
| `F3` | Mecânicas | movimento, colisão, degrau, pulo |
| `F4` | Runtime | a prova de que o artefato de exportação não é ficção |

Mais duas trilhas **fora** das fases, como manda o §9 do playbook:

- **Trilha de infra** (`I-nn`): exige um humano, uma credencial ou um cartão de crédito. **Não tem
  worktree**, roda no branch principal, e ocupa **onda fracionária** para se encaixar entre ondas
  existentes sem renumerar nada.
- **Trilha transversal** (`T-nn`): ferramental que serve o programa inteiro e não é conversão de
  nada. Corre em paralelo com a fundação para não serializar atrás dela.
- **Gates** (`G-n`): checklists de fim de fase. Também sem worktree, também no branch principal.

### 1.2 O bloco de registro de cada card

Todo card abre com um bloco ` ```yaml `. Ele é a **fonte de verdade legível por máquina** — a tabela
de ondas da seção 3 e o caminho crítico da seção 5 são derivados dele, nunca redigitados. O validador
do card `F0-01` reprova qualquer divergência.

O molde está abaixo. **Ele é ilustração, não card:** o bloco está marcado ` ```text ` e indentado de
propósito, para que o validador — que lê exatamente os blocos ` ```yaml ` cuja primeira chave começa
na coluna 1 — não o conte como o 47º card. Um documento em que o exemplo do formato entra na
contagem é um documento que mente sobre o próprio tamanho.

```text
  id: F0-03
  fase: F0
  onda: W2
  grupo: G-pipeline
  deps: [F0-02]
  critico: true          # está no caminho crítico
  gasta: nao             # nao | sim | possivel
  worktree: sim          # nao para infra e gates
  estado: pendente       # pendente | em-andamento | feito
  arquivos:              # os arquivos que ESTE card escreve. É o contrato de paralelismo.
    - tools/pixellab-pipeline/src/cost.ts
```

Três atributos, três eixos independentes, e confundi-los é o erro que faz uma onda parecer pronta
sem estar:

| campo | eixo |
| --- | --- |
| `deps` | **grafo** — de onde saem as ondas |
| `id` + `estado` | **identidade e progresso** |
| `onda` | **escalonamento** — decisão, restrita pelo grafo, não derivada dele |

### 1.3 O prompt

Depois do registro vem uma tabela curta (Objetivo · Entradas · Saídas · Considerações) e então o
**prompt**, num bloco `xml`. Ele é o contrato de uma sessão isolada e amnésica: cada tag existe para
injetar algo que a worktree não tem. Copie o bloco inteiro para o agente.

**39 dos 46 cards têm prompt `xml`.** Os outros sete não têm, e a ausência é decisão, não lacuna:
`I-01` e `I-02` exigem navegador, cartão de crédito e uma conta — coisas que não existem dentro de
uma worktree; e os cinco gates são checklists de conferência assinados por uma pessoa. Esses sete
trazem, no lugar do `xml`, o roteiro executável passo a passo.

As 12 tags do prompt, na ordem:

`ultrathink` · `contexto` · `ler_consideracoes_dos_anteriores` · `questoes_abertas` ·
`skills_obrigatorias` · `entradas` · `o_que_fazer` · `restricoes` ·
`swarm`(`subagents` · `worktree` · `revisao_adversarial`) · `criterios_aceitacao` ·
`ao_concluir_marque_feito_e_publique` · `evolucao`

A linha **Considerações** começa vazia e é preenchida **pelo agente ao concluir**, dentro da
worktree, antes do merge. É por ela que o card seguinte descobre o que mudou desde que este plano
foi escrito. O corpo do card é registro histórico e **não se reescreve**; a refutação é append-only
na linha de Considerações, e tem destinatário nomeado.

### 1.4 A regra de entrada, que é diferente da regra do router

O `.agents/skills/project-router/SKILL.md` manda perguntar bastante antes de agir. **Quando o
usuário chega com um card deste documento, o card já é a especificação** — escopo, entradas, saídas,
dependências, critérios e armadilhas estão nele. Não repita o questionário: pergunte só o que o card
deixa em aberto.

Em troca, o card ganha uma obrigação que a tarefa avulsa não tem: **ler a linha Considerações de
todos os ancestrais**, direta e transitivamente, subindo o grafo até a raiz. O card foi escrito
antes das ondas anteriores rodarem e pode estar desatualizado por elas.

---

## 2. Os grupos — propriedade de arquivo, não de assunto

O DAG diz **quando**; a propriedade de arquivo diz **se**. Dois filtros, nessa ordem: mesmo nível
topológico é condição necessária; conjuntos de arquivos escritos disjuntos é condição suficiente.

| Grupo | Diretórios que ele possui |
| --- | --- |
| `G-plan` | `/home/ondokai/Projects/isometric-maker/PLANO-DE-EXECUCAO.md`, `scripts/**` |
| `G-pipeline` | `tools/pixellab-pipeline/**` |
| `G-builder` | `tools/character-builder/**` (hoje `tools/character-builder/**`) |
| `G-core` | `packages/iso-core/**` |
| `G-map` | `tools/map-builder/**` (a criar) |
| `G-runtime` | `tools/runtime/**` (a criar) |
| `G-docs` | `docs/**` |
| `G-infra` | nenhum arquivo de código; roda no branch principal |

**O grupo é aviso, nunca aprovação.** Ele erra nos dois sentidos: dois cards do mesmo grupo em
níveis diferentes não paralelizam nada (mesmo diretório), e dois cards de grupos diferentes podem
colidir num arquivo compartilhado. O contrato executável é a lista `arquivos:` de cada card, e é ela
que o validador confere.

### 2.1 Os singletons deste repositório

O teto de paralelismo não é o modelo nem a CPU: é o número de recursos únicos que as tarefas tocam.
Enumerados **antes** de dimensionar qualquer onda:

| Singleton | Dono exclusivo ou sequência |
| --- | --- |
| `tools/pixellab-pipeline/pixellab-lock.json` | nunca em worktree — é estado local, gitignorado na prática |
| `tools/pixellab-pipeline/.pixellab/ledger.ndjson` | idem. **Só `I-02` escreve nele.** |
| `PLANO-DE-EXECUCAO.md` (checkbox e Considerações) | cada card escreve **só as suas próprias linhas** |
| `docs/README.md` (tabela do índice) | um card por onda, no máximo; hoje `F0-12` e `G-2` |
| Porta `5173` do Vite | um editor de cada vez na máquina |
| A conta PixelLab | uma só. Duas gerações concorrentes competem pelo mesmo limite de concorrência do tier |

### 2.2 Faixas de id do ledger de incerteza

O ledger é um array único: várias worktrees acrescentando ao fim dele conflitam no fecho do array,
sempre. Cada card recebe faixa própria, reservada **antes** da onda, e escreve num
`docs/plano/inbox/<card>.json`, nunca no arquivo compartilhado. O orquestrador consolida depois do
merge. Ids nunca são reciclados — o número é citado no código.

```text
F0-*  AB-100..199     F1-*  AB-200..299     F2-*  AB-300..399
F3-*  AB-400..449     F4-*  AB-450..479     I-*   AB-001..099
```

---

## 3. As ondas

Escalonamento ASAP com barreira: todo mundo que pode começar, começa; ninguém avança até a onda
inteira fechar. A tabela abaixo é **derivada** dos blocos `yaml` dos cards.

| Onda | Cards | Tipo |
| --- | --- | --- |
| `W0` | `I-01` · `F0-01` | raiz — entrega conta e vocabulário, não funcionalidade |
| `W1` | `F0-02` · `T-01` | **neck**: o rename atravessa três árvores |
| `W2` | `F0-03` `F0-04` `F0-05` `F0-06` `F0-07` `F0-11` | a mais larga da fundação — fan-out do rename |
| `W2.5` | `I-02` | **infra**, sem worktree, no branch principal. **A primeira e única despesa planejada** |
| `W3` | `F0-08` `F0-09` `F0-10` `F0-12` | consome o que a despesa respondeu |
| `W4` | `G-0` | **gate** da fundação |
| `W5` | `F1-01` `F1-02` `F2-01` | `F2-01` é preenchedor de paralelismo (folga de 2 ondas) |
| `W6` | `F1-03` · `F2-02` | |
| `W7` | `F1-04` `F1-06` `F2-03` `F3-01` `F3-02` | fan-out dos hubs |
| `W8` | `F1-05` `F2-04` `F2-05` `F3-03` | |
| `W9` | `F1-07` `F2-06` `F3-04` | |
| `W10` | `F1-08` `F1-09` `F2-07` `F3-05` | |
| `W11` | `G-1` `G-3` `F2-08` `F2-09` | dois gates e dois cards, todos independentes |
| `W12` | `G-2` | **gate** do mapa |
| `W13` | `F4-01` | **join**: in-degree 3 |
| `W14` | `F4-02` | |
| `W15` | `F4-03` | o critério mais duro do plano |
| `W16` | `G-4` | gate final |

**Estreiteza é sinal, não ineficiência.** `W1` é estreita porque o rename toca um arquivo global —
e a onda seguinte nasce larga justamente porque todos herdam os caminhos já corrigidos. `W12`–`W16`
são estreitas porque são fim de linha: o runtime é uma cadeia, não um leque.

**A invariante dura é `onda(card) > onda(dep)` para toda aresta**, não `onda == nível`. Onda
fracionária e folga deliberada são legítimas; o validador as reporta como **aviso**, para que sejam
vistas e não descobertas.

---

## 4. Ondas de composição

Onda de composição é aquela em que N cards trabalham sobre **o mesmo artefato entregue por um card
anterior**, em vez de N fatias independentes. Detecção mecânica: um card com out-degree alto cujos
consumidores estão todos na onda seguinte. Neste plano são três:

| Onda | Por quê | Dispositivo obrigatório |
| --- | --- | --- |
| `W2` | seis cards sobre a árvore recém-renomeada por `F0-02` | mapa `arquivo → dono` publicado no commit PREP |
| `W7` | cinco cards sobre `packages/iso-core` e sobre o `character-builder` | faixas de id disjuntas; `iso-core` só recebe acréscimo |
| `W10` | quatro cards convergindo em `project.json` e nos testes | ordem de merge declarada: `F2-07` por último |

O perigo é sempre o mesmo, e é silencioso:

> Cards da mesma onda nascem em worktrees isoladas a partir da mesma base, então o git **não tem em
> que conflitar** e mergeia em silêncio código que discorda.

Merge limpo prova ausência de conflito **de texto**, e nada mais. Por isso, três coisas:

1. **Gate completo depois de CADA merge**, nunca ao fim da onda. Com um merge dentro, um gate
   vermelho nomeia o card; com quatro, não nomeia nada.
2. **Testes que andam no disco** em vez de listas memorizadas.
3. **Uma checagem semântica do merge, escrita na mensagem de commit**: que costura fechou, qual
   contrato bate, o que cada lado assumiu.

### 4.1 O commit PREP vem antes das worktrees

Uma worktree materializa apenas o que está **commitado**. Preparação deixada no checkout principal
simplesmente não chega nos agentes, e a divergência aparece no merge como trabalho a refazer.

Então, antes de cada onda de composição, um commit próprio — fora de qualquer card, com nome
próprio, para poder ser revisado, revertido e citado — trazendo: os stubs vazios dos pontos de
composição, o mapa `arquivo → dono` daquela onda, as faixas de id do ledger, e qualquer ajuste de
ferramenta que a onda exija.

> **A assimetria que sustenta isso:** um card mal isolado custa uma onda inteira de retrabalho; a
> preparação que o isola custa algumas dezenas de linhas. **Prepare demais.**

---

## 5. Caminho crítico

```text
F0-01 → F0-02 → F0-03 → I-02 → F0-09 → G-0 → F2-01 → F2-02 → F2-03
      → F2-05 → F2-06 → F2-07 → F2-08 → G-2 → F4-01 → F4-02 → F4-03 → G-4
```

**Dezoito cards, e ele passa pelo MAPA, não pelo personagem.** Isso é contraintuitivo — o construtor
de personagem é a cara do produto e a Fase 1 é a mais longa em número de cards — mas a Fase 1 termina
no gate `G-1`, que o runtime consome em paralelo com `G-2` e `G-3`. A cadeia do mapa é mais funda:
geometria → modelo → profundidade → renderizador → picking → pintura → autoladrilhamento → gate.

> Esta correção foi feita **depois** de escrever a seção: a primeira versão publicava a cadeia do
> personagem, com dezessete cards, e o recálculo do caminho mais longo devolveu outra coisa. É
> exatamente a checagem 9 do validador do card `F0-01` — *caminho crítico publicado == caminho mais
> longo recalculado* — e ela achou o defeito no documento que a define. Se você editar o grafo,
> **recalcule esta seção; não a redigite**.

**Adiantar `I-02` encurta o programa inteiro** — ele é o hub de maior out-degree fora da fundação:
`F0-09` (o `isometric` no `specHash`), `F0-10` (a âncora medida) e `F2-04` (o parser de `tile_rules`)
todos esperam por ele, e nenhum dos três pode ser escrito às cegas.

E `I-01` — criar a conta e comprar crédito — é a raiz de tudo que gasta. Se ele atrasar, `I-02`
atrasa, e com ele um terço da fundação.

---

## 6. A ordem, e o que quebra fora dela

Seis inversões que custam dinheiro ou retrabalho estrutural. Estão aqui porque cada uma foi levantada
no replanejamento e continua verdadeira contra o código de hoje:

1. **Qualquer geração antes de fixar `isometric: true`** → o campo entra no `specHash`
   (`tools/pixellab-pipeline/src/catalog.ts`, `computeSpecHash` hasheia `params` inteiro); virá-lo
   depois invalida cada personagem e cobra tudo de novo.
2. **Fase 1 sobre `create-character-v3`** → confirmado no spec vendorizado: `create-character-v3`
   **não tem** `isometric` nem `directions`. Só `/create-character-with-8-directions` tem os dois.
   O estúdio usa o v3 hoje (`tools/character-builder/server/api.ts`, `generateBase`).
3. **Fase 1 antes do guard informativo** → o `POST /api/generate` do estúdio submete direto, sem
   passar por `cost.ts` e sem escrever no ledger. A primeira sessão gasta dinheiro que o teto mensal
   não enxerga.
4. **Fase 1 antes do teste de idempotência** → `F0-09` mexe em `computeSpecHash` para acomodar
   `isometric`, `directions` e a altura em px. Sem teste, a identidade muda em silêncio.
5. **Fase 2 antes de decidir bloco × aresta** → o formato do projeto muda inteiro e todo
   `project.json` escrito antes morre.
6. **O rename depois da Fase 1** → hoje custa uma varredura de texto; depois arrasta lockfile,
   ledger, `ATLAS_OUT`, as citações `arquivo:linha@hash` das skills e arte paga.

---

## 7. Verificação em camadas

O fio condutor, e a pergunta que gera esta seção inteira:

> **Ausência não falha sozinha. Se a cobertura pode encolher sem nada ficar vermelho, ela vai
> encolher — e o verde continua com a mesma cara.**

Projete cada camada perguntando: *se isto desaparecer, o que fica vermelho?*

### 7.1 O gate local **é** o pipeline

Este repositório **não tem CI**, por decisão registrada. Então `scripts/gate.sh` (saída do card
`F0-01`) não é atalho para o pipeline: ele **é** o pipeline. Regras:

- **Ferramenta ausente é VERMELHO, não "pulado".** "Pulado" e "passou" imprimem a mesma conclusão
  operacional — o gate não reclamou — e a máquina onde falta a ferramenta é justamente a que vai
  declarar verde para sempre.
- **Três estados, não dois:** `PASS`, `FAIL` e **`NÃO-EXERCITADO`**, e o terceiro imprime junto com
  o veredito. Gate que ainda não existe é anunciado como `PENDENTE`, nunca omitido.
- Uma etapa por verificador, com o nome do card que a introduziu.

Estado de hoje, medido em 2026-07-30:

```text
etapa                                        estado
pixellab-pipeline · npm test                 PASS  (6 testes)
pixellab-pipeline · npm run typecheck        PASS
character-builder     · npm run typecheck        NÃO-EXERCITADO (nunca rodado neste plano)
scripts/check-docs.sh                        PASS
lint-skills.mjs                              NÃO-EXERCITADO
run-skill-evals.mjs                          NÃO-EXERCITADO
vendor-types.mjs --check                     NÃO-EXERCITADO
scripts/validate-plan.mjs                    PENDENTE (card F0-01)
scripts/check-acceptance.mjs                 PENDENTE (card T-01)
```

### 7.2 Aceitação falsificável

Para cada critério, uma pergunta: ***"o que este comando imprime se a tarefa não fizer nada?"*** Se
a resposta for "verde", o critério é decorativo.

Este projeto já tem um critério decorativo publicado, e ele está no próprio replanejamento:

```bash
grep -rn "character-builder/src" tools/runtime/src | wc -l    # "tem que dar 0"
```

**Isso sai 0 antes de `tools/runtime/` existir.** Verificado em 2026-07-30: `grep` num diretório
inexistente escreve o erro em stderr, não escreve nada em stdout, `wc -l` conta zero e o pipeline
sai 0. O mesmo vale para `grep -rn "kind: 'refuse'" src/ | wc -l`, que além disso não casa
`kind: "refuse"` nem `kind:'refuse'`.

A forma correta tem **controle positivo** junto — um comando que prova que o detector é capaz de
achar alguma coisa:

```bash
test -d tools/runtime/src || { echo "FALHA: tools/runtime/src não existe"; exit 1; }
grep -rq "import" tools/runtime/src || { echo "FALHA: o grep não acha nem um import — detector cego"; exit 1; }
! grep -rn "character-builder/src" tools/runtime/src
```

**Todo card deste plano tem pelo menos um critério que falha por ausência.** É a classe que o resto
não cobre.

### 7.3 As nove camadas, na ordem em que se constroem

1. Gate local executável, uma etapa por verificador, ferramenta ausente = vermelho — `F0-01`
2. Validador do grafo do plano — `F0-01`
3. Verificador de aceitação, com sonda negativa — `T-01`
4. Autoteste de cada verificador, rodando **antes** dele, assertando **a mensagem** — `T-01`
5. Testes dos módulos que decidem dinheiro — `F0-08`
6. Ledger de incerteza com validador, rodando desde o dia 1, verde com tudo aberto — `F0-01`
7. Estado do programa derivado da árvore, nunca escrito à mão — `F0-01`
8. Hooks de máquina só onde o erro é irreversível — **já existem** em `.claude/settings.json`
9. Setup de worktree com preflight que prova acesso ao insumo — `F0-01`

> *"Ferramenta que estreia no dia do acesso é ferramenta que falha no dia do acesso."* O validador
> do ledger roda verde com todos os itens abertos, desde a primeira onda, exatamente para que o dia
> de fechá-los não estreie a ferramenta.

---

## 8. Dinheiro

**Só dois cards gastam neste plano inteiro:** `I-01` (comprar crédito) e `I-02` (os quatro
experimentos). Todo o resto é `gasta: nao`, e o campo é conferido pelo validador.

O guard informa e **nunca recusa** — é a ADR 0012, e transformá-la em código é o card `F0-03`. Hoje
o `checkBudget` ainda devolve `kind: 'refuse'` em quatro situações
(`tools/pixellab-pipeline/src/cost.ts`), e o `cli.ts` sai 2 nelas.

Os limiares continuam com os mesmos números e mudam de significado — de "recuso acima" para "aviso
acima":

| Limiar | Valor | Depois da `F0-03` |
| --- | --- | --- |
| `maxAssetUsd` | US$ 0,30 | aviso: "isso quase sempre é um `mode:'pro'` acidental" |
| `promptAboveUsd` | US$ 5,00 | pede confirmação |
| `maxRunUsd` | US$ 15,00 | aviso |
| `hardCapMonthlyUsd` | US$ 60,00 | aviso, com o acumulado do mês ao lado |

**A idempotência continua dura.** Gerar o mesmo spec duas vezes nunca cobra duas vezes — e o teste
que prova isso não existe hoje. Escrevê-lo é o card `F0-08`, e é o critério de entrada da Fase 1.

> O guard é conselho; **o cache é lei.**

Custo estimado do plano inteiro, somando só o que está planejado:

| Bloco | Card | Gerações | USD estimado |
| --- | --- | --- | --- |
| Crédito inicial | `I-01` | — | **decisão sua** (mínimo sugerido: US$ 10) |
| `isometric` com e sem, 64×64 | `I-02` | 2 | ~0,034 |
| Um template id, `directions:['south']` | `I-02` | 1 | ~0,014 |
| `mode:'v3'` numa direção, lendo `usage` | `I-02` | 1 | ~0,014 |
| `create-tiles-pro` com `tile_feature:'building'` | `I-02` | ? | **não medido** |
| `GET /characters/{character_id}` para ver `skeletons` | `I-02` | 0 | **grátis** |
| **Total planejado** | | **4 + tiles** | **~US$ 0,06 + tiles** |

Preço **estimado**: a própria PixelLab rotula a coluna como `Estimated Price* (USD)` e nota que
varia com o tempo de GPU.

**O que este plano não orça:** a arte de verdade. Um personagem completo (3 cardeais + 8 direções +
3 animações × 8) fica em ~31 gerações e ~US$ 0,40 pela tabela do `cost.ts` — **se** `mode:'v3'`
custar 1 geração por direção. Se custar 20, o mesmo personagem custa ~US$ 7,00. É a pergunta que
`I-02` responde, e é por isso que ela vem antes da Fase 1.

---

## Onda W0 — a raiz

### `I-01` — Criar a conta na PixelLab, comprar crédito e deixar o ambiente pronto

```yaml
id: I-01
fase: infra
onda: W0
grupo: G-infra
deps: []
critico: true
gasta: sim
worktree: nao
estado: pendente
arquivos: []
faixa_ledger: AB-001..AB-019
```

| | |
| --- | --- |
| **Objetivo** | Sair de "não existe conta" para `node src/cli.ts doctor` verde e `node src/cli.ts balance` imprimindo um número. |
| **Entradas** | Um navegador, um cartão, e `/home/ondokai/Projects/isometric-maker/docs/01-pixellab/custos-e-limites.md`. |
| **Saídas** | Conta criada · crédito comprado · `PIXELLAB_SECRET` e `PIXELLAB_TIER` exportados na shell · `doctor` sem `ERRO`. |
| **Considerações** | — |

**Este card é seu, não de um agente.** Ele precisa de um navegador, de um e-mail e de um cartão de
crédito, e nenhuma dessas coisas existe dentro de uma worktree. Faça-o na mão, no branch principal.

#### Passo a passo

1. **Crie a conta** em `https://www.pixellab.ai/`. Confirme o e-mail.

2. **Compre crédito.** A unidade é o crédito, e **1 crédito = US$ 1,00**. Existe também uma
   assinatura, cuja unidade é *generations* — as duas coexistem e **nunca devem ser somadas**. A
   própria API diz qual delas cobrou, no campo `usage.type` de cada resposta
   (`tools/pixellab-pipeline/src/api.ts`, interface `Usage`).

   > **Quanto comprar.** Todo o gasto planejado neste documento é ~US$ 0,06, no card `I-02`. O
   > mínimo prático é o menor pacote que a PixelLab vender. Sugestão: **US$ 10**, que cobre os
   > experimentos, um personagem completo de teste e ainda deixa margem para o guard não passar a
   > vida pedindo confirmação. O teto mensal do repositório está em **US$ 60**
   > (`DEFAULT_LIMITS.hardCapMonthlyUsd`, `tools/pixellab-pipeline/src/cost.ts`) e é um aviso, não
   > uma trava — quem decide parar é você.

3. **Pegue o token** em `https://www.pixellab.ai/account`. É o mesmo endereço que o cliente HTTP
   cita quando o token falta (`tools/pixellab-pipeline/src/api.ts`, construtor de `PixelLabClient`).

4. **Exporte na shell.** Não existe carregamento automático de `.env` neste repositório: o
   `package.json` de `tools/pixellab-pipeline` não declara `dotenv`, e o servidor do estúdio lê
   `process.env['PIXELLAB_SECRET']` direto. Há um `.env.example` na raiz, e ele é **documentação**,
   não um arquivo que alguém carrega.

   ```bash
   export PIXELLAB_SECRET="cole-o-token-aqui"
   export PIXELLAB_TIER="t1"
   ```

   Escolha do tier — ele decide **só a concorrência de jobs**, não o preço
   (`TIER_CONCURRENCY`, `tools/pixellab-pipeline/src/cost.ts`):

   | `PIXELLAB_TIER` | Jobs simultâneos |
   | --- | --- |
   | `free` | 1 |
   | `t1` *(default do código)* | 2 |
   | `t2` | 4 |
   | `t3` | 20 |

5. **Confira.** Rode, em ordem, e leia a saída inteira:

   ```bash
   cd /home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline
   node src/cli.ts doctor     # node ≥ 24, token, spec vendorizado, proveniência, catálogo
   node src/cli.ts balance    # saldo + gasto do mês pelo ledger local
   node src/cli.ts plan       # resolve o catálogo e diffa. NUNCA gasta.
   ```

#### Armadilhas que já estão no código, e valem saber antes

- **O token nunca chega ao navegador, por construção.** O estúdio monta a API como middleware do
  Vite (`tools/character-builder/vite.config.ts`) exatamente para isso. Se algum dia um `fetch` do
  browser for direto para `api.pixellab.ai`, o segredo aparece no devtools.
- **O hook de segurança de `.claude/settings.json` torna `.env` e `secrets/` ilegíveis para
  agentes.** Isso é proposital. Não tente contorná-lo pedindo o token a um agente: exporte-o você,
  na sua shell.
- **`plan` nunca gasta; `generate` gasta.** Os exit codes fazem parte do contrato
  (`tools/pixellab-pipeline/src/cli.ts`, cabeçalho): `0` ok · `1` erro · `2` recusado/não confirmado
  · `4` jobs pagos pendentes, rode `resume` · `5` artefato inválido.
- **Depois de qualquer queda, o primeiro comando é `rescue`**, não `generate`. Recursos efêmeros —
  `/map-objects` se autodeleta 8 h depois de criado — evaporam junto com o dinheiro se ninguém
  baixar.

#### Critérios de aceitação

```bash
cd /home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline
node src/cli.ts doctor | grep -c "^  ERRO"     # 0
node src/cli.ts balance | grep -q "^Saldo:"    # exit 0, e o número é > 0
# GUARD (falha por ausência): sem token, o doctor imprime ERRO e o grep acima dá >= 1.
# Se der 0 com a shell limpa, o doctor parou de checar — isso é defeito, não sucesso.
env -u PIXELLAB_SECRET node src/cli.ts doctor | grep -q "ERRO PIXELLAB_SECRET"
```

#### Ao concluir

Marque `estado: feito` no bloco `yaml` **deste** card e escreva na linha **Considerações**: o tier
escolhido, o valor comprado e a data. Se a PixelLab tiver mudado a página de conta, o fluxo de
compra ou a unidade de cobrança, **isso é uma refutação e tem destinatário: `I-02`**.

---

### `F0-01` — Card raiz: vocabulário, validador do plano, gate local e ledger

```yaml
id: F0-01
fase: F0
onda: W0
grupo: G-plan
deps: []
critico: true
gasta: nao
worktree: sim
estado: feito
arquivos:
  - scripts/validate-plan.mjs
  - scripts/gate.sh
  - scripts/new-task-worktree.sh
  - scripts/validate-ledger.mjs
  - docs/plano/ledger.json
  - docs/plano/README.md
faixa_ledger: AB-100..AB-109
```

| | |
| --- | --- |
| **Objetivo** | Entregar a **máquina** do plano, não funcionalidade: o validador do grafo, o gate local, o criador de worktree com preflight e o ledger de incerteza vazio mas já validado. |
| **Entradas** | `/home/ondokai/Projects/isometric-maker/PLANO-DE-EXECUCAO.md` (este arquivo) · `scripts/check-docs.sh` como modelo de estilo de verificador. |
| **Saídas** | os seis arquivos acima. |
| **Considerações** | Formato do bloco yaml que o validador espera: keys no topo (coluna 1) dentro de \`\`\`yaml. Keys obrigatórias: `id`, `fase`, `onda`, `grupo`, `deps`, `critico`, `gasta`, `worktree`, `estado`, `arquivos`, `faixa_ledger`. `deps` pode ser `[]` (array vazio) ou `[ID1, ID2]`. `arquivos` usa block array com `  - caminho`. `estado` é `pendente`, `em-andamento` ou `feito`. `gasta` é `nao`, `sim` ou `possivel`. Adicionei o campo `faixa_ledger` como obrigatório (o plano já o declara em todos os cards) e criei `scripts/validate-ledger.mjs` como sexto arquivo (o validador do ledger estava inline no gate.sh e foi extraído para script próprio). O validador lê APENAS blocos \`\`\`yaml cuja primeira chave começa na coluna 1 — o exemplo indentado na seção 1.2, marcado \`\`\`text, é ignorado de propósito. Destinatário: todos os cards seguintes. |

```xml
<task id="F0-01" nome="Vocabulário, validador do plano, gate local e ledger"
      onda="W0" worktree="G-plan">

  <ultrathink>
    Gaste o raciocínio no VALIDADOR DE GRAFO, não no gate. O playbook de origem registra que a maior
    lacuna do programa dele foi justamente essa: nenhum script lia as arestas, um card ficou órfão e
    quatro arestas divergiram entre duas representações, em silêncio. Se o validador nascer fraco,
    todo card posterior herda um grafo em que ninguém confia — e a onda passa a ser opinião.
    O segundo ponto de atenção é FALHAR FECHADO: zero cards parseados tem de ser VERMELHO, nunca
    verde, porque a leitura mais provável desse zero é "o formato do documento mudou e eu fiquei cego".
  </ultrathink>

  <contexto>
    isometric-maker é um editor de jogos isométricos local, de usuário único. Não há servidor, não há
    rede, não há partida. O produto anterior era outro e foi removido por decisão registrada
    (docs/adr/0010-pivo-para-editor-isometrico.md).
    Este repositório NÃO tem CI. O compilador, `scripts/check-docs.sh` e os scripts das skills são as
    únicas opiniões automatizadas que existem hoje. Por isso o gate local não é atalho para o
    pipeline: ele É o pipeline.
  </contexto>

  <ler_consideracoes_dos_anteriores>
    Card raiz. Não há ancestral. Leia, em vez disso:
    /home/ondokai/Projects/isometric-maker/AGENTS.md (inteiro),
    PLANO-DE-EXECUCAO.md seções 1 a 7, e docs/adr/0010, 0012 e 0016.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>
    Faixa AB-100..AB-109, em docs/plano/inbox/F0-01.json. Esperado: nenhuma.
    Ritual, se aparecer alguma: (1) decida provisoriamente, (2) abra o item com os cinco campos
    obrigatórios, (3) marque o ponto exato no código com `// ABERTO AB-nnn: <o que se assumiu>`.
  </questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/writing-repo-typescript/SKILL.md
    - .agents/skills/testing-repo-code/SKILL.md
    - .agents/skills/writing-project-docs/SKILL.md   (só para docs/plano/README.md)
  </skills_obrigatorias>

  <entradas>
    - PLANO-DE-EXECUCAO.md — é o documento que o validador PARSEIA. Leia a seção 1.2 (bloco de
      registro) antes de escrever a expressão regular, e trate o formato como contrato.
    - scripts/check-docs.sh — o estilo de verificador que este repositório já usa: bash + python3
      embutido, uma seção por checagem, `fail=1` acumulado, exit no fim.
    - tools/pixellab-pipeline/package.json — de onde sai a etapa `npm test` do gate.
  </entradas>

  <o_que_fazer>
    1. scripts/validate-plan.mjs — Node 24, sem dependência. Parseia os blocos ```yaml dos cards de
       PLANO-DE-EXECUCAO.md e checa, nesta ordem, imprimindo TODOS os problemas antes de sair:
         a. toda dependência resolve para um card existente;
         b. grafo acíclico (DFS com cor; imprime o ciclo encontrado, não só "há ciclo");
         c. INVARIANTE DURA: onda(card) > onda(dep) para toda aresta. Ondas fracionárias (W2.5)
            comparam como número;
         d. AVISO, não falha: onda(card) > nivel(card). Imprima a folga em ondas. Folga é legítima
            (F2-01 é preenchedor de paralelismo de propósito) mas tem de ser VISTA;
         e. sem órfão: card sem dependência E sem dependente é FALHA, salvo allowlist datada;
         f. dois cards da MESMA onda não declaram o MESMO arquivo em `arquivos:`. Valide por
            arquivo, nunca por grupo — o grupo erra nos dois sentidos;
         g. a tabela de ondas da seção 3 bate com os campos `onda:` dos cards;
         h. o caminho crítico publicado na seção 5 é igual ao caminho mais longo recalculado;
         i. card com `estado: feito` só é válido se todos os ancestrais transitivos estiverem feitos;
         j. card com `gasta: sim` só pode ser I-01 ou I-02 — qualquer outro é FALHA;
         k. ZERO CARDS PARSEADOS É FALHA, com a mensagem "o formato do documento mudou e este
            validador ficou cego".
    2. Autoteste, no mesmo arquivo, atrás de `--self-test`, rodando ANTES da validação de verdade.
       Mutações CALCULADAS a partir do documento corrente, nunca literais: pegue o primeiro card,
       aponte-o para uma dependência inexistente, e asserte A MENSAGEM, não o exit code. Faça o
       mesmo para ciclo, para onda invertida e para colisão de arquivo. Literais viram no-op no
       primeiro merge e ensinam a ignorar o autoteste.
    3. scripts/gate.sh — uma etapa por verificador, na ordem da seção 7.1 deste plano. Ferramenta
       ausente imprime VERMELHO, nunca "pulado". Três estados: PASS, FAIL, NÃO-EXERCITADO — e o
       terceiro sai no resumo final junto com o veredito. Etapa que ainda não existe entra como
       PENDENTE com o id do card que a vai criar.
    4. scripts/new-task-worktree.sh <card-id> — cria a worktree do card em
       /home/ondokai/Projects/isometric-maker.worktrees/<card-id>, a partir do branch de integração;
       RECUSA ids de infra e de gate (I-* e G-*), explicando que rodam no branch principal; e termina
       com um PREFLIGHT que prova acesso ao insumo: que node --version >= 24, que
       tools/pixellab-pipeline/openapi/openapi-v2.json resolve e casa o sha256 do PROVENIENCIA.txt,
       que `node -e "import('./tools/pixellab-pipeline/assets/catalog.ts')"` carrega. Falhou => exit 1
       e a worktree fica para inspeção. Ambiente que falha em silêncio produz agente confiante e
       errado, e a falha só aparece no merge.
    5. docs/plano/ledger.json — array vazio, mais o validador de esquema DENTRO do gate desde já:
       item ABERTO exige `por_que_aberto`, `decisao_provisoria` e `verificacao` não vazios e
       `evidencia` VAZIA; item fechado exige `evidencia` casando a regex de forma verificável
       (`arquivo:linha`, saída de comando salva, ADR, ou resposta atribuída com data) e
       `data_resolucao` em ISO. Lista negra que rejeita "ok", "confirmado", "conforme combinado".
       O validador roda VERDE com o array vazio — é o ponto: a ferramenta não pode estrear no dia em
       que for usada de verdade.
    6. docs/plano/README.md — o que é o ledger, como abrir um item, como fechá-lo, e a frase que
       justifica a lista negra: item marcado confirmado sem evidência anexada é PIOR que item aberto,
       porque para de ser reperguntado e vira premissa invisível.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO tocar em qualquer arquivo sob tools/ ou packages/. Este card entrega ferramenta de
      gestão, não código de produto.
    - PROIBIDO editar docs/adr/**. ADR não se edita: uma decisão revista gera ADR nova.
    - PROIBIDO editar qualquer .agents/skills/*/SKILL.md — exige token fresco de validação, e nada
      aqui precisa disso.
    - PROIBIDO adicionar dependência npm. Node 24 executa .ts direto e o repositório não tem
      workspace na raiz; estes scripts são .mjs sem dependência de propósito.
    - PROIBIDO fazer o gate "pular" etapa por ferramenta ausente. Pulado e passou imprimem a mesma
      conclusão operacional.
    - PROIBIDO `git add -A`.
  </restricoes>

  <swarm>
    <subagents>
      Agente único para escrever. Se quiser paralelizar, paralelize INVESTIGAÇÃO: um subagente lê
      scripts/check-docs.sh e devolve o estilo de verificador do repositório em uma página; outro lê
      as 12 convenções do AGENTS.md. A escrita dos cinco arquivos é do agente principal, que enxerga
      o conjunto — a consistência entre eles é o produto.
    </subagents>
    <worktree>G-plan — bash scripts/new-task-worktree.sh F0-01 (crie-o à mão nesta primeira vez)</worktree>
    <revisao_adversarial>
      Antes de concluir, lance um subagente de CONTEXTO FRESCO que recebe APENAS o diff e este card,
      e tenta REFUTAR:
        - o validador passa com um PLANO-DE-EXECUCAO.md VAZIO? (tem de ser vermelho)
        - o gate passa numa máquina onde `node` não existe? (tem de ser vermelho, não "pulado")
        - o autoteste distingue "acusou o defeito certo" de "quebrou por outro motivo", ou só olha o
          exit code?
        - o preflight passaria com a worktree sem o spec vendorizado?
        - alguma mutação do autoteste é literal e vira no-op se o documento mudar?
      Corrija o que ele derrubar antes de encerrar.
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    node scripts/validate-plan.mjs --self-test        # exit 0, e imprime >= 4 mutações acusadas
    node scripts/validate-plan.mjs                    # exit 0 contra o plano de hoje
    bash scripts/gate.sh                              # exit 0, com o resumo por etapa
    # falha por AUSÊNCIA — o critério que o resto não cobre:
    printf '' > /tmp/plano-vazio.md && node scripts/validate-plan.mjs /tmp/plano-vazio.md; test $? -ne 0
    grep -q "NÃO-EXERCITADO" <(bash scripts/gate.sh)  # o terceiro estado existe e aparece
    bash scripts/new-task-worktree.sh I-01 2>&1 | grep -q "branch principal"   # recusa infra
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque `estado: feito` SÓ no bloco yaml do card F0-01 e escreva SÓ a linha Considerações dele.
    Nenhuma outra linha de PLANO-DE-EXECUCAO.md é sua — cinco cards escrevem nesse arquivo nas ondas
    seguintes e o conflito é garantido se você tocar em mais.
    Nas Considerações, publique: o formato exato que o validador espera do bloco yaml (é contrato
    para todos os cards seguintes) e qualquer campo que você teve de acrescentar.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>
    meta-skill-evolution, default DESCARTAR. Só promova se descobrir algo não-óbvio, não inferível do
    código e que mude como tarefas futuras nessa área devem ser feitas. Apague TASK_PLAN.md.
  </evolucao>
</task>
```

---

## Onda W1 — o neck

### `F0-02` — Rename para `character-builder` e purga do nome residual

```yaml
id: F0-02
fase: F0
onda: W1
grupo: G-builder
deps: [F0-01]
critico: true
gasta: nao
worktree: sim
estado: feito
arquivos:
  - tools/character-builder/**
  - tools/pixellab-pipeline/src/cli.ts
  - docs/README.md
  - README.md
faixa_ledger: AB-110..AB-119
```

| | |
| --- | --- |
| **Objetivo** | O estúdio de autoria (`sprite-studio`) é renomeado para `tools/character-builder`, e o nome do produto anterior some do código — hoje ele ainda estava em dois lugares. |
| **Entradas** | `git mv` · `tools/character-builder/index.html` · `tools/pixellab-pipeline/src/cli.ts` (banner do `usage`) · as citações `arquivo:linha@hash` das skills. |
| **Saídas** | árvore renomeada · zero ocorrências do nome antigo fora do arquivo da ADR 0015 · skills reancoradas. |

**Considerações para cards futuros:**

- Skills com citações reancoradas (paths atualizados, hashes recalculados para os arquivos modificados):
  - `testing-repo-code` — 1 citação (`package.json:8@47dd51fc`)
  - `writing-repo-typescript` — 6 citações (`api.ts:15@8fb78ce5`, `package.json@47dd51fc`, `vite.config.ts:12@6a436967`, `tsconfig.json@0e018a20`)
  - `project-analysis` — 6 citações (incluindo `api.ts:15@8fb78ce5`, `package.json@47dd51fc`, `tsconfig.json:13@0e018a20`)
  - `skill-map` — 3 citações (`api.ts:15@8fb78ce5`)
  - `evals/writing-repo-typescript.json` — 1 referência textual
- Skills com AVISO de hash desatualizado (stale, não erro) devido a mudanças colaterais neste card:
  - `guarding-generation-cost` — 7 avisos em `cli.ts` (banner alterado: `8d21d33a → 681e566d`)
  - `writing-repo-typescript` — 1 aviso em `cli.ts` (mesma causa)
  - `writing-project-docs` — 5 avisos em `docs/README.md` (tabela alterada: `62ab10c3 → 7ddecb2d`)
  - `animating-pixi-sprites` — 7 avisos em `docs/02-personagem/guarda-roupa-e-silhueta.md` (cd path alterado: `be1e5781 → 55ec273b`)
  - Diversas skills com avisos em `AGENTS.md` (comando typecheck alterado: `eb529ae5 → e4c21896`)
  - Diversas skills com avisos em `docs/00-produto/visao.md` (cd path alterado: `613eaec7 → 1feb166b`)
- **docs/adr/0015-low-top-down-8-direcoes-isometrico.md:56** contém `tools/sprite-studio/server/api.ts` como referência histórica ao estado pré-rename. A restrição do card proíbe editar docs/adr/**, portanto esta ocorrência sobrevive intencionalmente.
- `scripts/gate.sh` — removida a lógica de fallback `|| cd tools/character-builder`; o gate agora aponta exclusivamente para `character-builder`.
| **Considerações** | — |

**Por que este card corre sozinho numa onda.** Ele toca uma árvore inteira e as citações de nove
skills. Qualquer card paralelo escreveria contra caminhos que deixam de existir no merge, e o git
não teria em que conflitar — mergearia limpo e quebraria depois.

**A armadilha que este card existe para não repetir:** o `check-docs.sh` só varre `docs/`. Por isso
a purga da ADR 0017 alcançou as docs e **deixou passar** `tools/character-builder/index.html` e o banner
do `usage` em `tools/pixellab-pipeline/src/cli.ts`. Verificado em 2026-07-30.

```xml
<task id="F0-02" nome="Rename para character-builder e purga do nome residual"
      onda="W1" worktree="G-builder">

  <ultrathink>
    Gaste o raciocínio nas CITAÇÕES DAS SKILLS, não no `git mv`. O linter de skills classifica
    "arquivo citado sumiu" como ERRO e "hash da linha mudou" como AVISO — então a biblioteca pode
    ficar VERDE atestando texto que não existe mais. Mover um arquivo citado sem reancorar a citação
    é o modo de falha caro deste card, e ele é silencioso.
    O segundo ponto: renomear é barato hoje e caro depois. Ainda não existe lockfile, o cache está
    vazio, o ledger está zerado e nenhum asset foi gerado. Nenhuma identidade de asset foi fixada.
  </ultrathink>

  <contexto>
    tools/character-builder é a tela de autoria que já gera um personagem em 8 direções com o token preso
    no Node. Ela não vai ser reescrita — ela VIRA o construtor de personagem da Fase 1. O rename é a
    primeira metade dessa promoção; a segunda é a troca de endpoint, que é o card F1-03.
    A ADR 0017 já purgou o nome do produto anterior de caminhos e escopos npm, mas a varredura dela
    cobriu docs/ e package.json, não o HTML do estúdio nem o texto de ajuda do CLI.
  </contexto>

  <ler_consideracoes_dos_anteriores>
    ANTES de planejar, leia a linha Considerações de F0-01 — ela publica o formato do bloco yaml que
    você vai ter de manter ao marcar este card como feito.
    Dependências diretas: F0-01.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-110..AB-119, em docs/plano/inbox/F0-02.json. Esperado: nenhuma.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/writing-repo-typescript/SKILL.md
    - .agents/skills/meta-skill-evolution/SKILL.md   (para o ritual do token de reparo de citação)
  </skills_obrigatorias>

  <entradas>
    - tools/character-builder/** — a árvore inteira. Use `git mv`, não copiar e apagar: o histórico do
      arquivo é o que permite auditar a promoção depois.
    - grep -rn "character-builder" --exclude-dir=node_modules --exclude-dir=.git . — a lista de trabalho
      literal. Rode ANTES de mexer em nada e guarde a saída; ela é o seu inventário.
    - grep -rn "Power Abuse\|power-abuse" --exclude-dir=node_modules --exclude-dir=.git . — hoje
      devolve ocorrências legítimas (o arquivo da ADR 0011, o índice, a lista de termos do
      check-docs.sh) e duas ILEGÍTIMAS. Saiba distinguir antes de trocar.
  </entradas>

  <o_que_fazer>
    1. `git mv tools/character-builder tools/character-builder`. Ajuste, no mínimo: o campo `name` de
       tools/character-builder/package.json para @isometric-maker/character-builder; o import
       relativo `../../pixellab-pipeline/src/api.ts` em server/api.ts (a profundidade não muda, mas
       confira); e o `<title>` de index.html, que hoje diz "Sprite Studio — Power Abuse".
    2. tools/pixellab-pipeline/src/cli.ts: o texto de `usage()` abre com "pipeline de assets do
       Power Abuse". Troque por "pipeline de assets do isometric-maker". É a única linha do CLI que
       este card toca — o resto do cli.ts pertence a F0-03, na onda seguinte.
    3. Varra as citações das skills. Para cada `arquivo:linha@hash` que aponte para
       tools/character-builder/**, reancore para o caminho novo E RECONFIRA A LINHA: o comando de geração
       de citação imprime a citação e o conteúdo da linha, justamente para você confirmar que ela diz
       o que você vai afirmar. Editar um SKILL.md existente exige token fresco de
       `node .agents/skills/scripts/run-skill-evals.mjs --skill <nome> --write-token`, com TTL de 30
       minutos. Se o eval falhar POR CAUSA da citação quebrada, um token VERMELHO fresco autoriza a
       escrita como REPARO — o próprio hook explica que proibir o conserto seria estritamente pior.
    4. Atualize as referências em README.md e docs/README.md (a linha da tabela "Ferramentas").
       docs/README.md é singleton nesta onda: você é o único card que o toca.
    5. NÃO renomeie docs/adr/0011-repo-isometric-maker-pasta-power-abuse.md. O nome antigo sobrevive
       ali de propósito: aquele arquivo nomeia a decisão desfeita, e renomeá-lo apagaria o registro
       de que a divergência existiu.
    6. NÃO mexa na lista TERMOS de scripts/check-docs.sh. "Power Abuse" tem de continuar lá — é o que
       impede o nome de voltar por um parágrafo bem-intencionado.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO tocar em tools/pixellab-pipeline/src/** além da linha do banner em cli.ts.
    - PROIBIDO editar docs/adr/**, inclusive para "corrigir" o caminho antigo dentro da 0011.
    - PROIBIDO copiar e apagar em vez de `git mv`.
    - PROIBIDO deixar uma citação de skill apontando para caminho inexistente. Arquivo citado ausente
      é ERRO no lint; hash mudado é só AVISO — e é por isso que a varredura por número de linha é
      manual e é sua.
    - PROIBIDO mudar comportamento. Este card é uma migração mecânica de caminho: nada de "já que
      estou aqui, melhoro isto".
  </restricoes>

  <swarm>
    <subagents>
      Agente único. Fan-out só para LER: um subagente por skill afetada, cada um devolvendo a lista
      de citações que apontam para o caminho antigo, com número de linha. A escrita é do principal —
      nove skills editadas por nove agentes produziriam nove tokens concorrentes e um conflito no
      diretório .validation/.
    </subagents>
    <worktree>G-builder — bash scripts/new-task-worktree.sh F0-02</worktree>
    <revisao_adversarial>
      Subagente de contexto fresco, recebendo só o diff e este card:
        - sobrou alguma citação de skill apontando para tools/character-builder?
          (comando: grep -rn "character-builder" .agents/skills/ — tem de sair vazio)
        - `node .agents/skills/scripts/lint-skills.mjs` está verde por CONFERIR ou por não achar
          nada para conferir?
        - o estúdio ainda SOBE depois do rename? (npm run dev no diretório novo)
        - alguma ocorrência de "Power Abuse" que não seja a ADR 0011, o índice ou a lista de termos?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    test -d tools/character-builder && test ! -d tools/character-builder
    cd tools/character-builder && npm run typecheck                          # exit 0
    node .agents/skills/scripts/lint-skills.mjs                              # exit 0
    bash scripts/check-docs.sh                                               # exit 0
    node scripts/validate-plan.mjs                                           # exit 0
    # falha por AUSÊNCIA:
    ! grep -rn "character-builder" --exclude-dir=node_modules --exclude-dir=.git .
    ! grep -rln "Power Abuse" tools/ packages/
    # controle positivo do grep acima — prova que o detector enxerga alguma coisa:
    grep -rq "isometric-maker" tools/character-builder/package.json
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F0-02. Nas Considerações, publique a lista NOMINAL das skills cujas
    citações você reancorou e quais ficaram com hash desatualizado (aviso, não erro) — o destinatário
    é qualquer card futuro que edite aquelas skills.
    Se você descobriu ocorrência do nome antigo fora do inventário previsto, escreva ONDE. É
    refutação, e o destinatário é G-0.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `T-01` — Verificador de aceitação, com sonda negativa

```yaml
id: T-01
fase: transversal
onda: W1
grupo: G-plan
deps: [F0-01]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - scripts/check-acceptance.mjs
faixa_ledger: AB-120..AB-129
```

| | |
| --- | --- |
| **Objetivo** | Impedir que um card se declare feito com um critério que já passava antes de a tarefa começar. |
| **Entradas** | os blocos `criterios_aceitacao` de todos os cards deste plano. |
| **Saídas** | `scripts/check-acceptance.mjs`, ligado como etapa do `gate.sh`. |
| **Considerações** | — |

**O defeito que este card previne, medido neste repositório em 2026-07-30:**

```bash
grep -rn "qualquer-coisa" /diretorio/que/nao/existe | wc -l   # imprime 0, sai 0
```

O critério de saída publicado para a Fase 4 tem exatamente essa forma. Ele passa hoje, com
`tools/runtime/` inexistente. Um card poderia declarar-se feito sem entregar nada, e o plano, o gate
e o exit code concordariam.

```xml
<task id="T-01" nome="Verificador de aceitação com sonda negativa" onda="W1" worktree="G-plan">

  <ultrathink>
    O ponto de atenção não é ler os critérios — é provar que o LEITOR não está cego. Um verificador
    que só sabe dizer OK é um comentário com exit 0. Duas defesas: sonda negativa (um alvo impossível
    TEM de dar zero) e tripwire independente (conte as ocorrências num texto normalizado DIFERENTE do
    que o parser lê). Se uma regressão fizer o parser ignorar o documento, os dois discordam e você
    fica sabendo.
  </ultrathink>

  <contexto>
    Não há CI aqui. O gate local é o pipeline. Os critérios de aceitação deste plano são comandos de
    shell escritos à mão dentro de blocos ```xml, e nada hoje confere se eles são falsificáveis.
  </contexto>

  <ler_consideracoes_dos_anteriores>
    Leia as Considerações de F0-01: o formato do bloco yaml e a lista de etapas do gate.sh são
    contrato para este card. Dependências diretas: F0-01.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-120..AB-129. Esperado: nenhuma.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/testing-repo-code/SKILL.md
    - .agents/skills/writing-repo-typescript/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - PLANO-DE-EXECUCAO.md — extraia os comandos de DENTRO dos blocos criterios_aceitacao, união
      deduplicada com os que aparecerem em tabelas.
    - scripts/gate.sh (de F0-01) — onde este verificador entra como etapa própria.
  </entradas>

  <o_que_fazer>
    1. scripts/check-acceptance.mjs. Para cada card com `estado: feito`, extraia os comandos do bloco
       criterios_aceitacao e classifique cada um:
         - contém `| wc -l` comparado a zero, ou `grep -c` comparado a zero, SEM um `test -d`/`test -f`
           ou um controle positivo na vizinhança => AVISO "critério possivelmente decorativo",
           nomeando o card e a linha;
         - contém `npm test` sem nenhum arquivo *.test.ts entre os `arquivos:` daquele card, e o card
           não é de infra => AVISO;
         - não contém NENHUM critério que falhe por ausência => FALHA. Todo card precisa de ao menos
           um.
    2. Sonda negativa: rode o próprio classificador contra um card sintético cujo critério é
       comprovadamente decorativo, e exija que ele seja acusado. Se ele passar, o classificador está
       cego e o script sai 1.
    3. Tripwire independente: conte os cards por uma segunda via (contar ocorrências de "^id: " no
       texto cru) e compare com o número de cards que o parser enxergou. Divergência é FALHA, com a
       mensagem dizendo que as duas leituras discordam.
    4. Zero cards parseados é FALHA.
    5. Ligue como etapa nomeada de scripts/gate.sh.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO EXECUTAR os comandos dos critérios. Este verificador é estático: alguns critérios
      gastam dinheiro, e um verificador que executa `generate` é um desastre com exit code.
    - PROIBIDO tocar em scripts/validate-plan.mjs — é de F0-01, e o card já foi mergeado; qualquer
      mudança lá é card novo.
    - PROIBIDO dependência npm.
  </restricoes>

  <swarm>
    <subagents>Agente único. É um arquivo só e a consistência interna é o produto.</subagents>
    <worktree>G-plan — bash scripts/new-task-worktree.sh T-01</worktree>
    <revisao_adversarial>
      Contexto fresco, só com o diff e este card:
        - o verificador passa com um plano SEM NENHUM card feito? (deve passar, mas dizendo
          explicitamente "0 cards feitos — nada a auditar", nunca em silêncio)
        - a sonda negativa detecta o critério `grep ... | wc -l # 0` do card F4-03?
        - o tripwire quebra se eu inserir um bloco yaml dentro de um comentário HTML?
        - o script EXECUTA alguma coisa? (tem de ser não — procure por execSync, spawn, exec)
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    node scripts/check-acceptance.mjs --self-test    # exit 0, acusa >= 2 critérios decorativos
    node scripts/check-acceptance.mjs                # exit 0 contra o plano de hoje
    bash scripts/gate.sh | grep -q "check-acceptance"
    # falha por AUSÊNCIA:
    ! grep -qE "execSync|spawnSync|child_process" scripts/check-acceptance.mjs
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de T-01. Nas Considerações, liste os critérios deste plano que o
    verificador classificou como decorativos — o destinatário é o card dono de cada um.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

## Onda W2 — o fan-out da fundação

Seis cards, arquivos disjuntos, **onda de composição**: todos trabalham sobre a árvore que `F0-02`
acabou de renomear. Commit PREP obrigatório antes das worktrees, trazendo o mapa `arquivo → dono`
abaixo.

#### Um dono por arquivo — onda W2

| Arquivo | Dono | Os outros |
| --- | --- | --- |
| `tools/pixellab-pipeline/src/cost.ts` | **F0-03** | não editam |
| `tools/pixellab-pipeline/src/cli.ts` | **F0-03** | não editam |
| `tools/pixellab-pipeline/src/catalog.ts` | **F0-03** | não editam |
| `tools/pixellab-pipeline/package.json` | **F0-04** | não editam |
| `tools/pixellab-pipeline/scripts/**` | **F0-04** | não editam |
| `tools/character-builder/package.json` | **F0-05** | não editam |
| `scripts/check-pixi-pin.mjs` | **F0-05** | não editam |
| `tools/pixellab-pipeline/assets/catalog.ts` | **F0-06** | não editam |
| `tools/character-builder/src/strings.ts` | **F0-07** | não editam |
| `packages/iso-core/**` | **F0-11** | não editam |

---

### `F0-03` — O guard informa e nunca recusa, e o CLI para de mentir

```yaml
id: F0-03
fase: F0
onda: W2
grupo: G-pipeline
deps: [F0-02]
critico: true
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - tools/pixellab-pipeline/src/cost.ts
  - tools/pixellab-pipeline/src/cli.ts
  - tools/pixellab-pipeline/src/catalog.ts
faixa_ledger: AB-130..AB-139
```

| | |
| --- | --- |
| **Objetivo** | Transformar a ADR 0012 em código: `GuardVerdict` perde a variante `refuse`. E o CLI para de citar três flags que não existem e um diretório que ninguém escreve. |
| **Entradas** | `docs/adr/0012-guard-de-orcamento-informativo.md` · `src/cost.ts` · `src/cli.ts` · `src/catalog.ts`. |
| **Saídas** | guard informativo com `requiresConfirmation` como tipo literal · `ATLAS_OUT` corrigido · zero flags fantasma. |
| **Considerações** | — |

**Os quatro defeitos, verificados no código de hoje:**

| Onde | O que está lá | Por que é defeito |
| --- | --- | --- |
| `src/cost.ts`, `checkBudget` | devolve `kind: 'refuse'` em 4 casos | a ADR 0012 diz que o guard informa e nunca recusa |
| `src/cli.ts`, `ATLAS_OUT` | `packages/game-assets/atlas` | o diretório existe em disco, **vazio e fora do git** — `git ls-files packages` sai vazio |
| `src/catalog.ts`, validação de `seed` | a mensagem manda usar `--allow-unpinned` | a flag **não existe**: o CLI só lê `--dry-run`, `--limit` e `--yes` |
| `src/cost.ts`, motivo de `run-cap` | manda "reduzir o escopo com `--filter` ou elevar `--max-usd`" | **nenhuma das duas existe** |

```xml
<task id="F0-03" nome="Guard informativo e CLI honesto" onda="W2" worktree="G-pipeline">

  <ultrathink>
    Gaste o raciocínio no TIPO, não na mensagem. O ponto da ADR 0012 não é imprimir texto diferente:
    é fazer o compilador impedir que alguém, no futuro, crie um caminho que gera sem perguntar.
    `requiresConfirmation: true` como TIPO LITERAL — não `boolean` — é o que dá essa garantia: um
    relatório que exige confirmação não pode ser construído com `false`, e um caminho novo que
    esqueça de perguntar não compila. Se você modelar isso como boolean, entregou a mensagem e perdeu
    a decisão.
    Cuidado com o segundo efeito: o exit code 2 deixa de significar "recusado pelo orçamento" e passa
    a significar "o usuário não confirmou". Isso está no cabeçalho do cli.ts e em docs — a mudança de
    significado tem de aparecer nos dois.
  </ultrathink>

  <contexto>
    Todo asset gerado gasta dinheiro real. O pipeline é idempotente por design: gerar de novo com o
    mesmo spec não deve gastar nada. O guard é uma camada SEPARADA disso — ele estima, mostra o gasto
    da sessão e do mês, e pede confirmação. O guard é conselho; o cache é lei.
    Hoje o guard recusa em quatro situações, e a ADR 0012 revogou isso.
  </contexto>

  <ler_consideracoes_dos_anteriores>
    Suba o grafo: F0-02 (o que ele renomeou e quais citações reancorou), F0-01 (formato do bloco yaml
    e etapas do gate). Dependências diretas: F0-02.
    Uma consideração de ancestral pode invalidar uma premissa deste card — se isso ocorrer, ajuste o
    TASK_PLAN.md e diga por quê; NÃO siga no automático.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-130..AB-139. Esperado: nenhuma.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/guarding-generation-cost/SKILL.md
    - .agents/skills/writing-repo-typescript/SKILL.md
    - .agents/skills/testing-repo-code/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - docs/adr/0012-guard-de-orcamento-informativo.md — leia inteira. É a decisão que este card
      implementa, e ela é normativa.
    - tools/pixellab-pipeline/src/cost.ts — o tipo GuardVerdict, RefusalCode, DEFAULT_LIMITS e
      checkBudget.
    - tools/pixellab-pipeline/src/cli.ts — cmdEstimate e cmdGenerate leem o veredicto; o cabeçalho do
      arquivo documenta os exit codes; ATLAS_OUT está no topo.
    - tools/pixellab-pipeline/src/catalog.ts — SÓ a mensagem de validação de seed. O resto do arquivo
      é do card F0-09, na onda seguinte: não antecipe.
  </entradas>

  <o_que_fazer>
    1. cost.ts: substitua GuardVerdict por um RELATÓRIO, não uma decisão. Algo com a forma
       `{ readonly avisos: readonly Aviso[]; readonly requiresConfirmation: true } | { readonly avisos: readonly Aviso[]; readonly requiresConfirmation: false }`
       — uma união discriminada por LITERAL, para que o compilador force o tratamento dos dois ramos.
       Cada aviso carrega o código (`asset-cap`, `run-cap`, `monthly-cap`, `balance`), o número medido
       e o limiar. Os quatro limiares MANTÊM os mesmos valores e mudam de significado.
    2. cli.ts, cmdEstimate: imprima todos os avisos e SAIA 0 mesmo acima de qualquer limiar. Estimar
       nunca é um erro.
    3. cli.ts, cmdGenerate: com requiresConfirmation e sem --yes, sai 2 — mas a mensagem passa a ser
       "confirmação necessária", nunca "recusado". Atualize o cabeçalho de exit codes do arquivo.
    4. cli.ts: ATLAS_OUT. Decida entre apontar para um diretório versionado dentro da ferramenta
       (`tools/pixellab-pipeline/atlas/`) ou manter packages/ e versionar um .gitkeep. Escolha uma e
       ESCREVA O PORQUÊ num comentário — hoje ele aponta para um diretório vazio e invisível ao git,
       o que faz `atlas` escrever num lugar que nenhum clone tem.
    5. Mate as flags fantasma. Duas saídas possíveis para cada uma, e as duas são aceitáveis desde
       que declaradas: implementar a flag, ou tirar a menção. NÃO deixe a mensagem prometendo o que
       o binário não faz. Hoje são três: `--allow-unpinned` (catalog.ts), `--filter` e `--max-usd`
       (cost.ts).
    6. Se implementar `--filter`, ele filtra por prefixo de assetId e NÃO altera identidade: filtrar
       não pode mudar specHash de nada.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO tocar em computeSpecHash, inputHash ou PIPELINE_VERSION. Qualquer mudança neles
      invalida cache e cobra tudo de novo — e a mudança planejada é do card F0-09, com teste antes.
    - PROIBIDO tocar em src/*.test.ts — os testes são do card F0-08, que roda na onda seguinte.
    - PROIBIDO modelar requiresConfirmation como boolean.
    - PROIBIDO fazer qualquer chamada de rede. Este card não gasta.
    - PROIBIDO editar docs/adr/0012 — ela é a entrada, não a saída.
    - PROIBIDO `git add -A`.
  </restricoes>

  <swarm>
    <subagents>
      Agente único. A coerência entre o tipo em cost.ts e os dois call sites em cli.ts É o produto;
      dividi-la entre agentes é exatamente como se produz um merge limpo que não integra.
    </subagents>
    <worktree>G-pipeline — bash scripts/new-task-worktree.sh F0-03</worktree>
    <revisao_adversarial>
      Contexto fresco, só o diff e este card:
        - existe algum caminho em que `generate` submete sem ter impresso o custo? Siga do
          `process.argv` até o `client.submit`.
        - `requiresConfirmation` é tipo literal ou boolean? Se for boolean, o card falhou no objetivo.
        - `estimate` sai 0 com um catálogo que estoura TODOS os quatro limiares ao mesmo tempo?
        - sobrou alguma string "recusado" ou "RECUSADO" no CLI?
        - alguma mensagem ainda cita flag que o binário não implementa?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/pixellab-pipeline && npm run typecheck                    # exit 0
    cd tools/pixellab-pipeline && npm test                             # exit 0
    cd tools/pixellab-pipeline && node src/cli.ts estimate; test $? -eq 0
    # falha por AUSÊNCIA — controle positivo primeiro, para provar que o grep enxerga o arquivo:
    grep -q "requiresConfirmation" tools/pixellab-pipeline/src/cost.ts
    ! grep -rn "kind: 'refuse'\|kind: \"refuse\"\|RefusalCode" tools/pixellab-pipeline/src/
    ! grep -rn -- "--allow-unpinned\|--max-usd" tools/pixellab-pipeline/src/
    # e o teto continua VISÍVEL, não silencioso:
    node src/cli.ts estimate | grep -q "Mês corrente"
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F0-03. Nas Considerações publique: a assinatura FINAL do relatório do
    guard (é contrato para F0-08, que vai testá-la, e para F1-06, que vai renderizá-la na tela) e a
    decisão que você tomou sobre ATLAS_OUT, com o porquê. Destinatários nomeados: F0-08, F1-06.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F0-04` — As mentiras do `package.json`: `zod`, `schema.d.ts` e `refresh-openapi`

```yaml
id: F0-04
fase: F0
onda: W2
grupo: G-pipeline
deps: [F0-02]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - tools/pixellab-pipeline/package.json
  - tools/pixellab-pipeline/scripts/refresh-openapi.mjs
faixa_ledger: AB-140..AB-149
```

| | |
| --- | --- |
| **Objetivo** | Três promessas do `package.json` que não se cumprem viram decisão, não pendência. |
| **Entradas** | `tools/pixellab-pipeline/package.json` · `openapi/PROVENIENCIA.txt`. |
| **Saídas** | `package.json` verdadeiro · `scripts/refresh-openapi.mjs` existindo ou o script removido. |
| **Considerações** | — |

**As três, verificadas em 2026-07-30:**

| Promessa | Realidade |
| --- | --- |
| `"codegen": "openapi-typescript ... -o openapi/schema.d.ts"` | `openapi/schema.d.ts` **não existe em disco**, e nenhum arquivo o importa |
| `"zod": "^3.24.1"` em `dependencies` | **nunca importado**: `grep -rn "from 'zod'" tools/` sai vazio |
| `"refresh-openapi": "node scripts/refresh-openapi.mjs"` | `tools/pixellab-pipeline/scripts/` **não existe** |

```xml
<task id="F0-04" nome="Higiene de dependências e codegen" onda="W2" worktree="G-pipeline">

  <ultrathink>
    O raciocínio aqui é sobre PROVENIÊNCIA, não sobre limpeza. O refresh-openapi não é um npm script
    qualquer: é o procedimento que troca a fonte da verdade da API inteira. Se ele existir, tem de
    baixar o spec, RECALCULAR o sha256, regravar o PROVENIENCIA.txt com a data nova, e deixar o
    diff visível — porque a API muda sem versionar (info.version é literalmente "dev") e a lista de
    mudanças do fornecedor é o diff, não um changelog.
  </ultrathink>

  <contexto>
    A fonte da verdade sobre a API do PixelLab neste repositório é o spec vendorizado em
    tools/pixellab-pipeline/openapi/openapi-v2.json, capturado em 2026-07-29, com sha256 no
    PROVENIENCIA.txt ao lado. Escrever sobre a API de memória é proibido pelo AGENTS.md.
    Drift de schema é AVISO do doctor, nunca invalidação de cache — o hash do schema deliberadamente
    NÃO entra no specHash.
  </contexto>

  <ler_consideracoes_dos_anteriores>F0-02, F0-01. Dependências diretas: F0-02.</ler_consideracoes_dos_anteriores>
  <questoes_abertas>Faixa AB-140..AB-149.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/querying-pixellab-api/SKILL.md
    - .agents/skills/writing-repo-typescript/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - tools/pixellab-pipeline/package.json
    - tools/pixellab-pipeline/openapi/PROVENIENCIA.txt — o formato que o refresh tem de regravar:
      linha de origem e data, linha de estatísticas, e o sha256 sozinho numa linha.
    - tools/pixellab-pipeline/src/cli.ts, função openapiFingerprint — ela EXTRAI o sha256 e a data do
      PROVENIENCIA.txt por regex. O formato que você gravar tem de continuar casando.
  </entradas>

  <o_que_fazer>
    1. zod: decida entre USAR (validando o corpo das respostas em src/api.ts) ou REMOVER da
       dependência. Não há terceira opção. Se remover, diga no commit por quê: o repositório valida
       forma em src/endpoints.ts, à mão e contra o spec, e uma segunda camada de validação sem dono
       é peso morto.
    2. codegen / schema.d.ts: decida entre gerar e COMMITAR o schema.d.ts (e então usá-lo ao menos
       em um ponto, ou ele apodrece igual), ou remover o script. Um artefato gerado que ninguém
       importa e que não está em disco é uma promessa sem cumpridor.
    3. refresh-openapi: crie tools/pixellab-pipeline/scripts/refresh-openapi.mjs, que baixa de
       https://api.pixellab.ai/v2/openapi.json, grava o arquivo, recalcula o sha256, regrava o
       PROVENIENCIA.txt com a data de hoje em ISO e imprime um resumo do diff de paths (quais
       apareceram, quais sumiram). OU remova o script do package.json. Se criar, ele NÃO roda no gate
       — é operação manual e deliberada.
    4. Se qualquer decisão for "remover", ela tem de aparecer no comentário do package.json ou na
       mensagem de commit. Uma remoção sem motivo escrito volta na próxima varredura de consistência.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO tocar em src/**. Este card é package.json e scripts/.
    - PROIBIDO rodar o refresh-openapi de verdade neste card. Trocar o spec vendorizado é decisão
      própria, com typecheck quebrado como lista de mudanças — não efeito colateral de um card de
      higiene.
    - PROIBIDO acrescentar dependência nova.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-pipeline — bash scripts/new-task-worktree.sh F0-04</worktree>
    <revisao_adversarial>
      Contexto fresco: o PROVENIENCIA.txt que o script regravaria ainda casa a regex de
      openapiFingerprint em cli.ts? (`/^[0-9a-f]{64}$/m` e `/\d{4}-\d{2}-\d{2}/`)
      Sobrou algum script no package.json apontando para arquivo inexistente?
      Se você removeu zod, `npm ls` continua consistente com o package-lock.json?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/pixellab-pipeline && npm run typecheck        # exit 0
    cd tools/pixellab-pipeline && npm test                 # exit 0
    node src/cli.ts doctor | grep -c "^  ERRO"             # 0
    # falha por AUSÊNCIA: todo script do package.json aponta para algo que existe
    node -e "const p=require('./tools/pixellab-pipeline/package.json');const fs=require('fs');for(const[k,v]of Object.entries(p.scripts)){const m=v.match(/scripts\/[\w.-]+/);if(m&&!fs.existsSync('tools/pixellab-pipeline/'+m[0]))throw new Error(k+' aponta para '+m[0]+', que não existe')}"
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F0-04. Publique nas Considerações a decisão tomada em cada uma das
    três, com o motivo em uma linha. Destinatário: qualquer card futuro que vá querer validação de
    resposta ou tipos gerados.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F0-05` — PixiJS 8.19.0 instalado no builder, com verificador de pino

```yaml
id: F0-05
fase: F0
onda: W2
grupo: G-builder
deps: [F0-02]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - tools/character-builder/package.json
  - scripts/check-pixi-pin.mjs
faixa_ledger: AB-150..AB-159
```

| | |
| --- | --- |
| **Objetivo** | O renderizador entra no projeto, na versão **exata** que já está vendorizada — e um verificador falha se os dois pinos divergirem. |
| **Entradas** | `tools/pixi-reference/package.json` (pin `8.19.0`) · `tools/pixi-reference/vendor/manifest.json` (`pixiVersion`). |
| **Saídas** | `pixi.js@8.19.0` como dependência do builder · `scripts/check-pixi-pin.mjs` no gate. |
| **Considerações** | — |

**Por que isto é da fundação e não da Fase 2.** `tools/pixi-reference` não é o cliente: ele fixa uma
versão para que as skills possam **citar** uma superfície de API real em vez de lembrar dela. Se o
builder instalar outra versão, as dez skills de PixiJS passam a atestar uma API que o código não usa
— e `check-pixi-claims.mjs` continua verde, porque ele confere contra o vendor, não contra o
`node_modules` do builder.

```xml
<task id="F0-05" nome="PixiJS 8.19.0 no builder com verificador de pino" onda="W2" worktree="G-builder">

  <ultrathink>
    O ponto é a DIVERGÊNCIA SILENCIOSA entre dois pinos, não a instalação. Um `^8.19.0` no builder
    resolve para 8.20 no primeiro `npm install` de uma máquina nova, as skills continuam citando
    8.19.0, e nada fica vermelho. Pin exato nos dois lados, e um verificador que compara os três
    lugares: package.json do pixi-reference, manifest.json do vendor, package.json do builder.
  </ultrathink>

  <contexto>
    tools/pixi-reference vendoriza pixi.js 8.19.0: 47.533 linhas de declarações de tipo e as 26
    skills oficiais que o próprio pacote publica, com proveniência e verificador
    (docs/adr/0009-conhecimento-pixijs-vendorizado.md). O editor de cena é o produto neste projeto,
    e é por isso que o PixiJS continua (docs/adr/0014-pixijs-para-o-editor.md).
  </contexto>

  <ler_consideracoes_dos_anteriores>F0-02, F0-01. Dependências diretas: F0-02.</ler_consideracoes_dos_anteriores>
  <questoes_abertas>Faixa AB-150..AB-159.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/routing-pixijs-work/SKILL.md   (sub-router — entre por ele, não pelas 26)
    - .agents/skills/bootstrapping-pixi-app/SKILL.md
    - .agents/skills/choosing-pixi-renderer/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - tools/pixi-reference/package.json — o pin canônico, "pixi.js": "8.19.0", sem acento de circunflexo.
    - tools/pixi-reference/vendor/manifest.json — campo pixiVersion e capturedAt.
    - node tools/pixi-reference/scripts/vendor-types.mjs --check — o verificador que já existe.
  </entradas>

  <o_que_fazer>
    1. Acrescente "pixi.js": "8.19.0" — versão EXATA, sem ^ nem ~ — às dependencies de
       tools/character-builder/package.json. Rode npm install e commite o package-lock.json.
    2. scripts/check-pixi-pin.mjs: lê os três lugares e falha se qualquer par divergir, imprimindo os
       três valores. Falha também se o pino do builder tiver faixa (^, ~, *, x) em vez de versão
       exata. Ligue como etapa nomeada do gate.sh.
    3. NÃO escreva nenhum código de renderização. Este card instala e verifica; desenhar é F2-05.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO subir a versão do pin. Se 8.19.0 tiver algum problema, isso é card novo com ADR.
    - PROIBIDO editar tools/pixi-reference/vendor/** — o diretório é gerado, e um vendor editado à
      mão não vale como proveniência de nada.
    - PROIBIDO importar pixi.js em qualquer arquivo ainda.
    - PROIBIDO usar faixa de versão.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-builder — bash scripts/new-task-worktree.sh F0-05</worktree>
    <revisao_adversarial>
      Contexto fresco: o verificador acusa se eu trocar o pin do builder para "^8.19.0"? E se eu
      trocar para "8.19.1"? Ele lê os TRÊS lugares ou só dois? `npm ls pixi.js` no builder imprime
      exatamente 8.19.0?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/character-builder && npm ls pixi.js | grep -q "pixi.js@8.19.0"
    node scripts/check-pixi-pin.mjs                              # exit 0
    node tools/pixi-reference/scripts/vendor-types.mjs --check   # exit 0
    bash scripts/gate.sh | grep -q "check-pixi-pin"
    # falha por AUSÊNCIA: nenhuma faixa de versão no pin
    ! grep -E '"pixi\.js": *"[\^~]' tools/character-builder/package.json
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F0-05. Nas Considerações registre o tamanho do node_modules resultante
    e se o `npm install` puxou peer dependency inesperada. Destinatário: F2-05.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F0-06` — O catálogo de assets deixa de descrever o produto anterior

```yaml
id: F0-06
fase: F0
onda: W2
grupo: G-pipeline
deps: [F0-02]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - tools/pixellab-pipeline/assets/catalog.ts
faixa_ledger: AB-160..AB-169
```

| | |
| --- | --- |
| **Objetivo** | O catálogo de exemplo passa a descrever **um projeto de demonstração do editor**, e para de citar uma pasta de docs que foi apagada. |
| **Entradas** | `tools/pixellab-pipeline/assets/catalog.ts`. |
| **Saídas** | catálogo mínimo, coerente com o editor, com seeds pinados. |
| **Considerações** | — |

**Dois defeitos verificados.** O comentário do bloco `CREATURES` cita `docs/02-design` como fonte da
verdade — pasta que **não existe mais** (o pivô apagou o design de combate). E o bloco `ANIMATIONS`
justifica os templates dizendo que "a biblioteca entrega exatamente o que um jogo de combate corpo a
corpo precisa", que é uma frase do produto anterior.

```xml
<task id="F0-06" nome="Catálogo de demonstração do editor" onda="W2" worktree="G-pipeline">

  <ultrathink>
    Atenção ao que este card NÃO pode quebrar: o catálogo é CÓDIGO QUE AVALIA PARA DADOS, e o hash é
    tirado sobre os dados resolvidos, nunca sobre o texto-fonte. Renomear variável, reformatar ou
    trocar o comentário custa ZERO. Mas mudar `description`, `seed`, `image_size` ou qualquer campo
    que entra em `params` MUDA O specHash — e specHash diferente é geração nova, é dinheiro.
    Como o lockfile ainda não existe e nada foi gerado, hoje isso é grátis. Registre no commit que a
    janela de gratuidade é ESTA, e que depois do primeiro `generate` a mesma edição custa.
  </ultrathink>

  <contexto>
    Este é um editor isométrico local. Não há jogo em produção, não há GDD, não há lista de 60
    criaturas. O catálogo de exemplo existe para que `plan`, `estimate` e o teste de idempotência
    tenham o que resolver — não para produzir a arte de um jogo específico.
  </contexto>

  <ler_consideracoes_dos_anteriores>F0-02, F0-01. Dependências diretas: F0-02.</ler_consideracoes_dos_anteriores>
  <questoes_abertas>Faixa AB-160..AB-169.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/guarding-generation-cost/SKILL.md
    - .agents/skills/generating-pixellab-characters/SKILL.md
    - .agents/skills/querying-pixellab-api/SKILL.md   (hub — carregue ANTES da anterior)
  </skills_obrigatorias>

  <entradas>
    - tools/pixellab-pipeline/assets/catalog.ts
    - tools/pixellab-pipeline/src/catalog.ts — os helpers character8dir, animateCharacter, mapObject
      e tileset. Você CHAMA esses helpers; não os edita (são de F0-09).
  </entradas>

  <o_que_fazer>
    1. Reduza a um projeto de demonstração honesto: UM personagem, UM tileset, UM prop. O catálogo
       grande de criaturas descrevia outro produto e, pior, dava a impressão de que gerar tudo era o
       fluxo normal.
    2. Reescreva os comentários que citam docs/02-design e "combate corpo a corpo". A referência
       correta é docs/00-produto/visao.md.
    3. Mantenha os seeds PINADOS. `buildPlan` reprova spec sem seed, e com razão: sem seed a geração
       não é reprodutível.
    4. Mantenha a PALETTE exportada — ela é o mecanismo mais forte de consistência de estilo, e o
       estúdio tem uma cópia dela em server/model.ts (seedStudio). Se você mudar a paleta aqui,
       ELAS DIVERGEM. Ou não mude, ou abra item no ledger nomeando a duplicação.
    5. NÃO acrescente asset novo com endpoint que a COST_TABLE não conhece — `COST_TABLE[endpoint]`
       é indexação direta e um endpoint ausente explode na hora de estimar.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO tocar em src/catalog.ts, src/cost.ts, src/cli.ts — outros cards desta MESMA onda são
      donos deles.
    - PROIBIDO rodar `generate`. Este card não gasta.
    - PROIBIDO deixar asset sem seed.
    - PROIBIDO usar mode:'pro' em qualquer lugar sem ADR nova.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-pipeline — bash scripts/new-task-worktree.sh F0-06</worktree>
    <revisao_adversarial>
      Contexto fresco: `node src/cli.ts plan` resolve sem erro de validação? Algum asset ficou sem
      seed? A paleta daqui ainda é idêntica à de tools/character-builder/server/model.ts? Algum
      comentário ainda cita pasta de docs que não existe?
      (comando: grep -o "docs/[0-9a-z-]*" tools/pixellab-pipeline/assets/catalog.ts | sort -u,
       e conferir cada uma com test -d)
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/pixellab-pipeline && npm run typecheck                 # exit 0
    cd tools/pixellab-pipeline && node src/cli.ts plan; test $? -eq 0
    node src/cli.ts plan | grep -q "Nada foi gerado"
    # falha por AUSÊNCIA: toda pasta de docs citada existe
    for d in $(grep -o "docs/[0-9a-z/-]*" assets/catalog.ts | sort -u); do test -e "../../$d" || { echo "FALHA: $d"; exit 1; }; done
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F0-06. Publique o número de assets do catálogo novo e o custo estimado
    total do `plan`. Destinatário: F0-08, que vai usar este catálogo como fixture do teste de
    idempotência.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F0-07` — Strings do editor em pt-BR, centralizadas e por propriedade direta

```yaml
id: F0-07
fase: F0
onda: W2
grupo: G-builder
deps: [F0-02]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - tools/character-builder/src/strings.ts
faixa_ledger: AB-170..AB-179
```

| | |
| --- | --- |
| **Objetivo** | Implementar a ADR 0016: todo texto que o usuário lê sai de um objeto congelado, acessado por **propriedade direta**, nunca por `t('chave')`. |
| **Entradas** | `docs/adr/0016-ui-ptbr-strings-centralizadas.md` · as strings hoje inline em `tools/character-builder/src/main.ts`. |
| **Saídas** | `src/strings.ts` com o objeto congelado e as strings de hoje migradas. |
| **Considerações** | — |

**Por que propriedade direta e não `t()`.** Os dois `tsconfig.json` deste repositório ligam
`noUncheckedIndexedAccess`. Indexar um objeto por string devolve `T | undefined` — então uma chave
faltando vira string vazia na tela, em silêncio. Com acesso por propriedade, chave faltando é **erro
de compilação**.

```xml
<task id="F0-07" nome="Strings pt-BR centralizadas" onda="W2" worktree="G-builder">

  <ultrathink>
    O risco deste card é virar um dicionário grande e vazio. Migre SÓ as strings que já existem na
    tela hoje; não invente texto para telas que ainda não foram escritas — doc especulativa e string
    especulativa apodrecem igual. E não achate acento: o texto do editor é português do Brasil, com
    acentuação, e isso volta a importar quando a UI for desenhada em canvas (glifo faltando não
    aparece, e nada fica vermelho).
  </ultrathink>

  <contexto>
    Todo texto que o usuário do editor lê é português do Brasil; código, identificadores e chaves de
    JSON de dados são em inglês (docs/adr/0008). Hoje as strings da tela estão inline em
    src/main.ts — há placeholders em português e em inglês misturados no mesmo formulário.
  </contexto>

  <ler_consideracoes_dos_anteriores>F0-02, F0-01. Dependências diretas: F0-02.</ler_consideracoes_dos_anteriores>
  <questoes_abertas>Faixa AB-170..AB-179.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/building-pixi-ui/SKILL.md
    - .agents/skills/writing-repo-typescript/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - docs/adr/0016-ui-ptbr-strings-centralizadas.md — normativa.
    - tools/character-builder/src/main.ts — LEIA para inventariar as strings, mas NÃO EDITE: o
      arquivo é do card F1-01 em diante. Este card só cria strings.ts.
  </entradas>

  <o_que_fazer>
    1. Crie tools/character-builder/src/strings.ts exportando um objeto `as const` (congelado),
       organizado por área: `comum`, `personagem`, `custo`, `erro`.
    2. Inventarie as strings de src/main.ts e migre as que já estão na tela. Deixe as chaves em
       INGLÊS (é código) e os valores em português do Brasil (é texto de usuário).
    3. Onde o placeholder de hoje está em inglês por ser um PROMPT enviado à API (por exemplo
       "wearing a rusted chainmail hauberk"), NÃO traduza: aquilo não é texto de UI, é entrada da
       API. Separe os dois casos explicitamente no arquivo, com um comentário dizendo qual é qual.
    4. Acrescente um teste que percorre o objeto e falha se algum valor for string vazia.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO editar src/main.ts. Você só cria strings.ts. A troca dos usos é card posterior.
    - PROIBIDO expor uma função t(chave: string). O acesso é por propriedade.
    - PROIBIDO traduzir prompt de API.
    - PROIBIDO adicionar biblioteca de i18n. Não há segundo idioma no escopo.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-builder — bash scripts/new-task-worktree.sh F0-07</worktree>
    <revisao_adversarial>
      Contexto fresco: existe alguma string de UI que ficou em inglês? Alguma chave que só é
      alcançável por indexação? O objeto é realmente `as const`? Algum prompt de API foi traduzido
      por engano — o que quebraria a geração sem quebrar nenhum teste?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/character-builder && npm run typecheck    # exit 0
    # falha por AUSÊNCIA e por FORMA:
    grep -q "as const" tools/character-builder/src/strings.ts
    ! grep -qE "export (const|function) t\b" tools/character-builder/src/strings.ts
    # controle positivo: o arquivo tem conteúdo de verdade
    test "$(grep -c ":" tools/character-builder/src/strings.ts)" -ge 15
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F0-07. Publique a forma exata do objeto e o nome do import.
    Destinatários: F1-01, F1-06, F1-08.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F0-11` — `packages/iso-core`: o formato de projeto, escrito e relido

```yaml
id: F0-11
fase: F0
onda: W2
grupo: G-core
deps: [F0-02]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - packages/iso-core/package.json
  - packages/iso-core/tsconfig.json
  - packages/iso-core/src/project.ts
  - packages/iso-core/src/project.test.ts
faixa_ledger: AB-180..AB-189
```

| | |
| --- | --- |
| **Objetivo** | Criar o terceiro lugar — o núcleo compartilhado — e fazer o primeiro `project.json` ser escrito e relido, para que a ADR do formato seja escrita **contra evidência**. |
| **Entradas** | `docs/adr/0013-geometria-isometrica-64x32-z16.md`. |
| **Saídas** | `packages/iso-core` com schema v1, `saveProject`/`loadProject` e um teste de ida e volta. |
| **Considerações** | — |

**Por que existe um `packages/iso-core`.** O critério mais duro do plano é o da Fase 4: o runtime não
pode importar nada de dentro do editor. Se geometria, formato de projeto e colisão morarem no
editor, esse critério é impossível de cumprir sem duplicar código. O núcleo compartilhado é o que
torna o critério alcançável — e é a razão de ele ser card da fundação e não da Fase 2.

```xml
<task id="F0-11" nome="iso-core e o formato de projeto v1" onda="W2" worktree="G-core">

  <ultrathink>
    Gaste o raciocínio na FRONTEIRA do pacote, não no schema. iso-core não pode importar NADA de
    tools/**: nem o cliente da API, nem o PixiJS, nem o pipeline. Ele é o único módulo que o editor e
    o runtime compartilham, e a única forma de garantir isso é ele não conhecer nenhum dos dois.
    Sobre o schema: escreva o MÍNIMO que já serializa alguma coisa de verdade. A tentação é
    especificar mapa, blocos, arestas e animações agora — e cada campo escrito antes de existir
    consumidor é ficção que vai ter de ser desfeita.
  </ultrathink>

  <contexto>
    O artefato do editor é um projeto JSON mais os atlas. Tile 64×32, um nível Z vale 16 px, Z
    inteiro e discreto (docs/adr/0013). O formato do arquivo de projeto ainda NÃO tem ADR: ela é o
    card F0-12, e foi adiada de propósito para depois que algo tenha serializado — decidir o schema
    antes de qualquer coisa serializar é o equivalente em ADR da doc especulativa que a convenção 12
    proíbe.
  </contexto>

  <ler_consideracoes_dos_anteriores>F0-02, F0-01. Dependências diretas: F0-02.</ler_consideracoes_dos_anteriores>
  <questoes_abertas>Faixa AB-180..AB-189. Aqui é PROVÁVEL abrir itens: tudo que você tiver de supor
    sobre o formato antes de o mapa existir é candidato.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/writing-repo-typescript/SKILL.md
    - .agents/skills/testing-repo-code/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - docs/adr/0013-geometria-isometrica-64x32-z16.md
    - tools/pixellab-pipeline/tsconfig.json — copie as MESMAS opções estritas:
      noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax, erasableSyntaxOnly.
      Um pacote com regras mais frouxas que os consumidores é uma porta dos fundos.
    - tools/pixellab-pipeline/src/atlas.ts — o formato do sidecar .pixellab.json, que é o vizinho
      mais próximo em espírito: JSON do Pixi separado da semântica do jogo.
  </entradas>

  <o_que_fazer>
    1. packages/iso-core/package.json — nome @isometric-maker/iso-core, private, type module,
       engines node >= 24, ZERO dependências. Scripts: typecheck e test (node --test src/*.test.ts).
    2. src/project.ts — a versão 1 do formato, e só o que já tem consumidor:
         - `schemaVersion: 1` literal;
         - identificação do projeto (nome, data de criação em ISO);
         - a geometria como DADO, não como constante escondida: tileWidth 64, tileHeight 32,
           zStep 16 — para que o runtime leia do arquivo em vez de assumir;
         - a lista de atlas referenciados por caminho relativo;
         - um campo `map` OPCIONAL e ainda vazio, com um comentário dizendo que o card F2-02 é o dono
           dele. Reservar o nome é barato; inventar a estrutura agora é caro.
       Mais `saveProject(path, project)` com escrita atômica (tmp + rename) e `loadProject(path)` que
       REJEITA schemaVersion desconhecida com erro nomeado — não com um cast.
    3. src/project.test.ts — ida e volta: escrever, reler, comparar profundamente; e um teste que
       falha por AUSÊNCIA: um JSON sem `schemaVersion` tem de ser rejeitado, não aceito com default.
    4. Rode o teste e deixe um projeto de exemplo escrito em disco, fora do git, para provar que a
       coisa serializou de verdade. O card F0-12 vai ler esse arquivo para escrever a ADR.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO importar qualquer coisa de tools/**. Verificável e verificado no critério.
    - PROIBIDO acrescentar dependência npm, inclusive de validação de schema.
    - PROIBIDO especificar o formato do mapa (blocos, arestas, RLE). É do card F2-02, e escrevê-lo
      aqui é decidir sem o consumidor na mesa.
    - PROIBIDO usar `any` ou cast para contornar o strict. Se o tipo não fecha, o modelo está errado.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-core — bash scripts/new-task-worktree.sh F0-11</worktree>
    <revisao_adversarial>
      Contexto fresco, só o diff e este card:
        - loadProject aceita um JSON sem schemaVersion? (tem de rejeitar)
        - aceita schemaVersion: 2? (tem de rejeitar, com erro nomeado)
        - a escrita é atômica de verdade, ou um crash no meio deixa o arquivo pela metade?
        - existe algum import de tools/ ou de pixi.js?
        - o teste de ida e volta compararia igual se saveProject não escrevesse NADA?
          (se sim, o teste está lendo o objeto em memória, não o disco — é fixture alimentando a
          própria asserção)
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd packages/iso-core && npm run typecheck     # exit 0
    cd packages/iso-core && npm test              # exit 0
    # falha por AUSÊNCIA — a fronteira do pacote, com controle positivo antes:
    grep -rq "export" packages/iso-core/src/project.ts
    ! grep -rn "from '.*tools/" packages/iso-core/src/
    ! grep -rn "pixi" packages/iso-core/src/
    test "$(node -e "console.log(Object.keys(require('./packages/iso-core/package.json').dependencies||{}).length)")" -eq 0
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F0-11. Publique o SCHEMA EXATO da versão 1 e o caminho do arquivo de
    exemplo que ficou em disco. Destinatários nomeados: F0-12 (a ADR), F2-02 (o dono do campo map),
    F2-09 (a exportação) e F4-01 (o carregador do runtime).
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

## Onda W2.5 — a única despesa planejada

### `I-02` — Quatro perguntas que só dinheiro responde

```yaml
id: I-02
fase: infra
onda: W2.5
grupo: G-infra
deps: [I-01, F0-03]
critico: true
gasta: sim
worktree: nao
estado: pendente
arquivos:
  - docs/plano/experimentos/
faixa_ledger: AB-020..AB-039
```

| | |
| --- | --- |
| **Objetivo** | Fechar as quatro incógnitas que nenhuma leitura de spec resolve — o spec já foi lido inteiro — e a quinta, que é grátis. |
| **Entradas** | conta com crédito (`I-01`) · guard informativo (`F0-03`) · o spec vendorizado. |
| **Saídas** | `docs/plano/experimentos/*.md` com pergunta, corpo enviado, resposta crua, `usage` medido e veredicto · itens do ledger fechados **com evidência**. |
| **Considerações** | — |

**Onda fracionária, no branch principal, sem worktree.** Este card gasta dinheiro real e escreve no
ledger — que é um singleton. Rodá-lo dentro de uma onda paralela é como se corrompe o `ledger.ndjson`
e como se perde a atribuição de quem gastou o quê.

#### As quatro perguntas, com o corpo exato de cada requisição

Cada resposta é gravada **crua**, com o `usage` inteiro. `usage.type` diz se cobrou em `usd` ou em
`generations`, e as duas unidades nunca se somam.

#### E1 — O que `isometric: true` faz

O spec descreve o campo em quatro palavras: *"Generate in isometric view"*. Não se sabe se ele muda a
projeção de verdade, se apenas enviesa o prompt, se compõe com `view` ou o sobrescreve, nem se as 8
direções continuam sendo as mesmas 8 direções sob esse modo.

**Deve ser a primeiríssima despesa.** O campo entra em `params`, `params` entra no `specHash`
(`computeSpecHash`, `tools/pixellab-pipeline/src/catalog.ts`), e virá-lo depois invalida **todo**
personagem já gerado e recobra tudo.

```json
POST /create-character-with-8-directions
{ "description": "bald naked humanoid mannequin, neutral skin, no clothing, plain body, pixel art",
  "image_size": { "width": 64, "height": 64 },
  "view": "low top-down", "mode": "standard", "seed": 424242 }
```

E a mesma requisição com `"isometric": true` acrescentado, **mesmo seed**. Custo estimado:
2 × US$ 0,0173 = **~US$ 0,035** (`COST_TABLE['create-character-with-8-directions']`, ponto medido de
64×64).

Compare lado a lado: a projeção mudou? as proporções? o canvas devolvido tem o mesmo tamanho? a
chave `south` continua sendo o sul?

#### E2 — A lista truncada de templates

O `...` está **literalmente dentro da string do spec**: a truncagem é do fornecedor, não da nossa
leitura. O visível é `angry, attack, attack-back, attack-left, attack-right, backflip, bark,
breathing-idle, cross-punch, crouched-walking, ...` — dez, em ordem alfabética, parando no `c`. E o
exemplo embutido no schema `CreateCharacterAnimationRequest` usa `"walking-4-frames"`, **um id que
não está no prefixo visível**.

```json
POST /animate-character
{ "character_id": "<o personagem de E1>", "mode": "template",
  "template_animation_id": "walking-4-frames", "directions": ["south"], "seed": 424242 }
```

Custo estimado: 1 × US$ 0,0143 (cobra **por direção**, e aqui é uma só).

**Sub-pergunta decisiva, e vale mais que a resposta principal:** id inválido dá 422 **antes** ou
**depois** de cobrar? Faça uma segunda chamada com `"template_animation_id": "isto-nao-existe"` e
leia o `usage`. Se cobrar antes de validar, todo card que passar um id de template precisa validar
localmente primeiro.

#### E3 — Quanto `mode: 'v3'` cobra por direção

**Três trechos do mesmo spec conflitam.** A seção *Pricing* diz "Custom mode: 20-40 generations per
direction"; a seção *V3 Mode* descreve v3 como o modo custom padrão; a seção *Pro Mode* atribui os
mesmos 20-40 ao `pro`. A tabela da ADR 0006 **não tem fonte no spec** — é a afirmação menos
sustentada do repositório.

Isto **não é acadêmico**: o construtor de personagem de hoje usa `mode: 'v3'` para *caminhar*,
*correr* e *pular* (`tools/character-builder/server/model.ts`, `seedStudio`), que são justamente as
três animações que nenhum template cobre. A 1 geração por direção, um personagem completo custa
~US$ 0,35. A 20, custa **~US$ 7,00**.

```json
POST /animate-character
{ "character_id": "<o personagem de E1>", "mode": "v3",
  "action_description": "walking forward at a steady pace",
  "frame_count": 4, "directions": ["south"], "seed": 424242 }
```

Custo estimado se a hipótese barata valer: US$ 0,0143. Se a cara valer: até US$ 0,29 **nesta única
chamada**. Aceite os dois — é exatamente o número que se está comprando.

Aproveite e confira `keep_first_frame`: o spec diz que ele é `mode='v3'` **apenas** e default `true`.
O replanejamento tratou esse campo como se valesse também no modo template; **não vale**. Verificado
no spec em 2026-07-30.

#### E4 — O shape de `tile_rules`

`GET /tiles-pro/{tile_id}` descreve `tile_rules` em prosa e **não tipa nada**. A descrição diz:
*rule_type `edge|corner|outline`, arity 4 (arestas ou cantos de quadrado/isométrico) ou 6 (arestas de
hex), connectivity `same|other`, terrains [feature, background]*. Qual peça é a **porta** e qual é a
**escada** não tem campo documentado.

```json
POST /create-tiles-pro
{ "description": "stone dungeon construction kit", "tile_type": "isometric",
  "tile_size": 64, "tile_feature": "building",
  "building_wall_tiles": 2, "building_wall_description": "grey stone brick walls",
  "building_floor_description": "worn stone flagstone floor", "seed": 424242 }
```

Depois: `GET /tiles-pro/{tile_id}` e grave a resposta inteira.

> **Custo: NÃO MEDIDO.** `create-tiles-pro` **não está na `COST_TABLE`** nem em `ENDPOINT_IDS`
> (`tools/pixellab-pipeline/src/cost.ts` e `src/endpoints.ts`). Isso tem duas consequências
> imediatas: o pipeline **não consegue estimar** essa chamada hoje, e você terá de fazê-la **fora**
> do pipeline, com `fetch` direto. Faça UMA. Leia o `usage`. É a primeira medição real desse
> endpoint neste projeto.

#### E5 — A pergunta grátis

`GET /characters/{character_id}` devolve, entre outros campos, `rotation_urls` e **`skeletons`**.
Se `skeletons` vier populado pelo caminho `standard`, o passo de esqueleto da Fase 1 custa **zero** —
`estimate-skeleton` (US$ 0,0051) deixa de ser necessário.

```bash
curl -s -H "Authorization: Bearer $PIXELLAB_SECRET" \
  "https://api.pixellab.ai/v2/characters/<o personagem de E1>" | head -c 4000
```

Zero geração. Faça sempre, e faça primeiro entre as leituras.

#### Ordem, e o total

| # | Experimento | Gerações | USD estimado |
| --- | --- | --- | --- |
| E1 | `isometric` com e sem | 2 | ~0,035 |
| E5 | `GET /characters/{character_id}` | 0 | **0,000** |
| E2 | template id + id inválido | 1 + ? | ~0,014 + ? |
| E3 | `mode:'v3'` numa direção | 1 a 20 | 0,014 a 0,29 |
| E4 | `create-tiles-pro` building | ? | **não medido** |
| | **Total** | | **~US$ 0,06 a ~US$ 0,35 + tiles** |

**Pare e reavalie** se o total real passar de US$ 1,00. Isso significaria que uma das hipóteses de
custo está ordens de grandeza errada, e a decisão seguinte é sua, não do plano.

#### Critérios de aceitação

```bash
cd /home/ondokai/Projects/isometric-maker
test -d docs/plano/experimentos
# um arquivo por experimento, e cada um contém o usage medido:
for e in E1 E2 E3 E4 E5; do
  test -f "docs/plano/experimentos/$e.md" || { echo "FALHA: falta $e"; exit 1; }
  grep -q '"usage"' "docs/plano/experimentos/$e.md" || { echo "FALHA: $e sem usage cru"; exit 1; }
done
# falha por AUSÊNCIA: nenhum item do ledger pode estar fechado sem evidência citável
node scripts/validate-plan.mjs --ledger
# e o gasto real bate com o ledger:
cd tools/pixellab-pipeline && node src/cli.ts balance
```

#### Ao concluir

Feche, **com evidência anexada**, os itens do ledger `AB-020..AB-039`. Evidência tem forma
verificável: `arquivo:linha`, saída de comando salva, ou a resposta crua da API com data. As
não-evidências `"ok"`, `"confirmado"` e `"conforme combinado"` são rejeitadas pelo validador — sem
essa lista negra a regra vira decorativa.

> **Item marcado CONFIRMADO sem evidência anexada é pior que item aberto: ele para de ser
> reperguntado e vira premissa invisível.**

Se um experimento não puder ser feito, o estado terminal honesto é **`INVIÁVEL`, com justificativa** —
não "aberto para sempre" nem "fechado por dedução".

**Destinatários nomeados das respostas:** E1 → `F0-09`. E2 e E3 → `F1-07` e a ADR 0006. E4 → `F2-04`.
E5 → `F1-05`. Escreva a linha de Considerações endereçada a eles.

---

## Onda W3 — o que a despesa desbloqueou

### `F0-08` — Os testes que decidem dinheiro

```yaml
id: F0-08
fase: F0
onda: W3
grupo: G-pipeline
deps: [F0-03]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - tools/pixellab-pipeline/src/catalog.test.ts
  - tools/pixellab-pipeline/src/cost.test.ts
  - tools/pixellab-pipeline/src/queue.test.ts
  - tools/pixellab-pipeline/src/generate.test.ts
faixa_ledger: AB-190..AB-199
```

| | |
| --- | --- |
| **Objetivo** | O teste de manchete: **plano → generate simulado contra cliente falso que conta submits → plano de novo → `submits === 0`**. Mais a cobertura dos outros três módulos que decidem dinheiro. |
| **Entradas** | `src/catalog.ts` · `src/cost.ts` · `src/queue.ts` · `src/generate.ts` · o catálogo de `F0-06`. |
| **Saídas** | quatro arquivos de teste. |
| **Considerações** | — |

**Hoje há 6 testes e todos são de empacotamento e utilitários** (`src/atlas.test.ts`, medido em
2026-07-30). Os quatro módulos que decidem quando o dinheiro sai **não têm nenhum**. O `AGENTS.md`
diz isso com todas as letras: *"O teste que prova isso ainda não existe; escrevê-lo é item de entrada
da próxima onda."*

```xml
<task id="F0-08" nome="Testes de catalog, cost, queue e generate" onda="W3" worktree="G-pipeline">

  <ultrathink>
    O teste de idempotência é o único que importa de verdade, e ele é fácil de escrever ERRADO de um
    jeito que passa: se o cliente falso for consultado depois de o lockfile já ter sido gravado em
    memória, ele conta zero por construção e o teste vira fixture alimentando a própria asserção.
    O contador tem de estar no OBJETO QUE FAZ A CHAMADA HTTP, e o segundo `buildPlan` tem de reler o
    lockfile DO DISCO. Prove o teste antes de confiar nele: quebre computeSpecHash de propósito e
    veja-o ficar vermelho. Se ele continuar verde, ele não estava testando idempotência.
  </ultrathink>

  <contexto>
    Todo asset gerado gasta dinheiro real. O pipeline é idempotente por design: gerar de novo com o
    mesmo spec não deve gastar nada — saldo idêntico antes e depois. Duas decisões de hash sustentam
    isso: o inputHash é dos PIXELS DECODIFICADOS (reencodar um PNG muda os bytes e não muda a
    imagem), e o hash do schema OpenAPI NÃO entra no specHash (um campo que nem usamos invalidaria o
    catálogo inteiro).
  </contexto>

  <ler_consideracoes_dos_anteriores>
    OBRIGATÓRIO: F0-03 publicou a assinatura final do relatório do guard — os testes de cost.ts são
    contra ELA, não contra o que este card supõe. F0-06 publicou o catálogo que serve de fixture.
    Suba também até F0-01. Dependências diretas: F0-03.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-190..AB-199.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/testing-repo-code/SKILL.md
    - .agents/skills/guarding-generation-cost/SKILL.md
    - .agents/skills/writing-repo-typescript/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - tools/pixellab-pipeline/src/atlas.test.ts — o ESTILO de teste deste repositório: node --test,
      sem framework, sem mock library. Siga-o.
    - tools/pixellab-pipeline/src/catalog.ts — computeSpecHash, computePostHash, inputHash,
      buildPlan, decide, topologicalSort.
    - tools/pixellab-pipeline/src/generate.ts — o ponto onde o submit acontece.
    - tools/pixellab-pipeline/src/queue.ts — QueueStore, WeightedSemaphore, AdaptiveLimiter.
  </entradas>

  <o_que_fazer>
    1. catalog.test.ts:
       a. TESTE DE MANCHETE. Catálogo fixo, lockfile em diretório temporário, cliente falso que
          incrementa um contador a cada submit. Rode: buildPlan -> generate -> buildPlan de novo,
          relendo o lockfile DO DISCO. Asserte `submits === 0` na segunda passada.
       b. Reencodar um PNG (mesma imagem, bytes diferentes) NÃO muda o inputHash. Use sharp para
          gerar as duas versões — é a dependência que já está lá.
       c. Trocar o sha256 do openapiSnapshot no lockfile NÃO produz nenhum `generate` no plano.
          Drift de schema é aviso, nunca cobrança.
       d. Ciclo de dependência é ERRO com a cadeia impressa, não pendura.
       e. Asset com specHash em rejectedHashes sai como `blocked-rejected`, nunca como `generate`.
       f. Mudar só o campo `post` produz `reprocess`, não `generate` — custo zero.
    2. cost.test.ts: interpolação por área entre pontos medidos; extrapolação abaixo do menor e acima
       do maior ponto marca confidence `extrapolated` em vez de inventar número; `sumEstimates`
       propaga a PIOR confiança; e o relatório do guard produz aviso — nunca recusa — em cada um dos
       quatro limiares, inclusive nos quatro ao mesmo tempo.
    3. queue.test.ts: um job em estado `submitted` NUNCA volta como pendente de submissão;
       `atRiskOfExpiry` ordena por prazo e ignora o que já foi baixado; o semáforo ponderado não
       trava com um job de peso maior que a capacidade; o limitador adaptativo reduz em 429 e se
       recupera em sucesso.
    4. generate.test.ts, com cliente falso: o id do job é PERSISTIDO ANTES do primeiro poll — mate o
       processo entre submit e poll e prove que `resume` acha o job; `resume` re-pola e nunca
       resubmete; falha 422 não é reexecutada.
    5. Prove que cada teste é capaz de reprovar: para pelo menos catalog(a), quebre a implementação
       de propósito num commit descartado e registre na mensagem de commit final que a mutação foi
       acusada.
  </o_que_fazer>

  <restricoes>
    - PROIBIDA qualquer chamada de rede. Cliente falso em todos os casos. Um teste que atinge
      api.pixellab.ai gasta dinheiro por execução.
    - PROIBIDO editar src/*.ts que não seja *.test.ts. Se um teste não puder ser escrito sem mudar a
      implementação, isso é uma REFUTAÇÃO: escreva-a nas Considerações e pare, em vez de mudar o
      módulo por conta própria.
    - PROIBIDO usar o lockfile real do repositório. Diretório temporário sempre.
    - PROIBIDO teste que dependa de ordem de execução ou de relógio real.
  </restricoes>

  <swarm>
    <subagents>
      Agente único para escrever. Fan-out de LEITURA é útil aqui: um subagente por módulo devolvendo,
      em uma página com citações, os caminhos em que o dinheiro sai.
    </subagents>
    <worktree>G-pipeline — bash scripts/new-task-worktree.sh F0-08</worktree>
    <revisao_adversarial>
      Contexto fresco, só o diff e este card:
        - o teste de idempotência passaria se `generate` não fizesse NADA? (se sim, ele não testa o
          que diz — precisa de um caso positivo: a PRIMEIRA passada tem de contar submits > 0)
        - o contador de submits está no cliente falso ou num nível acima dele?
        - a segunda passada relê o lockfile do disco ou reusa o objeto em memória?
        - algum teste faz rede? (procure fetch, undici, http, https)
        - algum teste fabrica a fixture a partir da mesma função que ele asserta?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/pixellab-pipeline && npm test          # exit 0
    cd tools/pixellab-pipeline && npm run typecheck # exit 0
    # o teste de manchete existe pelo NOME, e o guard abaixo é o que o torna falsificável:
    npm test 2>&1 | grep -q "idempot"
    # GUARD: node --test sai 0 quando o glob não casa arquivo nenhum. Conte os testes:
    test "$(npm test 2>&1 | grep -oP '(?<=^# pass )\d+|(?<=^ℹ pass )\d+' | tail -1)" -ge 20
    # falha por AUSÊNCIA: nenhum teste toca a rede
    ! grep -rn "fetch(\|https://api" tools/pixellab-pipeline/src/*.test.ts
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F0-08. Publique o número final de testes e QUAIS caminhos de gasto
    ficaram sem cobertura — a lista do que não foi coberto vale mais que a do que foi.
    Destinatário: G-0.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F0-09` — `isometric` e `directions` entram na identidade, e o endpoint muda

```yaml
id: F0-09
fase: F0
onda: W3
grupo: G-pipeline
deps: [F0-03, I-02]
critico: true
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - tools/pixellab-pipeline/src/catalog.ts
  - tools/pixellab-pipeline/src/endpoints.ts
faixa_ledger: AB-200..AB-209
```

| | |
| --- | --- |
| **Objetivo** | Fixar `isometric` **antes** de qualquer arte existir, e trocar o helper de personagem para o único endpoint que aceita o mapa `directions`. |
| **Entradas** | o veredicto de `I-02/E1` · `docs/adr/0015-low-top-down-8-direcoes-isometrico.md` · o spec vendorizado. |
| **Saídas** | `character8dir` com `isometric` e `directions` · `endpoints.ts` com as restrições conferidas contra o spec. |
| **Considerações** | — |

**O fato que decide este card, confirmado no spec vendorizado em 2026-07-30:**

| Endpoint | tem `isometric`? | tem `directions`? |
| --- | --- | --- |
| `/create-character-with-8-directions` | **sim** | **sim** (mapa de imagens por direção) |
| `/create-character-v3` | **não** | **não** |
| `/create-character-pro` | **não** | **não** |

E o estúdio de hoje usa `create-character-v3` (`tools/character-builder/server/api.ts`,
`generateBase`). A troca de endpoint é decisão da fundação, não descoberta da Fase 1.

```xml
<task id="F0-09" nome="isometric e directions na identidade do asset" onda="W3" worktree="G-pipeline">

  <ultrathink>
    Este card mexe em computeSpecHash por acréscimo de campo em `params`. Isso MUDA A IDENTIDADE de
    todo asset de personagem. Hoje é grátis — o lockfile não existe e nada foi gerado. Depois do
    primeiro `generate`, a mesma edição recobra tudo. Escreva isso no commit: a janela de gratuidade
    é esta, e ela fecha na Fase 1.
    O segundo ponto é o mapa `directions`: o spec exige que as dimensões de CADA imagem batam com
    image_size, e devolve 422 se não baterem — 422 chega DEPOIS da submissão, e submissão é onde o
    dinheiro sai. A validação tem de ser local e anterior.
  </ultrathink>

  <contexto>
    O editor é isométrico com Z discreto e projeção 2:1 fixa (docs/adr/0013). A ADR 0015 registra que
    o campo `isometric` só existe em três lugares — 8-directions, rotate e animate-character — e que o
    mapa `directions` só existe em /create-character-with-8-directions, onde ele CONGELA as direções
    fornecidas e gera as demais por IA.
  </contexto>

  <ler_consideracoes_dos_anteriores>
    OBRIGATÓRIO ler as Considerações de I-02, experimento E1: o que `isometric: true` de fato fez.
    Se E1 tiver mostrado que o campo não muda a projeção, ESTE CARD MUDA DE ESCOPO e você deve
    ajustar o TASK_PLAN.md e dizer por quê — não siga no automático. Suba também até F0-03 (a
    assinatura do guard) e F0-01.
    Dependências diretas: F0-03, I-02.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-200..AB-209.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/querying-pixellab-api/SKILL.md       (hub — primeiro)
    - .agents/skills/generating-pixellab-characters/SKILL.md
    - .agents/skills/rotating-pixellab-sprites/SKILL.md
    - .agents/skills/guarding-generation-cost/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - docs/plano/experimentos/E1.md — a evidência. Leia ANTES de decidir.
    - tools/pixellab-pipeline/openapi/openapi-v2.json — a fonte. Consulte com
      `node .agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs endpoint /create-character-with-8-directions`.
      NÃO escreva sobre a API de memória: ela muda sem versionar e info.version é literalmente "dev".
    - tools/pixellab-pipeline/src/catalog.ts, helper character8dir — hoje ele emite
      mode:'standard' e view:'low top-down', sem isometric e sem directions.
    - tools/pixellab-pipeline/src/endpoints.ts — o registro de restrições por endpoint.
  </entradas>

  <o_que_fazer>
    1. character8dir passa a aceitar e emitir `isometric` (o valor que E1 justificar) e um mapa
       `directions` opcional. As chaves permitidas são exatamente as oito do spec: south, south-east,
       east, north-east, north, north-west, west, south-west.
    2. Valide LOCALMENTE, antes de qualquer submissão: se `directions` for fornecido, cada imagem tem
       de ter as dimensões de `image_size`, e templates bípedes exigem `south` presente. Erro de
       validação entra em `validationErrors` de buildPlan, que já bloqueia a submissão inteira.
    3. endpoints.ts: reconfira TODA restrição já declarada contra o spec vendorizado e conserte o que
       divergir. Duas divergências conhecidas para você resolver:
         - o comentário de DIRECTIONS_8 fala de `/generate-8-rotations-v2`, mas ENDPOINT_IDS declara
           `generate-8-rotations-v3`. Os dois paths existem no spec. Diga qual é o nosso.
         - `rotate` aceita image_size até 200 e o texto do endpoint lista 16/32/64/128 como
           "supported sizes". Registre a diferença entre o que o schema aceita e o que a prosa
           promete.
    4. Acrescente um item de ledger para tudo que E1 não tiver respondido — em especial se `isometric`
       compõe com `view` ou o sobrescreve.
    5. NÃO mude PIPELINE_VERSION. Ele é o botão de "regerar tudo", é decisão de orçamento, e nada
       aqui justifica apertá-lo.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO tocar em src/cost.ts, src/cli.ts (são de F0-03, já mergeado — mudança lá é card novo).
    - PROIBIDO tocar em src/*.test.ts (são de F0-08, que roda NESTA MESMA ONDA).
    - PROIBIDO afirmar qualquer coisa sobre a API sem citar o spec vendorizado.
    - PROIBIDO mudar PIPELINE_VERSION.
    - PROIBIDA qualquer chamada de rede. Este card NÃO gasta: quem gastou foi I-02.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-pipeline — bash scripts/new-task-worktree.sh F0-09</worktree>
    <revisao_adversarial>
      Contexto fresco, só o diff e este card:
        - existe caminho em que um mapa `directions` com dimensão errada chega a ser SUBMETIDO?
          (o 422 chega depois da cobrança — este é o defeito caro)
        - alguma restrição nova em endpoints.ts foi escrita de memória em vez de lida do spec?
          Reconfira 3 delas contra openapi-v2.json e diga quais.
        - o specHash de um asset SEM isometric mudou? (não deveria, se o campo for omitido em vez de
          emitido como false — decida e justifique qual dos dois)
        - PIPELINE_VERSION continua 1?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/pixellab-pipeline && npm run typecheck   # exit 0
    cd tools/pixellab-pipeline && npm test            # exit 0 — incluindo os testes de F0-08
    node src/cli.ts plan; test $? -eq 0
    node .agents/skills/scripts/check-spec-claims.mjs # exit 0
    # falha por AUSÊNCIA:
    grep -q "isometric" tools/pixellab-pipeline/src/catalog.ts
    grep -q "PIPELINE_VERSION = 1" tools/pixellab-pipeline/src/catalog.ts
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F0-09. Publique: o valor final de `isometric`, se ele é OMITIDO ou
    emitido como false quando desligado, e a decisão sobre generate-8-rotations v2 × v3.
    Destinatários nomeados: F1-02, F1-03, F2-01.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F0-10` — A âncora medida, não chutada

```yaml
id: F0-10
fase: F0
onda: W3
grupo: G-pipeline
deps: [F0-03, I-02]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - tools/pixellab-pipeline/src/atlas.ts
  - tools/pixellab-pipeline/src/atlas.test.ts
faixa_ledger: AB-210..AB-219
```

| | |
| --- | --- |
| **Objetivo** | Trocar a âncora constante `{ x: 0.5, y: 0.875 }` por uma âncora **derivada dos pixels** de cada frame, e gravá-la no sidecar. |
| **Entradas** | os PNGs reais que `I-02/E1` produziu · `src/atlas.ts`, `packGrid`. |
| **Saídas** | âncora medida por família, com o método escrito. |
| **Considerações** | — |

**Por que 0,875 não sobrevive ao Z discreto.** Ela é um chute empírico contra a inflação de canvas
que os endpoints de personagem documentam como *"~40% larger to make room for animations"*
(`ENDPOINTS['create-character-with-8-directions'].canvasInflation = 1.4`). Com Z discreto **um nível
são 16 px**: num canvas de ~90 px, 12% de erro é ~11 px, quase um nível inteiro de deslocamento. E a
inflação é declarada como "~40%" num endpoint e "~2x" em outro, então uma constante única já está
errada em pelo menos um dos dois.

**A consequência de não fazer agora:** se o renderizador entrar antes, alguém "conserta" com um
offset mágico dentro dele — e esse offset vira carga estrutural que nunca mais sai.

```xml
<task id="F0-10" nome="Âncora medida a partir dos pixels" onda="W3" worktree="G-pipeline">

  <ultrathink>
    O raciocínio está em O QUE se mede. "O pixel opaco mais baixo" é a definição óbvia e está errada
    para animação: numa pose de pulo os pés SAEM do chão, e ancorar por eles faz o personagem
    deslizar. A medida certa é a caixa opaca do FRAME DE REPOUSO da família, propagada para os
    demais frames da mesma família — a âncora é propriedade do personagem, não do quadro.
    Segundo ponto: a âncora vai no SIDECAR, não no JSON do Pixi. O parser do Pixi é dono daquele
    formato e uma versão maior vai brigar por ele.
  </ultrathink>

  <contexto>
    O empacotador emite dois arquivos por família: <nome>.json, estritamente TexturePacker JSON Hash,
    que é o que o Pixi parseia; e <nome>.pixellab.json, o sidecar, onde vivem fps, proveniência e
    âncoras lógicas. Nunca estenda o JSON do Pixi com semântica de jogo.
    Um nível de Z são 16 px (docs/adr/0013). Erro de âncora aparece como personagem flutuando ou
    afundando meio degrau — e nenhum teste pega isso hoje.
  </contexto>

  <ler_consideracoes_dos_anteriores>
    OBRIGATÓRIO: I-02 (os PNGs reais e o tamanho de canvas que a API DE FATO devolveu para um pedido
    de 64×64 — este número é o insumo central deste card). Suba também até F0-03.
    Dependências diretas: F0-03, I-02.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-210..AB-219. Provável abrir pelo menos um: a inflação real medida
    contra a inflação documentada.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/animating-pixi-sprites/SKILL.md
    - .agents/skills/composing-pixi-scene/SKILL.md
    - .agents/skills/testing-repo-code/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - docs/plano/experimentos/E1.md — inclui os PNGs devolvidos. MEÇA-OS: qual o tamanho real do
      canvas para um image_size de 64×64?
    - tools/pixellab-pipeline/src/atlas.ts — packGrid, opts.anchor, extrudeAndBleed, e o Sidecar.
    - tools/pixellab-pipeline/src/endpoints.ts — canvasInflation.
  </entradas>

  <o_que_fazer>
    1. Escreva `measureAnchor(frames)`: recebe os frames de uma família, acha a caixa delimitadora
       opaca do frame de repouso (o de índice 0 da direção sul), e devolve a âncora como fração do
       canvas: x no centro horizontal da caixa, y na base dela.
    2. packGrid passa a usar a âncora medida quando houver frames suficientes, e a constante atual
       como fallback EXPLÍCITO, com aviso impresso dizendo que está chutando.
    3. O sidecar ganha `anchorSource: 'medida' | 'padrao'` e, quando medida, o tamanho de canvas real
       observado. Um número sem procedência não vale mais que um chute.
    4. Tiles continuam com âncora {0,0} — a regra atual, que já está em cli.ts.
    5. Testes: uma imagem sintética com uma caixa opaca conhecida produz a âncora esperada; uma
       imagem inteiramente transparente NÃO explode e cai no fallback avisando; e a âncora medida de
       um frame com pixels transparentes na base difere da constante — se não diferir, o teste não
       está medindo nada.
    6. Registre no ledger a inflação REAL medida contra a documentada, com os dois números.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO pôr a âncora no JSON do Pixi como semântica nova. O campo `anchor` já existe lá por
      frame e continua; a PROCEDÊNCIA vai no sidecar.
    - PROIBIDO redimensionar, reamostrar ou recortar o frame. Nada de resampling, nunca — é o que
      mantém a arte nítida.
    - PROIBIDO tocar em src/catalog.ts ou src/endpoints.ts: são de F0-09, NESTA MESMA ONDA.
    - PROIBIDO usar a âncora para "corrigir" a inflação de canvas. São dois problemas: um é onde o
      sprite se apoia, o outro é quanto de canvas veio sobrando.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-pipeline — bash scripts/new-task-worktree.sh F0-10</worktree>
    <revisao_adversarial>
      Contexto fresco, só o diff e este card:
        - a âncora medida de um frame de PULO é diferente da do frame de repouso? (se for, o
          personagem vai deslizar — a âncora tem de ser da família)
        - o teste passaria se measureAnchor devolvesse sempre {0.5, 0.875}? (se sim, ele não mede
          nada)
        - imagem 100% transparente quebra?
        - o PNG do atlas continua byte-idêntico entre duas execuções com a mesma entrada?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/pixellab-pipeline && npm test            # exit 0
    cd tools/pixellab-pipeline && npm run typecheck   # exit 0
    # falha por AUSÊNCIA: a procedência da âncora é obrigatória no sidecar
    grep -q "anchorSource" tools/pixellab-pipeline/src/atlas.ts
    # e o determinismo do empacotamento não regrediu (o teste já existe — confira que ele roda):
    npm test 2>&1 | grep -q "deterministic"
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F0-10. Publique: o tamanho de canvas REAL para image_size 64×64, a
    âncora medida, e a diferença em pixels contra {0.5, 0.875}. Destinatários: F1-08, F2-05, F4-02.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F0-12` — ADR 0018: o artefato de exportação

```yaml
id: F0-12
fase: F0
onda: W3
grupo: G-docs
deps: [F0-11]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - docs/adr/0018-artefato-de-exportacao.md
  - docs/README.md
faixa_ledger: AB-220..AB-229
```

| | |
| --- | --- |
| **Objetivo** | Registrar a decisão do formato de projeto **depois** que algo já serializou e releu — nunca antes. |
| **Entradas** | `packages/iso-core/src/project.ts` e o arquivo de exemplo que `F0-11` deixou em disco. |
| **Saídas** | ADR 0018 · linha nova na tabela do `docs/README.md`. |
| **Considerações** | — |

**Duas correções ao replanejamento, ditas em voz alta.** O `analise-projeto-2026-07-30.html` chama
esta ADR de "0017" e a coloca no fim da onda W0. O número **0017 já está em uso** (é a do nome
único), então esta é a **0018**. E ela não podia ficar no fim de W0 como o HTML descreve, porque
naquele ponto nada serializava um `project.json` — o card `F0-11` foi criado exatamente para dar a
essa ADR a evidência de que ela precisa.

```xml
<task id="F0-12" nome="ADR 0018 — o artefato de exportação" onda="W3" worktree="G-docs">

  <ultrathink>
    O risco desta ADR é decidir mais do que foi construído. F0-11 serializou identificação, geometria
    e lista de atlas — não serializou mapa, nem entidades, nem animações. A ADR pode DECIDIR sobre o
    que existe e pode DECLARAR EXPLICITAMENTE o que fica fora de escopo, mas não pode especificar um
    campo que ninguém escreveu: doc de infra escrita antes de existir infra é ficção, e a convenção
    12 proíbe.
  </ultrathink>

  <contexto>
    ADR não se edita neste repositório. Uma decisão revista gera ADR nova, que declara
    `**Substitui:** ADR NNNN` numa linha logo abaixo do Status, e a tabela de docs/README.md marca a
    antiga na coluna Situação. O mecanismo é unidirecional de propósito: o arquivo novo ganha um
    campo, o antigo nunca é tocado.
  </contexto>

  <ler_consideracoes_dos_anteriores>
    OBRIGATÓRIO: F0-11 publicou o schema EXATO da versão 1 e o caminho do arquivo de exemplo. A ADR
    descreve o que está lá, não o que se gostaria que estivesse. Dependências diretas: F0-11.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-220..AB-229.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/writing-project-docs/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - packages/iso-core/src/project.ts — o schema real.
    - o arquivo de exemplo escrito por F0-11 — leia-o, cite-o.
    - docs/adr/0013-geometria-isometrica-64x32-z16.md — a geometria que o formato carrega como dado.
    - docs/adr/0017-nome-unico-isometric-maker.md — o modelo de formato de ADR deste repositório.
  </entradas>

  <o_que_fazer>
    1. Escreva docs/adr/0018-artefato-de-exportacao.md seguindo as 12 convenções: um único H1,
       Quick Start em blockquote logo abaixo, caminhos absolutos, datas ISO, syntax hint em todo bloco
       de código, seção `## Referências`, e a linha final `**Última atualização:** 2026-__-__`.
    2. Conteúdo mínimo: Status e Data; Contexto (por que a decisão foi ADIADA e o que a desbloqueou);
       Decisão, numerada D1, D2… para poder ser citada isoladamente; Alternativas descartadas com o
       motivo; Consequências, positivas E os custos; **Guarda executável** — o comando que FALHA se a
       decisão for violada (candidato natural: o teste de ida e volta de F0-11 mais a checagem de que
       o runtime não importa do editor); e **O que este ADR NÃO decide**, listando nominalmente mapa,
       entidades e animações como fora de escopo até que existam.
    3. Acrescente UMA linha na tabela de ADRs de docs/README.md. Convenção 11: atualizar o índice ao
       adicionar doc nova, sempre.
    4. Se você não conseguir escrever a guarda executável, a decisão ainda é uma intenção — e o
       caminho honesto é registrar o Status como PROPOSTO em vez de aceito.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO editar qualquer ADR existente, inclusive para acrescentar "substituída por 0018".
      A coluna Situação do índice é o ÚNICO lugar onde a supersessão aparece.
    - PROIBIDO especificar campo que não existe em packages/iso-core/src/project.ts.
    - PROIBIDO usar termo do produto anterior — o check-docs.sh reprova, e com razão.
    - PROIBIDO citar endpoint que não exista no spec vendorizado: o check-docs.sh confere toda
      caminho iniciado por barra que apareça entre crases contra os 79 paths do spec.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-docs — bash scripts/new-task-worktree.sh F0-12</worktree>
    <revisao_adversarial>
      Contexto fresco, só o diff e este card:
        - algum campo da ADR não existe no código?
        - a guarda executável FALHA de verdade se eu violar a decisão? Rode-a contra uma violação
          fabricada.
        - a ADR promete algo sobre o mapa, que ainda não existe?
        - `bash scripts/check-docs.sh` passa por CONFERIR ou por não achar o arquivo?
          (controle positivo: insira um `## Referências` errado de propósito e veja-o reprovar)
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    bash scripts/check-docs.sh                                   # exit 0
    test -f docs/adr/0018-artefato-de-exportacao.md
    grep -q "^\*\*Última atualização:\*\* 20" docs/adr/0018-artefato-de-exportacao.md
    grep -q "0018" docs/README.md
    # falha por AUSÊNCIA: a guarda executável é obrigatória
    grep -q "Guarda executável" docs/adr/0018-artefato-de-exportacao.md
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F0-12. Publique o comando da guarda executável.
    Destinatários: F2-09, F4-01, F4-03.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

## Onda W4 — o gate da fundação

### `G-0` — GATE: nada da Fase 1 começa antes disto

```yaml
id: G-0
fase: gate
onda: W4
grupo: G-infra
deps: [F0-08, F0-09, F0-10, F0-12, T-01, F0-04, F0-05, F0-06, F0-07]
critico: true
gasta: nao
worktree: nao
estado: pendente
arquivos: []
faixa_ledger: AB-230..AB-239
```

**Por que este gate existe, concretamente — não "boas práticas".** A Fase 1 gera arte paga. Se ela
começar com o guard ainda recusando, com `computeSpecHash` sem `isometric`, com a âncora chutada ou
sem o teste de idempotência, o resultado não é um bug: é uma fatura, e depois uma segunda fatura para
refazer o que a primeira produziu com a identidade errada.

#### Pré-requisitos — nenhum card da Fase 1 começa antes destes

| # | Pré-requisito | Onde se confere | Quem assina |
| --- | --- | --- | --- |
| P1 | **Idempotência provada.** O teste "mesmo spec 2× → 0 submits" existe e reprova quando quebrado | `F0-08`, Considerações | quem executou `F0-08` |
| P2 | **Guard informa e não recusa.** `estimate` sai 0 acima de todos os limiares | `F0-03` | quem executou `F0-03` |
| P3 | **`isometric` fixado com evidência.** `E1` respondido e o campo dentro do `specHash` | `docs/plano/experimentos/E1.md` | você |
| P4 | **Âncora medida**, com o canvas real registrado | `F0-10`, Considerações | quem executou `F0-10` |
| P5 | **Formato de projeto v1 escrito, relido e registrado em ADR** | `F0-12` | você |
| P6 | **Ledger sem item fechado por dedução.** Todo fechado tem evidência citável | `node scripts/validate-plan.mjs --ledger` | você |

#### Checklist executável

```bash
cd /home/ondokai/Projects/isometric-maker
bash scripts/gate.sh                                   # VERDE, e sem nenhuma etapa PENDENTE
node scripts/validate-plan.mjs                         # exit 0
node scripts/check-acceptance.mjs                      # exit 0
node scripts/validate-plan.mjs --ledger                # exit 0
cd tools/pixellab-pipeline && npm test && npm run typecheck
cd ../character-builder     && npm run typecheck
cd ../../packages/iso-core  && npm test && npm run typecheck
cd ../.. && bash scripts/check-docs.sh
node .agents/skills/scripts/lint-skills.mjs
node .agents/skills/scripts/check-spec-claims.mjs
node tools/pixi-reference/scripts/vendor-types.mjs --check
node scripts/check-pixi-pin.mjs
```

E o controle positivo, que é o que impede este gate de ser uma lista de comandos que passam por
vacuidade:

```bash
# o gate é capaz de reprovar? Quebre uma coisa de propósito e veja-o ficar vermelho.
git stash list >/dev/null
sed -i "s/PIPELINE_VERSION = 1/PIPELINE_VERSION = 2/" tools/pixellab-pipeline/src/catalog.ts
bash scripts/gate.sh; test $? -ne 0 && echo "ok: o gate reprova"
git checkout tools/pixellab-pipeline/src/catalog.ts
```

**Se qualquer etapa sair `NÃO-EXERCITADO`, o gate está AMARELO, não verde.** Ausência de verificador
é indistinguível de conformidade, e é por isso que o terceiro estado existe.

#### Ao concluir

Marque `estado: feito` no yaml de `G-0` e registre nas Considerações: a data, quais etapas saíram
`NÃO-EXERCITADO` e por quê, e o saldo da conta neste momento — ele é a linha de base contra a qual o
gasto da Fase 1 vai ser lido.

---

## Fase 1 — Construtor de personagem

**A partir daqui o documento é organizado por fase, não por onda**, porque as fases 1, 2 e 3 correm
**em paralelo** a partir da onda W5. A tabela da seção 3 continua sendo a visão autoritativa de onda;
o campo `onda:` de cada card é a fonte.

O fluxo, endpoint por endpoint. É **o mesmo que a própria PixelLab implementou** na ferramenta de
esqueleto dela:

```text
[1] arte base (sul) + altura em px      upload seu                  0 gerações   F1-01
[2] POST /rotate ×3   south -> north|east|west, isometric:true      3 ger        F1-02
[3] POST /create-character-with-8-directions
      mode:'standard', image_size 64x64, isometric conforme E1,
      directions:{ south, north, east, west }  <- AS 4 PRIMEIRAS    1 ger        F1-03
[4] GET /characters/{character_id}   rotation_urls POR NOME + skeletons  0 ger    F1-04
[5] EDITOR DE ESQUELETO — 100% LOCAL, ZERO API                      0 ger        F1-05
[6] andar, correr, pular x 8 direções                               ? ger        F1-07
```

**As duas frases do replanejamento caem em campos diferentes, e confundi-las custa dinheiro:**

- *"as 4 primeiras arts, frente costas e laterais"* → o mapa `directions`, que existe **só** em
  `/create-character-with-8-directions` e congela as fornecidas gerando o resto.
- *"o primeiro frame sempre recebe"* → `keep_first_frame`, que o spec declara **`mode='v3'` apenas**,
  com default `true`. **Não vale no modo template.** Verificado no spec em 2026-07-30.

---

### `F1-01` — Anexar a arte-base e a altura, e validar antes de qualquer chamada

```yaml
id: F1-01
fase: F1
onda: W5
grupo: G-builder
deps: [G-0]
critico: true
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - tools/character-builder/src/import.ts
  - tools/character-builder/src/import.test.ts
faixa_ledger: AB-240..AB-249
```

| | |
| --- | --- |
| **Objetivo** | Aceitar um PNG virado para o sul e uma altura em px, e **reprovar localmente** tudo que a API cobraria para depois devolver 422. |
| **Entradas** | `docs/plano/experimentos/E1.md` (o canvas real) · `src/strings.ts` de `F0-07`. |
| **Saídas** | validação local com mensagens em pt-BR e testes. |
| **Considerações** | — |

```xml
<task id="F1-01" nome="Importar arte-base e altura com validação local" onda="W5" worktree="G-builder">

  <ultrathink>
    Toda validação aqui existe por um motivo aritmético: o 422 chega DEPOIS da submissão, e a
    submissão é onde o dinheiro sai. Cada regra que você deixar de checar localmente é uma cobrança
    que vai acontecer para nada. Liste as regras a partir do SPEC, não do bom senso.
  </ultrathink>

  <contexto>
    O construtor de personagem parte de uma imagem virada para o sul, no máximo 256×256, mais a
    altura do personagem em pixels. A altura é o que permite reescalar o esqueleto depois, por
    transformada afim local, sem gastar nada.
  </contexto>

  <ler_consideracoes_dos_anteriores>
    Suba até a raiz: G-0, F0-10 (canvas real e âncora), F0-09 (isometric e directions), F0-07
    (strings). Dependências diretas: G-0.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-240..AB-249.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/querying-pixellab-api/SKILL.md
    - .agents/skills/generating-pixellab-characters/SKILL.md
    - .agents/skills/building-pixi-ui/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - tools/pixellab-pipeline/src/endpoints.ts, validateSize — reutilize; não reimplemente.
    - o spec: /create-character-with-8-directions exige que CADA imagem de `directions` tenha
      exatamente as dimensões de `image_size`, e que templates bípedes incluam 'south'.
    - tools/character-builder/src/strings.ts — toda mensagem de erro sai daqui.
  </entradas>

  <o_que_fazer>
    1. Aceitar um PNG. Rejeitar localmente, com mensagem em pt-BR que diga O QUE fazer:
       formato diferente de PNG; qualquer lado acima de 256; lado fora de 16..128 quando o alvo for
       o endpoint de 8 direções; e altura informada maior que a altura da imagem.
    2. Guardar a altura em px como dado do personagem, não como constante.
    3. Testes, incluindo pelo menos um que falha por AUSÊNCIA: uma imagem 65×64 (dimensões
       diferentes entre si) tem de ser recusada — é exatamente o caso que a API cobra e devolve 422.
    4. NÃO faça nenhuma chamada de rede neste card.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO chamar a API.
    - PROIBIDO reimplementar validateSize; importe do pipeline.
    - PROIBIDO texto de UI fora de strings.ts.
    - PROIBIDO tocar em server/api.ts — é de F1-03.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-builder — bash scripts/new-task-worktree.sh F1-01</worktree>
    <revisao_adversarial>
      Contexto fresco: existe algum caminho em que uma imagem inválida chega a ser enviada? A
      validação roda antes ou depois do botão de gerar? Alguma mensagem de erro está em inglês?
      O teste passaria se a validação sempre devolvesse "válido"?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/character-builder && npm run typecheck && npm test
    # falha por AUSÊNCIA:
    ! grep -rn "fetch(" tools/character-builder/src/import.ts
    grep -q "strings" tools/character-builder/src/import.ts
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F1-01. Publique a lista final de regras de validação.
    Destinatários: F1-02, F1-03.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F1-02` — As três cardeais por `/rotate`

```yaml
id: F1-02
fase: F1
onda: W5
grupo: G-builder
deps: [G-0]
critico: true
gasta: possivel
worktree: sim
estado: pendente
arquivos:
  - tools/character-builder/server/rotate.ts
  - tools/character-builder/server/rotate.test.ts
faixa_ledger: AB-250..AB-259
```

| | |
| --- | --- |
| **Objetivo** | Produzir norte, leste e oeste a partir do sul fornecido, com `isometric` conforme `E1`, passando pelo guard e pelo ledger. |
| **Entradas** | o `from_image` de `F1-01` · o veredicto de `E1`. |
| **Saídas** | três PNGs cardeais, gravados e registrados. |
| **Considerações** | — |

**O que o spec diz sobre `/rotate`, verificado em 2026-07-30:** `from_image` é obrigatório;
`image_size` é obrigatório e vai até 200 por lado, embora a prosa do endpoint liste
16/32/64/128 como tamanhos suportados; `from_direction` e `to_direction` são enums das oito
direções; `isometric` existe, com default `false`; e a chamada é **síncrona** — não devolve
`background_job_id`.

```xml
<task id="F1-02" nome="Três cardeais por /rotate" onda="W5" worktree="G-builder">

  <ultrathink>
    `/rotate` é SÍNCRONO — não devolve background_job_id. Isso muda o tratamento de erro inteiro: não
    há job a retomar, então uma falha depois da cobrança é dinheiro perdido a menos que a resposta
    seja gravada no instante em que chega. Grave o PNG ANTES de qualquer pós-processamento.
    Segundo ponto: o status HTTP NÃO diz se a chamada é assíncrona. Consulte o spec, endpoint por
    endpoint, sempre.
  </ultrathink>

  <contexto>
    O construtor gera as quatro cardeais e as CONGELA no passo seguinte, via mapa `directions`. As
    quatro diagonais é que são inventadas pela IA. Isso é o que dá controle de arte sobre metade do
    resultado por um preço de rotação.
  </contexto>

  <ler_consideracoes_dos_anteriores>
    G-0, F0-09 (valor final de isometric), F0-03 (a assinatura do relatório do guard), I-02/E1.
    Dependências diretas: G-0.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-250..AB-259.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/querying-pixellab-api/SKILL.md
    - .agents/skills/rotating-pixellab-sprites/SKILL.md
    - .agents/skills/orchestrating-pixellab-jobs/SKILL.md
    - .agents/skills/guarding-generation-cost/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - o spec, endpoint /rotate. Consulte com inspect-spec.mjs; não escreva de memória.
    - tools/pixellab-pipeline/src/api.ts — PixelLabClient e o tratamento de 429/529/423/410. REUSE.
    - tools/pixellab-pipeline/src/cost.ts — a regra de custo de 'rotate'.
  </entradas>

  <o_que_fazer>
    1. Três chamadas: south→north, south→east, south→west. Mesmo seed, mesmo `image_size`,
       `isometric` conforme F0-09, `from_view` e `to_view` iguais a 'low top-down'.
    2. ANTES de submeter: estime pelo cost.ts, imprima o relatório do guard e peça confirmação.
       Depois de submeter: escreva no ledger, com o `usage` cru.
    3. Grave cada PNG em disco no instante em que chegar, antes de qualquer processamento.
    4. Idempotência: se as três já existirem para o mesmo par (arte-base, seed), NÃO chame nada.
       Nenhuma requisição HTTP deve sair. Este é o comportamento que F1-09 vai medir.
    5. Teste com cliente falso: três chamadas na primeira vez, ZERO na segunda.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO reimplementar transporte HTTP, retry ou backoff. Use o cliente do pipeline.
    - PROIBIDO submeter sem antes imprimir a estimativa.
    - PROIBIDO usar `oblique_projection` — é outra projeção, e não é a nossa.
    - PROIBIDO gravar o token em log, em arquivo ou em resposta.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-builder — bash scripts/new-task-worktree.sh F1-02</worktree>
    <revisao_adversarial>
      Contexto fresco: se a segunda das três chamadas falhar, a primeira foi gravada em disco? O
      teste de idempotência conta requisições HTTP ou só olha o disco? Alguma chamada sai sem passar
      pelo guard? O ledger recebe uma linha por chamada, ou uma por lote?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/character-builder && npm run typecheck && npm test
    # o teste de idempotência precisa contar REQUISIÇÕES, não arquivos:
    npm test 2>&1 | grep -q "0 requisições"
    # falha por AUSÊNCIA:
    grep -q "checkBudget\|guard" tools/character-builder/server/rotate.ts
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F1-02. Publique o custo REAL das três rotações, lido do `usage`.
    Destinatários: F1-03, F1-06.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F1-03` — Troca de endpoint: `create-character-v3` → `create-character-with-8-directions`

```yaml
id: F1-03
fase: F1
onda: W6
grupo: G-builder
deps: [F1-01, F1-02]
critico: true
gasta: possivel
worktree: sim
estado: pendente
arquivos:
  - tools/character-builder/server/api.ts
faixa_ledger: AB-260..AB-269
```

| | |
| --- | --- |
| **Objetivo** | O passo central: as 4 cardeais entram congeladas pelo mapa `directions`, e as 4 diagonais são geradas — por **1 geração**. |
| **Entradas** | os PNGs de `F1-02` · `server/api.ts`, função `generateBase`. |
| **Saídas** | 8 direções, com as 4 cardeais **idênticas** ao que foi fornecido. |
| **Considerações** | — |

```xml
<task id="F1-03" nome="Endpoint de 8 direções com mapa directions" onda="W6" worktree="G-builder">

  <ultrathink>
    Gaste o raciocínio na PROVA de que as cardeais foram congeladas. "Parecem iguais" não é
    verificação: compare os pixels decodificados das quatro cardeais devolvidas contra os quatro PNGs
    enviados. Se a API tiver reprocessado alguma, o mapa `directions` não fez o que se pensa que faz,
    e isso muda a Fase 1 inteira — é refutação, e o destinatário é F1-07.
    Este é também o card que apaga um caminho de gasto sem guard: hoje o POST /api/generate do
    estúdio submete direto, sem cost.ts e sem ledger.
  </ultrathink>

  <contexto>
    Confirmado no spec vendorizado: create-character-v3 e create-character-pro NÃO têm `isometric`
    nem `directions`. Só /create-character-with-8-directions tem os dois. O estúdio de hoje usa o v3
    (função generateBase). A troca é decisão da fundação (docs/adr/0015), executada aqui.
    O modo 'standard' custa 1 geração; 'pro' custa 20-40 e ignora outline, shading, detail,
    proportions e text_guidance_scale.
  </contexto>

  <ler_consideracoes_dos_anteriores>
    OBRIGATÓRIO: F1-01 (regras de validação), F1-02 (os PNGs e o custo real), F0-09 (isometric e a
    forma final de character8dir), F0-03 (o guard). Dependências diretas: F1-01, F1-02.
    Se F1-02 tiver descoberto que o canvas devolvido pelo /rotate NÃO bate com image_size, este card
    muda de escopo — as imagens de `directions` precisam bater EXATAMENTE. Ajuste o TASK_PLAN.md e
    diga por quê.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-260..AB-269.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/querying-pixellab-api/SKILL.md
    - .agents/skills/generating-pixellab-characters/SKILL.md
    - .agents/skills/guarding-generation-cost/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - tools/character-builder/server/api.ts — generateBase, hoje sobre create-character-v3.
    - tools/pixellab-pipeline/src/catalog.ts, character8dir (na forma que F0-09 deixou).
    - o spec: propriedade `directions` de /create-character-with-8-directions — chaves permitidas,
      "Missing directions are AI-generated; provided ones are used as-is", "Each image's dimensions
      must match image_size", "Bipedal templates require 'south' if any are provided".
  </entradas>

  <o_que_fazer>
    1. Reescreva generateBase para POST /create-character-with-8-directions, mode 'standard',
       `directions` com south/north/east/west, `isometric` conforme F0-09, seed pinado.
    2. Todo gasto passa a atravessar o guard e o ledger. O caminho "submete direto" some.
    3. Grave o `character_id` devolvido: tudo a jusante — animação, esqueleto, estados de guarda-roupa
       — pendura nele.
    4. Prova de congelamento: compare os pixels decodificados de cada cardeal devolvida com o PNG
       enviado. Registre o resultado, igual ou diferente, em docs/plano/experimentos/.
    5. Idempotência: mesmo (arte-base, seed, isometric) => nenhuma requisição sai.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO usar mode:'pro' — 20 a 40 gerações, e exige ADR nova.
    - PROIBIDO manter qualquer caminho que submeta sem passar pelo guard.
    - PROIBIDO enviar imagem de `directions` cujas dimensões não batam com image_size: é 422 depois
      da cobrança.
    - PROIBIDO tocar em src/main.ts (é da UI, cards posteriores) nem em server/rotate.ts (é de F1-02,
      já mergeado).
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-builder — bash scripts/new-task-worktree.sh F1-03</worktree>
    <revisao_adversarial>
      Contexto fresco, só o diff e este card:
        - sobrou alguma referência a 'create-character-v3' no builder?
        - existe caminho do POST /api/generate até client.submit que não passe pelo guard? Siga-o
          linha a linha.
        - as cardeais devolvidas são byte-idênticas às enviadas, ou só parecidas? Qual comando prova?
        - o character_id é persistido ANTES do primeiro poll?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/character-builder && npm run typecheck && npm test
    ! grep -rn "create-character-v3" tools/character-builder/server/
    grep -q "create-character-with-8-directions" tools/character-builder/server/api.ts
    grep -q "directions" tools/character-builder/server/api.ts
    # falha por AUSÊNCIA — nenhum caminho de submissão sem guard:
    test "$(grep -c "submit(" tools/character-builder/server/api.ts)" -le "$(grep -c "guard\|checkBudget\|estimate" tools/character-builder/server/api.ts)"
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F1-03. Publique: o custo real, o character_id de teste, e — o mais
    importante — SE as cardeais vieram congeladas. Destinatários: F1-04, F1-05, F1-07.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F1-04` — Ler `rotation_urls` **por nome**, nunca por índice

```yaml
id: F1-04
fase: F1
onda: W7
grupo: G-builder
deps: [F1-03]
critico: true
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - tools/character-builder/server/frames.ts
  - tools/character-builder/server/frames.test.ts
faixa_ledger: AB-270..AB-279
```

| | |
| --- | --- |
| **Objetivo** | Substituir o fatiamento por índice por leitura por chave, e matar o bug que não estoura. |
| **Entradas** | `GET /characters/{character_id}` · `server/api.ts`, função `writeFrames`. |
| **Saídas** | leitura por nome, com teste que reprova o fatiamento por índice. |
| **Considerações** | — |

**O defeito que existe hoje.** `writeFrames` (`tools/character-builder/server/api.ts`) fatia a lista
de imagens por índice de direção, com o comentário de que "os endpoints de 8 rotações devolvem os
frames em ordem canônica". Mas **três ordenações de direção convivem no mesmo spec**, e a descrição
de um dos endpoints diz *"clockwise order starting from south"* — o **espelho** da ordem canônica
deste repositório. E `GET /characters/{character_id}` devolve `rotation_urls` como **objeto**,
chaveado por nome.

> Se o payload vier na ordem documentada e o código fatiar por índice, **leste e oeste trocam**.
> Nada estoura, nenhum teste falha, e o sintoma aparece meses depois como "o personagem anda de
> lado".

```xml
<task id="F1-04" nome="Ler rotation_urls por nome" onda="W7" worktree="G-builder">

  <ultrathink>
    Este é o defeito mais barato de introduzir e o mais caro de achar do projeto inteiro, porque ele
    é SILENCIOSO. Escreva o teste que o pega: monte um payload com as direções em ordem INVERTIDA e
    exija que o resultado continue correto. Um teste que só usa o payload na ordem "certa" não
    distingue as duas implementações.
  </ultrathink>

  <contexto>
    GET /characters/{character_id} devolve, entre outros: id, name, size, directions (inteiro),
    template_id, view, status, rotation_urls (objeto), skeletons (objeto), animations, group_id, tags.
    Verificado no spec vendorizado em 2026-07-30.
  </contexto>

  <ler_consideracoes_dos_anteriores>
    F1-03 (o character_id e se as cardeais congelaram), F1-01, G-0. Dependências diretas: F1-03.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-270..AB-279. Inclua aqui o resultado de E5: `skeletons` veio populado?</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/querying-pixellab-api/SKILL.md
    - .agents/skills/rotating-pixellab-sprites/SKILL.md
    - .agents/skills/animating-pixi-sprites/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - tools/character-builder/server/api.ts, writeFrames — o código a substituir.
    - o spec: resposta de GET /characters/{character_id}.
    - tools/pixellab-pipeline/src/endpoints.ts, DIRECTIONS_8 — a ordem canônica DESTE repositório:
      south, south-west, west, north-west, north, north-east, east, south-east.
  </entradas>

  <o_que_fazer>
    1. Novo módulo server/frames.ts que lê `rotation_urls` POR CHAVE e devolve um mapa
       direção → arquivo. Chave desconhecida é erro nomeado, não silêncio.
    2. Direção ausente na resposta é ERRO explícito. Hoje o código simplesmente pula (`if (!b64)
       continue`), e oito direções viram cinco sem que nada reclame.
    3. Substitua o uso em api.ts pelo módulo novo, e remova o fatiamento por índice.
    4. Teste decisivo: um payload com as chaves em ordem invertida produz EXATAMENTE o mesmo
       resultado. E um payload faltando 'west' FALHA.
    5. Registre no ledger se `skeletons` veio populado — é a resposta de E5 e ela decide o custo de
       F1-05.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO ler frame por índice em qualquer lugar do builder.
    - PROIBIDO tratar direção ausente como caso normal.
    - PROIBIDA chamada de rede nos testes.
    - PROIBIDO mexer em server/rotate.ts.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-builder — bash scripts/new-task-worktree.sh F1-04</worktree>
    <revisao_adversarial>
      Contexto fresco:
        - o teste passaria se a implementação voltasse a fatiar por índice? Se sim, ele não testa
          nada — é o defeito exato que este card existe para matar.
        - sobrou algum `images[idx]` ou aritmética de índice de direção no builder?
        - leste e oeste: prove por um payload nomeado que eles não trocam.
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/character-builder && npm run typecheck && npm test
    npm test 2>&1 | grep -q "ordem invertida"
    # falha por AUSÊNCIA — nenhum fatiamento por índice de direção sobrou:
    ! grep -rnE "di \* perDir|images\[idx\]|DIRECTIONS\[i\]" tools/character-builder/server/
    grep -q "rotation_urls" tools/character-builder/server/frames.ts
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F1-04. Publique se `skeletons` veio populado e o formato exato dele.
    Destinatário nomeado: F1-05 — o custo daquele card depende inteiramente desta resposta.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F1-05` — Editor de esqueleto: 18 keypoints, altura e reescala. **Zero API.**

```yaml
id: F1-05
fase: F1
onda: W8
grupo: G-builder
deps: [F1-04]
critico: true
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - tools/character-builder/src/skeleton/editor.ts
  - tools/character-builder/src/skeleton/affine.ts
  - tools/character-builder/src/skeleton/affine.test.ts
faixa_ledger: AB-280..AB-289
```

| | |
| --- | --- |
| **Objetivo** | Arrastar 18 keypoints, mover o slider de altura, reescalar e aprovar — **sem uma única chamada de API**. |
| **Entradas** | `skeletons` de `F1-04` (ou `estimate-skeleton`, se `E5` disser que não vem) · `SKELETON_LABELS`. |
| **Saídas** | editor local, transformada afim testada, e um estado "aprovado" que destrava a animação. |
| **Considerações** | — |

**O passo mais barato de toda a Fase 1.** Escolher a referência, arrastar os 18 keypoints, o slider
de altura e o botão Reescalar são **transformada afim local** — escala uniforme
`s = alturaPx / alturaCanônica` mais translação. **Zero chamada de API.** O diálogo de custo não
deve nem abrir aqui, e isso é um critério de saída, não um detalhe.

```xml
<task id="F1-05" nome="Editor de esqueleto local" onda="W8" worktree="G-builder">

  <ultrathink>
    O ponto de raciocínio é a APROVAÇÃO como portão. Animar é o passo caro; o esqueleto é grátis. Se
    a animação puder ser disparada com um esqueleto não aprovado, o barato deixa de proteger o caro.
    Modele "aprovado" como estado explícito e faça o botão de animar depender dele no TIPO, não numa
    condição de runtime.
    Sobre a afim: escala uniforme. Escala não uniforme distorce ângulos de junta e o resultado parece
    quase certo, que é a pior categoria de erro visual.
  </ultrathink>

  <contexto>
    Os 18 rótulos que estimate-skeleton devolve e animate-with-skeleton aceita já estão no código, em
    tools/character-builder/server/model.ts (SKELETON_LABELS): NOSE, NECK, ombros, cotovelos, braços,
    quadris, joelhos, pernas, olhos e orelhas.
    E animate-with-skeleton exige EXATAMENTE 3 frames em skeleton_keypoints — o modelo é uma janela
    de 3 quadros, e outros números são rejeitados. Verificado no spec em 2026-07-30.
  </contexto>

  <ler_consideracoes_dos_anteriores>
    OBRIGATÓRIO F1-04: se `skeletons` veio populado, este card custa ZERO; se não veio, ele precisa
    de estimate-skeleton (US$ 0,0051, síncrono) e passa a ter `gasta: possivel` — o que é uma
    REFUTAÇÃO do bloco yaml deste card. Nesse caso ajuste o TASK_PLAN.md e diga por quê.
    Dependências diretas: F1-04.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-280..AB-289.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/animating-pixellab-sprites/SKILL.md
    - .agents/skills/handling-pixi-input/SKILL.md
    - .agents/skills/interpolating-pixi-state/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - tools/character-builder/server/model.ts — SKELETON_LABELS, Keypoint.
    - o spec: estimate-skeleton (resposta `keypoints`) e animate-with-skeleton (skeleton_keypoints
      com exatamente 3 frames, inpainting_images e mask_images como listas paralelas).
  </entradas>

  <o_que_fazer>
    1. affine.ts: `rescale(keypoints, alturaPx, alturaCanonica)` — escala UNIFORME mais translação,
       preservando a razão de aspecto. Função pura, sem DOM, sem rede.
    2. Testes de affine: escala 1 é identidade; dobrar a altura dobra as distâncias entre juntas;
       reescalar e desreescalar volta ao original dentro de tolerância declarada; e um teste que falha
       por AUSÊNCIA: um keypoint com rótulo desconhecido é rejeitado.
    3. editor.ts: arrastar os 18 pontos, slider de altura, botão Reescalar, botão Aprovar. Estado
       `aprovado` explícito, persistido no projeto.
    4. Nenhuma chamada de rede neste módulo. Nenhuma.
    5. Se for preciso estimate-skeleton, isole a chamada num módulo separado, atrás do guard, e
       NOMEIE o card que a introduziu.
  </o_que_fazer>

  <restricoes>
    - PROIBIDA qualquer chamada de API em editor.ts e affine.ts.
    - PROIBIDA escala não uniforme.
    - PROIBIDO destravar a animação sem aprovação explícita.
    - PROIBIDO inventar rótulo de junta fora dos 18 do spec.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-builder — bash scripts/new-task-worktree.sh F1-05</worktree>
    <revisao_adversarial>
      Contexto fresco:
        - existe algum caminho que dispare animação com o esqueleto NÃO aprovado?
        - o diálogo de custo abre em algum momento deste fluxo? (não pode)
        - a reescala preserva a razão de aspecto? Prove com dois números.
        - os testes de affine passariam se rescale devolvesse a entrada sem tocar em nada?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/character-builder && npm run typecheck && npm test
    # falha por AUSÊNCIA — o passo grátis tem de continuar grátis:
    ! grep -rnE "fetch\(|submit\(|/api/" tools/character-builder/src/skeleton/
    test "$(grep -c "" tools/character-builder/src/skeleton/affine.test.ts)" -ge 20
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F1-05. Publique a altura canônica adotada e a tolerância do teste de
    ida e volta. Destinatários: F1-07, F1-08.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F1-06` — O diálogo de custo, e o "já existe · US$ 0,00"

```yaml
id: F1-06
fase: F1
onda: W7
grupo: G-builder
deps: [F1-03]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - tools/character-builder/src/cost-dialog.ts
  - tools/character-builder/server/estimate.ts
faixa_ledger: AB-290..AB-299
```

| | |
| --- | --- |
| **Objetivo** | Antes de cada geração, na tela: quantas gerações, quanto estimado, quanto a sessão já gastou, quanto o mês já gastou. E, quando já existe, **zero**. |
| **Entradas** | o relatório do guard publicado por `F0-03` · `src/strings.ts`. |
| **Saídas** | diálogo em pt-BR, com os quatro números. |
| **Considerações** | — |

```xml
<task id="F1-06" nome="Diálogo de custo antes de cada geração" onda="W7" worktree="G-builder">

  <ultrathink>
    O número que engana é o "já existe · US$ 0,00": ele é verdade quando o cache funcionou E quando o
    catálogo está vazio. As duas leituras produzem o mesmo texto e significam o oposto. Ponha o
    DENOMINADOR ao lado — "0 de 8 a gerar, 8 em cache" — porque todo sinal que idealmente é zero
    precisa de um denominador para ser lido.
  </ultrathink>

  <contexto>
    O guard informa e nunca recusa (docs/adr/0012). Quem decide parar é o usuário. A idempotência
    continua dura: gerar o mesmo spec duas vezes nunca cobra duas vezes.
  </contexto>

  <ler_consideracoes_dos_anteriores>
    OBRIGATÓRIO F0-03 (a assinatura EXATA do relatório do guard — renderize aquilo, não o que este
    card supõe), F0-07 (strings), F1-03. Dependências diretas: F1-03.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-290..AB-299.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/guarding-generation-cost/SKILL.md
    - .agents/skills/building-pixi-ui/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - tools/pixellab-pipeline/src/cost.ts — a forma do relatório.
    - tools/pixellab-pipeline/src/cli.ts, cmdEstimate — o que já é impresso no terminal; a tela deve
      dizer a mesma coisa, não uma coisa diferente.
    - tools/character-builder/src/strings.ts.
  </entradas>

  <o_que_fazer>
    1. server/estimate.ts: endpoint local que devolve, para uma ação pedida, o relatório do guard
       mais o gasto da sessão e o do mês (lido do ledger).
    2. src/cost-dialog.ts: mostra gerações, estimado, sessão, mês. Confirmar / Cancelar. Cancelar
       NÃO submete nada.
    3. Quando nada há para gerar: "0 de N a gerar · N em cache · US$ 0,00". Com o denominador.
    4. Todo texto de strings.ts, em pt-BR, com acento.
    5. Quando o guard exigir confirmação, o botão Confirmar começa DESABILITADO por um instante e o
       aviso aparece primeiro. Confirmação por reflexo não é confirmação.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO recalcular custo na tela. O número vem do cost.ts do pipeline, fonte única.
    - PROIBIDO mostrar "US$ 0,00" sem o denominador.
    - PROIBIDO texto de UI fora de strings.ts.
    - PROIBIDO submeter qualquer coisa a partir deste módulo.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-builder — bash scripts/new-task-worktree.sh F1-06</worktree>
    <revisao_adversarial>
      Contexto fresco: o diálogo mostraria "US$ 0,00" com um catálogo vazio, sem dizer que está
      vazio? O número da tela pode divergir do que o CLI imprime? Cancelar realmente não submete —
      siga o caminho. Alguma string em inglês?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/character-builder && npm run typecheck && npm test
    # falha por AUSÊNCIA — o denominador é obrigatório:
    grep -qE "em cache|de [0-9N]+ a gerar" tools/character-builder/src/cost-dialog.ts
    ! grep -rn "0\.0173\|0\.01433" tools/character-builder/src/   # nenhum preço hardcoded na UI
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F1-06. Destinatário: F1-07, F1-09.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F1-07` — Andar, correr, pular: as três que nenhum template cobre

```yaml
id: F1-07
fase: F1
onda: W9
grupo: G-builder
deps: [F1-05, F1-06]
critico: true
gasta: possivel
worktree: sim
estado: pendente
arquivos:
  - tools/character-builder/server/animate.ts
  - tools/character-builder/server/animate.test.ts
faixa_ledger: AB-300..AB-309
```

| | |
| --- | --- |
| **Objetivo** | Produzir as três animações do editor sabendo **quanto custam**, e não descobrindo depois. |
| **Entradas** | o veredicto de `I-02/E2` e `E3` · o `character_id` de `F1-03`. |
| **Saídas** | as três animações × 8 direções, com o custo medido registrado. |
| **Considerações** | — |

**O fato desconfortável, e ele está no código de hoje.** A biblioteca de templates que o spec expõe
não tem `walk`, `run` nem `jump`: o prefixo visível é `angry, attack, attack-back, attack-left,
attack-right, backflip, bark, breathing-idle, cross-punch, crouched-walking, ...`. Por isso as três
poses embutidas do estúdio (`seedStudio`, em `server/model.ts`) usam `kind: 'action'`, que vira
`mode: 'v3'`.

**E `mode:'v3'` é exatamente a incógnita de `E3`.** Se ele cobrar 20-40 gerações por direção, este
card sozinho custa até **US$ 7,00 por personagem**. Se `E2` tiver revelado que `walking-4-frames`
existe como template, o mesmo resultado sai por 1 geração por direção.

```xml
<task id="F1-07" nome="Andar, correr e pular com o custo conhecido" onda="W9" worktree="G-builder">

  <ultrathink>
    Não comece a escrever antes de ler E2 e E3. Este card tem DUAS implementações possíveis, e qual
    delas é a certa é um fato medido, não uma preferência: se existir template para caminhar, o
    caminho é `mode:'template'` a 1 geração por direção; se não existir, é `mode:'v3'` e o card passa
    a ter um teto de custo que precisa aparecer na tela ANTES do botão.
    Segundo ponto, do spec: em modo v3 as direções default para SOMENTE SUL se `directions` não for
    passado. Esquecer o campo produz uma animação de uma direção só, e nada reclama.
  </ultrathink>

  <contexto>
    animate-character cobra POR DIREÇÃO e enfileira um job por direção, devolvendo uma lista de ids.
    Modo template: 1 geração por direção. Modo v3/custom: o spec diz 20-40 por direção em um trecho e
    descreve o v3 como o modo custom padrão em outro — os trechos conflitam, e E3 mede.
    keep_first_frame é `mode='v3'` APENAS, default true.
    Existe também POST /characters/animations, que faz o mesmo e devolve `background_job_ids`.
  </contexto>

  <ler_consideracoes_dos_anteriores>
    OBRIGATÓRIO: I-02 (E2 e E3), F1-05 (aprovação do esqueleto), F1-06 (o diálogo), F1-03
    (character_id e se as cardeais congelaram). Dependências diretas: F1-05, F1-06.
    Se E3 tiver medido 20-40 gerações por direção, ESTE CARD MUDA DE ESCOPO: proponha reduzir a uma
    direção por vez com confirmação individual, ajuste o TASK_PLAN.md e diga por quê. Não gere as
    oito no automático.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-300..AB-309.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/querying-pixellab-api/SKILL.md
    - .agents/skills/animating-pixellab-sprites/SKILL.md
    - .agents/skills/orchestrating-pixellab-jobs/SKILL.md
    - .agents/skills/guarding-generation-cost/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - docs/plano/experimentos/E2.md e E3.md — a evidência.
    - tools/character-builder/server/model.ts — as poses embutidas e TEMPLATE_ANIMATIONS.
    - tools/pixellab-pipeline/src/cost.ts — 'animate-character', billsPerDirection: true.
  </entradas>

  <o_que_fazer>
    1. Implemente o caminho que E2/E3 justificarem, e ESCREVA no código por que ele foi escolhido,
       citando o arquivo do experimento.
    2. `directions` SEMPRE explícito, com as oito. O default de "só sul" no modo v3 é uma armadilha.
    3. Uma linha de ledger por direção, com o `usage` cru — porque a cobrança é por direção.
    4. Teto na tela ANTES do botão: "até N gerações · até US$ X". Use o pior caso do intervalo, não o
       melhor.
    5. Se o modo escolhido for v3 e o custo medido for alto, gere UMA direção, confirme o resultado e
       só então ofereça as sete restantes.
    6. Retomada: um job já submetido nunca é resubmetido. Reuse QueueStore do pipeline.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO mode:'pro'. 20-40 gerações por direção, 160-320 para as oito, e o próprio spec diz que
      é pior. Exige ADR.
    - PROIBIDO omitir `directions`.
    - PROIBIDO usar keep_first_frame fora de mode v3 — o spec restringe, e passá-lo em template é
      afirmar um comportamento que não existe.
    - PROIBIDO submeter as oito direções sem confirmação quando o custo por direção for desconhecido.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-builder — bash scripts/new-task-worktree.sh F1-07</worktree>
    <revisao_adversarial>
      Contexto fresco, só o diff e este card:
        - existe caminho que submeta as 8 direções de uma vez sem o usuário ver o teto?
        - o código passa keep_first_frame em modo template?
        - se o poll de uma direção falhar, as outras sete continuam? E os ids ficaram em disco?
        - o custo impresso usa o pior caso ou o melhor?
        - `directions` está explícito em TODA chamada?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/character-builder && npm run typecheck && npm test
    grep -q "directions" tools/character-builder/server/animate.ts
    ! grep -n "mode: *'pro'" tools/character-builder/server/animate.ts
    # falha por AUSÊNCIA — a decisão tem de citar a evidência:
    grep -q "experimentos/E3" tools/character-builder/server/animate.ts
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F1-07. Publique o CUSTO REAL POR DIREÇÃO medido, e o custo total de um
    personagem completo. Destinatários: F1-08, F1-09, G-1, e a ADR 0006 — cuja tabela de custos
    passa a ter, pela primeira vez, uma fonte medida.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>
    meta-skill-evolution. Aqui é PROVÁVEL promover: o custo real de mode:'v3' é não-óbvio, não
    inferível do código, estável e muda como toda tarefa futura de animação deve ser feita. Escreva a
    asserção de teste ANTES da prosa. Apague TASK_PLAN.md.
  </evolucao>
</task>
```

---

### `F1-08` — Prévia: rosa dos ventos, ação, play/pause, scrubber, fps

```yaml
id: F1-08
fase: F1
onda: W10
grupo: G-builder
deps: [F1-07]
critico: true
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - tools/character-builder/src/preview/compass.ts
  - tools/character-builder/src/preview/player.ts
faixa_ledger: AB-310..AB-319
```

| | |
| --- | --- |
| **Objetivo** | Ver o personagem andando, nas oito direções, com controle de reprodução. |
| **Entradas** | os atlas de `F1-07` · a âncora medida de `F0-10` · `strings.ts`. |
| **Saídas** | prévia funcional. |
| **Considerações** | — |

**Rosa dos ventos, não `<select>`.** Direção é espacial: um seletor em lista força o usuário a
traduzir "sudoeste" para uma posição numa lista, e é onde leste e oeste se trocam sem que ninguém
perceba.

```xml
<task id="F1-08" nome="Prévia com rosa dos ventos e scrubber" onda="W10" worktree="G-builder">

  <ultrathink>
    O fps NÃO vive no JSON do Pixi — ele vive no sidecar .pixellab.json, e o `animationSpeed` do
    AnimatedSprite é fps/60, não fps. Errar essa divisão dá uma animação 60 vezes mais rápida ou mais
    lenta, e o sintoma parece problema de arte.
    Segundo: a âncora. Use a MEDIDA que F0-10 publicou, não a constante. Um erro de 12% num canvas de
    90 px é quase um nível inteiro de Z.
  </ultrathink>

  <contexto>
    O atlas sai em dois arquivos por família: <nome>.json estritamente formato Pixi, e
    <nome>.pixellab.json com fps, proveniência e âncoras. Nunca estenda o JSON do Pixi.
    Ordem canônica das direções: S, SW, W, NW, N, NE, E, SE.
  </contexto>

  <ler_consideracoes_dos_anteriores>
    F1-07 (o que existe para pré-visualizar), F0-10 (âncora medida e canvas real), F0-05 (pixi 8.19.0),
    F0-07 (strings). Dependências diretas: F1-07.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-310..AB-319.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/routing-pixijs-work/SKILL.md
    - .agents/skills/animating-pixi-sprites/SKILL.md
    - .agents/skills/bootstrapping-pixi-app/SKILL.md
    - .agents/skills/choosing-pixi-renderer/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - tools/pixellab-pipeline/src/atlas.ts — PIXI_CLIENT_SNIPPET tem a metade do cliente do
      pixel-perfect: scaleMode 'nearest' e mipmaps desligados ANTES de qualquer Assets.load.
    - o sidecar .pixellab.json — fps e âncora.
  </entradas>

  <o_que_fazer>
    1. Rosa dos ventos: oito botões dispostos espacialmente, rotulados S, SW, W, NW, N, NE, E, SE.
    2. Seletor de ação, play/pause, scrubber por quadro, campo de fps editável que altera a
       reprodução ao vivo e é gravado no sidecar (pós-processamento — nunca custa nada).
    3. TextureSource.defaultOptions.scaleMode = 'nearest' e autoGenerateMipmaps = false ANTES do
       primeiro Assets.load. Escala do palco em número INTEIRO.
    4. Âncora vinda do sidecar. Se `anchorSource` for 'padrao', mostre um aviso na tela — o usuário
       tem direito de saber que está vendo um chute.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO <select> para direção.
    - PROIBIDO escrever fps no JSON do Pixi.
    - PROIBIDO escala fracionária do palco. Pixel art com upscale não inteiro serrilha.
    - PROIBIDO usar animationSpeed = fps sem dividir por 60.
    - PROIBIDO texto de UI fora de strings.ts.
  </restricoes>

  <swarm>
    <subagents>Agente único para escrever; fan-out de leitura nas skills vendorizadas do PixiJS.</subagents>
    <worktree>G-builder — bash scripts/new-task-worktree.sh F1-08</worktree>
    <revisao_adversarial>
      Contexto fresco:
        - a prévia ficaria idêntica se o atlas estivesse VAZIO? (se sim, o smoke passa com uma tela em
          branco — é a refutação clássica)
        - scaleMode é setado antes ou depois do primeiro Assets.load?
        - animationSpeed usa fps/60?
        - a escala do palco é inteira em todos os níveis de zoom oferecidos?
        - clicar em "leste" mostra o sprite de leste? Prove pelo nome do frame, não pelo olho.
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/character-builder && npm run typecheck && npm test
    node .agents/skills/scripts/check-pixi-claims.mjs      # exit 0
    grep -q "nearest" tools/character-builder/src/preview/player.ts
    # falha por AUSÊNCIA:
    ! grep -rn "<select" tools/character-builder/src/preview/compass.ts
    grep -q "/ 60" tools/character-builder/src/preview/player.ts
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F1-08. Destinatários: G-1, F4-02.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F1-09` — Idempotência ponta a ponta: repetir e não gastar

```yaml
id: F1-09
fase: F1
onda: W10
grupo: G-builder
deps: [F1-07]
critico: true
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - tools/character-builder/server/idempotence.test.ts
faixa_ledger: AB-320..AB-329
```

| | |
| --- | --- |
| **Objetivo** | Provar, no fluxo inteiro do builder, que repetir os passos 2 e 3 produz **0 gerações, US$ 0,00 e nenhuma requisição HTTP**. |
| **Entradas** | todo o caminho de `F1-02` a `F1-07`. |
| **Saídas** | um teste que conta requisições. |
| **Considerações** | — |

```xml
<task id="F1-09" nome="Teste de idempotência ponta a ponta do builder" onda="W10" worktree="G-builder">

  <ultrathink>
    Contar ARQUIVOS não prova nada: o disco pode estar cheio e o código ainda assim ter chamado a
    API. O que prova é contar REQUISIÇÕES, no objeto que faz o fetch. E o teste precisa de um caso
    positivo: a primeira passada tem de contar N > 0. Um teste que só afirma "0 na segunda" passa com
    uma implementação que nunca chama nada.
  </ultrathink>

  <contexto>
    Gerar de novo com o mesmo spec não deve gastar nada — saldo idêntico antes e depois. É a regra
    dura do AGENTS.md, e o teste equivalente no pipeline é de F0-08. Este é o do builder.
  </contexto>

  <ler_consideracoes_dos_anteriores>
    F1-07, F1-06, F1-03, F1-02, F0-08 (o padrão de cliente falso que conta submits — reuse-o, não
    invente outro). Dependências diretas: F1-07.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-320..AB-329.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/testing-repo-code/SKILL.md
    - .agents/skills/guarding-generation-cost/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - tools/pixellab-pipeline/src/catalog.test.ts (de F0-08) — o padrão a reusar.
    - todo o caminho server/rotate.ts → server/api.ts → server/animate.ts.
  </entradas>

  <o_que_fazer>
    1. Cliente falso que conta requisições por endpoint. Primeira passada: conta > 0 por endpoint
       esperado. Segunda passada, com o mesmo estado em disco: conta EXATAMENTE 0.
    2. Cubra os três: rotate, 8-directions e animate.
    3. Prove que o teste reprova: mude o seed de propósito e exija que a contagem volte a ser > 0.
    4. Meça também o gasto: o ledger não ganha linha nova na segunda passada.
  </o_que_fazer>

  <restricoes>
    - PROIBIDA rede.
    - PROIBIDO contar arquivos em vez de requisições.
    - PROIBIDO editar código de produção. Se um teste não passar sem mudar a implementação, isso é
      REFUTAÇÃO: escreva nas Considerações e pare.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-builder — bash scripts/new-task-worktree.sh F1-09</worktree>
    <revisao_adversarial>
      Contexto fresco: o teste passaria com uma implementação que nunca chama a API? O contador está
      no cliente ou acima dele? A segunda passada relê o estado do disco? O ledger é conferido?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/character-builder && npm test
    npm test 2>&1 | grep -q "0 requisições"
    npm test 2>&1 | grep -qE "primeira passada.*[1-9]"
    ! grep -rn "https://api" tools/character-builder/server/*.test.ts
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F1-09. Destinatário: G-1.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `G-1` — GATE: o construtor de personagem, na tela, nesta ordem

```yaml
id: G-1
fase: gate
onda: W11
grupo: G-infra
deps: [F1-08, F1-09]
critico: true
gasta: possivel
worktree: nao
estado: pendente
arquivos: []
faixa_ledger: AB-330..AB-339
```

Os sete passos do critério de saída, executados na tela, **nesta ordem**:

| # | Passo | O que tem de acontecer |
| --- | --- | --- |
| 1 | Anexar o PNG sul e informar a altura | validação de dimensão **antes** de qualquer chamada |
| 2 | "Gerar 4 cardeais" | diálogo `3 gerações · ~US$ 0,032 · sessão US$ 0,00` → Confirmar |
| 3 | "Gerar 8 direções" | as 4 cardeais aparecem **idênticas** ao anexado — prova de que `directions` congelou |
| 4 | Editor de esqueleto | **o diálogo de custo não abre** |
| 5 | Aprovar | os botões de animação destravam |
| 6 | Prévia | rosa dos ventos, seletor de ação, play/pause, scrubber, fps ao vivo |
| 7 | **Repetir 2 e 3** | `0 gerações · US$ 0,00 · já existe`, e **nenhuma requisição HTTP sai** |

O passo 7 é o único que não se confere pelo olho. Confira-o por dois meios independentes: o teste de
`F1-09` e o `balance` antes e depois.

```bash
cd tools/pixellab-pipeline && node src/cli.ts balance   # antes
# … repetir os passos 2 e 3 na tela …
cd tools/pixellab-pipeline && node src/cli.ts balance   # depois: o MESMO número
bash scripts/gate.sh
```

**Pré-requisitos:** `P1` idempotência do builder provada (`F1-09`) · `P2` custo real por direção
medido e registrado (`F1-07`) · `P3` congelamento das cardeais verificado por pixel (`F1-03`) ·
`P4` nenhum item do ledger fechado sem evidência.

Registre nas Considerações o **custo total real** do primeiro personagem completo. É o número que vai
calibrar todo orçamento seguinte, e é a primeira vez que este projeto o terá medido em vez de
estimado.

---

## Fase 2 — Construtor de mapa XYZ

Tile **64×32**, um nível Z vale **16 px**, Z **inteiro** (ADR 0013). Blocos empilhados por célula.

```text
worldToScreen(x,y,z):   sx = (x-y)*32            sy = (x+y)*16 - z*16
screenToWorld(sx,sy,z):  a = sx/32   b = (sy+z*16)/16   x = (b+a)/2   y = (b-a)/2
```

A propriedade que torna o picking exato e barato:
`screenToWorld(sx,sy,z+1) === screenToWorld(sx,sy,z) + (1,1)`. O raio da câmera em espaço de grid é
**exatamente a diagonal (+1,+1,+1)** — selecionar sob o cursor é caminhar essa diagonal do topo para
baixo. Sem raycast, sem heurística.

**Quatro decisões de modelo, e o porquê de cada uma.** `blocks` denso com RLE, porque Z discreto é
campo voxel e dicionário esparso explode em terreno preenchido. `edges` esparso, porque parede é
rara. **A altura de cada célula é derivada, nunca armazenada** — guardar mapa de altura *e* mapa de
blocos é criar duas verdades sobre o mesmo terreno. **Parede é de ARESTA, bloco é de CÉLULA** — não
é gosto: é o que o `tile_rules` entrega, e modelar parede como cubo joga fora a conectividade que a
API devolve.

**Onde a ordenação falha, honestamente.** A chave é `x+y+z`, com paredes a meia célula. Falha em dois
casos: sprite mais alto que um nível de Z reivindica uma célula e ocupa quatro na tela; e objeto
multi-célula produz **oclusão cíclica**, para a qual não existe ordem linear correta. A mitigação é
de modelo, não de renderizador: **o formato de projeto proíbe sprite multi-célula**. Um editor pode
impor isso; um jogo herdado não podia.

---

### `F2-01` — Geometria isométrica em `iso-core`

```yaml
id: F2-01
fase: F2
onda: W5
grupo: G-core
deps: [G-0]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - packages/iso-core/src/geometry.ts
  - packages/iso-core/src/geometry.test.ts
faixa_ledger: AB-340..AB-349
```

**Preenchedor de paralelismo, de propósito.** Este card só é consumido dois níveis adiante; foi
puxado para a W5 para engrossar uma onda magra. É folga gasta, não dependência antecipada — e o
validador vai reportar a folga como aviso.

```xml
<task id="F2-01" nome="Geometria isométrica pura" onda="W5" worktree="G-core">

  <ultrathink>
    Toda a Fase 2 se apoia nestas duas funções. O ponto de raciocínio é o ARREDONDAMENTO: screenToWorld
    devolve fracionário e alguém tem de decidir onde a célula começa. Decida UMA VEZ, aqui, e escreva
    a regra — porque se cada consumidor arredondar do seu jeito, a célula sob o cursor e a célula
    pintada divergem em uma unidade nas bordas, e o sintoma é "às vezes pinta o quadrado errado".
  </ultrathink>

  <contexto>iso-core é o núcleo compartilhado entre editor e runtime. Zero dependência, zero
    conhecimento de tools/**. Tile 64×32, zStep 16, Z inteiro (docs/adr/0013).</contexto>

  <ler_consideracoes_dos_anteriores>G-0, F0-11 (o schema v1 e a geometria como DADO — leia daqui, não
    de constantes). Dependências diretas: G-0.</ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-340..AB-349.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/composing-pixi-scene/SKILL.md
    - .agents/skills/testing-repo-code/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - docs/adr/0013-geometria-isometrica-64x32-z16.md
    - packages/iso-core/src/project.ts — tileWidth, tileHeight, zStep vêm do PROJETO, não de
      constantes no módulo. Um runtime que assume 64×32 não consegue abrir um projeto com outra
      geometria, e o formato já carrega o dado.
  </entradas>

  <o_que_fazer>
    1. worldToScreen(x,y,z, geom) e screenToWorld(sx,sy,z, geom), com a geometria como parâmetro.
    2. A regra de arredondamento, escrita e testada.
    3. Testes:
       a. ida e volta para uma grade de (x,y,z) inteiros: worldToScreen depois screenToWorld devolve
          o original;
       b. A PROPRIEDADE DA DIAGONAL: para qualquer (sx,sy) e qualquer z,
          screenToWorld(sx,sy,z+1) == screenToWorld(sx,sy,z) + (1,1). Esta é a asserção mais
          importante do arquivo — é ela que autoriza o picking de F2-06;
       c. bordas: um ponto exatamente na aresta entre duas células cai sempre no mesmo lado;
       d. falha por AUSÊNCIA: uma geometria com tileHeight != tileWidth/2 é REJEITADA — a projeção é
          2:1 fixa, e aceitar outra silenciosamente produz um mapa que não fecha.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO importar de tools/** ou de pixi.js.
    - PROIBIDO hardcodar 64, 32 ou 16 no corpo das funções.
    - PROIBIDO usar Math.round sem declarar a regra de borda.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-core — bash scripts/new-task-worktree.sh F2-01</worktree>
    <revisao_adversarial>
      Contexto fresco: a propriedade da diagonal vale para z negativo? E para sx negativo? O teste de
      ida e volta passaria se as duas funções fossem a identidade? Existe algum 64 ou 32 literal?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd packages/iso-core && npm test && npm run typecheck
    npm test 2>&1 | grep -q "diagonal"
    ! grep -nE "\b(64|32|16)\b" packages/iso-core/src/geometry.ts   # sem literal de geometria
    ! grep -rn "pixi\|tools/" packages/iso-core/src/geometry.ts
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F2-01. Publique a regra de arredondamento e a assinatura das duas
    funções. Destinatários: F2-02, F2-05, F2-06, F3-01, F4-02.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F2-02` — O modelo do mapa: `blocks` denso com RLE, `edges` esparso, altura derivada

```yaml
id: F2-02
fase: F2
onda: W6
grupo: G-core
deps: [F2-01]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - packages/iso-core/src/map.ts
  - packages/iso-core/src/map.test.ts
faixa_ledger: AB-350..AB-359
```

```xml
<task id="F2-02" nome="Modelo do mapa XYZ" onda="W6" worktree="G-core">

  <ultrathink>
    A decisão que não pode ser revista depois é DUAS VERDADES SOBRE O MESMO TERRENO. Se você guardar
    um mapa de altura ao lado do mapa de blocos "por desempenho", eles vão divergir — não talvez, vão
    — e o bug resultante é intermitente e irreproduzível. Altura é DERIVADA, sempre, e se ficar lento
    isso é cache com invalidação explícita, não um segundo campo persistido.
  </ultrathink>

  <contexto>
    Z discreto é campo voxel: dicionário esparso explode em terreno preenchido, por isso blocks é
    denso com RLE. Parede é rara, por isso edges é esparso. Parede é de ARESTA e bloco é de CÉLULA,
    porque é isso que o tile_rules da API entrega — modelar parede como cubo joga fora a
    conectividade.
  </contexto>

  <ler_consideracoes_dos_anteriores>F2-01 (assinaturas e arredondamento), F0-11 (o campo `map`
    reservado no schema v1 — você é o DONO dele). Dependências diretas: F2-01.</ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-350..AB-359.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/composing-pixi-scene/SKILL.md
    - .agents/skills/rendering-pixi-tilemap/SKILL.md
    - .agents/skills/testing-repo-code/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - packages/iso-core/src/project.ts — o campo `map`, hoje vazio e reservado para você.
    - packages/iso-core/src/geometry.ts.
  </entradas>

  <o_que_fazer>
    1. `blocks`: arranjo denso por (x,y,z) com codificação RLE na serialização. Teste que um mapa
       preenchido serializa pequeno e que ida e volta preserva tudo.
    2. `edges`: esparso, chaveado por (x,y,z,lado). Lados: N, L, S, O. **Escreva a convenção de qual
       índice é qual lado, aqui, uma vez.**
    3. `heightAt(x,y)` DERIVADA de blocks. Nenhum campo de altura persistido.
    4. O formato PROÍBE sprite multi-célula: um objeto declara exatamente uma célula. Faça disso um
       erro de validação em loadProject, não uma convenção.
    5. Testes, incluindo um que falha por AUSÊNCIA: um `project.json` com objeto multi-célula tem de
       ser REJEITADO na leitura.
    6. Estenda o schema v1 do project.json com o campo map, e mantenha a leitura de projetos antigos
       (sem map) funcionando.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO persistir mapa de altura.
    - PROIBIDO modelar parede como bloco.
    - PROIBIDO permitir sprite multi-célula no formato — é a mitigação da oclusão cíclica, e é a
      única que existe.
    - PROIBIDO importar de tools/** ou pixi.js.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-core — bash scripts/new-task-worktree.sh F2-02</worktree>
    <revisao_adversarial>
      Contexto fresco: existe algum caminho em que a altura é lida de um campo em vez de derivada?
      Um projeto com objeto de 2×1 células é aceito? O RLE de um mapa TODO vazio ocupa quanto? E de
      um mapa todo cheio? A convenção de lados está escrita em UM lugar só?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd packages/iso-core && npm test && npm run typecheck
    npm test 2>&1 | grep -q "multi-célula"
    ! grep -rniE "heightMap|mapaDeAltura|heights:" packages/iso-core/src/map.ts
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F2-02. Publique: o formato exato de blocks e edges, e a convenção de
    lados. Destinatários nomeados: F2-03, F2-04, F2-07, F3-01, F3-02, F4-01.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F2-03` — Ordenação de desenho `x+y+z`, e os dois casos em que ela falha

```yaml
id: F2-03
fase: F2
onda: W7
grupo: G-core
deps: [F2-02]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - packages/iso-core/src/depth.ts
  - packages/iso-core/src/depth.test.ts
faixa_ledger: AB-360..AB-369
```

```xml
<task id="F2-03" nome="Chave de profundidade e seus limites" onda="W7" worktree="G-core">

  <ultrathink>
    Não tente consertar a oclusão cíclica com um comparador melhor. Não existe ordem linear correta
    para um ciclo — é um fato de teoria de ordem, não uma limitação de implementação. A mitigação já
    foi tomada no MODELO (F2-02 proíbe multi-célula). O trabalho aqui é ORDENAR o que é ordenável e
    DOCUMENTAR o que não é, com um teste que demonstra o caso patológico em vez de escondê-lo.
  </ultrathink>

  <contexto>Chave x+y+z, paredes a meia célula. Falha em dois casos conhecidos: sprite mais alto que
    um nível de Z, e objeto multi-célula (proibido pelo formato).</contexto>

  <ler_consideracoes_dos_anteriores>F2-02 (formato de blocks e edges, convenção de lados), F2-01.
    Dependências diretas: F2-02.</ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-360..AB-369.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/composing-pixi-scene/SKILL.md
    - .agents/skills/rendering-pixi-tilemap/SKILL.md
  </skills_obrigatorias>

  <entradas>packages/iso-core/src/map.ts, geometry.ts.</entradas>

  <o_que_fazer>
    1. `depthKey(celula)` = x+y+z, com paredes deslocadas de meia célula segundo o lado.
    2. Ordenação estável: empate resolve por uma regra declarada, nunca pela ordem de inserção.
    3. Teste que DEMONSTRA a falha do sprite alto: monte o caso, mostre que a ordem sai errada, e
       marque-o como limitação conhecida — não como bug a corrigir aqui.
    4. Teste que garante que o caso multi-célula não chega até aqui, porque o formato o rejeita antes.
    5. Nada de PixiJS neste módulo: ele devolve uma ordem, quem desenha é F2-05.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO importar pixi.js.
    - PROIBIDO "resolver" oclusão cíclica com heurística.
    - PROIBIDO ordenação instável.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-core — bash scripts/new-task-worktree.sh F2-03</worktree>
    <revisao_adversarial>
      Contexto fresco: a ordem é estável entre execuções? O teste do sprite alto realmente demonstra
      a falha, ou foi escrito de um jeito que passa? Paredes de lados opostos da mesma aresta
      empatam — quem vem primeiro, e a regra está escrita?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd packages/iso-core && npm test && npm run typecheck
    npm test 2>&1 | grep -qi "limitação conhecida"
    ! grep -rn "pixi" packages/iso-core/src/depth.ts
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F2-03. Publique a regra de desempate e a lista NOMINAL das limitações
    demonstradas. Destinatários: F2-05, F4-02.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F2-04` — O parser de `tile_rules`, escrito contra uma resposta real

```yaml
id: F2-04
fase: F2
onda: W8
grupo: G-core
deps: [F2-03, I-02]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - packages/iso-core/src/tile-rules.ts
  - packages/iso-core/src/tile-rules.test.ts
faixa_ledger: AB-370..AB-379
```

**Este parser não pode ser escrito às cegas.** `tile_rules` é `additionalProperties: true` no spec: a
semântica está em prosa e **nada é tipado**. A descrição diz *rule_type `edge|corner|outline`,
arity 4 (arestas ou cantos de quadrado/isométrico) ou 6 (arestas de hex), connectivity `same|other`,
terrains [feature, background]*.

> **`NÃO VERIFICADO`:** a atribuição de bits do caso `edge/4` — se `bit0` é norte, `bit1` leste e
> assim por diante — **não está no spec**. O replanejamento afirmou `bit0=N bit1=L bit2=S bit3=O`;
> essa afirmação não tem fonte. Só a resposta real de `I-02/E4` decide, e é por isso que este card
> depende dela.

E o kit de construção vem de `tile_feature: 'building'` em `/create-tiles-pro`, que o spec descreve
como *"construction kit — floor, connectable walls, doorways, pillar and staircase"*, com as regras de
posicionamento em `GET /tiles-pro/{tile_id}`. **Qual peça é a porta e qual é a escada não tem campo
documentado** — é a segunda metade do que `E4` mede.

```xml
<task id="F2-04" nome="Parser de tile_rules contra resposta real" onda="W8" worktree="G-core">

  <ultrathink>
    Escreva o parser CONTRA O ARQUIVO que E4 gravou, e faça dele a fixture do teste. Se você inferir
    o formato do texto do spec, o parser vai estar plausível e errado — e o sintoma será um mapa
    montado com as peças trocadas, que ninguém percebe até tentar atravessar uma porta que é parede.
    Onde E4 não responder, ASSUMA E MARQUE: `// ABERTO AB-nnn: assume bit0 = norte; ver ledger`.
  </ultrathink>

  <contexto>
    A API devolve, para conjuntos conectáveis, regras de posicionamento por peça. Autoladrilhamento
    no editor consome essas regras — não uma tabela inventada por nós.
  </contexto>

  <ler_consideracoes_dos_anteriores>
    OBRIGATÓRIO I-02/E4 — a resposta crua. Sem ela este card NÃO É EXECUTÁVEL: pare, diga por quê, e
    devolva para reescrita fora da onda. F2-03, F2-02. Dependências diretas: F2-03, I-02.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-370..AB-379. Aqui é ESPERADO abrir vários.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/querying-pixellab-api/SKILL.md
    - .agents/skills/generating-pixellab-tilesets/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - docs/plano/experimentos/E4.md — a resposta real. É a fonte, e é a fixture.
    - o spec: GET /tiles-pro/{tile_id}, campo tile_rules e campo kind.
    - packages/iso-core/src/map.ts — a convenção de lados que F2-02 fixou.
  </entradas>

  <o_que_fazer>
    1. Parser que aceita a resposta real e devolve, por peça: rule_type, arity, connectivity,
       terrains e a máscara.
    2. Mapeie a máscara da API para a convenção de lados de F2-02, EXPLICITAMENTE, numa função só,
       com o teste que prova o mapeamento contra a fixture.
    3. Peça desconhecida é ERRO nomeado, nunca ignorada em silêncio. Um parser que pula o que não
       entende reporta verde por omissão.
    4. Identifique porta, pilar e escada. Se o campo não existir, marque a heurística usada com
       `// ABERTO AB-nnn` e abra o item no ledger com os cinco campos.
    5. A fixture é o arquivo de E4, versionado em packages/iso-core/test-fixtures/.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO inventar a atribuição de bits sem citar E4.
    - PROIBIDO ignorar peça desconhecida.
    - PROIBIDO chamar a API deste card. A chamada já foi feita e paga em I-02.
    - PROIBIDO importar de tools/**.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-core — bash scripts/new-task-worktree.sh F2-04</worktree>
    <revisao_adversarial>
      Contexto fresco:
        - alguma chave do parser não existe na fixture de E4? Liste-as.
        - alguma foi inventada a partir do texto do spec em vez de lida da resposta?
        - o parser passa silenciosamente por uma peça que não reconhece?
        - o mapeamento de bits está testado contra a fixture ou só contra ele mesmo?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd packages/iso-core && npm test && npm run typecheck
    test -f packages/iso-core/test-fixtures/tiles-pro-building.json
    npm test 2>&1 | grep -q "tile_rules"
    # falha por AUSÊNCIA: toda suposição está ancorada no código
    grep -q "ABERTO AB-" packages/iso-core/src/tile-rules.ts || echo "ok: nenhuma suposição restante"
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F2-04. Publique o mapeamento de bits DESCOBERTO e o que ficou aberto.
    Destinatários: F2-07, F2-08.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>
    meta-skill-evolution. PROVÁVEL promover: o shape real de tile_rules é não-óbvio, não inferível do
    código e muda toda tarefa futura de mapa. Escreva o eval antes da prosa.
  </evolucao>
</task>
```

---

### `F2-05` — O renderizador do mapa, em PixiJS 8

```yaml
id: F2-05
fase: F2
onda: W8
grupo: G-map
deps: [F2-03, F0-05]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - tools/map-builder/package.json
  - tools/map-builder/index.html
  - tools/map-builder/vite.config.ts
  - tools/map-builder/src/app.ts
  - tools/map-builder/src/renderer.ts
faixa_ledger: AB-380..AB-389
```

```xml
<task id="F2-05" nome="Renderizador isométrico do mapa" onda="W8" worktree="G-map">

  <ultrathink>
    Três coisas decidem se a arte sai nítida, e as três são do cliente: scaleMode 'nearest', mipmaps
    desligados e UM upscale inteiro. Se qualquer uma falhar, o sintoma é "a arte está borrada" e a
    causa parece ser a arte. Configure as três ANTES do primeiro Assets.load — o global cobre o caso
    comum, e explicitamente na folha cobre o resto.
    Segundo: PixiJS 8 tem init assíncrono, que a v7 não tinha. `new Application()` seguido de uso
    imediato não funciona.
  </ultrathink>

  <contexto>
    tools/map-builder é uma ferramenta NOVA. Ela consome packages/iso-core e desenha; ela não define
    modelo nem geometria. pixi.js está pinado em 8.19.0, exato, e um verificador falha se divergir do
    vendor (card F0-05).
  </contexto>

  <ler_consideracoes_dos_anteriores>
    F2-03 (a ordem de desenho e as limitações), F2-02 (formato), F2-01 (geometria), F0-05 (o pino),
    F0-10 (âncora medida). Dependências diretas: F2-03, F0-05.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-380..AB-389.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/routing-pixijs-work/SKILL.md    (sub-router: entre por ele)
    - .agents/skills/bootstrapping-pixi-app/SKILL.md
    - .agents/skills/choosing-pixi-renderer/SKILL.md
    - .agents/skills/composing-pixi-scene/SKILL.md
    - .agents/skills/rendering-pixi-tilemap/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - tools/character-builder/vite.config.ts — o padrão de app deste repositório.
    - tools/pixellab-pipeline/src/atlas.ts, PIXI_CLIENT_SNIPPET.
    - tools/pixi-reference/vendor/pixi-api.d.ts — a superfície real. Consulte com
      `node .agents/skills/routing-pixijs-work/scripts/inspect-pixi.mjs`, não carregue as 47.533 linhas.
  </entradas>

  <o_que_fazer>
    1. Scaffold do tools/map-builder: package.json com pixi.js 8.19.0 EXATO, vite, tsconfig com as
       mesmas opções estritas dos outros pacotes.
    2. Application com init assíncrono. Ticker separado do relógio de lógica.
    3. Renderizar um mapa de fixture usando a ordem de F2-03. Câmera com deslocamento; escala do
       palco em número inteiro.
    4. Culling: use cullArea, ciente de que o espaço de coordenadas dela mudou em 8.16.0 — confira
       contra o vendor antes de assumir.
    5. Teardown completo ao fechar: sem vazar textura, sem vazar ticker.
    6. NADA de edição neste card. Só desenha. Pintar é F2-07.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO escala fracionária do palco.
    - PROIBIDO mipmap.
    - PROIBIDO chamar API do PixelLab.
    - PROIBIDO reimplementar geometria ou ordenação — importe de iso-core.
    - PROIBIDO usar método deprecado da v7: eles continuam existindo como shim e typecheckam limpo.
      `check-pixi-claims.mjs` falha neles de propósito.
  </restricoes>

  <swarm>
    <subagents>Agente único para escrever. Fan-out de leitura nas skills vendorizadas.</subagents>
    <worktree>G-map — bash scripts/new-task-worktree.sh F2-05</worktree>
    <revisao_adversarial>
      Contexto fresco:
        - o smoke passaria com um mapa VAZIO? (a refutação favorita — exija um caso positivo)
        - scaleMode é setado antes do primeiro Assets.load?
        - a escala do palco é inteira em TODOS os níveis de zoom oferecidos?
        - existe alguma chamada deprecada da v7?
        - fechar e reabrir o editor vaza textura? Meça.
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/map-builder && npm run typecheck
    cd tools/map-builder && npm ls pixi.js | grep -q "pixi.js@8.19.0"
    node .agents/skills/scripts/check-pixi-claims.mjs
    node scripts/check-pixi-pin.mjs
    # falha por AUSÊNCIA — não pode haver geometria duplicada:
    ! grep -rnE "\(x-y\)\s*\*|worldToScreen\s*\(.*\)\s*\{" tools/map-builder/src/
    grep -rq "iso-core" tools/map-builder/src/
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F2-05. Publique o custo de quadro medido com N tiles e o número de
    draw calls. **É a primeira medição de desempenho deste projeto** — antes dela, tudo que se disse
    sobre desempenho era leitura de spec. Destinatários: F2-06, F2-07, F4-02.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F2-06` — Picking pela diagonal

```yaml
id: F2-06
fase: F2
onda: W9
grupo: G-map
deps: [F2-05]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - tools/map-builder/src/picking.ts
  - tools/map-builder/src/picking.test.ts
faixa_ledger: AB-390..AB-399
```

```xml
<task id="F2-06" nome="Seleção sob o cursor pela diagonal" onda="W9" worktree="G-map">

  <ultrathink>
    Não use hit-test do renderizador. A propriedade da diagonal (F2-01) torna o picking ARITMÉTICA:
    caminhe (+1,+1,+1) do z mais alto para o mais baixo e pare na primeira célula ocupada. Isso é
    exato, barato e independente do renderizador — e um hit-test com sprites sobrepostos daria a
    resposta errada exatamente onde importa: nas bordas.
    Num editor, o clique É a edição. Uma célula errada selecionada não é um detalhe visual.
  </ultrathink>

  <contexto>O default de interatividade do PixiJS não emite evento nenhum sem configuração — o
    sintoma é "o clique não faz nada" e a causa não é o seu código.</contexto>

  <ler_consideracoes_dos_anteriores>F2-05, F2-01 (a propriedade da diagonal e o arredondamento),
    F2-02. Dependências diretas: F2-05.</ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-390..AB-399.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/handling-pixi-input/SKILL.md
    - .agents/skills/composing-pixi-scene/SKILL.md
  </skills_obrigatorias>

  <entradas>packages/iso-core/src/geometry.ts e map.ts; tools/map-builder/src/renderer.ts.</entradas>

  <o_que_fazer>
    1. `pick(sx, sy, map)`: do z máximo ao mínimo, caminhando a diagonal, devolve a primeira célula
       ocupada, ou o piso.
    2. Testes contra um mapa de fixture com degraus: cada ponto de tela tem uma resposta esperada
       escrita à mão. Inclua os pontos de borda entre células.
    3. Falha por AUSÊNCIA: um clique fora dos limites do mapa devolve "nenhuma", não a célula 0,0.
    4. Realce da célula sob o cursor. Se usar filtro, saiba que ele força um render target e quebra o
       batch — para UMA célula isso é aceitável; para uma grade inteira não é.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO hit-test de sprite.
    - PROIBIDO reimplementar screenToWorld.
    - PROIBIDO filtro por célula em quantidade.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-map — bash scripts/new-task-worktree.sh F2-06</worktree>
    <revisao_adversarial>
      Contexto fresco: existe ponto de tela em que a célula escolhida difere da desenhada por cima?
      O picking depende da câmera estar em posição inteira? O teste passaria se pick devolvesse
      sempre a célula do piso?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/map-builder && npm run typecheck && npm test
    npm test 2>&1 | grep -q "borda"
    ! grep -rn "hitArea\|containsPoint" tools/map-builder/src/picking.ts
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F2-06. Destinatário: F2-07.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F2-07` — Pintar: chão, blocos, paredes na aresta, porta, pilar e escada

```yaml
id: F2-07
fase: F2
onda: W10
grupo: G-map
deps: [F2-06, F2-04]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - tools/map-builder/src/tools/paint.ts
  - tools/map-builder/src/tools/stack.ts
  - tools/map-builder/src/tools/wall.ts
faixa_ledger: AB-400..AB-409
```

**Ordem de merge declarada:** este card mergeia **por último** na onda W10. Ele consome o parser de
`F2-04` e o picking de `F2-06`, e é o único que escreve no estado do mapa a partir da interface.

```xml
<task id="F2-07" nome="Ferramentas de pintura do mapa" onda="W10" worktree="G-map">

  <ultrathink>
    Bloco é de CÉLULA, parede é de ARESTA — e a interface tem de tornar isso óbvio, não só o modelo.
    Se o usuário clicar no meio de uma célula esperando pôr parede, ele vai pôr bloco; a affordance
    tem de mudar perto da aresta. Confundir os dois no modelo é o bug clássico de atravessar parede
    na diagonal; confundi-los na interface é o usuário construindo o mapa errado sem perceber.
  </ultrathink>

  <contexto>Kit de construção: chão, paredes conectáveis, porta, pilar e escada — é literalmente o
    que tile_feature 'building' entrega. Autoladrilhamento consome tile_rules (F2-04).</contexto>

  <ler_consideracoes_dos_anteriores>
    F2-06 (a assinatura de pick), F2-04 (o mapeamento de bits e o que ficou aberto), F2-02 (convenção
    de lados). Dependências diretas: F2-06, F2-04.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-400..AB-409.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/handling-pixi-input/SKILL.md
    - .agents/skills/generating-pixellab-tilesets/SKILL.md
    - .agents/skills/building-pixi-ui/SKILL.md
  </skills_obrigatorias>

  <entradas>packages/iso-core/src/map.ts e tile-rules.ts; tools/map-builder/src/picking.ts.</entradas>

  <o_que_fazer>
    1. Pintar chão; empilhar e remover bloco; colocar parede numa aresta; colocar porta, pilar e
       escada.
    2. Perto da aresta, o cursor muda para o modo parede. A affordance é parte do card.
    3. Desfazer e refazer, sobre o modelo — não sobre a tela.
    4. Todo texto de interface em pt-BR, centralizado.
    5. Nenhuma escrita direta no estado: tudo por operações do iso-core, para que o runtime veja o
       mesmo modelo.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO permitir sprite multi-célula.
    - PROIBIDO gravar parede como bloco.
    - PROIBIDO desfazer que reconstrua a tela em vez do modelo.
    - PROIBIDO texto de UI fora do módulo de strings.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-map — bash scripts/new-task-worktree.sh F2-07</worktree>
    <revisao_adversarial>
      Contexto fresco: existe caminho em que uma parede é gravada como bloco? Desfazer 20 vezes
      devolve exatamente o estado inicial — compare os JSON. Uma escada colocada onde não cabe é
      recusada ou aceita? Alguma string em inglês?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/map-builder && npm run typecheck && npm test
    npm test 2>&1 | grep -q "desfazer"
    ! grep -rn "\.blocks\[" tools/map-builder/src/tools/     # nada escreve no modelo direto
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F2-07. Destinatários: F2-08, F2-09.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F2-08` — Autoladrilhamento por máscara de 4 bits

```yaml
id: F2-08
fase: F2
onda: W11
grupo: G-map
deps: [F2-07]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - tools/map-builder/src/autotile.ts
  - tools/map-builder/src/autotile.test.ts
faixa_ledger: AB-410..AB-419
```

```xml
<task id="F2-08" nome="Autoladrilhamento consumindo tile_rules" onda="W11" worktree="G-map">

  <ultrathink>
    A tentação é escrever a tabela de 16 combinações à mão. Não escreva: consuma o tile_rules que a
    API devolveu (F2-04). Uma tabela própria diverge da arte no primeiro tileset diferente, e o
    sintoma é uma quina que não fecha — visualmente sutil e caro de rastrear.
  </ultrathink>

  <contexto>Wang por canto ou por aresta, conforme o rule_type que a API declarou. A arity é 4 para
    quadrado e isométrico.</contexto>

  <ler_consideracoes_dos_anteriores>F2-07, F2-04 (o mapeamento de bits DESCOBERTO — use aquele, não o
    presumido). Dependências diretas: F2-07.</ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-410..AB-419.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/generating-pixellab-tilesets/SKILL.md
    - .agents/skills/querying-pixellab-api/SKILL.md
  </skills_obrigatorias>

  <entradas>packages/iso-core/src/tile-rules.ts; a fixture de E4.</entradas>

  <o_que_fazer>
    1. Máscara de 4 bits a partir dos vizinhos, na convenção que F2-04 descobriu.
    2. Selecione a peça pela regra da API. Combinação sem peça correspondente é ERRO visível na tela,
       não uma peça default silenciosa.
    3. Teste todas as 16 combinações contra a fixture.
    4. Falha por AUSÊNCIA: se o tileset não trouxer as 16, o editor DIZ quais faltam.
  </o_que_fazer>

  <restricoes>
    - PROIBIDA tabela de combinações escrita à mão.
    - PROIBIDA peça default silenciosa.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-map — bash scripts/new-task-worktree.sh F2-08</worktree>
    <revisao_adversarial>
      Contexto fresco: as 16 combinações estão cobertas? O que acontece com um tileset incompleto?
      O teste usa a fixture real ou uma inventada? A máscara bate com a convenção de lados de F2-02?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/map-builder && npm run typecheck && npm test
    npm test 2>&1 | grep -qE "16 combina"
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F2-08. Destinatário: G-2.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `F2-09` — Exportar `project.json` mais os atlas

```yaml
id: F2-09
fase: F2
onda: W11
grupo: G-map
deps: [F2-07]
critico: true
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - tools/map-builder/src/export.ts
  - tools/map-builder/src/export.test.ts
faixa_ledger: AB-420..AB-429
```

```xml
<task id="F2-09" nome="Exportação do projeto" onda="W11" worktree="G-map">

  <ultrathink>
    O artefato exportado é o CONTRATO com o runtime. Tudo que o runtime precisa tem de estar nele ou
    ao lado dele; nada pode estar "só no editor". A prova disso não é uma revisão de código, é o
    critério de F4-03 — e este card é onde ele passa a ser possível ou impossível.
    Caminhos RELATIVOS ao arquivo de projeto. Caminho absoluto quebra no primeiro `cp` para outra
    máquina, e o sintoma é o runtime abrindo uma tela vazia.
  </ultrathink>

  <contexto>O artefato do editor é um projeto JSON mais os atlas (ADR 0018).</contexto>

  <ler_consideracoes_dos_anteriores>F2-07, F0-12 (a ADR e sua guarda executável), F0-11 (o schema e a
    escrita atômica). Dependências diretas: F2-07.</ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-420..AB-429.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/writing-repo-typescript/SKILL.md
    - .agents/skills/animating-pixi-sprites/SKILL.md
  </skills_obrigatorias>

  <entradas>packages/iso-core/src/project.ts, saveProject; o atlas e o sidecar do pipeline.</entradas>

  <o_que_fazer>
    1. Exportar: project.json (escrita atômica, via iso-core) mais a lista de atlas referenciados por
       caminho RELATIVO.
    2. Verificar, antes de declarar sucesso, que cada atlas referenciado EXISTE em disco.
    3. Teste de ida e volta: exportar, ler com loadProject, comparar profundamente.
    4. Falha por AUSÊNCIA: exportar com um atlas faltando FALHA com o nome do arquivo, não exporta
       um projeto quebrado.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO caminho absoluto no arquivo exportado.
    - PROIBIDO escrever o project.json com fs.writeFile direto — use saveProject, que é atômico.
    - PROIBIDO exportar referência a arquivo que não existe.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-map — bash scripts/new-task-worktree.sh F2-09</worktree>
    <revisao_adversarial>
      Contexto fresco: copiando a pasta exportada para outro caminho, o projeto ainda abre? Existe
      caminho absoluto no JSON? Um crash no meio da escrita deixa arquivo pela metade? O teste de ida
      e volta compara o DISCO ou o objeto em memória?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/map-builder && npm run typecheck && npm test
    # falha por AUSÊNCIA — nenhum caminho absoluto no artefato:
    node -e "const p=require('./tools/map-builder/test-out/demo.json');if(JSON.stringify(p).includes('/home/'))throw new Error('caminho absoluto no projeto exportado')"
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F2-09. Publique o caminho do projeto de demonstração exportado.
    Destinatários nomeados: F4-01, F4-03.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

---

### `G-2` — GATE: o mapa exporta e o artefato é autossuficiente

```yaml
id: G-2
fase: gate
onda: W12
grupo: G-infra
deps: [F2-08, F2-09]
critico: true
gasta: nao
worktree: nao
estado: pendente
arquivos: []
faixa_ledger: AB-430..AB-439
```

| # | Pré-requisito | Onde se confere |
| --- | --- | --- |
| P1 | `tile_rules` parseado contra resposta **real**, não inferida | `F2-04`, e a fixture versionada |
| P2 | As 16 combinações de autoladrilhamento cobertas | `F2-08` |
| P3 | Projeto exportado abre depois de copiado para outro caminho | `F2-09` |
| P4 | Nenhum caminho absoluto no artefato | comando abaixo |
| P5 | Primeira medição de desempenho registrada | `F2-05`, Considerações |

```bash
cd /home/ondokai/Projects/isometric-maker
bash scripts/gate.sh
cd packages/iso-core && npm test && npm run typecheck
cd ../../tools/map-builder && npm run typecheck && npm test
node .agents/skills/scripts/check-pixi-claims.mjs
# o artefato é mesmo autossuficiente? copie e abra de outro lugar:
cp -r tools/map-builder/test-out /tmp/prova-de-copia && node -e "require('/tmp/prova-de-copia/demo.json')"
```

Registre nas Considerações o tamanho do `project.json` de demonstração e quantos atlas ele referencia.

---

## Fase 3 — Mecânicas

Movimento contínuo em `(x,y)`, **inteiro em z**. Z só muda por degrau ou por pulo.

- **Degrau:** entrar numa célula cujo piso é exatamente `z+1` sobe automático. `z+2` bloqueia.
- **Pulo:** troca `z` de inteiro para inteiro; **a parábola existe só em espaço de tela**. É o que
  preserva "Z é discreto" sem que o pulo pareça teletransporte.
- **Colisão:** bloco bloqueia *entrada na célula*; aresta bloqueia *travessia entre duas células*.
  São testes diferentes, e confundi-los é o bug clássico de atravessar parede na diagonal.

### `F3-01` — Movimento contínuo em (x,y), inteiro em z

```yaml
id: F3-01
fase: F3
onda: W7
grupo: G-core
deps: [F2-02]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - packages/iso-core/src/movement.ts
  - packages/iso-core/src/movement.test.ts
faixa_ledger: AB-440..AB-449
```

```xml
<task id="F3-01" nome="Movimento contínuo em xy, discreto em z" onda="W7" worktree="G-core">
  <ultrathink>
    Separe RELÓGIO DE LÓGICA de RELÓGIO DE RENDER desde a primeira linha. Movimento em passo fixo,
    interpolação só na hora de desenhar. Misturar os dois faz o comportamento depender do frame rate
    da máquina — e o teste headless de F3-05 fica impossível de escrever.
  </ultrathink>
  <contexto>Z é discreto e vale 16 px por nível. Movimento em x,y é contínuo.</contexto>
  <ler_consideracoes_dos_anteriores>F2-02 (formato do mapa), F2-01 (geometria). Dependências diretas: F2-02.</ler_consideracoes_dos_anteriores>
  <questoes_abertas>Faixa AB-440..AB-449.</questoes_abertas>
  <skills_obrigatorias>
    - .agents/skills/interpolating-pixi-state/SKILL.md
    - .agents/skills/testing-repo-code/SKILL.md
  </skills_obrigatorias>
  <entradas>packages/iso-core/src/map.ts e geometry.ts.</entradas>
  <o_que_fazer>
    1. `step(estado, entrada, dt)` puro: sem DOM, sem rede, sem PixiJS.
    2. Passo fixo de lógica, com acumulador. dt do render nunca entra na física.
    3. z só muda por degrau ou pulo — nunca continuamente.
    4. Testes determinísticos: a mesma sequência de entradas produz o mesmo (x,y,z), sempre.
  </o_que_fazer>
  <restricoes>
    - PROIBIDO importar pixi.js ou tocar no DOM.
    - PROIBIDO usar Date.now() na lógica: recebe dt como parâmetro.
    - PROIBIDO z fracionário no ESTADO. Na tela, é outra coisa.
  </restricoes>
  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-core — bash scripts/new-task-worktree.sh F3-01</worktree>
    <revisao_adversarial>
      Contexto fresco: o resultado muda se eu chamar step com dt de 16 ms ou de 33 ms? (não pode)
      Existe z fracionário em algum ponto do estado? A função é realmente pura — procure por
      Date.now, Math.random e acesso a globais.
    </revisao_adversarial>
  </swarm>
  <criterios_aceitacao>
    cd packages/iso-core && npm test && npm run typecheck
    ! grep -rnE "Date\.now|Math\.random|document\.|window\." packages/iso-core/src/movement.ts
    npm test 2>&1 | grep -q "determin"
  </criterios_aceitacao>
  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F3-01. Publique a taxa de passo fixo adotada. Destinatários: F3-03, F3-04, F3-05, F4-02.
  </ao_concluir_marque_feito_e_publique>
  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

### `F3-02` — Colisão: célula × travessia

```yaml
id: F3-02
fase: F3
onda: W7
grupo: G-core
deps: [F2-02]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - packages/iso-core/src/collision.ts
  - packages/iso-core/src/collision.test.ts
faixa_ledger: AB-450..AB-459
```

```xml
<task id="F3-02" nome="Colisão de célula e de aresta" onda="W7" worktree="G-core">
  <ultrathink>
    São DOIS testes diferentes e é por isso que este card existe separado. Bloco bloqueia ENTRAR numa
    célula. Aresta bloqueia ATRAVESSAR entre duas células. Um movimento diagonal atravessa DUAS
    arestas, e testar só uma delas é exatamente como se atravessa parede na diagonal — o bug clássico
    do gênero.
  </ultrathink>
  <contexto>Colisão é DERIVADA do mapa, sem camada separada. Duas verdades sobre o mesmo terreno é o
    que este projeto decidiu não ter.</contexto>
  <ler_consideracoes_dos_anteriores>F2-02 (blocks, edges e a convenção de lados). Dependências diretas: F2-02.</ler_consideracoes_dos_anteriores>
  <questoes_abertas>Faixa AB-450..AB-459.</questoes_abertas>
  <skills_obrigatorias>
    - .agents/skills/testing-repo-code/SKILL.md
  </skills_obrigatorias>
  <entradas>packages/iso-core/src/map.ts.</entradas>
  <o_que_fazer>
    1. `canEnter(map, x,y,z)` e `canCross(map, de, para)`, separadas.
    2. Movimento diagonal testa AS DUAS arestas envolvidas.
    3. Teste que falha por AUSÊNCIA: uma parede em cada uma das duas arestas de uma quina impede a
       diagonal. Se passar, a diagonal está furando parede.
    4. Nenhuma camada de colisão persistida.
  </o_que_fazer>
  <restricoes>
    - PROIBIDA camada de colisão separada.
    - PROIBIDO unificar canEnter e canCross numa função só.
  </restricoes>
  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-core — bash scripts/new-task-worktree.sh F3-02</worktree>
    <revisao_adversarial>
      Contexto fresco: existe caminho diagonal que atravesse uma quina com duas paredes? Prove com
      um mapa de fixture. canCross é chamada com as duas arestas? O teste passaria se canCross
      devolvesse sempre true?
    </revisao_adversarial>
  </swarm>
  <criterios_aceitacao>
    cd packages/iso-core && npm test && npm run typecheck
    npm test 2>&1 | grep -q "diagonal"
  </criterios_aceitacao>
  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F3-02. Destinatários: F3-03, F3-05.
  </ao_concluir_marque_feito_e_publique>
  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

### `F3-03` — Degrau: `z+1` sobe, `z+2` bloqueia

```yaml
id: F3-03
fase: F3
onda: W8
grupo: G-core
deps: [F3-01, F3-02]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - packages/iso-core/src/step-up.ts
  - packages/iso-core/src/step-up.test.ts
faixa_ledger: AB-460..AB-469
```

```xml
<task id="F3-03" nome="Degrau automático" onda="W8" worktree="G-core">
  <ultrathink>
    O degrau é uma exceção à regra "z só muda por pulo", e exceção não declarada vira comportamento
    emergente. Escreva a condição EXATA: piso da célula de destino igual a z+1 E canEnter verdadeiro
    E canCross verdadeiro. Qualquer relaxamento vira escalada de parede.
  </ultrathink>
  <contexto>Um nível Z são 16 px. z+1 sobe automático; z+2 bloqueia.</contexto>
  <ler_consideracoes_dos_anteriores>F3-01 (a assinatura de step e o passo fixo), F3-02 (as duas
    funções de colisão). Dependências diretas: F3-01, F3-02.</ler_consideracoes_dos_anteriores>
  <questoes_abertas>Faixa AB-460..AB-469.</questoes_abertas>
  <skills_obrigatorias>- .agents/skills/testing-repo-code/SKILL.md</skills_obrigatorias>
  <entradas>packages/iso-core/src/movement.ts, collision.ts, map.ts.</entradas>
  <o_que_fazer>
    1. A condição exata do degrau, numa função só, citável.
    2. Testes: z+1 sobe; z+2 não; z+1 com parede na aresta NÃO sobe; descida de z-1 e de z-3.
    3. Falha por AUSÊNCIA: um degrau z+1 atrás de parede tem de ser bloqueado.
  </o_que_fazer>
  <restricoes>
    - PROIBIDO subir mais de um nível por passo.
    - PROIBIDO ignorar a aresta ao subir.
  </restricoes>
  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-core — bash scripts/new-task-worktree.sh F3-03</worktree>
    <revisao_adversarial>
      Contexto fresco: dá para escalar uma parede subindo degraus consecutivos num mesmo passo? A
      descida tem limite? O teste distingue "não subiu" de "não se moveu"?
    </revisao_adversarial>
  </swarm>
  <criterios_aceitacao>
    cd packages/iso-core && npm test && npm run typecheck
    npm test 2>&1 | grep -q "z+2"
  </criterios_aceitacao>
  <ao_concluir_marque_feito_e_publique>Marque feito SÓ no yaml de F3-03. Destinatário: F3-04, F3-05.</ao_concluir_marque_feito_e_publique>
  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

### `F3-04` — Pulo: inteiro para inteiro, com a parábola só na tela

```yaml
id: F3-04
fase: F3
onda: W9
grupo: G-core
deps: [F3-03]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - packages/iso-core/src/jump.ts
  - packages/iso-core/src/jump.test.ts
faixa_ledger: AB-470..AB-479
```

```xml
<task id="F3-04" nome="Pulo com parábola em espaço de tela" onda="W9" worktree="G-core">
  <ultrathink>
    A parábola é DECORAÇÃO, e essa é a decisão inteira. Se ela entrar no estado, z vira fracionário e
    todo o resto — colisão, ordenação, degrau — passa a lidar com meio nível. Modele o pulo como
    transição entre dois z INTEIROS mais um deslocamento visual que o renderizador aplica e o modelo
    ignora.
  </ultrathink>
  <contexto>Z é discreto por decisão (ADR 0013). O pulo não pode parecer teletransporte, e a solução
    é visual, não de modelo.</contexto>
  <ler_consideracoes_dos_anteriores>F3-03, F3-01. Dependências diretas: F3-03.</ler_consideracoes_dos_anteriores>
  <questoes_abertas>Faixa AB-470..AB-479.</questoes_abertas>
  <skills_obrigatorias>- .agents/skills/interpolating-pixi-state/SKILL.md</skills_obrigatorias>
  <entradas>packages/iso-core/src/movement.ts e step-up.ts.</entradas>
  <o_que_fazer>
    1. Estado do pulo: z de origem, z de destino, progresso 0..1. O `z` efetivo do modelo é inteiro em
       todo instante — escolha e DECLARE se ele muda no início ou no fim da transição.
    2. `visualOffsetY(progresso)` devolve a parábola, em pixels de tela. Função separada, sem efeito
       no modelo.
    3. Colisão durante o pulo: declare a regra e teste-a.
    4. Falha por AUSÊNCIA: nenhum ponto do estado tem z fracionário — teste que percorre a transição
       inteira e asserta Number.isInteger(z) em todos os passos.
  </o_que_fazer>
  <restricoes>
    - PROIBIDO z fracionário no estado.
    - PROIBIDO a parábola influenciar colisão ou ordenação.
  </restricoes>
  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-core — bash scripts/new-task-worktree.sh F3-04</worktree>
    <revisao_adversarial>
      Contexto fresco: existe algum instante em que z é fracionário? Pular contra um teto funciona
      como? O deslocamento visual entra em algum cálculo de colisão?
    </revisao_adversarial>
  </swarm>
  <criterios_aceitacao>
    cd packages/iso-core && npm test && npm run typecheck
    npm test 2>&1 | grep -q "isInteger"
  </criterios_aceitacao>
  <ao_concluir_marque_feito_e_publique>Marque feito SÓ no yaml de F3-04. Destinatários: F3-05, F4-02.</ao_concluir_marque_feito_e_publique>
  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

### `F3-05` — O teste headless: um traço de entrada, um `(x,y,z)` final

```yaml
id: F3-05
fase: F3
onda: W10
grupo: G-core
deps: [F3-04]
critico: false
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - packages/iso-core/src/trace.test.ts
  - packages/iso-core/test-fixtures/mapa-degraus.json
faixa_ledger: AB-480..AB-489
```

```xml
<task id="F3-05" nome="Teste headless de traço de entrada" onda="W10" worktree="G-core">
  <ultrathink>
    Este é o critério de saída da Fase 3 inteira, e ele só vale se for FALSIFICÁVEL: um traço cujo
    resultado esperado seja a posição inicial passa com uma implementação que não faz nada. Todo
    traço tem de terminar em posição DIFERENTE da inicial, e pelo menos um tem de ser bloqueado por
    parede num ponto verificável do caminho.
  </ultrathink>
  <contexto>Sem render, sem DOM, sem PixiJS. Só o modelo.</contexto>
  <ler_consideracoes_dos_anteriores>F3-04, F3-03, F3-02, F3-01 — todos. Dependências diretas: F3-04.</ler_consideracoes_dos_anteriores>
  <questoes_abertas>Faixa AB-480..AB-489.</questoes_abertas>
  <skills_obrigatorias>- .agents/skills/testing-repo-code/SKILL.md</skills_obrigatorias>
  <entradas>todo o iso-core de movimento, colisão, degrau e pulo.</entradas>
  <o_que_fazer>
    1. Um mapa de fixture com degraus de 1 e de 2, uma quina com duas paredes e um vão para pular.
    2. Pelo menos cinco traços roteirizados, cada um com (x,y,z) final escrito à mão.
    3. Um traço que termina BLOQUEADO, e a asserção é sobre onde ele parou.
    4. Determinismo: rodar duas vezes dá o mesmo resultado, byte a byte.
  </o_que_fazer>
  <restricoes>
    - PROIBIDO render.
    - PROIBIDO traço cujo resultado esperado seja a posição inicial.
    - PROIBIDO gerar a fixture com a mesma função que a asserta.
  </restricoes>
  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-core — bash scripts/new-task-worktree.sh F3-05</worktree>
    <revisao_adversarial>
      Contexto fresco: algum traço passaria com um `step` que não faz nada? A fixture foi escrita à
      mão ou gerada pelo próprio código? Rodar duas vezes dá o mesmo resultado?
    </revisao_adversarial>
  </swarm>
  <criterios_aceitacao>
    cd packages/iso-core && npm test && npm run typecheck
    npm test 2>&1 | grep -q "traço"
    # falha por AUSÊNCIA: nenhum traço termina onde começou
    ! grep -q "esperado: mesma posição" packages/iso-core/src/trace.test.ts
  </criterios_aceitacao>
  <ao_concluir_marque_feito_e_publique>Marque feito SÓ no yaml de F3-05. Destinatário: G-3, F4-02.</ao_concluir_marque_feito_e_publique>
  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

### `G-3` — GATE: as mecânicas rodam sem tela

```yaml
id: G-3
fase: gate
onda: W11
grupo: G-infra
deps: [F3-05]
critico: false
gasta: nao
worktree: nao
estado: pendente
arquivos: []
faixa_ledger: AB-490..AB-499
```

```bash
cd /home/ondokai/Projects/isometric-maker/packages/iso-core && npm test && npm run typecheck
# falha por AUSÊNCIA — o núcleo não conhece nem o editor nem o renderizador:
cd /home/ondokai/Projects/isometric-maker
grep -rq "export" packages/iso-core/src/movement.ts          # controle positivo
! grep -rn "pixi\|tools/" packages/iso-core/src/
```

Pré-requisitos: `P1` cinco traços, nenhum terminando na posição inicial · `P2` a quina de duas
paredes bloqueia a diagonal · `P3` z inteiro em todos os instantes, inclusive durante o pulo.

---

## Fase 4 — Runtime

Carrega **só** `project.json` mais os atlas. Roda as mecânicas da Fase 3, renderiza pela Fase 2, sem
interface de edição.

**É a fase mais curta e a mais dura.** Ela não acrescenta funcionalidade: ela prova que tudo que veio
antes está do lado certo da fronteira.

### `F4-01` — Scaffold do runtime: carrega o artefato, e nada mais

```yaml
id: F4-01
fase: F4
onda: W13
grupo: G-runtime
deps: [G-1, G-2, G-3]
critico: true
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - tools/runtime/package.json
  - tools/runtime/tsconfig.json
  - tools/runtime/index.html
  - tools/runtime/vite.config.ts
  - tools/runtime/src/load.ts
faixa_ledger: AB-500..AB-509
```

```xml
<task id="F4-01" nome="Scaffold do runtime e carregamento do artefato" onda="W13" worktree="G-runtime">

  <ultrathink>
    Cada import que você escrever aqui é uma decisão sobre a fronteira. A regra é simples e não tem
    exceção: o runtime importa de packages/iso-core e de pixi.js. De mais nada dentro deste
    repositório. Se algo que você precisa está no editor, ele está no lugar errado — e isso é uma
    REFUTAÇÃO endereçada ao card que o pôs lá, não uma licença para importar.
  </ultrathink>

  <contexto>
    O artefato de exportação é project.json mais os atlas (ADR 0018). O runtime é o consumidor desse
    contrato, e é a única prova de que ele existe de verdade.
  </contexto>

  <ler_consideracoes_dos_anteriores>
    Suba o grafo inteiro. Em especial: F2-09 (o caminho do projeto de demonstração), F0-11 e F0-12
    (schema e ADR), F3-05 (o traço headless), F1-08 (a prévia — o mesmo problema de âncora e fps
    aparece aqui). Dependências diretas: G-1, G-2, G-3.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-500..AB-509.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/routing-pixijs-work/SKILL.md
    - .agents/skills/bootstrapping-pixi-app/SKILL.md
    - .agents/skills/writing-repo-typescript/SKILL.md
  </skills_obrigatorias>

  <entradas>
    - packages/iso-core/src/project.ts — loadProject.
    - o projeto de demonstração exportado por F2-09.
    - tools/map-builder/package.json — o modelo de scaffold, MAS sem copiar dependência que o runtime
      não precisa.
  </entradas>

  <o_que_fazer>
    1. Scaffold: package.json com pixi.js 8.19.0 exato e @isometric-maker/iso-core; tsconfig com as
       mesmas opções estritas; script `play` que recebe o caminho do projeto por argumento.
    2. src/load.ts: recebe um caminho, chama loadProject, resolve os atlas RELATIVOS ao arquivo, e
       falha com mensagem nomeada se algum faltar.
    3. Nenhuma interface de edição. Nenhum botão. Nenhuma chamada à API do PixelLab.
    4. Falha por AUSÊNCIA: rodar sem argumento imprime como usar e sai != 0. Rodar com um projeto
       cujo atlas foi apagado falha nomeando o arquivo.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO importar qualquer coisa de tools/character-builder, tools/map-builder ou
      tools/pixellab-pipeline. Sem exceção, e é verificado.
    - PROIBIDO chamar a API do PixelLab. O runtime nunca gera nada.
    - PROIBIDO duplicar geometria, colisão ou formato — tudo vem de iso-core.
    - PROIBIDO ler variável de ambiente de token.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-runtime — bash scripts/new-task-worktree.sh F4-01</worktree>
    <revisao_adversarial>
      Contexto fresco, só o diff e este card:
        - existe algum import que atravesse a fronteira? Liste TODOS os imports do runtime.
        - o runtime abre um projeto copiado para /tmp?
        - existe alguma leitura de PIXELLAB_SECRET?
        - rodar sem argumento faz o quê?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/runtime && npm run typecheck
    # controle positivo primeiro — prova que o detector enxerga o diretório:
    test -d tools/runtime/src && grep -rq "import" tools/runtime/src
    # e só então a asserção negativa:
    ! grep -rn "character-builder\|map-builder\|pixellab-pipeline" tools/runtime/src
    ! grep -rn "PIXELLAB_SECRET" tools/runtime/
    node tools/runtime/src/load.ts; test $? -ne 0     # sem argumento: erro, não sucesso silencioso
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F4-01. Publique a lista COMPLETA de imports do runtime — ela é o
    contrato que F4-03 vai verificar. Destinatários: F4-02, F4-03.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

### `F4-02` — Renderiza pela Fase 2, roda as mecânicas da Fase 3

```yaml
id: F4-02
fase: F4
onda: W14
grupo: G-runtime
deps: [F4-01]
critico: true
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - tools/runtime/src/main.ts
  - tools/runtime/src/render.ts
faixa_ledger: AB-510..AB-519
```

```xml
<task id="F4-02" nome="Runtime desenha e simula" onda="W14" worktree="G-runtime">

  <ultrathink>
    A tentação é reescrever o renderizador "mais simples, porque aqui não tem edição". Não reescreva:
    o que o editor mostra e o que o runtime mostra têm de ser a MESMA coisa, e duas implementações
    divergem no primeiro ajuste. Se o renderizador do map-builder não puder ser reusado sem arrastar
    a interface junto, isso é uma refutação e o destinatário é F2-05: a parte de desenho precisava
    estar no iso-core ou num pacote próprio.
  </ultrathink>

  <contexto>
    Ordenação por x+y+z (F2-03), geometria e âncora medidas, fps no sidecar e animationSpeed = fps/60.
  </contexto>

  <ler_consideracoes_dos_anteriores>
    F4-01 (a lista de imports permitidos), F2-05 (renderizador e a primeira medição de desempenho),
    F2-03 (ordenação e limitações), F3-05 (o traço). Dependências diretas: F4-01.
  </ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-510..AB-519.</questoes_abertas>

  <skills_obrigatorias>
    - .agents/skills/routing-pixijs-work/SKILL.md
    - .agents/skills/composing-pixi-scene/SKILL.md
    - .agents/skills/animating-pixi-sprites/SKILL.md
    - .agents/skills/interpolating-pixi-state/SKILL.md
    - .agents/skills/profiling-pixi-performance/SKILL.md
  </skills_obrigatorias>

  <entradas>packages/iso-core inteiro; os atlas e sidecars do projeto de demonstração.</entradas>

  <o_que_fazer>
    1. Desenhar o mapa com a ordem de F2-03, o personagem com a âncora medida e as animações no fps
       do sidecar.
    2. Relógio de lógica em passo fixo (F3-01); interpolação só no desenho.
    3. Entrada de teclado movendo o personagem, com degrau e pulo.
    4. Medir: quadros por segundo e draw calls, impressos no console. Compare com o número que F2-05
       publicou; divergência grande é achado, não ruído.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO reimplementar geometria, ordenação, colisão ou movimento.
    - PROIBIDO qualquer elemento de edição.
    - PROIBIDO escala fracionária do palco ou mipmap.
    - PROIBIDO importar do editor.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-runtime — bash scripts/new-task-worktree.sh F4-02</worktree>
    <revisao_adversarial>
      Contexto fresco:
        - o runtime desenharia uma tela plausível com um project.json cujo mapa está VAZIO? Se sim,
          como se distingue isso de "funcionou"?
        - alguma função de geometria foi reescrita aqui? Compare com iso-core.
        - o personagem fica na altura certa nos degraus, ou flutua meio nível? (é o sintoma da âncora
          errada, e o replanejamento previu exatamente isso)
        - fps e draw calls batem com o que F2-05 mediu?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    cd tools/runtime && npm run typecheck
    ! grep -rn "character-builder\|map-builder" tools/runtime/src
    ! grep -rnE "\(x-y\)\s*\*" tools/runtime/src        # nenhuma geometria duplicada
    grep -rq "iso-core" tools/runtime/src               # controle positivo
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F4-02. Publique fps e draw calls medidos, lado a lado com os de F2-05.
    Destinatário: F4-03, G-4.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>meta-skill-evolution, default descartar. Apague TASK_PLAN.md.</evolucao>
</task>
```

### `F4-03` — O critério mais duro do plano

```yaml
id: F4-03
fase: F4
onda: W15
grupo: G-runtime
deps: [F4-02]
critico: true
gasta: nao
worktree: sim
estado: pendente
arquivos:
  - scripts/check-runtime-boundary.sh
faixa_ledger: AB-520..AB-529
```

| | |
| --- | --- |
| **Objetivo** | Transformar "o artefato de exportação não é ficção" numa verificação que **é capaz de reprovar**. |
| **Entradas** | a lista de imports publicada por `F4-01`. |
| **Saídas** | `scripts/check-runtime-boundary.sh`, no gate. |
| **Considerações** | — |

**O critério publicado no replanejamento está errado, e este card existe para consertá-lo.**

```bash
grep -rn "character-builder/src" tools/runtime/src | wc -l    # "tem que dar 0"
```

Verificado em 2026-07-30: **isso sai 0 antes de `tools/runtime/src` existir**. `grep` escreve o erro
em stderr, não escreve nada em stdout, `wc -l` conta zero e o pipeline sai 0. O critério passava no
dia em que o replanejamento foi escrito, com o runtime inexistente.

```xml
<task id="F4-03" nome="Verificador da fronteira do runtime" onda="W15" worktree="G-runtime">

  <ultrathink>
    Escreva o verificador de modo que ele MORRA se o diretório sumir, se ficar vazio, ou se o padrão
    de busca deixar de casar qualquer coisa. Três estados, não dois: passou, reprovou, e
    "não consegui verificar" — e o terceiro é vermelho, nunca verde. A pergunta que guia cada linha:
    o que este comando imprime se a tarefa não fizer nada?
  </ultrathink>

  <contexto>
    Se o runtime importa de dentro do editor, o artefato de exportação é ficção: o "projeto exportado"
    só roda em quem tem o repositório inteiro. É a diferença entre um formato e um acoplamento.
  </contexto>

  <ler_consideracoes_dos_anteriores>F4-01 (a lista de imports), F4-02. Dependências diretas: F4-02.</ler_consideracoes_dos_anteriores>

  <questoes_abertas>Faixa AB-520..AB-529.</questoes_abertas>

  <skills_obrigatorias>- .agents/skills/testing-repo-code/SKILL.md</skills_obrigatorias>

  <entradas>tools/runtime/src; scripts/gate.sh; scripts/check-docs.sh como modelo de estilo.</entradas>

  <o_que_fazer>
    1. scripts/check-runtime-boundary.sh, nesta ordem:
       a. `test -d tools/runtime/src` — ausente é FALHA, não zero;
       b. controle positivo: o diretório contém pelo menos um `import` — se não contiver, o detector
          está cego e é FALHA;
       c. asserção negativa: nenhuma linha casa character-builder, map-builder ou pixellab-pipeline;
       d. o mesmo para `packages/iso-core`, que também não pode importar de tools/**;
       e. imprime a lista de imports permitidos que ENCONTROU, para o veredicto ser auditável.
    2. Autoteste atrás de --self-test: fabrique um arquivo temporário com um import proibido e exija
       que o verificador reprove. Asserte A MENSAGEM, não só o exit code.
    3. Ligue como etapa nomeada do gate.sh.
    4. Rode o cenário completo: `npm run play` com o projeto de demonstração, a partir de um diretório
       COPIADO para fora do repositório.
  </o_que_fazer>

  <restricoes>
    - PROIBIDO usar `| wc -l` comparado a zero como única asserção.
    - PROIBIDO deixar o verificador passar com o diretório ausente ou vazio.
    - PROIBIDO relaxar a fronteira para fazer o teste passar. Se ela estiver furada, o card falha e a
      refutação vai para quem furou.
  </restricoes>

  <swarm>
    <subagents>Agente único.</subagents>
    <worktree>G-runtime — bash scripts/new-task-worktree.sh F4-03</worktree>
    <revisao_adversarial>
      Contexto fresco:
        - o verificador passa se eu renomear tools/runtime para outra coisa? (tem de reprovar)
        - passa se eu esvaziar src/? (tem de reprovar)
        - detecta `import x from "../../character-builder/src/y"`? E a forma com require? E import
          dinâmico?
        - o autoteste distingue "acusou o import proibido" de "quebrou por outro motivo"?
    </revisao_adversarial>
  </swarm>

  <criterios_aceitacao>
    bash scripts/check-runtime-boundary.sh --self-test   # exit 0, e acusa o import fabricado
    bash scripts/check-runtime-boundary.sh               # exit 0
    bash scripts/gate.sh | grep -q "runtime-boundary"
    # o verificador é capaz de reprovar — prova por mutação:
    mkdir -p /tmp/rb && cp -r tools/runtime /tmp/rb-backup
    echo "import x from '../../character-builder/src/main.ts';" >> tools/runtime/src/main.ts
    bash scripts/check-runtime-boundary.sh; test $? -ne 0 && echo "ok: reprova"
    rm -rf tools/runtime && cp -r /tmp/rb-backup tools/runtime
  </criterios_aceitacao>

  <ao_concluir_marque_feito_e_publique>
    Marque feito SÓ no yaml de F4-03. Publique a saída do verificador com a lista de imports
    encontrados. Destinatário: G-4.
  </ao_concluir_marque_feito_e_publique>

  <evolucao>
    meta-skill-evolution. PROVÁVEL promover: "grep num diretório inexistente sai 0 e o critério passa
    por vacuidade" é não-óbvio, não inferível do código, estável, e muda como todo critério futuro
    deste repositório deve ser escrito.
  </evolucao>
</task>
```

### `G-4` — GATE FINAL

```yaml
id: G-4
fase: gate
onda: W16
grupo: G-infra
deps: [F4-03]
critico: true
gasta: nao
worktree: nao
estado: pendente
arquivos: []
faixa_ledger: AB-530..AB-539
```

```bash
cd /home/ondokai/Projects/isometric-maker
bash scripts/gate.sh                                  # VERDE, zero etapas PENDENTE
bash scripts/check-runtime-boundary.sh
node scripts/validate-plan.mjs                        # 46/46 cards feitos
node scripts/validate-plan.mjs --ledger               # nenhum item fechado sem evidência
# a prova de ponta a ponta, fora do repositório:
cp -r tools/map-builder/test-out /tmp/prova-final
cd tools/runtime && npm run play -- /tmp/prova-final/demo.json
```

| # | Pré-requisito | Onde |
| --- | --- | --- |
| P1 | Fronteira do runtime verificada **e o verificador provado capaz de reprovar** | `F4-03` |
| P2 | Projeto de demonstração roda a partir de um diretório fora do repositório | comando acima |
| P3 | Todo item do ledger fechado tem evidência citável, ou está `ABERTO`, ou está `INVIÁVEL` com ADR | `validate-plan.mjs --ledger` |
| P4 | Nenhuma etapa do gate em `NÃO-EXERCITADO` | `gate.sh` |
| P5 | Custo total real do projeto registrado e comparado com a estimativa | Considerações de `G-1` e deste card |

**O que este gate NÃO prova.** Ele prova que o editor exporta um artefato que o runtime abre e roda.
Ele **não** prova que a arte está boa, que o desempenho serve num mapa grande, nem que o formato
aguenta um projeto real — nenhuma dessas três foi exercitada contra nada além de fixtures. Escreva
isso nas Considerações em vez de deixar o verde sugerir mais do que ele mede.

---

## Apêndices

### Apêndice A — Ledger de incerteza, semeado

Estes itens nascem `ABERTO`, hoje, com a informação que existe. `docs/plano/ledger.json` é a fonte;
esta tabela é a versão legível.

| id | Pergunta | Por que a base de código não responde | O que se assumiu | O que fecha | Quem responde |
| --- | --- | --- | --- | --- | --- |
| `AB-001` | O que `isometric: true` faz de fato? | o spec descreve em quatro palavras | que muda a projeção | `I-02/E1` | a API |
| `AB-002` | Quais são TODOS os `template_animation_id`? | o `...` está literalmente dentro da string do spec — truncagem do fornecedor | que os 10 visíveis são tudo | `I-02/E2` | a API |
| `AB-003` | Id de template inválido dá 422 antes ou depois de cobrar? | não documentado | que cobra depois | `I-02/E2` | a API |
| `AB-004` | Quanto `mode:'v3'` cobra por direção? | três trechos do spec conflitam; a tabela da ADR 0006 não tem fonte | 1 geração por direção | `I-02/E3` | a API |
| `AB-005` | Qual o shape real de `tile_rules`? | `additionalProperties: true`; semântica só em prosa | `edge/4` com bits N,L,S,O — **sem fonte** | `I-02/E4` | a API |
| `AB-006` | Qual peça do kit `building` é a porta e qual é a escada? | nenhum campo documentado | ordem de retorno | `I-02/E4` | a API |
| `AB-007` | `CharacterDetail.skeletons` vem populado no caminho standard? | não documentado | que não vem | `I-02/E5` — **grátis** | a API |
| `AB-008` | Qual a inflação REAL de canvas? | "~40%" num endpoint, "~2x" em outro | 1,4 | `F0-10` | medição |
| `AB-009` | `create-tiles-pro` com `tile_type:'isometric'` e `tile_size:64` produz losango de 64 px? | `create-isometric-tile` limita a 16/32; `tiles-pro` aceita 16–256, e ninguém testou | que produz | `I-02/E4` | a API |
| `AB-010` | Quanto custa `create-tiles-pro`? | **não está na `COST_TABLE` nem em `ENDPOINT_IDS`** | desconhecido | `I-02/E4` | a API |

**Regra de fechamento.** Evidência tem forma verificável: `arquivo:linha`, saída de comando salva,
relatório de diff, ADR, ou resposta da API com data. A lista negra `"ok"`, `"confirmado"`,
`"conforme combinado"` é rejeitada por script — sem ela a regra é decorativa. Estado terminal honesto
quando não dá para verificar: **`INVIÁVEL`, com ADR**.

### Apêndice B — Catálogo de falso verde deste repositório

Cada linha foi verificada em 2026-07-30, contra este código.

| O que parece verde | Por quê |
| --- | --- |
| `grep -rn "x" dir/ \| wc -l # 0` com `dir/` inexistente | erro vai para stderr, stdout fica vazio, `wc` conta 0, pipeline sai 0. **É o critério publicado da Fase 4** |
| `grep -rn "kind: 'refuse'"` | não casa `kind: "refuse"` nem `kind:'refuse'`. Aspas e espaço decidem o veredicto |
| `node src/cli.ts verify` com lockfile vazio | imprime "0 artefato(s) conferido(s), 0 problema(s)" e sai 0. Verde por vacuidade |
| `node src/cli.ts atlas` com lockfile vazio | imprime "Lockfile vazio — nada para empacotar" e **retorna 0** |
| `npm test` com `src/*.test.ts` sem casar arquivo | o glob não expande; conte os testes, não o exit code |
| `node src/cli.ts plan` com catálogo vazio | "0 jobs a submeter · US$ 0,00". Idêntico a "tudo em cache". **Precisa de denominador** |
| `lint-skills.mjs` verde com citação de hash desatualizado | hash mudado é **aviso**; só arquivo ausente é erro. A skill pode atestar texto que não existe mais |
| `check-docs.sh` verde | ele confere **4** das 12 convenções, e só em `docs/`, `README.md` e `tools/*/README.md`. Foi assim que o nome antigo sobreviveu em `tools/character-builder/index.html` |
| Diálogo de custo dizendo "US$ 0,00" | verdade quando o cache funcionou **e** quando não há nada a gerar |
| Um atlas que carrega mas desenha nada | "o smoke passaria com uma página em branco?" — exija um caso positivo |
| `git diff --exit-code` num diretório de saída | **não enxerga arquivo não rastreado** |

**A pergunta que gera esta lista:** *se isto desaparecer, o que fica vermelho?*

### Apêndice C — Prompt de revisão adversarial

```text
Antes de concluir, lance um subagente de CONTEXTO FRESCO que recebe APENAS
o diff e este card, e tenta REFUTAR:

  <pergunta falsificável 1, específica do domínio>
  <pergunta falsificável 2>
  <pergunta falsificável 3>

Corrija o que ele derrubar antes de encerrar.
```

**O que faz uma pergunta boa:** ela nomeia um resultado observável que, se acontecer, **derruba o
trabalho**. *"Está bom?"* não é pergunta. *"O smoke passaria com uma tela em branco?"* é.

Calibragem, por domínio deste projeto:

| Domínio | Pergunta |
| --- | --- |
| pipeline de custo | *existe caminho do argv até `client.submit` que não passe pelo guard?* |
| idempotência | *o teste passaria se `generate` não fizesse nada? onde está o contador?* |
| leitura de payload | *monte o payload na ordem inversa: o resultado muda? leste e oeste trocam?* |
| geometria | *a propriedade da diagonal vale para z negativo? existe literal 64 ou 32 no corpo?* |
| renderizador | *o smoke passaria com o mapa vazio? `scaleMode` foi setado antes do primeiro `Assets.load`?* |
| colisão | *existe diagonal que atravesse uma quina de duas paredes?* |
| pulo | *existe algum instante em que `z` é fracionário?* |
| verificador | *ele reprova quando eu quebro a coisa de propósito? asserta a mensagem ou só o exit code?* |
| fronteira | *ele passa com o diretório ausente? com o diretório vazio?* |
| skills | *o lint está verde por conferir ou por não achar o que conferir?* |
| documentação | *a ADR promete algum campo que não existe no código?* |

**Os limites, para não vender mais do que é.** Quem escolhe as perguntas é quem implementa, e quem
decide o que "foi derrubado" também. Este plano fecha metade dessa brecha escrevendo as perguntas
**dentro do card**, antes da execução. A outra metade continua aberta.

### Apêndice D — Item de ledger

```json
{
  "id": "AB-004",
  "titulo": "Custo real de mode:'v3' por direção",
  "pergunta": "Quantas gerações animate-character cobra por direção em mode:'v3'?",
  "por_que_aberto": "Três trechos do spec conflitam; a tabela da ADR 0006 não tem fonte no spec.",
  "decisao_provisoria": "Assumir 1 geração/direção e mostrar o teto do pior caso na tela.",
  "origem": ["tools/pixellab-pipeline/openapi/openapi-v2.json — descrição de /animate-character",
             "docs/adr/0006-animacao-em-template-mode.md"],
  "verificacao": "Uma chamada 64x64 com directions:['south'], lendo usage.generations.",
  "impacto_se_divergir": "A 20 gerações/direção, um personagem custa ~US$ 7,00 em vez de ~US$ 0,35. Recalcular o orçamento e revisar F1-07.",
  "risco": "alto",
  "grupo": "custo",
  "status": "ABERTO",
  "evidencia": "",
  "data_resolucao": ""
}
```

Âncora no código, no ponto exato da suposição:

```ts
// ABERTO AB-004: assume 1 geração por direção; ver docs/plano/ledger.json
```

### Apêndice E — Padrão de gate

```markdown
### GATE <ID> — <a asserção em uma frase, no afirmativo>

<Por que existe: o dano CONCRETO se for pulado. Não "boas práticas".>

Antes de <ação>:
1. <comando executável, literal, copiável>
2. <como confrontar o resultado com o artefato do repositório>
3. Registrar o resultado em <caminho nominal>, com o veredito e o que muda se divergir.

- [ ] <artefato de saída> existe e cobre todos os objetos
- [ ] Toda divergência corrigida e os testes reexecutados
```

Quatro elementos obrigatórios: condição de entrada · evidência exigida (saída de comando salva, nunca
afirmação) · artefato nominal onde a evidência mora · quem assina.

**Um veredito que não pode existir:** `CONFERE` sem evidência anexada. Use `NÃO_COLETADO`, que
**nunca** vira `CONFERE` sozinho.

### Apêndice F — O ciclo de uma onda

```text
commit PREP (stubs + mapa arquivo→dono + faixas de id)   <- ANTES das worktrees
  -> criar N worktrees            bash scripts/new-task-worktree.sh <card>
  -> lançar N agentes             um card por agente, prompt = o bloco xml
  -> BARREIRA                     todos terminaram
  -> cada agente commita dentro da sua worktree
  -> remover worktrees            a partir do repo principal
  -> MERGES um a um, NUNCA octopus, na ordem declarada
  -> GATE depois de CADA merge    bash scripts/gate.sh
```

**Três detalhes que não são óbvios:**

- **O agente nunca remove a própria worktree** — o git recusa, e apagar o diretório por baixo dele
  deixa lock e metadados corrompidos.
- **Merge um a um, nunca octopus:** um octopus aborta inteiro no primeiro conflito e você perde a
  atribuição de quem quebrou o quê.
- **Gate depois de cada merge, não ao fim da onda.** Com um merge dentro, um gate vermelho nomeia o
  card; com quatro, não nomeia nada. A bissecção é o produto.

**Ordem de merge, quando importa:** infra e ferramental primeiro; quem muda o gate, por último. Neste
plano isso está declarado em `W2` (`F0-03` antes dos demais) e em `W10` (`F2-07` por último).

### Apêndice G — Quando a premissa de um card cai

Vai acontecer. É o mecanismo funcionando, não falhando. Classifique **antes** de agir:

| A premissa é… | Exemplo possível aqui | O que fazer |
| --- | --- | --- |
| um **fato sobre a API** | `isometric` não muda a projeção | cumpra o card **pelo que ele quis**, entregue menos e **nomeie a diferença** |
| uma **entrada** | a fixture de `E4` não tem o caso da escada | **estenda a entrada**, anunciando quem mais depende dela |
| uma **restrição de ancestral** | `iso-core` proíbe o que o card pede | **o contrato vence, o card cede**; a dívida vira card futuro nomeado |
| um **pressuposto de sequência** | `F2-04` sem a resposta de `E4` | **só este exige reescrever o card**, fora da onda |

**O que para: nada**, exceto o último caso. O card continua até seus critérios de aceitação — que são
sobre o **resultado**, não sobre a premissa.

**Quem pode reescrever um card:** não o agente executor. O mandato dele é marcar concluído e escrever
o handoff, nenhum outro. Quem orquestra reescreve, por outra via: branch `PREP-<slug>` fora da onda,
commit próprio, autoria humana.

> **Um card é uma hipótese datada, não um contrato.** O que ele afirma sobre o mundo pode ser falso;
> o que ele afirma sobre o resultado esperado é o que vincula. E **a refutação tem endereço**:
> escreva-a para o descendente que vai tropeçar nela, nomeado.

### Apêndice H — O que este plano não cobre

Escopo negativo, porque ele é parte do entregável:

- **Guarda-roupa e equipamento.** `create-character-state` existe no código do estúdio e não tem card
  aqui. `docs/02-personagem/guarda-roupa-e-silhueta.md` sustenta que silhueta é restrição de autoria;
  transformar isso em fluxo é trabalho de uma fase posterior.
- **Retratos, lip-sync, UI gerada, fontes pixeladas.** Quatro famílias de endpoints com skill própria
  e zero cards. Fora de escopo por decisão, não por esquecimento.
- **Multipack de atlas.** `packGrid` lança erro explícito quando a família não cabe em 2048 px. Vai
  doer no primeiro personagem com muitas animações.
- **CI.** Não existe e não é criado por nenhum card. O gate local é o pipeline, e isso está declarado.
- **Desempenho em mapa grande.** Nada aqui foi medido contra um mapa real. As duas medições previstas
  (`F2-05` e `F4-02`) são contra fixtures.
- **Qualquer coisa com servidor, rede ou mais de um usuário.** Fora de escopo por ADR 0010, e
  reintroduzir exige ADR nova.

## Referências

- [`/home/ondokai/Projects/isometric-maker/analise-projeto-2026-07-30.html`](analise-projeto-2026-07-30.html) — o replanejamento: o que morre, o que sobrevive, os sete riscos
- [`/home/ondokai/Projects/isometric-maker/AGENTS.md`](AGENTS.md) — as regras duras e as 12 convenções de documentação
- [`/home/ondokai/Projects/isometric-maker/docs/README.md`](docs/README.md) — o índice da documentação e a tabela de ADRs
- [`/home/ondokai/Projects/isometric-maker/docs/00-produto/visao.md`](docs/00-produto/visao.md) — o que o editor é e o que ele não é
- [`/home/ondokai/Projects/isometric-maker/.agents/skills/catalog.md`](.agents/skills/catalog.md) — as 29 skills e seus sinais de verificação
- [`/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/openapi/openapi-v2.json`](tools/pixellab-pipeline/openapi/openapi-v2.json) — o spec vendorizado, capturado em 2026-07-29, sha256 em `PROVENIENCIA.txt`

**Última atualização:** 2026-07-30
