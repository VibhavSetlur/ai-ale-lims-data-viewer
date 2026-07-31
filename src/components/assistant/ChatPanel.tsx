"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

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

// Navigation targets the assistant is allowed to open. Maps a stable name to a
// concrete in-app route. The four mutation views live behind the single
// Mutation Explorer page with a ?tab query.
const NAV_TARGETS: Readonly<Record<string, string>> = {
  tables: "/tables",
  "data-tables": "/tables",
  mutations: "/mutations?tab=compare",
  "compare-mutations": "/mutations?tab=compare",
  "sample-selection": "/mutations?tab=samples",
  samples: "/mutations?tab=samples",
  growth: "/mutations?tab=growth",
  "compare-growth": "/mutations?tab=growth",
  "library-variants": "/mutations?tab=libraryVariants",
  "copy-number": "/mutations?tab=copynumber",
  plates: "/plates",
  "plate-design": "/plates",
  workspaces: "/workspaces",
  guide: "/guide",
  changelog: "/changelog",
  help: "/help",
  home: "/",
};

const NAV_PATTERN = /\[\[\s*navigate\s*:\s*([a-z0-9-]+)\s*\]\]/gi;

const PAGE_HINTS: Readonly<Record<string, string>> = {
  "/": "the home overview",
  "/tables": "the data table browser",
  "/mutations": "the Mutation Explorer (Sample Selection, Compare Mutations, Compare Growth, Compare Library Variants, Copy Number tabs)",
  "/plates": "the 96-well plate designer",
  "/workspaces": "saved local plate designs",
  "/guide": "the guide",
  "/changelog": "the changelog",
  "/help": "the help center",
};

function pageHint(pathname: string): string {
  if (PAGE_HINTS[pathname]) return PAGE_HINTS[pathname];
  if (pathname.startsWith("/tables/")) return "a data table view";
  if (pathname.startsWith("/mutations")) return PAGE_HINTS["/mutations"];
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
    "When it would help the user to see a specific page, you may direct them there by",
    "including a token of the form [[navigate:TARGET]] on its own at the end of your reply.",
    "Valid TARGET values: tables, sample-selection, compare-mutations, compare-growth,",
    "library-variants, copy-number, plates, workspaces, guide, changelog, help, home.",
    "Only navigate when the user asks to see or open something. The token is hidden from",
    "the user, so still describe what they will see in words.",
  ].join(" ");
}

function extractNavigation(reply: string): { text: string; target: string | null } {
  let target: string | null = null;
  const text = reply
    .replace(NAV_PATTERN, (_match, name: string) => {
      const key = name.toLowerCase();
      if (!target && NAV_TARGETS[key]) target = NAV_TARGETS[key];
      return "";
    })
    .trim();
  return { text: text.length > 0 ? text : reply.trim(), target };
}

export function ChatPanel() {
  const pathname = usePathname();
  const router = useRouter();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string>("gpt4o");
  const [showSettings, setShowSettings] = useState(false);
  const [argoUser, setArgoUser] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const hasKey = argoUser.trim().length > 0;

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
    const key = argoUser.trim();
    if (!trimmed || busy) return;
    if (!key) {
      setShowSettings(true);
      setError("Enter your Argo key in settings to use the assistant.");
      return;
    }
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
        body: JSON.stringify({ model, messages, user: key }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        data?: { reply?: string };
        error?: { message?: string };
      };
      if (!res.ok || !payload.ok || !payload.data?.reply) {
        setError(payload.error?.message ?? "The assistant is unavailable right now.");
      } else {
        const { text, target } = extractNavigation(payload.data.reply);
        setTurns((prev) => [...prev, { role: "assistant", content: text }]);
        if (target) {
          // Give the reply a moment to render before moving the user.
          window.setTimeout(() => router.push(target), 400);
        }
      }
    } catch {
      setError("Could not reach the assistant.");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [input, argoUser, busy, turns, pathname, model, router]);

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
            Your Argo key (required)
          </label>
          <input
            id="chat-argo-user"
            className="chat-settings-input"
            type="text"
            placeholder="Enter your Argo key"
            value={argoUser}
            onChange={(e) => persistUser(e.target.value)}
          />
          <p className="chat-settings-hint">
            The assistant routes through the Argo gateway using your own key. The
            server never supplies one. Your key is stored only in this browser and
            sent with each request you make.
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
              {hasKey ? (
                <>
                  Try: &ldquo;What does the Compare Mutations view show?&rdquo; or
                  &ldquo;Open the growth curves for me.&rdquo;
                </>
              ) : (
                <>
                  Add your Argo key in settings (gear icon) to start chatting. Your
                  key stays in this browser.
                </>
              )}
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
          placeholder={hasKey ? "Ask about the data..." : "Add your Argo key in settings first"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
        <button
          type="button"
          className="button button-primary button-sm chat-send"
          onClick={() => void send()}
          disabled={busy || !input.trim() || !hasKey}
        >
          Send
        </button>
      </div>
    </div>
  );
}
