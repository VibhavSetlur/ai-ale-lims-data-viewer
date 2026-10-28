export type CoordinateSystem = 'original' | 'ncbi' | 'neidle';
export type CoordinateCapability = { system: CoordinateSystem; available: boolean; positionColumn?: string };

export function resolveReplicate(stored: string | number | null | undefined, parsed: string | undefined): string | undefined {
  const value = stored === null || stored === undefined ? '' : String(stored).trim();
  return value || parsed;
}

/** Only advertise a coordinate system when an actual schema column exists. */
export function coordinateCapabilities(columns: Iterable<string>): CoordinateCapability[] {
  const present = new Set(columns);
  const first = (candidates: string[]) => candidates.find(column => present.has(column));
  return [
    { system: 'original', available: true, positionColumn: first(['position', 'position_start']) },
    { system: 'ncbi', available: Boolean(first(['ncbi_position', 'NCBI_position', 'position_ncbi'])), positionColumn: first(['ncbi_position', 'NCBI_position', 'position_ncbi']) },
    { system: 'neidle', available: Boolean(first(['neidle_position', 'Neidle_position', 'position_neidle'])), positionColumn: first(['neidle_position', 'Neidle_position', 'position_neidle']) },
  ];
}
