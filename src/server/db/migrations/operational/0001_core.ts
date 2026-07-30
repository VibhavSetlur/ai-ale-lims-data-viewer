import type { MigrationFn } from "umzug";

export const up: MigrationFn<unknown> = async ({ context }) => {
  const query = (context as { query(sql: string): Promise<unknown> }).query.bind(context);
  await query("CREATE TABLE IF NOT EXISTS migration_log (name VARCHAR(191) NOT NULL PRIMARY KEY, executed_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6), version INT NOT NULL) ENGINE=InnoDB");
  await query("CREATE TABLE IF NOT EXISTS audit_event (id CHAR(36) NOT NULL PRIMARY KEY, version INT NOT NULL, event_type VARCHAR(128) NOT NULL, actor_id VARCHAR(191) NULL, payload JSON NOT NULL, created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6)) ENGINE=InnoDB");
  await query("CREATE TABLE IF NOT EXISTS job (id CHAR(36) NOT NULL PRIMARY KEY, version INT NOT NULL, kind VARCHAR(128) NOT NULL, status VARCHAR(32) NOT NULL, payload JSON NOT NULL, created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6), updated_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6), INDEX job_status_created (status, created_at)) ENGINE=InnoDB");
};
export const down: MigrationFn<unknown> = async ({ context }) => { const query = (context as { query(sql: string): Promise<unknown> }).query.bind(context); await query("DROP TABLE IF EXISTS job"); await query("DROP TABLE IF EXISTS audit_event"); await query("DROP TABLE IF EXISTS migration_log"); };
