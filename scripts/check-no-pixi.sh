#!/usr/bin/env bash
# scripts/check-no-pixi.sh — o PixiJS não volta.
#
# O repositório rodou com dois renderizadores por um tempo: Three.js no editor
# de mapa e PixiJS no runtime do jogo exportado e no empacotador de atlas. Em
# 2026-08-05 o PixiJS saiu inteiro (ADR 0047). Este verificador existe porque
# remoção sem guarda volta: basta um `npm i pixi.js` distraído, ou uma doc
# copiada de antes, e o repositório passa a ter duas respostas para "como se
# desenha aqui".
#
# O que ele PROÍBE:
#   - a dependência `pixi.js` em qualquer package.json
#   - `import ... from 'pixi.js'` em qualquer código
#   - a palavra PixiJS/pixi.js em docs, skills e README
#
# O que ele PERMITE, de propósito:
#   - `docs/adr/` inteiro. **ADR não se edita** — é a regra do repositório, e
#     ela vale aqui com força total: as ADRs 0001, 0009 e 0014 escolheram o
#     PixiJS, a 0037 tirou metade dele e a 0047 tirou o resto. Um verificador
#     que obrigasse a apagar o nome apagaria junto o motivo de cada uma existir,
#     e a próxima pessoa a perguntar "por que Three.js?" não teria resposta.
#   - `PLANO-DE-EXECUCAO.md` e `ERROS-*.md` — são REGISTROS do que foi feito,
#     com data. Reescrevê-los para esconder que o PixiJS existiu seria falsear
#     o histórico, e `validate-plan.mjs` valida a forma deles.
#   - `pixellab` — outra coisa, outro fornecedor, e o pipeline de assets inteiro
#     depende dele.
#
# Por isso a varredura de documentação é por CAMINHO, e cobre exatamente a doc
# viva: `docs/`, `.agents/skills/`, `README.md` e `AGENTS.md`.
#
# Uso:
#   bash scripts/check-no-pixi.sh              # verificação normal
#   bash scripts/check-no-pixi.sh --self-test  # autoteste
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

# As ADRs têm licença para nomear o que foi removido — ver o cabeçalho.
ADR_ALLOW='docs/adr/'

# O próprio verificador nomeia o proibido em cada linha — excluí-lo é
# obrigatório. `--exclude` do grep casa pelo NOME do arquivo, não pelo caminho.
SELF='check-no-pixi.sh'

# A documentação VIVA — a que descreve como o repositório funciona hoje.
DOC_PATHS=(docs .agents/skills README.md AGENTS.md)

fail=0

# ---------------------------------------------------------------------------
# self-test — fabrica uma violação e verifica que ela reprova.
# ---------------------------------------------------------------------------
if [ "${1:-}" = '--self-test' ]; then
  TMP="$ROOT/.pixi-self-test.md"
  # A string é montada em pedaços para o próprio arquivo do teste não virar
  # uma violação permanente da árvore quando algo falha antes do rm.
  printf 'import { Application } from %s;\n' "'pix''i.js'" > "$TMP"
  if bash "$0" >/dev/null 2>&1; then
    rm -f "$TMP"
    echo "check-no-pixi.sh: self-test FALHOU — a violação fabricada NÃO foi detectada."
    exit 1
  fi
  rm -f "$TMP"
  echo "check-no-pixi.sh: self-test PASSOU — a violação fabricada foi detectada."
  exit 0
fi

echo ""
echo -e "${CYAN}─── sem PixiJS${NC}"

# --- 1. nenhuma dependência ------------------------------------------------
deps="$(grep -rn '"pixi\.js"' --include=package.json . \
  --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null || true)"
if [ -n "$deps" ]; then
  echo -e "  dependência: ${RED}FAIL${NC}"
  echo "$deps" | sed 's/^/        /'
  fail=1
else
  echo -e "  dependência em package.json: ${GREEN}PASS${NC}"
fi

# --- 2. nenhum import ------------------------------------------------------
imports="$(grep -rn "from ['\"]pixi\.js" . \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
  --exclude="$SELF" 2>/dev/null || true)"
if [ -n "$imports" ]; then
  echo -e "  import de código: ${RED}FAIL${NC}"
  echo "$imports" | sed 's/^/        /'
  fail=1
else
  echo -e "  import de código: ${GREEN}PASS${NC}"
fi

# --- 3. nenhuma menção em doc viva -----------------------------------------
# `-i` porque a grafia varia (PixiJS, pixijs, Pixi). O filtro de ADR vem
# depois, por caminho, e não por conteúdo.
mentions="$(grep -rniE 'pixi\.?js|\bpixi\b' \
  --include='*.md' --include='*.mdx' "${DOC_PATHS[@]}" \
  --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null \
  | grep -vE "$ADR_ALLOW" || true)"
if [ -n "$mentions" ]; then
  echo -e "  menção em documentação: ${RED}FAIL${NC}"
  echo "$mentions" | head -20 | sed 's/^/        /'
  fail=1
else
  echo -e "  menção em documentação: ${GREEN}PASS${NC}"
fi

# --- 4. controle positivo ---------------------------------------------------
# Se o repositório não tem mais Three.js, alguma coisa muito errada aconteceu e
# os três PASS acima seriam vazios em vez de verdadeiros.
if grep -rq '"three"' --include=package.json . --exclude-dir=node_modules 2>/dev/null; then
  echo -e "  controle positivo (three está instalado): ${GREEN}PASS${NC}"
else
  echo -e "  controle positivo (three está instalado): ${RED}FAIL${NC}"
  fail=1
fi

echo ""
if [ "$fail" -gt 0 ]; then
  echo -e "${RED}  VEREDITO: FALHOU${NC}"
  exit 1
fi
echo -e "${GREEN}  VEREDITO: PASS${NC}"
exit 0
