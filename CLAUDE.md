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
   /scratch1/fliu/html/modelseed_annotation/projects) or anyone else's space,
   EXCEPT the three approved static viewer webroots listed below when Vibhav
   explicitly asks for a static deploy or static test. Edit only the contents of
   those approved webroots, never the fliu-owned top directory. Anything outside
   those paths is handed off via Slack to fliu / Seaver. ModelSEED deploy = PR to
   Seaver (see the modelseed-ui skill).

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

## Static Deployment Branches and URLs
Static deployments are tracked by dedicated branch pointers so we always know
which code revision is deployed where. `main` is the integration branch. Do not
assume `main` equals production.

- DEV / test: branch `deploy/aiale-dev`
  URL: https://modelseed.org/annotation/projects/aiale-dev/
  Webroot: /scratch1/fliu/html/modelseed_annotation/projects/aiale-dev/
  DB baked in: full mirror (`data/lims_indexed.db`). Barcode tab SHOWN.
- PUBLIC / production publication snapshot: branch `deploy/aiale-public`
  URL: https://modelseed.org/annotation/projects/aiale/
  Webroot: /scratch1/fliu/html/modelseed_annotation/projects/aiale/
  DB baked in: TFMN1 trimmed (`data/lims_TFMN1_indexed.db`). Barcode tab HIDDEN.
- PRIVATE / production internal full instance: branch `deploy/aiale-private`
  URL: https://modelseed.org/annotation/projects/aiale-06-25-2026/
  Webroot: /scratch1/fliu/html/modelseed_annotation/projects/aiale-06-25-2026/
  DB baked in: full mirror (`data/lims_indexed.db`). Barcode tab SHOWN.

Branch rules:
- Feature/fix work lands on `main` first.
- To test a release, fast-forward `deploy/aiale-dev` to the chosen `main` commit,
  bake with `BASE_PATH=/annotation/projects/aiale-dev` and `data/lims_indexed.db`,
  deploy to the dev webroot, then verify over HTTPS.
- Only after the dev URL is accepted, fast-forward `deploy/aiale-public` and/or
  `deploy/aiale-private` to the accepted commit and deploy each URL with its own
  DB and `BASE_PATH`.
- Never move a production deploy branch unless that exact URL has been rebuilt,
  copied, permission-fixed, and HTTPS-verified.
- If a hotfix applies only to one URL, branch from that deploy branch, merge or
  cherry-pick intentionally, then update only the matching deploy branch after
  verification. Do not silently let the static URL diverge from its deploy branch.

## TWO static deployments (same codebase, DIFFERENT databases) - updated 2026-06-25
TWO live static deployments built from this ONE viewer codebase. They differ by
build-time `BASE_PATH` AND by WHICH DATABASE is baked in. Full procedure:
static branch rules above plus docs/ARCHITECTURE.md section 3-4.

1. PUBLIC (publication snapshot, launches with the robotic paper):
   https://modelseed.org/annotation/projects/aiale/
   Webroot: /scratch1/fliu/html/modelseed_annotation/projects/aiale/
   DB baked in: TFMN1 trimmed (data/lims_TFMN1_indexed.db, NO verAB_barcodes).
   -> Barcode Charts tab auto-HIDDEN here (hasBarcodes is false).
2. PRIVATE / unlisted (internal full instance; share by URL only):
   https://modelseed.org/annotation/projects/aiale-06-25-2026/
   Webroot: /scratch1/fliu/html/modelseed_annotation/projects/aiale-06-25-2026/
   DB baked in: full mirror (data/lims_indexed.db). -> Barcode tab SHOWN.

DATA-DRIVEN GATING IS LIVE (implemented, not future): /api/mutations stats carries
`hasBarcodes` (verAB_barcodes exists AND non-empty). The Barcode tab renders only when
true; a guard kicks a restored 'barcodes' tab back to Comparative when absent. Same
codebase everywhere; the visible surface is driven by what is in each baked DB. To add a
view to an instance, bake a DB that has its data - no code fork.

Deploy EACH instance against ITS db (point the server at that DB before prebake +
prepare-httpvfs-db.sh so the baked artifacts + httpvfs DB match). Mirror with
`rsync -a --delete --no-perms --omit-dir-times out/ <webroot>/` then fix perms on
CONTENTS (files 644, dirs 755; never the top dir - fliu owns it). The poplar:3457 server
instance stays up but is not used day to day.

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
- Git: feature work lands on `main`; static URL state is tracked by `deploy/aiale-dev`, `deploy/aiale-public`, and `deploy/aiale-private`.
- Audit probes: `scripts/audit-db.py` (integrity) and the scientific-validity
  pass in docs/DEEP_DIVE_AUDIT-*.md.
