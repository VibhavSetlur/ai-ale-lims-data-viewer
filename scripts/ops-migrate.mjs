#!/usr/bin/env node
// Idempotent DDL runner for the operational (MySQL) data plane.
//
// Usage:  npm run ops:migrate
// Requires OPS_DB_URL (see .env.example / docs/OPS_LIVE_RUNBOOK.md). This is
// deliberately a separate database and variable from the read-only
// scientific MYSQL_URL used by src/lib/db.ts. Never reuse that variable.
//
// Every statement is CREATE TABLE IF NOT EXISTS, so re-running this script
// against an already-migrated database is a safe no-op. Applied migration
// ids are recorded in ops_schema_migration so future migrations can check
// what has already run.
import mysql from 'mysql2/promise';

const OPS_DB_URL = process.env.OPS_DB_URL;

if (!OPS_DB_URL) {
  console.error('OPS_DB_URL is not set; see .env.example and docs/OPS_LIVE_RUNBOOK.md');
  process.exit(1);
}

const MIGRATION_ID = '0001_ops_core';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS ops_schema_migration (
    id VARCHAR(64) PRIMARY KEY,
    applied_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS ops_user (
    id CHAR(36) PRIMARY KEY,
    orcid CHAR(19) NOT NULL UNIQUE,
    display_name VARCHAR(255) NULL,
    created_at DATETIME(3) NOT NULL,
    last_login_at DATETIME(3) NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS ops_session (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    created_at DATETIME(3) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    revoked_at DATETIME(3) NULL,
    KEY (user_id),
    FOREIGN KEY (user_id) REFERENCES ops_user(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS ops_auth_state (
    state_hash CHAR(64) PRIMARY KEY,
    created_at DATETIME(3) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    redirect_to VARCHAR(512) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS ops_workspace (
    id CHAR(36) PRIMARY KEY,
    owner_user_id CHAR(36) NOT NULL,
    name VARCHAR(120) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY (owner_user_id, name),
    KEY (owner_user_id),
    FOREIGN KEY (owner_user_id) REFERENCES ops_user(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS ops_plate_design (
    id CHAR(36) PRIMARY KEY,
    workspace_id CHAR(36) NOT NULL,
    owner_user_id CHAR(36) NOT NULL,
    name VARCHAR(120) NOT NULL,
    schema_version INT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    payload JSON NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY (workspace_id, name),
    KEY (owner_user_id),
    FOREIGN KEY (workspace_id) REFERENCES ops_workspace(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

const MIGRATION_ID_PKCE = '0002_auth_pkce';
const MIGRATION_ID_LOCAL_AUTH = '0003_local_auth';
const MIGRATION_ID_ASSISTANT = '0004_assistant';

async function isMigrationApplied(conn, id) {
  const [rows] = await conn.query('SELECT id FROM ops_schema_migration WHERE id = ?', [id]);
  return rows.length > 0;
}

async function recordMigration(conn, id) {
  await conn.query(
    'INSERT INTO ops_schema_migration (id, applied_at) VALUES (?, NOW(3)) ON DUPLICATE KEY UPDATE applied_at = applied_at',
    [id],
  );
}

async function applyAuthPkceMigration(conn) {
  if (await isMigrationApplied(conn, MIGRATION_ID_PKCE)) {
    console.log(`ops:migrate: ${MIGRATION_ID_PKCE} already recorded, skipping.`);
    return;
  }

  const [columns] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ops_auth_state' AND COLUMN_NAME = 'code_verifier'`,
  );
  if (columns.length === 0) {
    await conn.query('ALTER TABLE ops_auth_state ADD COLUMN code_verifier VARCHAR(128) NULL');
  }

  await recordMigration(conn, MIGRATION_ID_PKCE);
  console.log(`ops:migrate: applied ${MIGRATION_ID_PKCE} (idempotent).`);
}

async function columnExists(conn, table, column) {
  const [columns] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  return columns.length > 0;
}

async function applyLocalAuthMigration(conn) {
  if (await isMigrationApplied(conn, MIGRATION_ID_LOCAL_AUTH)) {
    console.log(`ops:migrate: ${MIGRATION_ID_LOCAL_AUTH} already recorded, skipping.`);
    return;
  }

  const [orcidColumns] = await conn.query(
    `SELECT IS_NULLABLE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ops_user' AND COLUMN_NAME = 'orcid'`,
  );
  if (orcidColumns[0] && orcidColumns[0].IS_NULLABLE === 'NO') {
    await conn.query('ALTER TABLE ops_user MODIFY orcid CHAR(19) NULL');
  }

  if (!(await columnExists(conn, 'ops_user', 'email'))) {
    await conn.query('ALTER TABLE ops_user ADD COLUMN email VARCHAR(320) NULL, ADD UNIQUE KEY uq_ops_user_email (email)');
  }

  if (!(await columnExists(conn, 'ops_user', 'password_hash'))) {
    await conn.query('ALTER TABLE ops_user ADD COLUMN password_hash VARCHAR(255) NULL');
  }

  if (!(await columnExists(conn, 'ops_user', 'password_updated_at'))) {
    await conn.query('ALTER TABLE ops_user ADD COLUMN password_updated_at DATETIME(3) NULL');
  }

  if (!(await columnExists(conn, 'ops_user', 'failed_login_count'))) {
    await conn.query('ALTER TABLE ops_user ADD COLUMN failed_login_count INT NOT NULL DEFAULT 0');
  }

  if (!(await columnExists(conn, 'ops_user', 'locked_until'))) {
    await conn.query('ALTER TABLE ops_user ADD COLUMN locked_until DATETIME(3) NULL');
  }

  await recordMigration(conn, MIGRATION_ID_LOCAL_AUTH);
  console.log(`ops:migrate: applied ${MIGRATION_ID_LOCAL_AUTH} (idempotent).`);
}

async function applyAssistantMigration(conn) {
  if (await isMigrationApplied(conn, MIGRATION_ID_ASSISTANT)) {
    console.log(`ops:migrate: ${MIGRATION_ID_ASSISTANT} already recorded, skipping.`);
    return;
  }

  await conn.query(`CREATE TABLE IF NOT EXISTS ops_conversation (
    id CHAR(36) PRIMARY KEY,
    owner_user_id CHAR(36) NOT NULL,
    title VARCHAR(200) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    KEY (owner_user_id, updated_at),
    FOREIGN KEY (owner_user_id) REFERENCES ops_user(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await conn.query(`CREATE TABLE IF NOT EXISTS ops_conversation_message (
    id CHAR(36) PRIMARY KEY,
    conversation_id CHAR(36) NOT NULL,
    owner_user_id CHAR(36) NOT NULL,
    role VARCHAR(16) NOT NULL,
    content MEDIUMTEXT NOT NULL,
    created_at DATETIME(3) NOT NULL,
    KEY (conversation_id, created_at),
    FOREIGN KEY (conversation_id) REFERENCES ops_conversation(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await conn.query(`CREATE TABLE IF NOT EXISTS ops_assistant_proposal (
    id CHAR(36) PRIMARY KEY,
    owner_user_id CHAR(36) NOT NULL,
    conversation_id CHAR(36) NULL,
    workspace_id CHAR(36) NOT NULL,
    target_design_id CHAR(36) NULL,
    kind VARCHAR(32) NOT NULL,
    design_name VARCHAR(200) NOT NULL,
    summary TEXT NOT NULL,
    payload JSON NOT NULL,
    status VARCHAR(16) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    resolved_at DATETIME(3) NULL,
    KEY (owner_user_id, status),
    FOREIGN KEY (owner_user_id) REFERENCES ops_user(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await recordMigration(conn, MIGRATION_ID_ASSISTANT);
  console.log(`ops:migrate: applied ${MIGRATION_ID_ASSISTANT} (idempotent).`);
}

async function main() {
  const conn = await mysql.createConnection({ uri: OPS_DB_URL });
  try {
    for (const sql of STATEMENTS) {
      await conn.query(sql);
    }
    await recordMigration(conn, MIGRATION_ID);
    console.log(`ops:migrate: applied ${MIGRATION_ID} (idempotent).`);

    await applyAuthPkceMigration(conn);
    await applyLocalAuthMigration(conn);
    await applyAssistantMigration(conn);
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  // Never log the connection URL or any credential; only the error message.
  console.error(`ops:migrate failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
