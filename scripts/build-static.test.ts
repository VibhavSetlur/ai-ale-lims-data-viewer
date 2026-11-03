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
