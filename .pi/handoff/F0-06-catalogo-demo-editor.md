# Handoff: F0-06 — Catálogo de demonstração do editor

**Card:** F0-06 · **Onda:** W2 · **Data:** 2026-07-30

## Arquivos produzidos

| Arquivo | Propósito |
| --- | --- |
| `tools/pixellab-pipeline/assets/catalog.ts` | Catálogo reduzido: 1 personagem, 1 tileset, 1 prop (6 assets no total) |

Nenhum outro arquivo foi alterado.

## API pública

Nenhuma mudança. `export default CATALOG` e `export const PALETTE` mantêm a mesma assinatura.

## Decisões de design

1. **Redução para 1-1-1 (personagem, tileset, prop).** O personagem escolhido foi `lobo-esfomeado`
   com as três animações template (`breathing-idle`, `crouched-walking`, `attack`). O tileset
   `grama-terra` e o prop `barril` completam um conjunto mínimo coerente para demonstração.
   Total: 6 assets (base + 3 anims + 1 tileset + 1 prop), abaixo dos 17 originais.

2. **Seeds mantidos exatamente como estavam.** `1001` (lobo), `2001` (grama-terra), `3001` (barril).
   Nenhum seed foi alterado, adicionado sem seed, ou removido.

3. **Estrutura simplificada para IIFE.** Sem arrays intermediários (`CREATURES`, `ANIMATIONS`),
   sem `flatMap`. Para um único personagem, a IIFE é mais legível que a indireção extra.

4. **Comentários reescritos.** Removidas as referências a `docs/02-design` (diretório inexistente)
   e "melee combat game" / "combate corpo a corpo". Os comentários agora descrevem o catálogo como
   uma demonstração mínima, sem implicar um escopo de jogo completo.

5. **PALETTE inalterada.** Exportação mantida byte a byte — divergir quebraria a consistência visual
   com qualquer arte já gerada.

6. **Nenhum endpoint novo.** Todos os quatro endpoints usados (`create-character-with-8-directions`,
   `animate-character`, `create-tileset`, `map-objects`) estão na `COST_TABLE` e nenhum usa
   `mode:'pro'`.

## Limitações conhecidas

- O catálogo é mínimo por design. Adicionar mais assets é trabalho de cards futuros (F1-*).
- O `template_id` do personagem não é especificado — usa o default `mannequin`. Para um lobo
  (quadrúpede), o template `bear`/`dog`/`wolf` seria semanticamente mais correto, mas trocá-lo
  mudaria o specHash e forçaria regeneração. Como nada foi gerado ainda, isso é inócuo — mas
  merece uma decisão explícita antes da primeira geração.

## O que as tasks descendentes precisam saber

- **F0-07 em diante:** O catálogo tem 6 assets. Qualquer teste que espere 17 assets precisa ser
  atualizado.
- **Primeira geração (F1-*):** O `plan` mostra todos os 6 assets como `generate` (lockfile vazio).
  A primeira geração com `--limit 1` gera 1 asset por vez.
- **Idempotência:** Com lockfile vazio, `plan` sempre reporta `generate` para todos os 6.
  O teste de idempotência (previsto para onda futura) deve preencher o lockfile primeiro.
