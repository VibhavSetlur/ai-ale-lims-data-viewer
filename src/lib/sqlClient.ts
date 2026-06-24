/**
 * sqlClient.ts — client-side SQLite for the STATIC build.
 *
 * In static mode there is no server, but the raw Database Tables browser must
 * still support DEEP queries (filter / sort / search across full tables, incl.
 * the 223k-row Mutations). We do this with sql.js-httpvfs: the real LIMS DB is
 * served as a static file and the browser runs actual SQL against it, fetching
 * only the byte ranges (DB pages) a query touches via HTTP range requests. The
 * indexes in the DB keep the number of fetched pages small.
 *
 * Server mode never imports this (DataTable calls the live /api/data route).
 */
import { BASE_PATH } from './dataSource';

type WorkerHttpvfs = {
  db: {
    query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    exec: (sql: string, params?: unknown[]) => Promise<unknown>;
  };
};

let dbPromise: Promise<WorkerHttpvfs> | null = null;

async function getDb(): Promise<WorkerHttpvfs> {
  if (!dbPromise) {
    dbPromise = (async () => {
      // Imported dynamically so this heavy module + wasm only load when the user
      // actually opens the Database Tables browser, not on first paint.
      const { createDbWorker } = await import('sql.js-httpvfs');
      const base = `${BASE_PATH}/db`;
      const worker = await createDbWorker(
        [
          {
            from: 'inline',
            config: {
              serverMode: 'full',
              url: `${base}/lims.db`,
              requestChunkSize: 65536,
            },
          },
        ],
        `${base}/sqlite.worker.js`,
        `${base}/sql-wasm.wasm`,
      );
      return worker as unknown as WorkerHttpvfs;
    })();
  }
  return dbPromise;
}

/** Run a read-only SQL query and return rows as plain objects. */
export async function sqlQuery(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const w = await getDb();
  return w.db.query(sql, params);
}

/** First-cell scalar (e.g. COUNT(*)). */
export async function sqlScalar(sql: string, params: unknown[] = []): Promise<number> {
  const rows = await sqlQuery(sql, params);
  if (!rows.length) return 0;
  const first = rows[0];
  const v = Object.values(first)[0];
  return typeof v === 'number' ? v : Number(v) || 0;
}

/** Quote an identifier (table/column) safely for SQLite. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
