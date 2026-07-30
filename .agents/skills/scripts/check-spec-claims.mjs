#!/usr/bin/env node
/**
 * Verification signal for `querying-pixellab-api`.
 *
 * The repo's hardest rule is that nobody writes about the PixelLab API from
 * memory, because the API changes without versioning (`info.version` is
 * literally "dev"). A rule like that cannot be enforced by asking nicely: a
 * skill that confidently states a wrong endpoint name is exactly the
 * plausible-but-false memory the whole architecture is built to keep out.
 *
 * So every endpoint path and every named enum a skill asserts is checked
 * against the vendored spec, the same way scripts/check-docs.sh already does it
 * for docs/. If a claim does not resolve, the skill cannot be validated, and
 * without validation the write gate will not let it be updated.
 *
 * Run:  node .agents/skills/scripts/check-spec-claims.mjs
 * Exit: 0 every claim resolves · 1 at least one does not
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, SKILLS_DIR, listSkills, RED, GREEN, DIM, RESET } from './lib.mjs';

const SPEC = join(REPO_ROOT, 'tools', 'pixellab-pipeline', 'openapi', 'openapi-v2.json');

/**
 * Paths a skill may name precisely because they no longer exist — the v1 names
 * are quoted to document what changed. Same idea as the DELIBERATE_V1 allowlist
 * in scripts/check-docs.sh, and kept in sync with it by hand.
 */
const DELIBERATE_ABSENT = new Set([
  '/generate-image-pixflux',
  '/generate-image-bitforge',
  '/animate-skeleton',
  '/generate-image-v1',
]);

if (!existsSync(SPEC)) {
  console.error(`${RED}spec vendorizado não encontrado em ${SPEC}${RESET}`);
  process.exit(1);
}

const spec = JSON.parse(readFileSync(SPEC, 'utf8'));
const normalise = (p) => p.replace(/\{[a-z_]+\}/g, '{X}');
const knownPaths = new Set(Object.keys(spec.paths).map(normalise));

/** Named top-level enums, e.g. CameraView -> Set of allowed values. */
const knownEnums = new Map();
for (const [name, schema] of Object.entries(spec.components?.schemas ?? {})) {
  if (Array.isArray(schema.enum)) knownEnums.set(name, new Set(schema.enum));
}

// Backticked path that looks like an API route, not a filesystem path.
const PATH_RE = /`(\/[a-z0-9][a-z0-9\-{}_]*(?:\/[a-z0-9\-{}_]+)*)`/g;
// A skill asserting an enum's contents: `CameraView` = a, b, c
const ENUM_RE = /`([A-Z][A-Za-z0-9]+)`\s*=\s*([^\n]+)/g;

function filesFor(skill) {
  const out = [join(SKILLS_DIR, skill, 'SKILL.md')];
  const refs = join(SKILLS_DIR, skill, 'references');
  if (existsSync(refs)) {
    for (const f of readdirSync(refs).filter((f) => f.endsWith('.md'))) out.push(join(refs, f));
  }
  return out.filter(existsSync);
}

const problems = [];
let pathsChecked = 0;
let enumsChecked = 0;

for (const skill of listSkills()) {
  for (const file of filesFor(skill)) {
    const text = readFileSync(file, 'utf8');
    const rel = file.replace(`${REPO_ROOT}/`, '');

    for (const m of text.matchAll(PATH_RE)) {
      const p = m[1];
      // Filesystem paths and repo-relative references are not API claims.
      if (p.startsWith('/home/') || p.includes('.') || DELIBERATE_ABSENT.has(p)) continue;
      pathsChecked += 1;
      if (!knownPaths.has(normalise(p))) {
        problems.push(`${rel}: endpoint \`${p}\` não existe no spec vendorizado`);
      }
    }

    for (const m of text.matchAll(ENUM_RE)) {
      const [, name, rhs] = m;
      if (!knownEnums.has(name)) continue;   // not a spec enum; nothing to check
      enumsChecked += 1;
      const allowed = knownEnums.get(name);
      const claimed = rhs
        .split(/[,|]/)
        // Strip markdown emphasis and the sentence punctuation that trails the
        // last value when the claim is written as prose rather than a list.
        // No enum value in this spec contains `.`, `;` or `:`.
        .map((s) => s.replace(/[`*_]/g, '').replace(/[.;:]+\s*$/, '').trim())
        .filter((s) => s && !/^\(/.test(s) && s !== '…' && s !== '...');
      for (const v of claimed) {
        if (!allowed.has(v)) {
          problems.push(
            `${rel}: \`${name}\` não aceita "${v}" — valores reais: ${[...allowed].join(', ')}`,
          );
        }
      }
    }
  }
}

if (problems.length > 0) {
  console.log(`${RED}${problems.length} afirmação(ões) sem respaldo no spec:${RESET}`);
  for (const p of problems) console.log(`  · ${p}`);
  process.exit(1);
}

console.log(
  `${GREEN}ok${RESET} ${pathsChecked} endpoint(s) e ${enumsChecked} enum(s) citados existem no spec ` +
    `${DIM}(${knownPaths.size} paths, ${knownEnums.size} enums nomeados)${RESET}`,
);
process.exit(0);
