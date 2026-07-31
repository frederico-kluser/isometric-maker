/**
 * Strings da interface do Character Builder.
 *
 * Chaves em inglês, valores em pt-BR (ADR 0008, ADR 0016).
 * Objeto `as const` — acesso por propriedade direta, não por função t().
 *
 * Barrel: o conteúdo vive em `src/strings/*.ts`, agrupado por tela. Das
 * seções legadas só `erro` restou — `comum`, `personagem` e `custo` morreram
 * com as telas v1 e com o diálogo de orçamento (ADR 0012).
 */

import { erro } from './strings/comum.ts';
import { shell } from './strings/shell.ts';
import { wizard } from './strings/wizard.ts';
import { poses } from './strings/poses.ts';
import { itens } from './strings/itens.ts';
import { laboratorio } from './strings/laboratorio.ts';

// ==================================================================
// Static strings (as const — chave inexistente é erro de compilação)
// ==================================================================

export const S = {
  erro,
  shell,
  wizard,
  poses,
  itens,
  laboratorio,
} as const;
