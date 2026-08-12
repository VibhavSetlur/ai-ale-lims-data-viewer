// Small ops-local JSON response envelope + session/error middleware.
// Deliberately separate from the existing ad hoc scientific route bodies
// (src/app/api/tables/route.ts etc.) — do not refactor those routes to use
// this envelope; it exists only for the new src/app/api/ops/* and
// src/app/api/auth/* handlers.
import { NextResponse } from 'next/server';
import { readSessionConfig } from './config';
import { OpsHttpError } from './guards';
import { OpsUnavailable } from './mysql';
import { findSessionByHash } from './repo';
import { hashSessionToken, isSessionUsable, SESSION_COOKIE } from './session';

export function opsOk<T>(data: T, status = 200): Response {
  return NextResponse.json({ data }, { status });
}

export function opsError(status: number, code: string, message: string): Response {
  return NextResponse.json({ error: { code, message } }, { status });
}

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

export async function requireSession(
  req: Request,
): Promise<{ userId: string; orcid: string | null; email: string | null; displayName: string | null }> {
  const cfg = readSessionConfig();
  if (!cfg) throw new OpsHttpError(503, 'not_configured', 'Sign-in is not configured on this instance');

  const token = readCookie(req, SESSION_COOKIE);
  if (!token) throw new OpsHttpError(401, 'unauthenticated', 'Not signed in');

  const tokenHash = hashSessionToken(token, cfg.pepper);
  const row = await findSessionByHash(tokenHash);
  if (!row || !isSessionUsable(row, new Date())) {
    throw new OpsHttpError(401, 'unauthenticated', 'Session is expired or revoked');
  }
  return { userId: row.user_id, orcid: row.orcid, email: row.email, displayName: row.display_name };
}

type RouteHandler = (req: Request, ctx: any) => Promise<Response>;

export function handleOps(fn: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (error) {
      if (error instanceof OpsHttpError) {
        return opsError(error.status, error.code, error.message);
      }
      if (error instanceof OpsUnavailable) {
        return opsError(503, 'db_unavailable', 'Operational database is unavailable');
      }
      return opsError(500, 'internal', 'Internal error');
    }
  };
}
