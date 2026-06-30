# Data model

How the AI-ALE LIMS viewer maps the underlying LIMS database to what you see on
screen. This is a faithful description of the snapshot the viewer reads; it is the
reference for anyone reproducing a figure or auditing a value. The viewer is
read-only and computes nothing that is not derived openly from these tables.

The database is a snapshot ("mirror") of the lab LIMS. It has 27 tables. The
tables below are the ones the curated views depend on; the rest are visible in the
raw Database Tables browser. Every table also carries bookkeeping columns
(`deleted`, `last_synced`, `row_hash`) that the viewer ignores.

## Core tables the views use

### Robotic_ALE_samples
One row per evolved sample (lineage x timepoint). Drives Sample Selection.
Key columns: `Name`, `Experiment` (genotype background), `Condition`,
`Strain_name`, `Transforming_DNA` (the donor DNA provided for that condition),
`Replicate_number`, `Microtiter_plate_well`, `Plotting_group_name`,
`Select_transfers_to_sequence`.

### Seq_samples
One row per sequencing sample. Bridges an evolved sample to its sequencing run
(`Seqorder`) and breseq output. Key columns: `Sequencing_sample`, `Sample_Name`,
`Experiment`, `Seqorder`, `Population_or_Single_colony?`.

### Mutations
breseq variant calls, one row per called site per sequencing sample (the largest
table, ~223k rows). Drives the frequency rows of the Comparative heatmap and the
mutation detail popup. Key columns: `Seq_sample`, `Breseq_registry_ID`,
`gene_name`, `gene_product`, `mutation_category`, `snp_type`, `type`, `frequency`
(0 to 1), `aa_ref_seq`/`aa_position`/`aa_new_seq` (amino-acid change),
`position`, `locus_tag`. The viewer shows `frequency` directly on the fixed
0 to 100% color scale; a missing call is absent, not zero.

### Copy_numbers
Per-region copy-number estimates from breseq, one row per region per sequencing
sample. Drives the Copy Number view and the copy-number rows of the heatmap.
Key columns: `Seqsample`, `Breseq_registry_ID`, `Region_name`, `Region_start`,
`Region_stop`, `Refgenome_avg_cov` (whole-genome mean depth), `Region_avg_cov`
(region mean depth), `Region_CN` (the copy-number estimate = region depth /
genome depth). The dgoA\* region is the focus of the study. Copy-number rows use a
row-local color scale (not the fixed 0 to 100% scale used for frequency).

### Robotic_OD
Raw robot-measured OD600 readings, one row per well per reading (~142k rows).
Drives the growth-curve sparklines and popup. Key columns: `od`, `transfer`,
`timepoint`, `datetime`/`timestamp`, `well`, `strain`, `Condition`,
`Transforming_DNA`, `background`, `sample_name`, `Blank`. The viewer builds a
numeric OD600-vs-time series per sample/transfer; growth metrics are descriptive
point-to-point estimates of these observed points, never model fits. If no
numeric series exists for a sample, the popup says so.

### verAB_barcodes
VerA/VerB barcode read counts, one row per candidate per sequencing sample
(present only in the full DB; the public TFMN1 snapshot omits this table, which is
why the Barcode tab is hidden there). Drives Barcode Charts. Key columns:
`Seqsample`, `Transformation_library`, `verA`, `verB`, `Candidate` (the A#-B#
label), `Count`. A candidate is one VerA subunit paired with one VerB subunit.

### Breseq_registry
One row per breseq variant-calling run (its full parameter set: `reference`,
coverage and quality cutoffs, junction/CNV options, etc.). The same dataset can
hold calls from several runs against different references; the Registry selector
chooses which run's calls you view, and `Breseq_registry_ID` joins Mutations and
Copy_numbers back to their run.

## How the API shapes this

`GET /api/mutations` joins these tables into the Mutation Explorer dataset:
samples (from Robotic_ALE_samples / Seq_samples), one mutation row per unique site
with a `values: { [seq_sample]: frequency }` map and a `detail` block, the
copy-number rows, the breseq registries, any `warnings[]`, and a `stats` block of
capability flags (`hasBarcodes`, `cnRegionCount`, `curveCount`, `sampleCount`)
computed from the live data. The static build bakes the same API responses to JSON
so the static site is identical to the server. See `ARCHITECTURE.md`.

## Provenance rule

Every value shown is either stored in one of these tables or computed openly from
stored values, and the UI marks computed values with an info button that explains
the derivation. Absent data (NG = no growth, NS = not sequenced, a missing series)
is shown as absent, never as zero or an inferred number.
