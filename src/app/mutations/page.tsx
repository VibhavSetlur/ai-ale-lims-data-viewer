"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import MutationExplorer from "@/components/research/MutationExplorer";

const TAB_KEY = "lims:mutation:tab";
const VALID_TABS = new Set([
  "samples",
  "compare",
  "growth",
  "libraryVariants",
  "copynumber",
]);

function MutationExplorerPage() {
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");

  useEffect(() => {
    if (!tab || !VALID_TABS.has(tab)) return;
    // Persist first so the explorer's mount-time restore picks it up, then
    // dispatch the navigation event in case the explorer is already mounted.
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {}
    window.dispatchEvent(
      new CustomEvent("aiale:navigate", { detail: { tab } }),
    );
  }, [tab]);

  return (
    <div className="lims-scope">
      <MutationExplorer />
    </div>
  );
}

export default function MutationsPage() {
  return (
    <Suspense fallback={<div className="lims-scope" />}>
      <MutationExplorerPage />
    </Suspense>
  );
}
