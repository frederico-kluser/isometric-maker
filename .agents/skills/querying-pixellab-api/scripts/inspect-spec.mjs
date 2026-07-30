#!/usr/bin/env node
/**
 * Query the vendored PixelLab OpenAPI spec from the command line.
 *
 * Exists so that "check the spec" costs one command instead of loading a 387 KB
 * JSON file into context. Two structural facts make naive lookups wrong, and
 * this script handles both:
 *
 *   - Optional fields are `anyOf: [{real}, {type:"null"}]`, so enums, minimums
 *     and maximums sit one level below `.properties.x`. A flat read misses most
 *     constraints, which is how a wrong size limit gets asserted confidently.
 *   - `ImageSize` schemas are namespaced per endpoint
 *     (`app__endpoints__external__v2__<endpoint>__ImageSize`), so there is no
 *     single global size rule to quote.
 *
 * Run:  node inspect-spec.mjs <command> [arg]
 * Exit: 0 found · 1 not found or bad usage
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SPEC = resolve(
  HERE, '..', '..', '..', '..', 'tools', 'pixellab-pipeline', 'openapi', 'openapi-v2.json',
);
const SPEC_PATH = process.env['PIXELLAB_SPEC'] ?? DEFAULT_SPEC;

const USAGE = `
inspect-spec — consulta o spec vendorizado do PixelLab

  summary              contagens e proveniência do snapshot
  list [--async]       todos os paths (ou só os que devolvem 202)
  endpoint <path>      operação, schema de request, required, props e limites
  grep <termo>         procura em paths e nomes de schema
  enums [Nome]         enums nomeados do spec
  limits               limites de tamanho por endpoint

Spec: ${SPEC_PATH}
Sobrescreva com PIXELLAB_SPEC=/caminho/openapi-v2.json
`.trim();

if (!existsSync(SPEC_PATH)) {
  console.error(`spec não encontrado: ${SPEC_PATH}`);
  process.exit(1);
}
const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));

const [cmd, arg] = process.argv.slice(2);
if (!cmd || cmd === '--help' || cmd === '-h') { console.log(USAGE); process.exit(0); }

const schemaOf = (ref) => (ref ? spec.components.schemas[ref.split('/').pop()] : null);
const reqRef = (op) => op.requestBody?.content?.['application/json']?.schema?.$ref;
const isAsync = (op) => Object.keys(op.responses ?? {}).includes('202');

/** Walk every nested object so `anyOf`-wrapped constraints are not missed. */
function constraintsOf(node) {
  const found = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const keep = {};
    for (const k of ['enum', 'minimum', 'maximum', 'multipleOf', 'const']) {
      if (n[k] !== undefined) keep[k] = n[k];
    }
    if (n.$ref) keep.ref = n.$ref.split('/').pop();
    if (Object.keys(keep).length) found.push(keep);
    for (const v of Object.values(n)) walk(v);
  };
  walk(node);
  // Dedupe: the same constraint often appears on both branches of an anyOf.
  const seen = new Set();
  return found.filter((c) => {
    const k = JSON.stringify(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function fmt(c) {
  const bits = [];
  if (c.enum) bits.push(`enum[${c.enum.join('|')}]`);
  if (c.const !== undefined) bits.push(`const=${c.const}`);
  if (c.minimum !== undefined) bits.push(`min=${c.minimum}`);
  if (c.maximum !== undefined) bits.push(`max=${c.maximum}`);
  if (c.multipleOf !== undefined) bits.push(`multipleOf=${c.multipleOf}`);
  if (c.ref) bits.push(`->${c.ref}`);
  return bits.join(' ');
}

switch (cmd) {
  case 'summary': {
    const ops = Object.values(spec.paths).flatMap((p) => Object.entries(p));
    const post = ops.filter(([m]) => m === 'post');
    console.log(`openapi ${spec.openapi} · info.version "${spec.info.version}"`);
    console.log(`${Object.keys(spec.paths).length} paths · ${ops.length} operações · ${post.length} POST`);
    console.log(`${post.filter(([, o]) => isAsync(o)).length} POST assíncronos (202 + background_job_id)`);
    console.log(`${Object.keys(spec.components.schemas).length} schemas`);
    const prov = join(dirname(SPEC_PATH), 'PROVENIENCIA.txt');
    if (existsSync(prov)) console.log(`\n${readFileSync(prov, 'utf8').trim()}`);
    break;
  }

  case 'list': {
    const asyncOnly = arg === '--async';
    for (const [p, item] of Object.entries(spec.paths)) {
      for (const [m, op] of Object.entries(item)) {
        if (asyncOnly && !isAsync(op)) continue;
        console.log(`${m.toUpperCase().padEnd(6)} ${p.padEnd(42)} ${isAsync(op) ? '202' : '   '} ${op.operationId ?? ''}`);
      }
    }
    break;
  }

  case 'endpoint': {
    if (!arg) { console.error('uso: endpoint <path>'); process.exit(1); }
    const item = spec.paths[arg];
    if (!item) {
      console.error(`AUSENTE ${arg} — não existe no spec vendorizado.`);
      const near = Object.keys(spec.paths).filter((p) => p.includes(arg.replace(/^\//, '').slice(0, 6)));
      if (near.length) console.error(`talvez: ${near.slice(0, 5).join(', ')}`);
      process.exit(1);
    }
    for (const [m, op] of Object.entries(item)) {
      console.log(`${m.toUpperCase()} ${arg}  operationId=${op.operationId ?? '-'}`);
      console.log(`  respostas: ${Object.keys(op.responses ?? {}).join(', ')}${isAsync(op) ? '  (ASSÍNCRONO)' : ''}`);
      const params = (op.parameters ?? []).map((p) => p.name);
      if (params.length) console.log(`  path params: ${params.join(', ')}`);
      const ref = reqRef(op);
      if (!ref) continue;
      const sc = schemaOf(ref);
      console.log(`  request: ${ref.split('/').pop()}`);
      console.log(`  required: ${(sc.required ?? []).join(', ') || '(nenhum)'}`);
      for (const [k, v] of Object.entries(sc.properties ?? {})) {
        const c = constraintsOf(v).map(fmt).filter(Boolean);
        console.log(`    ${k.padEnd(28)} ${c.join('  ')}`);
      }
    }
    break;
  }

  case 'grep': {
    if (!arg) { console.error('uso: grep <termo>'); process.exit(1); }
    const t = arg.toLowerCase();
    const paths = Object.keys(spec.paths).filter((p) => p.toLowerCase().includes(t));
    const schemas = Object.keys(spec.components.schemas).filter((s) => s.toLowerCase().includes(t));
    if (paths.length) console.log(`paths:\n${paths.map((p) => `  ${p}`).join('\n')}`);
    if (schemas.length) console.log(`schemas:\n${schemas.map((s) => `  ${s}`).join('\n')}`);
    if (!paths.length && !schemas.length) { console.log(`nada casa com "${arg}"`); process.exit(1); }
    break;
  }

  case 'enums': {
    for (const [name, sc] of Object.entries(spec.components.schemas)) {
      if (!Array.isArray(sc.enum)) continue;
      if (arg && name !== arg) continue;
      console.log(`${name} = ${sc.enum.join(', ')}`);
    }
    break;
  }

  case 'limits': {
    for (const [name, sc] of Object.entries(spec.components.schemas)) {
      if (!/ImageSize|TileSize|OutputSize/i.test(name)) continue;
      const short = name.replace(/^app__endpoints__external__v2__/, '');
      const w = constraintsOf(sc.properties?.width ?? sc).map(fmt).filter(Boolean).join(' ');
      console.log(`${short.padEnd(58)} ${w}`);
    }
    break;
  }

  default:
    console.error(`comando desconhecido: ${cmd}\n\n${USAGE}`);
    process.exit(1);
}
