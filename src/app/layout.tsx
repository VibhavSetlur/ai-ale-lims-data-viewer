import type { Metadata } from "next";
import "./styles.css";
import { AppShell } from "@/components/app-shell/AppShell";
export const metadata: Metadata = { title: "AI-ALE Live Research Viewer", description: "Read-only routes for exploring AI-ALE scientific snapshots." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><AppShell>{children}</AppShell></body></html>; }
