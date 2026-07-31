# Handoff: F0-01 — Vocabulário, validador do plano, gate local e ledger

**Card:** F0-01 · **Onda:** W0 · **Data:** 2026-07-30

## Arquivos produzidos

| Arquivo | Propósito |
| --- | --- |
| `scripts/validate-plan.mjs` | Validador do grafo de dependências do plano. Node 24, zero dependências. |
| `scripts/validate-ledger.mjs` | Validador do schema do ledger de incerteza. |
| `scripts/gate.sh` | Pipeline local. Uma etapa por verificador, três estados (PASS/FAIL/NÃO-EXERCITADO). |
| `scripts/new-task-worktree.sh` | Cria worktree isolada com preflight (node, spec sha256, catalog.ts). Recusa I-*e G-*. |
| `docs/plano/ledger.json` | Array vazio. O validador roda verde nele desde o dia 1. |
| `docs/plano/README.md` | Documentação do ledger: como abrir, como fechar, lista negra de evidências. |

## API pública

### `node scripts/validate-plan.mjs [caminho]`

Parseia blocos ` ```yaml ` de PLANO-DE-EXECUCAO.md e executa 11 checagens:
(a) dependências resolvem, (b) grafo acíclico com DFS, (c) invariante onda(card) > onda(dep),
(d) aviso de folga onda > nível, (e) sem órfãos, (f) sem colisão de arquivos na mesma onda,
(g) tabela de ondas bate com cards, (h) caminho crítico recalculado == publicado,
(i) ancestrais de cards `feito` estão feitos, (j) `gasta: sim` só I-01/I-02,
(k) zero cards parseados é FALHA.

### `node scripts/validate-plan.mjs --self-test`

Autoteste com 4 mutações calculadas a partir do documento corrente (nunca literais).

### `bash scripts/gate.sh`

Pipeline local. Estados: PASS, FAIL, NÃO-EXERCITADO, PENDENTE. Resumo final com veredito.

### `bash scripts/new-task-worktree.sh <card-id>`

Cria worktree em `/home/ondokai/Projects/isometric-maker.worktrees/<card-id>`. Recusa I-*e G-*.
Preflight: node >= 24, sha256 do spec, catalog.ts carrega.

### `node scripts/validate-ledger.mjs`

Validador do ledger.json. Item ABERTO: por_que_aberto/decisao_provisoria/verificacao não vazios,
evidencia vazia. Item FECHADO: evidencia verificável + data_resolucao ISO. Lista negra de evidências.

## Decisões de design

1. **Parser YAML mínimo, sem dependência.** O Node 24 não tem parser YAML nativo. Escrevi um parser
   que cobre exatamente o subconjunto usado nos blocos de card: scalars, arrays inline `[]`,
   block arrays `- item`, booleanos `true`/`false`. Nada de aninhamento, aspas, ou YAML avançado.

2. **Regex de ID de card: `[A-Z]+\d*-\d+`.** A primeira versão usava `[A-Z]\d+(?:-\d+)?` que falhava
   para `I-01` (sem dígito entre a letra e o traço). Corrigido para capturar `F0-01`, `I-01`, `G-0`, etc.

3. **Bloco YAML só é parseado se a primeira chave começa na coluna 1.** Isso implementa a regra da
   seção 1.2 do plano: o exemplo indentado (marcado ` ```text `) é ignorado.

4. **Caminho crítico: longest-path DFS.** De cada folha (card sem dependentes), todos os caminhos até
   raízes. O mais longo é o crítico.

5. **Validador do ledger extraído para script próprio.** Originalmente estava inline no gate.sh,
   mas a string JavaScript com dois-pontos quebrava o parsing do bash. Movido para
   `scripts/validate-ledger.mjs`.

6. **Onda fracionária (W2.5) comparada como float.** `waveNumber('W2.5')` → `2.5`.

7. **Autoteste usa `structuredClone`.** As mutações são calculadas a partir do documento corrente,
   nunca literais. Se o plano mudar, os testes se adaptam.

## Limitações conhecidas

- O parser YAML não suporta valores com `:` (dois-pontos) nem aspas (simples ou duplas). Nenhum card
  atual usa esses formatos.
- A allowlist de órfãos não está populada — nenhum card atual é órfão, mas cards terminais futuros
  precisarão ser adicionados.
- O gate.sh usa `eval` para executar comandos das etapas, o que é frágil com caracteres especiais.
  Funciona para os comandos atuais (todos simples).
- O preflight do new-task-worktree.sh assume que `node`, `sha256sum` e `git` estão no PATH.

## O que as tasks descendentes precisam saber

- **F0-02 (rename)**: leia as Considerações de F0-01 para o formato exato do bloco yaml.
- **T-01 (check-acceptance)**: sua etapa está declarada como PENDENTE no gate.sh. Use o `stage` ou
  `nao_exercitado_stage` conforme necessário.
- **Qualquer card que escreva em PLANO-DE-EXECUCAO.md**: o validador lê APENAS blocos ` ```yaml `
  com primeira chave na coluna 1. O campo `faixa_ledger` é obrigatório (todos os cards atuais o têm).
- **Formato do bloco yaml esperado**: keys `id`, `fase`, `onda`, `grupo`, `deps`, `critico`, `gasta`,
  `worktree`, `estado`, `arquivos`, `faixa_ledger`. `deps` pode ser `[]` ou `[ID1, ID2]`.
  `arquivos` usa block array. `estado` é `pendente`/`em-andamento`/`feito`.
  `gasta` é `nao`/`sim`/`possivel`.
