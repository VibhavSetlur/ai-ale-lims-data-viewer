// PKCE (RFC 7636) helpers for the ORCID authorization-code flow. Pure and
// unit-tested. `newCodeVerifier` is the only source of entropy; everything
// else here is deterministic given its input.
import { createHash, randomBytes } from 'crypto';

export function newCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
