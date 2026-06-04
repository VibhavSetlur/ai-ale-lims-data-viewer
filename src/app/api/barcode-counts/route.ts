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

interface MutationConstructRow {
  seq_sample: string;
  experiment: string | null;
  construct: string | null;
  count: number;
}

interface SeqSampleJoinRow {
  seq_sample: string;
  experiment: string | null;
  sample_name: string | null;
  well: string | null;
  pop_or_colony: string | null;
}

// Mutations.{construct|library|mutation_set} → "library:candidate" per the
// 2026-06-03 meeting (Natasha's convention, e.g. "concX_largeLib_SpeI:A153-B10").
// We split on the first colon: prefix = library, suffix = candidate. Anything
// without a colon is treated as candidate-only and falls under a "(none)"
// library — better than dropping the row.
function splitConstruct(value: string): { library: string; candidate: string } {
  const idx = value.indexOf(':');
  if (idx === -1) return { library: '(none)', candidate: value };
  return { library: value.slice(0, idx), candidate: value.slice(idx + 1) };
}

// Recover transfer and replicate from the seq_sample suffix and the sample
// name's trailing `.N`, matching the conventions used by the mutations API.
function parseSeqSampleSuffix(seqSample: string): { transfer?: number } {
  const m = seqSample.match(/\.T(\d+)\.[A-Za-z]\w*$/);
  return m ? { transfer: parseInt(m[1], 10) } : {};
}
function deriveReplicate(sampleName: string | null): number | null {
  if (!sampleName) return null;
  const m = sampleName.match(/\.(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

async function probeConstructColumn(): Promise<string | null> {
  let cols: { name: string }[] = [];
  try {
    cols = await runQuery<{ name: string }>(
      getDbType() === 'sqlite'
        ? 'PRAGMA table_info("Mutations")'
        : "SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Mutations'"
    );
  } catch { return null; }
  const lower = new Map(cols.map(c => [c.name.toLowerCase(), c.name]));
  for (const candidate of ['construct', 'library', 'mutation_set']) {
    const real = lower.get(candidate);
    if (real) return real;
  }
  return null;
}

// Build chart data straight from the LIMS once Natasha's construct column is
// populated. Returns null if the column exists but is empty (so we fall back
// to mock rather than rendering blank charts).
async function tryLimsBarcodes(): Promise<{ charts: BarcodeChart[]; warnings: string[] } | null> {
  const col = await probeConstructColumn();
  if (!col) return null;

  const quoted = `"${col.replace(/"/g, '""')}"`;
  let countRows: MutationConstructRow[];
  try {
    countRows = await runQuery<MutationConstructRow>(
      `SELECT "Seq_sample" AS seq_sample,
              "Experiment" AS experiment,
              ${quoted}    AS construct,
              COUNT(*)     AS count
       FROM Mutations
       WHERE deleted = 0
         AND ${quoted} IS NOT NULL
         AND ${quoted} != ''
       GROUP BY "Seq_sample", "Experiment", ${quoted}`
    );
  } catch (e) {
    return { charts: [], warnings: [`LIMS construct-column query failed: ${e instanceof Error ? e.message : String(e)}`] };
  }

  if (countRows.length === 0) return null;

  // Bring in well/sample_name/replicate for every observed seq_sample so we
  // can label charts the same way Natasha's PDFs do.
  const seqSamples = Array.from(new Set(countRows.map(r => r.seq_sample))).filter(Boolean);
  const placeholders = seqSamples.map(() => '?').join(',');
  let joinRows: SeqSampleJoinRow[] = [];
  if (seqSamples.length > 0) {
    try {
      joinRows = await runQuery<SeqSampleJoinRow>(
        `SELECT ss."Sequencing_sample" AS seq_sample,
                ss."Experiment"        AS experiment,
                ss."Sample_Name"       AS sample_name,
                ss."Sequencing_plate_well" AS well,
                ss."Population_or_Single_colony?" AS pop_or_colony
         FROM Seq_samples ss
         WHERE ss.deleted = 0 AND ss."Sequencing_sample" IN (${placeholders})`,
        seqSamples,
      );
    } catch (e) {
      // Join failure shouldn't kill the whole view — proceed with empty join.
      void e;
    }
  }
  const joinIdx = new Map(joinRows.map(r => [r.seq_sample, r]));

  // Pull strain/transforming_dna from Samples so charts get a proper strain
  // label and the right experiment + library when the construct prefix is
  // ambiguous. Best-effort.
  let strainRows: { sample_name: string; strain: string | null; transforming_dna: string | null }[] = [];
  const sampleNames = Array.from(new Set(joinRows.map(r => r.sample_name).filter((n): n is string => !!n)));
  if (sampleNames.length > 0) {
    const ph = sampleNames.map(() => '?').join(',');
    try {
      strainRows = await runQuery<{ sample_name: string; strain: string | null; transforming_dna: string | null }>(
        `SELECT "Name" AS sample_name, "Strain_name" AS strain, "Transforming_DNA" AS transforming_dna
         FROM Samples WHERE deleted = 0 AND "Name" IN (${ph})`,
        sampleNames,
      );
    } catch (e) { void e; }
  }
  const strainIdx = new Map(strainRows.map(r => [r.sample_name, r]));

  // Bucket countRows into charts keyed by (experiment, well, strain, library, replicate).
  const charts = new Map<string, BarcodeChart>();
  for (const row of countRows) {
    if (!row.construct) continue;
    const { library, candidate } = splitConstruct(row.construct);
    const join = joinIdx.get(row.seq_sample);
    const strainRow = join?.sample_name ? strainIdx.get(join.sample_name) : null;
    const { transfer } = parseSeqSampleSuffix(row.seq_sample);
    const replicate = deriveReplicate(join?.sample_name ?? null) ?? 1;
    const strain = strainRow?.strain ?? '(unknown)';
    const experiment = (row.experiment || join?.experiment || strainRow?.transforming_dna || '(unknown)').toString();
    const well = join?.well ?? '—';
    const key = `${experiment}|${well}|${strain}|${library}|${replicate}`;
    let chart = charts.get(key);
    if (!chart) {
      chart = {
        well, strain, library, replicate, experiment,
        transfers: [], candidates: {},
      };
      charts.set(key, chart);
    }
    const t = typeof transfer === 'number' ? transfer : 0;
    let ti = chart.transfers.indexOf(t);
    if (ti === -1) {
      chart.transfers.push(t);
      ti = chart.transfers.length - 1;
      // Pad all existing candidate arrays so they stay aligned.
      for (const arr of Object.values(chart.candidates)) arr.push(0);
    }
    if (!(candidate in chart.candidates)) {
      chart.candidates[candidate] = Array(chart.transfers.length).fill(0);
    }
    chart.candidates[candidate][ti] = (chart.candidates[candidate][ti] || 0) + Number(row.count || 0);
  }

  // Sort transfers ascending within each chart (and re-align candidate arrays).
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
  // Stable, useful sort: experiment → library → well → replicate.
  finalCharts.sort((a, b) =>
    a.experiment.localeCompare(b.experiment) ||
    a.library.localeCompare(b.library) ||
    a.well.localeCompare(b.well) ||
    a.replicate - b.replicate);

  return { charts: finalCharts, warnings: [] };
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
    warnings.push('LIMS barcode probe failed: ' + (e instanceof Error ? e.message : String(e)));
  }
  if (limsResult) warnings.push(...limsResult.warnings);

  const source: 'mock' | 'lims' = limsResult && limsResult.charts.length > 0 ? 'lims' : 'mock';
  const reason = source === 'mock'
    ? 'Mutations table has no construct/library column populated yet. Showing mock data shaped after the 2026-05-26 SeqCenter QUO1022807 figure set so the view is exercise-able. The viewer will auto-switch to live LIMS data the moment that column appears (per 2026-06-03 group meeting) — no code change needed.'
    : undefined;
  const finalCharts = source === 'lims' ? limsResult!.charts : MOCK_BARCODES;
  const meta = summarize(finalCharts);
  return NextResponse.json<BarcodeDataset>({
    source, reason, charts: finalCharts, warnings, ...meta,
  });
}
