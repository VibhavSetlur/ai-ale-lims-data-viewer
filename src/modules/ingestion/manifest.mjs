import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";

export const digest = (value) => createHash("sha256").update(value).digest("hex");
const quote = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;
export function inspectSqlite(path, expectedSha256) {
  const sourceSha256 = digest(readFileSync(path));
  if (expectedSha256 && expectedSha256 !== sourceSha256) throw new Error("SQLite SHA-256 does not match the required source checksum.");
  const db = new Database(path, { readonly: true, fileMustExist: true }); db.pragma("query_only = ON");
  try { const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => { const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all(); const indexes = db.prepare(`PRAGMA index_list(${quote(name)})`).all(); const count = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quote(name)}`).get().count); const nullCounts = Object.fromEntries(columns.map(({ name: column }) => [column, Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quote(name)} WHERE ${quote(column)} IS NULL`).get().count)])); return { name, columns, indexes, rowCount: count, nullCounts }; }); return { sourceSha256, tableCount: tables.length, tables, capabilities: { hasBarcodes: (tables.find((table) => table.name === "verAB_barcodes")?.rowCount ?? 0) > 0 } }; } finally { db.close(); }
}
