import { mockCapabilities, mockProvenance } from "../research/mock-service";
import packageInfo from "../../../package.json";

export const viewerVersion = packageInfo.version;

export type SupportArticle = { id: string; title: string; keywords: string[]; body: string };

export const helpArticles: SupportArticle[] = [
  { id: "tables", title: "Filter and export tables", keywords: ["table", "filter", "filtered", "search", "csv", "export"], body: "Use Global search to match visible text columns. Add filters, choose whether every filter or any filter must match, then download a CSV. The export uses the current filters and ordering. Review column names and the snapshot badge before sharing an export." },
  { id: "mutation", title: "Mutation results", keywords: ["mutation", "cohort", "comparison"], body: "Mutation views summarize observed annotations in the selected cohort. They are not a causal claim, a complete genotype, or a substitute for the underlying scientific record. Empty results can reflect the active selection or an unavailable data service." },
  { id: "growth", title: "Growth-series caveats", keywords: ["growth", "od", "series", "transfer"], body: "Growth comparisons depend on recorded measurements, lineage labels, transfer numbering, and sampling timing. Missing points, unequal intervals, and different measurement conditions limit direct comparison." },
  { id: "library", title: "Library-variant caveats", keywords: ["library", "variant", "barcode"], body: "Library measurements describe the available variant observations, not a complete library census. Interpret counts with sequencing depth, sampling, and the selected snapshot in mind." },
  { id: "copy-number", title: "Copy-number caveats", keywords: ["copy", "number", "coverage"], body: "Copy-number displays are derived comparative measurements. They may be affected by normalization, coverage, reference choice, and missing values. Do not treat a displayed value as an independently validated copy-number call." },
  { id: "barcodes", title: "Barcode capability", keywords: ["barcode", "capability", "available"], body: mockCapabilities.hasBarcodes ? "Barcode charts are available in this snapshot. Availability does not make a barcode count a complete biological interpretation." : "Barcode charts are unavailable because this snapshot does not include barcode records. The viewer hides unsupported barcode analysis rather than substituting data." },
  { id: "plates", title: "Plate Design stays local", keywords: ["plate", "local", "browser", "lims"], body: "Plate Design is a browser-local workspace. Drafts, imports, exports, snapshots, and undo history stay in this browser and never write to LIMS or the scientific snapshot. Export a file if you need to move a design." },
  { id: "provenance", title: "Provenance and snapshot data", keywords: ["provenance", "snapshot", "source", "revision"], body: `This read-only view identifies the scientific snapshot as ${mockProvenance.label} (${mockProvenance.snapshotId}). Source system: ${mockProvenance.sourceSystem}. Snapshot metadata identifies the data revision; it is separate from the viewer code release.` },
];

export function searchHelpArticles(query: string) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return helpArticles.filter((article) => terms.every((term) => `${article.title} ${article.keywords.join(" ")} ${article.body}`.toLocaleLowerCase().includes(term)));
}

export function externalAiPrompt() {
  return `I am using the AI-ALE Live Research Viewer. Help me reason about a research question without requesting, inferring, or fabricating private records.\n\nViewer version: ${viewerVersion}\nScientific snapshot: ${mockProvenance.label} (${mockProvenance.snapshotId})\nSource system: ${mockProvenance.sourceSystem}\n\nQuestion: [describe the scientific question and the route or visualization]\n\nPlease: state assumptions, distinguish observations from interpretation, identify relevant caveats, and suggest reproducible next checks. Do not include credentials, API tokens, participant identifiers, raw records, or unpublished sequences.`;
}

export function issueReportUrl() {
  const body = `Thanks for reporting a Viewer 2 issue.\n\nWhat happened?\nExpected behavior:\nRoute or screen:\nSteps to reproduce:\n\nSafe viewer context:\n- Viewer version: ${viewerVersion}\n- Scientific snapshot: ${mockProvenance.label} (${mockProvenance.snapshotId})\n- Source system: ${mockProvenance.sourceSystem}\n- Data mode: read-only\n\nPlease do not paste raw scientific records, credentials, API tokens, or other secrets.`;
  return `https://github.com/VibhavSetlur/ai-ale-lims-data-viewer/issues/new?${new URLSearchParams({ title: "Viewer 2: ", body }).toString()}`;
}
