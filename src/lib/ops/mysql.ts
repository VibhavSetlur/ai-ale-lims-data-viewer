// Operational MySQL connection pool. Server-only: this module talks to a
// live TCP connection and must never be imported from a 'use client'
// component or bundled into the browser. It is only ever imported from
// route handlers under src/app/api/ops/* and src/app/api/auth/*, and from
// src/lib/ops/repo.ts, which carries the same restriction.
//
// NOTE: the milestone spec calls for `import 'server-only'` as a compile-time
// guard, but the `server-only` package is not an existing dependency and this
// slice is scoped to "package.json (one new script)" only — no new runtime
// dependency is added. The server-only invariant is instead enforced by
// import discipline (never imported by a client component; verified by
// `npx tsc --noEmit` succeeding with no client bundle pulling this file in).
import mysql, { type Pool } from 'mysql2/promise';
import { readOpsDbConfig } from './config';

export class OpsNotConfigured extends Error {
  constructor(message = 'OPS_DB_URL is not set') {
    super(message);
    this.name = 'OpsNotConfigured';
  }
}

export class OpsUnavailable extends Error {
  constructor(message = 'Operational database is unavailable') {
    super(message);
    this.name = 'OpsUnavailable';
  }
}

let pool: Pool | null = null;

export function opsPool(): Pool {
  if (pool) return pool;
  const cfg = readOpsDbConfig();
  if (!cfg) throw new OpsNotConfigured();
  pool = mysql.createPool({
    uri: cfg.url,
    connectionLimit: 5,
    namedPlaceholders: false,
  });
  return pool;
}

export async function opsQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    const [rows] = await opsPool().query(sql, params);
    return rows as T[];
  } catch (error) {
    if (error instanceof OpsNotConfigured) throw error;
    throw new OpsUnavailable();
  }
}

export async function opsExec(sql: string, params: unknown[] = []): Promise<void> {
  try {
    await opsPool().query(sql, params);
  } catch (error) {
    if (error instanceof OpsNotConfigured) throw error;
    throw new OpsUnavailable();
  }
}
