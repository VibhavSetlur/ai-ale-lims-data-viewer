'use client';

// AI-ALE assistant sidebar. Renders one of four states depending on sign-in,
// server enablement, and whether an Argo key has been entered this session.
//
// The Argo key never leaves React state (see `apiKey` below): it is sent as
// the `X-Argo-Key` header on the send-message request only, never written to
// browser storage, a cookie, or a URL, and never logged.
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, KeyRound, LogIn, Send, Trash2 } from 'lucide-react';
import { fetchData, IS_STATIC } from '../../lib/dataSource';
import { LOGIN_PATH } from '../../lib/routes';
import { useOpsIdentity } from '../../lib/ops/useOpsIdentity';

type StatusBody = {
  enabled: boolean;
  proxyReachable: boolean;
  defaultModel: string | null;
  maxConversations: number;
  keyRequired: boolean;
};

type Conversation = {
  id: string;
  owner_user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type Message = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
};

type Proposal = { id: string; summary: string };

type StatusState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; status: StatusBody };

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.error?.message || `HTTP ${res.status}`;
}

export default function AssistantPanel() {
  const { state: identityState } = useOpsIdentity();
  const [statusState, setStatusState] = useState<StatusState>({ phase: 'loading' });

  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [modelsReachable, setModelsReachable] = useState(true);
  const [model, setModel] = useState('');

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creatingConversation, setCreatingConversation] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [proposalBusyId, setProposalBusyId] = useState<string | null>(null);
  const [proposalOutcome, setProposalOutcome] = useState<Record<string, string>>({});

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const threadRef = useRef<HTMLDivElement | null>(null);

  const canUseAssistant = identityState === 'signedIn' && !IS_STATIC;

  // Load status once we know the user is signed in.
  useEffect(() => {
    if (!canUseAssistant) return;
    let cancelled = false;
    (async () => {
      setStatusState({ phase: 'loading' });
      try {
        const res = await fetchData('/api/ops/assistant/status', { credentials: 'same-origin' });
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setStatusState({ phase: 'error', message: body?.error?.message || `HTTP ${res.status}` });
          return;
        }
        setStatusState({ phase: 'ready', status: body.data });
      } catch (err) {
        if (!cancelled) {
          setStatusState({ phase: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [canUseAssistant]);

  const assistantReady = statusState.phase === 'ready' && statusState.status.enabled && statusState.status.proxyReachable;
  const hasKey = apiKey.trim().length > 0;

  // Load the conversation list once a key has been entered and the assistant is ready.
  useEffect(() => {
    if (!assistantReady || !hasKey) return;
    let cancelled = false;
    (async () => {
      setConversationsError(null);
      try {
        const res = await fetchData('/api/ops/assistant/conversations', { credentials: 'same-origin' });
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setConversationsError(body?.error?.message || `HTTP ${res.status}`);
          return;
        }
        setConversations(body?.data?.conversations ?? []);
        setConversationsLoaded(true);
      } catch (err) {
        if (!cancelled) setConversationsError(err instanceof Error ? err.message : 'Unknown error');
      }
    })();
    return () => { cancelled = true; };
  }, [assistantReady, hasKey]);

  // Load the model list once the assistant is ready. No key is required.
  useEffect(() => {
    if (!assistantReady) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchData('/api/ops/assistant/models', { credentials: 'same-origin' });
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setModels([]);
          setModelsReachable(false);
          return;
        }
        const nextModels: string[] = body?.data?.models ?? [];
        setModels(nextModels);
        setModelsReachable(body?.data?.reachable === true);
        setModel((prev) => {
          if (prev && nextModels.includes(prev)) return prev;
          const fallback = body?.data?.defaultModel;
          if (typeof fallback === 'string' && nextModels.includes(fallback)) return fallback;
          return nextModels[0] ?? '';
        });
      } catch {
        if (!cancelled) {
          setModels([]);
          setModelsReachable(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [assistantReady]);

  // Load the active conversation's messages.
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setMessagesError(null);
      try {
        const res = await fetchData(`/api/ops/assistant/conversations/${encodeURIComponent(activeId)}`, { credentials: 'same-origin' });
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setMessagesError(body?.error?.message || `HTTP ${res.status}`);
          return;
        }
        setMessages(body?.data?.messages ?? []);
      } catch (err) {
        if (!cancelled) setMessagesError(err instanceof Error ? err.message : 'Unknown error');
      }
    })();
    return () => { cancelled = true; };
  }, [activeId]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  async function refreshConversations() {
    try {
      const res = await fetchData('/api/ops/assistant/conversations', { credentials: 'same-origin' });
      const body = await res.json().catch(() => null);
      if (res.ok) setConversations(body?.data?.conversations ?? []);
    } catch {
      // Best-effort refresh; existing list stays visible on failure.
    }
  }

  async function createConversation() {
    setCreatingConversation(true);
    setConversationsError(null);
    try {
      const res = await fetchData('/api/ops/assistant/conversations', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setConversationsError(body?.error?.message || `HTTP ${res.status}`);
        return;
      }
      const conversation: Conversation = body.data.conversation;
      setConversations((prev) => [conversation, ...prev]);
      setActiveId(conversation.id);
    } catch (err) {
      setConversationsError(err instanceof Error ? err.message : 'Could not create conversation.');
    } finally {
      setCreatingConversation(false);
    }
  }

  async function deleteConversation(id: string) {
    try {
      const res = await fetchData(`/api/ops/assistant/conversations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok && res.status !== 204) {
        setConversationsError(await readError(res));
        return;
      }
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) setActiveId(null);
    } catch (err) {
      setConversationsError(err instanceof Error ? err.message : 'Could not delete conversation.');
    }
  }

  async function sendMessage() {
    const content = draft.trim();
    if (!content || !activeId || sending) return;
    setSending(true);
    setSendError(null);
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, conversation_id: activeId, role: 'user', content, created_at: new Date().toISOString() },
    ]);
    setDraft('');
    try {
      const payload: { content: string; model?: string } = { content };
      const chosen = model.trim();
      if (chosen) payload.model = chosen;
      const res = await fetchData(`/api/ops/assistant/conversations/${encodeURIComponent(activeId)}/messages`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Argo-Key': apiKey },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setSendError(body?.error?.message || `HTTP ${res.status}`);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `local-reply-${Date.now()}`,
          conversation_id: activeId,
          role: 'assistant',
          content: body.data.message,
          created_at: new Date().toISOString(),
        },
      ]);
      const newProposals: Proposal[] = body.data.proposals ?? [];
      if (newProposals.length > 0) setProposals((prev) => [...prev, ...newProposals]);
      void refreshConversations();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Message failed to send.');
    } finally {
      setSending(false);
    }
  }

  async function applyProposal(id: string) {
    setProposalBusyId(id);
    try {
      const res = await fetchData(`/api/ops/assistant/proposals/${encodeURIComponent(id)}`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setProposalOutcome((prev) => ({ ...prev, [id]: body?.error?.message || `HTTP ${res.status}` }));
      } else {
        setProposalOutcome((prev) => ({ ...prev, [id]: `Applied as "${body?.data?.design?.name ?? 'design'}".` }));
      }
    } catch (err) {
      setProposalOutcome((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : 'Could not apply proposal.' }));
    } finally {
      setProposalBusyId(null);
      setTimeout(() => setProposals((prev) => prev.filter((p) => p.id !== id)), 1500);
    }
  }

  async function dismissProposal(id: string) {
    setProposalBusyId(id);
    try {
      const res = await fetchData(`/api/ops/assistant/proposals/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok && res.status !== 204) {
        const message = await readError(res);
        setProposalOutcome((prev) => ({ ...prev, [id]: message }));
        setProposalBusyId(null);
        setTimeout(() => setProposals((prev) => prev.filter((p) => p.id !== id)), 1500);
        return;
      }
      setProposals((prev) => prev.filter((p) => p.id !== id));
      setProposalBusyId(null);
    } catch (err) {
      setProposalOutcome((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : 'Could not dismiss proposal.' }));
      setProposalBusyId(null);
      setTimeout(() => setProposals((prev) => prev.filter((p) => p.id !== id)), 1500);
    }
  }

  // State 1: not signed in.
  if (identityState !== 'signedIn') {
    return (
      <div className="flex-1 p-4 text-sm text-[var(--text-soft)]">
        <p className="mb-2">Sign in to use the assistant.</p>
        <a href={LOGIN_PATH} className="lims-btn lims-btn-primary inline-flex items-center gap-1.5">
          <LogIn className="w-3.5 h-3.5" />
          Go to sign-in
        </a>
      </div>
    );
  }

  // Status still loading.
  if (statusState.phase === 'loading') {
    return (
      <div className="flex-1 p-4 text-sm text-[var(--text-soft)]">
        <p>Checking assistant status&hellip;</p>
      </div>
    );
  }

  if (statusState.phase === 'error') {
    return (
      <div className="flex-1 p-4 text-sm text-[var(--text-soft)]">
        <p>Could not check assistant status: {statusState.message}</p>
      </div>
    );
  }

  // State 2: disabled or proxy unreachable.
  if (!statusState.status.enabled || !statusState.status.proxyReachable) {
    return (
      <div className="flex-1 p-4 text-sm text-[var(--text-soft)]">
        <p className="mb-2">
          The assistant is not available on this instance. It is enabled with the
          <code className="mx-1 px-1 rounded bg-[var(--surface-2)] text-[var(--text)]">ASSISTANT_ENABLED</code>
          server variable, and it also requires the local model proxy on port 3459 to answer its health check.
        </p>
        <p>Ask whoever runs this server to check both.</p>
      </div>
    );
  }

  // State 3: ready but no key entered this session.
  if (!hasKey) {
    return (
      <div className="flex-1 p-4 text-sm text-[var(--text)] flex flex-col gap-2">
        <label htmlFor="assistant-argo-key" className="lims-label flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5" />
          Argo key (this browser session only)
        </label>
        <input
          id="assistant-argo-key"
          type="password"
          className="lims-input"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Paste your Argo key"
        />
        <p className="text-xs text-[var(--text-soft)]">
          The key is never stored on the server or in the browser. It stays in memory for this tab and is
          sent only with each message you send.
        </p>
      </div>
    );
  }

  // State 4: ready.
  const atCap = conversations.length >= statusState.status.maxConversations;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="p-3 border-b border-[var(--border)] flex items-center gap-2">
        <span className="text-xs text-[var(--text-soft)] flex-1">
          {conversations.length}/{statusState.status.maxConversations} conversations
        </span>
        <button
          className="lims-btn lims-btn-secondary"
          disabled={atCap || creatingConversation}
          onClick={() => void createConversation()}
          title={atCap ? 'Delete a conversation to start another.' : 'New conversation'}
        >
          New
        </button>
        {models.length > 0 ? (
          <select
            className="lims-input"
            aria-label="Assistant model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {models.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-[var(--text-faint)]">
            {modelsReachable ? 'No models configured' : 'Model list unavailable, using server default'}
          </span>
        )}
        <button
          className="lims-btn lims-btn-ghost"
          onClick={() => setApiKey('')}
          title="Clear key"
        >
          Clear key
        </button>
      </div>

      {conversationsError && (
        <p className="px-3 pt-2 text-xs text-red-600">{conversationsError}</p>
      )}

      {!activeId ? (
        <div className="flex-1 min-h-0 overflow-auto p-3">
          {conversationsLoaded && conversations.length === 0 ? (
            <p className="text-sm text-[var(--text-soft)]">No conversations yet. Start one above.</p>
          ) : (
            <ul className="space-y-1.5">
              {conversations.map((c) => (
                <li key={c.id}>
                  <button
                    className="lims-btn lims-btn-ghost w-full justify-between text-left"
                    onClick={() => setActiveId(c.id)}
                  >
                    <span className="truncate">{c.title}</span>
                    <Trash2
                      className="w-3.5 h-3.5 text-[var(--text-faint)] shrink-0"
                      onClick={(e) => { e.stopPropagation(); void deleteConversation(c.id); }}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div className="px-3 py-1.5 border-b border-[var(--border)] flex items-center gap-2">
            <button className="lims-btn lims-btn-ghost" onClick={() => setActiveId(null)}>
              Back
            </button>
          </div>

          <div ref={threadRef} className="flex-1 min-h-0 overflow-auto p-3 space-y-2">
            {messagesError && <p className="text-xs text-red-600">{messagesError}</p>}
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === 'user'
                    ? 'ml-6 rounded-lg bg-[var(--accent-50)] text-[var(--text)] px-2.5 py-1.5 text-sm'
                    : 'mr-6 rounded-lg bg-[var(--surface-2)] text-[var(--text)] px-2.5 py-1.5 text-sm'
                }
              >
                {m.content}
              </div>
            ))}

            {proposals.map((p) => (
              <div key={p.id} className="lims-panel rounded-lg border border-[var(--border)] p-2.5">
                <p className="text-xs font-semibold text-[var(--text)] mb-1 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-[var(--accent-600)]" />
                  Proposed change
                </p>
                <p className="text-sm text-[var(--text)] mb-2">{p.summary}</p>
                {proposalOutcome[p.id] ? (
                  <p className="text-xs text-[var(--text-soft)]">{proposalOutcome[p.id]}</p>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      className="lims-btn lims-btn-primary"
                      disabled={proposalBusyId === p.id}
                      onClick={() => void applyProposal(p.id)}
                    >
                      Apply
                    </button>
                    <button
                      className="lims-btn lims-btn-ghost"
                      disabled={proposalBusyId === p.id}
                      onClick={() => void dismissProposal(p.id)}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            ))}

            {sending && <p className="text-xs text-[var(--text-soft)]">Assistant is thinking&hellip;</p>}
          </div>

          <div className="p-3 border-t border-[var(--border)]">
            {sendError && <p className="text-xs text-red-600 mb-1.5">{sendError}</p>}
            <div className="flex items-end gap-1.5">
              <textarea
                className="lims-input flex-1 resize-none"
                rows={2}
                value={draft}
                disabled={sending}
                placeholder="Ask the assistant"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
              />
              <button
                className="lims-btn lims-btn-primary p-2"
                disabled={sending || draft.trim().length === 0}
                onClick={() => void sendMessage()}
                title="Send"
                aria-label="Send"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
