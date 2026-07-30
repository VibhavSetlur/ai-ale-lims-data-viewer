import type { RowDataPacket } from "mysql2/promise";
import { Umzug } from "umzug";
import { operationalPool } from "../../operational/pool";
import * as core from "./0001_core";

export async function migrateOperationalDatabase(): Promise<void> {
  const pool = operationalPool().connection();
  const connection = await pool.getConnection();
  try {
    const [locks] = await connection.query<(RowDataPacket & { locked: number })[]>("SELECT GET_LOCK('aiale_viewer2_operational_migrations', 30) AS locked");
    if (Number(locks[0]?.locked) !== 1) throw new Error("Could not acquire operational migration lock.");
    const umzug = new Umzug({ migrations: [{ name: "0001_core", up: core.up, down: core.down }], context: connection, storage: { async executed() { try { const [rows] = await connection.query<(RowDataPacket & { name: string })[]>("SELECT name FROM migration_log ORDER BY name"); return rows.map((row) => row.name); } catch { return []; } }, async logMigration({ name }) { await connection.query("INSERT INTO migration_log (name, version) VALUES (?, 1)", [name]); }, async unlogMigration({ name }) { await connection.query("DELETE FROM migration_log WHERE name = ?", [name]); } }, logger: undefined });
    await umzug.up();
  } finally { try { await connection.query("DO RELEASE_LOCK('aiale_viewer2_operational_migrations')"); } finally { connection.release(); } }
}
