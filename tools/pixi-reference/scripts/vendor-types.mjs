#!/usr/bin/env node
/**
 * Vendor the PixiJS knowledge surface into the repository, with provenance.
 *
 * Why this exists at all
 * ----------------------
 * The repo already learned this lesson once with PixelLab: an API described from
 * memory goes wrong silently, and a guide written from memory rots without ever
 * announcing it. PixiJS has the same shape of problem for a different reason —
 * v8 rewrote enough of v7 (Graphics, filters, ParticleContainer, BaseTexture,
 * the sync Application constructor) that a model recalling "PixiJS" recalls a
 * blend of two incompatible APIs. So nothing here is written from memory: the
 * skills cite this vendored snapshot, and this script is what produces it.
 *
 * Two artifacts, for two different jobs
 * -------------------------------------
 *   vendor/pixi-api.d.ts  the bundled declaration file. This is the ONLY thing
 *                         that can answer "does this class/member actually
 *                         exist" without a network call, and it is what
 *                         check-pixi-claims.mjs verifies every skill against.
 *   vendor/skills/        the 26 agent skills the pixi.js package itself
 *                         publishes (MIT). They are upstream's own description
 *                         of its API, versioned with the library. Copying their
 *                         content into our skills would fork it; vendoring and
 *                         citing them keeps one copy that upgrades with `npm
 *                         update`.
 *
 * They are NOT linted as this repo's skills. `listSkills()` only scans
 * .agents/skills/, and upstream's frontmatter (a `license` key, non-gerund
 * names, no metadata block) would fail our linter on every file. They live
 * under tools/ precisely so that the linter's rules stay ours.
 *
 * Run:  node tools/pixi-reference/scripts/vendor-types.mjs [--check]
 * Exit: 0 vendored / vendor intact · 1 drift, corruption or missing input
 */
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync,
} from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');
const UPSTREAM = join(PKG_ROOT, 'node_modules', 'pixi.js');
const VENDOR = join(PKG_ROOT, 'vendor');

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';

const check = process.argv.includes('--check');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/* ------------------------------------------------------------------ helpers */

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function copyInto(srcFile, destFile) {
  mkdirSync(dirname(destFile), { recursive: true });
  const buf = readFileSync(srcFile);
  writeFileSync(destFile, buf);
  return buf;
}

/* ------------------------------------------------------------------- --check */

/**
 * Verification runs against the manifest, not against node_modules.
 *
 * node_modules is gitignored, so a clone has the vendor and no upstream. If the
 * check needed upstream present it would be unrunnable exactly where it matters
 * most — on a fresh checkout, in the state where someone is about to trust the
 * vendored files. Upstream, when it happens to be installed, is checked as a
 * second and separate question: has the pin moved?
 */
if (check) {
  const manifestPath = join(VENDOR, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`${RED}vendor/manifest.json não existe — rode sem --check para vendorizar${RESET}`);
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const problems = [];

  for (const [rel, expected] of Object.entries(manifest.files)) {
    const abs = join(VENDOR, rel);
    if (!existsSync(abs)) { problems.push(`ausente: ${rel}`); continue; }
    const actual = sha256(readFileSync(abs));
    if (actual !== expected) {
      problems.push(`modificado à mão: ${rel} (${expected.slice(0, 12)} -> ${actual.slice(0, 12)})`);
    }
  }

  // A file present in vendor/ but absent from the manifest is unaccounted for,
  // and an unaccounted file is exactly what a hand-edit looks like.
  const known = new Set(Object.keys(manifest.files));
  for (const abs of walk(VENDOR)) {
    const rel = relative(VENDOR, abs).replaceAll('\\', '/');
    if (rel === 'manifest.json' || rel === 'PROVENIENCIA.txt') continue;
    if (!known.has(rel)) problems.push(`fora do manifesto: ${rel}`);
  }

  if (problems.length > 0) {
    console.error(`${RED}vendor corrompido — ${problems.length} problema(s):${RESET}`);
    for (const p of problems) console.error(`  · ${p}`);
    console.error(`\nO vendor é gerado, não editado. Regenere: npm run vendor --prefix tools/pixi-reference`);
    process.exit(1);
  }

  console.log(
    `${GREEN}ok${RESET} vendor íntegro · pixi.js ${manifest.pixiVersion} · ` +
      `${Object.keys(manifest.files).length} arquivo(s)`,
  );

  if (existsSync(UPSTREAM)) {
    const installed = JSON.parse(readFileSync(join(UPSTREAM, 'package.json'), 'utf8')).version;
    if (installed !== manifest.pixiVersion) {
      console.log(
        `${YELLOW}aviso${RESET} node_modules tem pixi.js ${installed}, vendor tem ` +
          `${manifest.pixiVersion} — regenere o vendor e trate as diferenças como changelog`,
      );
    }
  } else {
    console.log(`${DIM}node_modules ausente; drift de versão não verificado${RESET}`);
  }
  process.exit(0);
}

/* ------------------------------------------------------------------- vendor */

if (!existsSync(UPSTREAM)) {
  console.error(
    `${RED}pixi.js não está instalado${RESET}\n` +
      `  npm install --prefix tools/pixi-reference`,
  );
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(UPSTREAM, 'package.json'), 'utf8'));
const version = pkg.version;

const DTS_SRC = join(UPSTREAM, 'dist', 'pixi.js.d.ts');
const SKILLS_SRC = join(UPSTREAM, 'skills');
const LICENSE_SRC = join(UPSTREAM, 'LICENSE');

for (const [label, p] of [['dist/pixi.js.d.ts', DTS_SRC], ['skills/', SKILLS_SRC], ['LICENSE', LICENSE_SRC]]) {
  if (!existsSync(p)) {
    console.error(
      `${RED}pixi.js ${version} não publica ${label}${RESET}\n` +
        `Se o pacote parou de publicar skills/, as skills deste repo que citam ` +
        `vendor/skills/ ficam sem lastro. Decida explicitamente antes de seguir.`,
    );
    process.exit(1);
  }
}

// Regenerating from scratch is the point: a stale file left behind from a
// previous pixi version would be indistinguishable from a current one.
rmSync(VENDOR, { recursive: true, force: true });
mkdirSync(VENDOR, { recursive: true });

const files = {};

const dtsBuf = copyInto(DTS_SRC, join(VENDOR, 'pixi-api.d.ts'));
files['pixi-api.d.ts'] = sha256(dtsBuf);

for (const abs of walk(SKILLS_SRC)) {
  const rel = join('skills', relative(SKILLS_SRC, abs)).replaceAll('\\', '/');
  files[rel] = sha256(copyInto(abs, join(VENDOR, rel)));
}

// MIT requires the notice to travel with the copy. It is also the honest label
// on the directory: this is someone else's work, vendored.
files['skills/LICENSE'] = sha256(copyInto(LICENSE_SRC, join(VENDOR, 'skills', 'LICENSE')));

const dtsLines = dtsBuf.toString('utf8').split('\n').length;
const skillCount = Object.keys(files).filter((f) => f.endsWith('/SKILL.md')).length;

const manifest = {
  pixiVersion: version,
  capturedAt: new Date().toISOString().slice(0, 10),
  source: 'npm: pixi.js',
  files,
};
writeFileSync(join(VENDOR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

writeFileSync(
  join(VENDOR, 'PROVENIENCIA.txt'),
  [
    'PROVENIENCIA — superficie de conhecimento do PixiJS vendorizada',
    '',
    `pixi.js           ${version}   (pin exato em tools/pixi-reference/package.json)`,
    `capturado em      ${manifest.capturedAt}`,
    'origem            npm, pacote pixi.js',
    'licenca           MIT — ver skills/LICENSE',
    '',
    'CONTEUDO',
    `  pixi-api.d.ts   ${dtsLines} linhas — superficie de tipos completa,`,
    '                  citavel linha a linha. E a unica fonte que responde',
    '                  "essa classe/membro existe mesmo" sem rede.',
    `  skills/         ${skillCount} skills oficiais + references, publicadas pelo`,
    '                  proprio pacote. Sao a descricao que o upstream faz da',
    '                  propria API, versionada junto com a biblioteca.',
    '',
    'COMO REGENERAR',
    '  npm install --prefix tools/pixi-reference          # respeita o pin',
    '  npm run vendor  --prefix tools/pixi-reference',
    '',
    'COMO CONFERIR',
    '  node tools/pixi-reference/scripts/vendor-types.mjs --check',
    '',
    'REGRA',
    '  Este diretorio e gerado. Editar um arquivo aqui a mao quebra o --check',
    '  de proposito: um vendor editado nao vale como proveniencia de nada.',
    '  Para subir de versao, mude o pin, regenere, e trate cada erro que',
    '  aparecer como item do changelog.',
    '',
  ].join('\n'),
);

console.log(
  `${GREEN}vendorizado${RESET} pixi.js ${version}\n` +
    `  pixi-api.d.ts   ${dtsLines} linhas\n` +
    `  skills/         ${skillCount} skills, ${Object.keys(files).length - 1} arquivos\n` +
    `  manifest.json   ${Object.keys(files).length} hashes`,
);
