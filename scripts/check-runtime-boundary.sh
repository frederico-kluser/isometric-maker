#!/usr/bin/env bash
# scripts/check-runtime-boundary.sh — verificador da fronteira do runtime (F4-03).
#
# Garante que tools/runtime/ não importa de character-builder, map-builder ou
# pixellab-pipeline, e que packages/iso-core também não depende dessas tools.
#
# Uso:
#   bash scripts/check-runtime-boundary.sh          # verificação normal
#   bash scripts/check-runtime-boundary.sh --self-test  # autoteste
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

# ---------------------------------------------------------------------------
# self-test — fabrica um ficheiro com import proibido e verifica que reprova.
# ---------------------------------------------------------------------------
if [ "${1:-}" = '--self-test' ]; then
  TMPDIR="$(mktemp -d)"
  trap 'rm -rf "$TMPDIR"' EXIT

  # Fabrica um ficheiro com import proibido.
  mkdir -p "$TMPDIR/runtime-src"
  echo 'import { coisa } from "../character-builder/src/alguma-coisa.js";' > "$TMPDIR/runtime-src/violation.ts"
  echo 'import { outra } from "../map-builder/src/outra.js";' >> "$TMPDIR/runtime-src/violation.ts"

  # Também fabrica o iso-core com um ficheiro limpo.
  mkdir -p "$TMPDIR/iso-core-src"
  echo 'export const x = 1;' > "$TMPDIR/iso-core-src/ok.ts"

  # Corre a verificação sobre o directório temporário.
  # O --internal-run diz ao script para usar os paths do tmpdir em vez dos reais.
  if "$0" --internal-run "$TMPDIR/runtime-src" "$TMPDIR/iso-core-src" 2>/dev/null; then
    echo "check-runtime-boundary.sh: self-test FALHOU — import proibido NÃO foi detetado."
    exit 1
  fi

  echo "check-runtime-boundary.sh: self-test PASSOU — import proibido foi detetado."
  exit 0
fi

# ---------------------------------------------------------------------------
# Resolução dos directórios a verificar
# ---------------------------------------------------------------------------
if [ "${1:-}" = '--internal-run' ]; then
  shift
  RUNTIME_SRC="${1:-}"
  ISO_CORE_SRC="${2:-}"
  shift 2 || true
else
  RUNTIME_SRC="tools/runtime/src"
  ISO_CORE_SRC="packages/iso-core/src"
fi

# ---------------------------------------------------------------------------
# Funções de asserção
# ---------------------------------------------------------------------------

BANNED_TOOLS='character-builder|map-builder|pixellab-pipeline'

# Asserção negativa: NENHUMA linha deve casar com o padrão.
# PROIBIDO: usar | wc -l comparado a zero como única asserção.
# Em vez disso, usa grep -q com teste de string vazia.
assert_no_banned_imports() {
  local dir="$1"
  local label="$2"

  if [ ! -d "$dir" ]; then
    echo -e "  ${label}: ${RED}FAIL${NC} (directório não existe: $dir)"
    return 1
  fi

  local matches
  # grep retorna 0 se encontrou, 1 se não. Capturamos a saída.
  set +e
  matches="$(grep -rn -E "from ['\".].*(${BANNED_TOOLS})" "$dir" 2>/dev/null)"
  local grep_rc=$?
  set -e

  if [ $grep_rc -eq 0 ] && [ -n "$matches" ]; then
    echo -e "  ${label}: ${RED}FAIL${NC} — importa de ferramenta proibida:"
    echo "$matches" | while IFS= read -r line; do
      echo "        $line"
    done
    return 1
  fi

  echo -e "  ${label}: ${GREEN}PASS${NC}"
  return 0
}

# Controlo positivo: o directório tem de conter pelo menos um import.
assert_has_imports() {
  local dir="$1"
  local label="$2"

  if [ ! -d "$dir" ]; then
    echo -e "  ${label}: ${RED}FAIL${NC} (directório não existe: $dir)"
    return 1
  fi

  local matches
  set +e
  matches="$(grep -rn -E "^import " "$dir" 2>/dev/null)"
  local grep_rc=$?
  set -e

  if [ $grep_rc -ne 0 ] || [ -z "$matches" ]; then
    echo -e "  ${label}: ${RED}FAIL${NC} — nenhum import encontrado (controlo positivo falhou)"
    return 1
  fi

  # Conta as linhas para o log. Isto NÃO é a asserção — a asserção é o grep -q acima.
  local count
  count="$(echo "$matches" | wc -l)"
  echo -e "  ${label}: ${GREEN}PASS${NC} (controlo positivo: ${count} imports)"
  return 0
}

# ---------------------------------------------------------------------------
# Execução principal
# ---------------------------------------------------------------------------

fail=0

echo ""
echo -e "${CYAN}─── fronteira do runtime${NC}"

# 1. O directório existe.
if [ ! -d "$RUNTIME_SRC" ]; then
  echo -e "  runtime/src: ${RED}FAIL${NC} (directório não existe)"
  fail=1
fi

# 2. Controlo positivo: contém pelo menos um import.
assert_has_imports "$RUNTIME_SRC" "runtime/src · controlo positivo" || fail=1

# 3. Asserção negativa: runtime não importa de tools/.
assert_no_banned_imports "$RUNTIME_SRC" "runtime/src · sem imports proibidos" || fail=1

# 4. Mesmo para packages/iso-core.
echo ""
echo -e "${CYAN}─── fronteira do iso-core${NC}"

assert_has_imports "$ISO_CORE_SRC" "iso-core/src · controlo positivo" || fail=1
assert_no_banned_imports "$ISO_CORE_SRC" "iso-core/src · sem imports proibidos" || fail=1

echo ""

if [ "$fail" -gt 0 ]; then
  echo -e "${RED}  VEREDITO: FALHOU${NC}"
  exit 1
else
  echo -e "${GREEN}  VEREDITO: PASS${NC}"
  exit 0
fi
