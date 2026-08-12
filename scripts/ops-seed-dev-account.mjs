#!/usr/bin/env node
// DEVELOPER TEST FIXTURE. Direct database access only.
//
// Upserts a single, well-known local (email/password) account so the login
// route can be exercised end-to-end without registering a fresh account by
// hand. This account is INSECURE by construction (a well-known email and a
// four-character password) and must NEVER exist on a shared or exposed
// instance. This script is never imported by the application.
//
// Guarded behind two independent checks:
//   1. Only runs when OPS_SEED_DEV_ACCOUNT=1 is set explicitly.
//   2. Refuses to run when NODE_ENV=production.
//
// The scrypt encoding scheme below is copied from src/lib/ops/password.ts
// (hashPassword). That file is the source of truth; keep this in sync with
// it if it ever changes.
//
// Usage:
//   OPS_SEED_DEV_ACCOUNT=1 node scripts/ops-seed-dev-account.mjs
import { randomBytes, randomUUID, scrypt } from 'crypto';
import mysql from 'mysql2/promise';

const SEED_EMAIL = 'test@gmail.com';
const SEED_PASSWORD = 'test';
const SEED_DISPLAY_NAME = 'Dev Test Account';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

if (process.env.OPS_SEED_DEV_ACCOUNT !== '1') {
  console.log('ops:seed-dev: OPS_SEED_DEV_ACCOUNT is not set to 1, skipping.');
  process.exit(0);
}

if (process.env.NODE_ENV === 'production') {
  console.error('ops:seed-dev: refusing to run with NODE_ENV=production.');
  process.exit(1);
}

const OPS_DB_URL = process.env.OPS_DB_URL;
if (!OPS_DB_URL) {
  console.error('ops:seed-dev: OPS_DB_URL is not set; see .env.example and docs/OPS_LIVE_RUNBOOK.md');
  process.exit(1);
}

console.warn('');
console.warn('ops:seed-dev: WARNING - creating an INSECURE local test account.');
console.warn(`ops:seed-dev: email=${SEED_EMAIL} password=${SEED_PASSWORD}`);
console.warn('ops:seed-dev: this account must never exist on a shared or exposed instance.');
console.warn('');

function deriveKey(password, salt, keylen, params) {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keylen,
      { N: params.n, r: params.r, p: params.p, maxmem: SCRYPT_MAXMEM },
      (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

async function hashPassword(plain) {
  const salt = randomBytes(16);
  const derived = await deriveKey(plain, salt, SCRYPT_KEYLEN, { n: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

async function main() {
  const passwordHash = await hashPassword(SEED_PASSWORD);
  const conn = await mysql.createConnection({ uri: OPS_DB_URL });
  try {
    const [existing] = await conn.query('SELECT id FROM ops_user WHERE email = ?', [SEED_EMAIL]);
    if (existing[0]) {
      await conn.query(
        `UPDATE ops_user
         SET password_hash = ?, password_updated_at = NOW(3), failed_login_count = 0, locked_until = NULL
         WHERE id = ?`,
        [passwordHash, existing[0].id],
      );
      console.log('ops:seed-dev: updated existing dev test account.');
      return;
    }

    const id = randomUUID();
    await conn.query(
      `INSERT INTO ops_user (id, orcid, email, password_hash, display_name, created_at, failed_login_count)
       VALUES (?, NULL, ?, ?, ?, NOW(3), 0)`,
      [id, SEED_EMAIL, passwordHash, SEED_DISPLAY_NAME],
    );
    console.log('ops:seed-dev: created dev test account.');
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  // Never log the connection URL or any credential; only the error message.
  console.error(`ops:seed-dev failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
