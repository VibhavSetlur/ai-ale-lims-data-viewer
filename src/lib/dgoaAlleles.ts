export type DgoAGroupMode = 'aa' | 'dna';
export type DgoAMeasurement = { sampleId: string; alleleDnaIndex: string; alleleAaIndex: string; count: number; measurementId?: string; seqorder?: string; transformationLibrary?: string };
export type DgoAVariant = { id: string; dnaId: string; aaId: string; dnaLabel: string; aaLabel: string; dnaSequence?: string; aaSequence?: string };

/** Group first, then rank. Relative abundance is always calculated from all groups. */
export function groupDgoA(variants: readonly DgoAVariant[], measurements: readonly DgoAMeasurement[], mode: DgoAGroupMode) {
  const byDna = new Map(variants.map(v => [v.dnaId, v]));
  const groups = new Map<string, { id: string; label: string; count: number; sequence?: string; samples: Map<string, number> }>();
  for (const m of measurements) {
    const v = byDna.get(m.alleleDnaIndex); if (!v || !Number.isFinite(m.count) || m.count <= 0) continue;
    const id = mode === 'aa' ? v.aaId : v.dnaId;
    const label = mode === 'aa' ? v.aaLabel : v.dnaLabel;
    const sequence = mode === 'aa' ? v.aaSequence : v.dnaSequence;
    const group = groups.get(id) ?? { id, label, count: 0, sequence, samples: new Map() };
    group.count += m.count; group.samples.set(m.sampleId, (group.samples.get(m.sampleId) ?? 0) + m.count); groups.set(id, group);
  }
  const total = [...groups.values()].reduce((n, g) => n + g.count, 0);
  return [...groups.values()].map(g => ({ ...g, relative: total ? g.count / total : 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { numeric: true }));
}
