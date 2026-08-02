#!/usr/bin/env node
/**
 * Stop hook — bootstrap completion gate.
 *
 * Blocks turn termination while the knowledge-skills bootstrap still has an
 * unfinished phase, so "complete the mission" is a deterministic guarantee
 * rather than a hope.
 *
 * Exit codes are the hook contract: 0 = allow stop, 2 = block and feed stderr
 * back to the agent.
 *
 * Three independent escape valves, because a Stop hook that cannot release is
 * worse than no Stop hook at all:
 *   1. `stop_hook_active` — Claude Code sets this when a Stop hook already
 *      forced a continuation. Honouring it is what prevents an infinite loop.
 *   2. `stop_attempts > MAX_ATTEMPTS` — a gate that stays red is a stuck gate;
 *      release with a report instead of spinning.
 *   3. missing state file — nothing to enforce.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const STATE = join(ROOT, '.agents', 'skills', '.bootstrap-state.json');
const MAX_ATTEMPTS = 3;

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

const payload = readStdin();

// Valve 1: never fight a continuation we already forced.
if (payload.stop_hook_active === true) process.exit(0);

// Valve 3: no state, no mission, no opinion.
if (!existsSync(STATE)) process.exit(0);

let state;
try {
  state = JSON.parse(readFileSync(STATE, 'utf8'));
} catch (err) {
  console.error(`bootstrap-stop: state file unreadable (${err.message}); allowing stop.`);
  process.exit(0);
}

if (state.mission_complete === true) process.exit(0);

const pending = (state.phases ?? []).filter((p) => !(p.done === true && p.gate_passed === true));

if (pending.length === 0) {
  state.mission_complete = true;
  writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);
  process.exit(0);
}

// Valve 2: a gate that will not go green must not hold the session hostage.
state.stop_attempts = (state.stop_attempts ?? 0) + 1;
writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);

if (state.stop_attempts > MAX_ATTEMPTS) {
  console.error(
    `bootstrap-stop: ${pending.length} phase(s) still open after ${MAX_ATTEMPTS} forced ` +
      `continuations. Releasing the turn so a human can look. Open: ` +
      `${pending.map((p) => `#${p.id} ${p.name}`).join(' | ')}`,
  );
  process.exit(0);
}

console.error(
  `Bootstrap incomplete — ${pending.length} phase(s) still open. Continue the mission ` +
    `instead of stopping.\n` +
    pending.map((p) => `  #${p.id} ${p.name} -> ${p.artifact}`).join('\n') +
    `\nA phase may only be flipped to done+gate_passed after its objective gate passes ` +
    `(node .agents/skills/scripts/validate-bootstrap.mjs).`,
);
process.exit(2);
