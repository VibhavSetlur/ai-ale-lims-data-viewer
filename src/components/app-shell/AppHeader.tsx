"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import type { StatusData } from "@/lib/api-client";
import { AccountControl } from "./AccountControl";
import { ProvenanceDialog } from "./ProvenanceDialog";
import { ThemeToggle } from "./ThemeToggle";

const PAGE_TITLES: Readonly<Record<string, string>> = {
  "/": "Overview",
  "/tables": "Tables",
  "/mutations/cohort": "Cohort builder",
  "/mutations/compare/mutations": "Mutation comparison",
  "/mutations/compare/growth": "Growth comparison",
  "/mutations/compare/library-variants": "Library variants",
  "/mutations/compare/copy-number": "Copy number",
  "/plates": "Plate designs",
  "/workspaces": "Workspaces",
  "/guide": "Guide",
  "/changelog": "Changelog",
  "/help": "Help",
  "/login": "Sign in",
};

function pageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (pathname.startsWith("/tables/")) return "Table";
  if (pathname.startsWith("/plates/")) return "Plate design";
  return "Research viewer";
}

type AppHeaderProps = {
  status: StatusData | null;
  statusLoading: boolean;
  onOpenDrawer?: () => void;
  showHamburger?: boolean;
};

export function AppHeader({
  status,
  statusLoading,
  onOpenDrawer,
  showHamburger = false,
}: Readonly<AppHeaderProps>) {
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const pathname = usePathname();

  const channel = status?.profile.channel;
  const snapshotLabel = status?.provenance?.label;
  const snapshotId = status?.provenance?.snapshotId;

  return (
    <>
      <header className="topbar">
        {showHamburger && (
          <button
            type="button"
            className="topbar-hamburger"
            onClick={onOpenDrawer}
            aria-label="Open navigation menu"
            aria-expanded={false}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
            </svg>
          </button>
        )}

        <h1 className="topbar-title">{pageTitle(pathname)}</h1>

        <div className="topbar-spacer" />

        {/* Channel/env pill */}
        {channel ? (
          <span
            className="env-pill"
            data-channel={channel}
            data-testid="env-pill"
          >
            {channel}
          </span>
        ) : statusLoading ? (
          <span className="env-pill snapshot-pill-loading" data-testid="env-pill">
            Loading...
          </span>
        ) : null}

        {/* Snapshot pill -- opens provenance dialog */}
        <button
          type="button"
          className={`snapshot-pill${statusLoading ? " snapshot-pill-loading" : ""}`}
          onClick={() => setProvenanceOpen(true)}
          disabled={statusLoading && !status}
          aria-label={
            snapshotId
              ? `Snapshot: ${snapshotLabel ?? snapshotId}. View provenance.`
              : "Snapshot information. View provenance."
          }
          data-testid="snapshot-pill"
        >
          {statusLoading && !status
            ? "Loading snapshot..."
            : snapshotLabel
              ? snapshotLabel
              : "Snapshot unavailable"}
        </button>

        <ThemeToggle />
        <AccountControl />
      </header>

      <ProvenanceDialog
        open={provenanceOpen}
        onClose={() => setProvenanceOpen(false)}
        status={status}
      />
    </>
  );
}
