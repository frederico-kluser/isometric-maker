#!/usr/bin/env node
/**
 * refresh-openapi — baixa o spec vivo da PixelLab e regrava a proveniência.
 *
 * Uso: node scripts/refresh-openapi.mjs
 *
 * Este script É a barreira de atualização: ele troca a fonte da verdade da API
 * inteira e deixa o diff visível no git. A API muda sem versionar (info.version
 * é literalmente "dev"), então a lista de mudanças do fornecedor é o diff.
 *
 * NÃO rode em CI ou em card de implementação — é uma operação manual que altera
 * a base de todo o pipeline.
 */

import { createHash } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OPENAPI_PATH = join(ROOT, 'openapi', 'openapi-v2.json');
const PROVENIENCIA_PATH = join(ROOT, 'openapi', 'PROVENIENCIA.txt');
const SPEC_URL = 'https://api.pixellab.ai/v2/openapi.json';

async function main() {
  console.log(`Baixando ${SPEC_URL}...`);
  const res = await fetch(SPEC_URL);
  if (!res.ok) {
    console.error(`Falha ao baixar o spec: ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const text = await res.text();
  let spec;
  try {
    spec = JSON.parse(text);
  } catch {
    console.error('Resposta não é JSON válido.');
    process.exit(1);
  }

  // Grava o spec vendorizado
  await writeFile(OPENAPI_PATH, text, 'utf8');
  console.log(`Gravado ${OPENAPI_PATH} (${Buffer.byteLength(text, 'utf8')} bytes).`);

  // Extrai metadados do spec
  const openapiVersion = spec.openapi ?? 'desconhecida';
  const infoVersion = spec.info?.version ?? 'desconhecida';
  const paths = Object.keys(spec.paths ?? {});
  const pathCount = paths.length;
  const postCount = paths.filter((p) => spec.paths[p]?.post).length;
  const schemaCount = Object.keys(spec.components?.schemas ?? {}).length;

  // Calcula sha256
  const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');

  // Data de hoje em ISO (só a parte da data)
  const today = new Date().toISOString().slice(0, 10);

  // Monta e grava PROVENIENCIA.txt
  const proveniencia = [
    `Capturado de ${SPEC_URL} em ${today}.`,
    `openapi ${openapiVersion} · info.version="${infoVersion}" · ${pathCount} paths · ${postCount} POST · ${schemaCount} schemas · sha256 abaixo.`,
    sha256,
    '',
  ].join('\n');

  await writeFile(PROVENIENCIA_PATH, proveniencia, 'utf8');
  console.log(`Regravado ${PROVENIENCIA_PATH}`);
  console.log(`  openapi ${openapiVersion} · info.version="${infoVersion}"`);
  console.log(`  ${pathCount} paths · ${postCount} POST · ${schemaCount} schemas`);
  console.log(`  sha256: ${sha256}`);
  console.log(`  data:   ${today}`);
  console.log('\nDiff contra o spec anterior visível no git. Revise antes de commitar.');
}

await main();
