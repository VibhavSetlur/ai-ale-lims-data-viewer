/**
 * Mutations.Experiment is the authoritative label when it contains a value.
 * Older calls with a blank or missing label retain live Seq_samples metadata as
 * their fallback. Keep SQL filtering and API output on the same normalization.
 */
export function effectiveMutationExperiment(
  mutationExperiment: string | null | undefined,
  seqSampleExperiment: string | null | undefined,
): string {
  const normalizedMutation = mutationExperiment?.trim();
  if (normalizedMutation) return normalizedMutation;
  return seqSampleExperiment?.trim() ?? '';
}

/**
 * SQL predicate for the authoritative mutation experiment policy. `?` values
 * must be supplied as [experiment, experiment] in that order.
 */
export function mutationExperimentScopeSql(mutationExperiment: string, seqSample: string): string {
  const normalizedMutation = `NULLIF(TRIM(${mutationExperiment}), '')`;
  return `(
    (${normalizedMutation} IS NOT NULL AND ${normalizedMutation} = ?)
    OR (
      ${normalizedMutation} IS NULL
      AND EXISTS (
        SELECT 1 FROM Seq_samples ss_scope
        WHERE ss_scope."Sequencing_sample" = ${seqSample}
          AND ss_scope.deleted = 0
          AND TRIM(ss_scope."Experiment") = ?
      )
    )
  )`;
}
