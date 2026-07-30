export type MutationInput = { sampleKey: string; gene: string | null; position: number | null; frequency: number | null; type: string | null };
export function deriveMutationComparison(input: MutationInput[]) {
  const grouped = new Map<string, { gene: string | null; position: number | null; type: string | null; values: Record<string, number> }>();
  for (const item of input) {
    const key = `${item.gene ?? "unknown"}\u0000${item.position ?? ""}\u0000${item.type ?? ""}`;
    const current = grouped.get(key) ?? { gene: item.gene, position: item.position, type: item.type, values: {} };
    if (item.frequency !== null) current.values[item.sampleKey] = Math.max(current.values[item.sampleKey] ?? -Infinity, item.frequency);
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((a, b) => `${a.gene}:${a.position}`.localeCompare(`${b.gene}:${b.position}`));
}
export function deriveGrowthComparison(input: { sampleKey: string; transfer: number; od: number; timepoint: number | null }[]) {
  const grouped = new Map<string, { sampleKey: string; transfer: number; endpointOd: number; endpointTimepoint: number; maxOd: number }>();
  for (const item of input) {
    const key = `${item.sampleKey}\u0000${item.transfer}`; const prior = grouped.get(key); const timepoint = item.timepoint ?? -Infinity;
    if (!prior) grouped.set(key, { sampleKey: item.sampleKey, transfer: item.transfer, endpointOd: item.od, endpointTimepoint: timepoint, maxOd: item.od });
    else { prior.maxOd = Math.max(prior.maxOd, item.od); if (timepoint >= prior.endpointTimepoint) { prior.endpointOd = item.od; prior.endpointTimepoint = timepoint; } }
  }
  return [...grouped.values()].map(({ endpointTimepoint: _, ...row }) => row).sort((a, b) => a.sampleKey.localeCompare(b.sampleKey) || a.transfer - b.transfer);
}
export function deriveCopyNumberComparison(input: { sampleKey: string; region: string; value: number }[]) { return input.sort((a, b) => a.region.localeCompare(b.region) || a.sampleKey.localeCompare(b.sampleKey)); }
export function deriveLibraryVariants(input: { sampleKey: string; variant: string; count: number }[]) {
  const totals = new Map<string, number>(); for (const item of input) totals.set(item.sampleKey, (totals.get(item.sampleKey) ?? 0) + item.count);
  return input.map((item) => ({ ...item, abundance: item.count / (totals.get(item.sampleKey) || 1) }));
}
