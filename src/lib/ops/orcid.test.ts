import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizeUrl, exchangeCode } from './orcid';
import { codeChallengeS256 } from './pkce';
import { OpsHttpError } from './guards';
import type { OrcidConfig } from './config';

const cfg: OrcidConfig = {
  clientId: 'client-123',
  clientSecret: 'secret-shh',
  redirectUri: 'https://example.com/api/auth/orcid/callback',
  base: 'https://orcid.org',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('authorizeUrl', () => {
  it('includes code_challenge_method=S256 and the correct challenge', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = codeChallengeS256(verifier);
    const url = new URL(authorizeUrl(cfg, 'state-abc', challenge));

    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(url.searchParams.get('state')).toBe('state-abc');
  });
});

describe('exchangeCode', () => {
  it('sends code_verifier in the token POST body', async () => {
    let capturedBody = '';
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return new Response(JSON.stringify({ orcid: '0000-0001-2345-6789', name: 'Ada Lovelace' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await exchangeCode(cfg, 'auth-code-xyz', 'verifier-value');

    expect(result).toEqual({ orcid: '0000-0001-2345-6789', name: 'Ada Lovelace' });
    const params = new URLSearchParams(capturedBody);
    expect(params.get('code_verifier')).toBe('verifier-value');
    expect(params.get('code')).toBe('auth-code-xyz');
  });

  it('throws a sanitized error that never leaks the raw provider response body', async () => {
    const secretProviderBody = 'invalid_grant: client_secret=secret-shh leaked here';
    const fetchMock = vi.fn(async () => new Response(secretProviderBody, { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      await exchangeCode(cfg, 'auth-code-xyz', 'verifier-value');
      throw new Error('expected exchangeCode to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(OpsHttpError);
      const opsError = error as OpsHttpError;
      expect(opsError.status).toBe(502);
      expect(opsError.code).toBe('orcid_failed');
      expect(opsError.message).not.toContain(secretProviderBody);
      expect(opsError.message).not.toContain('secret-shh');
    }
  });

  it('throws a sanitized error when the provider response is not valid JSON', async () => {
    const fetchMock = vi.fn(async () => new Response('not json {client_secret=secret-shh}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      await exchangeCode(cfg, 'auth-code-xyz', 'verifier-value');
      throw new Error('expected exchangeCode to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(OpsHttpError);
      const opsError = error as OpsHttpError;
      expect(opsError.message).not.toContain('secret-shh');
    }
  });
});
