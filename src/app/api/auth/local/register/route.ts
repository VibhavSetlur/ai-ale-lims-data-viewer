import { handleOps, opsOk } from '@/lib/ops/api';
import { assertSameOrigin } from '@/lib/ops/csrf';
import { readSessionConfig } from '@/lib/ops/config';
import { normalizeEmail, validatePassword } from '@/lib/ops/credentials';
import { OpsHttpError } from '@/lib/ops/guards';
import { hashPassword } from '@/lib/ops/password';
import { clientKey, checkRateLimit } from '@/lib/ops/rateLimit';
import { createLocalUser, createSession, findUserByEmail } from '@/lib/ops/repo';
import { hashSessionToken, newSessionToken, sessionCookieAttributes, sessionExpiry, SESSION_COOKIE } from '@/lib/ops/session';

const MAX_BODY_BYTES = 4096;

export const POST = handleOps(async (req: Request) => {
  assertSameOrigin(req);

  const sessionCfg = readSessionConfig();
  if (!sessionCfg) {
    throw new OpsHttpError(503, 'not_configured', 'Sign-in is not configured on this instance');
  }

  const rateLimit = checkRateLimit(clientKey(req, 'register'), { limit: 10, windowMs: 3600_000 });
  if (!rateLimit.allowed) {
    throw new OpsHttpError(429, 'rate_limited', 'Too many registration attempts. Try again later.');
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw new OpsHttpError(413, 'payload_too_large', 'Request body is too large');
  }
  let body: { email?: unknown; password?: unknown; displayName?: unknown } | null = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    throw new OpsHttpError(400, 'invalid_body', 'Request body must be valid JSON');
  }

  const email = normalizeEmail(body?.email);
  if (!email) {
    throw new OpsHttpError(400, 'invalid_credentials', 'Enter a valid email address.');
  }

  const passwordReason = validatePassword(body?.password, email);
  if (passwordReason) {
    throw new OpsHttpError(400, 'weak_password', passwordReason);
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    throw new OpsHttpError(409, 'registration_failed', 'That email cannot be registered. Try signing in instead.');
  }

  const displayName = typeof body?.displayName === 'string' && body.displayName.trim() ? body.displayName.trim() : null;
  const passwordHash = await hashPassword(body?.password as string);
  const user = await createLocalUser({ email, passwordHash, displayName });

  const token = newSessionToken();
  const tokenHash = hashSessionToken(token, sessionCfg.pepper);
  const expiresAt = sessionExpiry(new Date(), sessionCfg.ttlHours);
  await createSession(user.id, tokenHash, expiresAt);

  const res = opsOk({ userId: user.id, email }, 201);
  const attrs = sessionCookieAttributes(sessionCfg);
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    `Path=${attrs.path}`,
    `Max-Age=${attrs.maxAge}`,
    `SameSite=${attrs.sameSite === 'lax' ? 'Lax' : attrs.sameSite}`,
    'HttpOnly',
  ];
  if (attrs.secure) parts.push('Secure');
  res.headers.append('Set-Cookie', parts.join('; '));
  return res;
});
