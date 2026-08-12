import { handleOps, opsOk } from '@/lib/ops/api';
import { assertSameOrigin } from '@/lib/ops/csrf';
import { readSessionConfig } from '@/lib/ops/config';
import { normalizeEmail } from '@/lib/ops/credentials';
import { OpsHttpError } from '@/lib/ops/guards';
import { SCRYPT_N, SCRYPT_P, SCRYPT_R, verifyPassword } from '@/lib/ops/password';
import { checkRateLimit, clientKey } from '@/lib/ops/rateLimit';
import { createSession, findUserByEmail, recordLoginFailure, recordLoginSuccess } from '@/lib/ops/repo';
import { hashSessionToken, newSessionToken, sessionCookieAttributes, sessionExpiry, SESSION_COOKIE } from '@/lib/ops/session';

const MAX_BODY_BYTES = 4096;

// A well-formed but unreachable hash, used so a lookup miss still pays the
// full scrypt cost. This closes the timing side channel that would
// otherwise reveal whether an email is registered.
const DUMMY_SALT = Buffer.alloc(16, 0).toString('base64');
const DUMMY_DIGEST = Buffer.alloc(64, 0).toString('base64');
const DUMMY_HASH = `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${DUMMY_SALT}$${DUMMY_DIGEST}`;

export const POST = handleOps(async (req: Request) => {
  assertSameOrigin(req);

  const sessionCfg = readSessionConfig();
  if (!sessionCfg) {
    throw new OpsHttpError(503, 'not_configured', 'Sign-in is not configured on this instance');
  }

  const peerLimit = checkRateLimit(clientKey(req, 'login'), { limit: 10, windowMs: 900_000 });
  if (!peerLimit.allowed) {
    throw new OpsHttpError(429, 'rate_limited', 'Too many sign-in attempts. Try again later.');
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw new OpsHttpError(413, 'payload_too_large', 'Request body is too large');
  }
  let body: { email?: unknown; password?: unknown } | null = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    throw new OpsHttpError(400, 'invalid_body', 'Request body must be valid JSON');
  }

  const email = normalizeEmail(body?.email);
  if (email) {
    const emailLimit = checkRateLimit(clientKey(req, `login-email:${email}`), { limit: 5, windowMs: 900_000 });
    if (!emailLimit.allowed) {
      throw new OpsHttpError(429, 'rate_limited', 'Too many sign-in attempts. Try again later.');
    }
  }

  const password = typeof body?.password === 'string' ? body.password : '';
  const user = email ? await findUserByEmail(email) : undefined;
  const passwordHash = user?.password_hash ?? null;
  const passwordOk = await verifyPassword(password, passwordHash ?? DUMMY_HASH);
  const locked = user?.locked_until ? new Date(user.locked_until).getTime() > Date.now() : false;

  if (!user || !passwordHash || !passwordOk || locked) {
    if (user) await recordLoginFailure(user.id);
    throw new OpsHttpError(401, 'invalid_credentials', 'Email or password is incorrect.');
  }

  await recordLoginSuccess(user.id);

  const token = newSessionToken();
  const tokenHash = hashSessionToken(token, sessionCfg.pepper);
  const expiresAt = sessionExpiry(new Date(), sessionCfg.ttlHours);
  await createSession(user.id, tokenHash, expiresAt);

  const res = opsOk({ userId: user.id, email: user.email });
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
