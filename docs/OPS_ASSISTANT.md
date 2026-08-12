# AI-ALE Assistant

The assistant is an optional chat sidebar in the ops (MySQL-backed) sign-in
surface. It can read scientific and workspace data through a fixed tool
allowlist and it can propose plate design changes, but it can never write
anything without a human clicking Apply.

## Enablement variables

Set these as server environment variables. All are read once at request time
by `src/lib/ops/config.ts` (`readAssistantConfig`); there is no client-side
override.

- `ASSISTANT_ENABLED=1` turns the feature on. Any other value, or leaving it
  unset, keeps the assistant fully disabled and `/api/ops/assistant/status`
  reports `enabled: false`.
- `ASSISTANT_PROXY_URL` is the local model proxy the server talks to.
  Default `http://127.0.0.1:3459`. This must resolve to loopback. The proxy
  is never reachable from outside the host, and the status route confirms it
  is alive with a `GET /health` call before the panel is marked ready.
- `ASSISTANT_MODEL` is the default chat model. Default `gpt5mini`. A caller
  may override the model per message, but the server still enforces the tool
  allowlist and confirmation rules below regardless of model.
- `ASSISTANT_TIMEOUT_MS` bounds how long the server waits on the proxy for a
  reply. Default `120000` (120 seconds).

If `ASSISTANT_ENABLED` is not set, or the proxy health check fails, the panel
shows a plain explanation naming both of these facts. There is no error
styling or alarming language for this expected, common state.

## Key handling contract

The assistant needs an Argo API key to make model calls, and that key is
never something this application stores.

- The signed-in user types the key into a password-type field in the
  browser. The value lives only in React component state for that browser
  tab.
- The key is never written to `localStorage`, `sessionStorage`, a cookie, or
  a URL. It is not logged on the client or the server.
- Every message send attaches the key as the `X-Argo-Key` request header on
  that one request only (`POST /api/ops/assistant/conversations/<id>/messages`).
  No other request carries it.
- The server uses the header value to call the model proxy for that single
  request and does not persist it. It is never written to the operational
  database. Reply text is scanned and any accidental echo of the key is
  redacted before it is stored or returned.
- Closing the tab, reloading the page, or clicking "Clear key" in the panel
  erases the key. The user must enter it again to keep using the assistant.

## Tool allowlist

The assistant can only call the following fixed tools (`src/lib/ops/assistant/tools.ts`).
There is no general code execution path, so this list is exhaustive:

- `list_experiments`
- `get_experiment_summary`
- `search_mutations`
- `list_workspaces`
- `list_designs`
- `get_design`
- `propose_design_change`

Scientific reads (`list_experiments`, `get_experiment_summary`,
`search_mutations`) query the read-only SQLite scientific database. Workspace
reads (`list_workspaces`, `list_designs`, `get_design`) are scoped to the
signed-in user's own workspaces and designs only; the assistant cannot see
another user's data. `propose_design_change` does not write anything itself,
it only creates a pending proposal row for the human to review.

## Conversation cap

Each user may keep at most 5 conversations at a time (`MAX_CONVERSATIONS` in
`src/lib/ops/repo.ts`). Creating a sixth conversation returns HTTP 409 with
code `conversation_limit`; the panel disables the create control at the cap
and shows the server's message verbatim. Delete an existing conversation to
free a slot.

## Human confirmation for writes

`propose_design_change` never modifies a design directly. It stores a
pending proposal and returns its id and a plain-language summary to the
chat. The panel renders that summary with `Apply` and `Dismiss` buttons.
Nothing is written to a design until the user clicks `Apply`, which calls
`POST /api/ops/assistant/proposals/<id>`. Clicking `Dismiss` calls
`DELETE /api/ops/assistant/proposals/<id>` and discards the proposal. There
is no automatic, timed, or background path that applies a proposal without
that click.

## What the assistant cannot do

The assistant has no shell tool, no HTTP request tool, no raw SQL tool, and
no filesystem tool. Because the tool allowlist above is the complete set of
functions it can call, there is no code path by which a chat message can
result in executing a command, reaching an arbitrary URL, running arbitrary
SQL, or reading or writing an arbitrary file. If a user asks it to run a
command, the system prompt instructs it to return the command as plain,
non-executing text and to state that a human must run it themselves.
