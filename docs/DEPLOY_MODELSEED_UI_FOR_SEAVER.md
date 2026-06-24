# AI-ALE viewer: ModelSEED-UI integration option (for Seaver)

Audience: Seaver. This describes the ALTERNATIVE deployment path where the
AI-ALE viewer is folded into ModelSEED-UI instead of hosted as a standalone
static site on Filipe's /annotation/projects path. Read this only if we decide
to integrate rather than host separately.

## Context
Chris wants a public modelseed.org home for the AI-ALE LIMS viewer. The PRIMARY
plan is a standalone static site under Filipe's path
(modelseed.org/annotation/projects/aiale) - that needs nothing from you.

This doc covers the SECONDARY option: serve it as a section of ModelSEED-UI so it
rides your existing staging -> master deploy pipeline.

## What ai-ale is (the constraint)
A Next.js app whose data comes from a 240MB LIMS SQLite snapshot. For a public
build we DO NOT ship the DB or a live query backend; we pre-bake the curated
views into small static JSON (default view ~1.25MB gzipped, per-experiment
~300KB gzipped, loaded lazily so client RAM stays low). The viewer is read-only.

## Integration shape (if we go this way)
Add the viewer as a route in ModelSEED-UI, e.g. `app/projects/aiale/`, with the
pre-baked JSON committed under `public/` (or fetched from a known static path).
Because the data is already static JSON, it fits your build with no backend
work: no API routes, no DB connection, no new server dependency.

I (Vibhav) would follow the standard ModelSEED-UI release workflow from the
CLAUDE.md / modelseed-ui skill:
  1. branch off staging
  2. implement + pass the full CI gate locally
     (npm run lint, npx tsc --noEmit, npm run test:run, npm run build,
      npm audit --omit=dev --audit-level=high)
  3. merge to local staging, push origin staging
  4. open PR base ModelSEED/ModelSEED-UI:staging, head VibhavSetlur:staging
  5. you review/merge/deploy to staging.modelseed.org, then staging->master to prod.

I do not deploy and do not push to upstream; that stays with you.

## Trade-offs vs the standalone static path
- INTEGRATION (this doc): one fewer separately-hosted thing; rides your CI +
  deploy; lives under modelseed.org/projects/... in the main app. Cost: a PR to
  review, the baked JSON lives in the UI repo, and data refreshes mean a new PR.
- STANDALONE STATIC (Filipe): zero changes to ModelSEED-UI, independent refresh
  cadence, but a separate hosted folder. Data refreshes are just re-placing files
  on Filipe's side, no PR.

Recommendation: start with the standalone static path (faster, no PR churn on
data refreshes). Fold into ModelSEED-UI later if Chris wants it inside the main
app shell.

## What I would need from you (only if we integrate)
- Confirm the desired route path (modelseed.org/projects/aiale vs /annotation/...)
- Confirm where baked JSON should live (in-repo public/ vs an external static URL)
- Normal PR review + staging deploy on your cadence.

## Contact
- Vibhav (vsetlur@anl.gov) - writes the PR, maintains the bake pipeline.
