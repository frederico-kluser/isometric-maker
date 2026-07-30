#!/usr/bin/env node
/**
 * Query the vendored PixiJS surface from the command line.
 *
 * Exists so that "check the API" costs one command instead of loading a 47.533
 * line declaration file into context. Same reasoning as inspect-spec.mjs does
 * for the PixelLab spec, applied to a library whose v7 and v8 APIs are similar
 * enough to blend together in recall and different enough that the blend does
 * not run.
 *
 * `exists` is the command that matters most. It answers "am I about to assert a
 * member that v8 removed" before the line is written, rather than after the
 * browser says undefined. It also refuses to answer "yes" quietly for the v7
 * methods v8 kept as deprecated shims.
 *
 * The declaration-merging traps that make a naive lookup wrong are handled in
 * ../../scripts/pixi-index.mjs, which is shared with check-pixi-claims.mjs.
 *
 * Run:  node inspect-pixi.mjs <command> [args]
 * Exit: 0 found · 1 not found or bad usage
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  vendorPaths, loadIndex, membersOf, membersDeep, findMember, parentsOf,
  deprecationOf, primaryDecl, blocksFor,
} from '../../scripts/pixi-index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const P = process.env['PIXI_VENDOR']
  ? { vendor: process.env['PIXI_VENDOR'],
      dts: join(process.env['PIXI_VENDOR'], 'pixi-api.d.ts'),
      manifest: join(process.env['PIXI_VENDOR'], 'manifest.json'),
      skills: join(process.env['PIXI_VENDOR'], 'skills') }
  : vendorPaths(REPO_ROOT);

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

const USAGE = `
inspect-pixi — consulta a superfície vendorizada do PixiJS

  version                    versão vendorizada e proveniência
  grep <termo> [--kind K]    declarações cujo nome casa (class|interface|type|function|const|enum)
  show <Nome> [--full]       o bloco da declaração, com número de linha real
  members <Nome> [--own]     membros herdados inclusive; --own só os declarados no bloco
  member <Nome> <membro>     um membro com o comentário de doc
  options <Nome>             props seguindo extends, PixiMixins e Partial/Required
  prop <nome>                em que declaração(ões) essa propriedade existe
  exists <Nome>[.membro]     existe e não está deprecado? sai 0 ou 1 — use ANTES de afirmar
  deprecated [termo]         o que a v8 manteve como shim da v7
  skills [termo]             as skills oficiais vendorizadas do PixiJS
  skill <nome>               caminho e descrição de uma skill upstream

Vendor: ${P.vendor}
Sobrescreva com PIXI_VENDOR=/caminho/vendor
`.trim();

const idx = loadIndex(P.dts, P.manifest);
if (!idx) {
  console.error(
    `${RED}vendor não encontrado: ${P.dts}${RESET}\n` +
      `  npm install --prefix tools/pixi-reference && npm run vendor --prefix tools/pixi-reference`,
  );
  process.exit(1);
}
const { lines } = idx;

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const args = argv.slice(1).filter((a) => !a.startsWith('--'));
if (!cmd || cmd === '--help' || cmd === '-h') { console.log(USAGE); process.exit(0); }

const cite = (i) => `${DIM}tools/pixi-reference/vendor/pixi-api.d.ts:${i + 1}${RESET}`;

const notFound = (name) => {
  const near = [...idx.decls.keys()]
    .filter((k) => k.toLowerCase().includes(String(name).toLowerCase()))
    .slice(0, 8);
  console.error(`${RED}"${name}" não existe no PixiJS vendorizado${RESET}`);
  console.error(near.length ? `  próximos: ${near.join(', ')}` : `  tente: inspect-pixi.mjs grep <termo>`);
  process.exit(1);
};

const need = (name) => primaryDecl(idx, name) ?? notFound(name);

/* ---------------------------------------------------------------- commands */

if (cmd === 'version') {
  const kinds = {};
  for (const blocks of idx.decls.values()) for (const d of blocks) kinds[d.kind] = (kinds[d.kind] ?? 0) + 1;
  console.log(`${BOLD}pixi.js ${idx.manifest.pixiVersion ?? '?'}${RESET}  capturado ${idx.manifest.capturedAt ?? '?'}`);
  console.log(`${lines.length} linhas · ${idx.decls.size} nomes de topo · ${idx.mixins.size} interface(s) PixiMixins`);
  console.log(Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${n} ${k}`).join('\n'));
  console.log(`${DIM}proveniência completa: tools/pixi-reference/vendor/PROVENIENCIA.txt${RESET}`);
  process.exit(0);
}

if (cmd === 'grep') {
  const term = (args[0] ?? '').toLowerCase();
  if (!term) { console.error(USAGE); process.exit(1); }
  const kindIdx = argv.indexOf('--kind');
  const kind = kindIdx >= 0 ? argv[kindIdx + 1] : null;
  const hits = [...idx.decls.keys()]
    .filter((n) => n.toLowerCase().includes(term))
    .map((n) => primaryDecl(idx, n))
    .filter((d) => !kind || d.kind === kind)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (hits.length === 0) { console.error(`${RED}nada casa "${term}"${RESET}`); process.exit(1); }
  for (const d of hits) {
    const dep = deprecationOf(idx, d.start);
    console.log(`${d.kind.padEnd(9)} ${BOLD}${d.name}${RESET}  ${cite(d.start)}${dep ? ` ${YELLOW}DEPRECADO${RESET}` : ''}`);
  }
  console.log(`\n${hits.length} resultado(s)`);
  process.exit(0);
}

if (cmd === 'show') {
  const name = need(args[0]).name;
  for (const d of blocksFor(idx, name)) {
    console.log(`${BOLD}${d.kind} ${d.name}${RESET}  ${cite(d.start)}–${d.end + 1}\n`);
    let inDoc = false;
    for (let i = d.start; i <= d.end; i += 1) {
      const l = lines[i];
      if (!flags.has('--full')) {
        // Signatures answer "what can I call"; the prose is upstream's skills'
        // job. Keeping both would defeat the point of not loading 47k lines.
        if (/^\s*\/\*\*/.test(l)) inDoc = true;
        if (inDoc) { if (/\*\//.test(l)) inDoc = false; continue; }
        if (/^\s*$/.test(l)) continue;
      }
      console.log(`${DIM}${String(i + 1).padStart(6)}${RESET} ${l}`);
    }
    console.log('');
  }
  process.exit(0);
}

if (cmd === 'members') {
  const name = need(args[0]).name;
  if (flags.has('--own')) {
    let n = 0;
    for (const b of blocksFor(idx, name)) {
      for (const [m, i] of membersOf(idx, b)) { n += 1; console.log(`  ${m.padEnd(28)} ${cite(i)}`); }
    }
    console.log(`\n${n} membro(s) declarado(s) no próprio bloco`);
    process.exit(0);
  }
  const { members, complete } = membersDeep(idx, name);
  console.log(`${BOLD}${name}${RESET} — ${members.size} membro(s), herança inclusive\n`);
  for (const [m, v] of [...members].sort((a, b) => a[0].localeCompare(b[0]))) {
    const dep = deprecationOf(idx, v.line);
    console.log(
      `  ${m.padEnd(28)} ${DIM}${v.owner === name ? '' : `via ${v.owner}`}${RESET}` +
        `${dep ? ` ${YELLOW}DEPRECADO${RESET}` : ''}  ${cite(v.line)}`,
    );
  }
  if (!complete) {
    console.log(
      `\n${YELLOW}lista incompleta${RESET} — a cadeia passa por um mapped type que só um type ` +
        `checker resolve. Use: inspect-pixi.mjs prop <nome>`,
    );
  }
  process.exit(0);
}

if (cmd === 'member') {
  const name = need(args[0]).name;
  const wanted = args[1];
  const { found, complete } = findMember(idx, name, wanted);
  if (!found) {
    console.error(`${RED}${name} não tem "${wanted}"${RESET}`);
    if (!complete) console.error(`  ${YELLOW}a cadeia é incompleta${RESET} — tente: inspect-pixi.mjs prop ${wanted}`);
    process.exit(1);
  }
  console.log(`${BOLD}${name}.${wanted}${RESET}${found.owner === name ? '' : ` ${DIM}(via ${found.owner})${RESET}`}  ${cite(found.line)}\n`);
  const dep = deprecationOf(idx, found.line);
  if (dep) console.log(`${YELLOW}DEPRECADO — ${dep}${RESET}\n`);
  let start = found.line - 1;
  if (/^\s*\*\//.test(lines[start] ?? '')) {
    while (start > 0 && !/^\s*\/\*\*/.test(lines[start])) start -= 1;
    for (let k = start; k < found.line; k += 1) console.log(`${DIM}${lines[k]}${RESET}`);
  }
  console.log(lines[found.line]);
  process.exit(0);
}

if (cmd === 'options') {
  const seen = new Set();
  let total = 0;

  const collect = (name, depth = 0) => {
    if (seen.has(name)) return;
    seen.add(name);
    // `ExtractRendererOptions<typeof SharedSystems>` is a mapped type over the
    // registered renderer systems. width, height, background, backgroundAlpha,
    // antialias and clearBeforeRender all come from there, and no text reader
    // resolves it. Saying so is the only honest output; stopping silently would
    // report "16 options" about an API that takes many more.
    if (/^Extract[A-Z]/.test(name)) {
      console.log(
        `${'  '.repeat(depth)}${YELLOW}${name}${RESET} ${DIM}— mapped type sobre os sistemas ` +
          `registrados; não enumerável por leitura de texto.${RESET}\n` +
          `${'  '.repeat(depth + 1)}${DIM}width/height vêm de ViewSystemOptions, background* de ` +
          `BackgroundSystemOptions. Use: inspect-pixi.mjs prop <nome>${RESET}`,
      );
      return;
    }
    const blocks = blocksFor(idx, name);
    if (!blocks) { console.log(`${DIM}${'  '.repeat(depth)}(${name} não resolvido no vendor)${RESET}`); return; }
    const label = blocks.length > 1 ? `${name} ${DIM}(${blocks.length} blocos merged)${RESET}` : name;
    console.log(`${'  '.repeat(depth)}${BOLD}${label}${RESET}`);
    for (const b of blocks) {
      for (const [m, i] of membersOf(idx, b)) {
        total += 1;
        console.log(`${'  '.repeat(depth + 1)}${m.padEnd(24)} ${DIM}${lines[i].trim()}${RESET}`);
      }
      for (const p of parentsOf(idx, b)) collect(p, depth + 1);
    }
  };

  collect(idx.mixins.has(args[0]) ? args[0] : need(args[0]).name);
  console.log(`\n${total} opção(ões) alcançável(is) por leitura de texto`);
  process.exit(0);
}

/**
 * Where does a property name live?
 *
 * The answer `options` cannot give for anything behind a mapped type. Scanning
 * every declaration for the property is the wrong direction for a compiler and
 * the right one here: it finds the option regardless of how many layers of
 * merging and extraction stand between it and the interface a caller names.
 */
if (cmd === 'prop') {
  const wanted = args[0];
  if (!wanted) { console.error(USAGE); process.exit(1); }
  const owners = [];
  for (const [name, blocks] of [...idx.decls, ...idx.mixins]) {
    for (const b of blocks) {
      if (b.kind !== 'interface' && b.kind !== 'class') continue;
      const i = membersOf(idx, b).get(wanted);
      if (i !== undefined) owners.push({ owner: name, line: i });
    }
  }
  if (owners.length === 0) {
    console.log(`${RED}nenhuma declaração do vendor tem a propriedade "${wanted}"${RESET}`);
    process.exit(1);
  }
  console.log(`${BOLD}${wanted}${RESET} — declarada em ${owners.length} lugar(es)\n`);
  for (const o of owners) {
    const dep = deprecationOf(idx, o.line);
    console.log(`  ${o.owner.padEnd(34)} ${cite(o.line)}${dep ? ` ${YELLOW}DEPRECADO${RESET}` : ''}  ${DIM}${lines[o.line].trim()}${RESET}`);
  }
  process.exit(0);
}

if (cmd === 'exists') {
  // A dotted PixiMixins name is one identifier, not a member access.
  if (idx.mixins.has(args[0] ?? '')) {
    const blocks = idx.mixins.get(args[0]);
    console.log(`${GREEN}sim${RESET} — ${args[0]}, ${blocks.length} bloco(s) merged ${cite(blocks[0].start)}`);
    process.exit(0);
  }
  const [name, member] = (args[0] ?? '').split('.');
  const d = primaryDecl(idx, name);
  if (!d) { console.log(`${RED}não${RESET} — "${name}" não existe`); process.exit(1); }

  if (!member) {
    const dep = deprecationOf(idx, d.start);
    if (dep) { console.log(`${YELLOW}existe, mas DEPRECADO${RESET} — ${dep}`); process.exit(1); }
    console.log(`${GREEN}sim${RESET} — ${d.kind} ${name} ${cite(d.start)}`);
    process.exit(0);
  }

  const { found, complete } = findMember(idx, name, member);
  if (!found) {
    console.log(`${RED}não${RESET} — ${name} não tem "${member}"`);
    if (!complete) console.log(`${YELLOW}  (cadeia incompleta — confirme com: prop ${member})${RESET}`);
    process.exit(1);
  }
  const dep = deprecationOf(idx, found.line);
  if (dep) {
    // A deprecated shim answering "yes" is how v7 code gets written against v8
    // and typechecks. Non-zero exit is the point.
    console.log(`${YELLOW}existe, mas DEPRECADO${RESET} — ${dep} ${cite(found.line)}`);
    process.exit(1);
  }
  console.log(`${GREEN}sim${RESET} — ${name}.${member}${found.owner === name ? '' : ` (via ${found.owner})`} ${cite(found.line)}`);
  process.exit(0);
}

if (cmd === 'deprecated') {
  const term = (args[0] ?? '').toLowerCase();
  let n = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (!/@deprecated/.test(lines[i])) continue;
    // The declaration the tag belongs to is the next non-doc line.
    let j = i;
    while (j < lines.length && /^\s*(\*|\/\*)/.test(lines[j])) j += 1;
    const sig = (lines[j] ?? '').trim();
    if (!sig || (term && !sig.toLowerCase().includes(term))) continue;
    n += 1;
    console.log(`  ${sig.padEnd(60).slice(0, 60)} ${DIM}${lines[i].replace(/^\s*\*\s*/, '').trim()}${RESET}`);
  }
  console.log(`\n${n} declaração(ões) deprecada(s)${term ? ` casando "${term}"` : ''} — v8 manteve os shims da v7`);
  process.exit(0);
}

if (cmd === 'skills' || cmd === 'skill') {
  if (!existsSync(P.skills)) { console.error(`${RED}vendor/skills/ ausente${RESET}`); process.exit(1); }
  const all = readdirSync(P.skills, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(P.skills, e.name, 'SKILL.md')))
    .map((e) => e.name)
    .sort();

  const descOf = (n) => {
    const t = readFileSync(join(P.skills, n, 'SKILL.md'), 'utf8');
    return (/^description:\s*"?(.*?)"?\s*$/m.exec(t)?.[1] ?? '').replace(/\s+/g, ' ');
  };

  if (cmd === 'skill') {
    const name = String(args[0] ?? '').startsWith('pixijs') ? args[0] : `pixijs-${args[0] ?? ''}`;
    if (!all.includes(name)) {
      console.error(`${RED}skill upstream "${name}" não existe${RESET}`);
      console.error(`  disponíveis: ${all.join(', ')}`);
      process.exit(1);
    }
    const refDir = join(P.skills, name, 'references');
    const refs = existsSync(refDir) ? readdirSync(refDir) : [];
    console.log(`${BOLD}${name}${RESET}`);
    console.log(`  ler: tools/pixi-reference/vendor/skills/${name}/SKILL.md`);
    if (refs.length) console.log(`  references/: ${refs.join(', ')}`);
    console.log(`\n${descOf(name)}`);
    process.exit(0);
  }

  const term = (args[0] ?? '').toLowerCase();
  const shown = all.filter((n) => !term || n.includes(term) || descOf(n).toLowerCase().includes(term));
  for (const n of shown) console.log(`${BOLD}${n.padEnd(34)}${RESET}${DIM}${descOf(n).slice(0, 92)}${RESET}`);
  console.log(`\n${shown.length}/${all.length} skill(s) — leia com Read, não copie para dentro de uma skill nossa`);
  process.exit(0);
}

console.error(USAGE);
process.exit(1);
