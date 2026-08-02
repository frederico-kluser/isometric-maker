#!/usr/bin/env node
/**
 * PreToolUse hook — secrets and destructive-command guardrail.
 *
 * Two things this repo cannot afford to lose accidentally:
 *   - PIXELLAB_SECRET, because every generated asset spends real money and a
 *     leaked token spends it for someone else;
 *   - git history and generated artifacts, because the whole evolution design
 *     assumes git is the audit trail and the rollback path.
 *
 * Hooks fire for subagent tool calls too, so this applies recursively.
 *
 * Exit codes: 0 = allow, 2 = block (stderr is fed back to the agent).
 */
import { readFileSync } from 'node:fs';

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

const payload = readStdin();
const tool = payload.tool_name ?? '';
const input = payload.tool_input ?? {};

function block(what, why) {
  console.error(`Blocked: ${what}\n${why}`);
  process.exit(2);
}

// ---- secret files -------------------------------------------------------
// .env.example is the documented template and carries no value; everything
// else named .env, and anything under secrets/, is off limits.
const SECRET_PATH = /(^|\/)(\.env(\.[A-Za-z0-9_-]+)?|secrets\/.*|.*\.pem|.*\.key)$/;
const SECRET_ALLOW = /(^|\/)\.env\.example$/;

if (['Read', 'Write', 'Edit', 'NotebookEdit'].includes(tool)) {
  const p = String(input.file_path ?? '');
  if (p && SECRET_PATH.test(p) && !SECRET_ALLOW.test(p)) {
    block(
      `${tool} on ${p}`,
      'Secret material must never enter the transcript or a commit. Use .env.example ' +
        'for shape, and read the value from process.env at runtime instead.',
    );
  }
}

// ---- dangerous shell ----------------------------------------------------
if (tool === 'Bash') {
  const cmd = String(input.command ?? '');

  const RULES = [
    [/\brm\s+(-[A-Za-z]*\s+)*-[A-Za-z]*[rR][A-Za-z]*f|\brm\s+(-[A-Za-z]*\s+)*-[A-Za-z]*f[A-Za-z]*[rR]/,
      'Recursive force-delete. Delete specific paths, or move them aside so the action is reversible.'],
    [/\bgit\s+push\b[^\n]*--force(?!-with-lease)/,
      'Force-push discards remote history. Use --force-with-lease, and only when the user asked.'],
    [/\bgit\s+reset\s+--hard\b/,
      'Hard reset destroys uncommitted work. Use git stash, or commit first.'],
    [/\bgit\s+(filter-branch|filter-repo)\b/,
      'History rewrite. This breaks the audit trail the evolution design depends on.'],
    [/\bgit\s+clean\s+[^\n]*-[A-Za-z]*f/,
      'git clean -f deletes untracked files, including artifacts not yet committed.'],
    [/\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(ba)?sh\b/,
      'Piping a download straight into a shell executes unreviewed remote code.'],
    [/\bchmod\s+(-[A-Za-z]+\s+)*777\b/,
      'World-writable permissions. Set the narrowest mode that works instead.'],
    [/>\s*\/dev\/(sd|nvme|disk)/,
      'Raw device write.'],
    [/\b(cat|less|more|head|tail|bat|xxd|strings)\b[^\n]*\.env(\s|$|[^.])/,
      'Reading .env through the shell bypasses the file guard above. The value belongs in process.env only.'],
    [/\bgit\s+add\b[^\n]*(\s|\/)\.env(\s|$)/,
      'Staging .env would commit the PixelLab token.'],
  ];

  for (const [re, why] of RULES) {
    if (re.test(cmd)) block(`Bash command matched a destructive pattern:\n  ${cmd}`, why);
  }
}

process.exit(0);
