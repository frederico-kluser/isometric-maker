#!/usr/bin/env node
/**
 * Bootstrap gate runner.
 *
 * An agent stops when work "looks done". This script is the alternative signal:
 * each phase has criteria that either hold or do not, checked against files on
 * disk rather than against the agent's memory of what it wrote.
 *
 * The Stop hook calls this, and so does the agent at every phase boundary. A
 * phase may only be flipped to done+gate_passed in .bootstrap-state.json after
 * its check here returns green.
 *
 * Run:  node .agents/skills/scripts/validate-bootstrap.mjs [--phase N] [--flip]
 * Exit: 0 all requested gates green · 1 at least one red
 */
import { readFileSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  SKILLS_DIR, REPO_ROOT, EVALS_DIR, listSkills, skillPath, parseSkill,
  extractCitations, checkCitation, readJson, RED, GREEN, DIM, RESET,
} from './lib.mjs';

const STATE = join(SKILLS_DIR, '.bootstrap-state.json');

const args = process.argv.slice(2);
const onlyPhase = args.includes('--phase') ? Number(args[args.indexOf('--phase') + 1]) : null;
const flip = args.includes('--flip');

const problems = [];
const need = (cond, msg) => { if (!cond) problems.push(msg); return cond; };

function readIf(p) {
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

function runQuiet(cmd, cmdArgs, cwd = REPO_ROOT) {
  try {
    execFileSync(cmd, cmdArgs, { cwd, stdio: 'pipe', encoding: 'utf8' });
    return { ok: true };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() };
  }
}

// ---------------------------------------------------------------- phase 1
function gate1() {
  const p = join(SKILLS_DIR, 'project-analysis.md');
  const text = readIf(p);
  if (!need(text, 'phase 1: project-analysis.md ausente')) return;

  need(/##\s*1\.\s*Normative grounding/i.test(text),
    'phase 1: falta a seção de grounding normativo');
  need(/##\s*2\.\s*What is already guaranteed by tooling/i.test(text),
    'phase 1: falta a lista de convenções já garantidas por ferramenta');
  need(/##\s*4\.\s*Candidate knowledge areas/i.test(text),
    'phase 1: falta a lista de áreas candidatas de conhecimento');
  need(/not found/i.test(text),
    'phase 1: nenhuma declaração explícita de "not found"');

  const cites = extractCitations(text);
  need(cites.length >= 10,
    `phase 1: só ${cites.length} citação(ões) de proveniência (mínimo 10)`);
  for (const c of cites) {
    const r = checkCitation(c);
    if (r.level === 'error') problems.push(`phase 1: proveniência quebrada — ${r.msg}`);
  }
}

// ---------------------------------------------------------------- phase 2
function gate2() {
  const p = join(SKILLS_DIR, 'skill-map.md');
  const text = readIf(p);
  if (!need(text, 'phase 2: skill-map.md ausente')) return;

  need(/verification[_ ]signal/i.test(text),
    'phase 2: o mapa não declara sinal de verificação por skill');
  need(/##.*(graph|grafo|composition|dependenc)/i.test(text),
    'phase 2: falta o grafo de dependência/composição');
  need(/##.*(granularit|granularid)/i.test(text),
    'phase 2: granularidade não justificada');
  need(/project-router/.test(text), 'phase 2: o mapa não inclui o project-router');
  need(/meta-skill-evolution/.test(text), 'phase 2: o mapa não inclui meta-skill-evolution');
  need(/meta-skill-consolidate/.test(text), 'phase 2: o mapa não inclui meta-skill-consolidate');
}

// ---------------------------------------------------------------- phase 3
function gate3() {
  need(existsSync(join(REPO_ROOT, '.claude', 'skills')) &&
       lstatSync(join(REPO_ROOT, '.claude', 'skills')).isSymbolicLink(),
    'phase 3: .claude/skills não é symlink para .agents/skills');

  const skills = listSkills();
  need(skills.length >= 5, `phase 3: só ${skills.length} skill(s) geradas`);

  const lint = runQuiet('node', [join(SKILLS_DIR, 'scripts', 'lint-skills.mjs')]);
  need(lint.ok, `phase 3: lint-skills falhou\n${lint.out ?? ''}`);

  const catalog = readIf(join(SKILLS_DIR, 'catalog.md'));
  if (need(catalog, 'phase 3: catalog.md ausente')) {
    for (const s of skills) {
      need(catalog.includes(s), `phase 3: catalog.md não lista a skill "${s}"`);
    }
  }
}

// ---------------------------------------------------------------- phase 4
function gate4() {
  const settingsPath = join(REPO_ROOT, '.claude', 'settings.json');
  const settings = readJson(settingsPath);
  if (!need(settings, 'phase 4: .claude/settings.json ausente ou inválido')) return;

  const hooks = settings.hooks ?? {};
  need(Array.isArray(hooks.PreToolUse) && hooks.PreToolUse.length >= 2,
    'phase 4: faltam entradas PreToolUse (write-gate + security)');
  need(Array.isArray(hooks.Stop) && hooks.Stop.length >= 1,
    'phase 4: falta a entrada Stop (bootstrap gate)');

  for (const h of ['guard-skill-write.mjs', 'guard-bootstrap-stop.mjs', 'guard-security.mjs']) {
    need(existsSync(join(REPO_ROOT, '.claude', 'hooks', h)), `phase 4: hook ${h} ausente`);
  }

  for (const s of listSkills()) {
    const { front, body } = parseSkill(readFileSync(skillPath(s), 'utf8'));
    if (front?.metadata?.type === 'task') {
      need(/##\s*<evolution>/.test(body), `phase 4: task skill "${s}" sem seção <evolution>`);
    }
    need(existsSync(join(EVALS_DIR, `${s}.json`)), `phase 4: skill "${s}" sem suíte de eval`);
  }

  for (const s of ['meta-skill-evolution', 'meta-skill-consolidate', 'project-router']) {
    need(existsSync(skillPath(s)), `phase 4: skill obrigatória "${s}" ausente`);
  }

  const evals = runQuiet('node', [join(SKILLS_DIR, 'scripts', 'run-skill-evals.mjs')]);
  need(evals.ok, `phase 4: suíte de evals falhou\n${evals.out ?? ''}`);

  // Hooks are captured at session start, so "installed" is not the same as
  // "works". Firing real payloads at them is what proves the enforcement.
  const hookTests = runQuiet('node', [join(SKILLS_DIR, 'scripts', 'test-hooks.mjs')]);
  need(hookTests.ok, `phase 4: os hooks não bloquearam o que deveriam\n${hookTests.out ?? ''}`);
}

// ---------------------------------------------------------------- phase 5
function gate5() {
  const p = join(SKILLS_DIR, 'validation-report.md');
  const text = readIf(p);
  if (!need(text, 'phase 5: validation-report.md ausente')) return;

  const required = [
    [/routing eval/i, 'evidência de evals de roteamento'],
    [/accept/i, 'o caso de evolução ACEITA'],
    [/(reject|block)/i, 'o caso de evolução BLOQUEADA por falta de sinal externo'],
    [/regress/i, 'o caso de regressão DESCARTADA'],
    [/TASK_PLAN\.md/, 'o ciclo de vida do TASK_PLAN.md'],
  ];
  for (const [re, what] of required) {
    need(re.test(text), `phase 5: relatório não demonstra ${what}`);
  }
}

// ---------------------------------------------------------------- run
const GATES = { 1: gate1, 2: gate2, 3: gate3, 4: gate4, 5: gate5 };
const toRun = onlyPhase ? [onlyPhase] : [1, 2, 3, 4, 5];

for (const n of toRun) {
  const before = problems.length;
  GATES[n]();
  const failed = problems.length - before;
  console.log(`${failed === 0 ? GREEN + 'PASS' : RED + 'FAIL'}${RESET} gate ${n}`);
}

if (problems.length > 0) {
  console.log(`\n${RED}${problems.length} problema(s):${RESET}`);
  for (const m of problems) console.log(`  · ${m}`);
  process.exit(1);
}

if (flip && onlyPhase) {
  const state = readJson(STATE);
  const phase = state?.phases?.find((x) => x.id === onlyPhase);
  if (phase) {
    phase.done = true;
    phase.gate_passed = true;
    state.updated_by = execFileSync('git', ['rev-parse', '--short', 'HEAD'],
      { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    if (state.phases.every((x) => x.done && x.gate_passed)) state.mission_complete = true;
    writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);
    console.log(`${DIM}state: phase ${onlyPhase} -> done, gate_passed${RESET}`);
  }
}

console.log(`\n${GREEN}todos os gates pedidos estão verdes${RESET}`);
process.exit(0);
