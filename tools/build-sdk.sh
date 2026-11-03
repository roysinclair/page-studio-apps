#!/usr/bin/env bash
# Rebuilds the vendored Anthropic SDK that is embedded in page-aura.html.
# The SDK is bundled into the page (instead of loaded from a CDN at runtime)
# so the code that handles your API key can't be swapped out by a third party.
#
# Usage: tools/build-sdk.sh [sdk-version]   (default 1.4.0)
# Then:  python3 tools/update-csp.py
set -euo pipefail
VER="${1:-1.4.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
npm init -y >/dev/null
npm install --silent "@anthropic-ai/sdk@${VER}" esbuild@0.23.1
echo 'export { default } from "@anthropic-ai/sdk";' > entry.mjs
npx esbuild entry.mjs --bundle --minify --format=iife --global-name=AnthropicSDK \
  --platform=browser --target=es2020 --legal-comments=eof --outfile=sdk.iife.js
python3 - "$ROOT/page-aura.html" sdk.iife.js "$VER" <<'PY'
import sys, re
page, bundle, ver = sys.argv[1], sys.argv[2], sys.argv[3]
html = open(page, encoding="utf-8").read()
js = open(bundle, encoding="utf-8").read()
assert "</script" not in js.lower()
block = f'<script id="vendor-anthropic-sdk">/* @anthropic-ai/sdk {ver} — bundled by tools/build-sdk.sh */\n{js}</script>'
html, n = re.subn(r'<script id="vendor-anthropic-sdk">.*?</script>', lambda m: block, html, flags=re.S)
assert n == 1, "vendor block not found"
open(page, "w", encoding="utf-8").write(html)
print(f"Embedded @anthropic-ai/sdk {ver} ({len(js)//1024} KB)")
PY
