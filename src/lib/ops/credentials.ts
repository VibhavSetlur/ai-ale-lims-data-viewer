export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
export const EMAIL_MAX = 320;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

const COMMON_PASSWORDS = new Set(['password', '12345678', 'qwertyuiop', 'letmein123']);

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > EMAIL_MAX) {
    return null;
  }
  if (/\s/.test(trimmed)) {
    return null;
  }
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return null;
    }
  }
  const normalized = trimmed.toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

export function validatePassword(raw: unknown, email: string): string | null {
  if (typeof raw !== 'string') {
    return 'Password is required.';
  }
  if (raw.length < PASSWORD_MIN) {
    return `Password must be at least ${PASSWORD_MIN} characters.`;
  }
  if (raw.length > PASSWORD_MAX) {
    return `Password must be at most ${PASSWORD_MAX} characters.`;
  }
  const lowerPassword = raw.toLowerCase();
  const lowerEmail = email.toLowerCase();
  if (lowerPassword === lowerEmail) {
    return 'Password cannot be the same as your email address.';
  }
  const localPart = lowerEmail.split('@')[0];
  if (localPart && lowerPassword === localPart) {
    return 'Password cannot be based on your email address.';
  }
  if (COMMON_PASSWORDS.has(lowerPassword)) {
    return 'Password is too common. Choose a different one.';
  }
  return null;
}
