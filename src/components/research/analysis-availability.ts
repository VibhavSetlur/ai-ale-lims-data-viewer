export type AnalysisKind = "compare" | "growth" | "library-variants" | "copy-number";

export function analysisUnavailableReason(
  kind: AnalysisKind,
  hasBarcodes: boolean | undefined,
) {
  if (kind === "library-variants")
    return hasBarcodes === false
      ? "Library variants is unavailable because this snapshot cannot prove the required experiment scope and has no barcode records."
      : "Library variants is unavailable because this snapshot cannot prove the required experiment scope.";
  if (kind === "copy-number")
    return "Copy-number analysis is unavailable because this snapshot cannot prove the required experiment scope.";
  return undefined;
}
