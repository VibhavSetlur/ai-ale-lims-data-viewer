import { randomBytes, createHash } from 'crypto';
import { readOrcidConfig, readOpsDbConfig } from '@/lib/ops/config';
import { opsError } from '@/lib/ops/api';
import { sanitizeRedirect } from '@/lib/ops/guards';
import { authorizeUrl } from '@/lib/ops/orcid';
import { codeChallengeS256, newCodeVerifier } from '@/lib/ops/pkce';
import { putAuthState } from '@/lib/ops/repo';
import { OpsUnavailable } from '@/lib/ops/mysql';

const STATE_TTL_MINUTES = 10;

export async function GET(req: Request) {
  const orcidCfg = readOrcidConfig();
  const dbCfg = readOpsDbConfig();
  if (!orcidCfg || !dbCfg) {
    return opsError(503, 'not_configured', 'Sign-in is not configured on this instance');
  }

  const url = new URL(req.url);
  const redirectTo = sanitizeRedirect(url.searchParams.get('redirect'));

  const state = randomBytes(32).toString('base64url');
  const stateHash = createHash('sha256').update(state).digest('hex');
  const expiresAt = new Date(Date.now() + STATE_TTL_MINUTES * 60 * 1000);
  const codeVerifier = newCodeVerifier();
  const codeChallenge = codeChallengeS256(codeVerifier);

  try {
    await putAuthState(stateHash, redirectTo, expiresAt, codeVerifier);
  } catch (error) {
    if (error instanceof OpsUnavailable) return opsError(503, 'db_unavailable', 'Operational database is unavailable');
    return opsError(500, 'internal', 'Internal error');
  }

  return Response.redirect(authorizeUrl(orcidCfg, state, codeChallenge), 302);
}
