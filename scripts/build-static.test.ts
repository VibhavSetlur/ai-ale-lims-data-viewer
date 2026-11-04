import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const script = 'scripts/build-static.sh';

function validate(env: Partial<NodeJS.ProcessEnv> = {}): string {
  return execFileSync('bash', [script, '--validate-config'], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

describe('static build configuration guard', () => {
  it('accepts the sole supported base path and static release identity', () => {
    expect(validate({
      BASE_PATH: '/annotation/projects/aiale-dev',
      DEPLOYMENT_CHANNEL: 'static',
      DEPLOYMENT_BRANCH: 'static',
    })).toContain('base path=/annotation/projects/aiale-dev channel=static branch=static');
  });

  it('preserves static-dev development identity without weakening the path guard', () => {
    expect(validate({ STATIC_DEVELOPMENT: '1', DEPLOYMENT_CHANNEL: 'static-dev', DEPLOYMENT_BRANCH: 'static-dev' }))
      .toContain('channel=static-dev branch=static-dev');
    expect(() => validate({ STATIC_DEVELOPMENT: '1', DEPLOYMENT_BRANCH: 'static' })).toThrow();
    expect(() => validate({ STATIC_DEVELOPMENT: '1', BASE_PATH: '/notebook/other' })).toThrow();
  });

  it.each([
    [{ BASE_PATH: '/annotation/projects/other' }, 'support only'],
    [{ DEPLOYMENT_CHANNEL: 'dynamic' }, 'DEPLOYMENT_CHANNEL'],
    [{ DEPLOYMENT_BRANCH: 'dynamic' }, 'DEPLOYMENT_BRANCH'],
  ])('rejects incompatible %s', (env, expected: string) => {
    try {
      validate(env);
      throw new Error('Expected static configuration validation to fail.');
    } catch (error) {
      expect(String(error)).toContain(expected);
    }
  });
});
