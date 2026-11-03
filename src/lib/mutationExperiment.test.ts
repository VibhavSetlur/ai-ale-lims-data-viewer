import Database from 'better-sqlite3';
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

  it('normalizes whitespace on the selected label', () => {
    expect(effectiveMutationExperiment('  strain_stocks  ', 'legacy_sequence_label')).toBe('strain_stocks');
    expect(effectiveMutationExperiment('   ', '  sequence_label  ')).toBe('sequence_label');
  });

  it('applies the authoritative, blank fallback, and live metadata rules when SQL executes', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE Mutations ("Seq_sample" TEXT, "Experiment" TEXT, deleted INTEGER);
      CREATE TABLE Seq_samples ("Sequencing_sample" TEXT, "Experiment" TEXT, deleted INTEGER);
      INSERT INTO Mutations VALUES
        ('authoritative', 'target', 0),
        ('conflicting-sequence', 'target', 0),
        ('blank-live', '   ', 0),
        ('missing-live', NULL, 0),
        ('blank-deleted', '', 0),
        ('other', 'other', 0);
      INSERT INTO Seq_samples VALUES
        ('conflicting-sequence', 'legacy', 0),
        ('blank-live', ' target ', 0),
        ('missing-live', 'target', 0),
        ('blank-deleted', 'target', 1);
    `);

    const predicate = mutationExperimentScopeSql('m."Experiment"', 'm."Seq_sample"');
    const rows = db.prepare(`
      SELECT m."Seq_sample" AS seqSample
      FROM Mutations m
      WHERE m.deleted = 0 AND ${predicate}
      ORDER BY seqSample
    `).all('target', 'target') as { seqSample: string }[];

    expect(rows.map(row => row.seqSample)).toEqual([
      'authoritative',
      'blank-live',
      'conflicting-sequence',
      'missing-live',
    ]);
    db.close();
  });
});
