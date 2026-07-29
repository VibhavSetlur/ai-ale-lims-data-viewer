import type { ReactNode } from "react";

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="app-shell"><header className="topbar"><a className="brand" href="#viewer-title">AI-ALE / LIVE RESEARCH</a><span className="mode">Development foundation</span></header><main>{children}</main></div>;
}
