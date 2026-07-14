import { NextResponse } from 'next/server';
import { runQuery, getDbType } from '@/lib/db';
import { MOCK_BARCODES, type MockBarcodeChart } from '@/lib/mockBarcodes';

export type BarcodeChart = MockBarcodeChart;

export interface BarcodeDataset {
  source: 'mock' | 'lims';
  reason?: string;
  charts: BarcodeChart[];
  libraries: string[];
  wells: string[];
  experiments: string[];
  seqorders: string[];
  uniqueA: string[];
  uniqueB: string[];
  warnings: string[];
}

// Row shape from the new LIMS table verAB_barcodes (added 2026-06-05 by
// Natasha after the 2026-06-03 group meeting). One row per
// (Seqsample, candidate) with the read count for the bar-chart cell.
interface VerABRow {
  Seqorder: string | null;
  Seqsample: string;
  Transformation_library: string | null;
  verA: string | null;
  verB: string | null;
  Candidate: string;
  Count: number;
}

interface SeqsamplesJoinRow {
  Sequencing_sample: string;
  Seqorder: string | null;
  well: string | null;
  Sample_Name: string | null;
}

interface SeqsampleMeta {
  well: string;
  sampleName: string;
  seqorder: string;
  sampleNameSource: 'Seq_samples.Sample_Name' | 'verAB_barcodes.Seqsample';
  joined: boolean;
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
  // Find the .T<digits> token — that's our transfer marker. Accept the legacy
  // trailing selection tag as either a separate segment or absent entirely.
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

function parseSampleName(name: string): {
  experiment: string;
  strain: string;
  library: string;
  replicate: number;
} | null {
  const parts = name.split('.');
  if (parts.length < 5) return null;
  const replicate = parseInt(parts[parts.length - 1], 10);
  if (Number.isNaN(replicate)) return null;
  const library = parts[parts.length - 2];
  const strain = parts[parts.length - 3];
  const experiment = parts.slice(0, parts.length - 3).join('.');
  if (!experiment || !strain || !library) return null;
  return { experiment, strain, library, replicate };
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
      `SELECT "Seqorder", "Seqsample", "Transformation_library", "verA", "verB", "Candidate", "Count"
       FROM verAB_barcodes
       WHERE deleted = 0 AND "Count" > 0`
    );
  } catch (e) {
    return { charts: [], warnings: [`verAB_barcodes query failed: ${e instanceof Error ? e.message : String(e)}`] };
  }
  if (rows.length === 0) return null;

  // Best-effort: pull plate well from Seq_samples (the authoritative table; the
  // legacy lowercase "Seqsamples" mirror is a strict subset that is missing the
  // newer amplicon orders, so it had 0 well coverage for verAB samples). If a
  // sample still has no well the chart card just omits the well chip.
  const seqsamples = Array.from(new Set(rows.map(r => r.Seqsample))).filter(Boolean);
  const metaMap = new Map<string, SeqsampleMeta>();
  let joinFailed = false;
  let joinReturnedNoRows = false;
  if (seqsamples.length > 0) {
    const ph = seqsamples.map(() => '?').join(',');
    try {
      const joined = await runQuery<SeqsamplesJoinRow>(
        `SELECT ss."Sequencing_sample", ss."Seqorder", ss."Sequencing_plate_well" AS well, ss."Sample_Name"
         FROM Seq_samples ss
         WHERE ss.deleted = 0 AND ss."Sequencing_sample" IN (${ph})`,
        seqsamples,
      );
      joinReturnedNoRows = joined.length === 0;
      for (const j of joined) {
        metaMap.set(j.Sequencing_sample, {
          well: j.well ?? '',
          sampleName: j.Sample_Name || j.Sequencing_sample,
          seqorder: j.Seqorder ?? '',
          sampleNameSource: j.Sample_Name ? 'Seq_samples.Sample_Name' : 'verAB_barcodes.Seqsample',
          joined: true,
        });
      }
    } catch { joinFailed = true; }
  }

  // Bucket rows into charts keyed by biological sample identity. Counts stay from
  // verAB_barcodes; transfer still comes from Seqsample because Sample_Name is the
  // base biological sample name and does not include T#/selection.
  const charts = new Map<string, BarcodeChart>();
  let skipped = 0;
  const fallbackSampleNames = new Set<string>();
  const missingSeqSampleLinks = new Set<string>();
  const unparseableSampleNames = new Set<string>();
  for (const r of rows) {
    const meta = metaMap.get(r.Seqsample) ?? {
      well: '',
      sampleName: r.Seqsample,
      seqorder: r.Seqorder ?? '',
      sampleNameSource: 'verAB_barcodes.Seqsample' as const,
      joined: false,
    };
    const seqorder = meta.seqorder || r.Seqorder || '';
    if (!meta.joined) missingSeqSampleLinks.add(r.Seqsample);
    if (meta.sampleNameSource !== 'Seq_samples.Sample_Name') fallbackSampleNames.add(r.Seqsample);

    const parsedTransfer = parseSeqsampleName(r.Seqsample);
    let parsedIdentity = meta.sampleNameSource === 'Seq_samples.Sample_Name'
      ? parseSampleName(meta.sampleName)
      : parsedTransfer;
    if (!parsedIdentity && parsedTransfer) {
      unparseableSampleNames.add(meta.sampleName);
      parsedIdentity = parsedTransfer;
    }
    if (!parsedIdentity || !parsedTransfer) { skipped++; continue; }
    const { experiment, strain, library, replicate } = parsedIdentity;
    const transfer = parsedTransfer.transfer;
    const key = `${experiment}|${strain}|${library}|${replicate}|${meta.sampleName}|${seqorder || 'no-seqorder'}`;
    let chart = charts.get(key);
    if (!chart) {
      chart = {
        well: meta.well,
        sampleName: meta.sampleName,
        seqorder: seqorder || undefined,
        seqorders: seqorder ? [seqorder] : [],
        sampleNameSource: meta.sampleNameSource,
        seqsamples: [],
        transformationLibrary: r.Transformation_library ?? undefined,
        barcodeSourceTable: 'verAB_barcodes',
        strain, library, replicate, experiment,
        transfers: [], candidates: {},
      };
      charts.set(key, chart);
    }
    if (seqorder && !chart.seqorders?.includes(seqorder)) chart.seqorders = [...(chart.seqorders ?? []), seqorder].sort();
    if (!chart.seqorder && seqorder) chart.seqorder = seqorder;
    if (!chart.seqsamples?.includes(r.Seqsample)) chart.seqsamples = [...(chart.seqsamples ?? []), r.Seqsample];
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
    (a.sampleName || a.strain).localeCompare(b.sampleName || b.strain) ||
    (a.seqorder || '').localeCompare(b.seqorder || '') ||
    a.experiment.localeCompare(b.experiment) ||
    a.library.localeCompare(b.library) ||
    (a.well || '~').localeCompare(b.well || '~') ||
    a.replicate - b.replicate);

  const warnings: string[] = [];
  if (joinFailed) warnings.push('Seq_samples join failed; barcode chart labels fell back to verAB_barcodes.Seqsample.');
  if (joinReturnedNoRows) warnings.push('Seq_samples join returned zero rows for verAB_barcodes.Seqsample values; labels used Seqsample fallback.');
  if (skipped > 0) warnings.push(`Skipped ${skipped} verAB_barcodes row${skipped === 1 ? '' : 's'} with unparseable Seqsample names.`);
  if (missingSeqSampleLinks.size > 0) warnings.push(`${missingSeqSampleLinks.size} Seqsample${missingSeqSampleLinks.size === 1 ? '' : 's'} had no Seq_samples match; those labels used Seqsample fallback.`);
  if (fallbackSampleNames.size > 0) warnings.push(`${fallbackSampleNames.size} Seqsample${fallbackSampleNames.size === 1 ? '' : 's'} used Seqsample fallback because Seq_samples.Sample_Name was missing.`);
  if (unparseableSampleNames.size > 0) warnings.push(`${unparseableSampleNames.size} Seq_samples.Sample_Name value${unparseableSampleNames.size === 1 ? '' : 's'} could not be parsed; identity fell back to Seqsample.`);
  if (seqsamples.length > 0 && !finalCharts.some(c => c.well)) {
    warnings.push('Plate-well positions are null in Seq_samples for these barcode samples; chart labels use sample/library/replicate instead.');
  }
  return { charts: finalCharts, warnings };
}

function summarize(charts: BarcodeChart[]): Pick<BarcodeDataset, 'libraries'|'wells'|'experiments'|'seqorders'|'uniqueA'|'uniqueB'> {
  const libraries = new Set<string>();
  const wells = new Set<string>();
  const experiments = new Set<string>();
  const seqorders = new Set<string>();
  const aSet = new Set<string>();
  const bSet = new Set<string>();
  for (const c of charts) {
    libraries.add(c.library);
    if (c.well) wells.add(c.well);
    experiments.add(c.experiment);
    if (c.seqorder) seqorders.add(c.seqorder);
    for (const seqorder of c.seqorders ?? []) seqorders.add(seqorder);
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
    seqorders: [...seqorders].sort(),
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
