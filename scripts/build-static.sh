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
VIEWER_VERSION="${VIEWER_VERSION:-$(node -p 'require("./package.json").version')}"
GIT_COMMIT="${GIT_COMMIT:-$(git rev-parse --short=12 HEAD 2>/dev/null || printf 'unknown')}"
case "$BASE_PATH" in
  */aiale-dev) DEPLOYMENT_CHANNEL="${DEPLOYMENT_CHANNEL:-dev}"; DEPLOYMENT_BRANCH="${DEPLOYMENT_BRANCH:-deploy/aiale-dev}" ;;
  */aiale-06-25-2026) DEPLOYMENT_CHANNEL="${DEPLOYMENT_CHANNEL:-private}"; DEPLOYMENT_BRANCH="${DEPLOYMENT_BRANCH:-deploy/aiale-private}" ;;
  */aiale) DEPLOYMENT_CHANNEL="${DEPLOYMENT_CHANNEL:-public}"; DEPLOYMENT_BRANCH="${DEPLOYMENT_BRANCH:-deploy/aiale-public}" ;;
  *) DEPLOYMENT_CHANNEL="${DEPLOYMENT_CHANNEL:-dev}"; DEPLOYMENT_BRANCH="${DEPLOYMENT_BRANCH:-main}" ;;
esac
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
  # The export build leaves a STATIC-export .next (export-marker.json + trailingSlash)
  # that, if a later `npm start` reuses it, breaks SERVER mode: API routes 308-redirect
  # to a trailing slash and 404. So always drop .next after a static build; the next
  # `npm run build` (server) will produce a clean server .next. This prevents the
  # "viewer connected to the DB is broken / API 404s" class of bug.
  rm -rf .next
  echo "cleared .next (static-export artifact) so server mode rebuilds clean"
}
trap restore EXIT

echo "stashing $API_DIR (route handlers can't be static-exported) ..."
mv "$API_DIR" "$API_STASH"

echo "building static export  basePath=$BASE_PATH channel=$DEPLOYMENT_CHANNEL version=$VIEWER_VERSION commit=$GIT_COMMIT ..."
STATIC_EXPORT=1 \
NEXT_PUBLIC_STATIC=1 \
NEXT_PUBLIC_BASE_PATH="$BASE_PATH" \
NEXT_PUBLIC_VIEWER_VERSION="$VIEWER_VERSION" \
NEXT_PUBLIC_DEPLOYMENT_CHANNEL="$DEPLOYMENT_CHANNEL" \
NEXT_PUBLIC_DEPLOYMENT_BRANCH="$DEPLOYMENT_BRANCH" \
NEXT_PUBLIC_GIT_COMMIT="$GIT_COMMIT" \
  npx next build

echo
echo "static bundle ready in ./out  (base path: $BASE_PATH)"
echo "size: $(du -sh out 2>/dev/null | cut -f1)"
echo "Hand ./out to Filipe or copy its contents into the granted webroot."
