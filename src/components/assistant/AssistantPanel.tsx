'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/design-system/Primitives";
import { fakeAssistantReply } from "@/modules/assistant/fake-provider";
import { executeConfirmedProposal, type AssistantMode, type NavigationProposal, validateNavigationProposal } from "@/modules/assistant/contracts";

export function AssistantPanel({ mode }: Readonly<{ mode: AssistantMode }>) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [proposal, setProposal] = useState<NavigationProposal | null>(null);

  if (mode !== "fake") return null;

  function ask() {
    const response = fakeAssistantReply(prompt);
    setReply(response.text);
    setProposal(response.proposedToolCalls.map(validateNavigationProposal).find((candidate): candidate is NavigationProposal => candidate !== null) ?? null);
  }

  function confirm() {
    if (proposal && executeConfirmedProposal(proposal, (destination) => router.push(destination))) setProposal(null);
  }

  return <section className="assistant-panel" aria-labelledby="assistant-heading">
    <p className="eyebrow">Optional assistant</p>
    <h2 id="assistant-heading">Research navigation demo</h2>
    <p>This deterministic local demo suggests internal destinations only. It cannot access data or take actions.</p>
    <label htmlFor="assistant-prompt">What would you like to explore?</label>
    <div className="assistant-input"><input id="assistant-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} /><Button onClick={ask} type="button">Suggest</Button></div>
    {reply && <p className="assistant-reply" role="status">{reply}</p>}
    {proposal && <div className="assistant-proposal">
      <strong>Proposed destination</strong><span>{proposal.destination}</span><p>{proposal.impact}</p>
      <div className="assistant-actions"><Button onClick={confirm} type="button">Confirm</Button><Button onClick={() => setProposal(null)} type="button" variant="secondary">Cancel</Button></div>
    </div>}
  </section>;
}
