import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { parseConfig } from "../../config";
import { AppError } from "../../../shared/errors/AppError";

export class OperationalPool {
  private readonly pool: Pool;
  public constructor(url: string) { this.pool = mysql.createPool({ uri: url, connectionLimit: 4, timezone: "Z" }); }
  public async probe(): Promise<{ available: true }> { try { await this.pool.query("SELECT 1"); return { available: true }; } catch (error) { throw new AppError("DEPENDENCY_UNAVAILABLE", "Operational database is unavailable.", error, { retryable: true }); } }
  public connection() { return this.pool; }
}

let pool: OperationalPool | undefined;
export function operationalPool(): OperationalPool { if (pool) return pool; const url = parseConfig(process.env).operationalDatabaseUrl; if (!url) throw new AppError("DEPENDENCY_UNAVAILABLE", "Operational database is unavailable.", undefined, { retryable: true }); pool = new OperationalPool(url); return pool; }
export async function operationalMigrationCompatible(): Promise<void> { try { const [rows] = await operationalPool().connection().query<(RowDataPacket & { name: string })[]>("SELECT name FROM migration_log WHERE name = '0001_core'"); if (!rows.length) throw new Error("required operational migration is absent"); } catch (error) { throw new AppError("DEPENDENCY_UNAVAILABLE", "Operational database is unavailable.", error, { retryable: true }); } }
export function resetOperationalPoolForTests(): void { pool = undefined; }
