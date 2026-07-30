import type { AssistantReply } from "./contracts";

const cohortReply: AssistantReply = {
  text: "I can help you begin by building a cohort from the available research snapshot.",
  citations: [{ label: "Build a cohort", href: "/mutations/cohort" }],
  proposedToolCalls: [{ id: "fake-open-cohort", name: "navigate", arguments: { destination: "/mutations/cohort" } }],
};

const tablesReply: AssistantReply = {
  text: "I can direct you to the table workspace to explore available records.",
  citations: [{ label: "Explore data", href: "/tables" }],
  proposedToolCalls: [{ id: "fake-open-tables", name: "navigate", arguments: { destination: "/tables" } }],
};

const helpReply: AssistantReply = {
  text: "I can point you to the help documentation for this workspace.",
  citations: [{ label: "Help", href: "/help" }],
  proposedToolCalls: [{ id: "fake-open-help", name: "navigate", arguments: { destination: "/help" } }],
};

export function fakeAssistantReply(prompt: string): AssistantReply {
  const normalized = prompt.trim().toLowerCase();
  if (normalized.includes("table") || normalized.includes("data")) return tablesReply;
  if (normalized.includes("help") || normalized.includes("guide")) return helpReply;
  return cohortReply;
}
