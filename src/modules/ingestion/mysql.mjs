import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import mysql from "mysql2/promise";

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;
export const quoteIdentifier = (value) => {
  if (!IDENTIFIER.test(value)) throw new Error("Unsafe MySQL identifier.");
  return `\`${value}\``;
};
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function mysqlUrlFromSecret({ file, stdin = false, purpose }) {
  if (Boolean(file) === Boolean(stdin)) throw new Error(`Provide exactly one protected MySQL secret source for ${purpose}: --mysql-secrets-file FILE or --mysql-secrets-stdin.`);
  let text;
  if (stdin) text = readFileSync(0, "utf8");
  else {
    const mode = statSync(file).mode & 0o777;
    if (mode & 0o077) throw new Error("MySQL secrets file must not be accessible by group or others.");
    text = readFileSync(file, "utf8");
  }
  let secret;
  try { secret = JSON.parse(text); } catch { throw new Error("MySQL secret input must be JSON."); }
  const value = secret[purpose];
  if (typeof value !== "string" || !value.startsWith("mysql")) throw new Error(`MySQL secret input is missing ${purpose}.`);
  return value;
}

export async function connect(url, database) {
  quoteIdentifier(database);
  const connection = await mysql.createConnection(url);
  const [rows] = await connection.query("SELECT DATABASE() AS name");
  if (String(rows[0]?.name ?? "") !== database) { await connection.end(); throw new Error("MySQL connection database does not match --database."); }
  return connection;
}

export function mysqlType(sqliteType) {
  const type = String(sqliteType ?? "").toUpperCase();
  if (type.includes("INT")) return "BIGINT";
  if (type.includes("REAL") || type.includes("FLOA") || type.includes("DOUB")) return "DOUBLE";
  if (type.includes("BLOB")) return "LONGBLOB";
  if (type.includes("NUM") || type.includes("DEC")) return "DECIMAL(65,30)";
  return "LONGTEXT";
}

export function createTableSql(table) {
  const columns = table.columns.map((column) => `${quoteIdentifier(column.name)} ${mysqlType(column.type)} ${column.notnull ? "NOT NULL" : "NULL"}`);
  const keys = table.columns.filter((column) => Number(column.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map((column) => quoteIdentifier(column.name));
  if (keys.length) columns.push(`PRIMARY KEY (${keys.join(", ")})`);
  return `CREATE TABLE ${quoteIdentifier(table.name)} (${columns.join(", ")}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs`;
}

export async function createMetadata(connection) {
  await connection.query("CREATE TABLE IF NOT EXISTS scientific_snapshot_catalog (snapshot_id VARCHAR(191) NOT NULL PRIMARY KEY, label VARCHAR(255) NOT NULL, source_system VARCHAR(128) NOT NULL, source_revision VARCHAR(255) NULL, source_sha256 CHAR(64) NOT NULL, source_updated_at DATETIME(6) NULL, received_at DATETIME(6) NOT NULL, materialized_at DATETIME(6) NULL, schema_version VARCHAR(64) NOT NULL, schema_fingerprint CHAR(64) NOT NULL, manifest_digest CHAR(64) NULL, UNIQUE KEY scientific_snapshot_source_sha (source_sha256)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs");
  await connection.query("CREATE TABLE IF NOT EXISTS ingest_run (run_id CHAR(36) NOT NULL PRIMARY KEY, source_sha256 CHAR(64) NOT NULL, manifest_digest CHAR(64) NOT NULL, started_at DATETIME(6) NOT NULL, completed_at DATETIME(6) NULL, status VARCHAR(32) NOT NULL, UNIQUE KEY ingest_run_manifest (manifest_digest)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs");
  await connection.query("CREATE TABLE IF NOT EXISTS ingest_table_result (run_id CHAR(36) NOT NULL, table_name VARCHAR(191) NOT NULL, row_count BIGINT NOT NULL, table_sha256 CHAR(64) NOT NULL, chunk_count INT NOT NULL, PRIMARY KEY (run_id, table_name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs");
  await connection.query("CREATE TABLE IF NOT EXISTS ingest_rejection (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, run_id CHAR(36) NOT NULL, table_name VARCHAR(191) NOT NULL, row_reference VARCHAR(255) NULL, reason VARCHAR(1024) NOT NULL, created_at DATETIME(6) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs");
}

export function manifestDigest(manifest) { return sha256(JSON.stringify(manifest)); }
