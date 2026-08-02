#!/usr/bin/env bash
# scripts/gate.sh — pipeline local do isometric-maker.
#
# Uma etapa por verificador. Dois estados: PASS, FAIL.
# Etapas auxiliares mostram OK (auxiliar) quando passam.
# Ferramenta ausente é VERMELHO, nunca "pulado".
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ─── Cores ────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

pass=0
fail=0
auxiliar=0

# ─── Funções ──────────────────────────────────────────────────────────

header() {
	echo ""
	echo -e "${CYAN}─── $1${NC}"
}

stage() {
	local nome="$1"
	local comando="$2"

	printf "  %-50s " "$nome"

	if [ ! -f "$(echo "$comando" | awk '{print $1}')" ] && ! command -v "$(echo "$comando" | awk '{print $1}')" &>/dev/null; then
		# Se o comando não é um arquivo executável e não está no PATH, mas
		# a etapa é um script que não existe, tratamos como PENDENTE.
		# Caso contrário, é FAIL por ferramenta ausente.
		local tool
		tool="$(echo "$comando" | awk '{print $1}')"
		if [[ "$tool" == "node" || "$tool" == "bash" || "$tool" == "cd" || "$tool" == "npm" ]]; then
			# São comandos padrão — se não existem, é FAIL de ambiente
			echo -e "${RED}FAIL${NC} (ferramenta ausente: $tool)"
			fail=$((fail + 1))
			return
		fi
	fi

	local output
	output="$(eval "$comando" 2>&1)"
	local ec=$?

	if [ $ec -eq 0 ]; then
		echo -e "${GREEN}PASS${NC}"
		pass=$((pass + 1))
	else
		echo -e "${RED}FAIL${NC}"
		fail=$((fail + 1))
		echo "        $output" | head -5 | sed 's/^/        /'
	fi
}

auxiliar_stage() {
	local nome="$1"
	local comando="$2"
	printf "  %-50s " "$nome"

	local output
	output="$(eval "$comando" 2>&1)"
	local ec=$?

	if [ $ec -eq 0 ]; then
		echo -e "${GREEN}OK (auxiliar)${NC}"
		auxiliar=$((auxiliar + 1))
	else
		echo -e "${RED}FAIL${NC}"
		fail=$((fail + 1))
		echo "        $output" | head -5 | sed 's/^/        /'
	fi
}

# ═══════════════════════════════════════════════════════════════════════
header "pixellab-pipeline"

stage "pixellab-pipeline · npm test" \
	"cd tools/pixellab-pipeline && npm test" \
	"-"

stage "pixellab-pipeline · npm run typecheck" \
	"cd tools/pixellab-pipeline && npm run typecheck" \
	"-"

# ═══════════════════════════════════════════════════════════════════════
header "character-builder"

# O character-builder é o aplicativo inteiro desde a unificação: estúdio de
# personagem, editor de mapa e tela inicial. Os testes que eram do map-builder
# (autotile, export, picking, camera, placement, editor/map-state) rodam aqui,
# pelo glob `src/**/*.test.ts`.
stage "character-builder · npm run typecheck" \
	"cd tools/character-builder && npm run typecheck" \
	"-"

stage "character-builder · npm test" \
	"cd tools/character-builder && npm test" \
	"-"

# ═══════════════════════════════════════════════════════════════════════
header "documentação"

stage "scripts/check-docs.sh" \
	"bash scripts/check-docs.sh" \
	"-"

# ═══════════════════════════════════════════════════════════════════════
header "skills"

auxiliar_stage "lint-skills.mjs" \
	"node .agents/skills/scripts/lint-skills.mjs"

auxiliar_stage "run-skill-evals.mjs" \
	"node .agents/skills/scripts/run-skill-evals.mjs"

# ═══════════════════════════════════════════════════════════════════════
header "PixiJS pin"

stage "check-pixi-pin" \
	"node scripts/check-pixi-pin.mjs" \
	"F0-05"

# ═══════════════════════════════════════════════════════════════════════
header "PixiJS vendor"

auxiliar_stage "vendor-types.mjs --check" \
	"node tools/pixi-reference/scripts/vendor-types.mjs --check"

# ═══════════════════════════════════════════════════════════════════════
header "runtime"

stage "check-runtime-boundary" \
	"bash scripts/check-runtime-boundary.sh" \
	"F4-03"

# ═══════════════════════════════════════════════════════════════════
header "plano"

stage "scripts/validate-plan.mjs" \
	"node scripts/validate-plan.mjs" \
	"F0-01"

stage "check-acceptance.mjs (forma dos critérios)" \
	"node scripts/check-acceptance.mjs" \
	"T-01"

# ═══════════════════════════════════════════════════════════════════════
header "iso-core"

stage "iso-core · npm test" \
	"cd packages/iso-core && npm test" \
	"-"

stage "iso-core · npm run typecheck" \
	"cd packages/iso-core && npm run typecheck" \
	"-"

# ═══════════════════════════════════════════════════════════════════════
header "runtime (game)"

stage "runtime · npm run typecheck" \
	"cd tools/runtime && npm run typecheck" \
	"-"

# ═══════════════════════════════════════════════════════════════════════
header "ledger de incerteza"

stage "validador do ledger.json" \
	"node scripts/validate-ledger.mjs" \
	"F0-01"

# ═══════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}═══════════════════════════════════════${NC}"
printf "  PASS: %d  FAIL: %d  AUXILIAR: %d\n" \
	"$pass" "$fail" "$auxiliar"

if [ "$fail" -gt 0 ]; then
	echo -e "${RED}  VEREDITO: FALHOU${NC}"
	exit 1
else
	echo -e "${GREEN}  VEREDITO: PASS${NC}"
	exit 0
fi
