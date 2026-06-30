# Writing the AI-ALE LIMS Viewer into a Manuscript

Ready-to-adapt language for describing the viewer and the figures you export
from it, plus the guardrails that keep the writing honest. Tailored to the
automated-ALE study of *Acinetobacter baylyi* ADP1 (ACN2586) on pyruvate.

Style: factual, no overclaiming, no em-dashes. State provenance, filters, and
color rules. Distinguish direct observation from interpretation.

---

## 1. What the viewer is (one sentence)

> Mutation calls, copy-number estimates, OD600 growth curves, and (where present)
> VerA/VerB barcode-composition trajectories were inspected with a read-only
> web viewer built over a snapshot of the laboratory LIMS mirror.

---

## 2. Methods paragraph (data exploration / figure generation)

> A read-only AI-ALE LIMS viewer was used to inspect whole-genome mutation calls,
> dgoA\* copy-number estimates, OD600 growth trajectories, and barcode-composition
> data from a snapshot of the laboratory LIMS mirror. Samples were linked to a
> comparative mutation-frequency heatmap (fixed 0% to 100% color scale),
> per-region copy-number gradients (row-local color scale), per-lineage
> copy-number trajectories over transfer cycles, and continuously monitored OD600
> growth curves. Exported figures preserve the active filters and chart state used
> during inspection. Growth-curve summaries (maximum OD600, maximum growth rate,
> doubling time, lag, and area under the curve) are descriptive point-to-point
> estimates calculated from the observed OD600 readings and are not fitted
> kinetic-model parameters.

---

## 3. Results language

### Copy number (the central result)
> dgoA\* copy number was tracked per lineage across transfer cycles. Amplification
> above the single-copy baseline was observed across genotype backgrounds,
> consistent with a convergent, genotype-independent adaptive response associated
> with improved prototrophic growth on pyruvate.

### Mutation integration / spontaneous mutations
> Introduced (donor-DNA) mutations were distinguished from spontaneous mutations
> in the viewer: provided mutations are rendered with an outline over the
> frequency color, and a provided mutation observed at 0% frequency indicates
> donor DNA that was supplied but not detected in the population. Secondary and
> spontaneous mutations (for example secondary fba alleles) are shown without an
> outline.

### Growth
> Continuous OD600 monitoring provided growth trajectories for each lineage.
> Descriptive growth summaries were read from the viewer for comparison across
> lineages and were not used as fitted kinetic constants.

### Barcode composition (only if the snapshot contains barcode data)
> VerA/VerB barcode composition was examined by tracking A#-B# candidate
> combinations across transfers and by aggregating reads by VerA or VerB subunit.
> Side-by-side comparison used a shared read-count axis; fraction mode used a
> common 0% to 100% axis. Candidate selection and subunit grouping were used to
> follow individual combinations and all combinations sharing a subunit.

---

## 4. Figure legend templates

### Copy-number trajectory
> dgoA\* copy number versus transfer for the indicated lineages, estimated from
> mean read depth across the dgoA\* locus normalized to mean whole-genome read
> depth. Copy number = 1 indicates the pre-evolution baseline.

### Comparative heatmap
> Comparative heatmap of mutation frequency (fixed 0% to 100% color scale) and
> copy-number rows (row-local color scale) across the selected samples.
> Donor-DNA-provided mutations are outlined; an outlined 0% cell denotes a
> provided mutation that was not observed. Unsequenced timepoints (NS) and
> non-growing replicates (NG) are shown as such and are not zeros.

### Barcode composition
> VerA/VerB barcode-composition trajectories. Each A#-B# label denotes one VerA
> and one VerB subunit. Split views summarize the same reads as full A-B
> combinations, VerA-grouped totals, and VerB-grouped totals. Colors are stable
> per candidate or subunit depending on the selected color mode.

---

## 5. Honesty guardrails (apply to every sentence)

- Treat every number as either stored in the database or transparently computed
  from it. Never present an invented value.
- NG = did not grow; NS = not sequenced. These are not zeros and must not be
  averaged as such.
- Growth metrics are descriptive, not fitted. Do not call mu a "specific growth
  rate constant from a kinetic fit".
- The fixed-frequency vs row-local-copy-number color rule must be stated wherever
  a heatmap is shown.
- A PDF screenshot of a report is not a data source. Recreate the plot from the
  database-backed view and cite the snapshot date.
- Composition trajectories suggest, but do not prove, mechanism unless the
  experimental design supports the claim.
- Spell VerA/VerB exactly. Never VarA/VarB.

---

## 6. Reproducibility / provenance note

> Figures were exported directly from the read-only viewer over a dated LIMS
> mirror snapshot. The snapshot date and the filters/selection used for each
> figure are recorded with the exported CSV so that the underlying values can be
> reproduced from the same snapshot.

---

## 7. Prompt for an institution-approved AI assistant

Paste this together with exported CSV/SVG/PNG files (the Guide in the viewer can
generate a context-filled version automatically):

> I am analyzing AI-ALE LIMS viewer exports from an automated adaptive laboratory
> evolution study of *Acinetobacter baylyi* ADP1 (ACN2586) on pyruvate. Rules:
> dgoA\* copy-number amplification is a convergent adaptive readout; a "provided"
> mutation was supplied as donor DNA and a 0% provided mutation was supplied but
> never observed; NG means no growth and NS means not sequenced (not zeros);
> frequency heatmap colors are fixed 0% to 100% while copy-number rows use a
> row-local scale; growth metrics are descriptive point-to-point estimates, not
> fitted kinetic models; barcode labels A#-B# are VerA/VerB combinations. Help me
> turn the attached export into manuscript-safe text. Separate direct
> observations from hypotheses that require experimental validation, and draft
> captions that state filters, sample grouping, color scale, and data provenance.
