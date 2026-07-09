export interface ReleaseNote {
  readonly version: string;
  readonly date: string;
  readonly summary: string;
}

export const releaseNotes: readonly ReleaseNote[] = [
  {
    version: '1.4.0',
    date: '2026-07-09',
    summary: 'Rebuilt Compare Growth Curves around a faceted OD-vs-transfer figure. Small multiples are faceted by genotype (Transforming_DNA), each panel holds up to five replicate lines colored by replicate number, X is the ALE transfer and Y is OD on a log scale by default. Endpoint OD is read directly from Robotic_OD so all lineages appear, including those with no sequenced sample. Added an endpoint vs max OD toggle, log or linear Y, shared or per-panel axes, a selected-samples reflow, a full-figure mode that plots every lineage, cross-view buttons into Compare Mutations, Library Variants, and Barcode Charts for sequenced lineages, and CSV plus figure export. The original within-transfer overlay is kept as a secondary mode.',
  },
  {
    version: '1.3.1',
    date: '2026-07-09',
    summary: 'Updated Compare Library Variants so vertical bars and heatmap match Barcode Charts styling, added grouped experimental-factor headers that follow the sample sort priority, marked AI-generated status on the specific verA or verB partner, and removed lines and horizontal modes from this view.',
  },
  {
    version: '1.3.0',
    date: '2026-07-08',
    summary: 'Added Compare Growth Curves with overlay and facet views, log and linear Y scale, sortable priority factors, interactive legend isolation, CSV export, and figure export. Improved Compare Library Variants readability with cleaner verA and verB labels, variant sorting, heatmap scale controls, summary stats, metadata scanability, and stronger cross-highlighting.',
  },
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
