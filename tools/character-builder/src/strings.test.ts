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

if (errors.length > 0) {
  console.error('Strings vazias encontradas:');
  for (const e of errors) console.error('  ✕', e);
  process.exit(1);
}

console.log('✓ Nenhuma string vazia em S.');
