#!/usr/bin/env node
/**
 * Verification signal for every PixiJS skill in this repository.
 *
 * The sibling of check-spec-claims.mjs, and it exists for a sharper reason.
 * PixiJS v8 did not add to v7, it replaced parts of it: `BaseTexture` became
 * `TextureSource`, `beginFill`/`endFill` became `fill()`, the `Application`
 * constructor stopped doing the work that `init()` now does. Both APIs are
 * heavily represented in training data, so PixiJS knowledge recalled without a
 * check is a blend of two APIs that does not run — and it fails in the browser,
 * not at the point where it was written.
 *
 * Worse: v8 kept the v7 methods as `@deprecated` shims. `Graphics.beginFill` is
 * still declared. So v7 code typechecks clean, and an existence-only gate would
 * bless a skill that teaches v7. Deprecation is therefore a failure here.
 *
 * What is checked, and what is deliberately not
 * --------------------------------------------
 *   checked  `PascalCase` in prose ....... must be a live top-level declaration
 *   checked  `Type.member` in prose ...... must resolve, and not be deprecated
 *   checked  `new Type(` in ts fences .... the class must exist
 *   checked  `Type.method(` in ts fences . the member must resolve
 *   checked  vendor/skills/<n>/SKILL.md .. the cited upstream skill must exist
 *   checked  "pixi.js X.Y.Z" ............. must match the vendored manifest
 *   checked  vendor integrity ............ delegated to vendor-types.mjs --check
 *
 *   NOT checked: instance-level calls (`app.init`, `sprite.anchor`). The
 *   receiver's type is not recoverable from text, and guessing it would produce
 *   confident false failures — the exact defect this script exists to prevent.
 *   Lookups that end at a mapped type are reported as gaps, not as verdicts.
 *
 * Run:  node .agents/skills/scripts/check-pixi-claims.mjs
 * Exit: 0 every claim resolves · 1 at least one does not
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  REPO_ROOT, SKILLS_DIR, listSkills, skillPath, parseSkill, RED, GREEN, YELLOW, DIM, RESET,
} from './lib.mjs';
import {
  vendorPaths, loadIndex, findMember, deprecationOf, primaryDecl, blocksFor,
} from './pixi-index.mjs';

const P = vendorPaths(REPO_ROOT);

/**
 * Names that are not PixiJS symbols and never will be: language and platform
 * globals, plus the proper nouns this repo writes in code font. Explicit rather
 * than inferred, so that adding one is a visible decision.
 */
const ALLOW = new Set([
  'Math', 'JSON', 'Object', 'Array', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise',
  'Number', 'String', 'Boolean', 'Date', 'Error', 'Symbol', 'RegExp', 'Proxy', 'Reflect',
  'ArrayBuffer', 'Float32Array', 'Float64Array', 'Uint8Array', 'Uint16Array', 'Uint32Array',
  'Int8Array', 'Int16Array', 'Int32Array', 'BigInt', 'Intl', 'Infinity', 'NaN', 'Function',
  'Window', 'Document', 'Image', 'Audio', 'Worker', 'Blob', 'Event', 'CustomEvent',
  'HTMLElement', 'HTMLCanvasElement', 'HTMLImageElement', 'HTMLVideoElement', 'OffscreenCanvas',
  'ResizeObserver', 'IntersectionObserver', 'PerformanceObserver', 'AbortController',
  'TextEncoder', 'TextDecoder', 'DOMMatrix', 'Performance', 'Navigator', 'AbortSignal',
  'WebSocket', 'RequestAnimationFrame', 'DevTools',
  'PixiJS', 'PixelLab', 'TypeScript', 'JavaScript', 'WebGL', 'WebGPU', 'WebGL2', 'Vite',
  'Node', 'Cocos', 'Godot', 'Bevy', 'Tiled', 'Aseprite', 'TexturePacker', 'Chrome', 'Firefox',
  'Safari', 'Spector', 'Power', 'Abuse',
]);

/**
 * Symbols a skill may name precisely BECAUSE they are wrong.
 *
 * The v7 shims are the clearest thing to point at when explaining why "it
 * compiles" is not evidence of v8 — so a skill that teaches the rule has to be
 * able to quote the example. Same idea, and the same hazard, as the
 * DELIBERATE_V1 allowlist in scripts/check-docs.sh: it is kept short and
 * updated by hand, because an allowlist that grows freely turns this script
 * into decoration.
 *
 * Entries must be v7 names being cited AS v7. Anything a skill actually
 * recommends calling does not belong here.
 */
const DELIBERATE_LEGACY = new Set([
  'Graphics.beginFill',
  'Graphics.endFill',
  'Graphics.lineStyle',
  'Graphics.drawRect',
  'BaseTexture',
  'DisplayObject',
  'Loader',
  'Container.name',
  'Container.cacheAsBitmap',
  'Application.view',
]);

/** Only skills that declare this script as their signal are scanned. */
const OPT_IN = 'check-pixi-claims.mjs';

const idx = loadIndex(P.dts, P.manifest);
if (!idx) {
  console.error(
    `${RED}vendor do PixiJS ausente: ${P.dts}${RESET}\n` +
      `  npm install --prefix tools/pixi-reference && npm run vendor --prefix tools/pixi-reference`,
  );
  process.exit(1);
}
const version = idx.manifest.pixiVersion ?? '?';

/* ------------------------------------------------------------ claim finders */

const FENCE = /```(?:ts|typescript|js|javascript)\n([\s\S]*?)```/g;
const INLINE = /`([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)`/g;
const NEW_CALL = /\bnew ([A-Z][A-Za-z0-9]+)\s*\(/g;
const STATIC_CALL = /\b([A-Z][A-Za-z0-9]{2,})\.([A-Za-z_$][\w$]*)\s*\(/g;
const UPSTREAM_REF = /vendor\/skills\/([a-z0-9-]+)\//g;
/**
 * A bare upstream skill name in code font, e.g. `pixijs-events`.
 *
 * The routing table is a list of these, and a misspelt one fails silently: the
 * router points at a skill nobody can open, and the agent proceeds without the
 * knowledge it was supposed to load. Cheap to check, so it is checked.
 */
const UPSTREAM_NAME = /`(pixijs(?:-[a-z0-9]+)*)`/g;
const VERSION_CLAIM = /pixi\.js[@ ]v?(\d+\.\d+\.\d+)/gi;

const isAcronym = (s) => !/[a-z]/.test(s);
const isPascal = (s) => /^[A-Z][A-Za-z0-9]+$/.test(s) && !isAcronym(s) && !ALLOW.has(s);

const problems = [];
const stats = { symbols: 0, members: 0, code: 0, upstream: 0, versions: 0, files: 0, gaps: 0, legacy: 0 };

function checkType(name, where, how) {
  if (!isPascal(name)) return false;
  if (DELIBERATE_LEGACY.has(name)) { stats.legacy += 1; return false; }
  stats.symbols += 1;
  const d = primaryDecl(idx, name);
  if (!d) {
    problems.push(`${where}: ${how} \`${name}\` não existe no PixiJS ${version} vendorizado`);
    return false;
  }
  const dep = deprecationOf(idx, d.start);
  if (dep) problems.push(`${where}: ${how} \`${name}\` está DEPRECADO — ${dep}`);
  return true;
}

function checkMember(type, member, where, how) {
  if (DELIBERATE_LEGACY.has(`${type}.${member}`)) { stats.legacy += 1; return; }
  if (!checkType(type, where, how)) return;
  stats.members += 1;
  const d = primaryDecl(idx, type);
  // A type alias, function or const has no member list to walk.
  if (d.kind === 'type' || d.kind === 'function' || d.kind === 'const') return;

  const { found, complete } = findMember(idx, type, member);
  if (found) {
    const dep = deprecationOf(idx, found.line);
    if (dep) {
      problems.push(
        `${where}: ${how} \`${type}.${member}\` existe mas está DEPRECADO — ${dep}` +
          (found.owner === type ? '' : ` (herdado de ${found.owner})`),
      );
    }
    return;
  }
  if (!complete) { stats.gaps += 1; return; }
  problems.push(`${where}: ${how} \`${type}.${member}\` — ${type} existe, "${member}" não`);
}

/* ----------------------------------------------------------------- the scan */

function filesFor(skill) {
  const out = [skillPath(skill)];
  const refs = join(SKILLS_DIR, skill, 'references');
  if (existsSync(refs)) {
    for (const f of readdirSync(refs).filter((f) => f.endsWith('.md'))) out.push(join(refs, f));
  }
  return out.filter(existsSync);
}

const scanned = [];
for (const skill of listSkills()) {
  const { front } = parseSkill(readFileSync(skillPath(skill), 'utf8'));
  if (!(front?.metadata?.verification_signal ?? '').includes(OPT_IN)) continue;
  scanned.push(skill);

  for (const file of filesFor(skill)) {
    stats.files += 1;
    const text = readFileSync(file, 'utf8');
    const rel = file.replace(`${REPO_ROOT}/`, '');

    // Prose claims. A fenced block holds no single-backtick spans, so this reads
    // prose only; fences are handled separately below.
    for (const m of text.matchAll(INLINE)) {
      // `PixiMixins.Container` is one name, not a member access: the mixin
      // index is keyed by the dotted form. Splitting it first would report the
      // merge mechanism a skill has to explain as if it did not exist.
      if (blocksFor(idx, m[1]) && m[1].startsWith('PixiMixins.')) { stats.symbols += 1; continue; }
      const [type, member] = m[1].split('.');
      if (member) checkMember(type, member, rel, 'citação');
      else checkType(type, rel, 'citação');
    }

    // Example code. The branch that matters most: a snippet naming a v7 class
    // reads as authoritative and gets copied verbatim into real code.
    for (const fence of text.matchAll(FENCE)) {
      for (const m of fence[1].matchAll(NEW_CALL)) {
        stats.code += 1;
        checkType(m[1], rel, 'exemplo: new');
      }
      for (const m of fence[1].matchAll(STATIC_CALL)) {
        if (!isPascal(m[1])) continue;
        stats.code += 1;
        checkMember(m[1], m[2], rel, 'exemplo:');
      }
    }

    for (const m of [...text.matchAll(UPSTREAM_REF), ...text.matchAll(UPSTREAM_NAME)]) {
      stats.upstream += 1;
      if (!existsSync(join(P.skills, m[1], 'SKILL.md'))) {
        problems.push(`${rel}: skill upstream \`${m[1]}\` não existe no vendor`);
      }
    }

    for (const m of text.matchAll(VERSION_CLAIM)) {
      stats.versions += 1;
      if (m[1] !== version) problems.push(`${rel}: cita pixi.js ${m[1]}, o vendor é ${version}`);
    }
  }
}

/* ---------------------------------------------------------- vendor integrity */

try {
  execFileSync(
    'node',
    [join(REPO_ROOT, 'tools', 'pixi-reference', 'scripts', 'vendor-types.mjs'), '--check'],
    { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' },
  );
} catch (err) {
  problems.push(`vendor íntegro? não — ${(err.stdout ?? err.message).trim().split('\n').join(' | ')}`);
}

/* --------------------------------------------------------------------- report */

if (scanned.length === 0) {
  console.log(`${YELLOW}nenhuma skill declara ${OPT_IN} como verification_signal${RESET}`);
  process.exit(0);
}

if (problems.length > 0) {
  console.log(`${RED}${problems.length} afirmação(ões) sem respaldo no vendor:${RESET}`);
  for (const p of problems) console.log(`  · ${p}`);
  console.log(
    `\n${DIM}Confira antes de afirmar:` +
      ` node .agents/skills/routing-pixijs-work/scripts/inspect-pixi.mjs exists <Nome>${RESET}`,
  );
  process.exit(1);
}

console.log(
  `${GREEN}ok${RESET} pixi.js ${version} · ${scanned.length} skill(s), ${stats.files} arquivo(s) · ` +
    `${stats.symbols} símbolo(s), ${stats.members} membro(s), ${stats.code} em exemplo, ` +
    `${stats.upstream} ref upstream, ${stats.versions} versão, ${stats.legacy} citação(ões) v7 ` +
    `deliberada(s) ${DIM}(${idx.decls.size} declarações no vendor)${RESET}`,
);
if (stats.gaps > 0) {
  console.log(
    `${YELLOW}${stats.gaps} claim(s) não verificável(is)${RESET} — herdam de um mapped type que só ` +
      `um type checker resolve. Não foram reprovados nem aprovados.`,
  );
}
process.exit(0);
