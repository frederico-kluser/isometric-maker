#!/usr/bin/env node
/**
 * PreToolUse hook — external-validation write gate on SKILL.md.
 *
 * This is the file that turns the project's central correctness rule from a
 * request into a guarantee: a skill's knowledge may not be REWRITTEN on the
 * model's own confidence. An LLM is an unreliable judge of its own errors, so
 * an objective signal external to it has to authorise the write.
 *
 * The gate deliberately distinguishes two very different acts:
 *   - CREATING a SKILL.md      -> allowed. A new file is a reviewable draft;
 *                                 git diff shows it whole and nothing is lost.
 *   - MODIFYING a SKILL.md     -> requires a fresh validation token, because
 *                                 this is the act that can silently overwrite
 *                                 correct knowledge with a plausible error and
 *                                 then propagate it to every future task that
 *                                 retrieves the skill.
 *
 * A token is produced only by an actual green eval run:
 *   node .agents/skills/scripts/run-skill-evals.mjs --skill <name> --write-token
 *
 * Tokens expire (TTL_MINUTES) so that "I validated this an hour and twelve
 * edits ago" cannot be laundered into authorisation for an unrelated change.
 *
 * Exit codes: 0 = allow, 2 = block (stderr is fed back to the agent).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(HERE, '..', '..'));
const TTL_MINUTES = 30;

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

const payload = readStdin();
const tool = payload.tool_name ?? '';
const filePath = payload.tool_input?.file_path ?? '';

if (!['Write', 'Edit', 'NotebookEdit'].includes(tool)) process.exit(0);
if (!filePath) process.exit(0);

const abs = resolve(filePath.startsWith('/') ? filePath : join(ROOT, filePath));

// Only skill bodies are gated. Everything else in the repo is ordinary work.
const isSkillBody = /(^|\/)skills\/[^/]+\/SKILL\.md$/.test(abs.replace(/\\/g, '/'));
if (!isSkillBody) process.exit(0);

// Creating a new skill is a draft for human review, not an evolution step.
if (!existsSync(abs)) process.exit(0);

const skill = basename(dirname(abs));
const tokenPath = join(ROOT, '.agents', 'skills', '.validation', `${skill}.json`);

function deny(reason) {
  console.error(
    `Blocked: modifying ${skill}/SKILL.md without external validation.\n` +
      `Reason: ${reason}\n\n` +
      `A skill body is memory. Rewriting it on the model's own judgement is how a ` +
      `plausible-but-wrong rule gets retrieved and amplified on every later task.\n\n` +
      `To proceed, produce the objective signal first:\n` +
      `  node .agents/skills/scripts/run-skill-evals.mjs --skill ${skill} --write-token\n\n` +
      `If the evals fail, the change is not authorised — discard it (promote-or-discard).`,
  );
  process.exit(2);
}

if (!existsSync(tokenPath)) deny('no validation token found');

let token;
try {
  token = JSON.parse(readFileSync(tokenPath, 'utf8'));
} catch (err) {
  deny(`validation token unreadable (${err.message})`);
}

if (token.ok !== true) deny('validation token records a FAILED eval run');

const ageMs = Date.now() - Date.parse(token.at ?? 0);
if (!Number.isFinite(ageMs)) deny('validation token has no usable timestamp');
if (ageMs > TTL_MINUTES * 60_000) {
  deny(`validation token is stale (${Math.round(ageMs / 60_000)} min old, TTL ${TTL_MINUTES} min)`);
}

process.exit(0);
