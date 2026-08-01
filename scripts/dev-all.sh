#!/usr/bin/env bash
# dev-all.sh — sobe os construtores com interface e os mata junto no Ctrl+C.
#
#   npm run dev         (da raiz)
#   bash scripts/dev-all.sh
#
# O runtime (tools/runtime) precisa de um projeto exportado e não sobe aqui —
# exporte do map-builder primeiro, depois: cd tools/runtime && npm run play -- <projeto.json>

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Mata processos antigos nas portas que vamos usar.
kill_port() {
  local pid
  pid=$(lsof -ti "tcp:$1" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    sleep 0.3
  fi
}

kill_port 5174
kill_port 5175

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

# Pequena pausa para o Vite abrir o navegador no character-builder primeiro.
sleep 2

# map-builder (porta 5175)
(cd "$ROOT/tools/map-builder" && npm run dev) &

wait
