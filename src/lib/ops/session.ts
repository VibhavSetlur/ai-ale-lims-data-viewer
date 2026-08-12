// Pure session crypto/policy helpers plus thin cookie-attribute helpers.
//
// Tokens are opaque random values. Only their hash is ever persisted
// (ops_session.token_hash). The raw token appears only in the Set-Cookie
// header written at login and the inbound Cookie header read on each
// request; it must never be logged or included in a response body.
import { createHash, randomBytes } from 'crypto';
import type { SessionConfig } from './config';

export const SESSION_COOKIE = 'aiale_ops_session';

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string, pepper: string): string {
  return createHash('sha256').update(`${pepper}:${token}`).digest('hex');
}

export function sessionExpiry(now: Date, ttlHours: number): Date {
  return new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
}

export function isSessionUsable(row: { expires_at: Date; revoked_at: Date | null }, now: Date): boolean {
  if (row.revoked_at !== null) return false;
  return row.expires_at.getTime() > now.getTime();
}

export function sessionCookieAttributes(cfg: SessionConfig): {
  httpOnly: true;
  sameSite: 'lax';
  path: '/';
  secure: boolean;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: cfg.secureCookie,
    maxAge: cfg.ttlHours * 60 * 60,
  };
}

// Builds the Set-Cookie value that clears the session cookie. Must carry
// the same HttpOnly/Path/SameSite/Secure flags as the cookie that set it,
// or some browsers will not overwrite/remove the original.
export function clearedSessionCookie(secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'Max-Age=0', 'SameSite=Lax', 'HttpOnly'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
