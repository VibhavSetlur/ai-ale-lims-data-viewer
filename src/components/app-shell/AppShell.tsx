import type { ReactNode } from "react";
import Link from "next/link";
import { scientificRepository } from "@/server/db/scientific";
import { isStaticExport } from "@/lib/static-data";
import { issueReportUrl } from "@/lib/support/support-content";
import { assistantMode } from "@/modules/assistant/contracts";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { IdentityControl } from "./IdentityControl";
import { PrimaryNavigation } from "./PrimaryNavigation";

export async function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const fixture = { snapshotId: "fixture-full-v1", label: "Sanitized static fixture", sourceSystem: "generated-fixture" };
  const live = isStaticExport ? undefined : await (async () => { try { const repository = scientificRepository(); return { snapshot: await repository.provenance(), capabilities: await repository.capabilities() }; } catch { return undefined; } })();
  const snapshot = isStaticExport ? fixture : live?.snapshot;
  return <div className="app-shell">
    <a className="skip-link" href="#research-canvas">Skip to research content</a>
    <header className="topbar">
      <Link className="brand" href="/mutations/cohort">AI-ALE <span>Research workspace</span></Link>
      <div className="header-meta">
        <span className="provenance" title={snapshot ? `Snapshot ${snapshot.snapshotId}` : "Scientific snapshot unavailable"}>{snapshot ? `${snapshot.label} · ${snapshot.snapshotId}` : "Snapshot unavailable"}</span>
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
       <p>{snapshot ? "Read-only scientific snapshot." : "Scientific snapshot is unavailable."}</p>
       {snapshot && <dl className="context-details">
         <div><dt>Source</dt><dd>{snapshot.sourceSystem}</dd></div>
         <div><dt>Snapshot</dt><dd>{snapshot.snapshotId}</dd></div>
         <div><dt>Barcodes</dt><dd>{isStaticExport ? "Available" : live?.capabilities.hasBarcodes ? "Available" : "Unavailable"}</dd></div>
       </dl>}
      <AssistantPanel mode={assistantMode()} />
    </aside>
  </div>;
}
