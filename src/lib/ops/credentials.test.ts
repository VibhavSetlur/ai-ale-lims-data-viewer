import { describe, expect, it } from 'vitest';
import { normalizeEmail, validatePassword } from './credentials';

describe('normalizeEmail', () => {
  it('trims whitespace and lowercases', () => {
    expect(normalizeEmail('  Person@Example.COM  ')).toBe('person@example.com');
  });

  it('rejects missing @', () => {
    expect(normalizeEmail('personexample.com')).toBeNull();
  });

  it('rejects missing dot in domain', () => {
    expect(normalizeEmail('person@examplecom')).toBeNull();
  });

  it('rejects overlong addresses', () => {
    const overlong = `${'a'.repeat(310)}@example.com`;
    expect(normalizeEmail(overlong)).toBeNull();
  });

  it('accepts a well-formed address', () => {
    expect(normalizeEmail('person@example.com')).toBe('person@example.com');
  });
});

describe('validatePassword', () => {
  it('rejects a password that is too short', () => {
    expect(validatePassword('short1', 'person@example.com')).not.toBeNull();
  });

  it('rejects a password equal to the email', () => {
    expect(validatePassword('Person@Example.com', 'person@example.com')).not.toBeNull();
  });

  it('accepts a strong, unrelated password', () => {
    expect(validatePassword('a-strong-unique-passphrase', 'person@example.com')).toBeNull();
  });
});
