import { randomBytes, scrypt, timingSafeEqual } from 'crypto';

export const SCRYPT_N = 16384;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_KEYLEN = 64;

const SCRYPT_MAXMEM = 64 * 1024 * 1024;

function deriveKey(
  password: string,
  salt: Buffer,
  keylen: number,
  params: { n: number; r: number; p: number },
): Promise<Buffer> {
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

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await deriveKey(plain, salt, SCRYPT_KEYLEN, {
    n: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    if (typeof stored !== 'string' || stored.length === 0) {
      return false;
    }
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') {
      return false;
    }
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
      return false;
    }
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    if (salt.length === 0 || expected.length === 0) {
      return false;
    }
    const actual = await deriveKey(plain, salt, expected.length, { n, r, p });
    if (actual.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
