import { describe, expect, it, vi } from "vitest";
import { assistantMode, executeConfirmedProposal, parseAssistantMode, validateNavigationProposal } from "./contracts";

describe("assistant boundary", () => {
  it("defaults and rejects unrecognized modes", () => {
    expect(parseAssistantMode(undefined)).toBe("disabled");
    expect(parseAssistantMode("anything-else")).toBe("disabled");
    expect(parseAssistantMode("fake")).toBe("fake");
  });

  it("disables static export and unavailable local-qwen", () => {
    expect(assistantMode({ ASSISTANT_MODE: "fake", NEXT_PUBLIC_STATIC_EXPORT: "1" })).toBe("disabled");
    expect(assistantMode({ ASSISTANT_MODE: "local-qwen" })).toBe("disabled");
    expect(assistantMode({ ASSISTANT_MODE: "fake" })).toBe("fake");
  });

  it("allows only typed internal navigation proposals", () => {
    expect(validateNavigationProposal({ id: "a", name: "navigate", arguments: { destination: "/help" } })).toMatchObject({ destination: "/help" });
    expect(validateNavigationProposal({ id: "a", name: "set-research-view", arguments: { view: "/tables" } })).toMatchObject({ destination: "/tables" });
    expect(validateNavigationProposal({ id: "a", name: "navigate", arguments: { destination: "https://example.test" } })).toBeNull();
    expect(validateNavigationProposal({ id: "a", name: "describe-route", arguments: { destination: "/help" } })).toBeNull();
    expect(validateNavigationProposal({ id: "a", name: "delete-everything" as never, arguments: { destination: "/help" } })).toBeNull();
    expect(validateNavigationProposal({ id: "a", name: "navigate", arguments: { destination: "/help?unsafe=true" } })).toBeNull();
  });

  it("executes navigation only at the confirmed executor boundary", () => {
    const navigate = vi.fn();
    const proposal = validateNavigationProposal({ id: "a", name: "navigate", arguments: { destination: "/help" } });
    expect(proposal).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(executeConfirmedProposal(proposal!, navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledWith("/help");
  });
});
