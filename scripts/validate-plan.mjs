#!/usr/bin/env node

// scripts/validate-plan.mjs — Node 24, zero dependencies.
// Parseia blocos ```yaml dos cards de PLANO-DE-EXECUCAO.md e valida o grafo.
//
// Autoteste: node scripts/validate-plan.mjs --self-test
// Validação:  node scripts/validate-plan.mjs [caminho/para/plano.md]

import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";

// ─── YAML parser mínimo ───────────────────────────────────────────────

function parseYamlBlock(text) {
	const lines = text.split("\n");
	const result = {};
	let currentKey = null;

	for (const rawLine of lines) {
		const commentIdx = rawLine.indexOf("#");
		const line = (
			commentIdx >= 0 ? rawLine.substring(0, commentIdx) : rawLine
		).trimEnd();
		if (!line.trim()) continue;

		// Block array continuation: "  - item"
		const arrayMatch = line.match(/^(\s+)-\s+(.*)$/);
		if (arrayMatch) {
			const indent = arrayMatch[1].length;
			const val = arrayMatch[2].trim();
			// Only continue an existing array key (basic tracking via last key)
			if (currentKey && indent === 2 && result[currentKey] !== undefined) {
				if (!Array.isArray(result[currentKey])) result[currentKey] = [];
				result[currentKey].push(val);
				continue;
			}
			// Could also be a top-level list; for our cards this doesn't happen
		}

		// Key: value
		const kvMatch = line.match(/^([\w][\w_]*)\s*:\s*(.*?)\s*$/);
		if (kvMatch) {
			currentKey = kvMatch[1];
			const rawVal = kvMatch[2].trim();

			if (rawVal === "" || rawVal === "[]") {
				result[currentKey] = [];
			} else if (rawVal === "true") {
				result[currentKey] = true;
			} else if (rawVal === "false") {
				result[currentKey] = false;
			} else if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
				const inner = rawVal.slice(1, -1).trim();
				result[currentKey] = inner
					? inner
							.split(",")
							.map((s) => s.trim())
							.filter((s) => s)
					: [];
			} else {
				result[currentKey] = rawVal;
			}
		}
	}

	return result;
}

// ─── Extrair cards ────────────────────────────────────────────────────

function extractCards(planText) {
	const blocks = [];
	const regex = /```yaml\n([\s\S]*?)```/g;
	let match;

	while ((match = regex.exec(planText)) !== null) {
		const content = match[1];
		// A primeira chave tem de começar na coluna 1 (seção 1.2 do plano)
		const firstKeyLine = content
			.split("\n")
			.find((l) => l.trim() && !l.trim().startsWith("#"));
		if (firstKeyLine && /^\w[\w_]*\s*:/.test(firstKeyLine)) {
			blocks.push(parseYamlBlock(content));
		}
	}

	return blocks;
}

// ─── Wave number ──────────────────────────────────────────────────────

function waveNumber(wave) {
	const m = wave.match(/^W(\d+(?:\.\d+)?)$/);
	if (!m) throw new Error(`formato de onda inválido: ${wave}`);
	return parseFloat(m[1]);
}

// ─── DFS com cores para detecção de ciclo ────────────────────────────

function findCycle(cards) {
	const byId = new Map(cards.map((c) => [c.id, c]));
	const WHITE = 0,
		GRAY = 1,
		BLACK = 2;
	const color = new Map();
	const path = [];

	for (const card of cards) color.set(card.id, WHITE);

	function dfs(id) {
		color.set(id, GRAY);
		path.push(id);
		const card = byId.get(id);
		if (card && card.deps) {
			for (const dep of card.deps) {
				if (!byId.has(dep)) continue;
				const c = color.get(dep);
				if (c === GRAY) {
					const cycleStart = path.indexOf(dep);
					return [...path.slice(cycleStart), dep];
				}
				if (c === WHITE) {
					const cycle = dfs(dep);
					if (cycle) return cycle;
				}
			}
		}
		path.pop();
		color.set(id, BLACK);
		return null;
	}

	for (const card of cards) {
		if (color.get(card.id) === WHITE) {
			const cycle = dfs(card.id);
			if (cycle) return cycle;
		}
	}
	return null;
}

// ─── Nível topológico ────────────────────────────────────────────────

function computeLevels(cards) {
	const byId = new Map(cards.map((c) => [c.id, c]));
	const levels = new Map();

	function compute(id, visited = new Set()) {
		if (levels.has(id)) return levels.get(id);
		if (visited.has(id)) return 0; // ciclo — tratado separadamente
		visited.add(id);
		const card = byId.get(id);
		if (!card || !card.deps || card.deps.length === 0) {
			levels.set(id, 0);
			return 0;
		}
		const maxDep = Math.max(
			...card.deps.map((d) => {
				const depCard = byId.get(d);
				return depCard ? compute(d, new Set(visited)) : 0;
			}),
		);
		const lvl = maxDep + 1;
		levels.set(id, lvl);
		return lvl;
	}

	for (const card of cards) compute(card.id);
	return levels;
}

// ─── Dependentes ──────────────────────────────────────────────────────

function computeDependents(cards) {
	const deps = new Map();
	for (const card of cards) deps.set(card.id, new Set());
	for (const card of cards) {
		for (const dep of card.deps || []) {
			if (deps.has(dep)) deps.get(dep).add(card.id);
		}
	}
	return deps;
}

// ─── Caminho crítico (caminho mais longo) ─────────────────────────────

function computeCriticalPath(cards) {
	const byId = new Map(cards.map((c) => [c.id, c]));
	const dependents = computeDependents(cards);

	// Folhas: cards sem dependentes
	const leaves = cards.filter(
		(c) => !dependents.has(c.id) || dependents.get(c.id).size === 0,
	);

	// Encontra todos os caminhos de cada folha até as raízes
	function pathsToRoot(id, visited = new Set()) {
		if (visited.has(id)) return [[]];
		visited.add(id);
		const card = byId.get(id);
		if (!card || !card.deps || card.deps.length === 0) return [[id]];

		const result = [];
		for (const dep of card.deps) {
			if (!byId.has(dep)) continue;
			for (const subPath of pathsToRoot(dep, new Set(visited))) {
				result.push([...subPath, id]);
			}
		}
		return result.length > 0 ? result : [[id]];
	}

	let bestPath = [];
	for (const leaf of leaves) {
		for (const path of pathsToRoot(leaf.id)) {
			if (path.length > bestPath.length) {
				bestPath = path;
			}
		}
	}

	return bestPath;
}

// ─── Extrair tabela de ondas (seção 3) ───────────────────────────────

function extractWaveTable(planText) {
	// Encontra a seção 3
	const sectionMatch = planText.match(
		/## 3\.\s.*?\n([\s\S]*?)(?=\n## [4-9]\.|\n## [1-9][0-9]\.)/,
	);
	if (!sectionMatch) return null;

	const text = sectionMatch[1];
	const rows = [];
	// Cada linha de tabela: | `W0` | `I-01` · `F0-01` | ... |
	const rowRegex = /^\|\s*`(W[\d.]+)`\s*\|(.*)\|/gm;
	let match;

	while ((match = rowRegex.exec(text)) !== null) {
		const wave = match[1];
		const cardCell = match[2].trim();
		const cardIds = [...cardCell.matchAll(/`([A-Z]+\d*-\d+)`/g)].map(
			(m) => m[1],
		);
		if (cardIds.length > 0) {
			rows.push({ wave, cards: cardIds });
		}
	}

	return rows.length > 0 ? rows : null;
}

// ─── Extrair caminho crítico publicado (seção 5) ─────────────────────

function extractPublishedCriticalPath(planText) {
	// Encontra o bloco ```text na seção 5
	const sectionMatch = planText.match(/## 5\.\s.*?\n+```text\n([\s\S]*?)```/);
	if (!sectionMatch) return null;

	const blockText = sectionMatch[1];
	// Extrai todos os IDs do formato F0-01, I-02, G-0, etc.
	const ids = [...blockText.matchAll(/\b([A-Z]+\d*-\d+)\b/g)].map((m) => m[1]);

	return ids.length > 0 ? ids : null;
}

// ─── Checagens ────────────────────────────────────────────────────────

function runAllChecks(cards, planText, opts = {}) {
	const problems = [];
	const warnings = [];
	const byId = new Map(cards.map((c) => [c.id, c]));

	// (k) ZERO CARDS PARSEADOS É FALHA
	if (cards.length === 0) {
		problems.push(
			"ZERO CARDS PARSEADOS: o formato do documento mudou e este validador ficou cego",
		);
		return { problems, warnings };
	}

	// (a) Toda dependência resolve para um card existente
	for (const card of cards) {
		const cardDeps = card.deps || [];
		for (const dep of cardDeps) {
			if (!byId.has(dep)) {
				problems.push(`card ${card.id}: dependência '${dep}' não existe`);
			}
		}
	}

	// (b) Grafo acíclico (DFS com cor)
	const cycle = findCycle(cards);
	if (cycle) {
		problems.push(`ciclo detectado: ${cycle.join(" → ")}`);
	}

	// (c) INVARIANTE DURA: onda(card) > onda(dep) para toda aresta
	for (const card of cards) {
		const cardWaveNum = waveNumber(card.onda);
		for (const dep of card.deps || []) {
			const depCard = byId.get(dep);
			if (!depCard) continue; // (a) já reportou
			const depWaveNum = waveNumber(depCard.onda);
			if (!(cardWaveNum > depWaveNum)) {
				problems.push(
					`card ${card.id} (onda ${card.onda}=${cardWaveNum}) depende de ${dep} ` +
						`(onda ${depCard.onda}=${depWaveNum}) — invariante onda(card) > onda(dep) violada`,
				);
			}
		}
	}

	// (d) AVISO: onda(card) > nivel(card). Folga é legítima mas tem de ser VISTA.
	const levels = computeLevels(cards);
	for (const card of cards) {
		const w = waveNumber(card.onda);
		const lvl = levels.get(card.id) || 0;
		if (w > lvl) {
			warnings.push(
				`card ${card.id}: onda ${card.onda} > nível ${lvl} ` +
					`(folga de ${(w - lvl).toFixed(1)} ondas)`,
			);
		}
	}

	// (e) Sem órfão: card sem dependência E sem dependente, salvo allowlist
	const dependents = computeDependents(cards);
	const allowlist = opts.orphanAllowlist || [];
	for (const card of cards) {
		const hasDeps = (card.deps || []).length > 0;
		const hasDependents =
			dependents.has(card.id) && dependents.get(card.id).size > 0;
		if (!hasDeps && !hasDependents && !allowlist.includes(card.id)) {
			problems.push(
				`card ${card.id} é órfão: sem dependências e sem dependentes`,
			);
		}
	}

	// (f) Dois cards da MESMA onda não declaram o MESMO arquivo
	const waveFiles = new Map();
	for (const card of cards) {
		const arquivos = card.arquivos || [];
		const w = card.onda;
		if (!waveFiles.has(w)) waveFiles.set(w, new Map());
		const wf = waveFiles.get(w);
		for (const file of arquivos) {
			if (wf.has(file)) {
				problems.push(
					`colisão de arquivo na onda ${w}: '${file}' declarado por ` +
						`${wf.get(file)} e ${card.id}`,
				);
			} else {
				wf.set(file, card.id);
			}
		}
	}

	// (g) Tabela de ondas da seção 3 bate com os campos onda: dos cards
	const waveTable = extractWaveTable(planText);
	if (waveTable) {
		const cardsByWave = new Map();
		for (const card of cards) {
			if (!cardsByWave.has(card.onda)) cardsByWave.set(card.onda, new Set());
			cardsByWave.get(card.onda).add(card.id);
		}

		const allTableCards = new Set();
		for (const row of waveTable) {
			const expected = new Set(row.cards);
			const actual = cardsByWave.get(row.wave) || new Set();

			for (const id of expected) {
				allTableCards.add(id);
				if (!actual.has(id)) {
					problems.push(
						`tabela de ondas: ${id} listado na onda ${row.wave} ` +
							`mas o card declara onda ${byId.get(id)?.onda || "desconhecida"}`,
					);
				}
			}
			for (const id of actual) {
				if (!expected.has(id)) {
					problems.push(
						`tabela de ondas: ${id} declara onda ${row.wave} mas não está na linha da tabela para essa onda`,
					);
				}
			}
		}

		// Cards que não aparecem em nenhuma linha da tabela (só reporta se não foi reportado acima)
		for (const card of cards) {
			if (!allTableCards.has(card.id)) {
				problems.push(
					`tabela de ondas: ${card.id} (onda ${card.onda}) não aparece em nenhuma linha da tabela da seção 3`,
				);
			}
		}
	}

	// (h) Caminho crítico publicado == caminho mais longo recalculado
	const publishedPath = extractPublishedCriticalPath(planText);
	if (publishedPath && publishedPath.length > 0) {
		const computedPath = computeCriticalPath(cards);
		if (JSON.stringify(publishedPath) !== JSON.stringify(computedPath)) {
			problems.push(
				`caminho crítico diverge:\n` +
					`  publicado: ${publishedPath.join(" → ")}\n` +
					`  recalculado: ${computedPath.join(" → ")}`,
			);
		}
	}

	// (i) Card 'feito' só é válido se todos os ancestrais transitivos estiverem feitos
	for (const card of cards) {
		if (card.estado !== "feito") continue;

		function allAncestorsFeito(id, visited = new Set()) {
			if (visited.has(id)) return true;
			visited.add(id);
			const c = byId.get(id);
			if (!c) return true;
			for (const dep of c.deps || []) {
				const depCard = byId.get(dep);
				if (!depCard) continue;
				if (depCard.estado !== "feito") return false;
				if (!allAncestorsFeito(dep, visited)) return false;
			}
			return true;
		}

		if (!allAncestorsFeito(card.id)) {
			problems.push(
				`card ${card.id}: estado 'feito' mas nem todos os ancestrais transitivos estão feitos`,
			);
		}
	}

	// (j) gasta: sim só pode ser I-01 ou I-02
	for (const card of cards) {
		if (card.gasta === "sim" && card.id !== "I-01" && card.id !== "I-02") {
			problems.push(
				`card ${card.id}: gasta: sim — apenas I-01 e I-02 podem gastar dinheiro`,
			);
		}
	}

	return { problems, warnings };
}

// ─── Autoteste ────────────────────────────────────────────────────────

function selfTest(planText) {
	const cards = extractCards(planText);
	if (cards.length === 0) {
		console.error(
			"FALHA no autoteste: não foi possível parsear cards do documento",
		);
		return false;
	}

	let passed = 0;
	let failed = 0;

	function assertProblemContains(testName, mutatedCards, expectedSubstring) {
		const { problems } = runAllChecks(mutatedCards, planText);
		const found = problems.some((p) => p.includes(expectedSubstring));

		if (found) {
			console.log(`  ✓ ${testName}`);
			passed++;
		} else {
			console.log(
				`  ✗ ${testName}: esperava mensagem contendo "${expectedSubstring}"`,
			);
			if (problems.length > 0) {
				console.log(
					`    problemas encontrados: ${problems.map((p) => `"${p}"`).join("; ")}`,
				);
			} else {
				console.log("    nenhum problema encontrado");
			}
			failed++;
		}
	}

	// Mutação 1: dependência inexistente
	const mut1 = structuredClone(cards);
	const firstCard = mut1[0];
	firstCard.deps = [...(firstCard.deps || []), "XX-NAOEXISTE"];
	assertProblemContains(
		"dependência inexistente detectada",
		mut1,
		"dependência 'XX-NAOEXISTE' não existe",
	);

	// Mutação 2: ciclo
	const mut2 = structuredClone(cards);
	let cycleCreated = false;
	if (mut2.length >= 2) {
		// Encontra um card com dependências e faz uma das dependências apontar de volta
		for (const card of mut2) {
			if (card.deps && card.deps.length > 0) {
				const depId = card.deps[0];
				const depCard = mut2.find((c) => c.id === depId);
				if (depCard) {
					depCard.deps = [...(depCard.deps || []), card.id];
					assertProblemContains("ciclo detectado", mut2, "ciclo detectado");
					cycleCreated = true;
					break;
				}
			}
		}
	}
	if (!cycleCreated) {
		console.log(
			"  ✗ ciclo detectado: não foi possível criar um ciclo (nenhum card com dependências?)",
		);
		failed++;
	}

	// Mutação 3: invariante de onda violada
	const mut3 = structuredClone(cards);
	let waveViolated = false;
	for (const card of mut3) {
		if (card.deps && card.deps.length > 0) {
			for (const depId of card.deps) {
				const dep = mut3.find((c) => c.id === depId);
				if (dep) {
					const cardW = waveNumber(card.onda);
					const depW = waveNumber(dep.onda);
					if (cardW > depW) {
						// Inverte as ondas para criar violação
						const origCardWave = card.onda;
						card.onda = dep.onda;
						dep.onda = origCardWave;
						assertProblemContains(
							"invariante de onda violada",
							mut3,
							"invariante onda(card) > onda(dep) violada",
						);
						waveViolated = true;
						break;
					}
				}
			}
			if (waveViolated) break;
		}
	}
	if (!waveViolated) {
		console.log(
			"  ✗ invariante de onda: não foi possível criar uma violação (todas as ondas são iguais?)",
		);
		failed++;
	}

	// Mutação 4: colisão de arquivo na mesma onda
	const mut4 = structuredClone(cards);
	const byWave = new Map();
	for (const card of mut4) {
		if (!byWave.has(card.onda)) byWave.set(card.onda, []);
		byWave.get(card.onda).push(card);
	}
	let collisionCreated = false;
	for (const [, waveCards] of byWave) {
		if (waveCards.length >= 2) {
			const sharedFile = `scripts/colisao-teste-${Date.now()}.mjs`;
			waveCards[0].arquivos = [...(waveCards[0].arquivos || []), sharedFile];
			waveCards[1].arquivos = [...(waveCards[1].arquivos || []), sharedFile];
			assertProblemContains(
				"colisão de arquivo detectada",
				mut4,
				"colisão de arquivo",
			);
			collisionCreated = true;
			break;
		}
	}
	if (!collisionCreated) {
		console.log(
			"  ✗ colisão de arquivo: não há duas cartas na mesma onda para criar colisão",
		);
		failed++;
	}

	console.log(`\nautoteste: ${passed} passaram, ${failed} falharam`);
	return failed === 0;
}

// ─── Main ─────────────────────────────────────────────────────────────

function main() {
	const args = argv.slice(2);
	const selfTestFlag = args.includes("--self-test");
	const planPath =
		args.filter((a) => !a.startsWith("--"))[0] || "PLANO-DE-EXECUCAO.md";

	let planText;
	try {
		planText = readFileSync(planPath, "utf-8");
	} catch (err) {
		console.error(`ERRO: não foi possível ler ${planPath}: ${err.message}`);
		exit(1);
	}

	if (selfTestFlag) {
		console.log("=== autoteste ===");
		const ok = selfTest(planText);
		if (!ok) {
			console.error("autoteste FALHOU");
			exit(1);
		}
		console.log("autoteste OK");
		exit(0);
	}

	// Validação normal
	const cards = extractCards(planText);
	const { problems, warnings } = runAllChecks(cards, planText);

	// Avisos primeiro
	for (const w of warnings) {
		console.log(`AVISO: ${w}`);
	}

	// Erros
	for (const p of problems) {
		console.log(`ERRO: ${p}`);
	}

	// Sumário
	console.log(
		`\n${cards.length} cards parseados · ${problems.length} erros · ${warnings.length} avisos`,
	);

	if (problems.length > 0) exit(1);
	exit(0);
}

main();
