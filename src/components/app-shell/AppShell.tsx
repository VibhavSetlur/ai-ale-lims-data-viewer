"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ToastProvider } from "@/components/design-system/Toast";
import { ErrorState, LoadingState } from "@/components/design-system/Primitives";
import { PrimaryNavigation } from "./PrimaryNavigation";
import { AppHeader } from "./AppHeader";
import { ContextRail } from "./ContextRail";
import { MobileNavDrawer } from "./MobileNavDrawer";
import { apiClient } from "@/lib/api-client";
import type { StatusData } from "@/lib/api-client";
import packageJson from "../../../package.json";

type StatusState =
  | { phase: "loading" }
  | { phase: "loaded"; data: StatusData }
  | { phase: "error" };

function ShellContextRailContent({
  statusState,
  onRetry,
}: Readonly<{
  statusState: StatusState;
  onRetry: () => void;
}>) {
  if (statusState.phase === "loading") {
    return <LoadingState rows={4} label="Loading snapshot information" />;
  }
  if (statusState.phase === "error") {
    return (
      <ErrorState
        message="Snapshot info unavailable"
        onRetry={onRetry}
      />
    );
  }
  const { data } = statusState;
  const prov = data.provenance;
  const cap = data.capabilities;

  return (
    <div>
      <div className="ctx-snapshot-card">
        <p className="ctx-snapshot-label">Snapshot</p>
        <p className="ctx-snapshot-id">{prov.snapshotId}</p>
        <div className="ctx-kv">
          <div className="ctx-kv-item">
            <span className="ctx-kv-key">Label</span>
            <span className="ctx-kv-val">{prov.label}</span>
          </div>
          <div className="ctx-kv-item">
            <span className="ctx-kv-key">Source</span>
            <span className="ctx-kv-val">{prov.sourceSystem}</span>
          </div>
          <div className="ctx-kv-item">
            <span className="ctx-kv-key">Barcodes</span>
            <span className="ctx-kv-val">
              {cap.hasBarcodes ? "Available" : "Not in this snapshot"}
            </span>
          </div>
          {prov.receivedAt && (
            <div className="ctx-kv-item">
              <span className="ctx-kv-key">Received</span>
              <span className="ctx-kv-val">
                {new Date(prov.receivedAt).toLocaleDateString()}
              </span>
            </div>
          )}
        </div>
      </div>

      {data.profile && (
        <div
          style={{
            marginTop: "var(--space-5)",
            paddingTop: "var(--space-5)",
            borderTop: "1px solid var(--color-border)",
          }}
        >
          <p
            className="ctx-snapshot-label"
            style={{ marginBottom: "var(--space-3)" }}
          >
            Environment
          </p>
          <div className="ctx-kv">
            <div className="ctx-kv-item">
              <span className="ctx-kv-key">Mode</span>
              <span className="ctx-kv-val">{data.profile.mode}</span>
            </div>
            {data.profile.channel && (
              <div className="ctx-kv-item">
                <span className="ctx-kv-key">Channel</span>
                <span className="ctx-kv-val">{data.profile.channel}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: Readonly<AppShellProps>) {
  const [statusState, setStatusState] = useState<StatusState>({ phase: "loading" });
  const [drawerOpen, setDrawerOpen] = useState(false);

  const loadStatus = useCallback(async () => {
    const result = await apiClient.status();
    if (result.ok) {
      setStatusState({ phase: "loaded", data: result.data });
    } else {
      setStatusState({ phase: "error" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStatus();
  }, [loadStatus]);

  const status: StatusData | null =
    statusState.phase === "loaded" ? statusState.data : null;

  const version = (packageJson as { version?: string }).version;

  return (
    <ToastProvider>
      {/* Skip link */}
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <div className="app-shell">
        {/* Navigation rail (desktop) */}
        <div className="nav-rail">
          <Link className="nav-brand" href="/" aria-label="AI-ALE Research Viewer home">
            <div>
              <div className="nav-brand-name">AI-ALE</div>
              <div className="nav-brand-sub">Research viewer</div>
            </div>
          </Link>

          <PrimaryNavigation />

          <div className="nav-rail-footer">
            {version && <div>v{version}</div>}
          </div>
        </div>

        {/* Top header */}
        <AppHeader
          status={status}
          statusLoading={statusState.phase === "loading"}
          onOpenDrawer={() => setDrawerOpen(true)}
          showHamburger={true}
        />

        {/* Main content */}
        <main
          className="main-content"
          id="main-content"
          tabIndex={-1}
        >
          {children}
        </main>

        {/* Context rail */}
        <ContextRail>
          <ShellContextRailContent
            statusState={statusState}
            onRetry={() => void loadStatus()}
          />
        </ContextRail>
      </div>

      {/* Mobile nav drawer */}
      <MobileNavDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </ToastProvider>
  );
}
