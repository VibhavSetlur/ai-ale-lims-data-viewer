import { NextResponse } from 'next/server';
import { runQuery, getDbType, getDbConfig } from '@/lib/db';
import fs from 'fs';

export interface MirrorInfo {
  driver: 'sqlite' | 'mysql';
  path?: string;
  size_bytes?: number;
  mtime?: string;            // file mtime, ISO
  snapshot_at?: string;      // MAX(last_synced) across known tables
  table_counts: Record<string, number>;
  warnings: string[];
}

// Tables in the LIMS that carry a `last_synced` column. We probe all of them
// and pick the most recent timestamp as the snapshot moment.
const CANDIDATE_TABLES = [
  'Mutations', 'Seq_samples', 'Samples', 'Experiments',
  'Transformation_libraries', 'DNA_constructs', 'Strains',
];

async function safeMaxSynced(table: string): Promise<string | null> {
  try {
    const rows = await runQuery<{ ts: string | null }>(
      `SELECT MAX(last_synced) AS ts FROM "${table}"`
    );
    return rows[0]?.ts ?? null;
  } catch { return null; }
}

async function safeCount(table: string): Promise<number | null> {
  try {
    const rows = await runQuery<{ c: number }>(`SELECT COUNT(*) AS c FROM "${table}"`);
    return Number(rows[0]?.c ?? 0);
  } catch { return null; }
}

export async function GET() {
  const cfg = getDbConfig();
  const warnings: string[] = [];
  const info: MirrorInfo = {
    driver: getDbType(),
    table_counts: {},
    warnings,
  };
  if (info.driver === 'sqlite') {
    info.path = cfg.sqlitePath;
    try {
      const st = fs.statSync(cfg.sqlitePath);
      info.size_bytes = st.size;
      info.mtime = st.mtime.toISOString();
    } catch (e: unknown) {
      warnings.push('Could not stat sqlite file: ' + (e instanceof Error ? e.message : String(e)));
    }
  } else {
    info.path = `${cfg.mysqlHost}:${cfg.mysqlPort}/${cfg.mysqlDatabase}`;
  }

  let latest: string | null = null;
  for (const t of CANDIDATE_TABLES) {
    const ts = await safeMaxSynced(t);
    if (ts && (!latest || ts > latest)) latest = ts;
    const cnt = await safeCount(t);
    if (cnt !== null) info.table_counts[t] = cnt;
  }
  if (latest) info.snapshot_at = latest;

  return NextResponse.json(info);
}
