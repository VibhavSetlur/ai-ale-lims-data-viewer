#!/usr/bin/env bash
# build-static.sh — produce the static export bundle for modelseed.org hosting.
#
# Next.js `output: export` cannot include API route handlers, so we temporarily
# move src/app/api aside, run the export build, then ALWAYS restore it (even on
# failure via the trap). Server mode is never affected.
#
# Usage:
#   scripts/build-static.sh                       # base path /annotation/projects/aiale-dev
#   BASE_PATH=/annotation/projects/aiale scripts/build-static.sh
#   scripts/build-static.sh --validate-config     # validate without building
#
# Output: out/  (a self-contained static site). Hand `out/` to Filipe, or copy
# its contents into the granted webroot. Run scripts/prebake.mjs FIRST so
# public/data/ holds the current artifacts (build-static will warn if missing).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${1:-}" = "--help" ]; then
  echo "Usage: BASE_PATH=/annotation/projects/aiale-dev scripts/build-static.sh"
  echo "       scripts/build-static.sh --validate-config"
  exit 0
fi

# Preserve an explicitly empty root for local KIND bundles; only an unset value
# receives the static-dev default.
BASE_PATH="${BASE_PATH-/annotation/projects/aiale-dev}"
case "$BASE_PATH" in
  /annotation/projects/aiale|/annotation/projects/aiale-dev|'') ;;
  *)
    echo "ERROR: static builds support only /annotation/projects/aiale, /annotation/projects/aiale-dev, or an empty KIND root path" >&2
    exit 2
    ;;
esac
# Static-dev is the safe default. A release promotion may explicitly bake static
# identity without changing this worktree's branch.
STATIC_DEVELOPMENT="${STATIC_DEVELOPMENT:-0}"
case "$STATIC_DEVELOPMENT" in
  0) DEFAULT_BRANCH="static" ;;
  1) DEFAULT_BRANCH="static-dev" ;;
  *) echo "ERROR: STATIC_DEVELOPMENT must be 0 or 1" >&2; exit 2 ;;
esac
EXPECTED_BRANCH="${DEPLOYMENT_BRANCH:-$DEFAULT_BRANCH}"
case "$EXPECTED_BRANCH" in static|static-dev) ;; *) echo "ERROR: DEPLOYMENT_BRANCH must be static or static-dev" >&2; exit 2 ;; esac
EXPECTED_CHANNEL="${DEPLOYMENT_CHANNEL:-$DEFAULT_BRANCH}"
case "$EXPECTED_CHANNEL" in static|static-dev) ;; *) echo "ERROR: DEPLOYMENT_CHANNEL must be static or static-dev" >&2; exit 2 ;; esac
if [ "$EXPECTED_CHANNEL" != "$EXPECTED_BRANCH" ]; then
  echo "ERROR: DEPLOYMENT_CHANNEL and DEPLOYMENT_BRANCH must match" >&2
  exit 2
fi
if [ "${1:-}" = "--validate-config" ]; then
  printf 'static build configuration valid: base path=%s channel=%s branch=%s\n' "$BASE_PATH" "$EXPECTED_BRANCH" "$EXPECTED_BRANCH"
  exit 0
fi
VIEWER_VERSION="${VIEWER_VERSION:-$(node -p 'require("./package.json").version')}"
GIT_COMMIT="${GIT_COMMIT:-$(git rev-parse --short=12 HEAD 2>/dev/null || printf 'unknown')}"
DEPLOYMENT_CHANNEL="$EXPECTED_CHANNEL"
DEPLOYMENT_BRANCH="$EXPECTED_BRANCH"
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
NEXT_PUBLIC_DATA_PROFILE="${DATA_PROFILE:-unknown}" \
NEXT_PUBLIC_RELEASE_TARGET="${RELEASE_TARGET:-unknown}" \
  npx next build

echo
echo "static bundle ready in ./out  (base path: $BASE_PATH)"
echo "size: $(du -sh out 2>/dev/null | cut -f1)"
echo "Hand ./out to Filipe or copy its contents into the granted webroot."
