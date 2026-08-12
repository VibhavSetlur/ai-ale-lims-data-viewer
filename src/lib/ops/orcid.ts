// ORCID authorization-code helpers. `authorizeUrl` is pure and unit-tested.
// `exchangeCode` performs network I/O and is intentionally the only
// untestable surface in this module. It never logs the code, token, or
// client secret, and never echoes a provider response body to the client.
import type { OrcidConfig } from './config';
import { OpsHttpError } from './guards';

export function authorizeUrl(cfg: OrcidConfig, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    scope: '/authenticate',
    redirect_uri: cfg.redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${cfg.base}/oauth/authorize?${params.toString()}`;
}

export async function exchangeCode(
  cfg: OrcidConfig,
  code: string,
  codeVerifier: string,
): Promise<{ orcid: string; name: string | null }> {
  let response: Response;
  try {
    response = await fetch(`${cfg.base}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: cfg.redirectUri,
        code_verifier: codeVerifier,
      }).toString(),
    });
  } catch {
    throw new OpsHttpError(502, 'orcid_failed', 'ORCID sign-in failed');
  }

  if (!response.ok) {
    throw new OpsHttpError(502, 'orcid_failed', 'ORCID sign-in failed');
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new OpsHttpError(502, 'orcid_failed', 'ORCID sign-in failed');
  }

  const orcid = (body as { orcid?: unknown }).orcid;
  const name = (body as { name?: unknown }).name;
  if (typeof orcid !== 'string' || !orcid) {
    throw new OpsHttpError(502, 'orcid_failed', 'ORCID sign-in failed');
  }
  return { orcid, name: typeof name === 'string' && name ? name : null };
}
