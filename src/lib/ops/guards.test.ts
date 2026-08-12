import { describe, expect, it } from 'vitest';
import { assertOwned, OpsHttpError, sanitizeRedirect } from './guards';

describe('assertOwned', () => {
  it('throws 404 not_found for an undefined row', () => {
    try {
      assertOwned(undefined, 'user-1');
      throw new Error('expected assertOwned to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(OpsHttpError);
      expect((error as OpsHttpError).status).toBe(404);
      expect((error as OpsHttpError).code).toBe('not_found');
    }
  });

  it('throws 403 forbidden for a different owner', () => {
    try {
      assertOwned({ owner_user_id: 'someone-else' }, 'user-1');
      throw new Error('expected assertOwned to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(OpsHttpError);
      expect((error as OpsHttpError).status).toBe(403);
      expect((error as OpsHttpError).code).toBe('forbidden');
    }
  });

  it('returns the row when the owner matches', () => {
    const row = { owner_user_id: 'user-1', name: 'mine' };
    expect(assertOwned(row, 'user-1')).toBe(row);
  });
});

describe('sanitizeRedirect', () => {
  it('rejects protocol-relative, absolute, javascript:, and empty values', () => {
    expect(sanitizeRedirect('//evil.com')).toBe('/workspaces');
    expect(sanitizeRedirect('https://evil.com')).toBe('/workspaces');
    expect(sanitizeRedirect('javascript:alert(1)')).toBe('/workspaces');
    expect(sanitizeRedirect('')).toBe('/workspaces');
    expect(sanitizeRedirect(null)).toBe('/workspaces');
  });

  it('accepts a plain internal path', () => {
    expect(sanitizeRedirect('/workspaces')).toBe('/workspaces');
    expect(sanitizeRedirect('/plates/abc')).toBe('/plates/abc');
  });
});
