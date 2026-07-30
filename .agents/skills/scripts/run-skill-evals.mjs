#!/usr/bin/env node
/**
 * Skill eval runner — and the only thing that mints a validation token.
 *
 * Three checks per skill, each deterministic:
 *
 * 1. ROUTING. A skill's `description` is the entire signal the selector sees at
 *    dispatch time. So the eval measures vocabulary overlap between a realistic
 *    query and that description. A must-trigger case with no overlap means the
 *    description lacks the words a real request would use; a must-NOT-trigger
 *    case with high overlap means the description is broad enough to steal
 *    traffic from a sibling skill. Both are defects in the routing signal, and
 *    both are catchable without a model in the loop.
 *
 *    Queries in this repo arrive in Portuguese while skill bodies are English,
 *    so a description that omits Portuguese trigger phrases fails routing here.
 *    That pressure is deliberate: it is what keeps the descriptions usable.
 *
 * 2. INVARIANTS. Substrings that must survive in the body. This is the
 *    regression gate — if an evolution edit deletes a load-bearing constraint,
 *    the eval flips red and the change is discarded rather than promoted.
 *
 * 3. PROVENANCE. Every `file:line@hash` citation must resolve. A missing file
 *    or out-of-range line fails; a changed hash only warns, because otherwise
 *    every edit to a cited file would break every skill that cites it.
 *
 * Run:   node .agents/skills/scripts/run-skill-evals.mjs [--skill NAME] [--write-token]
 * Exit:  0 all green · 1 at least one failure
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  EVALS_DIR, VALIDATION_DIR, REPO_ROOT, listSkills, skillPath, parseSkill,
  extractCitations, checkCitation, readJson, RED, GREEN, YELLOW, DIM, RESET,
} from './lib.mjs';

/**
 * Run the skill's own declared verification_signal.
 *
 * Without this the runner could mint a green token while the signal the skill
 * itself names as authoritative was failing — a token that says "verified"
 * about something nobody verified, which is the precise failure the write gate
 * exists to prevent.
 *
 * Two guards:
 *   - Recursion. The meta-skills declare this very script as their signal, so a
 *     nested run would not terminate. The env flag makes the inner run skip the
 *     signal step instead of spawning another one.
 *   - Non-executable signals. `enforcing-server-authority` declares "explicit
 *     user confirmation", which no script can check. Those are reported as
 *     manual rather than silently treated as passed.
 */
const EXECUTABLE = /^\s*(cd|node|npm|npx|bash|sh|git|make|python3?)\b/;

function runDeclaredSignal(signal) {
  if (!signal) return { kind: 'none' };
  if (!EXECUTABLE.test(signal)) return { kind: 'manual', signal };
  if (process.env['SKILL_EVAL_NESTED'] === '1') return { kind: 'skipped-nested', signal };

  const r = spawnSync('sh', ['-c', signal], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, SKILL_EVAL_NESTED: '1' },
  });
  return {
    kind: r.status === 0 ? 'pass' : 'fail',
    signal,
    out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-6).join('\n'),
  };
}

/**
 * Words too common to carry routing signal, in both languages the repo uses.
 * Kept short on purpose: an aggressive stoplist would hide genuine overlap and
 * turn the routing check into a rubber stamp.
 */
const STOP = new Set([
  // pt-BR
  'para', 'como', 'esse', 'essa', 'este', 'esta', 'isso', 'aqui', 'onde', 'quando',
  'pelo', 'pela', 'dos', 'das', 'com', 'sem', 'que', 'uma', 'meu', 'minha', 'quero',
  'preciso', 'fazer', 'faz', 'usar', 'usa', 'sobre', 'depois', 'antes', 'muito',
  // en
  'the', 'this', 'that', 'with', 'without', 'from', 'into', 'when', 'whenever',
  'what', 'which', 'about', 'after', 'before', 'have', 'has', 'use', 'used', 'using',
  'and', 'for', 'not', 'are', 'was', 'you', 'your', 'its', 'it',
]);

const MIN_WORD = 4;

function words(s) {
  return new Set(
    s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')  // fold accents: "geração" ~ "geracao"
      // Hyphens split too: a query saying "tileset" must reach a description
      // that says "create-tileset", and one saying "spec" must reach
      // "inspect-spec". Keeping compounds whole would make most real queries
      // miss on vocabulary they visibly share.
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= MIN_WORD && !STOP.has(w)),
  );
}

/**
 * Overlap counts a query word as matched when it appears in the description, or
 * when it is a prefix of a description word (or vice versa) of at least
 * MIN_WORD characters. The prefix rule is what lets "geração"/"gerar"/"gera"
 * all match a description that says "gerar", without pulling in a stemmer.
 */
function overlap(queryWords, descWords) {
  const hits = [];
  for (const q of queryWords) {
    for (const d of descWords) {
      if (q === d || (q.length >= MIN_WORD && d.startsWith(q)) || (d.length >= MIN_WORD && q.startsWith(d))) {
        hits.push(q);
        break;
      }
    }
  }
  return hits;
}

const argv = process.argv.slice(2);
const only = argv.includes('--skill') ? argv[argv.indexOf('--skill') + 1] : null;
const writeToken = argv.includes('--write-token');
const verbose = argv.includes('--verbose');

const skills = only ? [only] : listSkills();
let anyFailed = false;
const results = [];

for (const skill of skills) {
  const failures = [];
  const warnings = [];

  const sp = skillPath(skill);
  if (!existsSync(sp)) {
    failures.push('SKILL.md não existe');
    results.push({ skill, failures, warnings });
    anyFailed = true;
    continue;
  }

  const { front, body } = parseSkill(readFileSync(sp, 'utf8'));
  const desc = front?.description ?? '';
  const evalPath = join(EVALS_DIR, `${skill}.json`);
  const spec = readJson(evalPath);

  if (!spec) {
    failures.push(`suíte de eval ausente em evals/${skill}.json`);
  } else {
    const minOverlap = spec.min_overlap ?? 2;
    const descWords = words(desc);

    // 1. routing
    for (const c of spec.routing ?? []) {
      const hits = overlap(words(c.query), descWords);
      const triggers = hits.length >= minOverlap;
      if (triggers !== c.should_trigger) {
        failures.push(
          c.should_trigger
            ? `routing: "${c.query}" deveria disparar mas só casou ${hits.length}/${minOverlap} termo(s) ` +
              `[${hits.join(', ') || '—'}] — a description não tem o vocabulário do pedido`
            : `routing: "${c.query}" NÃO deveria disparar mas casou ${hits.length} termo(s) ` +
              `[${hits.join(', ')}] — a description está larga demais`,
        );
      } else if (verbose) {
        console.log(`${DIM}    ${c.should_trigger ? '✓' : '✗'} "${c.query}" → ${hits.length} [${hits.join(', ')}]${RESET}`);
      }
    }

    // 2. invariants (the regression gate)
    for (const inv of spec.invariants ?? []) {
      if (!body.includes(inv.must_contain)) {
        failures.push(`invariante perdida: "${inv.must_contain}" — ${inv.why}`);
      }
    }

    // 3. provenance
    if (spec.check_provenance !== false) {
      const cites = extractCitations(body);
      for (const c of cites) {
        const r = checkCitation(c);
        if (r.level === 'error') failures.push(`proveniência: ${r.msg}`);
        else if (r.level === 'stale') warnings.push(`proveniência stale: ${r.msg}`);
      }
    }
  }

  // 4. the skill's own declared verification signal
  const sig = runDeclaredSignal(front?.metadata?.verification_signal);
  if (sig.kind === 'fail') {
    failures.push(`verification_signal falhou: \`${sig.signal}\`\n      ${sig.out.replace(/\n/g, '\n      ')}`);
  } else if (sig.kind === 'manual') {
    warnings.push(`verification_signal é manual e não pode ser checado por script: "${sig.signal}"`);
  } else if (sig.kind === 'skipped-nested') {
    warnings.push('verification_signal não executado (execução aninhada, evitando recursão)');
  } else if (sig.kind === 'none') {
    warnings.push('nenhum verification_signal declarado');
  }

  results.push({ skill, failures, warnings, manualSignal: sig.kind === 'manual' });
  if (failures.length > 0) anyFailed = true;

  // A token is the artifact the write-gate hook looks for. It is only written
  // for a skill that actually came back green — writing one on failure would
  // turn the gate into decoration.
  if (writeToken && only === skill) {
    mkdirSync(VALIDATION_DIR, { recursive: true });
    writeFileSync(
      join(VALIDATION_DIR, `${skill}.json`),
      `${JSON.stringify({
        skill,
        ok: failures.length === 0,
        at: new Date().toISOString(),
        // Surfaced so the write gate can tell the human that nothing automated
        // stands behind this skill's authorisation.
        manual_signal: sig.kind === 'manual',
        failures,
      }, null, 2)}\n`,
    );
  }
}

for (const r of results) {
  const mark = r.failures.length === 0 ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
  console.log(`${mark} ${r.skill}`);
  for (const f of r.failures) console.log(`  ${RED}·${RESET} ${f}`);
  for (const w of r.warnings) console.log(`  ${YELLOW}·${RESET} ${w}`);
}

const failed = results.filter((r) => r.failures.length > 0).length;
console.log(
  `\n${anyFailed ? RED : GREEN}${results.length} skill(s) · ${failed} com falha${RESET}`,
);

if (writeToken) {
  console.log(
    anyFailed
      ? `${RED}token NÃO autoriza escrita — evals vermelhos${RESET}`
      : `${GREEN}token gravado em .agents/skills/.validation/${only}.json (TTL 30 min)${RESET}`,
  );
}

process.exit(anyFailed ? 1 : 0);
