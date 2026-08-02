/**
 * Teste de integridade do módulo de strings.
 *
 * Verifica que nenhum valor estático no objeto `S` é string vazia.
 * Execute com: npx tsx src/strings.test.ts
 */

import { S } from './strings.ts';

// ------------------------------------------------------------------ walk

function check(obj: unknown, path: string): string[] {
  const errors: string[] = [];
  if (typeof obj === 'string') {
    if (obj === '') errors.push(`${path} — string vazia`);
  } else if (typeof obj === 'object' && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      errors.push(...check(value, `${path}.${key}`));
    }
  }
  return errors;
}

// ------------------------------------------------------------------ main

const errors = check(S, 'S');

// Sucesso é silencioso: o `node --test` já reporta o arquivo como `✔`. Escrever
// no stdout daqui corromperia o protocolo serializado que o runner usa entre pai
// e filho. O relatório de falha vai por stderr, que é canal separado e seguro.
if (errors.length > 0) {
  console.error('Strings vazias encontradas:');
  for (const e of errors) console.error('  ✕', e);
  process.exit(1);
}
