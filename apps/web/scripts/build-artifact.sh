#!/usr/bin/env bash
# Gera dist-artifact/artifact.html: modo "Treinar contra o computador" em um único arquivo HTML.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf src/_inline dist-artifact
mkdir -p src/_inline
for d in cards suits icons avatars badges brand table; do cp -r "public/assets/$d" "src/_inline/$d"; done
ARTIFACT=1 VITE_LOCAL_ONLY=1 npx vite build
rm -rf src/_inline
python3 - <<'PY'
import re
html = open('dist-artifact/index.html', encoding='utf-8').read()
styles = re.findall(r'<style[^>]*>.*?</style>', html, flags=re.S)
scripts = re.findall(r'<script[^>]*>.*?</script>', html, flags=re.S)
page = '<title>Buraco Treino</title>\n' + '\n'.join(styles) + '\n<style>:root{--safe-top:0px;--safe-bottom:0px}</style>\n<div id="root"></div>\n' + '\n'.join(scripts) + '\n'
page = re.sub(r"url\(['\"]?/assets/[^)]*\)", 'none', page)
open('dist-artifact/artifact.html', 'w', encoding='utf-8').write(page)
print('artifact.html', len(page) // 1024, 'KB')
PY
