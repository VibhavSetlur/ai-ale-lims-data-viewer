import { describe, expect, it } from 'vitest';
import {
  OTHER_GROUP_ID,
  dgoaAlignment,
  dgoaComposition,
  type DgoAMeasurement,
  type DgoAVariant,
} from './dgoaAlleles';

const variants: DgoAVariant[] = [
  { id: 'v1', dnaId: 'd1', aaId: 'a1', dnaLabel: '1', aaLabel: 'A1', dnaSequence: 'ACGT', aaSequence: 'MA' },
  { id: 'v2', dnaId: 'd2', aaId: 'a1', dnaLabel: '2', aaLabel: 'A1', dnaSequence: 'ACGA', aaSequence: 'MA' },
  { id: 'v3', dnaId: 'd3', aaId: 'a2', dnaLabel: '3', aaLabel: 'A2', dnaSequence: 'ACGTACG', aaSequence: 'MK' },
  { id: 'v4', dnaId: 'd4', aaId: 'a3', dnaLabel: '4', aaLabel: 'A3', dnaSequence: 'GGGG', aaSequence: 'MW' },
];

function measurement(
  sampleId: string,
  seqorder: string,
  dnaId: string,
  count: number,
): DgoAMeasurement {
  const variant = variants.find(candidate => candidate.dnaId === dnaId);
  if (!variant) throw new Error(`unknown fixture variant ${dnaId}`);
  return {
    sampleId,
    seqorder,
    alleleDnaIndex: variant.dnaId,
    alleleAaIndex: variant.aaId,
    count,
    measurementId: `${sampleId}.${seqorder}.${dnaId}`,
  };
}

const fixture: DgoAMeasurement[] = [
  measurement('s1', '1', 'd1', 10),
  measurement('s1', '1', 'd2', 5),
  measurement('s1', '1', 'd3', 20),
  measurement('s1', '2', 'd1', 3),
  measurement('s2', '1', 'd1', 1),
  measurement('s2', '1', 'd4', 40),
  measurement('s3', '1', 'd2', 7),
  measurement('s3', '1', 'd3', 3),
  measurement('s4', '1', 'd1', 50),
  measurement('s4', '1', 'd2', 40),
  measurement('s4', '1', 'd3', 30),
  measurement('s4', '1', 'd4', 20),
];

function sampleOf(mode: 'aa' | 'dna', topN: number, sampleId: string, seqorder = '1') {
  const composition = dgoaComposition(variants, fixture, mode, topN);
  const sample = composition.samples.find(
    candidate => candidate.sampleId === sampleId && candidate.seqorder === seqorder,
  );
  if (!sample) throw new Error(`missing sample ${sampleId}/${seqorder}`);
  return { composition, sample };
}

describe('dgoaComposition', () => {
  it('collapses DNA variants that share an AA allele into one AA group by default', () => {
    const { sample } = sampleOf('aa', 0, 's1');
    expect(sample.total).toBe(35);
    expect(sample.segments.map(segment => segment.groupId)).toEqual(['a1', 'a2']);
    const shared = sample.segments.find(segment => segment.groupId === 'a1');
    expect(shared?.count).toBe(15);
    expect(shared?.relative).toBeCloseTo(15 / 35, 10);
  });

  it('keeps DNA identities separate in DNA mode', () => {
    const { sample } = sampleOf('dna', 0, 's1');
    expect(sample.total).toBe(35);
    expect(sample.segments.map(segment => segment.groupId).sort()).toEqual(['d1', 'd2', 'd3']);
    const first = sample.segments.find(segment => segment.groupId === 'd1');
    expect(first?.relative).toBeCloseTo(10 / 35, 10);
  });

  it('applies Top-N to each sample independently and folds the remainder into Other', () => {
    const { composition } = sampleOf('dna', 1, 's1');
    const s1 = composition.samples.find(sample => sample.sampleId === 's1' && sample.seqorder === '1');
    const s2 = composition.samples.find(sample => sample.sampleId === 's2');
    expect(s1?.segments.map(segment => [segment.groupId, segment.count])).toEqual([
      ['d3', 20],
      [OTHER_GROUP_ID, 15],
    ]);
    expect(s2?.segments.map(segment => [segment.groupId, segment.count])).toEqual([
      ['d4', 40],
      [OTHER_GROUP_ID, 1],
    ]);
    const other = composition.groups.find(group => group.id === OTHER_GROUP_ID);
    expect(other?.isOther).toBe(true);
    expect(other?.total).toBe(109);
  });

  it('uses a per-sample denominator for relative abundance', () => {
    const { composition } = sampleOf('dna', 0, 's2');
    const s1 = composition.samples.find(sample => sample.sampleId === 's1' && sample.seqorder === '1');
    const s2 = composition.samples.find(sample => sample.sampleId === 's2');
    const s1D1 = s1?.segments.find(segment => segment.groupId === 'd1');
    const s2D1 = s2?.segments.find(segment => segment.groupId === 'd1');
    expect(s1D1?.relative).toBeCloseTo(10 / 35, 10);
    expect(s2D1?.relative).toBeCloseTo(1 / 41, 10);
  });

  it('orders the shared group list by total across samples, then label', () => {
    const composition = dgoaComposition(variants, fixture, 'aa', 0);
    expect(composition.groups.map(group => group.id)).toEqual(['a1', 'a3', 'a2']);
    expect(composition.groups[0].total).toBe(116);
  });

  it('treats Top-N zero as All and emits no Other group', () => {
    const composition = dgoaComposition(variants, fixture, 'dna', 0);
    expect(composition.groups.map(group => group.id)).toEqual(['d1', 'd4', 'd3', 'd2']);
    expect(composition.groups.some(group => group.id === OTHER_GROUP_ID)).toBe(false);
    expect(composition.samples.every(sample => sample.segments.every(segment => segment.groupId !== OTHER_GROUP_ID))).toBe(true);
  });
});

describe('dgoaAlignment', () => {
  it('returns the AA sequence of an AA-grouped allele and does not claim a substitution', () => {
    const alignment = dgoaAlignment(variants, fixture, 'aa', new Set(['a1']), new Set(), 'aa');
    expect(alignment.rows).toHaveLength(1);
    expect(alignment.rows[0]).toMatchObject({ id: 'a1', label: 'A1', sequence: 'MA' });
    expect(alignment.substituted).toBe(false);
    expect(alignment.warnings).toEqual([]);
  });

  it('shows the most abundant DNA member when an AA group is viewed as DNA', () => {
    const alignment = dgoaAlignment(variants, fixture, 'aa', new Set(['a1']), new Set(), 'dna');
    expect(alignment.rows.map(row => row.sequence)).toEqual(['ACGT']);
    expect(alignment.substituted).toBe(true);
  });

  it('clamps to the shortest sequence when isolated rows disagree on length', () => {
    const alignment = dgoaAlignment(variants, fixture, 'dna', new Set(['d1', 'd3']), new Set(), 'dna');
    expect(alignment.length).toBe(4);
    expect(alignment.warnings.join(' ')).toContain('differ in length');
    expect(alignment.rows.map(row => row.sequence)).toEqual(['ACGT', 'ACGTACG']);
  });

  it('orders rows by selected-sample count and warns when an isolated group is absent', () => {
    const ordered = dgoaAlignment(variants, fixture, 'aa', new Set(['a1', 'a3']), new Set(), 'aa');
    expect(ordered.rows.map(row => row.id)).toEqual(['a1', 'a3']);

    const absent = dgoaAlignment(variants, fixture, 'aa', new Set(['a3']), new Set(['s3']), 'aa');
    expect(absent.rows).toHaveLength(0);
    expect(absent.warnings.join(' ')).toContain('absent from the selected samples');
  });
});
