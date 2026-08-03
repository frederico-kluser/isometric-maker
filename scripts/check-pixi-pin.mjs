#!/usr/bin/env node
/**
 * Verifica que as duas fontes do pin do PixiJS batem entre si.
 *
 * Duas fontes, nenhuma é autoridade sobre a outra:
 *   (A) tools/pixi-reference/package.json          → dependencies["pixi.js"]
 *   (B) tools/pixi-reference/vendor/manifest.json   → pixiVersion
 *
 * (C) tools/character-builder/package.json foi removido como fonte em
 *     2026-08-03 (ADR 0037): o editor migrou para Three.js e não importa
 *     mais pixi.js. O runtime (tools/runtime) ainda usa a versão pinada.
 *
 * Falha se o par divergir.
 * Exit 0 = as duas batem.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

/**
 * Lê uma chave de um JSON, aceitando que a chave em si contenha pontos.
 * Ex: readJsonKey(obj, 'dependencies', 'pixi.js') → obj.dependencies['pixi.js']
 */
function readJsonKey(obj, ...segments) {
  let val = obj;
  for (const seg of segments) {
    if (val == null || typeof val !== 'object') return undefined;
    val = val[seg];
  }
  return val;
}

function checkExact(label, version) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`${RED}versão não é exata${RESET} em ${label}: "${version}" (precisa ser X.Y.Z, sem prefixo)`);
    process.exit(1);
  }
  return version;
}

function readPin(label, filePath, ...segments) {
  if (!existsSync(filePath)) {
    console.error(`${RED}ausente${RESET} ${label}: ${filePath}`);
    process.exit(1);
  }
  const obj = JSON.parse(readFileSync(filePath, 'utf8'));
  const val = readJsonKey(obj, ...segments);
  if (val === undefined) {
    console.error(`${RED}chave '${segments.join('.')}' não encontrada${RESET} em ${label}: ${filePath}`);
    process.exit(1);
  }
  return checkExact(label, val);
}

const LABELS = {
  A: 'pixi-reference/package.json',
  B: 'pixi-reference/vendor/manifest.json',
};

const A = readPin(LABELS.A, resolve(ROOT, 'tools/pixi-reference/package.json'), 'dependencies', 'pixi.js');
const B = readPin(LABELS.B, resolve(ROOT, 'tools/pixi-reference/vendor/manifest.json'), 'pixiVersion');

const pairs = [
  ['A', A, 'B', B],
];

let ok = true;
for (const [ka, va, kb, vb] of pairs) {
  if (va !== vb) {
    console.error(`${RED}divergência${RESET} ${LABELS[ka]} (${va}) ≠ ${LABELS[kb]} (${vb})`);
    ok = false;
  }
}

if (!ok) {
  console.error(`\nAs três fontes precisam bater. Corrija o pin e regenere o vendor se necessário.`);
  process.exit(1);
}

console.log(`${GREEN}ok${RESET} pixi.js ${A} bate nas duas fontes`);
