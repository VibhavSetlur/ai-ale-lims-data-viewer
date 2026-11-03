import { describe, expect, it } from 'vitest';
import { effectiveMutationExperiment, mutationExperimentScopeSql } from './mutationExperiment';

describe('mutation experiment policy', () => {
  it('prefers a populated mutation label over conflicting sequence metadata', () => {
    expect(effectiveMutationExperiment('strain_stocks', 'legacy_sequence_label')).toBe('strain_stocks');
  });

  it('falls back when the mutation label is missing or blank', () => {
    expect(effectiveMutationExperiment(null, 'sequence_label')).toBe('sequence_label');
    expect(effectiveMutationExperiment('   ', 'sequence_label')).toBe('sequence_label');
  });

  it('retains an authoritative label without sequence metadata', () => {
    expect(effectiveMutationExperiment('strain_stocks', null)).toBe('strain_stocks');
  });

  it('uses the same trim-aware blank policy in SQL filtering', () => {
    const predicate = mutationExperimentScopeSql('m."Experiment"', 'm."Seq_sample"');
    expect(predicate).toContain("NULLIF(TRIM(m.\"Experiment\"), '')");
    expect(predicate).toContain('ss_scope.deleted = 0');
    expect(predicate).toContain('TRIM(ss_scope."Experiment") = ?');
  });
});
