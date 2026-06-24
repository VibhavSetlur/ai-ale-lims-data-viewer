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

## Quick reference (see the skill for full detail)
- Env: `source /scratch/vsetlur/anaconda3/etc/profile.d/conda.sh && conda activate ai-ale-dev`
- Live deploy: tmux `ai-ale-viewer`, port 3457. Restart: `./ops/stop.sh && ./ops/serve.sh`
- Verify: `curl -s http://localhost:3457/api/health` then curl /api/mutations
- DB: `data/lims_indexed.db` (indexed mirror). Inspect via Python sqlite3 (no CLI).
- Git: feature work then fast-forward main + push. No dev branch, no PR gate.
- Audit probes: `scripts/audit-db.py` (integrity) and the scientific-validity
  pass in docs/DEEP_DIVE_AUDIT-*.md.
