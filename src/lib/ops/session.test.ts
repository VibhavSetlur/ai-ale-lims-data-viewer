import { describe, expect, it } from 'vitest';
import {
  hashSessionToken,
  isSessionUsable,
  newSessionToken,
  sessionCookieAttributes,
  sessionExpiry,
} from './session';

describe('session crypto/policy helpers (pure)', () => {
  it('produces long, unique tokens across many draws', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newSessionToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token.length).toBeGreaterThanOrEqual(40);
    }
  });

  it('hashes to 64 hex characters, stable for the same pepper, different for a different pepper', () => {
    const token = newSessionToken();
    const h1 = hashSessionToken(token, 'pepper-a'.padEnd(32, 'x'));
    const h2 = hashSessionToken(token, 'pepper-a'.padEnd(32, 'x'));
    const h3 = hashSessionToken(token, 'pepper-b'.padEnd(32, 'x'));
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });

  it('computes expiry arithmetic in whole hours', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const expiry = sessionExpiry(now, 24);
    expect(expiry.toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('treats an expired session as unusable', () => {
    const now = new Date('2026-01-02T00:00:00.000Z');
    expect(isSessionUsable({ expires_at: new Date('2026-01-01T00:00:00.000Z'), revoked_at: null }, now)).toBe(false);
  });

  it('treats a revoked session as unusable even if unexpired', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(
      isSessionUsable(
        { expires_at: new Date('2099-01-01T00:00:00.000Z'), revoked_at: new Date('2026-01-01T00:00:00.000Z') },
        now,
      ),
    ).toBe(false);
  });

  it('treats an unexpired, unrevoked session as usable', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(isSessionUsable({ expires_at: new Date('2099-01-01T00:00:00.000Z'), revoked_at: null }, now)).toBe(true);
  });

  it('marks the cookie secure only for an https redirect URI', () => {
    const insecure = sessionCookieAttributes({ pepper: 'x'.repeat(32), ttlHours: 720, secureCookie: false });
    const secure = sessionCookieAttributes({ pepper: 'x'.repeat(32), ttlHours: 720, secureCookie: true });
    expect(insecure.secure).toBe(false);
    expect(secure.secure).toBe(true);
    expect(insecure.httpOnly).toBe(true);
    expect(insecure.sameSite).toBe('lax');
    expect(insecure.path).toBe('/');
    expect(insecure.maxAge).toBe(720 * 60 * 60);
  });
});
