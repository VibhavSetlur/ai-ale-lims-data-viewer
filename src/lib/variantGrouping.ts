// Candidate is exactly verA + '-' + verB with one hyphen, so splitting is safe.
// parseCandidate is deliberately not reused because it rejects real A_UNK/B_UNK sentinels.

export type VariantGroupMode = 'combined' | 'verA' | 'verB';

export const VARIANT_GROUP_MODES: readonly { value: VariantGroupMode; label: string }[] = [
  { value: 'combined', label: 'Combined A-B' },
  { value: 'verA', label: 'VerA only' },
  { value: 'verB', label: 'VerB only' },
];

export const UNPARSED_VARIANT_GROUP = 'n/a';

export function variantGroupKey(variantId: string, mode: VariantGroupMode): string {
  if (mode === 'combined') return variantId;
  const separator = variantId.indexOf('-');
  if (separator < 0) return UNPARSED_VARIANT_GROUP;
  const group = mode === 'verA' ? variantId.slice(0, separator) : variantId.slice(separator + 1);
  return group || UNPARSED_VARIANT_GROUP;
}

export function projectVariantDataset<
  V extends { variantId: string; label: string; aiGenerated?: boolean; verAaiGenerated?: boolean; verBaiGenerated?: boolean },
  M extends { sampleId: string; variantId: string; abundance: number; count?: number },
>(
  variants: readonly V[],
  measurements: readonly M[],
  mode: VariantGroupMode,
): { variants: V[]; measurements: M[] } {
  if (mode === 'combined') return { variants: variants as V[], measurements: measurements as M[] };

  const variantsByGroup = new Map<string, V[]>();
  for (const variant of variants) {
    const group = variantGroupKey(variant.variantId, mode);
    const entries = variantsByGroup.get(group) ?? [];
    entries.push(variant);
    variantsByGroup.set(group, entries);
  }

  const groupedMeasurements = new Map<string, { first: M; sampleId: string; variantId: string; abundance: number; count: number; hasCount: boolean }>();
  for (const measurement of measurements) {
    const variantId = variantGroupKey(measurement.variantId, mode);
    const key = `${measurement.sampleId}|${variantId}`;
    const entry = groupedMeasurements.get(key) ?? {
      first: measurement,
      sampleId: measurement.sampleId,
      variantId,
      abundance: 0,
      count: 0,
      hasCount: false,
    };
    entry.abundance += Number(measurement.abundance) || 0;
    const count = Number(measurement.count);
    entry.count += count || 0;
    entry.hasCount ||= typeof measurement.count === 'number' && Number.isFinite(measurement.count);
    groupedMeasurements.set(key, entry);
  }

  const projectedMeasurements = [...groupedMeasurements.values()].map(entry => ({
    ...entry.first,
    sampleId: entry.sampleId,
    variantId: entry.variantId,
    abundance: entry.abundance,
    count: entry.hasCount ? entry.count : undefined,
  }) as M);

  const measurementGroups = new Set(projectedMeasurements.map(measurement => measurement.variantId));
  const groupOrder: string[] = [];
  const seenGroups = new Set<string>();
  for (const variant of variants) {
    const group = variantGroupKey(variant.variantId, mode);
    if (measurementGroups.has(group) && !seenGroups.has(group)) {
      seenGroups.add(group);
      groupOrder.push(group);
    }
  }
  for (const measurement of projectedMeasurements) {
    if (!seenGroups.has(measurement.variantId)) {
      seenGroups.add(measurement.variantId);
      groupOrder.push(measurement.variantId);
    }
  }
  const projectedVariants = groupOrder.map(group => {
    const contributors = variantsByGroup.get(group) ?? [];
    const first = contributors[0];
    return {
      ...(first ?? {}),
      metadata: (first as (V & { metadata?: object }) | undefined)?.metadata ?? {},
      variantId: group,
      label: group,
      aiGenerated: contributors.some(variant => Boolean(variant.aiGenerated)),
      verAaiGenerated: contributors.some(variant => Boolean(variant.verAaiGenerated)),
      verBaiGenerated: contributors.some(variant => Boolean(variant.verBaiGenerated)),
    } as V;
  });

  return { variants: projectedVariants, measurements: projectedMeasurements };
}
