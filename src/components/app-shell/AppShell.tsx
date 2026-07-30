import type { ReactNode } from "react";
import Link from "next/link";
import { mockProvenance } from "@/lib/research/mock-service";
import { issueReportUrl } from "@/lib/support/support-content";
import { assistantMode } from "@/modules/assistant/contracts";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { IdentityControl } from "./IdentityControl";
import { PrimaryNavigation } from "./PrimaryNavigation";

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="app-shell">
    <a className="skip-link" href="#research-canvas">Skip to research content</a>
    <header className="topbar">
      <Link className="brand" href="/mutations/cohort">AI-ALE <span>Research workspace</span></Link>
      <div className="header-meta">
        <span className="provenance" title={`Snapshot ${mockProvenance.snapshotId}`}>Snapshot preview</span>
        <span className="status-chip status-read-only">Read-only</span>
        <a href={issueReportUrl()} target="_blank" rel="noreferrer">Report an issue</a>
        <IdentityControl />
      </div>
    </header>
    <PrimaryNavigation />
    <main className="research-canvas" id="research-canvas" tabIndex={-1}>{children}</main>
    <aside className="context-inspector" aria-labelledby="context-heading">
      <div className="inspector-heading">
        <p className="eyebrow">Research context</p>
        <h2 id="context-heading">Snapshot details</h2>
      </div>
      <p>Read-only preview. Scientific records are not loaded.</p>
      <dl className="context-details">
        <div><dt>Source</dt><dd>{mockProvenance.label}</dd></div>
        <div><dt>Snapshot</dt><dd>{mockProvenance.snapshotId}</dd></div>
      </dl>
      <AssistantPanel mode={assistantMode()} />
    </aside>
  </div>;
}
