import { NextResponse, type NextRequest } from 'next/server';
import { runQuery, getDbType } from '@/lib/db';

interface VerABRow {
  Seqsample: string;
  Seqorder: string | null;
  Transformation_library: string | null;
  verA: string | null;
  verB: string | null;
  Candidate: string;
  Count: number | null;
}

interface SeqSampleRow {
  seq_sample: string;
  sample_name: string | null;
  experiment_from_mutations: string | null;
  experiment_from_seq: string | null;
  condition: string | null;
  strain: string | null;
  transforming_dna: string | null;
  replicate: string | null;
  transfer: number | null;
}

interface LibraryCandidateRow {
  Library: string | null;
  Feature_type: string | null;
  Feature_number: string | null;
  Feature_alias: string | null;
  Feature_name: string | null;
  Barcode: string | null;
  Sequence: string | null;
  AI_generated: number | string | null;
}

interface LibraryVariantInfo {
  library: string | null;
  featureType: string | null;
  featureNumber: string | null;
  featureAlias: string | null;
  featureName: string | null;
  barcode: string | null;
  sequence: string | null;
  aiGenerated: boolean;
}

interface LibraryVariantRow {
  sampleId: string;
  seqsample: string;
  seqorder: string | null;
  experiment?: string | null;
  condition?: string | null;
  strain?: string | null;
  donor_dna?: string | null;
  replicate?: string | null;
  transfer?: number | null;
  displaySampleName?: string | null;
  library: string | null;
  candidate: string;
  verA: string | null;
  verB: string | null;
  count: number;
  totalCountForSample: number;
  frequency: number;
  verAInfo: LibraryVariantInfo;
  verBInfo: LibraryVariantInfo;
}

interface LibraryVariantDataset {
  rows: LibraryVariantRow[];
  samples: string[];
  variants: string[];
  hasLibraryVariants: boolean;
  warning?: string;
}

async function tableExists(name: string): Promise<boolean> {
  try {
    if (getDbType() === 'sqlite') {
      const rows = await runQuery<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [name]);
      return rows.length > 0;
    }
    const rows = await runQuery<{ c: number }>("SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = ?", [name]);
    return Number(rows[0]?.c ?? 0) > 0;
  } catch {
    return false;
  }
}

function parseSelectedSamples(value: string | null): string[] {
  if (!value) return [];
  return [...new Set(value.split(',').map(v => v.trim()).filter(Boolean))];
}

function truthyAiGenerated(value: unknown): boolean {
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return !['', '0', 'false', 'False', 'FALSE', 'no', 'No'].includes(value.trim());
  return Boolean(value);
}

function infoFromCandidate(row?: LibraryCandidateRow | null): LibraryVariantInfo {
  return {
    library: row?.Library ?? null,
    featureType: row?.Feature_type ?? null,
    featureNumber: row?.Feature_number ?? null,
    featureAlias: row?.Feature_alias ?? null,
    featureName: row?.Feature_name ?? null,
    barcode: row?.Barcode ?? null,
    sequence: row?.Sequence ?? null,
    aiGenerated: truthyAiGenerated(row?.AI_generated ?? null),
  };
}

function aliasVariants(row: LibraryCandidateRow): string[] {
  const out = new Set<string>();
  if (row.Feature_alias) out.add(row.Feature_alias);
  if (row.Feature_type && row.Feature_number) out.add(`${row.Feature_type}${row.Feature_number}`);
  if (row.Feature_type && row.Feature_number) out.add(`${row.Feature_type}_${row.Feature_number}`);
  if (row.Feature_number) out.add(row.Feature_number);
  return [...out];
}

async function getSampleMetadata(sampleIds: string[]): Promise<Map<string, SeqSampleRow>> {
  const meta = new Map<string, SeqSampleRow>();
  if (sampleIds.length === 0) return meta;
  const placeholders = sampleIds.map(() => '?').join(',');
  const rows = await runQuery<SeqSampleRow>(
    `SELECT ss."seq_sample", ss."Sample_Name" AS sample_name, ss."Experiment" AS experiment_from_mutations,
            ss."Experiment_from_seq" AS experiment_from_seq, ss."Condition" AS condition,
            ss."Strain" AS strain, ss."Transforming_DNA" AS transforming_dna,
            ss."Replicate" AS replicate, ss."Transfer" AS transfer
     FROM Seq_samples ss
     WHERE ss.deleted = 0 AND ss."seq_sample" IN (${placeholders})`,
    sampleIds,
  ).catch(() => [] as SeqSampleRow[]);
  for (const row of rows) meta.set(row.seq_sample, row);
  return meta;
}

async function getLibraryCandidates(): Promise<{ rows: LibraryCandidateRow[]; warning?: string }> {
  if (!(await tableExists('Library_candidates'))) return { rows: [], warning: 'Library_candidates table is missing in this snapshot.' };
  try {
    const rows = await runQuery<LibraryCandidateRow>('SELECT "Library", "Feature_type", "Feature_number", "Feature_alias", "Feature_name", "Barcode", "Sequence", "AI_generated" FROM Library_candidates');
    return { rows };
  } catch (e) {
    return { rows: [], warning: `Library_candidates query failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const experiment = url.searchParams.get('experiment')?.trim() || '';
  const samples = parseSelectedSamples(url.searchParams.get('samples'));
  const sampleMeta = await getSampleMetadata(samples);
  const [barcodesExist, candidatesResult] = await Promise.all([tableExists('verAB_barcodes'), getLibraryCandidates()]);

  if (!barcodesExist) {
    return NextResponse.json<LibraryVariantDataset>({ rows: [], samples, variants: [], hasLibraryVariants: false, warning: 'verAB_barcodes table is missing in this snapshot.' });
  }

  const where: string[] = ['deleted = 0', '"Count" > 0'];
  const params: string[] = [];
  if (samples.length > 0) {
    where.push(`"Seqsample" IN (${samples.map(() => '?').join(',')})`);
    params.push(...samples);
  }
  if (experiment) {
    where.push('1=1');
  }

  let barcodes: VerABRow[] = [];
  try {
    barcodes = await runQuery<VerABRow>(
      `SELECT "Seqsample", "Seqorder", "Transformation_library", "verA", "verB", "Candidate", "Count"
       FROM verAB_barcodes
       WHERE ${where.join(' AND ')}`,
      params,
    );
  } catch (e) {
    return NextResponse.json<LibraryVariantDataset>({ rows: [], samples, variants: [], hasLibraryVariants: false, warning: `verAB_barcodes query failed: ${e instanceof Error ? e.message : String(e)}` });
  }

  const candidateMap = new Map<string, LibraryCandidateRow>();
  for (const row of candidatesResult.rows) {
    for (const key of aliasVariants(row)) candidateMap.set(`${row.Library ?? ''}|${key}`.toLowerCase(), row);
  }

  const totals = new Map<string, number>();
  const variantSet = new Set<string>();
  const sampleSet = new Set<string>();
  for (const row of barcodes) {
    sampleSet.add(row.Seqsample);
    totals.set(row.Seqsample, (totals.get(row.Seqsample) ?? 0) + Number(row.Count ?? 0));
    if (row.verA) variantSet.add(row.verA);
    if (row.verB) variantSet.add(row.verB);
  }

  const rows = barcodes.map(row => {
    const meta = sampleMeta.get(row.Seqsample);
    const verAInfo = infoFromCandidate(candidateMap.get(`${row.Transformation_library ?? ''}|${(row.verA ?? '')}`.toLowerCase()));
    const verBInfo = infoFromCandidate(candidateMap.get(`${row.Transformation_library ?? ''}|${(row.verB ?? '')}`.toLowerCase()));
    const total = totals.get(row.Seqsample) ?? 0;
    return {
      sampleId: row.Seqsample,
      seqsample: row.Seqsample,
      seqorder: row.Seqorder,
      experiment: (meta?.experiment_from_mutations ?? meta?.experiment_from_seq ?? experiment) || null,
      condition: meta?.condition ?? null,
      strain: meta?.strain ?? null,
      donor_dna: meta?.transforming_dna ?? null,
      replicate: meta?.replicate ?? null,
      transfer: meta?.transfer ?? null,
      displaySampleName: meta?.sample_name ?? null,
      library: row.Transformation_library,
      candidate: row.Candidate,
      verA: row.verA,
      verB: row.verB,
      count: Number(row.Count ?? 0),
      totalCountForSample: total,
      frequency: total > 0 ? Number(row.Count ?? 0) / total : 0,
      verAInfo,
      verBInfo,
    };
  });

  rows.sort((a, b) => a.sampleId.localeCompare(b.sampleId) || (a.seqorder ?? '').localeCompare(b.seqorder ?? '') || a.candidate.localeCompare(b.candidate));
  return NextResponse.json<LibraryVariantDataset>({ rows, samples: [...sampleSet].sort(), variants: [...variantSet].sort(), hasLibraryVariants: rows.length > 0, warning: candidatesResult.warning });
}
