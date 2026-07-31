#!/usr/bin/env bash
# scripts/new-task-worktree.sh <card-id>
#
# Cria uma worktree isolada para o card em
# /home/ondokai/Projects/isometric-maker.worktrees/<card-id> a partir do
# branch de integração. RECUSA ids de infra (I-*) e de gate (G-*), que
# rodam no branch principal.
#
# Termina com PREFLIGHT: node >= 24, spec vendorizado com sha256,
# catalog.ts carrega. Falhou => exit 1, worktree fica para inspeção.

set -uo pipefail

ROOT="/home/ondokai/Projects/isometric-maker"
WORKTREE_BASE="/home/ondokai/Projects/isometric-maker.worktrees"

# ─── Valida argumento ─────────────────────────────────────────────────

CARD_ID="${1:-}"

if [ -z "$CARD_ID" ]; then
  echo "Uso: $0 <card-id>"
  echo "Ex:  $0 F0-01"
  exit 1
fi

# Recusa I-* e G-*
if [[ "$CARD_ID" =~ ^I- ]] || [[ "$CARD_ID" =~ ^G- ]]; then
  echo "RECUSADO: $CARD_ID é card de infra (I-*) ou gate (G-*)."
  echo "  Cards I-* e G-* rodam no branch principal, não em worktree."
  echo "  Execute a tarefa diretamente em $ROOT."
  exit 1
fi

# ─── Determina branch de integração ───────────────────────────────────

INTEGRATION_BRANCH="main"
# Se existir branch de integração de onda, usar ele
CURRENT_BRANCH="$(cd "$ROOT" && git branch --show-current 2>/dev/null || echo "")"
if [ -n "$CURRENT_BRANCH" ] && [ "$CURRENT_BRANCH" != "HEAD" ]; then
  INTEGRATION_BRANCH="$CURRENT_BRANCH"
fi

echo "  card:        $CARD_ID"
echo "  base:        $INTEGRATION_BRANCH"
echo "  worktree:    $WORKTREE_BASE/$CARD_ID"

# ─── Cria worktree ────────────────────────────────────────────────────

mkdir -p "$WORKTREE_BASE"

if [ -d "$WORKTREE_BASE/$CARD_ID" ]; then
  echo "AVISO: worktree $WORKTREE_BASE/$CARD_ID já existe."
  echo "  Remova-a manualmente se quiser recriar:"
  echo "  git worktree remove $WORKTREE_BASE/$CARD_ID"
  exit 1
fi

cd "$ROOT"

# Garante que o branch base está disponível localmente
git show-ref --verify --quiet "refs/heads/$INTEGRATION_BRANCH" || {
  echo "ERRO: branch '$INTEGRATION_BRANCH' não encontrado localmente"
  exit 1
}

echo "  criando worktree..."
git worktree add --detach "$WORKTREE_BASE/$CARD_ID" "$INTEGRATION_BRANCH" || {
  echo "ERRO: falha ao criar worktree"
  exit 1
}

echo "  worktree criada em $WORKTREE_BASE/$CARD_ID"

# ═══════════════════════════════════════════════════════════════════════
# PREFLIGHT — prova acesso ao insumo
# ═══════════════════════════════════════════════════════════════════════

echo ""
echo "─── PREFLIGHT ───"

cd "$WORKTREE_BASE/$CARD_ID"
PREFLIGHT_FAIL=0

# 1. node >= 24
echo -n "  node --version >= 24 ... "
NODE_VERSION="$(node --version 2>/dev/null || echo "v0.0.0")"
NODE_MAJOR="$(echo "$NODE_VERSION" | sed 's/^v//' | cut -d. -f1)"
if [ "$NODE_MAJOR" -ge 24 ] 2>/dev/null; then
  echo "OK ($NODE_VERSION)"
else
  echo "FALHA: $NODE_VERSION (precisa >= 24)"
  PREFLIGHT_FAIL=1
fi

# 2. openapi-v2.json resolve e sha256 casa com PROVENIENCIA.txt
echo -n "  openapi-v2.json sha256 ... "
SPEC="tools/pixellab-pipeline/openapi/openapi-v2.json"
PROV="tools/pixellab-pipeline/openapi/PROVENIENCIA.txt"

if [ ! -f "$SPEC" ]; then
  echo "FALHA: $SPEC não encontrado"
  PREFLIGHT_FAIL=1
elif [ ! -f "$PROV" ]; then
  echo "FALHA: $PROV não encontrado"
  PREFLIGHT_FAIL=1
else
  ACTUAL_SHA="$(sha256sum "$SPEC" | awk '{print $1}')"
  EXPECTED_SHA="$(grep -o '[0-9a-f]\{64\}' "$PROV" | head -1)"

  if [ "$ACTUAL_SHA" = "$EXPECTED_SHA" ]; then
    echo "OK ($ACTUAL_SHA)"
  else
    echo "FALHA: sha256 diverge"
    echo "        esperado:  $EXPECTED_SHA"
    echo "        calculado: $ACTUAL_SHA"
    PREFLIGHT_FAIL=1
  fi
fi

# 3. catalog.ts carrega sem erro
echo -n "  catalog.ts import ... "
CATALOG_OUT="$(node -e "import('./tools/pixellab-pipeline/assets/catalog.ts').then(() => console.log('OK')).catch(e => console.log('FALHA:', e.message))" 2>&1)"
if echo "$CATALOG_OUT" | grep -q "^OK$"; then
  echo "OK"
else
  echo "FALHA:"
  echo "$CATALOG_OUT" | sed 's/^/        /'
  PREFLIGHT_FAIL=1
fi

echo ""

if [ "$PREFLIGHT_FAIL" -ne 0 ]; then
  echo "PREFLIGHT FALHOU — a worktree fica em $WORKTREE_BASE/$CARD_ID para inspeção."
  echo "Corrija o ambiente e remova a worktree manualmente antes de tentar de novo:"
  echo "  git worktree remove $WORKTREE_BASE/$CARD_ID"
  exit 1
fi

echo "PREFLIGHT OK — worktree pronta."
echo ""
echo "Para entrar: cd $WORKTREE_BASE/$CARD_ID"
echo "Para remover depois do merge: git worktree remove $WORKTREE_BASE/$CARD_ID"
