import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";

export const APPROVED_SOURCE_SHA256 = "a3a286b4ac99fb2ed8cc24d65a0e4e2d86711d52c21be37e831bc80d97e3580a";
export const digest = (value) => createHash("sha256").update(value).digest("hex");
const quote = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;
const unsupported = /\b(CHECK|FOREIGN\s+KEY|GENERATED\s+ALWAYS|WITHOUT\s+ROWID|AUTOINCREMENT)\b/i;

/** Read the approved immutable source only. The emitted inventory is the staging contract. */
export function inspectSqlite(path, expectedSha256 = APPROVED_SOURCE_SHA256) {
  if (expectedSha256 !== APPROVED_SOURCE_SHA256) throw new Error("The expected SQLite SHA-256 must be the approved source checksum.");
  const sourceSha256 = digest(readFileSync(path));
  if (sourceSha256 !== expectedSha256) throw new Error("SQLite SHA-256 does not match the required source checksum.");
  const db = new Database(path, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  try {
    const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name, sql }) => {
      if (!sql || unsupported.test(sql)) throw new Error(`Unsupported SQLite table construct in ${name}; review a faithful MySQL mapping before staging.`);
      const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all();
      const indexes = db.prepare(`PRAGMA index_list(${quote(name)})`).all().map((index) => {
        const indexSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name = ?").get(index.name)?.sql ?? null;
        const parts = db.prepare(`PRAGMA index_xinfo(${quote(index.name)})`).all();
        if (Number(index.partial) || parts.some((part) => Number(part.cid) < 0 || !part.name)) throw new Error(`Unsupported SQLite index construct in ${name}.${index.name}; review a faithful MySQL mapping before staging.`);
        return { name: index.name, unique: Number(index.unique) === 1, origin: index.origin, columns: parts.filter((part) => Number(part.key) === 1).sort((a, b) => Number(a.seqno) - Number(b.seqno)).map((part) => ({ name: part.name, desc: Number(part.desc) === 1 })), sql: indexSql };
      });
      const count = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quote(name)}`).get().count);
      const nullCounts = Object.fromEntries(columns.map(({ name: column }) => [column, Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quote(name)} WHERE ${quote(column)} IS NULL`).get().count)]));
      return { name, sql, columns, indexes, rowCount: count, nullCounts };
    });
    const legacyInventory = tables.map(({ name, columns }) => ({ name, columns: columns.map(({ name: columnName, type, notnull, pk }) => ({ name: columnName, type, notnull, pk })) }));
    return { sourceSha256, tableCount: tables.length, tables, legacyInventory, inventorySha256: digest(JSON.stringify(legacyInventory)), capabilities: { hasBarcodes: (tables.find((table) => table.name === "verAB_barcodes")?.rowCount ?? 0) > 0 } };
  } finally { db.close(); }
}
