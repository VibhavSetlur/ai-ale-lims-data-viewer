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

// Row shape from the new LIMS table verAB_barcodes (added 2026-06-05 by
// Natasha after the 2026-06-03 group meeting). One row per
// (Seqsample, candidate) with the read count for the bar-chart cell.
interface VerABRow {
  Seqsample: string;
  Transformation_library: string | null;
  verA: string | null;
  verB: string | null;
  Candidate: string;
  Count: number;
}

interface SeqsamplesJoinRow {
  Sequencing_sample: string;
  well: string | null;
  Sample_Name: string | null;
}

// Sample-name convention:
//   TFMN4.exp2.ACN3788.concX_largeLib_EcorI.1.T3.P
//   {experiment}.{sub}.{strain}.{library}.{replicate}.T{transfer}.{selection}
function parseSeqsampleName(name: string): {
  experiment: string;
  strain: string;
  library: string;
  replicate: number;
  transfer: number;
} | null {
  const parts = name.split('.');
  if (parts.length < 6) return null;
  // Find the .T<digits>. token — that's our transfer marker. Everything before
  // its position has fixed semantics; anything after is the selection tag.
  const tIdx = parts.findIndex(p => /^T\d+$/.test(p));
  if (tIdx < 5) return null;
  const transfer = parseInt(parts[tIdx].slice(1), 10);
  const replicate = parseInt(parts[tIdx - 1], 10);
  const library = parts[tIdx - 2];
  const strain = parts[tIdx - 3];
  // The experiment is "everything before strain" joined back together —
  // handles both "TFMN4.exp2" and a single "TFMN1" cleanly.
  const experiment = parts.slice(0, tIdx - 3).join('.');
  if (Number.isNaN(transfer) || Number.isNaN(replicate)) return null;
  return { experiment, strain, library, replicate, transfer };
}

async function tableExists(name: string): Promise<boolean> {
  try {
    if (getDbType() === 'sqlite') {
      const rows = await runQuery<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [name]
      );
      return rows.length > 0;
    }
    const rows = await runQuery<{ c: number }>(
      "SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = ?", [name]
    );
    return Number(rows[0]?.c ?? 0) > 0;
  } catch { return false; }
}

async function tryLimsBarcodes(): Promise<{ charts: BarcodeChart[]; warnings: string[] } | null> {
  if (!(await tableExists('verAB_barcodes'))) return null;

  let rows: VerABRow[];
  try {
    rows = await runQuery<VerABRow>(
      `SELECT "Seqsample", "Transformation_library", "verA", "verB", "Candidate", "Count"
       FROM verAB_barcodes
       WHERE deleted = 0 AND "Count" > 0`
    );
  } catch (e) {
    return { charts: [], warnings: [`verAB_barcodes query failed: ${e instanceof Error ? e.message : String(e)}`] };
  }
  if (rows.length === 0) return null;

  // Best-effort: pull plate well from Seqsamples (lowercase table — the newer
  // amplicon order may not be there yet, in which case well stays empty and
  // the chart card just omits the well chip).
  const seqsamples = Array.from(new Set(rows.map(r => r.Seqsample))).filter(Boolean);
  const wellMap = new Map<string, string>();
  if (seqsamples.length > 0) {
    const ph = seqsamples.map(() => '?').join(',');
    try {
      const joined = await runQuery<SeqsamplesJoinRow>(
        `SELECT ss."Sequencing_sample", ss."Sequencing_plate_well" AS well, ss."Sample_Name"
         FROM Seqsamples ss
         WHERE ss.deleted = 0 AND ss."Sequencing_sample" IN (${ph})`,
        seqsamples,
      );
      for (const j of joined) {
        if (j.well) wellMap.set(j.Sequencing_sample, j.well);
      }
    } catch { /* table missing or other error — proceed without wells */ }
  }

  // Bucket rows into charts keyed by (experiment, strain, library, replicate).
  const charts = new Map<string, BarcodeChart>();
  let skipped = 0;
  for (const r of rows) {
    const parsed = parseSeqsampleName(r.Seqsample);
    if (!parsed) { skipped++; continue; }
    const { experiment, strain, library, replicate, transfer } = parsed;
    const key = `${experiment}|${strain}|${library}|${replicate}`;
    let chart = charts.get(key);
    if (!chart) {
      chart = {
        well: wellMap.get(r.Seqsample) ?? '',
        strain, library, replicate, experiment,
        transfers: [], candidates: {},
      };
      charts.set(key, chart);
    }
    let ti = chart.transfers.indexOf(transfer);
    if (ti === -1) {
      chart.transfers.push(transfer);
      ti = chart.transfers.length - 1;
      for (const arr of Object.values(chart.candidates)) arr.push(0);
    }
    if (!(r.Candidate in chart.candidates)) {
      chart.candidates[r.Candidate] = Array(chart.transfers.length).fill(0);
    }
    chart.candidates[r.Candidate][ti] += Number(r.Count || 0);
  }

  // Sort transfers ascending inside every chart (and realign candidate arrays).
  const finalCharts: BarcodeChart[] = [];
  for (const chart of charts.values()) {
    const order = chart.transfers
      .map((t, i) => ({ t, i }))
      .sort((a, b) => a.t - b.t);
    chart.transfers = order.map(o => o.t);
    const newCands: Record<string, number[]> = {};
    for (const [cand, arr] of Object.entries(chart.candidates)) {
      newCands[cand] = order.map(o => arr[o.i] || 0);
    }
    chart.candidates = newCands;
    finalCharts.push(chart);
  }
  finalCharts.sort((a, b) =>
    a.experiment.localeCompare(b.experiment) ||
    a.library.localeCompare(b.library) ||
    a.well.localeCompare(b.well) ||
    a.replicate - b.replicate);

  const warnings: string[] = [];
  if (skipped > 0) warnings.push(`Skipped ${skipped} verAB_barcodes row${skipped === 1 ? '' : 's'} with unparseable Seqsample names.`);
  if (seqsamples.length > 0 && wellMap.size === 0) {
    warnings.push('Wet-lab well positions (e.g. B3, C4) are not yet linked from Seqsamples for these amplicon samples — chart labels use library + replicate instead.');
  }
  return { charts: finalCharts, warnings };
}

function summarize(charts: BarcodeChart[]): Pick<BarcodeDataset, 'libraries'|'wells'|'experiments'|'uniqueA'|'uniqueB'> {
  const libraries = new Set<string>();
  const wells = new Set<string>();
  const experiments = new Set<string>();
  const aSet = new Set<string>();
  const bSet = new Set<string>();
  for (const c of charts) {
    libraries.add(c.library);
    if (c.well) wells.add(c.well);
    experiments.add(c.experiment);
    for (const cand of Object.keys(c.candidates)) {
      const m = cand.match(/^(A\d+)-(B\d+)$/);
      if (m) { aSet.add(m[1]); bSet.add(m[2]); }
    }
  }
  const numSort = (a: string, b: string) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10);
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
  let limsResult: { charts: BarcodeChart[]; warnings: string[] } | null = null;
  try {
    limsResult = await tryLimsBarcodes();
  } catch (e: unknown) {
    warnings.push('verAB_barcodes probe failed: ' + (e instanceof Error ? e.message : String(e)));
  }
  if (limsResult) warnings.push(...limsResult.warnings);

  const source: 'mock' | 'lims' = limsResult && limsResult.charts.length > 0 ? 'lims' : 'mock';
  const reason = source === 'mock'
    ? 'verAB_barcodes table is missing or empty. Showing mock data shaped after the 2026-05-26 SeqCenter QUO1022807 figure set so the view is exercise-able. The viewer auto-switches to live LIMS data the moment the table is populated (per Natasha’s 2026-06-05 update).'
    : undefined;
  const finalCharts = source === 'lims' ? limsResult!.charts : MOCK_BARCODES;
  const meta = summarize(finalCharts);
  return NextResponse.json<BarcodeDataset>({
    source, reason, charts: finalCharts, warnings, ...meta,
  });
}
