# Viewer Argo proxy (127.0.0.1:3459)

## Purpose

A small standalone pass-through proxy that lets viewer-side tooling call
Argo-hosted models (Claude and GPT families) through one local, OpenAI
compatible endpoint. It lives entirely under `ops/argo-viewer-proxy/` in
this repo.

## Why this is separate from the reference proxy on 4000

`/scratch/vsetlur/argo-proxy/argo_proxy.py` is a separate, pre-existing
tool that also talks to Argo, on port 4000. It is read-only reference
material for this service and is never started, stopped, signaled, or
modified from here. The two proxies:

- run on different ports (3459 here, 4000 for the reference proxy)
- run from different scripts (`viewer_argo_proxy.py` here,
  `argo_proxy.py` for the reference)
- are managed by different tmux sessions (`ai-ale-argo` here)
- share no code and no process

This isolation means stopping or restarting this proxy can never affect
the reference proxy, and vice versa.

## Security property: this service stores no key

This proxy holds no Argo credential anywhere: not in `config.yaml`, not in
an environment variable, not on disk, not in memory beyond a single
request's lifetime. Every call to `POST /v1/chat/completions` must include
the caller's own key as `Authorization: Bearer <key>`. That key is
forwarded upstream as both `Authorization: Bearer <key>` and
`x-api-key: <key>` for the duration of that one request only, and is never
written to a log line or an error response body. There is no default
user and no environment fallback.

## Port isolation

- Bind host is hard-coded to `127.0.0.1` (loopback only).
- Listening port comes from `VIEWER_ARGO_PORT`, default `3459`.
- The proxy refuses to start (non-zero exit, no socket bound) if the port
  is `3457`, `3458`, `3306`, `13306`, or `4000`. Those are reserved for the
  viewer server, the ops server, MySQL, the MySQL tunnel, and the
  reference Argo proxy respectively.

## Start and stop

Start (creates tmux session `ai-ale-argo`):

```
./ops/argo-viewer-proxy/serve-argo.sh
```

The script refuses to start if session `ai-ale-argo` already exists or if
port 3459 is already listening. It does not source `.env.live` and does
not export any Argo credential.

Stop:

```
./ops/argo-viewer-proxy/stop-argo.sh
```

This only kills the `ai-ale-argo` tmux session and any stray process whose
command line names `viewer_argo_proxy.py`. It can never match the
reference proxy, which runs a different script (`argo_proxy.py`) from a
different directory.

## Health check

```
curl -s http://127.0.0.1:3459/health
```

Expected shape:

```
{"status":"ok","service":"aiale-viewer-argo-proxy","port":3459,"upstream":"https://apps.inside.anl.gov/argoapi","models":23}
```

No authentication is required for `/health` or `GET /v1/models`.

## Model allowlist

```
curl -s http://127.0.0.1:3459/v1/models
```

Aliases accepted on `/v1/chat/completions`:

- Claude family: `opus`, `opus48`, `claudeopus48`, `claudesonnet46`,
  `claudesonnet45`, `claudehaiku45`
- GPT family: `gpt55`, `gpt54`, `gpt54mini`, `gpt54nano`, `gpt52`, `gpt51`,
  `gpt5`, `gpt5mini`, `gpt5nano`, `gpt41`, `gpt41mini`, `gpt41nano`,
  `gpt4o`, `gpto4mini`, `gpto3`, `gpto3mini`, `gpto1`

Any other model name is rejected with `400 unsupported_model` and the
allowed list. Unknown names are never silently prefixed or guessed.

## Curl chat test

Replace `<your-argo-key>` with your own key; the proxy never stores it.

```
curl -s http://127.0.0.1:3459/v1/chat/completions \
  -H "Authorization: Bearer <your-argo-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt4o","messages":[{"role":"user","content":"say hi"}]}'
```

A request with no `Authorization` header, or a malformed one, returns
`401 {"error":{"code":"missing_api_key"}}` before any upstream call is
attempted.

## Other operational behavior

- Concurrency is capped by `VIEWER_ARGO_MAX_CONCURRENCY` (default 16).
  When saturated, the proxy returns `503 {"error":{"code":"proxy_busy"}}`
  with `Retry-After: 2` instead of queueing without bound.
- Upstream timeout is `VIEWER_ARGO_TIMEOUT` seconds (default 300). Prod is
  tried first, with failover to staging on a 5xx, network error, or
  timeout.
- Request bodies over 1 MiB are rejected with `413`.
- Logging is one line per request (method, path, status, duration,
  resolved model). Headers, keys, and message content are never logged.

## Route contract

| Path | Methods | Auth | Forwarded upstream |
| --- | --- | --- | --- |
| `/health` | GET, HEAD | none | no |
| `/v1/models` | GET, HEAD | none | no, generated locally from the config allowlist |
| `/v1/chat/completions` | POST | `Authorization: Bearer <key>` required | yes |
| any other path | GET, HEAD, POST | n/a | no, 404 `{"error":{"code":"not_found"}}` |
| any path | OPTIONS | none | no, 204 |
| any path | PUT, DELETE, PATCH, TRACE, CONNECT, or any other verb | none | no, 405 `{"error":{"code":"method_not_allowed"}}` with an `Allow` header |

Common mistakes:

- The health path is `/health`. It is NOT `/healthz`, NOT `/api/health`,
  and NOT `/`. Requests to those paths correctly return 404 by design.
- `/v1/models` is generated locally from the config allowlist and needs
  no key.
- Only `POST /v1/chat/completions` requires `Authorization: Bearer <YOUR_KEY>`.

```
curl -s http://127.0.0.1:3459/health
curl -s http://127.0.0.1:3459/v1/models
```
