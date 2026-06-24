#!/usr/bin/env bash
# build-static.sh — produce the static export bundle for modelseed.org hosting.
#
# Next.js `output: export` cannot include API route handlers, so we temporarily
# move src/app/api aside, run the export build, then ALWAYS restore it (even on
# failure via the trap). Server mode is never affected.
#
# Usage:
#   scripts/build-static.sh                       # base path /annotation/projects/aiale
#   BASE_PATH=/annotation/projects/myname scripts/build-static.sh
#
# Output: out/  (a self-contained static site). Hand `out/` to Filipe, or copy
# its contents into the granted webroot. Run scripts/prebake.mjs FIRST so
# public/data/ holds the current artifacts (build-static will warn if missing).
set -euo pipefail
cd "$(dirname "$0")/.."

BASE_PATH="${BASE_PATH:-/annotation/projects/aiale}"
API_DIR="src/app/api"
API_STASH=".api_stash_$$"

if [ ! -f public/data/manifest.json ]; then
  echo "WARNING: public/data/manifest.json missing. Run 'node scripts/prebake.mjs' first" >&2
  echo "         (with the server running) so the static build has data to serve." >&2
fi

restore() {
  if [ -d "$API_STASH" ]; then
    rm -rf "$API_DIR"
    mv "$API_STASH" "$API_DIR"
    echo "restored $API_DIR"
  fi
}
trap restore EXIT

echo "stashing $API_DIR (route handlers can't be static-exported) ..."
mv "$API_DIR" "$API_STASH"

echo "building static export  basePath=$BASE_PATH ..."
STATIC_EXPORT=1 \
NEXT_PUBLIC_STATIC=1 \
NEXT_PUBLIC_BASE_PATH="$BASE_PATH" \
  npx next build

echo
echo "static bundle ready in ./out  (base path: $BASE_PATH)"
echo "size: $(du -sh out 2>/dev/null | cut -f1)"
echo "Hand ./out to Filipe or copy its contents into the granted webroot."
