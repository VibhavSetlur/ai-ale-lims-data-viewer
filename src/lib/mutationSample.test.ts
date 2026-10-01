import { describe, expect, it } from 'vitest';
import { deriveReplicate } from './mutationSample';

describe('deriveReplicate', () => {
  it('preserves terminal numeric replicates', () => {
    expect(deriveReplicate('TFMN1.fba.1')).toBe('1');
  });

  it.each(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'])('reads %s replicate before a transfer suffix', replicate => {
    expect(deriveReplicate(`EASyUnchar22.LdgoA3.${replicate}.T504`)).toBe(replicate);
  });

  it('reads compact letter replicates and ignores unrelated sample names', () => {
    expect(deriveReplicate('EASyUnchar22.LdgoA3A.T504')).toBe('A');
    expect(deriveReplicate('EASyUnchar22.LdgoA3K.T504')).toBeUndefined();
    expect(deriveReplicate('unstructured')).toBeUndefined();
  });
});
