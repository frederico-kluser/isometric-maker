/**
 * Shared helpers for the skill tooling.
 *
 * Deliberately dependency-free: these scripts are the enforcement layer, and an
 * enforcement layer that needs `npm install` to run is one `rm -rf node_modules`
 * away from silently not enforcing anything. Node 24 built-ins only.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
export const SKILLS_DIR = resolve(SCRIPTS_DIR, '..');
export const REPO_ROOT = resolve(SKILLS_DIR, '..', '..');
export const EVALS_DIR = join(SKILLS_DIR, 'evals');
export const VALIDATION_DIR = join(SKILLS_DIR, '.validation');

/** Directories under .agents/skills/ that are tooling, not skills. */
const NOT_A_SKILL = new Set(['scripts', 'evals', 'references', '.validation']);

export function listSkills() {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !NOT_A_SKILL.has(d.name) && !d.name.startsWith('.'))
    .map((d) => d.name)
    .filter((name) => existsSync(join(SKILLS_DIR, name, 'SKILL.md')))
    .sort();
}

export function skillPath(name) {
  return join(SKILLS_DIR, name, 'SKILL.md');
}

/**
 * Minimal YAML front-matter reader.
 *
 * Only the shapes the skill template actually uses: top-level `key: value` and
 * a one-level-deep `metadata:` block. A full YAML parser would be a dependency,
 * and the linter enforcing "frontmatter contains ONLY name + description +
 * metadata" is precisely what keeps that sufficient.
 */
export function parseSkill(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { error: 'no YAML front matter delimited by --- on the first line' };

  const [, raw, body] = m;
  const front = {};
  const metadata = {};
  let inMetadata = false;

  for (const line of raw.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^metadata:\s*$/.test(line)) { inMetadata = true; front.metadata = metadata; continue; }
    const indented = /^\s+/.test(line);
    if (inMetadata && indented) {
      const kv = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
      if (kv) metadata[kv[1]] = stripQuotes(kv[2]);
      continue;
    }
    inMetadata = false;
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (kv) front[kv[1]] = stripQuotes(kv[2]);
  }

  return { front, body, keys: Object.keys(front) };
}

function stripQuotes(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Rough token estimate. Four characters per token is close enough to budget against. */
export function estimateTokens(text) {
  return Math.round(text.length / 4);
}

/** Current git blob hash of a file, shortened — the provenance staleness signal. */
export function blobHash(absPath) {
  try {
    return execFileSync('git', ['hash-object', '--', absPath], {
      cwd: REPO_ROOT, encoding: 'utf8',
    }).trim().slice(0, 8);
  } catch {
    return null;
  }
}

/**
 * Provenance citations look like `path/to/file.ts:123@2a45b362`.
 *
 * The line number is required because a citation without one cannot be checked
 * against anything, and the hash is required because without it a citation
 * cannot go stale — it would silently keep vouching for content that changed.
 */
// A trailing `-NN` range is accepted and the START line is what gets checked.
// Without the range branch a citation written as `file.md:55-74@hash` matched
// nothing at all and was silently unverified — worse than an obviously broken
// citation, because it looked checked.
const CITATION = /`([A-Za-z0-9._\/-]+\.[A-Za-z0-9]+):(\d+)(?:-\d+)?@([0-9a-f]{8})`/g;

export function extractCitations(body) {
  return [...body.matchAll(CITATION)].map((m) => ({
    raw: m[0], file: m[1], line: Number(m[2]), hash: m[3],
  }));
}

export function checkCitation(c) {
  const abs = join(REPO_ROOT, c.file);
  if (!existsSync(abs)) return { level: 'error', msg: `cited file does not exist: ${c.file}` };
  if (!statSync(abs).isFile()) return { level: 'error', msg: `citation target is not a file: ${c.file}` };

  const lines = readFileSync(abs, 'utf8').split('\n');
  if (c.line < 1 || c.line > lines.length) {
    return { level: 'error', msg: `${c.file} has ${lines.length} lines, citation points at ${c.line}` };
  }

  const current = blobHash(abs);
  if (current && current !== c.hash) {
    // Stale, not wrong: the file moved on. The consolidation skill revalidates
    // or retires the passage; failing the build here would make every unrelated
    // edit to a cited file break every skill that cites it.
    return { level: 'stale', msg: `${c.file} changed since citation (${c.hash} -> ${current})` };
  }
  return { level: 'ok' };
}

export function readJson(p, fallback = null) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
}

export const RESET = '\x1b[0m';
export const RED = '\x1b[31m';
export const GREEN = '\x1b[32m';
export const YELLOW = '\x1b[33m';
export const DIM = '\x1b[2m';
