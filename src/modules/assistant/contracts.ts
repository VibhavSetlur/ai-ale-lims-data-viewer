export type AssistantMode = "disabled" | "fake" | "local-qwen";
export type ResearchToolName = "navigate" | "describe-route" | "set-research-view";

type RouteDestination =
  | "/tables"
  | "/mutations/cohort"
  | "/mutations/compare/mutations"
  | "/mutations/compare/growth"
  | "/mutations/compare/library-variants"
  | "/mutations/compare/copy-number"
  | "/plates"
  | "/workspaces"
  | "/guide"
  | "/changelog"
  | "/help";

export type ResearchToolCall = {
  id: string;
  name: ResearchToolName;
  arguments: unknown;
};

export type AssistantReply = {
  text: string;
  citations: { label: string; href: RouteDestination }[];
  proposedToolCalls: ResearchToolCall[];
};

export type NavigationProposal = {
  id: string;
  name: "navigate" | "set-research-view";
  destination: RouteDestination;
  impact: string;
};

const destinations: readonly RouteDestination[] = [
  "/tables",
  "/mutations/cohort",
  "/mutations/compare/mutations",
  "/mutations/compare/growth",
  "/mutations/compare/library-variants",
  "/mutations/compare/copy-number",
  "/plates",
  "/workspaces",
  "/guide",
  "/changelog",
  "/help",
];

export function parseAssistantMode(value: string | undefined): AssistantMode {
  return value === "fake" || value === "local-qwen" || value === "disabled" ? value : "disabled";
}

export function assistantMode(environment: Record<string, string | undefined> = process.env): AssistantMode {
  if (environment.NEXT_PUBLIC_STATIC_EXPORT === "1") return "disabled";
  const mode = parseAssistantMode(environment.ASSISTANT_MODE);
  return mode === "local-qwen" ? "disabled" : mode;
}

function isDestination(value: unknown): value is RouteDestination {
  return typeof value === "string" && destinations.includes(value as RouteDestination);
}

function destinationFor(call: ResearchToolCall): RouteDestination | null {
  if (!call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments)) return null;
  const argumentsObject = call.arguments as Record<string, unknown>;
  if (call.name === "navigate" || call.name === "describe-route") return isDestination(argumentsObject.destination) ? argumentsObject.destination : null;
  if (call.name === "set-research-view") return isDestination(argumentsObject.view) ? argumentsObject.view : null;
  return null;
}

export function validateNavigationProposal(call: ResearchToolCall): NavigationProposal | null {
  if (typeof call.id !== "string" || call.id.length === 0 || (call.name !== "navigate" && call.name !== "set-research-view")) return null;
  const destination = destinationFor(call);
  if (!destination) return null;
  return {
    id: call.id,
    name: call.name,
    destination,
    impact: call.name === "navigate" ? "Opens an internal research workspace." : "Changes the research view to an internal workspace.",
  };
}

export function executeConfirmedProposal(proposal: NavigationProposal, navigate: (destination: RouteDestination) => void) {
  const validated = validateNavigationProposal({ id: proposal.id, name: proposal.name, arguments: proposal.name === "navigate" ? { destination: proposal.destination } : { view: proposal.destination } });
  if (!validated || validated.destination !== proposal.destination) return false;
  navigate(validated.destination);
  return true;
}
