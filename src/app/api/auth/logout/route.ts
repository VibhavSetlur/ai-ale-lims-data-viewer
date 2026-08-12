import { readSessionConfig } from '@/lib/ops/config';
import { clearedSessionCookie, hashSessionToken, SESSION_COOKIE } from '@/lib/ops/session';
import { revokeSession } from '@/lib/ops/repo';
import { OpsUnavailable } from '@/lib/ops/mysql';
import { assertSameOrigin } from '@/lib/ops/csrf';
import { OpsHttpError } from '@/lib/ops/guards';
import { opsError } from '@/lib/ops/api';

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

// Idempotent: always returns 204, even with no session, and always clears
// the cookie so a stale client-side cookie is removed regardless of server
// state.
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
  } catch (error) {
    if (error instanceof OpsHttpError) return opsError(error.status, error.code, error.message);
    throw error;
  }

  const cfg = readSessionConfig();
  const token = readCookie(req, SESSION_COOKIE);

  if (cfg && token) {
    const tokenHash = hashSessionToken(token, cfg.pepper);
    try {
      await revokeSession(tokenHash);
    } catch (error) {
      if (!(error instanceof OpsUnavailable)) throw error;
      // Best-effort: still clear the client cookie even if the DB is down.
    }
  }

  const res = new Response(null, { status: 204 });
  res.headers.append('Set-Cookie', clearedSessionCookie(cfg?.secureCookie ?? false));
  return res;
}
