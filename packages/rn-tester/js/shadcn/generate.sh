#!/bin/bash
# Regenerates tailwind.generated.css from the vendored shadcn sources and the
# demo screen. Run from this directory. Uses a throwaway npx environment; the
# repo takes no Tailwind dependency — the OUTPUT is what ships, consumed by
# the stylesheet engine (js/astryx/css).
set -euo pipefail
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
npm init -y > /dev/null 2>&1
npm install --no-audit --no-fund tailwindcss@3.4.17 tailwindcss-animate@1.0.7 > /dev/null 2>&1
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || pwd)
cd - > /dev/null
cd "$(dirname "$0")"
echo '@tailwind components; @tailwind utilities;' > "$WORK/input.css"
TAILWIND_ANIMATE_PATH="$WORK/node_modules/tailwindcss-animate" "$WORK/node_modules/.bin/tailwindcss" -c ./tailwind.config.js -i "$WORK/input.css" -o ./tailwind.generated.css --minify=false
echo "generated: $(wc -l < ./tailwind.generated.css) lines"
