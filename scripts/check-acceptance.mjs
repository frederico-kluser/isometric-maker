#!/usr/bin/env node

// scripts/check-acceptance.mjs — Node 24, zero dependencies.
// Verifica se os critérios de aceitação dos cards feitos são falsificáveis.
//
// Autoteste: node scripts/check-acceptance.mjs --self-test
// Validação:  node scripts/check-acceptance.mjs [caminho/para/plano.md]

import { readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

// ─── YAML parser mínimo (compatível com validate-plan.mjs) ────────────

function parseYamlBlock(text) {
  const lines = text.split('\n');
  const result = {};
  let currentKey = null;

  for (const rawLine of lines) {
    const commentIdx = rawLine.indexOf('#');
    const line = (commentIdx >= 0 ? rawLine.substring(0, commentIdx) : rawLine).trimEnd();
    if (!line.trim()) continue;

    // Block array continuation: "  - item"
    const arrayMatch = line.match(/^(\s+)-\s+(.*)$/);
    if (arrayMatch) {
      const indent = arrayMatch[1].length;
      const val = arrayMatch[2].trim();
      if (currentKey && indent === 2 && result[currentKey] !== undefined) {
        if (!Array.isArray(result[currentKey])) result[currentKey] = [];
        result[currentKey].push(val);
        continue;
      }
    }

    // Key: value
    const kvMatch = line.match(/^([\w][\w_]*)\s*:\s*(.*?)\s*$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const rawVal = kvMatch[2].trim();

      if (rawVal === '' || rawVal === '[]') {
        result[currentKey] = [];
      } else if (rawVal === 'true') {
        result[currentKey] = true;
      } else if (rawVal === 'false') {
        result[currentKey] = false;
      } else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
        const inner = rawVal.slice(1, -1).trim();
        result[currentKey] = inner ? inner.split(',').map(s => s.trim()).filter(s => s) : [];
      } else {
        result[currentKey] = rawVal;
      }
    }
  }

  return result;
}

function extractCards(planText) {
  const blocks = [];
  const regex = /```yaml\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(planText)) !== null) {
    const content = match[1];
    const firstKeyLine = content.split('\n').find(
      l => l.trim() && !l.trim().startsWith('#')
    );
    if (firstKeyLine && /^\w[\w_]*\s*:/.test(firstKeyLine)) {
      blocks.push(parseYamlBlock(content));
    }
  }

  return blocks;
}

// ─── Extrair critérios de aceitação ───────────────────────────────────

/**
 * Extrai comandos do bloco <criterios_aceitacao> dentro de um <task> XML.
 * Retorna array de strings, uma por linha de comando (linhas não vazias
 * que não sejam comentários puros).
 */
function extractCriteriosFromXml(planText, cardId) {
  // Procura o bloco <task id="CARD_ID" ...> ... </task>
  // com <criterios_aceitacao> dentro.
  const taskRegex = new RegExp(
    `<task\\s[^>]*\\bid\\s*=\\s*"${cardId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([\\s\\S]*?)</task>`,
    'i'
  );
  const taskMatch = taskRegex.exec(planText);
  if (!taskMatch) return null; // card sem bloco XML (infra, gate)

  const taskBody = taskMatch[1];
  const critRegex = /<criterios_aceitacao>\s*([\s\S]*?)\s*<\/criterios_aceitacao>/;
  const critMatch = critRegex.exec(taskBody);
  if (!critMatch) return [];

  const content = critMatch[1];
  const lines = content.split('\n');
  const commands = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Pula linhas que são apenas comentários
    if (trimmed.startsWith('#') && !trimmed.match(/^#\s*(falha|GUARD|controle|exit)/i)) {
      // Comentário inline (após comando) é mantido como parte da linha
      // Mas se a linha INTEIRA for um comentário, pula.
      continue;
    }
    commands.push(trimmed);
  }

  return commands;
}

/**
 * Para cards sem bloco XML (infra, gates), extrai comandos de blocos ```bash
 * que estejam após um marcador "Critérios de aceitação".
 */
function extractCriteriosFromMarkdown(planText, cardId) {
  // Encontra a seção do card pelo id e procura blocos ```bash após
  // "Critérios de aceitação" ou "criterios_aceitacao".
  const cardSection = findCardSection(planText, cardId);
  if (!cardSection) return null;

  const critRegex = /#{1,4}\s*Crit[eé]rios\s+de\s+aceita[cç][aã]o\s*\n([\s\S]*?)(?=\n#{1,4}\s|\n---|\n```yaml|\n```xml|$)/i;
  const critMatch = critRegex.exec(cardSection);
  if (!critMatch) return [];

  const critSection = critMatch[1];
  const bashRegex = /```bash\s*\n([\s\S]*?)```/g;
  const commands = [];
  let bashMatch;

  while ((bashMatch = bashRegex.exec(critSection)) !== null) {
    const lines = bashMatch[1].split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('#') && !trimmed.match(/^#\s*(falha|GUARD|controle|exit)/i)) continue;
      commands.push(trimmed);
    }
  }

  return commands;
}

function findCardSection(planText, cardId) {
  // Encontra o bloco yaml do card e retorna o texto dali até o próximo ```yaml ou fim.
  const escapedId = cardId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const yamlRegex = new RegExp(
    `\`\`\`yaml\\n[\\s\\S]*?id:\\s*${escapedId}\\b[\\s\\S]*?\`\`\``,
    'g'
  );
  const yamlMatch = yamlRegex.exec(planText);
  if (!yamlMatch) return null;

  const yamlEnd = yamlMatch.index + yamlMatch[0].length;
  // O texto após o bloco yaml até o próximo ```yaml (ou ```xml, ou fim)
  const afterYaml = planText.substring(yamlEnd);
  const nextBlock = afterYaml.search(/```(?:yaml|xml)/);
  return nextBlock >= 0 ? afterYaml.substring(0, nextBlock) : afterYaml;
}

/**
 * Extrai todos os comandos de critérios para um card, testando as duas fontes.
 */
function extractAllCriterios(planText, cardId) {
  // Tenta XML primeiro (mais comum para cards com task)
  const xmlCommands = extractCriteriosFromXml(planText, cardId);
  if (xmlCommands !== null && xmlCommands.length > 0) return xmlCommands;

  // Tenta markdown/bash para cards de infra/gate
  const mdCommands = extractCriteriosFromMarkdown(planText, cardId);
  if (mdCommands !== null && mdCommands.length > 0) return mdCommands;

  // Se o XML retornou array vazio (bloco existe mas tá vazio)
  if (xmlCommands !== null) return xmlCommands;

  return [];
}

/**
 * Extrai alvos (caminhos de arquivo/diretório) de um comando.
 */
function extractTargets(cmd) {
  const targets = [];
  // Caminhos como tools/foo/src, packages/bar, src/baz.ts
  const pathRe = /(?:^|\s)([a-zA-Z0-9_./-]+(?:\/[a-zA-Z0-9_./-]+)+)/g;
  let m;
  while ((m = pathRe.exec(cmd)) !== null) {
    const p = m[1].replace(/^['"]|['"]$/g, '');
    // Only keep paths that look like filesystem paths (contain /)
    if (p.includes('/') && !p.startsWith('-') && !p.startsWith('http')) {
      targets.push(p);
    }
  }
  return targets;
}

// ─── Classificação de comandos ────────────────────────────────────────

/**
 * Verifica se uma linha de comando contém um padrão "decorativo":
 * grep ... | wc -l ou grep -c comparado a zero,
 * SEM test -d/test -f ou controle positivo na vizinhança.
 *
 * Retorna { decorative: true, reason: string } ou null.
 */
function checkDecorativo(commands, idx) {
  const cmd = commands[idx];

  // Padrões decorativos:
  // 1. grep ... | wc -l  comparado a zero
  // 2. grep -c ... comparado a zero
  const hasWcMinusL = /\|\s*wc\s+-l/.test(cmd);
  const hasGrepC = /grep\s+-c\b/.test(cmd);

  if (!hasWcMinusL && !hasGrepC) return null;

  // Verifica se o resultado é comparado a zero
  const comparedToZero = /#.*\b0\b/.test(cmd) || // comment mentions zero
    /\b0\s*$/.test(cmd.replace(/#.*$/, '').trim()) || // ends with 0
    /=\s*0\b/.test(cmd) || // = 0
    /-eq\s+0\b/.test(cmd) || // -eq 0
    /==\s*0\b/.test(cmd); // == 0

  if (!comparedToZero) return null;

  // Procura controle positivo nas proximidades (mesmo bloco, ±1 linha)
  // Um controle positivo é um comando que prova que o detector funciona,
  // como test -d/ test -f para o mesmo alvo, ou grep -rq para a mesma busca.
  const start = Math.max(0, idx - 1);
  const end = Math.min(commands.length - 1, idx + 1);

  // Extrai alvos do comando decorativo (diretórios/arquivos mencionados)
  const targets = extractTargets(cmd);

  for (let i = start; i <= end; i++) {
    if (i === idx) continue;
    const c = commands[i];
    // Controle positivo relevante: test -d/ test -f para algum dos mesmos alvos
    if (/\btest\s+(-d|-f|-e)\b/.test(c)) {
      const testTargets = extractTargets(c);
      if (targets.some(t => testTargets.some(tt => tt.includes(t) || t.includes(tt)))) {
        return null;
      }
    }
    // grep -rq para o mesmo alvo (prova que o grep enxerga o diretório)
    if (/\bgrep\s+-r?q\b/.test(c)) {
      const grepTargets = extractTargets(c);
      if (targets.some(t => grepTargets.some(gt => gt.includes(t) || t.includes(gt)))) {
        return null;
      }
    }
    // Controle positivo explícito por comentário na linha adjacente
    if (/#\s*(controle positivo|GUARD|prova que o grep)/i.test(c)) {
      return null;
    }
  }

  return {
    decorative: true,
    reason: hasGrepC
      ? 'grep -c comparado a zero sem controle positivo — passa por vacuidade'
      : '| wc -l comparado a zero sem controle positivo — passa por vacuidade'
  };
}

/**
 * Verifica se um comando `npm test` é suspeito:
 * card não tem *.test.ts nos arquivos e não é infra.
 */
function checkNpmTestSemTestFiles(cmd, card) {
  if (!/\bnpm\s+(run\s+)?test\b/.test(cmd)) return null;

  const arquivos = card.arquivos;
  if (!Array.isArray(arquivos) || arquivos.length === 0) return null;

  const hasTestFile = arquivos.some(a => /\.test\.(ts|mjs|js)$/.test(a));
  if (hasTestFile) return null;

  const fase = card.fase;
  if (fase === 'infra' || fase === 'gate') return null;

  return {
    warning: true,
    reason: 'npm test sem arquivo *.test.ts declarado nos arquivos do card'
  };
}

/**
 * Verifica se um comando "falha por ausência" — um critério que reprova
 * quando a tarefa não fez nada.
 *
 * Exemplos:
 *   - ! grep ...          (negação de shell)
 *   - test -f <arquivo>   (checa existência)
 *   - test -d <diretório> (checa existência)
 *   - test $? -ne 0       (comando anterior deve falhar)
 *   - || { echo "FALHA"   (bail out com mensagem)
 *   - grep -rq            (quiet mode — falha se não achar)
 *   - comando && echo ... || exit 1
 */
function failsByAbsence(cmd) {
  // Negação de shell (! seguido de espaço)
  if (/^!\s/.test(cmd)) return true;

  // test -f, test -d, test -e (checagem de existência)
  if (/\btest\s+(-f|-d|-e)\b/.test(cmd)) return true;

  // test $? -ne 0 (comando anterior deve falhar)
  if (/\btest\s+\$\?\s+-ne\s+0\b/.test(cmd)) return true;

  // || { echo "FALHA" (ou similar)
  if (/\|\|\s*\{\s*echo\s+"?(FALHA|ERRO|FAIL)/i.test(cmd)) return true;

  // && echo ... || exit 1 (guarda)
  if (/&&\s+echo\b.*\|\|\s+exit\s+1/.test(cmd)) return true;

  // grep -rq ou grep -q (quiet mode falha se não encontrar nada)
  if (/\bgrep\s+-r?q\b/.test(cmd) && !/\bwc\s+-l\b/.test(cmd)) return true;

  // for d in ...; do test -f ... (loop de existência)
  if (/\bfor\s+\w+\s+in\b/.test(cmd) && /\btest\s+-f\b/.test(cmd)) return true;

  // Busca por saída de erro específica com grep -c + número > 0
  if (/grep\s+-c\b/.test(cmd) && /[>!]=\s*0/.test(cmd)) return true;

  // Comando que verifica contagem > 0 (ex: test "$(grep -c ...)" -ge)
  if (/\btest\s+"\$\(/.test(cmd) && /\b-ge\s+\d+/.test(cmd)) return true;

  // Comando que usa node -e com throw new Error (falha se condição violada)
  if (/\bnode\s+-e\b/.test(cmd) && /\bthrow\s+new\s+Error\b/.test(cmd)) return true;

  return false;
}

// ─── Autoteste (sonda negativa) ───────────────────────────────────────

function selfTest() {
  let errors = 0;
  let passed = 0;

  console.log('=== AUTOTESTE: sonda negativa ===\n');

  // Card sintético 1: critério comprovadamente decorativo
  // grep | wc -l contra diretório que não tem test -d de guarda
  const syntheticCommands1 = [
    'grep -rn "character-builder/src" tools/runtime/src | wc -l    # tem que dar 0',
    'echo "done"'
  ];

  let decorCount = 0;
  const warnings = [];

  for (let i = 0; i < syntheticCommands1.length; i++) {
    const result = checkDecorativo(syntheticCommands1, i);
    if (result) {
      decorCount++;
      warnings.push(`  [decorativo] linha ${i + 1}: ${syntheticCommands1[i].substring(0, 70)}...`);
    }
  }

  console.log('Card sintético 1 (decorativo puro):');
  for (const w of warnings) console.log(w);

  if (decorCount >= 1) {
    console.log(`  OK: sonda negativa acusou ${decorCount} critério(s) decorativo(s) (>= 1)\n`);
    passed++;
  } else {
    console.log(`  FALHA: sonda negativa acusou ${decorCount} critérios decorativos (esperado >= 1)`);
    console.log('  O classificador está cego — critérios decorativos não detectados.\n');
    errors++;
  }

  // Card sintético 2: grep -c comparado a zero sem controle
  const syntheticCommands2 = [
    'grep -c "forbidden-import" src/main.ts    # 0',
    'echo "ok"'
  ];

  let decorCount2 = 0;
  for (let i = 0; i < syntheticCommands2.length; i++) {
    const result = checkDecorativo(syntheticCommands2, i);
    if (result) decorCount2++;
  }

  console.log('Card sintético 2 (grep -c decorativo):');
  if (decorCount2 >= 1) {
    console.log(`  OK: grep -c decorativo detectado\n`);
    passed++;
  } else {
    console.log(`  FALHA: grep -c comparado a zero não foi detectado como decorativo\n`);
    errors++;
  }

  // Card sintético 3: decorativo COM controle positivo ADJACENTE
  // Aqui o test -d guarda o grep, então NÃO deve ser acusado
  const syntheticCommands3 = [
    'test -d tools/runtime/src || { echo "FALHA: tools/runtime/src não existe"; exit 1; }',
    'grep -rn "character-builder/src" tools/runtime/src | wc -l    # tem que dar 0'
  ];

  let decorCount3 = 0;
  for (let i = 0; i < syntheticCommands3.length; i++) {
    const result = checkDecorativo(syntheticCommands3, i);
    if (result) decorCount3++;
  }

  console.log('Card sintético 3 (decorativo COM guarda adjacente):');
  if (decorCount3 === 0) {
    console.log(`  OK: decorativo com guarda não foi acusado (falso positivo evitado)\n`);
    passed++;
  } else {
    console.log(`  AVISO: ${decorCount3} acusações — guarda pode não estar sendo reconhecida\n`);
  }

  // Verifica que o classificador reconhece critérios que falham por ausência
  const mustFailAbsence = [
    '! grep -rn "forbidden" src/',           // true
    'test -d tools/runtime/src',              // true
    'grep -rn "x" dir | wc -l    # 0',       // false (decorativo)
    'echo "hello"',                            // false
  ];

  const expectedFba = [true, true, false, false];
  console.log('\n--- Verificação de "falha por ausência" ---');
  for (let i = 0; i < mustFailAbsence.length; i++) {
    const result = failsByAbsence(mustFailAbsence[i]);
    const expected = expectedFba[i];
    const status = result === expected ? 'OK' : 'FALHA';
    console.log(`  ${status}: "${mustFailAbsence[i].substring(0, 50)}..." => ${result} (esperado: ${expected})`);
    if (result !== expected) errors++;
    else passed++;
  }

  // Verifica que `npm test` sem .test.ts é acusado
  console.log('\n--- Verificação de npm test sem .test.ts ---');
  const npmTestCard = { id: 'TEST-01', fase: 'F0', arquivos: ['src/foo.ts'] };
  const npmTestResult = checkNpmTestSemTestFiles('npm test', npmTestCard);
  if (npmTestResult) {
    console.log(`  OK: npm test sem .test.ts acusado: ${npmTestResult.reason}`);
    passed++;
  } else {
    console.log('  FALHA: npm test sem .test.ts não foi acusado');
    errors++;
  }

  // npm test COM .test.ts NÃO deve ser acusado
  const npmTestCardOk = { id: 'TEST-02', fase: 'F0', arquivos: ['src/foo.test.ts'] };
  const npmTestResultOk = checkNpmTestSemTestFiles('npm test', npmTestCardOk);
  if (!npmTestResultOk) {
    console.log('  OK: npm test com .test.ts corretamente ignorado');
    passed++;
  } else {
    console.log('  FALHA: npm test com .test.ts foi acusado indevidamente');
    errors++;
  }

  // npm test em card de infra NÃO deve ser acusado
  const npmTestCardInfra = { id: 'TEST-03', fase: 'infra', arquivos: [] };
  const npmTestResultInfra = checkNpmTestSemTestFiles('npm test', npmTestCardInfra);
  if (!npmTestResultInfra) {
    console.log('  OK: npm test em card infra corretamente ignorado');
    passed++;
  } else {
    console.log('  FALHA: npm test em card infra foi acusado indevidamente');
    errors++;
  }

  console.log(`\n=== RESULTADO: ${passed} passaram, ${errors} falharam ===`);
  return errors === 0;
}

// ─── Principal ────────────────────────────────────────────────────────

function main() {
  const args = argv.slice(2);

  // ── Modo autoteste ──
  if (args.includes('--self-test')) {
    const ok = selfTest();
    exit(ok ? 0 : 1);
  }

  // ── Determinar caminho do plano ──
  const planPath = args.find(a => !a.startsWith('--')) ||
    `${import.meta.dirname}/../PLANO-DE-EXECUCAO.md`;

  let planText;
  try {
    planText = readFileSync(planPath, 'utf-8');
  } catch (err) {
    console.error(`ERRO: não conseguiu ler ${planPath}: ${err.message}`);
    exit(1);
  }

  // ── Extrair cards ──
  const allCards = extractCards(planText);

  // ── Zero cards parseados é FALHA ──
  if (allCards.length === 0) {
    console.log('FALHA: zero cards parseados — o formato do documento mudou e este verificador ficou cego.');
    exit(1);
  }

  // ── Tripwire independente ──
  // Conta ocorrências de "^id: " no texto cru (segunda via, independente do parser)
  const rawIdCount = (planText.match(/^id:\s+/gm) || []).length;

  if (rawIdCount !== allCards.length) {
    console.log(`FALHA (tripwire): contagem independente de "^id: " no texto cru = ${rawIdCount},`);
    console.log(`        mas o parser enxergou ${allCards.length} cards.`);
    console.log('        As duas leituras discordam — o parser pode estar ignorando cards.');
    exit(1);
  }

  // ── Filtrar cards feitos ──
  const doneCards = allCards.filter(c => c.estado === 'feito');

  if (doneCards.length === 0) {
    console.log('0 cards feitos — nada a auditar.');
    console.log(`Total de cards no plano: ${allCards.length}`);
    exit(0);
  }

  console.log(`Auditando ${doneCards.length} card(s) com estado: feito (de ${allCards.length} total).\n`);

  let totalWarnings = 0;
  let totalFailures = 0;
  const decorativosReport = []; // para as Considerações de T-01

  for (const card of doneCards) {
    const criterios = extractAllCriterios(planText, card.id);

    console.log(`─── ${card.id}: ${card.fase || '?'} ───`);

    if (criterios.length === 0) {
      console.log(`  AVISO: nenhum critério de aceitação encontrado para ${card.id}`);
      // Cards de infra/gate podem não ter XML; isso é normal se tiverem markdown.
      // Verifica se o card é infra/gate (sem XML esperado)
      const cardSection = findCardSection(planText, card.id);
      const hasXml = cardSection ? /<criterios_aceitacao>/i.test(cardSection) : false;
      if (!hasXml) {
        console.log(`         (card ${card.fase === 'infra' || card.fase === 'gate' ? 'de infra/gate' : 'sem bloco XML'} — verificação manual necessária)`);
      }
      console.log();
      continue;
    }

    console.log(`  ${criterios.length} comando(s) encontrado(s):`);

    let cardWarnings = 0;
    let cardHasFailsByAbsence = false;

    for (let i = 0; i < criterios.length; i++) {
      const cmd = criterios[i];
      const shortCmd = cmd.length > 75 ? cmd.substring(0, 72) + '...' : cmd;
      console.log(`    ${i + 1}. ${shortCmd}`);

      // Checa decorativo
      const decorCheck = checkDecorativo(criterios, i);
      if (decorCheck) {
        console.log(`       ⚠ AVISO: ${decorCheck.reason}`);
        cardWarnings++;
        totalWarnings++;
        decorativosReport.push({ card: card.id, linha: i + 1, comando: cmd, motivo: decorCheck.reason });
      }

      // Checa npm test sem .test.ts
      const npmCheck = checkNpmTestSemTestFiles(cmd, card);
      if (npmCheck) {
        console.log(`       ⚠ AVISO: ${npmCheck.reason}`);
        cardWarnings++;
        totalWarnings++;
        decorativosReport.push({ card: card.id, linha: i + 1, comando: cmd, motivo: npmCheck.reason });
      }

      // Checa se falha por ausência
      if (failsByAbsence(cmd)) {
        cardHasFailsByAbsence = true;
      }
    }

    // Verifica se o card tem pelo menos um critério que falha por ausência
    if (!cardHasFailsByAbsence) {
      console.log(`       ❌ FALHA: card ${card.id} não contém nenhum critério que falhe por ausência.`);
      console.log('          Todo card precisa de ao menos um critério que reprove se a tarefa não fizer nada.');
      totalFailures++;
    }

    console.log();
  }

  // ── Resumo ──
  console.log('═══════════════════════════════════════');
  console.log(`Cards feitos auditados: ${doneCards.length}`);
  console.log(`Avisos: ${totalWarnings}`);
  console.log(`Falhas: ${totalFailures}`);

  if (totalFailures > 0) {
    console.log('VEREDITO: FALHOU');
    exit(1);
  }

  if (totalWarnings > 0) {
    console.log('VEREDITO: PASS (com avisos)');
    console.log('\nCritérios classificados como decorativos (para Considerações de T-01):');
    for (const r of decorativosReport) {
      console.log(`  ${r.card}:${r.linha} — ${r.motivo}`);
      console.log(`    Comando: ${r.comando.substring(0, 80)}`);
    }
  } else {
    console.log('VEREDITO: PASS');
  }

  exit(0);
}

main();
