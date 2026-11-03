import { describe, expect, it } from 'vitest';
import { coordinateCapabilities, resolveReplicate } from './mutationMetadata';

describe('mutation metadata', () => {
  it('prefers nonblank stored replicate metadata and falls back for blank or absent values', () => {
    expect(resolveReplicate('B', '2')).toBe('B');
    expect(resolveReplicate(3, 'A')).toBe('3');
    expect(resolveReplicate('  ', 'A')).toBe('A');
    expect(resolveReplicate(undefined, '2')).toBe('2');
  });
  it('reports coordinate capability only for columns that exist', () => {
    expect(coordinateCapabilities(['position'])).toEqual([
      { system: 'original', available: true, positionColumn: 'position', geneColumn: undefined },
      { system: 'ncbi', available: false, positionColumn: undefined, geneColumn: undefined },
      { system: 'neidle', available: false, positionColumn: undefined, geneColumn: undefined },
    ]);
    expect(coordinateCapabilities(['position', 'ncbi_position', 'NCBI_gene_name', 'position_neidle'])).toEqual([
      { system: 'original', available: true, positionColumn: 'position', geneColumn: undefined },
      { system: 'ncbi', available: true, positionColumn: 'ncbi_position', geneColumn: 'NCBI_gene_name' },
      { system: 'neidle', available: true, positionColumn: 'position_neidle', geneColumn: undefined },
    ]);
  });
});
