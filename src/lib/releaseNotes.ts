export interface ReleaseNote {
  readonly version: string;
  readonly date: string;
  readonly summary: string;
}

export const releaseNotes: readonly ReleaseNote[] = [
  {
    version: '1.2.2',
    date: '2026-07-08',
    summary: 'Improved Compare Library Variants with responsive bars, heatmap, and lines, interactive hover and legend isolation, stable per-variant colors, priority sample sorting, CSV and figure export, richer metadata, and AI-generated marking.',
  },
  {
    version: '1.2.1',
    date: '2026-07-08',
    summary: 'Added Compare Library Variants for selected-sample verAB abundance views and renamed the mutation comparison tab to Compare Mutations.',
  },
  {
    version: '1.0.0',
    date: '2026-07-07',
    summary: 'Initial viewer release tracking for deploy metadata, mutation stats, and barcode visibility.',
  },
];
