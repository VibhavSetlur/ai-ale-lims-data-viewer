import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

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
  source?: { path: string; format: 'json' | 'csv' | 'tsv' };
}

const MUTATIONS_PATH = path.resolve(process.cwd(), process.env.MUTATIONS_PATH || 'data/mutations.json');

function asString(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}
function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}
function detectFormat(filePath: string, head: string): 'json' | 'csv' | 'tsv' {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.tsv' || ext === '.tab') return 'tsv';
  if (ext === '.csv') return 'csv';
  // Sniff: leading '{' or '[' → json; tab-rich first line → tsv; else csv.
  const trimmed = head.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  const firstLine = head.split(/\r?\n/, 1)[0] ?? '';
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return tabs > commas ? 'tsv' : 'csv';
}

/* ---------- Delimited (CSV/TSV) parsing ---------- */

function parseDelimited(text: string, delimiter: string): string[][] {
  // RFC-4180-ish parser supporting quoted fields, embedded delimiters, doubled quotes, and \r\n.
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === delimiter) { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch === '\r') { /* swallow; \n handles row end */ }
      else cur += ch;
    }
  }
  row.push(cur);
  rows.push(row);
  // Drop trailing entirely-empty rows
  while (rows.length > 0 && rows[rows.length - 1].every(c => c === '')) rows.pop();
  return rows;
}

// Aliases for the optional metadata-row keys users may put above the gene header.
const METADATA_KEYS: Record<string, keyof MutationSample> = {
  'experiment': 'experiment',
  'experiment_type': 'experiment_type',
  'experiment type': 'experiment_type',
  'replicate': 'replicate',
  'rep': 'replicate',
  'donor_dna': 'donor_dna',
  'donor dna': 'donor_dna',
  'donor': 'donor_dna',
  'condition': 'condition',
  'transfer': 'transfer',
  'transfers': 'transfer',
  't': 'transfer',
  'strain': 'strain',
  'name': 'name',
  'sample name': 'name',
  'sample_name': 'name',
  'id': 'id',
  'sample_id': 'id',
  'selection_note': 'selection_note',
  'selection note': 'selection_note',
};

const DESCRIPTOR_KEYS: Record<string, 'gene' | 'variant' | 'type' | 'metric' | 'id'> = {
  'gene': 'gene',
  'variant': 'variant',
  'mutation': 'variant',
  'allele': 'variant',
  'type': 'type',
  'mutation_type': 'type',
  'metric': 'metric',
  'unit': 'metric',
  'id': 'id',
  'mutation_id': 'id',
};

function inferMetric(typeOrMetric: string): string {
  const s = typeOrMetric.toLowerCase();
  if (/copy[_ ]?number|amplification|cnv/.test(s)) return 'copy_number';
  if (/freq|percent|%|allele/.test(s)) return 'frequency';
  return 'frequency';
}

function parseWideTable(rows: string[][]): { dataset: MutationDataset; warnings: string[] } {
  const warnings: string[] = [];
  if (rows.length === 0) return { dataset: { samples: [], mutations: [] }, warnings: ['Empty file.'] };

  // Find the header row: first row containing a cell that matches a DESCRIPTOR_KEY (looking for "gene" specifically).
  let headerIdx = -1;
  let descriptorCols: { gene?: number; variant?: number; type?: number; metric?: number; id?: number } = {};
  let sampleColStart = -1;
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].map(c => c.trim());
    const found: typeof descriptorCols = {};
    cells.forEach((c, i) => {
      const k = DESCRIPTOR_KEYS[c.toLowerCase()];
      if (k && found[k] === undefined) found[k] = i;
    });
    if (found.gene !== undefined) {
      headerIdx = r;
      descriptorCols = found;
      // sample columns start right of the rightmost recognized descriptor.
      const maxDescriptor = Math.max(...Object.values(found).filter((v): v is number => v !== undefined));
      // Skip an optional "sample" / "sample →" placeholder column.
      let start = maxDescriptor + 1;
      while (start < cells.length && /^(sample|sample →|sample\s*→)?$/i.test(cells[start])) start++;
      sampleColStart = start;
      break;
    }
  }
  if (headerIdx === -1) {
    return { dataset: { samples: [], mutations: [] }, warnings: ['No header row found (expected a "gene" column).'] };
  }

  const headerCells = rows[headerIdx].map(c => c.trim());
  const sampleColumns = headerCells.slice(sampleColStart);
  if (sampleColumns.length === 0) {
    return { dataset: { samples: [], mutations: [] }, warnings: ['Header row has no sample columns.'] };
  }
  if (sampleColumns.some(c => c === '')) {
    warnings.push('Some sample-column headers are empty; those columns will be ignored.');
  }

  // Build per-sample metadata from rows above the header.
  const samplesByCol: MutationSample[] = sampleColumns.map((name, idx) => ({
    id: name || `sample_${idx + 1}`,
    name: name || `sample_${idx + 1}`,
    experiment: '',
  }));

  for (let r = 0; r < headerIdx; r++) {
    const cells = rows[r].map(c => c.trim());
    if (cells.every(c => c === '')) continue;
    // Find the metadata key: first non-empty cell that matches METADATA_KEYS (search columns 0..sampleColStart-1).
    let keyName: keyof MutationSample | null = null;
    for (let c = 0; c < Math.min(sampleColStart, cells.length); c++) {
      const k = METADATA_KEYS[cells[c].toLowerCase()];
      if (k) { keyName = k; break; }
    }
    if (!keyName) continue;
    for (let c = 0; c < sampleColumns.length; c++) {
      const colIdx = sampleColStart + c;
      const raw = cells[colIdx] ?? '';
      if (raw === '') continue;
      const s = samplesByCol[c];
      if (keyName === 'transfer') {
        const n = asNumber(raw);
        if (n !== undefined) s.transfer = n;
      } else if (keyName === 'id') {
        s.id = raw;
      } else {
        (s as unknown as Record<string, unknown>)[keyName] = raw;
      }
    }
  }

  // Mark robotic ALE if experiment_type isn't set but experiment looks like ALE.
  for (const s of samplesByCol) {
    if (!s.experiment_type && /^ale\b/i.test(s.experiment || '')) s.experiment_type = 'robotic ALE';
  }

  // De-duplicate sample IDs after metadata-driven id overrides.
  const seenSampleIds = new Set<string>();
  const samples: MutationSample[] = [];
  const colToId: (string | null)[] = [];
  for (let c = 0; c < samplesByCol.length; c++) {
    const s = samplesByCol[c];
    if (!sampleColumns[c]) { colToId.push(null); continue; }
    if (seenSampleIds.has(s.id)) {
      warnings.push(`Duplicate sample id "${s.id}" in column ${c + sampleColStart + 1} — column ignored.`);
      colToId.push(null);
      continue;
    }
    seenSampleIds.add(s.id);
    samples.push(s);
    colToId.push(s.id);
  }

  // Mutation rows: every row below the header.
  const seenMutIds = new Set<string>();
  const mutations: MutationRow[] = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const cells = rows[r].map(c => c.trim());
    if (cells.every(c => c === '')) continue;
    const gene = descriptorCols.gene !== undefined ? (cells[descriptorCols.gene] ?? '') : '';
    if (!gene) continue;
    const variant = descriptorCols.variant !== undefined ? (cells[descriptorCols.variant] ?? '') : '';
    const type = descriptorCols.type !== undefined ? (cells[descriptorCols.type] ?? '') : '';
    const metricCell = descriptorCols.metric !== undefined ? (cells[descriptorCols.metric] ?? '') : '';
    const metric = metricCell || inferMetric(type);
    const idCell = descriptorCols.id !== undefined ? (cells[descriptorCols.id] ?? '') : '';
    const id = idCell || `${gene}.${variant || 'na'}.${type || metric}`.replace(/\s+/g, '_');
    if (seenMutIds.has(id)) {
      warnings.push(`Duplicate mutation id "${id}" — second occurrence ignored.`);
      continue;
    }
    seenMutIds.add(id);
    const values: Record<string, number> = {};
    for (let c = 0; c < sampleColumns.length; c++) {
      const sid = colToId[c];
      if (!sid) continue;
      const raw = cells[sampleColStart + c] ?? '';
      if (raw === '') continue;
      let n = asNumber(raw);
      if (n === undefined && raw.endsWith('%')) {
        const pn = Number(raw.slice(0, -1));
        if (Number.isFinite(pn)) n = pn / 100;
      }
      if (n !== undefined) values[sid] = n;
    }
    mutations.push({ id, gene, variant, type, metric, values });
  }

  return { dataset: { samples, mutations }, warnings };
}

/* ---------- JSON (wide format) ---------- */

function normalizeJson(raw: unknown): { dataset: MutationDataset; warnings: string[] } {
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { dataset: { samples: [], mutations: [] }, warnings: ['Top-level JSON is not an object.'] };
  }
  const r = raw as Record<string, unknown>;
  const samplesIn = Array.isArray(r.samples) ? r.samples : [];
  const mutationsIn = Array.isArray(r.mutations) ? r.mutations : [];
  if (!Array.isArray(r.samples)) warnings.push('Missing or invalid "samples" array.');
  if (!Array.isArray(r.mutations)) warnings.push('Missing or invalid "mutations" array.');

  const seenIds = new Set<string>();
  const samples: MutationSample[] = [];
  for (const item of samplesIn) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    const id = asString(s.id);
    const name = asString(s.name) ?? id;
    const experiment = asString(s.experiment) ?? '';
    if (!id || !name) { warnings.push(`Sample skipped: missing id or name (${JSON.stringify(s).slice(0, 80)}).`); continue; }
    if (seenIds.has(id)) { warnings.push(`Duplicate sample id "${id}" — second occurrence ignored.`); continue; }
    seenIds.add(id);
    let growth_curve: { t: number; od: number }[] | undefined;
    if (Array.isArray(s.growth_curve)) {
      growth_curve = s.growth_curve
        .map(p => (p && typeof p === 'object' ? p as Record<string, unknown> : null))
        .filter((p): p is Record<string, unknown> => !!p)
        .map(p => ({ t: Number(p.t), od: Number(p.od) }))
        .filter(p => Number.isFinite(p.t) && Number.isFinite(p.od));
      if (growth_curve.length === 0) growth_curve = undefined;
    }
    samples.push({
      id,
      name,
      experiment,
      experiment_type: asString(s.experiment_type),
      replicate: asString(s.replicate),
      transfer: asNumber(s.transfer),
      condition: asString(s.condition),
      strain: asString(s.strain),
      donor_dna: asString(s.donor_dna),
      selection_note: asString(s.selection_note),
      growth_curve,
    });
  }

  const seenMutIds = new Set<string>();
  const mutations: MutationRow[] = [];
  for (const item of mutationsIn) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Record<string, unknown>;
    const id = asString(m.id);
    const gene = asString(m.gene) ?? '';
    const variant = asString(m.variant) ?? '';
    const type = asString(m.type) ?? '';
    const metric = asString(m.metric) ?? inferMetric(type);
    if (!id) { warnings.push(`Mutation skipped: missing id (${gene} ${variant}).`); continue; }
    if (seenMutIds.has(id)) { warnings.push(`Duplicate mutation id "${id}" — second occurrence ignored.`); continue; }
    seenMutIds.add(id);
    const values: Record<string, number> = {};
    const valuesIn = (m.values && typeof m.values === 'object') ? m.values as Record<string, unknown> : {};
    // Wide format: { [sampleId]: number }
    // Long format: [{ sample_id, value } ...]
    if (Array.isArray(m.values)) {
      for (const entry of m.values as unknown[]) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        const sid = asString(e.sample_id) ?? asString(e.sampleId) ?? asString(e.id);
        const n = asNumber(e.value);
        if (sid && n !== undefined) values[sid] = n;
      }
    } else {
      for (const [k, v] of Object.entries(valuesIn)) {
        const n = asNumber(v);
        if (n !== undefined) values[k] = n;
      }
    }
    mutations.push({ id, gene, variant, type, metric, values });
  }

  return { dataset: { samples, mutations }, warnings };
}

/* ---------- Route ---------- */

export async function GET() {
  try {
    const raw = await fs.readFile(MUTATIONS_PATH, 'utf-8');
    const format = detectFormat(MUTATIONS_PATH, raw.slice(0, 2048));
    let result: { dataset: MutationDataset; warnings: string[] };
    if (format === 'json') {
      const parsed = JSON.parse(raw) as unknown;
      result = normalizeJson(parsed);
    } else {
      const delim = format === 'tsv' ? '\t' : ',';
      const rows = parseDelimited(raw, delim);
      result = parseWideTable(rows);
    }
    return NextResponse.json({
      ...result.dataset,
      warnings: result.warnings,
      source: { path: MUTATIONS_PATH, format },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to read mutation dataset';
    return NextResponse.json({ error: msg, samples: [], mutations: [] }, { status: 500 });
  }
}
