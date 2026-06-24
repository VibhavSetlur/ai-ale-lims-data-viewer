# Meeting prep: nspahr (Natascha) agenda, 2026-06-24

Her message raised 5 points. Status of each below: what I already implemented, and
what is a discussion/decision for the meeting.

## 1. Browse experimental data for one experiment (prefer TFMN1) + cosmetic wish list
MEETING ACTIVITY, nothing to build yet. The viewer is ready for this:
- Live (collaborator-facing, static): https://modelseed.org/annotation/projects/aiale/
  Pick TFMN1 in the EXPERIMENT dropdown. Mutation Explorer, Comparative View (now
  with user-configurable multi-level column grouping: experiment > condition >
  strain > dna > replicate, reorderable), Copy Number, Barcode Charts all work.
- Internal (full server, raw + live export): poplar:3457.
- Her cosmetic wish list is not yet specified. CAPTURE IT VERBATIM at the meeting,
  then it is auto-fixable viewer work per standing orders. Likely buckets to expect:
  axis labels, color choices, default sort, label truncation, units, density. All
  of these are quick viewer changes.

## 2. Define scope of data exposure: collaborator version vs TFMN1-publication version
DECISION FOR THE MEETING (with a concrete proposal ready). The dual-mode build
already makes this cheap to act on:
- We have TWO deploy modes from one codebase:
  - STATIC public (modelseed.org/annotation/projects/aiale): curated views +
    deep-queryable Database Tables (sql.js-httpvfs over the DB). Currently exposes
    ALL experiments + the full DB.
  - SERVER internal (poplar:3457): everything, live.
- Two scoping levers we can pull per audience, cheaply:
  (a) WHICH EXPERIMENTS: the prebake + DB-prep can be filtered to a single
      experiment (e.g. only TFMN1) for a publication build, vs all-experiments for
      collaborators. One env/flag at build time.
  (b) WHICH VIEWS: the static build already hides server-only things; we can hide
      the raw Database Tables browser for a publication build (curated views only)
      while keeping it for collaborators.
- PROPOSAL to put to her: keep the current all-experiments build as the
  collaborator version (behind the modelseed URL, which is fliu's separate conduit,
  not fully public-indexed), and produce a SEPARATE TFMN1-only curated build (no raw
  table browser, only the figures for the paper) when the publication scope is
  locked. Decide: does the publication version need the raw data browser at all, or
  just the curated figures? Does it go to a different URL?
- ACTION if she decides: a TFMN1-only publication build is a few hours of work
  (filter prebake + DB to TFMN1, flag-hide the table browser, new BASE_PATH).

## 3. Last two audit issues
### 3a. Genes (24% of named calls not in the Genes table)
DECISION FOR HER, not a viewer bug. Facts: 223,222 named mutation calls; 76% have a
gene_name that IS an ID in the Genes table, 24% (54,072) do NOT. The unlinkable ones
are almost all INTERGENIC labels in breseq's "flanking-gene-A/flanking-gene-B"
notation, e.g. ACIAD_RS00450/ACIAD_RS00455, ACIAD_RS00700/guaA. These are not single
genes, so they cannot just be "added to the Genes table" as-is. Nothing is broken
today: the viewer shows gene_name straight off the row. The question only bites IF we
build a "show gene function" feature, which does not exist yet. So I did NOT build
speculative gene-linkage UI (would be scope creep against a non-existent feature).
DECISION to get from her: when/if we add gene-function lookup, do we (i) parse
intergenic A/B labels and show both flanking genes' functions, (ii) load intergenic
regions into a separate table, or (iii) leave gene_name as free-text from breseq?
Recommend (i) parse-on-read, no DB change.

### 3b. Breseq params (TFMN4 runs missing from Breseq_registry)
ROOT FIX IS HERS (a pipeline op she already said she still needs to build), BUT I
shipped the viewer-side honest handling TODAY (commit 8ee8bb9, live):
- 3 breseq runs (a3961e6844 ~36k, 6f4ff9aa5b ~18k, e4545f1b6d ~0.7k calls, all
  TFMN4) are referenced by mutations but absent from Breseq_registry, so their params
  and reference genome were rendering as silent blanks.
- The viewer now FLAGS these: the registry dropdown labels them "params not
  registered yet" and the API emits a clear warning ("N breseq runs are referenced by
  mutations but not yet in the Breseq_registry table ... the calls are real, the run
  metadata just has not been synced yet"). Verified live.
- So the gap is now honest in the tool instead of looking like missing/empty data.
  When she syncs the TFMN4 runs into Breseq_registry, the params populate
  automatically (the viewer already LEFT JOINs them) and the flag clears.

## 4. Guidance on agentic coding setup + refactoring during active method development
DISCUSSION / ADVICE for the meeting, nothing to build. Talking points:
- This whole viewer has been built and maintained agentically (Hermes + Claude/Codex
  CLIs). What works here: a CLAUDE.md of standing orders in the repo, a skill file
  with the data model + gotchas, auto-fix-then-inform for viewer bugs, formatted
  status messages, and verify-live (build + restart + curl/browser) before claiming
  done.
- On refactoring while analysis methods are ACTIVELY developed (her real concern):
  the pattern that works is decouple the SLOW-CHANGING contract from the
  FAST-CHANGING method. Concretely for this project: the viewer reads a STABLE
  schema (Seq_samples, Mutations, Copy_numbers, ...); when an analysis method
  changes (new breseq params, new CN caller), it lands as new ROWS / new registry
  IDs, not a new schema, so the viewer keeps working without a refactor. Keep the
  method's output conforming to the existing table contract and the downstream tools
  do not churn. When the contract itself must change, version it (new table or new
  column) rather than mutating in place, so old views do not silently break.
- Offer: I can write up a short "how we do agentic coding on this project" note if
  useful.

## Quick reference for the meeting
- Live collaborator build: https://modelseed.org/annotation/projects/aiale/
- What shipped recently: default-view registry fix (no more ~200x undercount),
  Copy Number chart redesign (scrollable legend, isolate), deep-queryable static
  Database Tables, Comparative multi-level grouping (Natascha), Barcode Charts
  interactivity pass, and today's unregistered-breseq-run flag.
