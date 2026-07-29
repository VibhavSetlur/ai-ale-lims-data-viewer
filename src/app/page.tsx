"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { legacyRouteMigrationMarker, routeForLegacyTab } from "@/lib/research/legacy-route-migration";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    try {
      if (!localStorage.getItem(legacyRouteMigrationMarker)) {
        const destination = routeForLegacyTab(localStorage.getItem("ai-ale-viewer-tab"));
        router.replace(destination);
        localStorage.setItem(legacyRouteMigrationMarker, "complete");
        return;
      }
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
    router.replace("/mutations/cohort");
  }, [router]);
  return <p className="route-loading" aria-live="polite">Opening the research viewer…</p>;
}
