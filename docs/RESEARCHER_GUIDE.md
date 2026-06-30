# AI-ALE LIMS Viewer — Researcher Guide

A practical guide for lab members who use the viewer to explore adaptive
laboratory evolution (ALE) data, find results, build figures, and write them up.
It is written for biologists, and it is deliberately explicit so the same text
can be pasted into an institution-approved AI assistant when planning an
analysis (do not paste credentials or private database paths).

The viewer is read-only over a snapshot of the lab LIMS. Every value shown is
either stored in the database or computed transparently from stored values, and
the interface marks derived quantities with an info (i) button. Nothing is
invented: when a value is absent the viewer says so rather than guessing.

---

## 1. The study this data comes from

The publication snapshot is the automated-ALE study of *Acinetobacter baylyi*
ADP1 strain **ACN2586** adapting to prototrophic growth on **pyruvate** as the
sole carbon source. Key design facts that shape how you read the viewer:

- **55 lineages across 11 genotype backgrounds**: the parent ACN2586 (no donor
  DNA), four single-mutation backgrounds (donor DNA carrying **fba** P44L,
  **tpiA** A177V, **pgi** G275D, or **sohB** truncation), and six pairwise
  combinations. Each background = 5 replicate lineages.
- **32 transfer cycles**, with whole-genome sequencing at sampled timepoints
  (around T1, T5, T8/T11, T20, T32). OD590 was monitored continuously.
- **Headline finding: dgoA\* copy-number amplification** is a convergent,
  genotype-independent adaptive response that correlates with improved growth.
  This is the single most important readout in the viewer.
- **fba and tpiA** mutations integrated stably; **pgi and sohB** often failed to
  integrate or appeared only transiently at low allele frequency. Some lineages
  acquired **spontaneous** mutations (e.g. secondary fba alleles, or fba arising
  in a tpiA background).

What this means for the viewer: the Copy Number tab is where the main result
lives, the Comparative View is where you see which mutations are present and at
what frequency, and the growth curves are how you connect genotype to phenotype.

---

## 2. The two workspaces and four views

Switch workspaces from the left sidebar.

- **Database Tables** (interactive/server build only): raw LIMS tables with
  search, sort, filters, pagination, CSV export. Use it to audit source rows.
- **Mutation Explorer**: the curated scientific views.
  - **Sample Selection** — filter and pick the samples/lineages to study.
  - **Comparative View** — heatmap of mutation frequency + copy-number rows.
  - **Copy Number** — per-lineage copy-number trajectories over transfers.
  - **Barcode Charts** — VerA/VerB barcode composition (only when the snapshot
    contains barcode data; the public TFMN1 snapshot hides it).

The Help, Guide, and Interactive Tutorial buttons live in the left sidebar under
**Help & Learning**. The Guide answers "how do I..." and walks you to the right
view; the Tutorial spotlights each control in turn.

---

## 3. Finding the key results

### dgoA\* amplification (the main finding)
1. Open **Copy Number**.
2. Each line is one lineage; Y = copy number, X = transfer.
3. Look for lines rising above the **CN = 1x** baseline toward 2-3x (outlier
   backgrounds such as fba, pgi, and tpiA+pgi push past 3-4x).
4. Click a legend entry to **isolate** one lineage and read its trajectory.
5. Use the legend search to jump to a background of interest.

### Which mutations are present, and how much
1. Select samples, then open **Comparative View**.
2. Frequency rows are colored on a **fixed 0% to 100%** scale; copy-number rows
   use a **row-local** min/max scale (so a region's amplification gradient is
   readable). This is the only place the scales differ, and it is intentional.
3. **Provided vs spontaneous**: a mutation supplied as donor DNA has an amber
   outline. An amber outline with no fill and a 0% marker = provided but never
   observed (e.g. pgi/sohB that did not integrate). No outline = spontaneous
   (e.g. secondary fba alleles).
4. Click a mutation name for genome context; use the class pills to focus on
   missense, nonsense, indel, or deletion.

### Growth phenotype
1. Click any OD600 sparkline to open the growth-curve popup.
2. Toggle **Log (ln OD)** so exponential phase reads as a straight line.
3. Metrics (max OD/K, mu, doubling, lag, AUC) are **descriptive point-to-point
   estimates** from the observed points, not model fits. Click "How is each
   value computed?" in the popup for the exact formulas.
4. If a sample has no numeric series, the popup says so and shows only an OD file
   reference when one exists. Do not infer a growth rate in that case.

### NG and NS (read this so blanks are not misread)
In this study a replicate may have **NG** (did not grow) or a timepoint may be
**NS** (not sequenced). These are real states, not zeros or missing data. When a
cell is empty because a sample was not sequenced, treat it as unknown, not as
"copy number 0" or "mutation absent".

---

## 4. VerA / VerB barcode composition (when present)

A barcode label `A#-B#` is one **VerA** subunit paired with one **VerB** subunit.
VerB is required for VerA activity, and the VerA/VerB combination affects the
substrate (the substrate binds VerA; VerB modulates VerA), so the pairing governs
substrate specificity. Tracking which A#-B# combinations rise or fall across
transfers is how you follow shifts in substrate specificity over evolution. The
viewer shows composition and trajectories; it does not by itself prove mechanism.

Three levels of analysis:
- **A-B candidate**: one specific VerA+VerB pair.
- **VerA group**: all A#-* sharing one VerA subunit.
- **VerB group**: all *-B# sharing one VerB subunit.

Workflow:
1. Open **Barcode Charts**.
2. Color by A-B, VerA, or VerB (info (i) button explains the difference).
3. **Split A|B** shows three aligned sub-bars per transfer: full A-B, VerA-
   grouped, VerB-grouped. These are the *same reads* shown three ways (a derived
   breakdown), so all three have the same total height per transfer.
4. In the Candidates sidebar: hover to highlight everywhere; click to select
   (charts filter to those containing it and emphasize it); use Isolate selected
   to hide the rest. Group by VerA/VerB and click a group header to act on a
   whole subunit.
5. In **Focus**, switch chart type: Rows (most readable), Bars, Lines (over
   time), or Heatmap (many candidates at once).
6. **Compare**: add charts for a side-by-side view with a **common Y-axis** and a
   **shared legend** that syncs selection/hover across every chart. When you
   color by VerA or VerB, the shared legend groups by subunit so selecting a
   VerA/VerB acts on all its combinations at once (consistent with the sidebar).

---

## 5. Exporting figures and data

Every visualization has an **Export figure** button with four options:
- **PNG** — 2x bitmap for slides and email.
- **SVG** — editable vector for manuscripts.
- **HTML** — self-contained page with fixed-size labels (best for barcode Rows).
- **Print / Save PDF** — opens the print dialog scoped to the figure.

Use the separate **CSV** button whenever you will make a quantitative claim.

Caption template:

> AI-ALE LIMS viewer visualization exported from the read-only LIMS mirror
> snapshot. Samples were filtered by [experiment/condition/strain/donor
> DNA/replicate]. Frequency heatmap colors use a fixed 0% to 100% scale;
> copy-number rows use a row-local min/max scale. Growth metrics, when shown, are
> descriptive estimates from observed OD600 points and are not fitted
> kinetic-model parameters. Barcode labels are A#-B# VerA/VerB combinations.

---

## 6. Using your own AI assistant (the Guide)

The viewer has no built-in chatbot (the public deployment is a static site with
no backend). The **Guide** instead does two things:
1. Answers "how do I..." and navigates you to the right view, highlighting where
   to click.
2. Builds a guarded, copy-paste prompt that bundles your current context and the
   viewer's interpretation rules, to paste into your university/Argonne approved
   assistant alongside an exported CSV or figure.

The prompt encodes the guardrails (dgoA* as a key readout; provided vs
spontaneous; NG/NS are not zeros; fixed-frequency vs row-local copy-number
colors; descriptive-not-fitted growth metrics; VerA/VerB naming; separate
observation from hypothesis) so the downstream assistant does not hallucinate.

---

## 7. Ideas to push the viewer further (for maintainers)

Grounded in how this data is actually analyzed in the study:
- **Mutation-vs-copy-number coupling**: the paper shows secondary fba alleles
  inversely correlate with dgoA* copy number. A combined per-lineage view (dgoA*
  CN line + fba allele-frequency lines on a twin axis) would surface this
  directly, mirroring the paper's Figure 5.
- **Per-background summary table**: replicate counts that grew (G) / did not grow
  (NG) / were not sequenced (NS) per genotype background, matching the paper's
  Figure 4b, so reviewers can compare conditions at a glance.
- **Spontaneous-mutation spotlight**: a filter to show only spontaneous (non-
  provided) mutations, since these (e.g. secondary fba, spontaneous fba in a
  tpiA background) are a central narrative of the study.
- **Functional-equivalence note**: backgrounds where pgi/sohB did not integrate
  are functional equivalents of their partner single-mutant; surfacing that
  equivalence inline would prevent misreading.

---

## 8. Checklist before sharing a figure

- The snapshot date is recorded.
- Filters and selected samples are recorded.
- The frequency vs copy-number color-scale rules are stated.
- NG/NS are described as states, not zeros.
- Provided vs spontaneous mutations are distinguished.
- VerA/VerB is spelled exactly (never VarA/VarB).
- Growth metrics are described as descriptive estimates only.
- Any missing numeric series is reported as not found in the snapshot.
- Quantitative claims ship with the CSV.
