"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type ChatRole = "user" | "assistant";
type ChatTurn = { role: ChatRole; content: string };

type ArgoModel = { id: string; label: string };

const MODELS: readonly ArgoModel[] = [
  { id: "gpt4o", label: "GPT-4o" },
  { id: "claudesonnet4", label: "Claude Sonnet 4" },
  { id: "claudeopus4", label: "Claude Opus 4" },
  { id: "gemini25pro", label: "Gemini 2.5 Pro" },
  { id: "gpto1", label: "GPT o1" },
];

const MODEL_KEY = "aiale.assistant.model";
const USER_KEY = "aiale.assistant.user";

const PAGE_HINTS: Readonly<Record<string, string>> = {
  "/": "the home overview",
  "/tables": "the table catalog browser",
  "/mutations/cohort": "the cohort builder",
  "/mutations/compare/mutations": "the mutation comparison view",
  "/mutations/compare/growth": "the growth curve comparison view",
  "/mutations/compare/library-variants": "the library variant comparison view",
  "/mutations/compare/copy-number": "the copy number comparison view",
  "/plates": "the 96-well plate designer",
  "/workspaces": "saved local workspaces",
  "/guide": "the guide",
  "/help": "the help center",
};

function pageHint(pathname: string): string {
  if (PAGE_HINTS[pathname]) return PAGE_HINTS[pathname];
  if (pathname.startsWith("/tables/")) return "a data table view";
  return "the research viewer";
}

function systemPrompt(pathname: string): string {
  return [
    "You are the AI-ALE research assistant, embedded in a read-only scientific data viewer",
    "for adaptive laboratory evolution (ALE) LIMS data. The dataset covers experiments,",
    "sample cohorts, mutations, growth curves, library variants, copy number, and 96-well",
    "plate designs. Help researchers interpret results, plan analyses, and navigate the app.",
    `The user is currently on ${pageHint(pathname)}.`,
    "Be concise, accurate, and scientific. When you are unsure about specific numbers in",
    "this snapshot, say so and suggest which view or table would contain the answer.",
    "Never invent data values. Prefer short paragraphs and bullet points.",
  ].join(" ");
}

export function ChatPanel() {
  const pathname = usePathname();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string>("gpt4o");
  const [showSettings, setShowSettings] = useState(false);
  const [argoUser, setArgoUser] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Hydrate persisted preferences once on mount; intentional post-mount state set.
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const m = window.localStorage.getItem(MODEL_KEY);
      if (m && MODELS.some((x) => x.id === m)) setModel(m);
      const u = window.localStorage.getItem(USER_KEY);
      if (u) setArgoUser(u);
    } catch {
      // ignore
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [turns, busy]);

  const persistModel = useCallback((next: string) => {
    setModel(next);
    try {
      window.localStorage.setItem(MODEL_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const persistUser = useCallback((next: string) => {
    setArgoUser(next);
    try {
      if (next) window.localStorage.setItem(USER_KEY, next);
      else window.localStorage.removeItem(USER_KEY);
    } catch {
      // ignore
    }
  }, []);

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    setError(null);
    const nextTurns: ChatTurn[] = [...turns, { role: "user", content: trimmed }];
    setTurns(nextTurns);
    setInput("");
    setBusy(true);

    const messages = [
      { role: "system" as const, content: systemPrompt(pathname) },
      ...nextTurns.map((t) => ({ role: t.role, content: t.content })),
    ];

    try {
      const res = await fetch("/api/v1/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          user: argoUser || undefined,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        data?: { reply?: string };
        error?: { message?: string };
      };
      if (!res.ok || !payload.ok || !payload.data?.reply) {
        setError(payload.error?.message ?? "The assistant is unavailable right now.");
      } else {
        setTurns((prev) => [...prev, { role: "assistant", content: payload.data!.reply! }]);
      }
    } catch {
      setError("Could not reach the assistant.");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [input, busy, turns, pathname, model, argoUser]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void send();
      }
    },
    [send],
  );

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div className="chat-header-title">
          <span className="chat-dot" aria-hidden="true" />
          <span>Research assistant</span>
        </div>
        <div className="chat-header-actions">
          <label className="sr-only" htmlFor="chat-model">
            Model
          </label>
          <select
            id="chat-model"
            className="chat-model-select"
            value={model}
            onChange={(e) => persistModel(e.target.value)}
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="chat-icon-btn"
            aria-label="Assistant settings"
            aria-expanded={showSettings}
            onClick={() => setShowSettings((s) => !s)}
          >
            {"\u2699"}
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="chat-settings">
          <label className="chat-settings-label" htmlFor="chat-argo-user">
            Argo user id (optional)
          </label>
          <input
            id="chat-argo-user"
            className="chat-settings-input"
            type="text"
            placeholder="Use server default"
            value={argoUser}
            onChange={(e) => persistUser(e.target.value)}
          />
          <p className="chat-settings-hint">
            Requests route through the Argo gateway. Leave blank to use the server
            configured user. Your id is stored only in this browser.
          </p>
          {turns.length > 0 && (
            <button
              type="button"
              className="button button-quiet button-sm"
              onClick={() => {
                setTurns([]);
                setError(null);
              }}
            >
              Clear conversation
            </button>
          )}
        </div>
      )}

      <div className="chat-messages" ref={listRef} aria-live="polite">
        {turns.length === 0 && !busy && (
          <div className="chat-empty">
            <p className="chat-empty-title">Ask about this dataset</p>
            <p className="chat-empty-hint">
              Try: &ldquo;What does the mutation comparison view show?&rdquo; or
              &ldquo;How do I build a cohort for experiment TFMN1?&rdquo;
            </p>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`chat-turn chat-turn-${t.role}`}>
            <div className="chat-bubble">{t.content}</div>
          </div>
        ))}
        {busy && (
          <div className="chat-turn chat-turn-assistant">
            <div className="chat-bubble chat-bubble-thinking">
              <span className="chat-typing" aria-label="Assistant is thinking">
                <i /> <i /> <i />
              </span>
            </div>
          </div>
        )}
        {error && (
          <div className="chat-error" role="alert">
            {error}
          </div>
        )}
      </div>

      <div className="chat-composer">
        <label className="sr-only" htmlFor="chat-input">
          Message the assistant
        </label>
        <textarea
          id="chat-input"
          ref={inputRef}
          className="chat-input"
          rows={2}
          placeholder="Ask about the data..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
        <button
          type="button"
          className="button button-primary button-sm chat-send"
          onClick={() => void send()}
          disabled={busy || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
