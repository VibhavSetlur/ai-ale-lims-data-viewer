# CLAUDE.md - ai-ale-lims-data-viewer

Agent operating rules for this repo. Read before working here. Project-specific
conventions (data model, deploy, db quirks) live in the `ai-ale-lims-viewer`
skill; this file is the short standing-orders list Vibhav set.

## Standing orders (Vibhav, 2026-06)

1. AUTO-FIX, THEN INFORM. When you find a viewer bug or data-handling problem in
   this project, just fix it. Do not ask permission first. Fix it, verify it
   live (build clean + restart + curl the API to prove the change), commit, push
   to main (fast-forward, no PR), then tell Vibhav what you did. Only pause for
   confirmation when a fix changes user-visible default BEHAVIOR in a way that is
   a genuine product decision (and even then, prefer shipping the safe version
   and flagging it).

2. NATASCHA / UPSTREAM ITEMS GO TO SLACK. Findings that are NOT viewer-fixable
   (upstream db / pipeline / sync gaps that are Natascha's or Chris's to fix) get
   compiled into a formatted Slack cron message to Vibhav (not auto-sent to
   anyone else). ONLY send items that are DIFFERENT from ones already sent in past
   audit Slack messages (check ~/.hermes/scripts/aiale_audit_*.sh for prior
   content). If there is nothing new, do not send a message.

3. FORMATTED SLACK = use the standard wrapper. Build the body with
   ~/.hermes/scripts/slack_msg.sh "ai-ale-lims-viewer" "TYPE" <<'BODY'...BODY,
   save a one-shot wrapper under ~/.hermes/scripts/, then schedule it via
   cronjob (no_agent=true, repeat=1, ~1min out, deliver=slack:D0BCDJ6UZ8U) and
   LET THE TICK FIRE IT (do not action=run, that dupes). This formatted-Slack-cron
   workflow is GLOBAL across all of Vibhav's projects, recorded in agent memory.

4. STYLE: no em-dashes anywhere (commit messages, UI copy, warnings, Slack).
   First-person, direct, concise.

5. DEPLOY GUARDRAIL (HARD). NEVER write/modify/touch fliu's workspace
   (/scratch1/fliu/... including the LIMS mirror and
   /scratch1/fliu/html/modelseed_annotation/projects) or anyone else's space.
   Edit ONLY Vibhav's own repos: this one and ModelSEED-UI. Anything that must
   happen in fliu's space (create the project folder, grant perms, place the
   built static files) or in ModelSEED prod (deploy) is HANDED OFF via Slack to
   fliu / Seaver for THEM to do. We produce the artifact + instructions only.
   ModelSEED deploy = PR to Seaver (see the modelseed-ui skill). The static path
   for the public site = fliu.

## Deployment (dual-mode: server + static)
This app has TWO build modes from one codebase:
- SERVER mode (default): `npm run build` + `npm start`. Full app incl. the raw
  Database-Tables browser and live CSV export. Runs on poplar:3457 behind nginx.
- STATIC mode (public modelseed.org): for fliu's static webroot (no server, like
  Escher). The curated views (Mutation Explorer, Copy Number, Barcode Charts)
  read PRE-BAKED gzipped JSON; the raw browser + live export are hidden.

Build the static bundle (refresh story when the DB changes):
```
# 1. server must be running so prebake can snapshot the API (ops/serve.sh)
npm run prebake          # API -> public/data/*.json(.gz) + manifest.json
npm run build:static     # -> out/  (basePath=/annotation/projects/aiale)
# then hand out/ to fliu OR copy its contents into the granted webroot
```
Override the URL base path: `BASE_PATH=/annotation/projects/<name> npm run build:static`.

## TWO static deployments (same codebase, different basePath) - 2026-06-25
There are now TWO live static deployments built from this ONE viewer codebase,
differing only by build-time `BASE_PATH`:

1. PUBLIC (what everyone sees): https://modelseed.org/annotation/projects/aiale/
   Webroot: /scratch1/fliu/html/modelseed_annotation/projects/aiale/
2. PRIVATE / unlisted (Dr. Henry wants a separate, less-noticeable link shared
   only by URL): https://modelseed.org/annotation/projects/aiale-06-25-2026/
   Webroot: /scratch1/fliu/html/modelseed_annotation/projects/aiale-06-25-2026/
   (fliu created this folder 2026-06-25.) This is the WORKING / version-control
   copy - the one to actually iterate on. The poplar:3457 server instance stays
   up but is not really used day to day.

Build + deploy EACH with its own base path (data is shared/baked the same):
```
# build for a target folder
BASE_PATH=/annotation/projects/aiale            npm run build:static  # public
BASE_PATH=/annotation/projects/aiale-06-25-2026 npm run build:static  # private
# then copy out/. into that folder's webroot and FIX PERMS:
find <webroot> -type d -exec chmod 755 {} \; ; find <webroot> -type f -exec chmod 644 {} \;
```
RIGHT NOW both URLs are intentionally IDENTICAL (same viewer, same data).

FUTURE PLAN (do NOT implement yet, just know it): one viewer codebase, but each
deployment shows different client-side views purely based on WHICH baked
data/tables EXIST in that deployment (version-control style). E.g. a build without
Barcode Charts, or showing only certain samples, in one version vs another. The
viewer should auto-hide a view when its data is absent (data-driven gating), so we
ship the same viewer everywhere and differentiate by the baked artifacts. Not
built yet.

Both fliu webroots: fliu owns them, group cels group-writable, vsetlur can write
FILES (explicitly granted). CRITICAL: after copying, ALWAYS chmod 644 files + 755
dirs or nginx returns 403 (files default to 600).
Full step-by-step re-deploy: docs/DEPLOY_RUNBOOK_LIVE.md.

Key files:
- `scripts/prebake.mjs` - snapshots live API responses to static artifacts (so
  static == server, no duplicated query logic). One artifact per experiment +
  default; client lazy-loads ONE at a time so browser RAM stays low.
- `scripts/build-static.sh` - stashes src/app/api (route handlers can't be
  static-exported), runs `next build` with output:export, always restores api.
- `src/lib/dataSource.ts` - `fetchData()` + `IS_STATIC`. Server mode = live
  /api/*; static mode = baked files. Curated components route through it.
- `next.config.ts` - dual-mode (STATIC_EXPORT=1 -> output:export + basePath).

Hand-off docs (keep accurate when ports/paths/names change):
- `docs/DEPLOY_STATIC_FOR_FILIPE.md` - static hosting on fliu's path (primary).
- `docs/DEPLOY_MODELSEED_UI_FOR_SEAVER.md` - fold-into-ModelSEED-UI alternative.
- `docs/DEPLOY_SUMMARY_FOR_HENRY.md` - high-level what/why/where.
- `docs/DEPLOYMENT_DESIGN.md` - full architecture + RAM/refresh strategy.
- `DEPLOY.md` - the original server-mode/nginx handoff for Dan/Boris.

## Quick reference (see the skill for full detail)
- Env: `source /scratch/vsetlur/anaconda3/etc/profile.d/conda.sh && conda activate ai-ale-dev`
- Live deploy: tmux `ai-ale-viewer`, port 3457. Restart: `./ops/stop.sh && ./ops/serve.sh`
- Verify: `curl -s http://localhost:3457/api/health` then curl /api/mutations
- DB: `data/lims_indexed.db` (indexed mirror). Inspect via Python sqlite3 (no CLI).
- Git: feature work then fast-forward main + push. No dev branch, no PR gate.
- Audit probes: `scripts/audit-db.py` (integrity) and the scientific-validity
  pass in docs/DEEP_DIVE_AUDIT-*.md.
