# Handoff: T-01 — Verificador de aceitação com sonda negativa

**Card:** T-01 · **Onda:** W1 · **Data:** 2026-07-30

## Arquivos produzidos

| Arquivo | Propósito |
| --- | --- |
| `scripts/check-acceptance.mjs` | Verificador estático de critérios de aceitação. Node 24, zero dependências. |
| `scripts/gate.sh` (editado) | Etapa PENDENTE trocada por stage real. |

## API pública

### `node scripts/check-acceptance.mjs [caminho]`

Para cada card com `estado: feito` em PLANO-DE-EXECUCAO.md, extrai os comandos do bloco
`criterios_aceitacao` (do XML `<task>` ou de blocos ```bash em cards de infra/gate) e classifica:

1. **Decorativo**: comando com `grep | wc -l` ou `grep -c` comparado a zero, sem `test -d`/`test -f`
   ou controle positivo adjacente (±1 linha) para o mesmo alvo → AVISO.
2. **npm test sem .test.ts**: card não-infra com `npm test` sem arquivo `*.test.ts` nos `arquivos:` → AVISO.
3. **Falha por ausência**: todo card precisa de ao menos um critério que reprove se a tarefa não fez nada
   (`! grep`, `test -f`, `test -d`, `test $? -ne 0`, `|| { echo FALHA`, `grep -rq`, etc.).

Defesas:
- **Sonda negativa** (`--self-test`): card sintético com critério comprovadamente decorativo é detectado.
- **Tripwire independente**: conta `^id: ` no texto cru vs. parsed; divergência é FALHA.
- **Zero cards parseados** é FALHA.

### `bash scripts/gate.sh | grep -q "check-acceptance"`

A etapa `scripts/check-acceptance.mjs` roda como stage nomeado (não mais PENDENTE).

## Decisões de design

1. **Verificador estático, nunca executa comandos dos critérios.** Alguns critérios gastam dinheiro
   (`generate`), e executá-los seria um desastre. O script apenas lê e classifica.

2. **Parser YAML compatível com validate-plan.mjs.** Mesmo algoritmo de extração de blocos ```yaml:
   primeira chave na coluna 1, mesmo subconjunto YAML (scalars, arrays inline, block arrays).

3. **Extração de critérios em duas fontes.** Cards com `<task>` XML extraem de `<criterios_aceitacao>`;
   cards de infra/gate (sem XML) extraem de blocos ```bash após "Critérios de aceitação".

4. **Vizinhança de controle positivo: ±1 linha, mesmo alvo.** Um `test -d tools/runtime/src` adjacente
   a `grep ... tools/runtime/src | wc -l` anula o aviso decorativo. Mas um `test -d` para alvo
   diferente, ou distante mais de 1 linha, não anula.

5. **Controle positivo por similaridade de alvos.** Extrai caminhos de arquivo/diretório de ambos os
   comandos e compara; se compartilham alvo, o controle positivo é reconhecido.

6. **"Falha por ausência": 8 padrões reconhecidos.** `! ` (negação), `test -f`/`test -d`/`test -e`,
   `test $? -ne 0`, `|| { echo "FALHA"`, `grep -rq`/`grep -q` (sem `wc -l`), loops `for` com
   `test -f`, `grep -c` com `!= 0`, e `node -e` com `throw new Error`.

## Limitações conhecidas

- A extração de critérios para cards de infra/gate (sem XML) depende de heurísticas de markdown e
  pode não capturar todos os formatos. Cards como I-01 têm `#### Critérios de aceitação` com blocos
  ```bash; outros formatos não são cobertos.
- O detector de "falha por ausência" é baseado em padrões de shell e pode ter falsos negativos para
  construções não antecipadas.
- A detecção de alvos (`extractTargets`) usa uma regex simples de caminhos e pode não capturar todos
  os casos (ex: caminhos com wildcards, variáveis de ambiente).
- O verificador NÃO valida se os comandos executariam com sucesso — apenas classifica sua forma.

## O que as tasks descendentes precisam saber

- **G-0 (gate da fundação)**: o verificador está ativo no gate.sh. Rode `node scripts/check-acceptance.mjs`
  como parte do checklist.
- **Qualquer card futuro**: ao escrever critérios de aceitação, inclua ao menos um que falhe por
  ausência (ex: `! grep ...`, `test -f`, `test -d`). Evite `grep ... | wc -l` sem controle positivo
  adjacente.
- **F4-03**: o critério decorativo documentado (`grep -rn "character-builder/src" tools/runtime/src | wc -l`)
  é o caso canônico que a sonda negativa detecta. Quando escrever `check-runtime-boundary.sh`, use
  `test -d` como controle positivo, não apenas `wc -l`.
