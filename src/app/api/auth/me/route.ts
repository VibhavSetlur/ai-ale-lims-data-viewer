import { opsOk } from '@/lib/ops/api';
import { readSessionConfig } from '@/lib/ops/config';
import { hashSessionToken, isSessionUsable, SESSION_COOKIE } from '@/lib/ops/session';
import { findSessionByHash } from '@/lib/ops/repo';

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

// Returns { authenticated: false } (200) rather than 401 so the UI can
// branch cleanly without treating "not signed in" as an error state.
export async function GET(req: Request) {
  const cfg = readSessionConfig();
  if (!cfg) return opsOk({ authenticated: false }, 503);

  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return opsOk({ authenticated: false });

  const tokenHash = hashSessionToken(token, cfg.pepper);
  const row = await findSessionByHash(tokenHash);
  if (!row || !isSessionUsable(row, new Date())) {
    return opsOk({ authenticated: false });
  }
  return opsOk({ authenticated: true, user: { orcid: row.orcid, email: row.email, displayName: row.display_name } });
}
