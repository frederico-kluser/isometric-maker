#!/usr/bin/env bash
# scripts/gate.sh — pipeline local do isometric-maker.
#
# Uma etapa por verificador. Três estados: PASS, FAIL, NÃO-EXERCITADO.
# Ferramenta ausente é VERMELHO, nunca "pulado".
# Etapa que ainda não existe entra como PENDENTE com o id do card que a vai criar.
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
nao_exercitado=0
pendente=0

# ─── Funções ──────────────────────────────────────────────────────────

header() {
  echo ""
  echo -e "${CYAN}─── $1${NC}"
}

stage() {
  local nome="$1"
  local comando="$2"
  local card="$3"   # card que introduziu esta etapa, ou "-" se já existe

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

pending_stage() {
  local nome="$1"
  local card="$2"
  printf "  %-50s ${YELLOW}PENDENTE${NC} (card %s)\n" "$nome" "$card"
  pendente=$((pendente + 1))
}

nao_exercitado_stage() {
  local nome="$1"
  local comando="$2"
  printf "  %-50s " "$nome"

  local output
  output="$(eval "$comando" 2>&1)"
  local ec=$?

  if [ $ec -eq 0 ]; then
    echo -e "${YELLOW}NÃO-EXERCITADO${NC}"
    nao_exercitado=$((nao_exercitado + 1))
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

nao_exercitado_stage "character-builder · npm run typecheck" \
  "cd tools/character-builder 2>/dev/null && npm run typecheck"

# ═══════════════════════════════════════════════════════════════════════
header "documentação"

stage "scripts/check-docs.sh" \
  "bash scripts/check-docs.sh" \
  "-"

# ═══════════════════════════════════════════════════════════════════════
header "skills"

nao_exercitado_stage "lint-skills.mjs" \
  "node .agents/skills/scripts/lint-skills.mjs"

nao_exercitado_stage "run-skill-evals.mjs" \
  "node .agents/skills/scripts/run-skill-evals.mjs"

# ═══════════════════════════════════════════════════════════════════════
header "PixiJS vendor"

nao_exercitado_stage "vendor-types.mjs --check" \
  "node tools/pixi-reference/scripts/vendor-types.mjs --check"

# ═══════════════════════════════════════════════════════════════════════
header "plano"

stage "scripts/validate-plan.mjs" \
  "node scripts/validate-plan.mjs" \
  "F0-01"

pending_stage "scripts/check-acceptance.mjs" "T-01"

# ═══════════════════════════════════════════════════════════════════════
header "ledger de incerteza"

stage "validador do ledger.json" \
  "node scripts/validate-ledger.mjs" \
  "F0-01"

# ═══════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}═══════════════════════════════════════${NC}"
printf "  PASS: %d  FAIL: %d  NÃO-EXERCITADO: %d  PENDENTE: %d\n" \
  "$pass" "$fail" "$nao_exercitado" "$pendente"

if [ "$fail" -gt 0 ]; then
  echo -e "${RED}  VEREDITO: FALHOU${NC}"
  exit 1
elif [ "$pendente" -gt 0 ]; then
  echo -e "${YELLOW}  VEREDITO: PASS (com etapas pendentes)${NC}"
  exit 0
else
  echo -e "${GREEN}  VEREDITO: PASS${NC}"
  exit 0
fi
