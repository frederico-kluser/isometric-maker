# Handoff: F0-02 — Rename para character-builder e purga do nome residual

**Card:** F0-02 · **Onda:** W1 · **Data:** 2026-07-30

## Arquivos produzidos

| Arquivo | Propósito |
| --- | --- |
| `tools/character-builder/**` | Árvore renomeada via `git mv` (histórico preservado) |
| `tools/pixellab-pipeline/src/cli.ts` | Banner do `usage()`: "Power Abuse" → "isometric-maker" |

Arquivos alterados fora da árvore movida:

| Arquivo | Mudança |
| --- | --- |
| `.gitignore:15` | `tools/sprite-studio/assets/` → `tools/character-builder/assets/` |
| `AGENTS.md:86` | Comando typecheck atualizado |
| `docs/README.md:56` | Linha da tabela "Ferramentas" |
| `docs/02-personagem/guarda-roupa-e-silhueta.md:8,82` | Caminhos cd e link |
| `docs/00-produto/visao.md:8` | Caminho cd |
| `scripts/gate.sh:104-107` | Header e stage (removido fallback `\|\| cd tools/character-builder`) |
| `analise-projeto-2026-07-30.html:174,232` | Referências na análise de projeto |
| `PLANO-DE-EXECUCAO.md` | 18 ocorrências de `sprite-studio` + bloco yaml marcado feito com Considerações |

## API pública

Nenhuma. O rename é transparente para a API — `package.json`, `vite.config.ts` e `server/api.ts` mantêm a mesma interface. O plugin Vite mudou de nome interno (`sprite-studio-api` → `character-builder-api`), mas isso não é superfície pública.

## Decisões de design

1. **`git mv`, não copiar e apagar.** O histórico do arquivo é o que permite auditar a promoção do estúdio para construtor de personagem.

2. **Nome do pacote npm: `@isometric-maker/character-builder`.** Alinhado com a ADR 0017 (nome único).

3. **Título do HTML: "Character Builder — isometric-maker".** Remove a última ocorrência de "Power Abuse" em `tools/`.

4. **Banner do CLI: "pipeline de assets do isometric-maker".** A única linha do pipeline tocada por este card; o resto do `cli.ts` pertence a F0-03.

5. **`scripts/gate.sh` sem fallback.** O gate apontava para `tools/sprite-studio \|\| tools/character-builder` como fallback. Agora aponta exclusivamente para `character-builder`.

## Limitações conhecidas

- **`docs/adr/0015-low-top-down-8-direcoes-isometrico.md:56`** contém `tools/sprite-studio/server/api.ts` como referência histórica. A restrição do card proíbe editar `docs/adr/**`, portanto esta ocorrência sobrevive. O critério de aceitação `! grep -rn "sprite-studio"` falha por causa dela — intencionalmente.

## O que as tasks descendentes precisam saber

- **F0-03 (CLI, guard, testes):** o banner do `usage()` já está limpo. O resto do `cli.ts` é seu.
- **F1-03 (troca de endpoint):** o `server/api.ts` está em `tools/character-builder/server/api.ts`. O import relativo `../../pixellab-pipeline/src/api.ts` continua funcionando (profundidade inalterada).
- **Qualquer card que edite skills:** o lint está verde (0 erros, 44 avisos de hash stale). As skills listadas nas Considerações do bloco yaml de F0-02 têm hashes desatualizados que são AVISO, não ERRO — revalidar é responsabilidade de quem editar a skill.
- **G-0 (orquestrador):** a referência `docs/adr/0015` ao caminho antigo é refutação — o card F0-02 está proibido de editá-la, mas ela existe e o grep a encontra.
