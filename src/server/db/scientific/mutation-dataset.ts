/**
 * Faithful port of the legacy /api/mutations route (origin/main:
 * src/app/api/mutations/route.ts). The SQL and aggregation logic are preserved
 * verbatim; only the plumbing changed: runQuery<T>(sql, params) becomes a
 * synchronous run<T>(sql, params) callback the caller wires to
 * this.db.prepare(sql).all(...params), and getDbType() collapses to the sqlite
 * literal at the call site. Row-shape interfaces stay local to this module.
 */

import type {
  MutationDataset,
  MutationRow,
} from "../../../shared/contracts/mutation-dataset";
import type {
  LibraryVariant,
  LibraryVariantDataset,
  LibraryVariantMeasurement,
} from "../../../shared/contracts/library-variants-dataset";

/* ---------- Row shapes ---------- */

interface SeqSampleRow {
  seq_sample: string;
  experiment_from_mutations: string | null;
  experiment_from_seq: string | null;
  sample_name: string | null;
  pop_or_colony_raw: string | null;
  experiment_type: string | null;
  condition: string | null;
  strain: string | null;
  transforming_dna: string | null;
  notes: string | null;
  seqorder: string | null;
  seqorders: string | null;
  has_barcodes: number | null;
  barcode_read_count: number | null;
  verab_combinations: number | null;
}

interface MutationRawRow {
  seq_sample: string;
  experiment: string | null;
  breseq_registry_id: string | null;
  type: string | null;
  snp_type: string | null;
  mutation_category: string | null;
  gene_name: string | null;
  gene_product: string | null;
  locus_tag: string | null;
  position: number | null;
  ref_seq: string | null;
  new_seq: string | null;
  aa_ref_seq: string | null;
  aa_position: number | null;
  aa_new_seq: string | null;
  frequency: number | null;
  size: string | null;
  seq_id: string | null;
  position_start: number | null;
  position_end: number | null;
  gene_strand: string | null;
  gene_position: string | null;
  codon_ref_seq: string | null;
  codon_new_seq: string | null;
  codon_number: number | null;
  repeat_seq: string | null;
  repeat_ref_copies: number | null;
  repeat_new_copies: number | null;
  genes_inactivated: string | null;
  genes_overlapping: string | null;
  genes_promoter: string | null;
}

/* ---------- Helpers ---------- */

// Suffix patterns we've seen in Seq_samples:
//   TFMN1.fba.1.T1.P    population
//   TFMN1.sohB.5.T18.S1 single colony 1
//   TFMN1.fba.2.T25.L1  isolate L1
// Generalize: capture the integer transfer, then anything alphanumeric after the dot.
export function parseSeqSampleSuffix(seqSample: string): { transfer?: number; selection?: string } {
  const m = seqSample.match(/\.T(\d+)(?:\.([A-Za-z]\w*))?$/);
  if (!m) return {};
  const out: { transfer?: number; selection?: string } = { transfer: parseInt(m[1], 10) };
  if (m[2]) out.selection = m[2];
  return out;
}

// Split an explorer seq_sample ID into its ALE lineage and transfer number so
// it can be joined to a Robotic_OD curve (which is keyed by sample_name +
// transfer). "TFMN1.fba.1.T5.P" -> { lineage: "TFMN1.fba.1", transfer: 5 }.
export function parseLineageTransfer(seqSample: string): { lineage: string; transfer: number } | null {
  const m = seqSample.match(/\.T(\d+)(?=\.|$)/);
  if (!m) return null;
  return { lineage: seqSample.slice(0, m.index), transfer: parseInt(m[1], 10) };
}

// Robotic_OD readings are 'contam' or 'T0'..'T24' or bare '0'..'12'. Turn one
// into an ordinal index for the x-axis when the numeric timepoint is absent.
// 'contam' (the pre-inoculation check) sorts first at -1.
export function readingIndex(reading: string | null): number | null {
  if (reading === null || reading === undefined) return null;
  const r = String(reading).trim();
  if (r.toLowerCase() === 'contam') return -1;
  const m = r.match(/^T?(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

export function describeSelection(sel: string | undefined, notes: string | null): string | undefined {
  const parts: string[] = [];
  if (sel) {
    const tag = sel.toUpperCase();
    if (tag === 'P') parts.push('population');
    else if (tag === 'C') parts.push('single colony');
    else if (tag.startsWith('S')) parts.push(`single colony ${tag.slice(1) || ''}`.trim());
    else if (tag.startsWith('L')) parts.push(`isolate ${tag.slice(1) || ''}`.trim());
    else parts.push(tag);
  }
  if (notes && notes.trim()) parts.push(notes.trim());
  return parts.length ? parts.join(' \u00b7 ') : undefined;
}

export function deriveReplicate(sampleName: string | null): string | undefined {
  if (!sampleName) return undefined;
  const m = sampleName.match(/\.(\d+)$/);
  return m ? m[1] : undefined;
}

export function deriveDonorDna(sampleName: string | null, transformingDna: string | null): string | undefined {
  if (transformingDna && transformingDna.trim()) return transformingDna.trim();
  if (!sampleName) return undefined;
  const parts = sampleName.split('.');
  if (parts.length < 3) return undefined;
  const middle = parts.slice(1, -1).filter(Boolean);
  return middle.length > 0 ? middle.join('+') : undefined;
}

export function labelGene(r: MutationRawRow): string {
  return (r.gene_name || r.locus_tag || r.gene_product || 'unknown').trim();
}

// Parse a sample's donor DNA string (Transforming_DNA) into structured tokens so
// we can decide whether a given mutation was PROVIDED (supplied in the growth
// condition) vs spontaneous. Real-world formats seen in the LIMS:
//   "fba.P44L"                gene.variant (dot)
//   "fba_P44L"                gene_variant (underscore)
//   "fba.P44L, pgi.G275D"     comma-separated multiple
//   "sohB.truncation"         gene.<non-AA descriptor>
//   "fbaWT" / "fbaMUT" / "combo10WT" / "gDNA_ACN3560" / "DEL_vanK"  ambiguous/other
// We extract a (gene, variant) pair when a token clearly has a gene + a specific
// variant (dot or underscore separated, gene matches /^[A-Za-z]/). The ambiguous
// WT/MUT/combo/gDNA/DEL tokens carry no specific variant and are kept as raw
// gene-level hints only (matched by gene + a recognizable variant on the mutation
// would be too loose, so those do NOT mark a specific mutation as provided).
interface DonorToken { gene: string; variant: string | null; raw: string; }
export function parseDonorTokens(donor: string | null | undefined): DonorToken[] {
  if (!donor) return [];
  const out: DonorToken[] = [];
  for (const rawTok of donor.split(',')) {
    const tok = rawTok.trim();
    if (!tok) continue;
    // Split gene from variant on the FIRST dot or underscore.
    const m = tok.match(/^([A-Za-z][A-Za-z0-9]*)[._](.+)$/);
    if (m) {
      out.push({ gene: m[1], variant: m[2], raw: tok });
    } else {
      out.push({ gene: tok, variant: null, raw: tok });
    }
  }
  return out;
}

// Normalize an amino-acid / descriptor variant for tolerant comparison:
// lowercase, strip non-alphanumerics ("P44L" == "p44l"; "truncation" == "truncation").
export function normVariant(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Decide whether mutation (gene, variant) is provided by any donor token.
// Match is gene-equal (case-insensitive) AND variant-equal (normalized). This is
// deliberately strict so we never falsely flag a spontaneous mutation: a token
// must name BOTH the same gene and the same specific variant.
export function donorProvidesMutation(tokens: DonorToken[], gene: string, variant: string): boolean {
  if (!gene || !variant) return false;
  const g = gene.toLowerCase();
  const v = normVariant(variant);
  if (!v) return false;
  for (const t of tokens) {
    if (!t.variant) continue;
    if (t.gene.toLowerCase() === g && normVariant(t.variant) === v) return true;
  }
  return false;
}

export function labelVariant(r: MutationRawRow): string {
  if (r.aa_ref_seq && r.aa_new_seq && r.aa_position !== null && r.aa_position !== undefined) {
    return `${r.aa_ref_seq}${r.aa_position}${r.aa_new_seq}`;
  }
  if ((r.type === 'INS' || r.type === 'DEL') && r.size && r.size.trim()) {
    return `${r.type} ${r.size}bp @${r.position ?? '?'}`;
  }
  if (r.ref_seq && r.new_seq && r.position !== null && r.position !== undefined) {
    return `${r.ref_seq}${r.position}${r.new_seq}`;
  }
  return r.position !== null && r.position !== undefined ? `pos ${r.position}` : '\u2014';
}

export function labelType(r: MutationRawRow): string {
  if (r.snp_type && r.snp_type.trim()) return r.snp_type.trim();
  if (r.mutation_category && r.mutation_category.trim()) return r.mutation_category.trim();
  return (r.type || 'unknown').trim();
}

export function mutationKey(r: MutationRawRow): string {
  return [
    r.type ?? '',
    r.gene_name ?? r.locus_tag ?? '',
    r.position ?? '',
    r.ref_seq ?? '',
    r.new_seq ?? '',
    r.aa_position ?? '',
    r.aa_ref_seq ?? '',
    r.aa_new_seq ?? '',
  ].join('|');
}

/* ---------- SQL ----------
   Drive mutation-bearing samples FROM the Mutations table so the experiment
   label is whatever breseq tagged the call with (not what the wet-lab folks
   happened to type in Seq_samples). Also union in positive verAB barcode samples:
   amplicon-only barcode rows do not have Mutations rows, but researchers still
   need to select them for verAB library comparisons.
*/

// Build SAMPLES SQL on demand so the registry/experiment filters can be pushed
// inside the CTE. A sample only appears if it had calls under the selected
// registry/experiment. Params are appended in (experiment?, registry?) order.
export function buildSamplesSql(opts: { experiment: boolean; registry: boolean; barcodeSamples: boolean }): string {
  const inner: string[] = ['deleted = 0'];
  if (opts.experiment) inner.push('"Experiment" = ?');
  if (opts.registry)   inner.push('"Breseq_registry_ID" = ?');
  const barcodeWhere: string[] = ['v.deleted = 0', 'COALESCE(v."Count", 0) > 0'];
  if (opts.experiment) barcodeWhere.push('ss_filter."Experiment" = ?');
  const barcodeUnion = opts.barcodeSamples ? `
        UNION ALL
        SELECT
          v."Seqsample" AS seq_sample,
          NULL AS experiment,
          MIN(v."Seqorder") AS seqorder,
          'barcode' AS source,
          1 AS has_barcodes,
          SUM(COALESCE(v."Count", 0)) AS barcode_read_count,
          COUNT(DISTINCT v."Candidate") AS verab_combinations
        FROM verAB_barcodes v
        LEFT JOIN Seq_samples ss_filter
          ON ss_filter."Sequencing_sample" = v."Seqsample" AND ss_filter.deleted = 0
        WHERE ${barcodeWhere.join(' AND ')}
        GROUP BY v."Seqsample"` : '';
  return `
    SELECT
      ms.seq_sample                              AS seq_sample,
      ms.experiment                              AS experiment_from_mutations,
      ms.seqorder                                AS seqorder,
      ms.seqorders                               AS seqorders,
      ms.has_barcodes                            AS has_barcodes,
      ms.barcode_read_count                      AS barcode_read_count,
      ms.verab_combinations                      AS verab_combinations,
      ss."Experiment"                            AS experiment_from_seq,
      ss."Sample_Name"                           AS sample_name,
      ss."Population_or_Single_colony?"          AS pop_or_colony_raw,
      e."Type"                                   AS experiment_type,
      s."Condition"                              AS condition,
      s."Strain_name"                            AS strain,
      s."Transforming_DNA"                       AS transforming_dna,
      s."Notes"                                  AS notes
    FROM (
      SELECT
        seq_sample,
        MAX(CASE WHEN source = 'mutation' THEN experiment END) AS experiment,
        COALESCE(
          MAX(CASE WHEN source = 'mutation' THEN seqorder END),
          MAX(CASE WHEN source = 'barcode' THEN seqorder END)
        ) AS seqorder,
        GROUP_CONCAT(DISTINCT seqorder) AS seqorders,
        MAX(has_barcodes) AS has_barcodes,
        SUM(barcode_read_count) AS barcode_read_count,
        MAX(verab_combinations) AS verab_combinations
      FROM (
        SELECT
          "Seq_sample" AS seq_sample,
          MIN("Experiment") AS experiment,
          MIN("Seqorder") AS seqorder,
          'mutation' AS source,
          0 AS has_barcodes,
          0 AS barcode_read_count,
          0 AS verab_combinations
        FROM Mutations
        WHERE ${inner.join(' AND ')}
        GROUP BY "Seq_sample"
        ${barcodeUnion}
      ) sample_sources
      GROUP BY seq_sample
    ) ms
    LEFT JOIN (
      -- A handful of samples were re-sequenced under two Seqorders, so the same
      -- Sequencing_sample has >1 live Seq_samples row (and Database_ID is blank
      -- in this mirror, so we can't pick a "latest"). The duplicated rows carry
      -- identical Sample_Name / Experiment / selection metadata, so we collapse
      -- to exactly one row per Sequencing_sample to stop the sample list from
      -- fanning out into phantom duplicates.
      --
      -- Per nspahr: the CANONICAL row for mutation viewing is the WGS seqorder,
      -- not the amplicon one (mutations are only called from WGS runs). We pick
      -- the canonical row by ranking each Sequencing_sample's live rows so that
      -- a WGS seqorder (Seq_orders.Type LIKE 'WGS%') beats an amplicon seqorder.
      -- Ties (e.g. two WGS orders, or no Seq_orders match) fall back to Seqorder
      -- name so the choice is deterministic.
      SELECT
        "Sequencing_sample",
        "Experiment",
        "Sample_Name",
        "Population_or_Single_colony?"
      FROM (
        SELECT
          sq."Sequencing_sample"                 AS "Sequencing_sample",
          sq."Experiment"                        AS "Experiment",
          sq."Sample_Name"                       AS "Sample_Name",
          sq."Population_or_Single_colony?"      AS "Population_or_Single_colony?",
          ROW_NUMBER() OVER (
            PARTITION BY sq."Sequencing_sample"
            ORDER BY
              CASE WHEN so."Type" LIKE 'WGS%' THEN 0 ELSE 1 END,
              sq."Seqorder"
          ) AS rn
        FROM Seq_samples sq
        LEFT JOIN Seq_orders so
          ON so."Poplar_Seqorder_Name" = sq."Seqorder" AND so.deleted = 0
        WHERE sq.deleted = 0
      )
      WHERE rn = 1
    ) ss
      ON ss."Sequencing_sample" = ms.seq_sample
    LEFT JOIN Samples s
      ON s."Name" = ss."Sample_Name" AND s.deleted = 0
    LEFT JOIN Experiments e
      ON e."Name" = COALESCE(ms.experiment, ss."Experiment") AND e.deleted = 0
  `;
}

const MUTATIONS_SQL = `
  SELECT
    "Seq_sample"          AS seq_sample,
    "Experiment"          AS experiment,
    "Breseq_registry_ID"  AS breseq_registry_id,
    "type"              AS type,
    "snp_type"          AS snp_type,
    "mutation_category" AS mutation_category,
    "gene_name"         AS gene_name,
    "gene_product"      AS gene_product,
    "locus_tag"         AS locus_tag,
    "position"          AS position,
    "ref_seq"           AS ref_seq,
    "new_seq"           AS new_seq,
    "aa_ref_seq"        AS aa_ref_seq,
    "aa_position"       AS aa_position,
    "aa_new_seq"        AS aa_new_seq,
    "frequency"         AS frequency,
    "size"              AS size,
    "seq_id"            AS seq_id,
    "position_start"    AS position_start,
    "position_end"      AS position_end,
    "gene_strand"       AS gene_strand,
    "gene_position"     AS gene_position,
    "codon_ref_seq"     AS codon_ref_seq,
    "codon_new_seq"     AS codon_new_seq,
    "codon_number"      AS codon_number,
    "repeat_seq"        AS repeat_seq,
    "repeat_ref_copies" AS repeat_ref_copies,
    "repeat_new_copies" AS repeat_new_copies,
    "genes_inactivated" AS genes_inactivated,
    "genes_overlapping" AS genes_overlapping,
    "genes_promoter"    AS genes_promoter
  FROM Mutations
  WHERE deleted = 0
`;

function buildAllExperimentsSql(hasBarcodeTable: boolean): string {
  return `
    SELECT DISTINCT name
    FROM (
      SELECT Experiment AS name
      FROM Mutations
      WHERE deleted = 0 AND Experiment IS NOT NULL AND Experiment != ''
      ${hasBarcodeTable ? `
      UNION
      SELECT ss."Experiment" AS name
      FROM verAB_barcodes v
      JOIN Seq_samples ss
        ON ss."Sequencing_sample" = v."Seqsample" AND ss.deleted = 0
      WHERE v.deleted = 0
        AND COALESCE(v."Count", 0) > 0
        AND ss."Experiment" IS NOT NULL
        AND ss."Experiment" != ''` : ''}
    ) experiments
    ORDER BY name
  `;
}

// Registry breakdown for the (optionally experiment-filtered) Mutations subset,
// joined with Breseq_registry so the UI can show meaningful params alongside
// the opaque ID. Ordered by row count desc so the modal registry is index 0.
const REGISTRY_COUNTS_SQL = `
  SELECT
    m."Breseq_registry_ID"             AS id,
    COUNT(*)                           AS count,
    r."polymorphism_frequency_cutoff"  AS polymorphism_frequency_cutoff,
    r."limit_fold_coverage"            AS limit_fold_coverage,
    r."reference"                      AS reference
  FROM Mutations m
  LEFT JOIN Breseq_registry r
    ON r."ID" = m."Breseq_registry_ID" AND r.deleted = 0
  WHERE m.deleted = 0
    AND m."Breseq_registry_ID" IS NOT NULL
    AND m."Breseq_registry_ID" != ''
`;

// OD measurements tracked against each seq sample's parent sample. The
// numeric series isn't in the mirror; the Data column carries a filename or
// short reference. We still want to surface which samples have OD data
// captured upstream and where to look for the file.
//
// NOTE: This is the FALLBACK. The real numeric growth curves now live in the
// Robotic_OD table (see ROBOTIC_OD_SQL below) and are preferred whenever a
// matching curve exists. od_sources is only attached to samples that have no
// numeric curve, so researchers still see where to find the raw file.
const OD_MEASUREMENTS_SQL = `
  SELECT DISTINCT
    ss."Sequencing_sample" AS seq_sample,
    m."Type"               AS od_type,
    m."Data"               AS od_source
  FROM Seq_samples ss
  JOIN Measurements m
    ON m."Sample_ID" = ss."Sample_Name"
   AND m.deleted = 0
   AND m."Type" IN ('OD_series_robot', 'OD_series_flask')
   AND m."Data" IS NOT NULL
   AND m."Data" != ''
  WHERE ss.deleted = 0
    AND ss."Sequencing_sample" IN (
      SELECT DISTINCT "Seq_sample" FROM Mutations WHERE deleted = 0
    )
`;

// Real robotic OD growth curves. Each row is one OD reading of one ALE culture
// at one timepoint. A growth curve = all readings sharing (sample_name,
// transfer), ordered in time. sample_name is the ALE LINEAGE (e.g.
// "TFMN1.fba.1"); explorer seq_sample IDs are "<lineage>.T<transfer>.<sel>",
// so we join a curve to a seq sample by (lineage, transfer). Every selection
// (P / S1 / L1 ...) of the same transfer shares the same population-plate curve.
//
//   reading: 'contam' (pre-inoculation contamination check), then 'T0'..'T24'
//            or bare '0'..'12'. We turn this into an ordinal index for the
//            x-axis when the numeric timepoint (hours) is missing.
//   timepoint: hours since inoculation (FLOAT, preferred x-axis when present).
//   od: optical density.
//
// We pull only the sample-bearing rows (sample_name set, Blank not a blank
// well, od present) and let the route group them into per-curve series.
const ROBOTIC_OD_SQL = `
  SELECT
    "sample_name" AS sample_name,
    "transfer"    AS transfer,
    "reading"     AS reading,
    "od"          AS od,
    "timepoint"   AS timepoint,
    "datetime"    AS datetime
  FROM Robotic_OD
  WHERE deleted = 0
    AND "sample_name" IS NOT NULL
    AND "sample_name" != ''
    AND "od" IS NOT NULL
    AND ("Blank" IS NULL OR "Blank" = 0)
`;

// dgoA-star and verC copy numbers per sequenced sample. Seqsample maps DIRECTLY
// onto the explorer's seq_sample IDs (verified: 100% overlap with Mutations).
// Region_CN is the estimated copy number of the amplified region. We emit one
// comparative row per region so the Comparative view can show copy number
// alongside SNP frequencies.
const COPY_NUMBERS_SQL = `
  SELECT
    "Seqsample"   AS seq_sample,
    "Region_name" AS region_name,
    "Region_CN"   AS region_cn
  FROM Copy_numbers
  WHERE deleted = 0
    AND "Region_CN" IS NOT NULL
`;

/* ---------- Orchestrator ---------- */

/**
 * Port of the mutations route GET body (origin/main lines ~591-1013). Each
 * `await runQuery<T>(sql, params)` becomes a synchronous `run<T>(sql, params)`.
 * hasBarcodeTable is resolved via has('verAB_barcodes','Count'). The caller
 * adds the `source` field.
 */
export function buildMutationDataset(
  run: <T>(sql: string, params: unknown[]) => T[],
  has: (table: string, ...cols: string[]) => boolean,
  query: { experimentKey?: string; registryKey?: string },
): Omit<MutationDataset, "source"> {
  const warnings: string[] = [];
  const experimentFilter = (query.experimentKey ?? "").trim() || null;
  const registryParam = (query.registryKey ?? "").trim() || null;

  const hasBarcodeTable = has('verAB_barcodes', 'Count');

  // First pass: enumerate the breseq registries present for this (experiment-filtered)
  // dataset so we can validate the requested registry and pick a default when
  // the caller doesn't specify one.
  const regCountsSql = experimentFilter
    ? `${REGISTRY_COUNTS_SQL} AND m."Experiment" = ? GROUP BY m."Breseq_registry_ID", r."polymorphism_frequency_cutoff", r."limit_fold_coverage", r."reference" ORDER BY count DESC`
    : `${REGISTRY_COUNTS_SQL} GROUP BY m."Breseq_registry_ID", r."polymorphism_frequency_cutoff", r."limit_fold_coverage", r."reference" ORDER BY count DESC`;
  const regParams: (string | number | null)[] = experimentFilter ? [experimentFilter] : [];
  const registries = run<RegistrySummaryRow>(regCountsSql, regParams);

  // Flag registries that mutations reference but Breseq_registry has no row for.
  for (const r of registries) {
    r.unregistered = r.reference === null
      && r.polymorphism_frequency_cutoff === null
      && r.limit_fold_coverage === null;
  }
  const unregisteredCount = registries.filter(r => r.unregistered).length;
  if (unregisteredCount > 0) {
    warnings.push(
      `${unregisteredCount} breseq run${unregisteredCount === 1 ? '' : 's'} ${unregisteredCount === 1 ? 'is' : 'are'} referenced by mutations but not yet in the Breseq_registry table, so their parameters and reference genome are not shown. The calls are real; the run metadata just has not been synced yet.`
    );
  }

  // Resolve the registry to filter by.
  let selectedRegistry: string | null = null;
  if (registries.length > 0) {
    if (registryParam) {
      const match = registries.find(r => r.id === registryParam);
      if (match) {
        selectedRegistry = match.id;
      } else {
        warnings.push(
          `Requested registry "${registryParam}" has no calls in this dataset \u2014 showing the most common registry (${registries[0].id}) instead.`
        );
        selectedRegistry = registries[0].id;
      }
    } else {
      selectedRegistry = registries[0].id;
      if (registries.length > 1) {
        warnings.push(
          `Default view: each sample shows calls from its own primary breseq run. ${registries.length} registry sets exist across the dataset. Use the Registry selector or pick an experiment to pin one run.`
        );
      }
    }
  }

  // The mutation CALLS are scoped to (experiment?, registry?). In the default
  // view (no experiment, no explicit registry) pull calls across ALL registries
  // and keep, per seq_sample, only that sample's dominant (most-calls) registry.
  const usePerSampleRegistry = !experimentFilter && !registryParam;
  const mutParams: (string | number | null)[] = [];
  if (experimentFilter) mutParams.push(experimentFilter);
  if (selectedRegistry && !usePerSampleRegistry) mutParams.push(selectedRegistry);

  // The SAMPLE LIST must NOT be silently scoped to a single breseq registry.
  const scopeSamplesByRegistry = !!registryParam && !!selectedRegistry;
  const sampleParams: (string | number | null)[] = [];
  if (experimentFilter) sampleParams.push(experimentFilter);
  if (scopeSamplesByRegistry) sampleParams.push(selectedRegistry);
  if (hasBarcodeTable && experimentFilter) sampleParams.push(experimentFilter);

  const sampleSql = buildSamplesSql({
    experiment: !!experimentFilter,
    registry: scopeSamplesByRegistry,
    barcodeSamples: hasBarcodeTable,
  });
  const mutSql = MUTATIONS_SQL
    + (experimentFilter ? ' AND "Experiment" = ?' : '')
    + ((selectedRegistry && !usePerSampleRegistry) ? ' AND "Breseq_registry_ID" = ?' : '');

  const sampleRows = run<SeqSampleRow>(sampleSql, sampleParams);
  const mutRows = run<MutationRawRow>(mutSql, mutParams);
  const allExperiments = run<{ name: string }>(buildAllExperimentsSql(hasBarcodeTable), []);
  const odRows = run<{ seq_sample: string; od_type: string; od_source: string }>(OD_MEASUREMENTS_SQL, []);
  const curveRows = run<{ sample_name: string; transfer: number | null; reading: string | null; od: number | null; timepoint: number | null; datetime: string | null }>(ROBOTIC_OD_SQL, []);
  const cnRows = run<{ seq_sample: string; region_name: string | null; region_cn: number | null }>(COPY_NUMBERS_SQL, []);

  // seq_sample -> list of OD source references (fallback filename pointers)
  const odBySample = new Map<string, { type: string; source: string }[]>();
  for (const r of odRows) {
    const list = odBySample.get(r.seq_sample) ?? [];
    list.push({ type: r.od_type, source: r.od_source });
    odBySample.set(r.seq_sample, list);
  }

  // Build real growth curves from Robotic_OD, keyed by `${lineage}\u0000${transfer}`.
  type CurvePoint = { t: number; od: number; sort: number };
  const curveByKey = new Map<string, CurvePoint[]>();
  for (const r of curveRows) {
    if (r.transfer === null || r.transfer === undefined) continue;
    if (typeof r.od !== 'number' || !Number.isFinite(r.od)) continue;
    const idx = readingIndex(r.reading);
    const sort = idx !== null ? idx : (typeof r.timepoint === 'number' ? r.timepoint : 0);
    const t = typeof r.timepoint === 'number' && Number.isFinite(r.timepoint)
      ? r.timepoint
      : (idx !== null ? Math.max(0, idx) : 0);
    const key = `${r.sample_name}\u0000${r.transfer}`;
    const list = curveByKey.get(key) ?? [];
    list.push({ t, od: r.od, sort });
    curveByKey.set(key, list);
  }
  const finalizedCurves = new Map<string, { t: number; od: number }[]>();
  for (const [key, pts] of curveByKey) {
    pts.sort((a, b) => a.sort - b.sort);
    finalizedCurves.set(key, pts.map(p => ({ t: p.t, od: p.od })));
  }

  // seq_sample -> copy number by region.
  const cnBySampleRegion = new Map<string, Map<string, number>>();
  for (const r of cnRows) {
    if (!r.region_name || typeof r.region_cn !== 'number' || !Number.isFinite(r.region_cn)) continue;
    const byRegion = cnBySampleRegion.get(r.seq_sample) ?? new Map<string, number>();
    byRegion.set(r.region_name, r.region_cn);
    cnBySampleRegion.set(r.seq_sample, byRegion);
  }

  const samples: MutationDataset["samples"] = sampleRows.map(r => {
    const { transfer, selection } = parseSeqSampleSuffix(r.seq_sample);
    const replicate = deriveReplicate(r.sample_name);
    const donor_dna = deriveDonorDna(r.sample_name, r.transforming_dna);
    const popOrColony = (r.pop_or_colony_raw && r.pop_or_colony_raw.trim()) || selection;
    const lt = parseLineageTransfer(r.seq_sample);
    const growth_curve = lt ? finalizedCurves.get(`${lt.lineage}\u0000${lt.transfer}`) : undefined;
    const growth_curve_source = (lt && growth_curve && growth_curve.length >= 2)
      ? { table: 'Robotic_OD' as const, sample_name: lt.lineage, transfer: lt.transfer, points: growth_curve.length }
      : undefined;
    const od_sources = (!growth_curve || growth_curve.length < 2)
      ? odBySample.get(r.seq_sample)
      : undefined;
    return {
      id: r.seq_sample,
      name: r.seq_sample,
      experiment: r.experiment_from_mutations ?? r.experiment_from_seq ?? '',
      experiment_type: r.experiment_type ?? undefined,
      seqorder: (r.seqorder && String(r.seqorder).trim()) || undefined,
      seqorders: (() => {
        const list = String(r.seqorders ?? '')
          .split(',')
          .map((x: string) => x.trim())
          .filter(Boolean);
        return list.length ? Array.from(new Set(list)) : undefined;
      })(),
      replicate,
      transfer,
      condition: r.condition ?? undefined,
      strain: r.strain ?? undefined,
      donor_dna,
      has_barcodes: Boolean(r.has_barcodes),
      verab_combinations: Number(r.verab_combinations ?? 0),
      selection_note: describeSelection(popOrColony ?? undefined, r.notes),
      growth_curve: growth_curve && growth_curve.length >= 2 ? growth_curve : undefined,
      growth_curve_source,
      od_sources: od_sources && od_sources.length > 0 ? od_sources : undefined,
    };
  });

  const sampleIds = new Set(samples.map(s => s.id));

  // Per-sample parsed donor DNA tokens, so we can flag PROVIDED mutations.
  const donorBySample = new Map<string, DonorToken[]>();
  for (const s of samples) {
    const toks = parseDonorTokens(s.donor_dna);
    if (toks.length) donorBySample.set(s.id, toks);
  }

  // DEFAULT-VIEW per-sample registry resolution.
  const bestRegistryBySample = new Map<string, string>();
  if (usePerSampleRegistry) {
    const countsBySample = new Map<string, Map<string, number>>();
    for (const r of mutRows) {
      if (!sampleIds.has(r.seq_sample)) continue;
      const reg = r.breseq_registry_id ?? '';
      if (!reg) continue;
      const byReg = countsBySample.get(r.seq_sample) ?? new Map<string, number>();
      byReg.set(reg, (byReg.get(reg) ?? 0) + 1);
      countsBySample.set(r.seq_sample, byReg);
    }
    for (const [sample, byReg] of countsBySample) {
      let bestReg = ''; let bestN = -1;
      for (const [reg, n] of byReg) {
        if (n > bestN || (n === bestN && reg < bestReg)) { bestN = n; bestReg = reg; }
      }
      if (bestReg) bestRegistryBySample.set(sample, bestReg);
    }
  }

  // Aggregate mutation calls into rows; take MAX frequency when breseq emits
  // multiple evidence rows for the same (sample, site).
  interface InternalRow extends MutationRow { _maxFreqBySample: Map<string, number> }
  const byKey = new Map<string, InternalRow>();
  let rowsScanned = 0;
  let droppedNoSampleMatch = 0;
  for (const r of mutRows) {
    rowsScanned++;
    if (!sampleIds.has(r.seq_sample)) { droppedNoSampleMatch++; continue; }
    if (usePerSampleRegistry) {
      const best = bestRegistryBySample.get(r.seq_sample);
      if (best && (r.breseq_registry_id ?? '') !== best) continue;
    }
    const key = mutationKey(r);
    let row = byKey.get(key);
    if (!row) {
      row = {
        id: key.replace(/\|/g, '.').replace(/\s+/g, '_') || `unkeyed.${rowsScanned}`,
        gene: labelGene(r),
        variant: labelVariant(r),
        type: labelType(r),
        metric: 'frequency',
        values: {},
        snp_type: r.snp_type ?? undefined,
        mutation_category: r.mutation_category ?? undefined,
        base_type: r.type ?? undefined,
        position: r.position ?? undefined,
        gene_product: r.gene_product ?? undefined,
        detail: {
          seq_id: r.seq_id ?? undefined,
          position_start: r.position_start ?? undefined,
          position_end: r.position_end ?? undefined,
          ref_seq: r.ref_seq ?? undefined,
          new_seq: r.new_seq ?? undefined,
          gene_strand: r.gene_strand ?? undefined,
          gene_position: r.gene_position ?? undefined,
          locus_tag: r.locus_tag ?? undefined,
          aa_ref_seq: r.aa_ref_seq ?? undefined,
          aa_new_seq: r.aa_new_seq ?? undefined,
          aa_position: r.aa_position ?? undefined,
          codon_ref_seq: r.codon_ref_seq ?? undefined,
          codon_new_seq: r.codon_new_seq ?? undefined,
          codon_number: r.codon_number ?? undefined,
          size: r.size ?? undefined,
          repeat_seq: r.repeat_seq ?? undefined,
          repeat_ref_copies: r.repeat_ref_copies ?? undefined,
          repeat_new_copies: r.repeat_new_copies ?? undefined,
          genes_inactivated: r.genes_inactivated ?? undefined,
          genes_overlapping: r.genes_overlapping ?? undefined,
          genes_promoter: r.genes_promoter ?? undefined,
        },
        _maxFreqBySample: new Map(),
      } as InternalRow;
      byKey.set(key, row);
    }
    const f = typeof r.frequency === 'number' && Number.isFinite(r.frequency) ? r.frequency : null;
    if (f !== null) {
      const prev = row._maxFreqBySample.get(r.seq_sample);
      if (prev === undefined || f > prev) {
        row._maxFreqBySample.set(r.seq_sample, f);
        row.values[r.seq_sample] = f;
      }
    }
  }

  const mutations: MutationRow[] = [...byKey.values()].map(r => {
    const { _maxFreqBySample, ...clean } = r as InternalRow;
    void _maxFreqBySample;
    const providedIn: string[] = [];
    for (const [sid, toks] of donorBySample) {
      if (donorProvidesMutation(toks, clean.gene, clean.variant)) providedIn.push(sid);
    }
    if (providedIn.length) clean.providedIn = providedIn;
    return clean;
  });

  // Copy number comparative rows. One row per amplified region.
  const REGION_LABELS: Record<string, { gene: string; product: string }> = {
    'dgoA-star': { gene: 'dgoA*', product: 'dgoA amplified region (copy number)' },
    'dgoA-Star': { gene: 'dgoA*', product: 'dgoA amplified region (copy number)' },
    'verC': { gene: 'verC', product: 'verC amplified region (copy number)' },
    'verAB': { gene: 'verAB', product: 'verAB amplified region (copy number)' },
    'ver_cassette': { gene: 'ver cassette', product: 'ver cassette region (copy number)' },
    'DEL_6kb_ACN3560': { gene: 'DEL 6kb ACN3560', product: '6 kb deletion in ACN3560 (copy number)' },
    'Kanamycin': { gene: 'Kan', product: 'Kanamycin resistance region (copy number)' },
  };
  const cnRowsByRegion = new Map<string, MutationRow>();
  let cnSamplesSeen = 0;
  for (const [seqSample, byRegion] of cnBySampleRegion) {
    if (!sampleIds.has(seqSample)) continue;
    cnSamplesSeen++;
    for (const [region, cnVal] of byRegion) {
      let row = cnRowsByRegion.get(region);
      if (!row) {
        const label = REGION_LABELS[region] ?? { gene: region, product: `${region} (copy number)` };
        row = {
          id: `copy_number.${region}`,
          gene: label.gene,
          variant: 'copy number',
          type: 'copy_number',
          metric: 'copy_number',
          values: {},
          snp_type: 'copy_number',
          gene_product: label.product,
        };
        cnRowsByRegion.set(region, row);
      }
      row.values[seqSample] = cnVal;
    }
  }
  const cnOrder = ['dgoA-star', 'dgoA-Star', 'verC', 'verAB', 'ver_cassette', 'DEL_6kb_ACN3560', 'Kanamycin'];
  const copyNumberRows = [...cnRowsByRegion.entries()]
    .sort((a, b) => {
      const ai = cnOrder.indexOf(a[0]); const bi = cnOrder.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .map(([, row]) => row);
  mutations.push(...copyNumberRows);

  if (samples.length === 0) warnings.push('No sequenced samples found in the database for this filter.');
  if (mutations.length === 0) warnings.push('No mutation calls found in the database for this filter.');
  if (droppedNoSampleMatch > 0) {
    warnings.push(`${droppedNoSampleMatch} mutation rows referenced seq samples not present in the sample set \u2014 skipped.`);
  }
  const samplesWithCurve = samples.filter(s => s.growth_curve && s.growth_curve.length >= 2).length;
  if (samplesWithCurve > 0) {
    warnings.push(`Loaded robotic OD growth curves for ${samplesWithCurve} of ${samples.length} samples (Robotic_OD).`);
  }
  if (copyNumberRows.length > 0) {
    warnings.push(`Loaded copy number data for ${cnSamplesSeen} samples across ${copyNumberRows.length} region${copyNumberRows.length === 1 ? '' : 's'} (Copy_numbers). Switch the Comparative metric to "copy number" to view.`);
  }

  // Data-driven view gating: the Barcode Charts tab only makes sense when the
  // verAB_barcodes table exists AND carries rows.
  let hasBarcodes = false;
  if (hasBarcodeTable) {
    const bc = run<{ n: number }>("SELECT COUNT(*) AS n FROM verAB_barcodes", []);
    hasBarcodes = (bc[0]?.n ?? 0) > 0;
  }

  // strip the transient unregistered helper flag typing back to the contract shape
  const registrySummaries = registries.map(r => ({
    id: r.id,
    count: r.count,
    polymorphism_frequency_cutoff: r.polymorphism_frequency_cutoff,
    limit_fold_coverage: r.limit_fold_coverage,
    reference: r.reference,
    unregistered: r.unregistered,
  }));

  return {
    samples,
    mutations,
    experiments: allExperiments.map(e => e.name),
    registries: registrySummaries,
    selectedRegistry,
    warnings,
    stats: {
      sampleCount: samples.length,
      mutationRowCount: mutations.length,
      frequencyRowCount: mutations.length - copyNumberRows.length,
      cnRegionCount: copyNumberRows.length,
      cnSampleCount: cnSamplesSeen,
      curveCount: samplesWithCurve,
      hasBarcodes,
    },
  };
}

// Row shape for REGISTRY_COUNTS_SQL; unregistered is filled in after the query.
interface RegistrySummaryRow {
  id: string;
  count: number;
  polymorphism_frequency_cutoff: number | null;
  limit_fold_coverage: number | null;
  reference: string | null;
  unregistered?: boolean;
}

/* ---------- Growth series port ---------- */

const NO_DNA_LABEL = 'No DNA';

// Endpoint / max OD per (sample_name, transfer). A window-function CTE keeps the
// aggregation in SQLite.
const GROWTH_SERIES_SQL_BASE = `
  WITH ranked AS (
    SELECT
      "sample_name"      AS sample_name,
      "transfer"         AS transfer,
      "experiment"       AS experiment,
      "Transforming_DNA" AS transforming_dna,
      "Condition"        AS condition,
      "strain"           AS strain,
      "od"               AS od,
      ROW_NUMBER() OVER (
        PARTITION BY "sample_name", "transfer"
        ORDER BY
          ("timepoint" IS NULL),
          "timepoint" DESC,
          CASE
            WHEN "reading" GLOB 'T[0-9]*' THEN CAST(substr("reading", 2) AS INTEGER)
            WHEN "reading" GLOB '[0-9]*'  THEN CAST("reading" AS INTEGER)
            ELSE -1
          END DESC
      ) AS rn,
      MAX("od") OVER (PARTITION BY "sample_name", "transfer") AS max_od
    FROM Robotic_OD
    WHERE deleted = 0
      AND "sample_name" IS NOT NULL
      AND "sample_name" != ''
      AND "transfer" IS NOT NULL
      AND "od" IS NOT NULL
      AND ("Blank" IS NULL OR "Blank" = 0)
      AND LOWER(COALESCE("reading", '')) != 'contam'
`;

const GROWTH_SERIES_SQL_TAIL = `
  )
  SELECT sample_name, transfer, experiment, transforming_dna, condition, strain,
         od AS endpoint_od, max_od
  FROM ranked
  WHERE rn = 1
  ORDER BY sample_name ASC, transfer ASC
`;

interface GrowthSeriesRow {
  sample_name: string;
  transfer: number;
  experiment: string | null;
  transforming_dna: string | null;
  condition: string | null;
  strain: string | null;
  endpoint_od: number;
  max_od: number;
}

/**
 * Port of the growth-series route GET body. The caller supplies a synchronous
 * run and adds the `source` field. Mirrors legacy empty/error handling: it never
 * throws on a data-shape problem, returning an empty dataset with a warning.
 * `source` is omitted here (added by the caller) but rowsScanned is returned via
 * the closure result so the caller can build the source truthfully.
 */
export function buildGrowthSeries(
  run: <T>(sql: string, params: unknown[]) => T[],
  query: { experimentKey?: string },
): { dataset: Omit<GrowthSeriesDatasetLite, "source">; rowsScanned: number } {
  const experimentFilter = (query.experimentKey ?? "").trim() || null;
  const warnings: string[] = [];

  try {
    const sql = experimentFilter
      ? `${GROWTH_SERIES_SQL_BASE}      AND "experiment" = ?\n${GROWTH_SERIES_SQL_TAIL}`
      : `${GROWTH_SERIES_SQL_BASE}\n${GROWTH_SERIES_SQL_TAIL}`;
    const params: (string | number | null)[] = experimentFilter ? [experimentFilter] : [];

    const rows = run<GrowthSeriesRow>(sql, params);

    if (rows.length === 0) {
      return {
        dataset: {
          aggregation: 'endpoint',
          transferRange: { min: 0, max: 0 },
          lineages: [],
          warnings: [
            experimentFilter
              ? `No Robotic_OD growth data found for experiment "${experimentFilter}".`
              : 'No Robotic_OD growth data found.',
          ],
        },
        rowsScanned: 0,
      };
    }

    const byLineage = new Map<string, GrowthSeriesLineageLite>();
    let tMin = Infinity;
    let tMax = -Infinity;

    for (const r of rows) {
      const transfer = Number(r.transfer);
      const od = Number(r.endpoint_od);
      const maxOd = Number(r.max_od);
      if (!Number.isFinite(transfer) || !Number.isFinite(od)) continue;

      if (transfer < tMin) tMin = transfer;
      if (transfer > tMax) tMax = transfer;

      let lineage = byLineage.get(r.sample_name);
      if (!lineage) {
        lineage = {
          lineageId: r.sample_name,
          experiment: (r.experiment ?? '').trim(),
          genotypeLabel:
            r.transforming_dna && r.transforming_dna.trim()
              ? r.transforming_dna.trim()
              : NO_DNA_LABEL,
          replicate: deriveReplicate(r.sample_name),
          condition: r.condition && r.condition.trim() ? r.condition.trim() : undefined,
          strain: r.strain && r.strain.trim() ? r.strain.trim() : undefined,
          points: [],
        };
        byLineage.set(r.sample_name, lineage);
      }
      lineage.points.push({
        transfer,
        od,
        maxOd: Number.isFinite(maxOd) ? maxOd : od,
      });
    }

    const lineages = Array.from(byLineage.values());
    lineages.sort((a, b) => {
      if (a.genotypeLabel !== b.genotypeLabel) {
        return a.genotypeLabel.localeCompare(b.genotypeLabel);
      }
      const ra = a.replicate ? parseInt(a.replicate, 10) : Number.MAX_SAFE_INTEGER;
      const rb = b.replicate ? parseInt(b.replicate, 10) : Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return a.lineageId.localeCompare(b.lineageId);
    });

    return {
      dataset: {
        aggregation: 'endpoint',
        transferRange: {
          min: Number.isFinite(tMin) ? tMin : 0,
          max: Number.isFinite(tMax) ? tMax : 0,
        },
        lineages,
        warnings,
      },
      rowsScanned: rows.length,
    };
  } catch (err) {
    // Never 500 on a data-shape problem: return an empty dataset with a warning.
    const msg = err instanceof Error ? err.message : String(err);
    return {
      dataset: {
        aggregation: 'endpoint',
        transferRange: { min: 0, max: 0 },
        lineages: [],
        warnings: [`Failed to load growth series: ${msg}`],
      },
      rowsScanned: 0,
    };
  }
}

// Local structural aliases for the growth-series contract shapes (imported at
// the caller so this module has no hard import cycle on the contract file).
type GrowthSeriesPointLite = { transfer: number; od: number; maxOd: number };
type GrowthSeriesLineageLite = {
  lineageId: string;
  experiment: string;
  genotypeLabel: string;
  replicate?: string;
  condition?: string;
  strain?: string;
  points: GrowthSeriesPointLite[];
};
type GrowthSeriesDatasetLite = {
  aggregation: 'endpoint';
  transferRange: { min: number; max: number };
  lineages: GrowthSeriesLineageLite[];
  warnings: string[];
  source?: { driver: 'sqlite' | 'mysql'; table: 'Robotic_OD'; rowsScanned: number };
};

/* ---------- Library variants port ---------- */

interface VerABVariantRow {
  Seqsample: string;
  Sample_Name: string | null;
  Transformation_library: string | null;
  verA: string | null;
  verB: string | null;
  Candidate: string;
  Count: number;
}

type MetadataRow = Record<string, string | number | boolean | null>;

const SYSTEM_METADATA_COLUMNS = new Set(['deleted', 'last_synced', 'row_hash', 'Sequence']);

// sqlite-only identifier quoting (legacy quoteIdent, mysql branch dropped).
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function normalizeBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'y';
  }
  return false;
}

export function parseTransfer(seqsample: string): number | undefined {
  const match = seqsample.match(/\.T(\d+)(?=\.|$)/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

export function parseCandidate(candidate: string): { verA?: string; verB?: string } {
  const match = candidate.match(/^(A\d+)-(B\d+)$/i);
  return match ? { verA: match[1].toUpperCase(), verB: match[2].toUpperCase() } : {};
}

export function metadataKey(library: string | null | undefined, alias: string | null | undefined): string | null {
  if (!alias) return null;
  return `${library ?? ''}|${alias}`;
}

export function compactMetadata(row: MetadataRow): MetadataRow {
  const out: MetadataRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (SYSTEM_METADATA_COLUMNS.has(key)) continue;
    if (value === null || value === '') continue;
    out[key] = value;
  }
  return out;
}

/**
 * Port of the library-variants route GET body. Guards mirror legacy tableExists
 * checks via the supplied `has` callback and (for the Library_candidates schema)
 * the `columnsOf` callback (legacy getTableSchema). The caller supplies a
 * synchronous run and adds nothing: this builder returns the full dataset with
 * source. Metadata is loaded only when Library_candidates has Feature_alias.
 */
export function buildLibraryVariantsDataset(
  run: <T>(sql: string, params: unknown[]) => T[],
  has: (table: string, ...cols: string[]) => boolean,
  columnsOf: (table: string) => string[] | undefined,
): LibraryVariantDataset {
  const warnings: string[] = [];

  if (!has('verAB_barcodes', 'Count', 'Seqsample')) {
    warnings.push('verAB_barcodes table is unavailable; no library variant measurements can be shown.');
    return {
      variants: [],
      measurements: [],
      warnings,
      source: {
        driver: 'sqlite',
        barcodeTable: 'verAB_barcodes',
        countColumn: 'Count',
        abundance: 'per-sample count fraction',
      },
    };
  }

  const rows = run<VerABVariantRow>(
    `SELECT vb.${quoteIdent('Seqsample')} AS Seqsample,
            ss.${quoteIdent('Sample_Name')} AS Sample_Name,
            vb.${quoteIdent('Transformation_library')} AS Transformation_library,
            vb.${quoteIdent('verA')} AS verA,
            vb.${quoteIdent('verB')} AS verB,
            vb.${quoteIdent('Candidate')} AS Candidate,
            vb.${quoteIdent('Count')} AS Count
     FROM ${quoteIdent('verAB_barcodes')} vb
     LEFT JOIN ${quoteIdent('Seq_samples')} ss
       ON ss.${quoteIdent('Sequencing_sample')} = vb.${quoteIdent('Seqsample')}
      AND COALESCE(ss.${quoteIdent('deleted')}, 0) = 0
     WHERE COALESCE(vb.${quoteIdent('deleted')}, 0) = 0
       AND vb.${quoteIdent('Count')} > 0`,
    [],
  );

  const metadata = loadLibraryMetadata(run, has, columnsOf, warnings);
  const totalsBySeqsample = new Map<string, number>();
  for (const row of rows) {
    totalsBySeqsample.set(row.Seqsample, (totalsBySeqsample.get(row.Seqsample) ?? 0) + Number(row.Count || 0));
  }

  const variants = new Map<string, LibraryVariant>();
  const measurements: LibraryVariantMeasurement[] = [];
  for (const row of rows) {
    const count = Number(row.Count || 0);
    const total = totalsBySeqsample.get(row.Seqsample) ?? 0;
    if (!row.Candidate || count <= 0 || total <= 0) continue;
    const sampleId = row.Seqsample;
    const library = row.Transformation_library ?? undefined;
    const { verA, verB } = parseCandidate(row.Candidate);
    const aMeta = metadata.get(metadataKey(row.Transformation_library, row.verA || verA) ?? '');
    const bMeta = metadata.get(metadataKey(row.Transformation_library, row.verB || verB) ?? '');
    const verAaiGenerated = normalizeBool(aMeta?.aiGenerated);
    const verBaiGenerated = normalizeBool(bMeta?.aiGenerated);
    const aiGenerated = verAaiGenerated || verBaiGenerated;
    if (!variants.has(row.Candidate)) {
      variants.set(row.Candidate, {
        variantId: row.Candidate,
        gene: [aMeta?.Feature_name, bMeta?.Feature_name].filter(Boolean).join(' + ') || undefined,
        library,
        position: [row.verA || verA, row.verB || verB].filter(Boolean).join(' / ') || undefined,
        label: row.Candidate,
        aiGenerated,
        verAaiGenerated,
        verBaiGenerated,
        metadata: {
          Candidate: row.Candidate,
          Library: row.Transformation_library,
          verA: row.verA || verA || null,
          verB: row.verB || verB || null,
          verA_name: (aMeta?.Feature_name ?? null) as string | null,
          verB_name: (bMeta?.Feature_name ?? null) as string | null,
          verA_type: (aMeta?.Feature_type ?? null) as string | null,
          verB_type: (bMeta?.Feature_type ?? null) as string | null,
          'AI-generated': aiGenerated,
          'verA AI-generated': verAaiGenerated,
          'verB AI-generated': verBaiGenerated,
          verA_metadata: aMeta ? JSON.stringify(compactMetadata(aMeta)) : null,
          verB_metadata: bMeta ? JSON.stringify(compactMetadata(bMeta)) : null,
        },
      });
    } else if (aiGenerated) {
      const existing = variants.get(row.Candidate)!;
      existing.aiGenerated ||= aiGenerated;
      existing.verAaiGenerated ||= verAaiGenerated;
      existing.verBaiGenerated ||= verBaiGenerated;
      existing.metadata['AI-generated'] = existing.aiGenerated;
      existing.metadata['verA AI-generated'] = existing.verAaiGenerated;
      existing.metadata['verB AI-generated'] = existing.verBaiGenerated;
    }
    measurements.push({
      sampleId,
      seqsample: row.Seqsample,
      variantId: row.Candidate,
      abundance: count / total,
      count,
      transfer: parseTransfer(row.Seqsample),
    });
  }

  return {
    variants: Array.from(variants.values()).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    measurements,
    warnings,
    source: {
      driver: 'sqlite',
      barcodeTable: 'verAB_barcodes',
      metadataTable: metadata.size > 0 ? 'Library_candidates' : undefined,
      countColumn: 'Count',
      abundance: 'per-sample count fraction',
    },
  };
}

// Port of loadMetadata. tableExists -> has, getTableSchema -> columnsOf.
function loadLibraryMetadata(
  run: <T>(sql: string, params: unknown[]) => T[],
  has: (table: string, ...cols: string[]) => boolean,
  columnsOf: (table: string) => string[] | undefined,
  warnings: string[],
): Map<string, MetadataRow & { aiGenerated?: boolean }> {
  const metadata = new Map<string, MetadataRow & { aiGenerated?: boolean }>();
  if (!has('Library_candidates')) {
    warnings.push('Library_candidates table is unavailable; variants are shown without candidate metadata.');
    return metadata;
  }

  const schemaColumns = columnsOf('Library_candidates') ?? [];
  const columns = new Set(schemaColumns);
  const aliasColumn = columns.has('Feature_alias') ? 'Feature_alias' : null;
  const libraryColumn = columns.has('Library') ? 'Library' : null;
  const aiColumn = columns.has('AI-generated') ? 'AI-generated' : (columns.has('AI_generated') ? 'AI_generated' : null);
  if (!aliasColumn) {
    warnings.push('Library_candidates has no Feature_alias column; variants are shown without candidate metadata.');
    return metadata;
  }
  if (!aiColumn) warnings.push('Library_candidates has no AI-generated or AI_generated column; AI status defaults to false.');

  const selectedColumns = schemaColumns.filter(name => name !== 'Sequence');
  const sql = `SELECT ${selectedColumns.map(quoteIdent).join(', ')} FROM ${quoteIdent('Library_candidates')} WHERE ${columns.has('deleted') ? `${quoteIdent('deleted')} = 0` : '1 = 1'}`;
  const rows = run<MetadataRow>(sql, []);
  for (const row of rows) {
    const key = metadataKey(libraryColumn ? String(row[libraryColumn] ?? '') : '', String(row[aliasColumn] ?? ''));
    if (!key) continue;
    metadata.set(key, {
      ...row,
      aiGenerated: aiColumn ? normalizeBool(row[aiColumn]) : false,
    });
  }
  return metadata;
}
