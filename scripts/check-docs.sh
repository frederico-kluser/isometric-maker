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
  # AGENTS.md fica de fora de propósito: é arquivo de instrução, não documento.
done < <(find docs -name '*.md'; printf '%s\n' README.md tools/*/README.md)
[ $fail -eq 0 ] && echo "  ok: $(( $(find docs -name '*.md' | wc -l) + 1 + $(ls -1 tools/*/README.md | wc -l) )) docs conformes"

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

echo "== o MMORPG não voltou =="
# O produto virou um editor isométrico de usuário único (docs/adr/0010). Estes termos
# descrevem o produto anterior. Sem esta trava, ele volta a crescer por um parágrafo
# bem-intencionado — prosa não garante escopo, verificador garante.
#
# Duas isenções, ambas carregadas:
#   docs/adr/        — decisão registrada é registro histórico; as ADRs congeladas
#                      legitimamente contêm estes termos, e editá-las é proibido.
#   00-produto/visao.md — o documento cujo trabalho É nomear o escopo removido.
#   docs/README.md   — o índice, que precisa nomear as ADRs apagadas e datar o pivô.
python3 - <<'PY' || fail=1
import pathlib, re, sys

TERMOS = ['permadeath', 'full loot', 'servidor autoritativo', 'PvP', 'MMO', 'Power Abuse']
ISENTOS = ('docs/adr/', 'docs/00-produto/visao.md', 'docs/README.md')

bad = []
for f in sorted(pathlib.Path('docs').rglob('*.md')):
    s = str(f)
    if any(s.startswith(i) or s == i for i in ISENTOS):
        continue
    for n, linha in enumerate(f.read_text().splitlines(), 1):
        for t in TERMOS:
            if re.search(re.escape(t), linha, re.IGNORECASE):
                bad.append((s, n, t))

if bad:
    for f, n, t in bad:
        print(f'  FALHA {f}:{n}: termo do produto anterior — "{t}"')
    sys.exit(1)
print('  ok: nenhum termo do produto anterior nas docs vivas')
PY

echo "== todo link markdown aponta para algo que existe =="
# A onda de exclusão do pivô é exatamente o que cria link pendurado, e até aqui
# nada verificava isso. docs/adr/ é isento: uma ADR congelada apontando para o
# mundo como ele era é o registro funcionando, e consertar exigiria editá-la.
python3 - <<'PY' || fail=1
import pathlib, re, sys

ALVOS = list(pathlib.Path('docs').rglob('*.md')) + [pathlib.Path('README.md')] \
        + sorted(pathlib.Path('tools').glob('*/README.md'))
LINK = re.compile(r'\]\(([^)\s]+)\)')

bad = []
for f in ALVOS:
    if str(f).startswith('docs/adr/'):
        continue
    for n, linha in enumerate(f.read_text().splitlines(), 1):
        for m in LINK.finditer(linha):
            alvo = m.group(1)
            if re.match(r'^(https?:|mailto:|#)', alvo):
                continue
            alvo = alvo.split('#', 1)[0]
            if not alvo:
                continue
            if not (f.parent / alvo).exists():
                bad.append((str(f), n, alvo))

if bad:
    for f, n, alvo in bad:
        print(f'  FALHA {f}:{n}: link para "{alvo}", que não existe')
    sys.exit(1)
print('  ok: todo link markdown resolve')
PY

exit $fail
