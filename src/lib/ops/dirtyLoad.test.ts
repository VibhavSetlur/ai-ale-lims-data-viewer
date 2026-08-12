import { describe, it, expect } from 'vitest';
import { decideLoad, resolveSaveMode } from './dirtyLoad';

describe('decideLoad', () => {
  it('loads when there is no baseline yet', () => {
    expect(decideLoad('{"a":1}', null)).toBe('load');
  });

  it('loads when the current draft matches the baseline', () => {
    const serialized = '{"a":1,"b":2}';
    expect(decideLoad(serialized, serialized)).toBe('load');
  });

  it('prompts when the current draft differs from the baseline', () => {
    expect(decideLoad('{"a":1}', '{"a":2}')).toBe('prompt');
  });
});

describe('resolveSaveMode', () => {
  it('returns update for save with a loaded design id', () => {
    expect(resolveSaveMode('save', 'design-123', '')).toBe('update');
  });

  it('returns update even if a pending name is also present', () => {
    expect(resolveSaveMode('save', 'design-123', 'Some name')).toBe('update');
  });

  it('returns saveAs for save with no id but a non-empty trimmed name', () => {
    expect(resolveSaveMode('save', null, 'New design')).toBe('saveAs');
  });

  it('returns blocked for save with no id and a blank name', () => {
    expect(resolveSaveMode('save', null, '')).toBe('blocked');
  });

  it('returns blocked for save with no id and a whitespace-only name', () => {
    expect(resolveSaveMode('save', null, '   ')).toBe('blocked');
  });

  it('returns blocked for discard regardless of id or name', () => {
    expect(resolveSaveMode('discard', 'design-123', 'New design')).toBe('blocked');
    expect(resolveSaveMode('discard', null, '')).toBe('blocked');
  });

  it('returns blocked for cancel regardless of id or name', () => {
    expect(resolveSaveMode('cancel', 'design-123', 'New design')).toBe('blocked');
    expect(resolveSaveMode('cancel', null, '')).toBe('blocked');
  });
});
