import { describe, expect, it } from 'vitest';
import { formatCoordinate, resolveDisplayCoordinate } from './mutationCoordinates';
import { DEFAULT_COORDINATE_SYSTEM } from './mutationMetadata';

const coordinates = {
  original: { position: 101, positionStart: 101, positionEnd: 104, gene: 'originalGene' },
  ncbi: { position: 501, positionStart: 501, positionEnd: 501, gene: 'ncbiGene' },
  neidle: { position: 901, positionStart: 901, positionEnd: 901, gene: 'neidleGene' },
};

describe('mutation coordinate display', () => {
  it('defaults to NCBI and changes the rendered coordinate and gene when available', () => {
    expect(DEFAULT_COORDINATE_SYSTEM).toBe('ncbi');
    const ncbi = resolveDisplayCoordinate(coordinates, DEFAULT_COORDINATE_SYSTEM, true);
    const neidle = resolveDisplayCoordinate(coordinates, 'neidle', true);
    expect({ gene: ncbi.gene, position: formatCoordinate(ncbi) }).toEqual({ gene: 'ncbiGene', position: '501' });
    expect({ gene: neidle.gene, position: formatCoordinate(neidle) }).toEqual({ gene: 'neidleGene', position: '901' });
  });

  it('does not substitute original coordinates when the selected mapping is unavailable or absent on a row', () => {
    const unavailable = resolveDisplayCoordinate(coordinates, 'ncbi', false);
    const missingRowMapping = resolveDisplayCoordinate({ original: coordinates.original }, 'ncbi', true);
    expect({ gene: unavailable.gene, position: formatCoordinate(unavailable) }).toEqual({ gene: undefined, position: 'n/a' });
    expect({ gene: missingRowMapping.gene, position: formatCoordinate(missingRowMapping) }).toEqual({ gene: undefined, position: 'n/a' });
  });
});
