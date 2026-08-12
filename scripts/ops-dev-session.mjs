#!/usr/bin/env node
// DEVELOPER TEST FIXTURE. Direct database access only.
//
// Mints a local ops_user + ops_session row so the ops HTTP API can be
// exercised end-to-end before an ORCID app exists. This script is never
// imported by the application and must never be run against a shared or
// production database. It is NOT an application auth bypass: it requires
// both direct database credentials (OPS_DB_URL) and the session pepper
// (OPS_SESSION_PEPPER) that the running app also needs to validate a
// session cookie, so possessing them is equivalent to already having
// operational access.
//
// The token/hash scheme below is copied from src/lib/ops/session.ts
// (newSessionToken / hashSessionToken) — that file is the source of truth;
// keep this in sync with it if it ever changes.
//
// Usage:
//   node scripts/ops-dev-session.mjs [--orcid 0000-0002-1825-0097] [--name "Local Test User"] [--hours 24]
//
// Prints exactly one line to stdout:
//   aiale_ops_session=<raw token>
// Everything else goes to stderr.

import { createHash, randomBytes, randomUUID } from 'crypto';
import mysql from 'mysql2/promise';

function parseArgs(argv) {
  const args = { orcid: '0000-0002-1825-0097', name: 'Local Test User', hours: 24 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--orcid') {
      args.orcid = argv[++i];
    } else if (arg === '--name') {
      args.name = argv[++i];
    } else if (arg === '--hours') {
      args.hours = Number(argv[++i]);
    }
  }
  return args;
}

// Mirrors src/lib/ops/session.ts:newSessionToken
function newSessionToken() {
  return randomBytes(32).toString('base64url');
}

// Mirrors src/lib/ops/session.ts:hashSessionToken
function hashSessionToken(token, pepper) {
  return createHash('sha256').update(`${pepper}:${token}`).digest('hex');
}

async function upsertUserByOrcid(conn, orcid, displayName) {
  const [existingRows] = await conn.query('SELECT id FROM ops_user WHERE orcid = ?', [orcid]);
  if (existingRows[0]) {
    await conn.query(
      'UPDATE ops_user SET last_login_at = NOW(3), display_name = COALESCE(?, display_name) WHERE id = ?',
      [displayName, existingRows[0].id],
    );
    return existingRows[0].id;
  }
  const id = randomUUID();
  await conn.query(
    'INSERT INTO ops_user (id, orcid, display_name, created_at, last_login_at) VALUES (?, ?, ?, NOW(3), NOW(3))',
    [id, orcid, displayName],
  );
  return id;
}

async function main() {
  const OPS_DB_URL = process.env.OPS_DB_URL;
  if (!OPS_DB_URL) {
    console.error('OPS_DB_URL is not set. See .env.example / docs/OPS_LIVE_RUNBOOK.md.');
    process.exit(1);
  }
  const OPS_SESSION_PEPPER = process.env.OPS_SESSION_PEPPER;
  if (!OPS_SESSION_PEPPER) {
    console.error('OPS_SESSION_PEPPER is not set. See .env.example / docs/OPS_LIVE_RUNBOOK.md.');
    process.exit(1);
  }

  const { orcid, name, hours } = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(hours) || hours <= 0) {
    console.error('--hours must be a positive number.');
    process.exit(1);
  }

  const conn = await mysql.createConnection({ uri: OPS_DB_URL });
  try {
    const userId = await upsertUserByOrcid(conn, orcid, name);

    const token = newSessionToken();
    const tokenHash = hashSessionToken(token, OPS_SESSION_PEPPER);
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    await conn.query(
      'INSERT INTO ops_session (id, user_id, token_hash, created_at, expires_at, revoked_at) VALUES (?, ?, ?, NOW(3), ?, NULL)',
      [sessionId, userId, tokenHash, expiresAt],
    );

    console.error(`ops-dev-session: user=${orcid} (${userId}) session=${sessionId} expires=${expiresAt.toISOString()}`);
    console.log(`aiale_ops_session=${token}`);
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  // Never log the connection URL, the pepper, or any credential; only the error message.
  console.error(`ops-dev-session: failed: ${error.message}`);
  process.exit(1);
});
