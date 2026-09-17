import { describe, expect, it } from 'vitest';
import {
  MAX_ARTIFACT_BYTES,
  MAX_SESSION_ARTIFACT_BYTES,
  createResearchArtifact,
  escapeCsvCell,
  serializeResearchArtifact,
  validateLocalArtifactInput,
} from './researchArtifacts';

describe('validateLocalArtifactInput', () => {
  it('accepts supported local text inputs within the stricter existing 2 MiB limit', () => {
    expect(validateLocalArtifactInput({ name: 'results.csv', type: 'text/csv', size: MAX_ARTIFACT_BYTES }, 0)).toBeNull();
  });

  it('rejects unsupported files, oversize files, and aggregate overflow', () => {
    expect(validateLocalArtifactInput({ name: 'results.xlsx', type: 'application/vnd.ms-excel', size: 1 }, 0)).toMatch(/CSV/);
    expect(validateLocalArtifactInput({ name: 'results.json', type: 'application/json', size: MAX_ARTIFACT_BYTES + 1 }, 0)).toMatch(/2 MiB/);
    expect(validateLocalArtifactInput({ name: 'results.txt', type: 'text/plain', size: 1 }, MAX_SESSION_ARTIFACT_BYTES)).toMatch(/50 MiB/);
  });
});

describe('research artifact serialization', () => {
  const artifact = createResearchArtifact(
    [{ role: 'assistant', content: '=dangerous formula', createdAt: '2026-09-17T00:00:00.000Z' }],
    [{ name: 'source.csv', type: 'text/csv', size: 12, text: 'a,b' }],
    '2026-09-17T00:00:00.000Z',
  );

  it('records session-only lifecycle and local input provenance', () => {
    expect(artifact.lifecycle).toMatch(/nothing is uploaded/);
    expect(artifact.provenance.inputs).toEqual([{ name: 'source.csv', type: 'text/csv', size: 12 }]);
  });

  it('supports transparent JSON, Markdown, and CSV downloads', () => {
    expect(JSON.parse(serializeResearchArtifact(artifact, 'json').text)).toMatchObject({ provenance: { inputs: [{ name: 'source.csv' }] } });
    expect(serializeResearchArtifact(artifact, 'markdown').text).toContain('## Lifecycle');
    expect(serializeResearchArtifact(artifact, 'csv').text).toContain("'=dangerous formula");
  });

  it('protects CSV formula cells and escapes quotes', () => {
    expect(escapeCsvCell('+SUM(A1)')).toBe("\"'+SUM(A1)\"");
    expect(escapeCsvCell('\t=SUM(A1)')).toBe("\"'\t=SUM(A1)\"");
    expect(escapeCsvCell('  @cmd')).toBe('"\'  @cmd"');
    expect(escapeCsvCell('said "yes"')).toBe('"said ""yes"""');
  });
});
