import { describe, expect, it } from 'vitest';
import { assertSameOrigin } from './csrf';
import { OpsHttpError } from './guards';

function makeReq(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: 'POST', headers });
}

function expectRejected(req: Request): void {
  try {
    assertSameOrigin(req);
    throw new Error('expected assertSameOrigin to throw');
  } catch (error) {
    expect(error).toBeInstanceOf(OpsHttpError);
    expect((error as OpsHttpError).status).toBe(403);
    expect((error as OpsHttpError).code).toBe('cross_origin');
  }
}

describe('assertSameOrigin', () => {
  it('allows a matching Origin header (Host-based, url ignored)', () => {
    const req = makeReq('https://example.com/api/auth/logout', {
      host: 'example.com',
      origin: 'https://example.com',
    });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it('rejects a mismatched Origin header', () => {
    const req = makeReq('https://example.com/api/auth/logout', {
      host: 'example.com',
      origin: 'https://evil.com',
    });
    expectRejected(req);
  });

  it('allows Origin 127.0.0.1:3458 when Host is 127.0.0.1:3458 even though request.url says localhost:3458 (the proven regression)', () => {
    const req = makeReq('http://localhost:3458/api/x', {
      host: '127.0.0.1:3458',
      origin: 'http://127.0.0.1:3458',
    });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it('allows Origin with a different scheme than Host, since scheme is intentionally ignored', () => {
    const req = makeReq('http://localhost:3458/api/x', {
      host: '127.0.0.1:3458',
      origin: 'https://127.0.0.1:3458',
    });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it('rejects a cross-origin Origin against Host', () => {
    const req = makeReq('http://localhost:3458/api/x', {
      host: '127.0.0.1:3458',
      origin: 'https://evil.example',
    });
    expectRejected(req);
  });

  it('rejects when the Origin host matches but the port differs', () => {
    const req = makeReq('http://localhost:3458/api/x', {
      host: '127.0.0.1:3458',
      origin: 'http://127.0.0.1:9999',
    });
    expectRejected(req);
  });

  it('allows via x-forwarded-host when it differs from Host (proxy case)', () => {
    const req = makeReq('http://localhost:3458/api/x', {
      host: '127.0.0.1:3458',
      'x-forwarded-host': 'app.example.org',
      origin: 'https://app.example.org',
    });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it('allows via the first entry of a comma-separated x-forwarded-host list', () => {
    const req = makeReq('http://localhost:3458/api/x', {
      host: '127.0.0.1:3458',
      'x-forwarded-host': 'app.example.org, inner.local',
      origin: 'https://app.example.org',
    });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it('rejects a literal "null" Origin', () => {
    const req = makeReq('https://example.com/api/x', {
      host: 'example.com',
      origin: 'null',
    });
    expectRejected(req);
  });

  it('rejects a malformed Origin header', () => {
    const req = makeReq('https://example.com/api/x', {
      host: 'example.com',
      origin: 'not-a-url',
    });
    expectRejected(req);
  });

  it('rejects when Origin is present but neither Host nor x-forwarded-host is present', () => {
    // Request objects constructed directly (unlike a real network request)
    // never carry an implicit Host header, so this exercises the no-host path.
    const req = makeReq('https://example.com/api/x', { origin: 'https://example.com' });
    expectRejected(req);
  });

  it('falls back to Sec-Fetch-Site: same-origin when Origin is absent', () => {
    const req = makeReq('https://example.com/api/auth/logout', { 'sec-fetch-site': 'same-origin' });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it('falls back to Sec-Fetch-Site: none when Origin is absent', () => {
    const req = makeReq('https://example.com/api/auth/logout', { 'sec-fetch-site': 'none' });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it('rejects Sec-Fetch-Site: cross-site when Origin is absent', () => {
    const req = makeReq('https://example.com/api/auth/logout', { 'sec-fetch-site': 'cross-site' });
    expect(() => assertSameOrigin(req)).toThrow(OpsHttpError);
  });

  it('rejects Sec-Fetch-Site: same-site when Origin is absent', () => {
    const req = makeReq('https://example.com/api/auth/logout', { 'sec-fetch-site': 'same-site' });
    expect(() => assertSameOrigin(req)).toThrow(OpsHttpError);
  });

  it('allows the request when neither header is present (non-browser client)', () => {
    const req = makeReq('https://example.com/api/auth/logout');
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it('Origin takes precedence over Sec-Fetch-Site when both are present', () => {
    const req = makeReq('https://example.com/api/auth/logout', {
      host: 'example.com',
      origin: 'https://evil.com',
      'sec-fetch-site': 'same-origin',
    });
    expect(() => assertSameOrigin(req)).toThrow(OpsHttpError);
  });
});
