#!/usr/bin/env node
import mysql from "mysql2/promise";
import { Umzug } from "umzug";
import { readFileSync, statSync } from "node:fs";
const file = process.argv[process.argv.indexOf("--secrets-file") + 1];
if (!file) throw new Error("Usage: migrate:operational --secrets-file FILE");
if ((statSync(file).mode & 0o077) !== 0) throw new Error("Secrets file must be mode 0600.");
const { operationalUrl } = JSON.parse(readFileSync(file, "utf8"));
if (typeof operationalUrl !== "string" || !operationalUrl.startsWith("mysql")) throw new Error("Missing operationalUrl.");
const pool = mysql.createPool(operationalUrl); const connection = await pool.getConnection();
try {
  const [locks] = await connection.query("SELECT GET_LOCK('aiale_viewer2_operational_migrations', 30) AS locked"); if (Number(locks[0]?.locked) !== 1) throw new Error("Could not acquire operational migration lock.");
  const statements = ["CREATE TABLE IF NOT EXISTS migration_log (name VARCHAR(191) NOT NULL PRIMARY KEY, executed_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6), version INT NOT NULL) ENGINE=InnoDB", "CREATE TABLE IF NOT EXISTS audit_event (id CHAR(36) NOT NULL PRIMARY KEY, version INT NOT NULL, event_type VARCHAR(128) NOT NULL, actor_id VARCHAR(191) NULL, payload JSON NOT NULL, created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6)) ENGINE=InnoDB", "CREATE TABLE IF NOT EXISTS job (id CHAR(36) NOT NULL PRIMARY KEY, version INT NOT NULL, kind VARCHAR(128) NOT NULL, status VARCHAR(32) NOT NULL, payload JSON NOT NULL, created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6), updated_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6), INDEX job_status_created (status, created_at)) ENGINE=InnoDB"];
  const umzug = new Umzug({ migrations: [{ name: "0001_core", up: async () => { for (const sql of statements) await connection.query(sql); } }], context: connection, storage: { executed: async () => { try { const [rows] = await connection.query("SELECT name FROM migration_log"); return rows.map((row) => row.name); } catch { return []; } }, logMigration: async ({ name }) => { await connection.query("INSERT INTO migration_log (name, version) VALUES (?, 1)", [name]); }, unlogMigration: async ({ name }) => { await connection.query("DELETE FROM migration_log WHERE name = ?", [name]); } }, logger: undefined }); await umzug.up(); console.log("PASS operational-migrations");
} finally { try { await connection.query("DO RELEASE_LOCK('aiale_viewer2_operational_migrations')"); } finally { connection.release(); await pool.end(); } }
