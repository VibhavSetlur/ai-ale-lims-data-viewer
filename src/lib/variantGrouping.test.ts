import { describe, expect, it } from 'vitest';
import { projectVariantDataset, UNPARSED_VARIANT_GROUP, variantGroupKey } from './variantGrouping';

const variants = [
  { variantId: 'A1-B1', label: 'A1-B1', aiGenerated: false, verAaiGenerated: false, verBaiGenerated: false },
  { variantId: 'A1-B2', label: 'A1-B2', aiGenerated: true, verAaiGenerated: true, verBaiGenerated: false },
  { variantId: 'A2-B1', label: 'A2-B1', aiGenerated: false, verAaiGenerated: false, verBaiGenerated: true },
];
const measurements = [
  { sampleId: 'sample1', variantId: 'A1-B1', abundance: 1, count: 10 },
  { sampleId: 'sample1', variantId: 'A1-B2', abundance: 2, count: 20 },
  { sampleId: 'sample1', variantId: 'A2-B1', abundance: 4, count: 40 },
  { sampleId: 'sample2', variantId: 'A1-B1', abundance: 8, count: 80 },
];

describe('variant grouping', () => {
  it('returns combined and individual barcode keys', () => {
    expect(variantGroupKey('A083-B151', 'combined')).toBe('A083-B151');
    expect(variantGroupKey('A083-B151', 'verA')).toBe('A083');
    expect(variantGroupKey('A083-B151', 'verB')).toBe('B151');
  });

  it('preserves real unknown barcode sentinels', () => {
    expect(variantGroupKey('A_UNK-B174', 'verA')).toBe('A_UNK');
    expect(variantGroupKey('A083-B_UNK', 'verB')).toBe('B_UNK');
    expect(variantGroupKey('A_UNK-B174', 'verA')).not.toBe(UNPARSED_VARIANT_GROUP);
    expect(variantGroupKey('A083-B_UNK', 'verB')).not.toBe(UNPARSED_VARIANT_GROUP);
  });

  it('keeps unparseable values out of real barcode groups', () => {
    expect(variantGroupKey('noseparator', 'verA')).toBe(UNPARSED_VARIANT_GROUP);
    expect(variantGroupKey('-B151', 'verA')).toBe(UNPARSED_VARIANT_GROUP);
    expect(variantGroupKey('noseparator', 'verA')).not.toBe('A1');
  });

  it('returns the original arrays unchanged in combined mode', () => {
    const projection = projectVariantDataset(variants, measurements, 'combined');
    expect(projection.variants).toBe(variants);
    expect(projection.measurements).toBe(measurements);
  });

  it('aggregates VerA values by sample without bleed', () => {
    const projection = projectVariantDataset(variants, measurements, 'verA');
    expect(projection.variants.map(variant => variant.variantId)).toEqual(['A1', 'A2']);
    expect(projection.measurements.map(({ sampleId, variantId, abundance, count }) => ({ sampleId, variantId, abundance, count }))).toEqual([
      { sampleId: 'sample1', variantId: 'A1', abundance: 3, count: 30 },
      { sampleId: 'sample1', variantId: 'A2', abundance: 4, count: 40 },
      { sampleId: 'sample2', variantId: 'A1', abundance: 8, count: 80 },
    ]);
  });

  it('aggregates VerB values by sample', () => {
    const projection = projectVariantDataset(variants, measurements, 'verB');
    expect(projection.variants.map(variant => variant.variantId)).toEqual(['B1', 'B2']);
    expect(projection.measurements.map(({ sampleId, variantId, abundance, count }) => ({ sampleId, variantId, abundance, count }))).toEqual([
      { sampleId: 'sample1', variantId: 'B1', abundance: 5, count: 50 },
      { sampleId: 'sample1', variantId: 'B2', abundance: 2, count: 20 },
      { sampleId: 'sample2', variantId: 'B1', abundance: 8, count: 80 },
    ]);
  });

  it('leaves count undefined when no contributor has a numeric count', () => {
    const projection = projectVariantDataset(variants, [{ sampleId: 'sample1', variantId: 'A1-B1', abundance: 1 }, { sampleId: 'sample1', variantId: 'A1-B2', abundance: 2, count: Number.NaN }], 'verA');
    expect(projection.measurements[0].count).toBeUndefined();
  });

  it('OR-aggregates AI flags', () => {
    const projection = projectVariantDataset(variants, measurements, 'verA');
    expect(projection.variants.find(variant => variant.variantId === 'A1')?.verAaiGenerated).toBe(true);
  });

  it('does not mutate inputs or their elements', () => {
    const sourceVariants = variants.map(variant => ({ ...variant }));
    const sourceMeasurements = measurements.map(measurement => ({ ...measurement }));
    const originalVariant = { ...sourceVariants[0] };
    projectVariantDataset(sourceVariants, sourceMeasurements, 'verA');
    expect(sourceVariants).toEqual(variants);
    expect(sourceMeasurements).toEqual(measurements);
    expect(sourceVariants[0]).toEqual(originalVariant);
  });

  it('synthesizes a complete variant for measurement-only groups', () => {
    const projection = projectVariantDataset(
      [{ variantId: 'A1-B1', label: 'A1-B1', aiGenerated: false, verAaiGenerated: false, verBaiGenerated: false, metadata: { verA_name: 'A1' } }],
      [{ sampleId: 'sample1', variantId: 'A9-B9', abundance: 1, count: 10 }],
      'verA',
    );
    const orphan = projection.variants.find(variant => variant.variantId === 'A9');
    expect(orphan?.metadata).toEqual({});
    expect(orphan?.variantId).toBe('A9');
    expect(orphan?.label).toBe('A9');
    expect(orphan?.aiGenerated).toBe(false);
  });
});
