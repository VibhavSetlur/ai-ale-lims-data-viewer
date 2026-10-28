import { describe, expect, it } from 'vitest';
import { groupDgoA } from './dgoaAlleles';
const variants = [
 { id:'d1', dnaId:'d1', aaId:'a1', dnaLabel:'D1', aaLabel:'A1' },
 { id:'d2', dnaId:'d2', aaId:'a1', dnaLabel:'D2', aaLabel:'A1' },
];
describe('dgoA grouping', () => {
 it('sums DNA variants before AA ranking and uses every group in the denominator', () => {
  const groups=groupDgoA(variants,[{sampleId:'s',alleleDnaIndex:'d1',alleleAaIndex:'a1',count:2},{sampleId:'s',alleleDnaIndex:'d2',alleleAaIndex:'a1',count:3}], 'aa');
  expect(groups).toHaveLength(1); expect(groups[0].count).toBe(5); expect(groups[0].relative).toBe(1);
 });
});
