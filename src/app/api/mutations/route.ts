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

export interface MutationDataset {
  samples: MutationSample[];
  mutations: MutationRow[];
  experiments: string[]; // distinct experiments present in this dataset (post-filter)
  warnings?: string[];
  source?: { driver: 'sqlite' | 'mysql'; table: string; rowsScanned: number };
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
   Seq_samples — e.g. "Gyorgy" vs "GB1"/"GB2"/"GB3"). Take the modal
   Mutations.Experiment per seq_sample.
*/

const SAMPLES_SQL = `
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
    WHERE deleted = 0
    GROUP BY "Seq_sample"
  ) ms
  LEFT JOIN Seq_samples ss
    ON ss."Sequencing_sample" = ms.seq_sample AND ss.deleted = 0
  LEFT JOIN Samples s
    ON s."Name" = ss."Sample_Name" AND s.deleted = 0
  LEFT JOIN Experiments e
    ON e."Name" = ms.experiment AND e.deleted = 0
  WHERE 1=1
`;

const MUTATIONS_SQL = `
  SELECT
    "Seq_sample"        AS seq_sample,
    "Experiment"        AS experiment,
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

// OD measurements tracked against each seq sample's parent sample. The
// numeric series isn't in the mirror — the Data column carries a filename or
// short reference. We still want to surface which samples have OD data
// captured upstream and where to look for the file.
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

/* ---------- Route ---------- */

export async function GET(req: NextRequest) {
  const warnings: string[] = [];
  const url = new URL(req.url);
  const experimentFilter = url.searchParams.get('experiment')?.trim() || null;

  try {
    const sampleSql = experimentFilter
      ? `${SAMPLES_SQL} AND ms.experiment = ?`
      : SAMPLES_SQL;
    const mutSql = experimentFilter
      ? `${MUTATIONS_SQL} AND "Experiment" = ?`
      : MUTATIONS_SQL;
    const params: (string | number | null)[] = experimentFilter ? [experimentFilter] : [];

    const [sampleRows, mutRows, allExperiments, odRows] = await Promise.all([
      runQuery<SeqSampleRow>(sampleSql, params),
      runQuery<MutationRawRow>(mutSql, params),
      runQuery<{ name: string }>(ALL_EXPERIMENTS_SQL),
      runQuery<{ seq_sample: string; od_type: string; od_source: string }>(OD_MEASUREMENTS_SQL),
    ]);

    // seq_sample → list of OD source references
    const odBySample = new Map<string, { type: string; source: string }[]>();
    for (const r of odRows) {
      const list = odBySample.get(r.seq_sample) ?? [];
      list.push({ type: r.od_type, source: r.od_source });
      odBySample.set(r.seq_sample, list);
    }

    const samples: MutationSample[] = sampleRows.map(r => {
      const { transfer, selection } = parseSeqSampleSuffix(r.seq_sample);
      const replicate = deriveReplicate(r.sample_name);
      const donor_dna = deriveDonorDna(r.sample_name, r.transforming_dna);
      const popOrColony = (r.pop_or_colony_raw && r.pop_or_colony_raw.trim()) || selection;
      const od_sources = odBySample.get(r.seq_sample);
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
        od_sources: od_sources && od_sources.length > 0 ? od_sources : undefined,
      };
    });

    const sampleIds = new Set(samples.map(s => s.id));

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

    if (samples.length === 0) warnings.push('No sequenced samples found in the database for this filter.');
    if (mutations.length === 0) warnings.push('No mutation calls found in the database for this filter.');
    if (droppedNoSampleMatch > 0) {
      warnings.push(`${droppedNoSampleMatch} mutation rows referenced seq samples not present in the sample set — skipped.`);
    }

    return NextResponse.json({
      samples,
      mutations,
      experiments: allExperiments.map(e => e.name),
      warnings,
      source: { driver: getDbType(), table: 'Mutations', rowsScanned },
    } satisfies MutationDataset);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to query mutation dataset';
    return NextResponse.json({ error: msg, samples: [], mutations: [], experiments: [] }, { status: 500 });
  }
}
