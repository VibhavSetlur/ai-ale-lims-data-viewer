/** Candidate-only artifact contracts. No runtime database connection belongs in this module. */
export type DifferenceClass = 'blocking' | 'review' | 'accepted';
export type CandidateManifest = Readonly<{
  version: 1;
  kind: 'viewer2-scientific-inspection';
  sourceChecksum: string;
  manifestDigest: string;
  capabilities: Readonly<{ hasBarcodes: boolean; tables: readonly string[] }>;
}>;
export type CandidateProvenance = Readonly<{
  version: 1;
  kind: 'viewer2-scientific-candidate';
  candidate: string;
  sourceChecksum: string;
  manifestDigest: string;
  provenanceDigest: string;
  rejectionCount: number;
}>;
export type ReconciliationReport = Readonly<{
  version: 1;
  kind: 'viewer2-scientific-reconciliation';
  candidate: string;
  reportDigest: string;
  blockingCount: number;
  differences: readonly Readonly<{ class: DifferenceClass; area: string }> [];
}>;

/** A live URL is intentionally not accepted by this boundary. */
export function isExplicitTestMysqlUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'mysql:'
      && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
      && /^\/viewer2_test_[A-Za-z0-9_]+$/.test(url.pathname)
      && url.searchParams.get('test_only') === '1';
  } catch { return false; }
}
