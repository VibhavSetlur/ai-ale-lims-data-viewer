import { describe, expect, it } from 'vitest';
import { SCRYPT_N, SCRYPT_P, SCRYPT_R, hashPassword, verifyPassword } from './password';

describe('password', () => {
  it('round trips a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('wrong password', hash)).resolves.toBe(false);
  });

  it('rejects a malformed stored value', async () => {
    await expect(verifyPassword('anything', 'not-a-real-hash')).resolves.toBe(false);
    await expect(verifyPassword('anything', '')).resolves.toBe(false);
    await expect(verifyPassword('anything', 'scrypt$16384$8$1$onlyfourparts')).resolves.toBe(false);
  });

  it('produces different hashes for the same password due to unique salt', async () => {
    const first = await hashPassword('same password');
    const second = await hashPassword('same password');
    expect(first).not.toBe(second);
  });

  it('encodes the configured scrypt parameters', async () => {
    const hash = await hashPassword('some password');
    const parts = hash.split('$');
    expect(parts[0]).toBe('scrypt');
    expect(Number(parts[1])).toBe(SCRYPT_N);
    expect(Number(parts[2])).toBe(SCRYPT_R);
    expect(Number(parts[3])).toBe(SCRYPT_P);
  });
});
