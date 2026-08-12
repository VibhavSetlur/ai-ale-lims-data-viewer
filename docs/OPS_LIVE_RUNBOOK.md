# Live Ops Backend Runbook

Operator runbook for the mutable operational data plane: authenticated
researcher accounts, personal workspaces, and saved plate designs, served
alongside the existing read-only scientific viewer. Written to match what is
actually provisioned and verified on this host as of 2026-08-06.

## 1. What this backend is and is not

- This is a separate, small MySQL database (`aiale_ops`) that holds mutable
  operational data: user accounts (identified by ORCID), login sessions, and
  each user's workspaces and saved plate designs.
- It is not the scientific LIMS data source. All existing scientific data
  stays in the read-only prebaked SQLite mirror used by the main viewer
  (`src/lib/db.ts`, `SQLITE_PATH` / `MYSQL_URL`) and is untouched by this
  work. No scientific query or scientific UI was changed.
- It does not run on the same MySQL instance, conda env, port, or tmux
  session as anything else on this host. See section 3 for the exact
  topology and why that separation is a hard refusal in tooling, not just a
  convention.

## 2. One-time provisioning

These steps have already been run once on this host. They are documented
here so they can be reproduced on another host or re-run safely (every step
is idempotent).

### 2.1 Install MySQL in its own conda env

```
./ops/mysql-ops.sh install
```

This creates conda env `ai-ale-mysql` with conda-forge `mysql-server` and
`mysql-client` (both packages, in one `conda create` command; the
conda-forge `mysql-server` package alone ships no client binaries). It
verifies `mysqld`, `mysql`, and `mysqladmin` all exist in the new env's
`bin/` before reporting success. The scientific env `ai-ale-dev` is never
touched by this command; `mysql-ops.sh` hard-refuses to run against
`ai-ale-dev` or `ai-ale-viewer` for `MYSQL_ENV`.

Verified on this host: `ai-ale-mysql` env with conda-forge `mysql-server`
9.7.1 plus `mysql-client`.

### 2.2 Initialize the datadir and create the ops database

```
./ops/mysql-ops.sh init
```

This initializes a datadir under `/scratch/vsetlur/mysql-ops/data`,
starts `mysqld` bound to `127.0.0.1` on a loopback-only port, and creates
database `aiale_ops` and user `aiale_ops` with a generated password. The
password is written once to `/scratch/vsetlur/mysql-ops/ops-db-password`,
mode 600, and reused on subsequent runs. `init` never prints the password.

Verified on this host:
- Datadir: `/scratch/vsetlur/mysql-ops/data`
- Socket: `/scratch/vsetlur/mysql-ops/mysql.sock`
- TCP: `127.0.0.1:13306` (loopback only)
- Database: `aiale_ops`, user: `aiale_ops`
- Password file: `/scratch/vsetlur/mysql-ops/ops-db-password`, mode 600

Port 3306 on this host belongs to a different user's mysqld. `mysql-ops.sh`
hard-refuses to run with `MYSQL_PORT=3306` for exactly this reason. Never
point this tooling at 3306.

### 2.3 Write the config file

Create `/scratch/vsetlur/ai-ale-lims-data-viewer/.env.live`, mode 600. It is
covered by the `.env*` rule in `.gitignore` and is never committed. Get the
connection URL from:

```
./ops/mysql-ops.sh url
```

`.env.live` holds:
- `OPS_DB_URL` (the ops-only MySQL connection URL; never the scientific
  `MYSQL_URL`)
- `OPS_SESSION_PEPPER`, 32+ characters, generated with `openssl rand -hex 32`
- `OPS_SESSION_TTL_HOURS=720`
- Four commented-out `ORCID_*` placeholders (see section 4)

### 2.4 Apply migrations

Run from the repo root, with `.env.live` sourced into the shell:

```
source /scratch/vsetlur/anaconda3/etc/profile.d/conda.sh && conda activate ai-ale-dev
set -a && . ./.env.live && set +a
npm run ops:migrate
```

`./ops/_run-live.sh` ignores any arguments passed to it and always execs
`npm start`; it cannot be used to run migrations and will fail with
`EADDRINUSE` on 3458 if the live instance is already running. Use the
`npm run ops:migrate` invocation above instead.

This applies, in order: `0001_ops_core`, `0002_auth_pkce`, `0003_local_auth`,
`0004_assistant`, against `OPS_DB_URL`. All four are idempotent
(`CREATE TABLE IF NOT EXISTS`); re-running the command prints
`already recorded, skipping` for each migration already applied.

Verified tables: `ops_schema_migration`, `ops_user`, `ops_session`,
`ops_auth_state` (includes a `code_verifier` column for PKCE), `ops_workspace`,
`ops_plate_design`, `ops_conversation`, `ops_conversation_message`,
`ops_assistant_proposal`.

## 3. Day-to-day operation

### 3.1 MySQL control

```
./ops/mysql-ops.sh status   # running/stopped, port, socket, datadir, conda env
./ops/mysql-ops.sh start
./ops/mysql-ops.sh stop
./ops/mysql-ops.sh client   # interactive mysql shell as root, via the socket
```

### 3.2 Runtime topology (read this before touching either instance)

- Production scientific viewer: tmux session `ai-ale-viewer`, port 3457,
  default `.next` build directory. This is the existing, unrelated viewer.
  Never stop it, never build into `.next` for ops work, never point
  `ops/serve-live.sh` at it.
- Isolated live ops instance: tmux session `ai-ale-live`, bound to
  `127.0.0.1:3458`, build directory `.next-live` (via `NEXT_DIST_DIR`).
  Started with `ops/serve-live.sh`, stopped with `ops/stop-live.sh`. Both
  scripts hard-refuse to run with settings that collide with the production
  instance (port 3457, session `ai-ale-viewer`, or dist dir `.next`).

### 3.3 Build and restart the 3458 instance

Every build for this instance must set `NEXT_DIST_DIR` explicitly. A plain
`npm run build` writes to `.next` and would overwrite the production
instance's build artifacts.

```
NEXT_DIST_DIR=.next-live npm run build
./ops/stop-live.sh
./ops/serve-live.sh
```

`ops/serve-live.sh` builds `.next-live` automatically if it is missing or
stale, but running the build explicitly first makes failures visible before
a restart.

### 3.4 Health checks

```
curl -s http://127.0.0.1:3458/api/health
curl -s http://127.0.0.1:3458/api/ops/status
```

`/api/ops/status` reports whether the ops database and ORCID auth are
configured (`dbConfigured`, `authConfigured`) and lists any missing
variables in `problems`, without ever printing a secret value.

## 4. ORCID registration: the one remaining manual step

Everything above is provisioned and verified. The only step left before a
real user can sign in with ORCID is registering an ORCID API client and
filling in its credentials. This has not been done yet, on purpose: it
requires an ORCID account and a decision about which ORCID environment
(sandbox vs. production) and which redirect URI to use.

### 4.1 Register the ORCID application

1. Sign in at `https://orcid.org` (or `https://sandbox.orcid.org` for a
   sandbox test account and app, recommended for first-time testing).
2. Go to the developer tools / API credentials page for your account
   (under account settings) and register a new public API client.
3. Set its redirect URI. Because the 3458 instance is loopback-only
   (`127.0.0.1`), an operator testing from a separate workstation should
   open an SSH local port-forward to this host first, for example:
   ```
   ssh -L 3458:127.0.0.1:3458 <this-host>
   ```
   Then register the redirect URI matching whatever origin the browser
   actually sees (for example `http://127.0.0.1:3458/api/auth/orcid/callback`
   if forwarded to loopback, or an `https://` origin if fronted by a proxy).
   The exact same value must be set as `ORCID_REDIRECT_URI` below. ORCID
   requires an exact match; there is no wildcard.

### 4.2 Fill in `.env.live`

Uncomment and set these four variables (exact names and validation rules
from `readOrcidConfig` / `opsStatus` in `src/lib/ops/config.ts`):

- `ORCID_CLIENT_ID`: required, the client ID from the registered app.
- `ORCID_CLIENT_SECRET`: required, the client secret from the registered
  app. Never log or print it.
- `ORCID_REDIRECT_URI`: required, must exactly match the redirect URI
  registered with ORCID in step 4.1.
- `ORCID_BASE`: optional. Defaults to `https://orcid.org` when unset. Set
  it to `https://sandbox.orcid.org` to use the ORCID sandbox instead of
  production ORCID. There is no separate "environment" flag; this base URL
  is the sandbox/production switch.

Note: `ORCID_REDIRECT_URI` starting with `https://` is what flips the
session cookie to `Secure` (`secureCookie` in `readSessionConfig`). A
loopback `http://127.0.0.1:3458/...` redirect URI is fine for local testing
but will not set `Secure` on the session cookie.

### 4.3 Restart and verify

```
NEXT_DIST_DIR=.next-live npm run build
./ops/stop-live.sh
./ops/serve-live.sh
curl -s http://127.0.0.1:3458/api/ops/status
```

`authConfigured` must now be `true` with an empty `problems` list (or only
unrelated problems). Then:

```
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3458/api/auth/orcid/start
```

This must return `302` (redirect to ORCID) instead of `503` with
`not_configured`.

## 5. Verified without ORCID: the dev session fixture

The full workspace and plate-design API surface was end-to-end verified on
this host before any ORCID application existed, using a test-only session
minting script:

```
node scripts/ops-dev-session.mjs
```

This reads `OPS_DB_URL` and `OPS_SESSION_PEPPER` from the environment,
creates (or reuses) a test user and a valid session row directly in the ops
database, and prints a single cookie string of the form
`aiale_ops_session=<token>`. Set that as a cookie in a browser or pass it
with `curl -b` to exercise authenticated routes without going through
ORCID.

This is a test fixture only, not a production login path. It exists purely
to let the workspace/session/design plumbing be verified before ORCID
registration is complete. Do not wire it into any UI or leave it reachable
from a production entry point.

### 5.1 Local email/password accounts

Users can also register and sign in with an email and password at
`/login` on `127.0.0.1:3458`, independent of ORCID. Passwords are never
stored in plaintext; only salted scrypt hashes are written to `ops_user`.
ORCID remains optional and config-gated: when the ORCID environment
variables are absent, local email/password sign-in is still fully
functional.

### 5.2 Dev seed account (gated, not for `.env.live`)

A seed script can create a standing local test account for manual
verification:

```
set -a && . ./.env.live && set +a
OPS_SEED_DEV_ACCOUNT=1 npm run ops:seed-dev
```

This creates or updates the account `test@gmail.com` with password
`test`. It is idempotent: running it again updates the same account
rather than creating a duplicate. When `OPS_SEED_DEV_ACCOUNT` is not set,
the script skips with exit code `0` and makes no changes. The script also
refuses to run when `NODE_ENV=production`.

`OPS_SEED_DEV_ACCOUNT` must never be set in `.env.live` or `.env.example`.
Set it only inline on the command line for a one-off seed run.

## 6. Troubleshooting

- `503 not_configured` from any `/api/auth/orcid/*` or `/api/ops/*` route:
  one or more required environment variables are missing. Check
  `curl -s http://127.0.0.1:3458/api/ops/status` for the `problems` list.
- `503 db_unavailable`: `mysqld` is not reachable. Check
  `./ops/mysql-ops.sh status` and restart it with
  `./ops/mysql-ops.sh start` if stopped.
- `403 cross_origin`: a mutating request (POST/PUT/DELETE) arrived without
  a same-origin `Origin` or `Sec-Fetch-Site` header. This is the
  same-origin write guard (`src/lib/ops/csrf.ts`) rejecting a
  cross-site request; it is not a bug to work around by removing the
  header check.
- `401 unauthenticated`: the request has no session cookie, or the cookie's
  session is expired or revoked. Sign in again (ORCID flow, or mint a fresh
  test session per section 5).

## 7. Related: viewer Argo proxy (127.0.0.1:3459)

A separate, independent pass-through proxy for calling Argo-hosted models
(Claude and GPT families) lives under `ops/argo-viewer-proxy/`. It is not
part of the live ops server described above and does not touch this
server's ports, database, or session state. See
`docs/OPS_ARGO_PROXY.md` for start/stop commands, the health check, the
model allowlist, and the port isolation rules.
