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
}

const MUTATIONS_PATH = path.resolve(process.cwd(), process.env.MUTATIONS_PATH || 'data/mutations.json');

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function normalize(raw: unknown): { dataset: MutationDataset; warnings: string[] } {
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
    const metric = asString(m.metric) ?? 'frequency';
    if (!id) { warnings.push(`Mutation skipped: missing id (${gene} ${variant}).`); continue; }
    if (seenMutIds.has(id)) { warnings.push(`Duplicate mutation id "${id}" — second occurrence ignored.`); continue; }
    seenMutIds.add(id);
    const valuesIn = (m.values && typeof m.values === 'object') ? m.values as Record<string, unknown> : {};
    const values: Record<string, number> = {};
    for (const [k, v] of Object.entries(valuesIn)) {
      const n = Number(v);
      if (Number.isFinite(n)) values[k] = n;
    }
    mutations.push({ id, gene, variant, type, metric, values });
  }

  return { dataset: { samples, mutations }, warnings };
}

export async function GET() {
  try {
    const raw = await fs.readFile(MUTATIONS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const { dataset, warnings } = normalize(parsed);
    return NextResponse.json({ ...dataset, warnings });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to read mutation dataset';
    return NextResponse.json({ error: msg, samples: [], mutations: [] }, { status: 500 });
  }
}
