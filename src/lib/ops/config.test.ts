import { describe, expect, it } from 'vitest';
import { opsStatus, readAssistantConfig, readOpsDbConfig, readOrcidConfig, readSessionConfig } from './config';

const VALID_PEPPER = 'a'.repeat(32);

describe('ops config (pure, no I/O)', () => {
  it('reports both flags false and named problems for an empty environment', () => {
    const status = opsStatus({} as unknown as NodeJS.ProcessEnv);
    expect(status.dbConfigured).toBe(false);
    expect(status.authConfigured).toBe(false);
    expect(status.problems).toContain('OPS_DB_URL is not set');
    expect(status.problems).toContain('ORCID_CLIENT_ID is not set');
    expect(status.problems).toContain('ORCID_CLIENT_SECRET is not set');
    expect(status.problems).toContain('ORCID_REDIRECT_URI is not set');
    expect(status.problems).toContain('OPS_SESSION_PEPPER is not set');
    // Never emits or asserts an actual value anywhere in this test file.
    for (const problem of status.problems) {
      expect(problem).not.toMatch(/mysql:\/\//);
    }
  });

  it('names exactly the missing variables for a partial environment', () => {
    const status = opsStatus({
      OPS_DB_URL: 'mysql://user:pass@host:3306/db',
      ORCID_CLIENT_ID: 'id',
    } as unknown as NodeJS.ProcessEnv);
    expect(status.dbConfigured).toBe(true);
    expect(status.problems).not.toContain('OPS_DB_URL is not set');
    expect(status.problems).not.toContain('ORCID_CLIENT_ID is not set');
    expect(status.problems).toContain('ORCID_CLIENT_SECRET is not set');
    expect(status.problems).toContain('ORCID_REDIRECT_URI is not set');
    expect(status.problems).toContain('OPS_SESSION_PEPPER is not set');
    expect(status.authConfigured).toBe(false);
  });

  it('is fully configured only when db, orcid, and session are all present and valid', () => {
    const env = {
      OPS_DB_URL: 'mysql://user:pass@host:3306/db',
      ORCID_CLIENT_ID: 'id',
      ORCID_CLIENT_SECRET: 'secret',
      ORCID_REDIRECT_URI: 'https://example.org/api/auth/orcid/callback',
      OPS_SESSION_PEPPER: VALID_PEPPER,
    } as unknown as NodeJS.ProcessEnv;
    const status = opsStatus(env);
    expect(status.dbConfigured).toBe(true);
    expect(status.authConfigured).toBe(true);
    expect(status.problems).toEqual([]);
  });

  it('is locally configured when the db and a valid session pepper are present, with no ORCID vars', () => {
    const status = opsStatus({
      OPS_DB_URL: 'mysql://user:pass@host:3306/db',
      OPS_SESSION_PEPPER: VALID_PEPPER,
    } as unknown as NodeJS.ProcessEnv);
    expect(status.localAuthConfigured).toBe(true);
    expect(status.authConfigured).toBe(false);
  });

  it('is not locally configured when the session pepper is missing or too short', () => {
    const missingPepper = opsStatus({
      OPS_DB_URL: 'mysql://user:pass@host:3306/db',
    } as unknown as NodeJS.ProcessEnv);
    expect(missingPepper.localAuthConfigured).toBe(false);

    const shortPepper = opsStatus({
      OPS_DB_URL: 'mysql://user:pass@host:3306/db',
      OPS_SESSION_PEPPER: 'short',
    } as unknown as NodeJS.ProcessEnv);
    expect(shortPepper.localAuthConfigured).toBe(false);
  });

  it('readOpsDbConfig returns null when unset, the url otherwise', () => {
    expect(readOpsDbConfig({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(readOpsDbConfig({ OPS_DB_URL: 'mysql://x' } as unknown as NodeJS.ProcessEnv)).toEqual({ url: 'mysql://x' });
  });

  it('readOrcidConfig requires all three variables and defaults base', () => {
    expect(readOrcidConfig({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    const cfg = readOrcidConfig({
      ORCID_CLIENT_ID: 'id',
      ORCID_CLIENT_SECRET: 'secret',
      ORCID_REDIRECT_URI: 'http://localhost:3458/api/auth/orcid/callback',
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg?.base).toBe('https://orcid.org');
  });

  it('readSessionConfig enforces the minimum pepper length and secure-cookie detection', () => {
    expect(readSessionConfig({ OPS_SESSION_PEPPER: 'short' } as unknown as NodeJS.ProcessEnv)).toBeNull();
    const insecure = readSessionConfig({
      OPS_SESSION_PEPPER: VALID_PEPPER,
      ORCID_REDIRECT_URI: 'http://localhost:3458/api/auth/orcid/callback',
    } as unknown as NodeJS.ProcessEnv);
    expect(insecure?.secureCookie).toBe(false);
    const secure = readSessionConfig({
      OPS_SESSION_PEPPER: VALID_PEPPER,
      ORCID_REDIRECT_URI: 'https://example.org/api/auth/orcid/callback',
    } as unknown as NodeJS.ProcessEnv);
    expect(secure?.secureCookie).toBe(true);
  });
});

describe('assistant config (pure, no I/O)', () => {
  it('is disabled by default', () => {
    expect(readAssistantConfig({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(opsStatus({} as unknown as NodeJS.ProcessEnv).assistantConfigured).toBe(false);
  });

  it('enables with documented defaults when ASSISTANT_ENABLED=1', () => {
    const env = { ASSISTANT_ENABLED: '1' } as unknown as NodeJS.ProcessEnv;
    expect(readAssistantConfig(env)).toEqual({
      proxyUrl: 'http://127.0.0.1:3459',
      defaultModel: 'gpt5mini',
      timeoutMs: 120000,
      maxConversations: 5,
      maxMessageChars: 8000,
    });
    expect(opsStatus(env).assistantConfigured).toBe(true);
  });

  it('honors a custom model and timeout', () => {
    const cfg = readAssistantConfig({
      ASSISTANT_ENABLED: '1',
      ASSISTANT_MODEL: 'gpt5',
      ASSISTANT_TIMEOUT_MS: '5000',
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg?.defaultModel).toBe('gpt5');
    expect(cfg?.timeoutMs).toBe(5000);
  });

  it('falls back to the default timeout when ASSISTANT_TIMEOUT_MS is not a positive finite number', () => {
    const cfg = readAssistantConfig({
      ASSISTANT_ENABLED: '1',
      ASSISTANT_TIMEOUT_MS: '-5',
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg?.timeoutMs).toBe(120000);
  });

  it('accepts localhost as an equivalent loopback host', () => {
    const cfg = readAssistantConfig({
      ASSISTANT_ENABLED: '1',
      ASSISTANT_PROXY_URL: 'http://localhost:3459',
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg?.proxyUrl).toBe('http://localhost:3459');
  });

  it('rejects a non-loopback ASSISTANT_PROXY_URL', () => {
    const cfg = readAssistantConfig({
      ASSISTANT_ENABLED: '1',
      ASSISTANT_PROXY_URL: 'http://evil.example.com',
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg).toBeNull();
  });

  it('rejects a malformed ASSISTANT_PROXY_URL', () => {
    const cfg = readAssistantConfig({
      ASSISTANT_ENABLED: '1',
      ASSISTANT_PROXY_URL: 'not a url',
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg).toBeNull();
  });
});
