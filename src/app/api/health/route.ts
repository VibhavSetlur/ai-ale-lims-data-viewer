import { NextResponse } from 'next/server';
import { runQuery, getDbType, getDbConfig } from '@/lib/db';
import fs from 'fs';

// Lightweight liveness + readiness check for nginx upstream and ops monitoring.
// Returns 200 when the process is up AND the LIMS mirror is reachable,
// 503 when the DB probe fails. Body is small JSON so it's cheap to poll.
export async function GET() {
  const cfg = getDbConfig();
  const start = Date.now();
  let dbOk = false;
  let dbError: string | undefined;
  let mtime: string | undefined;
  let size: number | undefined;
  try {
    // SELECT 1 confirms the connection works.
    const rows = await runQuery<{ ok: number }>('SELECT 1 AS ok');
    dbOk = rows[0]?.ok === 1;
    if (getDbType() === 'sqlite') {
      try {
        const st = fs.statSync(cfg.sqlitePath);
        mtime = st.mtime.toISOString();
        size = st.size;
      } catch { /* fall through */ }
    }
  } catch (e: unknown) {
    dbError = e instanceof Error ? e.message : String(e);
  }
  const body = {
    status: dbOk ? 'ok' : 'degraded',
    uptime_seconds: Math.round(process.uptime()),
    db: {
      driver: getDbType(),
      ok: dbOk,
      error: dbError,
      path: getDbType() === 'sqlite' ? cfg.sqlitePath : `${cfg.mysqlHost}:${cfg.mysqlPort}/${cfg.mysqlDatabase}`,
      mtime,
      size_bytes: size,
    },
    latency_ms: Date.now() - start,
  };
  return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}
