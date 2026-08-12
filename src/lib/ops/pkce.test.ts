import { describe, expect, it } from 'vitest';
import { codeChallengeS256, newCodeVerifier } from './pkce';

describe('codeChallengeS256', () => {
  it('matches the RFC 7636 appendix B vector', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(codeChallengeS256(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('is deterministic for the same verifier', () => {
    const verifier = newCodeVerifier();
    expect(codeChallengeS256(verifier)).toBe(codeChallengeS256(verifier));
  });

  it('produces different challenges for different verifiers', () => {
    expect(codeChallengeS256(newCodeVerifier())).not.toBe(codeChallengeS256(newCodeVerifier()));
  });

  it('is base64url (no padding, no +/ characters)', () => {
    const challenge = codeChallengeS256(newCodeVerifier());
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).not.toContain('=');
  });
});

describe('newCodeVerifier', () => {
  it('produces a verifier within the RFC 7636 43-128 char range', () => {
    const verifier = newCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it('uses only the base64url charset (unreserved characters)', () => {
    const verifier = newCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates distinct verifiers on each call', () => {
    expect(newCodeVerifier()).not.toBe(newCodeVerifier());
  });
});
