#!/usr/bin/env bash
# Valida as convenções de documentação e confere que todo endpoint citado nas
# docs existe no spec vendorizado do PixelLab.
#
# Existe para impedir que a documentação nova envelheça do jeito que a antiga
# (/home/ondokai/Projects/tech-docs/games/5.md) envelheceu.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0

echo "== convenções de doc =="
while IFS= read -r f; do
  probs=""
  [ "$(grep -c '^# ' "$f")" -eq 1 ] || probs="$probs h1-unico"
  grep -q '^> \*\*Quick Start (TL;DR)\*\*' "$f" || probs="$probs quick-start-blockquote"
  grep -q '^## Referências' "$f" || probs="$probs secao-referencias"
  grep -q '^\*\*Última atualização:\*\* [0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}$' "$f" || probs="$probs ultima-atualizacao"
  [ -n "$probs" ] && { echo "  FALHA $f:$probs"; fail=1; }
done < <(find docs -name '*.md')
[ $fail -eq 0 ] && echo "  ok: $(find docs -name '*.md' | wc -l) docs conformes"

echo "== endpoints citados existem no spec vendorizado =="
python3 - "$@" <<'PY' || fail=1
import json, re, pathlib, sys

SPEC = 'tools/pixellab-pipeline/openapi/openapi-v2.json'
# Nomes da v1 citados de propósito, para documentar o que MUDOU. Não são erro.
DELIBERATE_V1 = {
    '/generate-image-pixflux', '/generate-image-bitforge',
    '/animate-skeleton', '/generate-image-v1',
}

paths = set(json.load(open(SPEC))['paths'])
norm = lambda p: re.sub(r'\{[a-z_]+\}', '{X}', p)
known = {norm(p) for p in paths}

bad = []
for f in pathlib.Path('docs').rglob('*.md'):
    for m in re.finditer(r'`(/[a-z0-9][a-z0-9\-/{}_]*)`', f.read_text()):
        p = m.group(1)
        if p.startswith('/home/') or p in DELIBERATE_V1:
            continue
        if norm(p) not in known:
            bad.append((str(f), p))

if bad:
    for f, p in bad:
        print(f'  FALHA {f}: {p} não existe no spec v2')
    sys.exit(1)
print('  ok: todo endpoint citado existe no spec')
PY

exit $fail
