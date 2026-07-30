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
  list [--async|--sync|--202]
                       todos os paths, ou filtrados. --async = devolve job id
                       (o contrato real); --202 = declara 202 (só 23 dos 34)
  endpoint <path>      operação, schema de request, required, props e limites
  response <path>      o que cada status devolve, campo a campo
  flow <path>          a cadeia submit -> poll -> fetch, derivada do spec
  tag [nome]           endpoints por grupo do spec (sem nome: lista os grupos)
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

const respRef = (op, code) =>
  op.responses?.[code]?.content?.['application/json']?.schema?.$ref;
const okCodes = (op) => Object.keys(op.responses ?? {}).filter((c) => /^2/.test(c));

/**
 * The success code whose body is actually described.
 *
 * `/create-tileset` and `/create-isometric-tile` declare BOTH 200 and 202, and
 * only the 202 carries a schema. Taking the first 2xx would read those two as
 * having no response body at all, and therefore as synchronous — the opposite
 * of the truth.
 */
const okCode = (op) => okCodes(op).find((c) => respRef(op, c)) ?? okCodes(op)[0];
const declares202 = (op) => Object.keys(op.responses ?? {}).includes('202');

/**
 * Whether the endpoint hands back a job instead of the artefact.
 *
 * Deliberately NOT `responses['202'] !== undefined`. That test was wrong and
 * wrong in the expensive direction: 34 POSTs return a job id, but only 23
 * declare 202 — the other 13, including every character-creation endpoint,
 * answer 200 with a `background_job_id` in the body. Treating those as
 * synchronous means reading `image` off a body that only carries a job id, so
 * the generation is paid for and then dropped on the floor.
 */
function isAsync(op) {
  return okCodes(op).some((code) => {
    const sc = schemaOf(respRef(op, code));
    return Object.keys(sc?.properties ?? {}).some((k) => /^background_job_ids?$/.test(k));
  });
}

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

/**
 * Resolve a path written in prose to the real spec path.
 *
 * Descriptions name the same route with different placeholders —
 * `/background-jobs/{background_job_id}` in one endpoint's text,
 * `/background-jobs/{job_id}` in the spec itself. Comparing with the parameter
 * names blanked out is what makes those the same route.
 */
const BLANK = (p) => p.replace(/\{[^}]*\}/g, '{}');
const SPEC_BY_SHAPE = new Map(Object.keys(spec.paths).map((p) => [BLANK(p), p]));
const normalisePath = (p) => SPEC_BY_SHAPE.get(BLANK(p)) ?? p;

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
    const jobbed = post.filter(([, o]) => isAsync(o)).length;
    const coded = post.filter(([, o]) => declares202(o)).length;
    console.log(`${jobbed} POST assíncronos (devolvem background_job_id)`);
    console.log(`${coded} POST declaram 202 — os outros ${jobbed - coded} devolvem 200 com job id`);
    console.log(`${Object.keys(spec.components.schemas).length} schemas`);
    const tags = new Set(ops.flatMap(([, o]) => o.tags ?? []));
    console.log(`${tags.size} grupos (tags)`);
    const prov = join(dirname(SPEC_PATH), 'PROVENIENCIA.txt');
    if (existsSync(prov)) console.log(`\n${readFileSync(prov, 'utf8').trim()}`);
    break;
  }

  case 'list': {
    for (const [p, item] of Object.entries(spec.paths)) {
      for (const [m, op] of Object.entries(item)) {
        const a = isAsync(op);
        if (arg === '--async' && !a) continue;
        if (arg === '--sync' && (a || m !== 'post')) continue;
        if (arg === '--202' && !declares202(op)) continue;
        const mark = a ? (declares202(op) ? '202' : '200*') : '   ';
        console.log(`${m.toUpperCase().padEnd(6)} ${p.padEnd(42)} ${mark.padEnd(5)} ${op.operationId ?? ''}`);
      }
    }
    if (arg === '--async') console.log('\n200* = assíncrono mas responde 200, não 202.');
    break;
  }

  case 'tag': {
    const groups = new Map();
    for (const [p, item] of Object.entries(spec.paths)) {
      for (const [m, op] of Object.entries(item)) {
        for (const t of op.tags ?? ['(sem tag)']) {
          if (!groups.has(t)) groups.set(t, []);
          groups.get(t).push(`${m.toUpperCase().padEnd(6)} ${p.padEnd(44)}${isAsync(op) ? ' async' : ''}`);
        }
      }
    }
    if (!arg) {
      for (const [t, eps] of groups) console.log(`${String(eps.length).padStart(3)}  ${t}`);
      break;
    }
    const hit = [...groups.keys()].find((t) => t.toLowerCase().includes(arg.toLowerCase()));
    if (!hit) {
      console.error(`nenhum grupo casa com "${arg}". Grupos: ${[...groups.keys()].join(', ')}`);
      process.exit(1);
    }
    console.log(`# ${hit} (${groups.get(hit).length})`);
    for (const line of groups.get(hit)) console.log(`  ${line}`);
    break;
  }

  case 'response': {
    if (!arg) { console.error('uso: response <path>'); process.exit(1); }
    const item = spec.paths[arg];
    if (!item) { console.error(`AUSENTE ${arg}`); process.exit(1); }
    for (const [m, op] of Object.entries(item)) {
      console.log(`${m.toUpperCase()} ${arg}`);
      for (const [code, r] of Object.entries(op.responses ?? {})) {
        const ref = respRef(op, code);
        const sc = schemaOf(ref);
        console.log(`  ${code} ${ref ? ref.split('/').pop() : (r.description ?? '')}`);
        if (!sc?.properties) continue;
        const required = new Set(sc.required ?? []);
        for (const [k, v] of Object.entries(sc.properties)) {
          const c = constraintsOf(v).map(fmt).filter(Boolean).join(' ');
          console.log(`      ${required.has(k) ? '*' : ' '}${k.padEnd(24)} ${c}`);
        }
      }
    }
    break;
  }

  /**
   * The submit -> poll -> fetch chain.
   *
   * Derived, not hand-maintained: the poll endpoint is read out of the
   * operation's own prose, because the spec has no machine-readable link
   * between a submit endpoint and the GET that retrieves its result. A hand
   * table would be a second source of truth and would rot on the next capture.
   */
  case 'flow': {
    if (!arg) { console.error('uso: flow <path>'); process.exit(1); }
    const op = spec.paths[arg]?.post;
    if (!op) { console.error(`AUSENTE POST ${arg}`); process.exit(1); }
    const code = okCode(op);
    const sc = schemaOf(respRef(op, code));
    const props = Object.keys(sc?.properties ?? {});
    console.log(`1. POST ${arg}  ->  ${code} { ${props.join(', ')} }`);
    if (!isAsync(op)) {
      console.log('   SÍNCRONO — o artefato vem nesta resposta. Não há poll.');
      break;
    }
    const mentioned = [...new Set(
      [...(op.description ?? '').matchAll(/GET\s+(?:\/v2)?(\/[a-z0-9\-{}_]+(?:\/[a-z0-9\-{}_]+)*)/gi),
      ].map((m) => m[1]),
    )];
    const known = [...new Set(
      mentioned.map(normalisePath).filter((p) => spec.paths[p]),
    )];
    console.log(`2. poll ${known.length ? known.join(' ou ') : '/background-jobs/{job_id}'}`);
    const ids = props.filter((k) => /_id$/.test(k) && !/^background_job/.test(k));
    if (ids.length) {
      console.log(`3. o recurso já existe em ${ids.join(', ')} — guarde antes do primeiro poll`);
    }
    console.log('\nAviso: o dinheiro sai no passo 1. Perder o id não devolve nada.');
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
