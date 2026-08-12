import { describe, expect, it } from 'vitest';
import { OpsHttpError } from './guards';
import { normalizeDesignName, normalizeSearch } from './designInput';

describe('normalizeDesignName', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeDesignName('  Run 1  ')).toBe('Run 1');
  });

  it('collapses inner whitespace runs into a single space', () => {
    expect(normalizeDesignName('Run\t\n  1   2')).toBe('Run 1 2');
  });

  it('throws invalid_name on an empty string', () => {
    expect(() => normalizeDesignName('')).toThrow(OpsHttpError);
    try {
      normalizeDesignName('');
    } catch (error) {
      expect(error).toBeInstanceOf(OpsHttpError);
      expect((error as OpsHttpError).status).toBe(400);
      expect((error as OpsHttpError).code).toBe('invalid_name');
    }
  });

  it('throws invalid_name on a whitespace-only string', () => {
    expect(() => normalizeDesignName('   \t  ')).toThrow(OpsHttpError);
  });

  it('throws invalid_name when longer than 120 chars after trim', () => {
    const tooLong = 'a'.repeat(121);
    expect(() => normalizeDesignName(`  ${tooLong}  `)).toThrow(OpsHttpError);
  });

  it('accepts exactly 120 chars after trim', () => {
    const exact = 'a'.repeat(120);
    expect(normalizeDesignName(`  ${exact}  `)).toBe(exact);
  });

  it('throws invalid_name for non-string input', () => {
    expect(() => normalizeDesignName(42)).toThrow(OpsHttpError);
    expect(() => normalizeDesignName(null)).toThrow(OpsHttpError);
    expect(() => normalizeDesignName(undefined)).toThrow(OpsHttpError);
    expect(() => normalizeDesignName({ name: 'x' })).toThrow(OpsHttpError);
  });
});

describe('normalizeSearch', () => {
  it('returns null for a null input', () => {
    expect(normalizeSearch(null)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(normalizeSearch('')).toBeNull();
  });

  it('returns null for a whitespace-only string', () => {
    expect(normalizeSearch('   ')).toBeNull();
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeSearch('  plate 1  ')).toBe('plate 1');
  });

  it('caps the result at 120 characters', () => {
    const long = 'x'.repeat(150);
    expect(normalizeSearch(long)).toBe('x'.repeat(120));
  });

  it('escapes % wildcards', () => {
    expect(normalizeSearch('50%done')).toBe('50\\%done');
  });

  it('escapes _ wildcards', () => {
    expect(normalizeSearch('run_1')).toBe('run\\_1');
  });

  it('escapes both % and _ together', () => {
    expect(normalizeSearch('a_b%c')).toBe('a\\_b\\%c');
  });
});
