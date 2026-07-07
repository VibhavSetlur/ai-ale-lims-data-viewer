export interface ReleaseNote {
  readonly version: string;
  readonly date: string;
  readonly summary: string;
}

export const releaseNotes: readonly ReleaseNote[] = [
  {
    version: '1.0.0',
    date: '2026-07-07',
    summary: 'Initial viewer release tracking for deploy metadata, mutation stats, and barcode visibility.',
  },
];
