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

// Probe for a `metric=copy_number` flag column or a dedicated copy_number
// field on Mutations. If found, group by (seq_sample, gene_name) and recover
// the copy count. Otherwise return mock data so the heat-map view stays alive.
async function tryLimsCopyNumber(): Promise<MockCopyNumberSample[] | null> {
  let probe: { name: string }[] = [];
  try {
    probe = await runQuery<{ name: string }>(
      getDbType() === 'sqlite'
        ? 'PRAGMA table_info("Mutations")'
        : "SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Mutations'"
    );
  } catch { return null; }
  const cols = new Set(probe.map(c => c.name?.toLowerCase()));
  const copyCol = ['copy_number', 'copies', 'cn'].find(c => cols.has(c));
  const metricCol = ['metric', 'value_type', 'mutation_metric'].find(c => cols.has(c));
  if (!copyCol && !metricCol) return null;
  // Real-data path: scaffold only. Once the column lands, expand to project
  // (Seq_sample, gene_name, copy count) and bucket into rows.
  try {
    const _rows = await runQuery<MutationCopyRow>(
      copyCol
        ? `SELECT "Seq_sample" AS seq_sample, "Experiment" AS experiment, "gene_name", "${copyCol}" AS copies
            FROM Mutations WHERE "${copyCol}" IS NOT NULL LIMIT 1`
        : `SELECT "Seq_sample" AS seq_sample, "Experiment" AS experiment, "gene_name", "frequency" AS copies
            FROM Mutations WHERE "${metricCol}" = 'copy_number' LIMIT 1`
    );
    if (_rows.length === 0) return null;
  } catch { return null; }
  return null;
}

export async function GET() {
  const warnings: string[] = [];
  let samples: MockCopyNumberSample[] | null = null;
  try {
    samples = await tryLimsCopyNumber();
  } catch (e: unknown) {
    warnings.push('LIMS copy-number probe failed: ' + (e instanceof Error ? e.message : String(e)));
  }
  const source: 'mock' | 'lims' = samples && samples.length > 0 ? 'lims' : 'mock';
  const reason = source === 'mock'
    ? 'Mutations table has no copy_number / metric column populated yet. Showing mock data so the heat-map view is exercise-able. Replace with real rows once Natasha adds the special-typed copy-number rows (per 2026-06-03 group meeting).'
    : undefined;
  const finalSamples = source === 'lims' ? samples! : MOCK_COPY_NUMBER;
  const alleles = source === 'lims'
    ? Array.from(new Set(finalSamples.flatMap(s => Object.keys(s.copies)))).sort()
    : MOCK_ALLELES;
  const experiments = Array.from(new Set(finalSamples.map(s => s.experiment))).sort();
  return NextResponse.json<CopyNumberDataset>({
    source, reason, alleles, samples: finalSamples, experiments, warnings,
  });
}
