'use client';

import { useState } from "react";
import { PageHeader } from "@/components/design-system/Primitives";
import { externalAiPrompt } from "@/lib/support/support-content";

const steps = [
  ["1. Choose a starting route", "Open Database Tables for record-oriented filtering, Mutation Explorer for cohort comparison, or Plate Design for a local draft."],
  ["2. Narrow deliberately", "Record the route, visible filters, ordering, and snapshot label before interpreting a result or exporting it."],
  ["3. Check the appropriate caveat", "Use Help for growth, library-variant, copy-number, and barcode limitations. Unsupported barcode data is hidden, not estimated."],
  ["4. Preserve only what is safe", "Export filtered table results when appropriate. Plate drafts are local-only, so export the design file to move it to another browser."],
];

export default function GuidePage() {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const prompt = externalAiPrompt();
  async function copyPrompt() { try { await navigator.clipboard.writeText(prompt); setCopyStatus("copied"); } catch { setCopyStatus("failed"); } }
  return <section><PageHeader eyebrow="SUPPORT" title="Guide"><p className="lede">A deterministic path through Viewer 2, plus a copyable prompt that shares only safe viewer context with an external AI.</p></PageHeader><ol className="guide-steps">{steps.map(([title, body]) => <li key={title}><h2>{title}</h2><p>{body}</p></li>)}</ol><section className="support-card" aria-labelledby="ai-prompt-title"><h2 id="ai-prompt-title">External-AI prompt builder</h2><p>This template includes public viewer and snapshot labels only. Add your question yourself. It never includes records, secrets, credentials, or raw data.</p><textarea aria-label="External AI prompt" readOnly value={prompt} rows={12} /><button className="button" type="button" onClick={() => void copyPrompt()}>{copyStatus === "copied" ? "Copied prompt" : "Copy safe prompt"}</button>{copyStatus === "failed" && <p role="alert">Copying is unavailable in this browser. Select the prompt text and copy it manually.</p>}</section></section>;
}

export { externalAiPrompt } from "@/lib/support/support-content";
