import type { ReactNode } from "react";
import Link from "next/link";
import { mockProvenance } from "@/lib/research/mock-service";
import { issueReportUrl } from "@/lib/support/support-content";

const researchLinks = [{ href: "/tables", label: "Database Tables" }, { href: "/mutations/cohort", label: "Mutation Explorer" }, { href: "/plates", label: "Plate Design" }];
export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
 return <div className="app-shell">
  <header className="topbar"><Link className="brand" href="/mutations/cohort">AI-ALE / LIVE RESEARCH</Link><div className="header-meta"><span className="provenance">{mockProvenance.label}</span><span>Read-only</span><a href={issueReportUrl()} target="_blank" rel="noreferrer">Report an issue</a><span aria-label="Account status">Anonymous</span></div></header>
  <nav className="primary-nav" aria-label="Primary navigation"><div><span className="nav-group">Research</span>{researchLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}</div><div><span className="nav-group">Support</span><Link href="/guide">Guide</Link><Link href="/changelog">Changelog</Link><Link href="/help">Help</Link></div></nav>
  <main className="research-canvas">{children}</main><aside className="context-inspector" aria-label="Context inspector"><h2>Context</h2><p>Read-only preview. Scientific records are not loaded.</p><p className="muted">{mockProvenance.snapshotId}</p></aside>
 </div>;
}
