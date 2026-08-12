// Pure ownership and redirect-safety guards shared by every ops route.

export class OpsHttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'OpsHttpError';
  }
}

export function assertOwned<T extends { owner_user_id: string }>(row: T | undefined, userId: string): T {
  if (!row) throw new OpsHttpError(404, 'not_found', 'Resource not found');
  if (row.owner_user_id !== userId) throw new OpsHttpError(403, 'forbidden', 'You do not own this resource');
  return row;
}

const DEFAULT_REDIRECT = '/workspaces';

export function sanitizeRedirect(raw: string | null): string {
  if (!raw) return DEFAULT_REDIRECT;
  if (!raw.startsWith('/')) return DEFAULT_REDIRECT;
  if (raw.startsWith('//')) return DEFAULT_REDIRECT;
  // A scheme like "javascript:" or "https:" embedded after a leading slash
  // (e.g. "/\tjavascript:alert(1)") is still rejected: any ':' before the
  // first '/' beyond index 0, or any occurrence of "://", is disallowed.
  if (raw.includes('://')) return DEFAULT_REDIRECT;
  if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return DEFAULT_REDIRECT;
  return raw;
}
