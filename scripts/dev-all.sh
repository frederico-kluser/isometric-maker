#!/usr/bin/env bash
# dev-all.sh — sobe os construtores com interface e os mata junto no Ctrl+C.
#
#   bash scripts/dev-all.sh
#
# Não precisa de package.json na raiz nem de workspace.
#
# O runtime (tools/runtime) precisa de um projeto exportado e não sobe aqui —
# exporte do map-builder primeiro, depois: cd tools/runtime && npm run play -- <projeto.json>

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() {
  echo ""
  echo "Parando todos os servidores..."
  kill $(jobs -p) 2>/dev/null || true
  wait 2>/dev/null || true
  echo "Todos parados."
}

trap cleanup EXIT INT TERM

echo "============================================"
echo "  isometric-maker — todos os construtores"
echo "============================================"
echo ""
echo "  Character Builder → http://localhost:5174"
echo "  Map Builder       → http://localhost:5175"
echo ""
echo "  Pressione Ctrl+C para parar todos."
echo "============================================"
echo ""

# character-builder (porta 5174)
(cd "$ROOT/tools/character-builder" && npm run dev) &

# map-builder (porta 5175)
(cd "$ROOT/tools/map-builder" && npm run dev) &

# Espera qualquer um dos filhos terminar (ou o sinal SIGINT).
# Sem isso o script morreria imediatamente e os servidores ficariam órfãos.
wait
