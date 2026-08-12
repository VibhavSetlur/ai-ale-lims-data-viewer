import { createHash } from 'crypto';
import { readOrcidConfig, readOpsDbConfig, readSessionConfig } from '@/lib/ops/config';
import { OpsHttpError } from '@/lib/ops/guards';
import { exchangeCode } from '@/lib/ops/orcid';
import { OpsUnavailable } from '@/lib/ops/mysql';
import { consumeAuthState, createSession, upsertUserByOrcid } from '@/lib/ops/repo';
import { hashSessionToken, newSessionToken, sessionCookieAttributes, sessionExpiry, SESSION_COOKIE } from '@/lib/ops/session';

const LOGIN_PATH = '/login';

function redirectTo(req: Request, path: string, cookie?: { name: string; value: string; attrs: ReturnType<typeof sessionCookieAttributes> }) {
  const url = new URL(path, req.url);
  const res = Response.redirect(url.toString(), 302) as Response;
  if (cookie) {
    const { name, value, attrs } = cookie;
    const parts = [
      `${name}=${value}`,
      `Path=${attrs.path}`,
      `Max-Age=${attrs.maxAge}`,
      `SameSite=${attrs.sameSite === 'lax' ? 'Lax' : attrs.sameSite}`,
      'HttpOnly',
    ];
    if (attrs.secure) parts.push('Secure');
    res.headers.append('Set-Cookie', parts.join('; '));
  }
  return res;
}

export async function GET(req: Request) {
  const orcidCfg = readOrcidConfig();
  const dbCfg = readOpsDbConfig();
  const sessionCfg = readSessionConfig();
  if (!orcidCfg || !dbCfg || !sessionCfg) {
    return new Response(JSON.stringify({ error: { code: 'not_configured', message: 'Sign-in is not configured on this instance' } }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  if (url.searchParams.get('error')) {
    return redirectTo(req, `${LOGIN_PATH}?denied=1`);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return redirectTo(req, `${LOGIN_PATH}?error=invalid`);
  }

  const expectedRedirect = new URL(orcidCfg.redirectUri);
  if (url.origin !== expectedRedirect.origin || url.pathname !== expectedRedirect.pathname) {
    return new Response(JSON.stringify({ error: { code: 'redirect_mismatch', message: 'Callback redirect URI does not match the configured value' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const stateHash = createHash('sha256').update(state).digest('hex');

  try {
    const consumed = await consumeAuthState(stateHash, new Date());
    if (!consumed) {
      return redirectTo(req, `${LOGIN_PATH}?error=invalid`);
    }

    const { orcid, name } = await exchangeCode(orcidCfg, code, consumed.code_verifier);
    const user = await upsertUserByOrcid(orcid, name);

    const token = newSessionToken();
    const tokenHash = hashSessionToken(token, sessionCfg.pepper);
    const expiresAt = sessionExpiry(new Date(), sessionCfg.ttlHours);
    await createSession(user.id, tokenHash, expiresAt);

    return redirectTo(req, consumed.redirect_to, {
      name: SESSION_COOKIE,
      value: token,
      attrs: sessionCookieAttributes(sessionCfg),
    });
  } catch (error) {
    if (error instanceof OpsHttpError) {
      return redirectTo(req, `${LOGIN_PATH}?error=${encodeURIComponent(error.code)}`);
    }
    if (error instanceof OpsUnavailable) {
      return redirectTo(req, `${LOGIN_PATH}?error=db_unavailable`);
    }
    return redirectTo(req, `${LOGIN_PATH}?error=internal`);
  }
}
