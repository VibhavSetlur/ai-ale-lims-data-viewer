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
}

export interface MutationRow {
  id: string;
  gene: string;
  variant: string;
  type: string;
  metric: 'frequency' | 'copy_number' | string;
  values: Record<string, number>;
}

export interface MutationDataset {
  samples: MutationSample[];
  mutations: MutationRow[];
  warnings?: string[];
  source?: { driver: 'sqlite' | 'mysql'; table: string; rowsScanned: number };
}

/* ---------- Row shapes from the lims_mirror Mutations / Seq_samples join ---------- */

interface SeqSampleRow {
  seq_sample: string;
  experiment: string | null;
  sample_name: string | null;
  pop_or_colony: string | null;
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

// Parse "TFMN1.fba.1.T1.P" → {transfer: 1, pop_or_colony: 'P'}; also handles ".T10.P" etc.
function parseSeqSample(seqSample: string): { transfer?: number; pop_or_colony?: string } {
  const m = seqSample.match(/\.T(\d+)\.([PC])$/i);
  if (!m) return {};
  return { transfer: parseInt(m[1], 10), pop_or_colony: m[2].toUpperCase() };
}

// Replicate: the trailing ".\d+" of the Sample_Name (e.g. "TFMN1.fba.1" → "1").
function deriveReplicate(sampleName: string | null): string | undefined {
  if (!sampleName) return undefined;
  const m = sampleName.match(/\.(\d+)$/);
  return m ? m[1] : undefined;
}

// Donor DNA: the middle tokens of a TFMN sample name (e.g. "TFMN1.fba.sohB.1" → "fba+sohB").
// For everything else, fall back to whatever Transforming_DNA contains.
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
  // Prefer AA change when we have one (e.g. "F33I").
  if (r.aa_ref_seq && r.aa_new_seq && r.aa_position !== null && r.aa_position !== undefined) {
    return `${r.aa_ref_seq}${r.aa_position}${r.aa_new_seq}`;
  }
  // Indels: show size where breseq stored it.
  if ((r.type === 'INS' || r.type === 'DEL') && r.size && r.size.trim()) {
    return `${r.type} ${r.size}bp @${r.position ?? '?'}`;
  }
  // Nucleotide substitution at position.
  if (r.ref_seq && r.new_seq && r.position !== null && r.position !== undefined) {
    return `${r.ref_seq}${r.position}${r.new_seq}`;
  }
  return r.position !== null && r.position !== undefined ? `pos ${r.position}` : '—';
}

function labelType(r: MutationRawRow): string {
  // snp_type is the most specific (synonymous / nonsynonymous / nonsense / intergenic / noncoding).
  if (r.snp_type && r.snp_type.trim()) return r.snp_type.trim();
  if (r.mutation_category && r.mutation_category.trim()) return r.mutation_category.trim();
  return (r.type || 'unknown').trim();
}

// A stable id per unique mutation site (so two samples carrying the same variant land on one row).
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

/* ---------- Route ---------- */

const SAMPLES_SQL = `
  SELECT
    ss."Sequencing_sample"                    AS seq_sample,
    ss."Experiment"                            AS experiment,
    ss."Sample_Name"                           AS sample_name,
    ss."Population_or_Single_colony?"          AS pop_or_colony,
    e."Type"                                   AS experiment_type,
    s."Condition"                              AS condition,
    s."Strain_name"                            AS strain,
    s."Transforming_DNA"                       AS transforming_dna,
    s."Notes"                                  AS notes
  FROM Seq_samples ss
  LEFT JOIN Samples s
    ON s."Name" = ss."Sample_Name" AND s.deleted = 0
  LEFT JOIN Experiments e
    ON e."Name" = ss."Experiment" AND e.deleted = 0
  WHERE ss.deleted = 0
    AND ss."Sequencing_sample" IN (
      SELECT DISTINCT "Seq_sample" FROM Mutations WHERE deleted = 0
    )
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

export async function GET(req: NextRequest) {
  const warnings: string[] = [];
  const url = new URL(req.url);
  const experimentFilter = url.searchParams.get('experiment')?.trim() || null;

  try {
    const sampleSql = experimentFilter
      ? `${SAMPLES_SQL} AND ss."Experiment" = ?`
      : SAMPLES_SQL;
    const mutSql = experimentFilter
      ? `${MUTATIONS_SQL} AND "Experiment" = ?`
      : MUTATIONS_SQL;
    const params: (string | number | null)[] = experimentFilter ? [experimentFilter] : [];

    const [sampleRows, mutRows] = await Promise.all([
      runQuery<SeqSampleRow>(sampleSql, params),
      runQuery<MutationRawRow>(mutSql, params),
    ]);

    // Build samples
    const samples: MutationSample[] = sampleRows.map(r => {
      const { transfer, pop_or_colony } = parseSeqSample(r.seq_sample);
      const replicate = deriveReplicate(r.sample_name);
      const donor_dna = deriveDonorDna(r.sample_name, r.transforming_dna);
      const selectionParts: string[] = [];
      if (pop_or_colony === 'P') selectionParts.push('population');
      else if (pop_or_colony === 'C') selectionParts.push('single colony');
      if (r.notes && r.notes.trim()) selectionParts.push(r.notes.trim());
      return {
        id: r.seq_sample,
        name: r.seq_sample,
        experiment: r.experiment ?? '',
        experiment_type: r.experiment_type ?? undefined,
        replicate,
        transfer,
        condition: r.condition ?? undefined,
        strain: r.strain ?? undefined,
        donor_dna,
        selection_note: selectionParts.length ? selectionParts.join(' · ') : undefined,
      };
    });

    // De-dupe samples by id (shouldn't happen given Seq_samples PK, but defend).
    const sampleIds = new Set(samples.map(s => s.id));

    // Build mutation rows: collapse to one row per unique site, populate values[sampleId] = frequency.
    const byKey = new Map<string, MutationRow>();
    let rowsScanned = 0;
    for (const r of mutRows) {
      rowsScanned++;
      if (!sampleIds.has(r.seq_sample)) continue; // mutation references a seq_sample we don't have metadata for
      const key = mutationKey(r);
      let row = byKey.get(key);
      if (!row) {
        row = {
          id: key.replace(/\|/g, '.').replace(/\s+/g, '_'),
          gene: labelGene(r),
          variant: labelVariant(r),
          type: labelType(r),
          metric: 'frequency',
          values: {},
        };
        byKey.set(key, row);
      }
      const f = typeof r.frequency === 'number' && Number.isFinite(r.frequency) ? r.frequency : null;
      if (f !== null) row.values[r.seq_sample] = f;
    }

    const mutations = [...byKey.values()];

    if (samples.length === 0) warnings.push('No sequenced samples found in the database.');
    if (mutations.length === 0) warnings.push('No mutation calls found in the database.');

    return NextResponse.json({
      samples,
      mutations,
      warnings,
      source: { driver: getDbType(), table: 'Mutations', rowsScanned },
    } satisfies MutationDataset);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to query mutation dataset';
    return NextResponse.json({ error: msg, samples: [], mutations: [] }, { status: 500 });
  }
}
