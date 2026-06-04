import { NextResponse } from 'next/server';
import { runQuery, getDbType } from '@/lib/db';
import { MOCK_BARCODES, type MockBarcodeChart } from '@/lib/mockBarcodes';

export interface BarcodeChart extends MockBarcodeChart {}

export interface BarcodeDataset {
  source: 'mock' | 'lims';
  reason?: string;
  charts: BarcodeChart[];
  libraries: string[];
  wells: string[];
  experiments: string[];
  uniqueA: string[];
  uniqueB: string[];
  warnings: string[];
}

interface MutationLibraryRow {
  seq_sample: string;
  construct: string | null;
  count: number;
}

// Heuristic: if the Mutations table grows a "construct" or "library" column
// (the meeting's resolution), drive the chart directly from it. Otherwise we
// return mock data so the UI keeps working — clearly flagged in the response.
async function tryLimsBarcodes(): Promise<BarcodeChart[] | null> {
  if (getDbType() !== 'sqlite' && getDbType() !== 'mysql') return null;
  // Probe schema for a construct/library column on Mutations.
  let probe: { name: string }[] = [];
  try {
    probe = await runQuery<{ name: string }>(
      getDbType() === 'sqlite'
        ? 'PRAGMA table_info("Mutations")'
        : "SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Mutations'"
    );
  } catch { return null; }
  const cols = new Set(probe.map(c => c.name?.toLowerCase()));
  const constructCol = ['construct', 'library', 'mutation_set'].find(c => cols.has(c));
  if (!constructCol) return null;

  // Real-data path — left as a thin scaffold that returns empty so the API
  // falls through to mock. Once Natasha lands the column, expand this to
  // group by construct value and join Seq_samples to recover well/replicate.
  try {
    const _rows = await runQuery<MutationLibraryRow>(
      `SELECT "Seq_sample" AS seq_sample, "${constructCol}" AS construct, COUNT(*) AS count
       FROM Mutations WHERE "${constructCol}" IS NOT NULL AND "${constructCol}" != ''
       GROUP BY "Seq_sample", "${constructCol}" LIMIT 1`
    );
    if (_rows.length === 0) return null;
  } catch { return null; }
  // Not yet implemented — keep mock until column is populated.
  return null;
}

function summarize(charts: BarcodeChart[]): Pick<BarcodeDataset, 'libraries'|'wells'|'experiments'|'uniqueA'|'uniqueB'> {
  const libraries = new Set<string>();
  const wells = new Set<string>();
  const experiments = new Set<string>();
  const aSet = new Set<string>();
  const bSet = new Set<string>();
  for (const c of charts) {
    libraries.add(c.library);
    wells.add(c.well);
    experiments.add(c.experiment);
    for (const cand of Object.keys(c.candidates)) {
      const m = cand.match(/^(A\d+)-(B\d+)$/);
      if (m) { aSet.add(m[1]); bSet.add(m[2]); }
    }
  }
  const numSort = (a: string, b: string) => {
    const na = parseInt(a.slice(1), 10), nb = parseInt(b.slice(1), 10);
    return na - nb;
  };
  return {
    libraries: [...libraries].sort(),
    wells: [...wells].sort(),
    experiments: [...experiments].sort(),
    uniqueA: [...aSet].sort(numSort),
    uniqueB: [...bSet].sort(numSort),
  };
}

export async function GET() {
  const warnings: string[] = [];
  let charts: BarcodeChart[] | null = null;
  try {
    charts = await tryLimsBarcodes();
  } catch (e: unknown) {
    warnings.push('LIMS barcode probe failed: ' + (e instanceof Error ? e.message : String(e)));
  }
  const source: 'mock' | 'lims' = charts && charts.length > 0 ? 'lims' : 'mock';
  const reason = source === 'mock'
    ? 'Mutations table has no construct/library column populated yet. Showing mock data shaped after the 2026-05-26 SeqCenter QUO1022807 figure set so the view is exercise-able. Replace with real rows once Natasha adds the column (per 2026-06-03 group meeting).'
    : undefined;
  const finalCharts = source === 'lims' ? charts! : MOCK_BARCODES;
  const meta = summarize(finalCharts);
  const dataset: BarcodeDataset = {
    source, reason, charts: finalCharts, warnings, ...meta,
  };
  return NextResponse.json(dataset);
}
