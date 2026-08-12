import { beforeEach, describe, expect, it } from 'vitest';
import { checkRateLimit, clientKey, resetRateLimits } from './rateLimit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it('allows up to the limit then blocks', () => {
    const now = 1_000_000;
    const opts = { limit: 3, windowMs: 60_000, now };
    expect(checkRateLimit('a', opts).allowed).toBe(true);
    expect(checkRateLimit('a', opts).allowed).toBe(true);
    expect(checkRateLimit('a', opts).allowed).toBe(true);
    const blocked = checkRateLimit('a', opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('resets the count after the window rolls over', () => {
    const opts = { limit: 1, windowMs: 1000, now: 1_000_000 };
    expect(checkRateLimit('b', opts).allowed).toBe(true);
    expect(checkRateLimit('b', opts).allowed).toBe(false);
    const later = checkRateLimit('b', { ...opts, now: 1_000_000 + 1001 });
    expect(later.allowed).toBe(true);
  });

  it('isolates separate keys from each other', () => {
    const opts = { limit: 1, windowMs: 1000, now: 2_000_000 };
    expect(checkRateLimit('c1', opts).allowed).toBe(true);
    expect(checkRateLimit('c2', opts).allowed).toBe(true);
    expect(checkRateLimit('c1', opts).allowed).toBe(false);
  });

  it('computes retryAfterSeconds from the reset time', () => {
    const opts = { limit: 1, windowMs: 5000, now: 3_000_000 };
    checkRateLimit('d', opts);
    const blocked = checkRateLimit('d', { ...opts, now: 3_000_000 + 2000 });
    expect(blocked.retryAfterSeconds).toBe(3);
  });
});

describe('clientKey', () => {
  it('prefers x-forwarded-for over x-real-ip', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8', 'x-real-ip': '9.9.9.9' },
    });
    expect(clientKey(req, 'login')).toBe('1.2.3.4:login');
  });

  it('falls back to x-real-ip then local', () => {
    const withRealIp = new Request('https://example.com', { headers: { 'x-real-ip': '9.9.9.9' } });
    expect(clientKey(withRealIp, 'login')).toBe('9.9.9.9:login');
    const bare = new Request('https://example.com');
    expect(clientKey(bare, 'login')).toBe('local:login');
  });
});
