// Build-time only helper for `generateStaticParams` on `/tables/[tableName]`.
//
// Reads the already-baked `public/data/tables.json` artifact produced by
// `scripts/prebake.mjs` (see manifest key "tables"). This file is only ever
// called from a `generateStaticParams` export, which Next.js runs in Node at
// build time, so importing `node:fs` here never reaches the client bundle.
// If the artifact has not been baked yet (fresh checkout, server-only build
// before `npm run prebake`), we safely return an empty list; server mode
// still accepts arbitrary table names via `dynamicParams` (default true).
import fs from 'node:fs';
import path from 'node:path';

interface BakedTablesFile {
  tables?: Array<{ name?: unknown }>;
}

export function getStaticTableNames(): string[] {
  try {
    const filePath = path.resolve(process.cwd(), 'public', 'data', 'tables.json');
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as BakedTablesFile;
    if (!Array.isArray(parsed.tables)) return [];
    return parsed.tables
      .map(entry => entry?.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
  } catch {
    return [];
  }
}
