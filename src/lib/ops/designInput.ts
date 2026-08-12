// Pure input-normalization helpers for the plate-design lifecycle. No I/O.
import { OpsHttpError } from './guards';

export function normalizeDesignName(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new OpsHttpError(400, 'invalid_name', 'Design name must be a string');
  }
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  if (collapsed.length === 0 || collapsed.length > 120) {
    throw new OpsHttpError(400, 'invalid_name', 'Design name must be between 1 and 120 characters');
  }
  return collapsed;
}

// Escapes LIKE wildcards ('%' and '_') so a search term is matched literally
// against a `LIKE CONCAT('%', ?, '%') ESCAPE '\\'` clause.
export function normalizeSearch(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const capped = trimmed.slice(0, 120);
  return capped.replace(/([%_])/g, '\\$1');
}
