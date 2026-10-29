export type CoordinateSystem = 'original' | 'ncbi' | 'neidle';
export const DEFAULT_COORDINATE_SYSTEM: CoordinateSystem = 'ncbi';
export type CoordinateCapability = { system: CoordinateSystem; available: boolean; positionColumn?: string; geneColumn?: string };

export function resolveReplicate(stored: string | number | null | undefined, parsed: string | undefined): string | undefined {
  const value = stored === null || stored === undefined ? '' : String(stored).trim();
  return value || parsed;
}

/** Only advertise a coordinate system when an actual schema column exists. */
export function coordinateCapabilities(columns: Iterable<string>): CoordinateCapability[] {
  const present = new Set(columns);
  const first = (candidates: string[]) => candidates.find(column => present.has(column));
  const mapped = (system: CoordinateSystem, positionCandidates: string[], geneCandidates: string[]): CoordinateCapability => {
    const positionColumn = first(positionCandidates);
    return { system, available: Boolean(positionColumn), positionColumn, geneColumn: first(geneCandidates) };
  };
  return [
    { system: 'original', available: true, positionColumn: first(['position', 'position_start']), geneColumn: first(['gene_name', 'gene_name_curated']) },
    mapped('ncbi', ['ncbi_position', 'NCBI_position', 'position_ncbi'], ['ncbi_gene_name', 'NCBI_gene_name', 'gene_name_ncbi']),
    mapped('neidle', ['neidle_position', 'Neidle_position', 'position_neidle'], ['neidle_gene_name', 'Neidle_gene_name', 'gene_name_neidle']),
  ];
}
