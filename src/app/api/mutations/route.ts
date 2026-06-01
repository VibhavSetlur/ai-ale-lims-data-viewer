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
}

const MUTATIONS_PATH = path.resolve(process.cwd(), process.env.MUTATIONS_PATH || 'data/mutations.json');

export async function GET() {
  try {
    const raw = await fs.readFile(MUTATIONS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as MutationDataset;
    return NextResponse.json(parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to read mutation dataset';
    return NextResponse.json({ error: msg, samples: [], mutations: [] }, { status: 500 });
  }
}
