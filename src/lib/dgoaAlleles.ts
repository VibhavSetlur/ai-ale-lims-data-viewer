/**
 * dgoA allele composition and equal-length alignment model.
 *
 * The display unit is one (Seqsample, Seqorder) pair because no sample/seqorder
 * combination spans more than one Transformation_library in the current mirror.
 * Everything here is pure so the chart, the legend, and the alignment panel all
 * derive from the same numbers.
 */

export type DgoAGroupMode = 'aa' | 'dna';
export type DgoAAlignmentView = 'aa' | 'dna';

export interface DgoAMeasurement {
  sampleId: string;
  alleleDnaIndex: string;
  alleleAaIndex: string;
  count: number;
  measurementId?: string;
  seqorder?: string;
  transformationLibrary?: string;
}

export interface DgoAVariant {
  id: string;
  dnaId: string;
  aaId: string;
  dnaLabel: string;
  aaLabel: string;
  dnaSequence?: string;
  aaSequence?: string;
}

export interface DgoACompositionSegment {
  groupId: string;
  count: number;
  relative: number;
}

export interface DgoACompositionSample {
  /** Stable sample column key: `${sampleId}\u0000${seqorder}`. */
  id: string;
  sampleId: string;
  seqorder: string;
  /** Sum of every counted measurement for this sample, before Top-N folding. */
  total: number;
  /** Number of real groups kept for this sample (excludes the Other fold). */
  keptGroupCount: number;
  /** Kept groups in shared group order, then the Other segment when folding occurred. */
  segments: DgoACompositionSegment[];
}

export interface DgoACompositionGroup {
  id: string;
  label: string;
  /** Count summed across the selected samples that kept this group. */
  total: number;
  sequences: { dna?: string; aa?: string };
  isOther: boolean;
}

export interface DgoAComposition {
  mode: DgoAGroupMode;
  /** 0 means All. */
  topN: number;
  samples: DgoACompositionSample[];
  /** Union of kept groups ordered by total desc then label asc, with Other last. */
  groups: DgoACompositionGroup[];
}

export interface DgoAAlignmentRow {
  /** Group id from the composition mode. */
  id: string;
  label: string;
  sequence: string;
}

export interface DgoAAlignment {
  view: DgoAAlignmentView;
  mode: DgoAGroupMode;
  rows: DgoAAlignmentRow[];
  /** Common window length after clamping to the shortest row. */
  length: number;
  /** True when the displayed sequence type differs from the grouping mode. */
  substituted: boolean;
  warnings: string[];
}

export const OTHER_GROUP_ID = '__other__';
export const OTHER_GROUP_LABEL = 'Other';

const NUL = '\u0000';

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function groupIdentity(variant: DgoAVariant, mode: DgoAGroupMode): { id: string; label: string } {
  return mode === 'aa'
    ? { id: variant.aaId, label: variant.aaLabel || variant.aaId }
    : { id: variant.dnaId, label: variant.dnaLabel || variant.dnaId };
}

function sampleKey(measurement: DgoAMeasurement): string {
  return `${measurement.sampleId}${NUL}${measurement.seqorder ?? ''}`;
}

/** Aggregate counts by sample and by allele group, then apply Top-N per sample. */
export function dgoaComposition(
  variants: readonly DgoAVariant[],
  measurements: readonly DgoAMeasurement[],
  mode: DgoAGroupMode,
  topN: number,
): DgoAComposition {
  const byDnaId = new Map(variants.map(variant => [variant.dnaId, variant]));
  const labels = new Map<string, string>();
  const sequences = new Map<string, { dna?: string; aa?: string }>();

  interface MutableSample {
    id: string;
    sampleId: string;
    seqorder: string;
    total: number;
    counts: Map<string, number>;
  }
  const samples = new Map<string, MutableSample>();
  const totals = new Map<string, number>();

  for (const measurement of measurements) {
    const variant = byDnaId.get(measurement.alleleDnaIndex);
    const count = Number(measurement.count);
    if (!variant || !Number.isFinite(count) || count <= 0) continue;
    const identity = groupIdentity(variant, mode);
    const key = sampleKey(measurement);
    let sample = samples.get(key);
    if (!sample) {
      sample = { id: key, sampleId: measurement.sampleId, seqorder: measurement.seqorder ?? '', total: 0, counts: new Map() };
      samples.set(key, sample);
    }
    sample.total += count;
    sample.counts.set(identity.id, (sample.counts.get(identity.id) ?? 0) + count);
    totals.set(identity.id, (totals.get(identity.id) ?? 0) + count);
    labels.set(identity.id, identity.label);
    const existing = sequences.get(identity.id) ?? {};
    if (mode === 'aa') {
      if (!existing.aa && variant.aaSequence) existing.aa = variant.aaSequence;
    } else if (!existing.dna && variant.dnaSequence) {
      existing.dna = variant.dnaSequence;
    }
    sequences.set(identity.id, existing);
  }

  const orderedSamples = [...samples.values()].sort(
    (a, b) => compareText(a.sampleId, b.sampleId) || compareText(a.seqorder, b.seqorder),
  );

  const keep = Math.max(0, Math.floor(topN));
  const keptIds = new Set<string>();
  const keptTotals = new Map<string, number>();
  const folded = new Map<string, { count: number; kept: number }>();
  const keptPerSample = new Map<string, Array<{ id: string; count: number }>>();

  for (const sample of orderedSamples) {
    const ranked = [...sample.counts.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count || compareText(labels.get(a.id) ?? a.id, labels.get(b.id) ?? b.id));
    const kept = keep <= 0 ? ranked : ranked.slice(0, keep);
    const rest = keep <= 0 ? [] : ranked.slice(keep);
    for (const entry of kept) {
      keptIds.add(entry.id);
      keptTotals.set(entry.id, (keptTotals.get(entry.id) ?? 0) + entry.count);
    }
    folded.set(sample.id, { count: rest.reduce((sum, entry) => sum + entry.count, 0), kept: kept.length });
    keptPerSample.set(sample.id, kept);
  }

  const orderedGroups: DgoACompositionGroup[] = [...keptIds]
    .map(id => ({
      id,
      label: labels.get(id) ?? id,
      total: keptTotals.get(id) ?? 0,
      sequences: sequences.get(id) ?? {},
      isOther: false,
    }))
    .sort((a, b) => b.total - a.total || compareText(a.label, b.label));

  const otherTotal = [...folded.values()].reduce((sum, entry) => sum + entry.count, 0);
  const hasOther = otherTotal > 0;

  const compositionSamples: DgoACompositionSample[] = orderedSamples.map(sample => {
    const kept = keptPerSample.get(sample.id) ?? [];
    const keepSet = new Set(kept.map(entry => entry.id));
    const segments: DgoACompositionSegment[] = [];
    for (const group of orderedGroups) {
      if (!keepSet.has(group.id)) continue;
      const count = sample.counts.get(group.id) ?? 0;
      if (count <= 0) continue;
      segments.push({ groupId: group.id, count, relative: sample.total > 0 ? count / sample.total : 0 });
    }
    const other = folded.get(sample.id)?.count ?? 0;
    if (other > 0) {
      segments.push({ groupId: OTHER_GROUP_ID, count: other, relative: sample.total > 0 ? other / sample.total : 0 });
    }
    return {
      id: sample.id,
      sampleId: sample.sampleId,
      seqorder: sample.seqorder,
      total: sample.total,
      keptGroupCount: kept.length,
      segments,
    };
  });

  return {
    mode,
    topN: keep,
    samples: compositionSamples,
    groups: hasOther
      ? [...orderedGroups, { id: OTHER_GROUP_ID, label: OTHER_GROUP_LABEL, total: otherTotal, sequences: {}, isOther: true }]
      : orderedGroups,
  };
}

/**
 * Resolve isolated groups to one equal-length sequence row each.
 *
 * An isolated id is a group from `mode`. When the requested sequence view differs
 * from that group's own sequence type, the row falls back to the group's most
 * abundant DNA member and reports `substituted`.
 */
export function dgoaAlignment(
  variants: readonly DgoAVariant[],
  measurements: readonly DgoAMeasurement[],
  mode: DgoAGroupMode,
  isolatedIds: ReadonlySet<string>,
  selectedSampleIds: ReadonlySet<string>,
  view: DgoAAlignmentView,
): DgoAAlignment {
  const warnings: string[] = [];
  const byDnaId = new Map(variants.map(variant => [variant.dnaId, variant]));
  const filterSamples = selectedSampleIds.size > 0;

  interface GroupAccumulator {
    label: string;
    total: number;
    perDna: Map<string, number>;
  }
  const groups = new Map<string, GroupAccumulator>();

  for (const measurement of measurements) {
    if (filterSamples && !selectedSampleIds.has(measurement.sampleId)) continue;
    const variant = byDnaId.get(measurement.alleleDnaIndex);
    const count = Number(measurement.count);
    if (!variant || !Number.isFinite(count) || count <= 0) continue;
    const identity = groupIdentity(variant, mode);
    if (!isolatedIds.has(identity.id)) continue;
    let accumulator = groups.get(identity.id);
    if (!accumulator) {
      accumulator = { label: identity.label, total: 0, perDna: new Map() };
      groups.set(identity.id, accumulator);
    }
    accumulator.total += count;
    accumulator.perDna.set(variant.dnaId, (accumulator.perDna.get(variant.dnaId) ?? 0) + count);
    if (!accumulator.label) accumulator.label = identity.label;
  }

  if (isolatedIds.size > 0 && groups.size < isolatedIds.size) {
    warnings.push(`${isolatedIds.size - groups.size} isolated group(s) are absent from the selected samples.`);
  }

  const ordered = [...groups.entries()].sort(
    (a, b) => b[1].total - a[1].total || compareText(a[1].label, b[1].label),
  );

  const rows: DgoAAlignmentRow[] = [];
  for (const [id, accumulator] of ordered) {
    const representative = [...accumulator.perDna.entries()]
      .sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))[0]?.[0];
    const variant = representative ? byDnaId.get(representative) : undefined;
    const sequence = view === 'aa' ? variant?.aaSequence : variant?.dnaSequence;
    if (!sequence) {
      warnings.push(`No ${view === 'aa' ? 'amino acid' : 'DNA'} sequence is available for ${accumulator.label}.`);
      continue;
    }
    rows.push({ id, label: accumulator.label, sequence });
  }

  const lengths = new Set(rows.map(row => row.sequence.length));
  let length = rows.length > 0 ? Math.min(...rows.map(row => row.sequence.length)) : 0;
  if (lengths.size > 1) {
    warnings.push(
      `Selected sequences differ in length (${[...lengths].sort((a, b) => a - b).join(', ')}); the viewer clamps to ${length}.`,
    );
  }
  if (length <= 0) length = 0;

  return { view, mode, rows, length, substituted: mode !== view, warnings };
}
