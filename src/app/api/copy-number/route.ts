import { NextResponse } from 'next/server';
import { runQuery, getDbType } from '@/lib/db';
import { MOCK_COPY_NUMBER, MOCK_ALLELES, type MockCopyNumberSample } from '@/lib/mockCopyNumber';

export interface CopyNumberDataset {
  source: 'mock' | 'lims';
  reason?: string;
  alleles: string[];
  samples: MockCopyNumberSample[];
  experiments: string[];
  warnings: string[];
}

interface MutationCopyRow {
  seq_sample: string;
  experiment: string | null;
  gene_name: string | null;
  copies: number | null;
}

interface SeqSampleJoinRow {
  seq_sample: string;
  sample_name: string | null;
  experiment: string | null;
}

interface SampleRow {
  sample_name: string;
  strain: string | null;
  condition: string | null;
}

function parseTransfer(seqSample: string): number {
  const m = seqSample.match(/\.T(\d+)\.[A-Za-z]\w*$/);
  return m ? parseInt(m[1], 10) : 0;
}
function deriveReplicate(sampleName: string | null): number {
  if (!sampleName) return 1;
  const m = sampleName.match(/\.(\d+)$/);
  return m ? parseInt(m[1], 10) : 1;
}

async function probeColumns(): Promise<{ copyCol: string | null; metricCol: string | null; integratedCol: string | null }> {
  let cols: { name: string }[] = [];
  try {
    cols = await runQuery<{ name: string }>(
      getDbType() === 'sqlite'
        ? 'PRAGMA table_info("Mutations")'
        : "SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Mutations'"
    );
  } catch {
    return { copyCol: null, metricCol: null, integratedCol: null };
  }
  const lower = new Map(cols.map(c => [c.name.toLowerCase(), c.name]));
  const pick = (...names: string[]) => {
    for (const n of names) {
      const real = lower.get(n);
      if (real) return real;
    }
    return null;
  };
  return {
    copyCol: pick('copy_number', 'copies', 'cn'),
    metricCol: pick('metric', 'value_type', 'mutation_metric'),
    integratedCol: pick('integrated', 'is_integrated'),
  };
}

async function tryLimsCopyNumber(): Promise<{ samples: MockCopyNumberSample[]; alleles: string[]; warnings: string[] } | null> {
  const { copyCol, metricCol, integratedCol } = await probeColumns();
  if (!copyCol && !metricCol) return null;

  // Build the SQL based on which column convention Natasha lands on:
  //  - dedicated copy_number column: SELECT that
  //  - or a metric flag column: SELECT frequency where metric='copy_number'
  const intProj = integratedCol ? `, "${integratedCol}" AS integrated` : '';
  const sql = copyCol
    ? `SELECT "Seq_sample" AS seq_sample, "Experiment" AS experiment, "gene_name", "${copyCol}" AS copies${intProj}
       FROM Mutations
       WHERE deleted = 0 AND "${copyCol}" IS NOT NULL`
    : `SELECT "Seq_sample" AS seq_sample, "Experiment" AS experiment, "gene_name", "frequency" AS copies${intProj}
       FROM Mutations
       WHERE deleted = 0 AND "${metricCol}" = 'copy_number'`;

  type Row = MutationCopyRow & { integrated?: number | boolean | null };
  let rows: Row[];
  try {
    rows = await runQuery<Row>(sql);
  } catch (e) {
    return { samples: [], alleles: [], warnings: [`LIMS copy-number query failed: ${e instanceof Error ? e.message : String(e)}`] };
  }
  if (rows.length === 0) return null;

  // Resolve sample metadata for every seq_sample we got back.
  const seqSamples = Array.from(new Set(rows.map(r => r.seq_sample))).filter(Boolean);
  const ph = seqSamples.map(() => '?').join(',');
  let joinRows: SeqSampleJoinRow[] = [];
  try {
    joinRows = await runQuery<SeqSampleJoinRow>(
      `SELECT ss."Sequencing_sample" AS seq_sample, ss."Sample_Name" AS sample_name, ss."Experiment" AS experiment
       FROM Seq_samples ss
       WHERE ss.deleted = 0 AND ss."Sequencing_sample" IN (${ph})`,
      seqSamples,
    );
  } catch (e) { void e; }
  const joinIdx = new Map(joinRows.map(r => [r.seq_sample, r]));

  const sampleNames = Array.from(new Set(joinRows.map(r => r.sample_name).filter((n): n is string => !!n)));
  let strainRows: SampleRow[] = [];
  if (sampleNames.length > 0) {
    const ph2 = sampleNames.map(() => '?').join(',');
    try {
      strainRows = await runQuery<SampleRow>(
        `SELECT "Name" AS sample_name, "Strain_name" AS strain, "Condition" AS condition
         FROM Samples WHERE deleted = 0 AND "Name" IN (${ph2})`,
        sampleNames,
      );
    } catch (e) { void e; }
  }
  const strainIdx = new Map(strainRows.map(r => [r.sample_name, r]));

  // Bucket into samples × alleles.
  const samplesMap = new Map<string, MockCopyNumberSample>();
  const alleleSet = new Set<string>();
  for (const r of rows) {
    const allele = (r.gene_name || '').trim() || 'unknown';
    alleleSet.add(allele);
    const join = joinIdx.get(r.seq_sample);
    const sn = join?.sample_name ?? r.seq_sample;
    const strainRow = sn ? strainIdx.get(sn) : null;
    const transfer = parseTransfer(r.seq_sample);
    const replicate = deriveReplicate(sn);
    const experiment = (r.experiment || join?.experiment || '').toString() || '(unknown)';
    const strain = strainRow?.strain ?? '(unknown)';
    const condition = strainRow?.condition ?? '';
    const id = `${experiment}.${strain}.r${replicate}.T${transfer}`;
    let s = samplesMap.get(id);
    if (!s) {
      s = {
        id, experiment, strain, condition, replicate, transfer,
        copies: {},
        integrated: r.integrated === null || r.integrated === undefined ? null : Boolean(r.integrated),
      };
      samplesMap.set(id, s);
    }
    s.copies[allele] = r.copies === null ? null : Number(r.copies);
    if (s.integrated === null && (r.integrated === true || r.integrated === false)) {
      s.integrated = Boolean(r.integrated);
    }
  }

  // Fill not-sequenced as null for any allele a sample is missing.
  const alleles = [...alleleSet].sort();
  const samples = [...samplesMap.values()];
  for (const s of samples) {
    for (const a of alleles) if (!(a in s.copies)) s.copies[a] = null;
  }
  samples.sort((a, b) =>
    a.experiment.localeCompare(b.experiment) ||
    a.strain.localeCompare(b.strain) ||
    a.replicate - b.replicate ||
    a.transfer - b.transfer);

  return { samples, alleles, warnings: [] };
}

export async function GET() {
  const warnings: string[] = [];
  let limsResult: { samples: MockCopyNumberSample[]; alleles: string[]; warnings: string[] } | null = null;
  try {
    limsResult = await tryLimsCopyNumber();
  } catch (e: unknown) {
    warnings.push('LIMS copy-number probe failed: ' + (e instanceof Error ? e.message : String(e)));
  }
  if (limsResult) warnings.push(...limsResult.warnings);

  const source: 'mock' | 'lims' = limsResult && limsResult.samples.length > 0 ? 'lims' : 'mock';
  const reason = source === 'mock'
    ? 'Mutations table has no copy_number / metric column populated yet. Showing mock data so the heat-map view is exercise-able. The viewer will auto-switch to live LIMS data the moment the column appears (per 2026-06-03 group meeting) — no code change needed.'
    : undefined;
  const finalSamples = source === 'lims' ? limsResult!.samples : MOCK_COPY_NUMBER;
  const alleles = source === 'lims' ? limsResult!.alleles : MOCK_ALLELES;
  const experiments = Array.from(new Set(finalSamples.map(s => s.experiment))).sort();

  return NextResponse.json<CopyNumberDataset>({
    source, reason, alleles, samples: finalSamples, experiments, warnings,
  });
}
