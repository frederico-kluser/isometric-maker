#!/usr/bin/env node
/**
 * Deterministic skill linter.
 *
 * Every rule here exists because prose could not guarantee it. The authoring
 * conventions live in this file, not in a style document, so that "the skill is
 * well-formed" is a pass/fail signal instead of an opinion.
 *
 * Run:  node .agents/skills/scripts/lint-skills.mjs [skill-name]
 * Exit: 0 all clean · 1 at least one error
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  SKILLS_DIR, listSkills, skillPath, parseSkill, estimateTokens,
  extractCitations, checkCitation, RED, GREEN, YELLOW, DIM, RESET,
} from './lib.mjs';

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const MAX_BODY_LINES = 500;
const WARN_BODY_TOKENS = 5000;
const VALID_TYPES = new Set(['knowledge', 'task', 'router', 'meta']);
const ALLOWED_FRONT_KEYS = new Set(['name', 'description', 'metadata']);

/**
 * The authoring rule is gerund-form names, but the architecture also fixes three
 * names by contract (the router is looked up by name, and the two meta-skills are
 * referenced by name from the router and from every task skill's evolution step).
 * Renaming them to satisfy a naming rule would break the references, so they are
 * exempt by design rather than by oversight.
 */
const GERUND_EXEMPT = new Set(['project-router', 'meta-skill-evolution', 'meta-skill-consolidate']);

/** A description that never says when to use the skill is unroutable. */
const TRIGGER_HINTS = [/\buse\s+(this\s+)?when/i, /\buse\s+whenever/i, /\btriggers?\s+on\b/i];

/** Rule (d): the file holds state, git holds history. A date in the body is a changelog leaking in. */
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/;

const only = process.argv[2];
const skills = only ? [only] : listSkills();

let errors = 0;
let warnings = 0;

const err = (skill, msg) => { console.log(`  ${RED}ERRO${RESET} ${skill}: ${msg}`); errors += 1; };
const warn = (skill, msg) => { console.log(`  ${YELLOW}AVISO${RESET} ${skill}: ${msg}`); warnings += 1; };

if (skills.length === 0) {
  console.log(`${RED}nenhuma skill encontrada em ${SKILLS_DIR}${RESET}`);
  process.exit(1);
}

for (const skill of skills) {
  const p = skillPath(skill);
  if (!existsSync(p)) { err(skill, 'SKILL.md não existe'); continue; }

  const text = readFileSync(p, 'utf8');
  const { front, body, keys, error } = parseSkill(text);
  if (error) { err(skill, error); continue; }

  // ---- frontmatter shape (portability across Cursor/Codex/etc.) ----
  for (const k of keys) {
    if (!ALLOWED_FRONT_KEYS.has(k)) {
      err(skill, `frontmatter tem chave não portável "${k}" (só name, description, metadata)`);
    }
  }

  // ---- name ----
  const name = front.name ?? '';
  if (!name) err(skill, 'frontmatter sem "name"');
  else {
    if (name !== skill) err(skill, `name "${name}" difere do diretório "${skill}"`);
    if (name.length > MAX_NAME) err(skill, `name tem ${name.length} chars (máx ${MAX_NAME})`);
    if (!NAME_RE.test(name)) err(skill, `name "${name}" fora de [a-z0-9-]`);
    if (!GERUND_EXEMPT.has(name) && !/^[a-z0-9]*ing(-|$)/.test(name)) {
      err(skill, `name "${name}" não está em gerúndio (primeiro termo deve terminar em -ing)`);
    }
  }

  // ---- description ----
  const desc = front.description ?? '';
  if (!desc) err(skill, 'frontmatter sem "description"');
  else {
    if (desc.length > MAX_DESCRIPTION) {
      err(skill, `description tem ${desc.length} chars (máx ${MAX_DESCRIPTION})`);
    }
    if (!TRIGGER_HINTS.some((re) => re.test(desc))) {
      err(skill, 'description não diz QUANDO usar (falta "Use when/whenever" ou "Triggers on")');
    }
    if (/^\s*(I |You |We )/.test(desc)) {
      err(skill, 'description deve ser em terceira pessoa, não primeira/segunda');
    }
    if (desc.length < 80) warn(skill, `description curta (${desc.length} chars) — pode sub-disparar`);
  }

  // ---- metadata ----
  const meta = front.metadata ?? {};
  const type = meta.type;
  if (!type) err(skill, 'metadata.type ausente');
  else if (!VALID_TYPES.has(type)) err(skill, `metadata.type "${type}" inválido`);

  if (type && type !== 'router' && !meta.verification_signal) {
    err(skill, 'metadata.verification_signal ausente — sem sinal externo, nada autoriza evolução');
  }

  // ---- body budget (progressive disclosure) ----
  const bodyLines = body.split('\n').length;
  const tokens = estimateTokens(body);
  if (bodyLines > MAX_BODY_LINES) {
    err(skill, `body tem ${bodyLines} linhas (máx ${MAX_BODY_LINES}) — mova material para references/`);
  }
  if (tokens > WARN_BODY_TOKENS) {
    warn(skill, `body ~${tokens} tokens (alvo < ${WARN_BODY_TOKENS}) — considere references/`);
  }

  // ---- rule (d): clean state in file, history in git ----
  const dateLine = body.split('\n').findIndex((l) => ISO_DATE.test(l) && !/^\s*[-*]?\s*`/.test(l));
  if (dateLine >= 0) {
    err(skill, `data ISO no body (linha ${dateLine + 1}) — histórico é do git, não do arquivo`);
  }

  // ---- evolution step is mandatory for task skills ----
  if (type === 'task' && !/##\s*<evolution>/.test(body)) {
    err(skill, 'task skill sem seção "## <evolution>"');
  }

  // ---- provenance ----
  const citations = extractCitations(body);
  if ((type === 'knowledge' || type === 'task') && citations.length === 0) {
    err(skill, 'nenhuma citação de proveniência `file:line@hash` no body');
  }
  for (const c of citations) {
    const r = checkCitation(c);
    if (r.level === 'error') err(skill, `proveniência: ${r.msg}`);
    else if (r.level === 'stale') warn(skill, `proveniência stale (revalidar): ${r.msg}`);
  }

  // ---- references/ table of contents ----
  const refDir = join(SKILLS_DIR, skill, 'references');
  if (existsSync(refDir)) {
    for (const f of readdirSync(refDir).filter((f) => f.endsWith('.md'))) {
      const rtext = readFileSync(join(refDir, f), 'utf8');
      const rlines = rtext.split('\n').length;
      if (rlines > 100 && !/^##\s+(Sumário|Índice|Contents|Table of contents)/im.test(rtext)) {
        err(skill, `references/${f} tem ${rlines} linhas e não tem sumário`);
      }
    }
  }

  const status = errors === 0 ? GREEN : DIM;
  console.log(`${status}·${RESET} ${skill} ${DIM}(${type ?? '?'}, ${bodyLines}L, ~${tokens}tok, ${citations.length} cit)${RESET}`);
}

console.log(
  `\n${errors === 0 ? GREEN : RED}${skills.length} skill(s) · ${errors} erro(s) · ${warnings} aviso(s)${RESET}`,
);
process.exit(errors > 0 ? 1 : 0);
