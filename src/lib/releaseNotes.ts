export interface ReleaseNote {
  readonly version: string;
  readonly date: string;
  readonly summary: string;
}

export const releaseNotes: readonly ReleaseNote[] = [
  { version: '1.13.0', date: '2026-08-28', summary: 'Compare Library Variants can now group by VerA only or VerB only, alongside the existing Combined A-B view which stays the default. Use the Group by control in the toolbar to collapse candidates onto a single barcode half, so you can see how one verA partner performs across every verB it was paired with, and the reverse. Filters, sample selection, sorting, metric choice, charts, heatmap, tooltips and CSV export all follow the mode you pick. The A_UNK and B_UNK unknown-barcode labels are kept as their own groups instead of being merged into a real barcode.' },
  { version: '1.12.3', date: '2026-08-26', summary: 'Plate Design fixes: every registered strain, medium, and transforming DNA in the LIMS registries is now offered when you build a condition, and each factor field has a browsable searchable picker instead of a native dropdown that only showed a handful of entries. The condition list scrolls with the Add condition and Continue to plates buttons always visible, every condition gets its own color beyond the first ten, the step 3 palette now shows transforming DNA, and saving a duplicate or incomplete condition now explains exactly what is wrong.' },
  { version: '1.12.2', date: '2026-08-26', summary: 'Static builds now bake every experiment the viewer offers, so each one loads instead of reporting a missing dataset, and baked data files are versioned by content so a returning browser always sees the current snapshot.' },
  { version: '1.12.1', date: '2026-08-26', summary: 'The Plate Design workspace now suggests registered experiments, strains, media, and donor DNA even before sequencing data exists for them.' },
  { version: '1.12.0', date: '2026-07-28', summary: 'Plate Design is now a top-level browser-local workspace with independent read-only snapshot suggestions, a responsive accessible multi-plate workflow up to 24 fixed 96-well plates, and JSON or CSV hand-off. It does not write to LIMS.' },
  {
    version: '1.11.0',
    date: '2026-07-27',
    summary: 'Added Plate Design Workspace in Mutation Explorer. Build one or two local 96-well plate layouts, save browser-only snapshots, import or export JSON, and download pipeline layout CSV files. The workspace does not create LIMS runs, plates, conditions, or samples.',
  },
  {
    version: '1.10.2',
    date: '2026-07-24',
    summary: 'Copy number region labels improved: DEL_6kb_ACN3560, Kanamycin, verAB, ver cassette, and dgoA-Star now show human-readable names in the Compare Mutations heatmap instead of raw region keys.',
  },
  {
    version: '1.10.1',
    date: '2026-07-23',
    summary: 'Mutation Explorer Sample Selection now shows all sequencing run identifiers per sample. Samples with both mutation and barcode data now appear under every sequencing run they belong to in the seqorder filter.',
  },
  {
    version: '1.10.0',
    date: '2026-07-23',
    summary: 'Compare Library Variants: abundance calculation control now appears before the top variants selector. Default top variants selection changed to All. Added explanation of how top variants are ranked under each metric mode.',
  },
  {
    version: '1.9.0',
    date: '2026-07-21',
    summary: 'Added a verAB combos column to the Sample Selection table that shows how many distinct verA-verB combinations were detected for each sample. The column appears only on deployments that include barcode data, and samples without barcode data show a dash.',
  },
  {
    version: '1.8.0',
    date: '2026-07-21',
    summary: 'Added a Question issue form so you can ask about the viewer, the data, or how something works, separate from bug reports and feature requests.',
  },
  {
    version: '1.7.1',
    date: '2026-07-21',
    summary: 'Fixed relative abundance bar charts that could total more than 100 percent when All variants were selected; stacked heights are now budget clamped so a sample never exceeds the 100 percent line, and the exported figures match. Fixed duplicate barcode measurements across seqorders being dropped; per-sample abundances and pairing-table percentages now use complete counts. Fixed grouped sample headers not lining up with the vertical bars when many samples are selected; headers and bars now share one layout so they stay aligned at any sample count.',
  },
  {
    version: '1.7.0',
    date: '2026-07-21',
    summary: 'Added a "Report an issue" link in the sidebar that opens guided GitHub issue forms for bug reports and feature requests. Added structured issue forms so feedback captures the deployment, tab, and details. Removed the private deployment channel; the viewer now documents only the Dev and Public deployments plus Server mode.',
  },
  {
    version: '1.6.3',
    date: '2026-07-14',
    summary: 'Fixed pairing-table hover percentages and export values that could exceed 100% when multiple samples or transfers were selected. The VerA / VerB partner pairing table now reports mean per-sample abundance instead of the summed per-sample fraction, so hover percentages stay interpretable. Each tooltip also shows total reads across all selected samples and the count of samples where the variant is present, giving users the full context behind the mean value. Export images and CSV reflect the same mean-based figures.',
  },
  {
    version: '1.6.2',
    date: '2026-07-14',
    summary: 'Improved figure export for publication workflows. Export buttons now offer PNG and SVG from the preview modal, width and height fields can be cleared and retyped without snapping to the minimum, and theme presets make it easier to switch between journal, minimal, presentation, dark, and colorblind-safe styling. Library-variant bar exports now reserve dynamic space for rotated sample labels so axis text and titles do not collide. Barcode Charts now keep seqorder as part of chart identity, labels, search, CSV export, and API summaries so same-named samples from different sequencing orders display together instead of being merged.',
  },
  {
    version: '1.6.1',
    date: '2026-07-13',
    summary: 'Fixed the figure export preview and PNG download in Compare Library Variants. The preview was blank and PNG export failed because the generated SVG did not decode: variant colors used space-separated hsl() and the font stack carried embedded quotes. Colors are now normalized to hex and the font names are quote-free, so the live preview renders, stays editable while you adjust the title, size, and labels, and PNG download works for both the vertical bars and the heatmap. The preview also shows a clear message if it ever fails to render.',
  },
  {
    version: '1.6.0',
    date: '2026-07-13',
    summary: 'Added a PNG-only figure export preview workflow. Export buttons now open a modal with editable title, subtitle, axis titles, legend title, size, cell size, color, legend, values, and caption controls before downloading PNG. Major export callsites now use dedicated data-rendered figure specs instead of screenshotting the HTML table or on-screen chart, including VerA / VerB partner pairing, mutation heatmaps, growth curves, copy-number trajectories, barcode stacked bars, barcode heatmaps, and growth comparison panels. Existing figure exports that are not yet migrated use the current DOM PNG path through the same modal.',
  },
  {
    version: '1.5.2',
    date: '2026-07-13',
    summary: 'Bug-fix release. Mutation Explorer Sample Selection now includes positive verAB barcode samples even when they are amplicon-only and have no Mutations rows, so newly uploaded barcode runs can be selected for Compare Library Variants. Added a verAB facet and sample badge to find barcode-bearing samples quickly. DB refreshes now archive before-refresh and after-refresh SQLite snapshots under data/archive so future syncs can be diffed.',
  },
  {
    version: '1.5.1',
    date: '2026-07-13',
    summary: 'Bug-fix release. Moved the release and data log out of the top header into the left sidebar as a Changelog button so it is easier to reach, and made the changelog open as a large readable panel on both desktop and mobile. Removed the interactive tutorial because it was hard to keep current alongside the UI; the Guide and Help buttons remain. The Changelog now tracks the viewer version and the data snapshot version separately, showing the viewer semantic version from the build, the baked data snapshot timestamp from the mirror, and the static manifest generated time, source, and file count when running a static build. Fixed the static manifest display to read the manifest files list instead of a non-existent manifest field. Database sync readiness is unchanged.',
  },
  {
    version: '1.5.0',
    date: '2026-07-13',
    summary: 'Improved the VerA / VerB partner pairing table for presentations. AI-generated partners are now marked with an AI pill on the matching verA row and verB column headers, and any cell that includes an AI partner shows a small ringed corner marker so it reads clearly in a screenshot, with a short legend built into the table. Added a size control to enlarge the swatches and text for slides, and added a figure export menu on the table itself so it can be saved as a PNG or SVG image or printed directly.',
  },
  {
    version: '1.4.3',
    date: '2026-07-13',
    summary: 'Compare Library Variants and Sample Selection fixes plus a LIMS data sync. Added a VerA / VerB partner pairing table beside the plot that shows which verA partners pair with which verB partners for the current selection, shown when a manageable number of samples is selected. Fixed the relative-abundance percentages on the vertical stacked bars so each combination percentage now matches its share of the bar that fills to 100 percent, not the raw per-sample fraction. Added Seqorder as a Sample Selection factor so results from different sequencing runs of the same sample can be filtered and compared. Fixed heatmap figure export so the PNG and SVG buttons produce real PNG and SVG files instead of downgrading to HTML, by relying on inlined resolved styles instead of the app stylesheet. Refreshed the local indexed database from the upstream mirror so newly uploaded verAB data is visible.',
  },
  {
    version: '1.4.2',
    date: '2026-07-10',
    summary: 'Compare Library Variants change-request pass. Relative % vertical bars now normalize each sample to its own total so every stacked bar fills to 100 percent, and the y-axis reads a fixed 0 to 100 percent scale in that mode. Bar colors are full strength by default and only dim on hover or isolate, and figure export stays fully un-muted. Vertical bar x-axis labels now show the full sample name instead of a truncated one. In the heatmap the interactive color-scale legend is removed, the sample_name header reads upright vertical so it fits the column box, and every tile is a solid fully color-filled chip like Barcode Charts instead of a partially filled bordered box. Heatmap figure export now produces real PNG and SVG files by baking resolved colors into the exported figure instead of silently downgrading to HTML. Restored an easy to reach Clear selection control in Sample Selection.',
  },
  {
    version: '1.4.1',
    date: '2026-07-09',
    summary: 'Made the comparison figures practical to publish. Fixed figure export so PNG and SVG now render the full multi-panel growth figure and the library variant heatmap as real images instead of falling back to HTML. Exported figures now use full un-muted colors regardless of on-screen highlighting. Added growth figure arrangement controls for column count, panel show or hide, panel reorder, a figure title, and single-panel focus, plus a per-genotype summary of endpoint OD, max OD, and recovery transfer. In Compare Library Variants the heatmap no longer dims cells and hides the interactive legend since it is not needed there, while the bar chart keeps the legend, the heatmap sample header is labeled sample_name and is now vertical so it fits, and a clear selection control is easier to reach.',
  },
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
