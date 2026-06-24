import { NextResponse, type NextRequest } from 'next/server';
import { runQuery, getDbType } from '@/lib/db';

export interface MutationSample {
  id: string;
  name: string;
  experiment: string;
  experiment_type?: string;
  replicate?: string;
  transfer?: number;
  condition?: string;
  strain?: string;
  donor_dna?: string;
  selection_note?: string;
  growth_curve?: { t: number; od: number }[];
  // OD measurements tracked in the LIMS for this sample. We surface them even
  // when the numeric time-series isn't in the mirror (the Data field is then
  // a filename pointer, e.g. "TFMN1_roboticOD_final.pdf"). Researchers can
  // see which samples have OD data captured and where to find the file.
  od_sources?: { type: string; source: string }[];
}

export interface MutationRow {
  id: string;
  gene: string;
  variant: string;
  type: string;            // human label (snp_type, mutation_category, or breseq type)
  metric: 'frequency' | 'copy_number' | string;
  values: Record<string, number>;
  // Optional context, used by the UI for filters and tooltips:
  snp_type?: string;       // synonymous / nonsynonymous / nonsense / intergenic / noncoding / pseudogene
  mutation_category?: string; // snp_*, small_indel, large_deletion
  base_type?: string;      // raw breseq type: SNP / INS / DEL / SUB
  position?: number;
  gene_product?: string;
}

export interface RegistrySummary {
  id: string;
  count: number;                            // mutation rows attributed to this registry (post experiment-filter)
  polymorphism_frequency_cutoff: number | null;
  limit_fold_coverage: number | null;
  reference: string | null;
  unregistered?: boolean;                   // referenced by mutations but absent from Breseq_registry (params/reference not synced yet)
}

export interface MutationDataset {
  samples: MutationSample[];
  mutations: MutationRow[];
  experiments: string[]; // distinct experiments present in this dataset (post-filter)
  registries?: RegistrySummary[];           // breseq runs that produced calls in the (experiment-filtered) dataset, by row count desc
  selectedRegistry?: string | null;         // which registry the returned samples/mutations are restricted to
  warnings?: string[];
  source?: { driver: 'sqlite' | 'mysql'; table: string; rowsScanned: number };
  stats?: {
    sampleCount: number;        // sequenced samples in this dataset
    mutationRowCount: number;   // total comparison rows (frequency + copy number)
    frequencyRowCount: number;  // breseq SNP/indel frequency rows
    cnRegionCount: number;      // distinct copy-number regions present
    cnSampleCount: number;      // distinct samples with at least one copy-number value
    curveCount: number;         // samples with a numeric OD growth curve (>=2 points)
  };
}

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
}

/* ---------- Helpers ---------- */

// Suffix patterns we've seen in Seq_samples:
//   TFMN1.fba.1.T1.P    population
//   TFMN1.sohB.5.T18.S1 single colony 1
//   TFMN1.fba.2.T25.L1  isolate L1
// Generalize: capture the integer transfer, then anything alphanumeric after the dot.
function parseSeqSampleSuffix(seqSample: string): { transfer?: number; selection?: string } {
  const m = seqSample.match(/\.T(\d+)\.([A-Za-z]\w*)$/);
  if (!m) return {};
  return { transfer: parseInt(m[1], 10), selection: m[2] };
}

// Split an explorer seq_sample ID into its ALE lineage and transfer number so
// it can be joined to a Robotic_OD curve (which is keyed by sample_name +
// transfer). "TFMN1.fba.1.T5.P" -> { lineage: "TFMN1.fba.1", transfer: 5 }.
function parseLineageTransfer(seqSample: string): { lineage: string; transfer: number } | null {
  const m = seqSample.match(/\.T(\d+)\.[A-Za-z]\w*$/);
  if (!m) return null;
  return { lineage: seqSample.slice(0, m.index), transfer: parseInt(m[1], 10) };
}

// Robotic_OD readings are 'contam' or 'T0'..'T24' or bare '0'..'12'. Turn one
// into an ordinal index for the x-axis when the numeric timepoint is absent.
// 'contam' (the pre-inoculation check) sorts first at -1.
function readingIndex(reading: string | null): number | null {
  if (reading === null || reading === undefined) return null;
  const r = String(reading).trim();
  if (r.toLowerCase() === 'contam') return -1;
  const m = r.match(/^T?(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

function describeSelection(sel: string | undefined, notes: string | null): string | undefined {
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
  return parts.length ? parts.join(' · ') : undefined;
}

function deriveReplicate(sampleName: string | null): string | undefined {
  if (!sampleName) return undefined;
  const m = sampleName.match(/\.(\d+)$/);
  return m ? m[1] : undefined;
}

function deriveDonorDna(sampleName: string | null, transformingDna: string | null): string | undefined {
  if (transformingDna && transformingDna.trim()) return transformingDna.trim();
  if (!sampleName) return undefined;
  const parts = sampleName.split('.');
  if (parts.length < 3) return undefined;
  const middle = parts.slice(1, -1).filter(Boolean);
  return middle.length > 0 ? middle.join('+') : undefined;
}

function labelGene(r: MutationRawRow): string {
  return (r.gene_name || r.locus_tag || r.gene_product || 'unknown').trim();
}

function labelVariant(r: MutationRawRow): string {
  if (r.aa_ref_seq && r.aa_new_seq && r.aa_position !== null && r.aa_position !== undefined) {
    return `${r.aa_ref_seq}${r.aa_position}${r.aa_new_seq}`;
  }
  if ((r.type === 'INS' || r.type === 'DEL') && r.size && r.size.trim()) {
    return `${r.type} ${r.size}bp @${r.position ?? '?'}`;
  }
  if (r.ref_seq && r.new_seq && r.position !== null && r.position !== undefined) {
    return `${r.ref_seq}${r.position}${r.new_seq}`;
  }
  return r.position !== null && r.position !== undefined ? `pos ${r.position}` : '—';
}

function labelType(r: MutationRawRow): string {
  if (r.snp_type && r.snp_type.trim()) return r.snp_type.trim();
  if (r.mutation_category && r.mutation_category.trim()) return r.mutation_category.trim();
  return (r.type || 'unknown').trim();
}

function mutationKey(r: MutationRawRow): string {
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
   Drive samples FROM the Mutations table so the experiment label is whatever
   breseq tagged the call with (not what the wet-lab folks happened to type in
   Seq_samples — e.g. "Gyorgy" vs "GB1"/"GB2"/"GB3"). In this mirror no
   seq_sample is tagged with more than one Experiment, so MIN("Experiment")
   simply returns that single label (deterministic if that ever changes).
*/

// Build SAMPLES SQL on demand so the registry/experiment filters can be pushed
// inside the CTE — a sample only appears if it had calls under the selected
// registry/experiment. Params are appended in (experiment?, registry?) order.
function buildSamplesSql(opts: { experiment: boolean; registry: boolean }): string {
  const inner: string[] = ['deleted = 0'];
  if (opts.experiment) inner.push('"Experiment" = ?');
  if (opts.registry)   inner.push('"Breseq_registry_ID" = ?');
  return `
    SELECT
      ms.seq_sample                              AS seq_sample,
      ms.experiment                              AS experiment_from_mutations,
      ss."Experiment"                            AS experiment_from_seq,
      ss."Sample_Name"                           AS sample_name,
      ss."Population_or_Single_colony?"          AS pop_or_colony_raw,
      e."Type"                                   AS experiment_type,
      s."Condition"                              AS condition,
      s."Strain_name"                            AS strain,
      s."Transforming_DNA"                       AS transforming_dna,
      s."Notes"                                  AS notes
    FROM (
      SELECT "Seq_sample" AS seq_sample, MIN("Experiment") AS experiment
      FROM Mutations
      WHERE ${inner.join(' AND ')}
      GROUP BY "Seq_sample"
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
      ON e."Name" = ms.experiment AND e.deleted = 0
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
    "size"              AS size
  FROM Mutations
  WHERE deleted = 0
`;

const ALL_EXPERIMENTS_SQL = `
  SELECT DISTINCT Experiment AS name
  FROM Mutations
  WHERE deleted = 0 AND Experiment IS NOT NULL AND Experiment != ''
  ORDER BY Experiment
`;

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
// numeric series isn't in the mirror — the Data column carries a filename or
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
// (P / S1 / L1 …) of the same transfer shares the same population-plate curve.
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

/* ---------- Route ---------- */

export async function GET(req: NextRequest) {
  const warnings: string[] = [];
  const url = new URL(req.url);
  const experimentFilter = url.searchParams.get('experiment')?.trim() || null;
  const registryParam = url.searchParams.get('registry')?.trim() || null;

  try {
    // First pass: enumerate the breseq registries present for this (experiment-filtered)
    // dataset so we can validate the requested registry and pick a default when
    // the caller doesn't specify one. The Mutations table currently has up to 4
    // registries per Seq_sample (different breseq parameter runs); silently
    // merging them — what the original API did — hides genuine call differences.
    const regCountsSql = experimentFilter
      ? `${REGISTRY_COUNTS_SQL} AND m."Experiment" = ? GROUP BY m."Breseq_registry_ID", r."polymorphism_frequency_cutoff", r."limit_fold_coverage", r."reference" ORDER BY count DESC`
      : `${REGISTRY_COUNTS_SQL} GROUP BY m."Breseq_registry_ID", r."polymorphism_frequency_cutoff", r."limit_fold_coverage", r."reference" ORDER BY count DESC`;
    const regParams: (string | number | null)[] = experimentFilter ? [experimentFilter] : [];
    const registries = await runQuery<RegistrySummary>(regCountsSql, regParams);

    // Flag registries that mutations reference but Breseq_registry has no row for:
    // params + reference all come back NULL because the LEFT JOIN found nothing.
    // These are runs not yet synced into the registry table (Natascha's pipeline
    // op for TFMN4). Surface it honestly so the params panel reads "not registered
    // yet" instead of silently blank.
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

    // Resolve the registry to filter by:
    //  - if caller passed ?registry=X and X is in the dataset, use it
    //  - if caller passed ?registry=X but X isn't there (typo / wrong experiment), warn + fall back to modal
    //  - if caller didn't pass one, default to the modal registry (registries[0])
    let selectedRegistry: string | null = null;
    if (registries.length > 0) {
      if (registryParam) {
        const match = registries.find(r => r.id === registryParam);
        if (match) {
          selectedRegistry = match.id;
        } else {
          warnings.push(
            `Requested registry "${registryParam}" has no calls in this dataset — showing the most common registry (${registries[0].id}) instead.`
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

    // The mutation CALLS are correctly scoped to (experiment?, registry?) — a
    // different breseq run yields different SNP calls, so the selected registry
    // matters for what mutations we show.
    //
    // DEFAULT-VIEW REGISTRY TRAP (fixed): when NO experiment and NO explicit
    // registry are given, restricting the mutation pull to the single global
    // top-count registry (registries[0]) showed TFMN1/TFMN4 samples against a
    // reference they weren't called on, so each appeared with ~1 mutation
    // instead of ~220 (a silent ~200x undercount). In that default view we now
    // pull calls across ALL registries and keep, per seq_sample, only that
    // sample's dominant (most-calls) registry — so every sample shows its true
    // call set against its own reference. An explicit ?registry= or ?experiment=
    // still scopes normally (the per-experiment best registry is correct there).
    const usePerSampleRegistry = !experimentFilter && !registryParam;
    const mutParams: (string | number | null)[] = [];
    if (experimentFilter) mutParams.push(experimentFilter);
    if (selectedRegistry && !usePerSampleRegistry) mutParams.push(selectedRegistry);

    // The SAMPLE LIST must NOT be silently scoped to a single breseq registry.
    // A sample's existence in the picker should not depend on which parameter
    // run you happen to be viewing: doing so made entire experiments (TFMN1 /
    // TFMN4, whose calls live under a different default registry than the modal
    // one) disappear from Sample Selection. We only apply the registry filter to
    // the sample list when the caller EXPLICITLY asked for a registry; in the
    // default view we list samples across all registries so every experiment is
    // selectable. The experiment filter still applies to both.
    const scopeSamplesByRegistry = !!registryParam && !!selectedRegistry;
    const sampleParams: (string | number | null)[] = [];
    if (experimentFilter) sampleParams.push(experimentFilter);
    if (scopeSamplesByRegistry) sampleParams.push(selectedRegistry);

    const sampleSql = buildSamplesSql({
      experiment: !!experimentFilter,
      registry: scopeSamplesByRegistry,
    });
    const mutSql = MUTATIONS_SQL
      + (experimentFilter ? ' AND "Experiment" = ?' : '')
      + ((selectedRegistry && !usePerSampleRegistry) ? ' AND "Breseq_registry_ID" = ?' : '');

    const [sampleRows, mutRows, allExperiments, odRows, curveRows, cnRows] = await Promise.all([
      runQuery<SeqSampleRow>(sampleSql, sampleParams),
      runQuery<MutationRawRow>(mutSql, mutParams),
      runQuery<{ name: string }>(ALL_EXPERIMENTS_SQL),
      runQuery<{ seq_sample: string; od_type: string; od_source: string }>(OD_MEASUREMENTS_SQL),
      runQuery<{ sample_name: string; transfer: number | null; reading: string | null; od: number | null; timepoint: number | null; datetime: string | null }>(ROBOTIC_OD_SQL),
      runQuery<{ seq_sample: string; region_name: string | null; region_cn: number | null }>(COPY_NUMBERS_SQL),
    ]);

    // seq_sample → list of OD source references (fallback filename pointers)
    const odBySample = new Map<string, { type: string; source: string }[]>();
    for (const r of odRows) {
      const list = odBySample.get(r.seq_sample) ?? [];
      list.push({ type: r.od_type, source: r.od_source });
      odBySample.set(r.seq_sample, list);
    }

    // Build real growth curves from Robotic_OD, keyed by `${lineage}\u0000${transfer}`.
    // Each point is { t, od } where t is hours (timepoint) when available, else
    // the ordinal reading index. We sort by t and de-dupe repeated t values
    // (keep the last) so the sparkline draws a clean monotonic-in-time series.
    type CurvePoint = { t: number; od: number; sort: number };
    const curveByKey = new Map<string, CurvePoint[]>();
    for (const r of curveRows) {
      if (r.transfer === null || r.transfer === undefined) continue;
      if (typeof r.od !== 'number' || !Number.isFinite(r.od)) continue;
      const idx = readingIndex(r.reading);
      // sort key: prefer the ordinal reading index (stable, gap-free) for
      // ordering; fall back to timepoint when the reading didn't parse.
      const sort = idx !== null ? idx : (typeof r.timepoint === 'number' ? r.timepoint : 0);
      // x value the chart shows: hours when we have them, else the ordinal index.
      const t = typeof r.timepoint === 'number' && Number.isFinite(r.timepoint)
        ? r.timepoint
        : (idx !== null ? Math.max(0, idx) : 0);
      const key = `${r.sample_name}\u0000${r.transfer}`;
      const list = curveByKey.get(key) ?? [];
      list.push({ t, od: r.od, sort });
      curveByKey.set(key, list);
    }
    // Finalize: sort each curve by its sort key, then collapse to { t, od }.
    const finalizedCurves = new Map<string, { t: number; od: number }[]>();
    for (const [key, pts] of curveByKey) {
      pts.sort((a, b) => a.sort - b.sort);
      finalizedCurves.set(key, pts.map(p => ({ t: p.t, od: p.od })));
    }

    // seq_sample → copy number by region. Region_CN keyed for fast lookup when
    // emitting comparative rows below.
    const cnBySampleRegion = new Map<string, Map<string, number>>();
    for (const r of cnRows) {
      if (!r.region_name || typeof r.region_cn !== 'number' || !Number.isFinite(r.region_cn)) continue;
      const byRegion = cnBySampleRegion.get(r.seq_sample) ?? new Map<string, number>();
      byRegion.set(r.region_name, r.region_cn);
      cnBySampleRegion.set(r.seq_sample, byRegion);
    }

    const samples: MutationSample[] = sampleRows.map(r => {
      const { transfer, selection } = parseSeqSampleSuffix(r.seq_sample);
      const replicate = deriveReplicate(r.sample_name);
      const donor_dna = deriveDonorDna(r.sample_name, r.transforming_dna);
      const popOrColony = (r.pop_or_colony_raw && r.pop_or_colony_raw.trim()) || selection;
      // Real growth curve from Robotic_OD (joined by lineage + transfer).
      const lt = parseLineageTransfer(r.seq_sample);
      const growth_curve = lt ? finalizedCurves.get(`${lt.lineage}\u0000${lt.transfer}`) : undefined;
      // Only fall back to the filename pointer when there's no numeric curve.
      const od_sources = (!growth_curve || growth_curve.length < 2)
        ? odBySample.get(r.seq_sample)
        : undefined;
      return {
        id: r.seq_sample,
        name: r.seq_sample,
        experiment: r.experiment_from_mutations ?? r.experiment_from_seq ?? '',
        experiment_type: r.experiment_type ?? undefined,
        replicate,
        transfer,
        condition: r.condition ?? undefined,
        strain: r.strain ?? undefined,
        donor_dna,
        selection_note: describeSelection(popOrColony ?? undefined, r.notes),
        growth_curve: growth_curve && growth_curve.length >= 2 ? growth_curve : undefined,
        od_sources: od_sources && od_sources.length > 0 ? od_sources : undefined,
      };
    });

    const sampleIds = new Set(samples.map(s => s.id));

    // DEFAULT-VIEW per-sample registry resolution (see usePerSampleRegistry
    // above). When we pulled calls across all registries, each seq_sample may
    // have calls under several breseq runs; we keep only that sample's DOMINANT
    // registry (the one with the most calls for it) so the sample is shown
    // against a single, self-consistent reference instead of a mix. Without an
    // experiment/registry filter this is what makes the default grid report the
    // true ~220 calls/sample for TFMN1/TFMN4 instead of ~1.
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
          // tie-break deterministically by registry id so results are stable
          if (n > bestN || (n === bestN && reg < bestReg)) { bestN = n; bestReg = reg; }
        }
        if (bestReg) bestRegistryBySample.set(sample, bestReg);
      }
    }

    // Aggregate mutation calls into rows; take MAX frequency when breseq emits
    // multiple evidence rows for the same (sample, site) — they only differ by
    // a few hundredths, but MAX is the conservative researcher-friendly choice.
    interface InternalRow extends MutationRow { _maxFreqBySample: Map<string, number> }
    const byKey = new Map<string, InternalRow>();
    let rowsScanned = 0;
    let droppedNoSampleMatch = 0;
    for (const r of mutRows) {
      rowsScanned++;
      if (!sampleIds.has(r.seq_sample)) { droppedNoSampleMatch++; continue; }
      // In the default view, drop calls from any registry that isn't this
      // sample's dominant one (keeps each sample on a single reference).
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
      // strip the internal helper before serializing
      const { _maxFreqBySample, ...clean } = r as InternalRow;
      void _maxFreqBySample;
      return clean;
    });

    // Copy number comparative rows. One row per amplified region (dgoA-star,
    // verC); values are Region_CN keyed by seq_sample, restricted to samples in
    // the current dataset. These ride alongside the SNP-frequency rows and the
    // UI surfaces them via the copy_number metric filter + emerald color scale.
    // dgoA-star is the headline amplification nspahr asked to display; verC is
    // included when present so the two regions can be compared.
    const REGION_LABELS: Record<string, { gene: string; product: string }> = {
      'dgoA-star': { gene: 'dgoA*', product: 'dgoA amplified region (copy number)' },
      'verC': { gene: 'verC', product: 'verC amplified region (copy number)' },
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
    // Surface dgoA-star first (the requested region), then verC, then any others.
    const cnOrder = ['dgoA-star', 'verC'];
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
      warnings.push(`${droppedNoSampleMatch} mutation rows referenced seq samples not present in the sample set — skipped.`);
    }
    const samplesWithCurve = samples.filter(s => s.growth_curve && s.growth_curve.length >= 2).length;
    if (samplesWithCurve > 0) {
      warnings.push(`Loaded robotic OD growth curves for ${samplesWithCurve} of ${samples.length} samples (Robotic_OD).`);
    }
    if (copyNumberRows.length > 0) {
      warnings.push(`Loaded copy number data for ${cnSamplesSeen} samples across ${copyNumberRows.length} region${copyNumberRows.length === 1 ? '' : 's'} (Copy_numbers). Switch the Comparative metric to "copy number" to view.`);
    }

    return NextResponse.json({
      samples,
      mutations,
      experiments: allExperiments.map(e => e.name),
      registries,
      selectedRegistry,
      warnings,
      source: { driver: getDbType(), table: 'Mutations', rowsScanned },
      stats: {
        sampleCount: samples.length,
        mutationRowCount: mutations.length,
        frequencyRowCount: mutations.length - copyNumberRows.length,
        cnRegionCount: copyNumberRows.length,
        cnSampleCount: cnSamplesSeen,
        curveCount: samplesWithCurve,
      },
    } satisfies MutationDataset);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to query mutation dataset';
    return NextResponse.json({ error: msg, samples: [], mutations: [], experiments: [] }, { status: 500 });
  }
}
