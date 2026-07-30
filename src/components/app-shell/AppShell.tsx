"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ToastProvider } from "@/components/design-system/Toast";
import { PrimaryNavigation } from "./PrimaryNavigation";
import { AppHeader } from "./AppHeader";
import { ContextRail } from "./ContextRail";
import { MobileNavDrawer } from "./MobileNavDrawer";
import { ThemeProvider } from "./ThemeProvider";
import { ChatPanel } from "@/components/assistant/ChatPanel";
import { apiClient } from "@/lib/api-client";
import type { StatusData } from "@/lib/api-client";
import packageJson from "../../../package.json";

type StatusState =
  | { phase: "loading" }
  | { phase: "loaded"; data: StatusData }
  | { phase: "error" };

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
    <ThemeProvider>
      <ToastProvider>
        {/* Skip link */}
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>

        <div className="app-shell">
          {/* Navigation rail (desktop) */}
          <div className="nav-rail">
            <Link className="nav-brand" href="/" aria-label="AI-ALE Research Viewer home">
              <span className="nav-brand-mark" aria-hidden="true">
                {"\u00C6"}
              </span>
              <span className="nav-brand-text">
                <span className="nav-brand-name">AI-ALE</span>
                <span className="nav-brand-sub">Research viewer</span>
              </span>
            </Link>

            <PrimaryNavigation />

            <div className="nav-rail-footer">
              {version && <div>v{version}</div>}
              <div className="nav-rail-footer-note">Read-only research view</div>
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

          {/* Context rail = AI assistant */}
          <ContextRail>
            <ChatPanel />
          </ContextRail>
        </div>

        {/* Mobile nav drawer */}
        <MobileNavDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />
      </ToastProvider>
    </ThemeProvider>
  );
}
