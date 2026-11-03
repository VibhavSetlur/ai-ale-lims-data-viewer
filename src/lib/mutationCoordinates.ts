import type { CoordinateSystem } from './mutationMetadata';

export type MutationCoordinate = {
  position?: number;
  positionStart?: number;
  positionEnd?: number;
  gene?: string;
};

export type MutationCoordinates = Partial<Record<CoordinateSystem, MutationCoordinate>>;

export type DisplayCoordinate = MutationCoordinate & {
  system: CoordinateSystem;
  available: boolean;
};

/**
 * Select only the requested coordinate mapping. In particular, do not fall back
 * to the original reference when a mapped coordinate is absent for a row.
 */
export function resolveDisplayCoordinate(
  coordinates: MutationCoordinates | undefined,
  system: CoordinateSystem,
  available: boolean,
): DisplayCoordinate {
  if (!available) return { system, available: false };
  return { system, available: true, ...(coordinates?.[system] ?? {}) };
}

export function formatCoordinate(coordinate: DisplayCoordinate): string {
  const start = coordinate.positionStart ?? coordinate.position;
  const end = coordinate.positionEnd ?? start;
  if (start === undefined) return 'n/a';
  if (end === undefined || start === end) return start.toLocaleString();
  return `${start.toLocaleString()} to ${end.toLocaleString()}`;
}
