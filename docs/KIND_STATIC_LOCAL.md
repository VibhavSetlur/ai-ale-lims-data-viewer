# Local KIND static launcher

This is provisional local tooling, not KIND catalog registration or a deployed
viewer. It serves a separately exported, sealed bundle using only Python 3.10+
and its standard library on Linux. Node, npm, live LIMS access and the repository
checkout are not needed at serving time. This `static-dev` source packages only
`ai_ale_kind_static`; it does not include a server-mode KIND adapter. The Python
distribution name and version `0.0.0` remain provisional until Gavin supplies
the authoritative KIND identity. Viewer version and data snapshot are separate.

## Commands

After installing the code-only wheel in an approved isolated environment:

```sh
ai-ale-lims-viewer-kind-static info
ai-ale-lims-viewer-kind-static doctor --bundle /path/to/bundle --root-path /user/me/proxy/9000
ai-ale-lims-viewer-kind-static serve --bundle /path/to/bundle --root-path /user/me/proxy/9000 --port 9000 --no-king
```

`python -m ai_ale_kind_static` provides the same commands. `--bundle` overrides
`AI_ALE_KIND_STATIC_BUNDLE`. There is no default checkout artifact lookup.
`--no-king` is accepted for compatibility; neither its presence nor its absence
registers anything. The host is fixed to loopback. Ports must be 1 through 65535.
Errors return nonzero status with an actionable message.

The runtime root path **must equal the compiled bundle prefix**. Use
`--root-path ''` for an export compiled at root, not `/`. Nested paths must be
normalized, without a trailing slash or encoded/dot segments. No HTML, JS,
RSC, data or HTTPVFS URL rewriting occurs. A distinct prefix requires a distinct
export. `info` is tooling information, not an authoritative KIND manifest.

## Local seal v1

Put `kind-static-bundle.json` at the bundle root. Its schema is deliberately
local and provisional. Example structure (replace hashes with actual values):

```json
{
  "schema": "kind-static-bundle/v1",
  "viewer_version": "1.15.1",
  "source": {"commit": "40 lowercase hex characters from the actual source", "label": "local-synthetic-proof"},
  "compiled_prefix": "/user/me/proxy/9000",
  "mode": "static",
  "channel": "kind-local",
  "data": {
    "id": "synthetic-example",
    "manifest": "data/manifest.json",
    "manifest_sha256": "64 lowercase hex characters"
  },
  "files": {
    "index.html": {"size": 123, "sha256": "64 lowercase hex characters"},
    "data/manifest.json": {"size": 45, "sha256": "64 lowercase hex characters"}
  }
}
```

The source SHA is asserted provenance, not cryptographic source authentication.
Synthetic IDs use `synthetic-...`. Local real-data IDs use `lims-<sha256>` and
must match `data/manifest.json` snapshot SHA-256. This permits authorized local
verification, not external redistribution. The manifest itself and
`index.html` must be inventoried. Inventory every regular file by relative POSIX
path, byte size and SHA-256, excluding the seal itself. Unsealed files, symlinks,
unsafe paths, missing files, malformed metadata and incorrect digests fail before
binding. Absolute filesystem paths are not included in readiness identity.

Maintain bundle ownership and permissions so it cannot be modified while served.
Validation hashes in bounded chunks at startup; serving checks the validated
file's device/inode/size/mtime/ctime and opens each component with `O_NOFOLLOW`.
This prevents normal post-validation replacement and symlink escape. It is not
an authenticity signature or protection against a hostile process with write
access racing an already-open file. No serving operation writes to the bundle.

## HTTP behavior

- Readiness: `<prefix>/api/kind-ready`, GET or HEAD, JSON validated identity and
  `Cache-Control: no-store`. Identity describes startup validation, not a
  continuous full-bundle integrity scan.
- `<prefix>` redirects with 308 to `<prefix>/`, preserving the query.
- Directory routes serve only an inventoried `index.html`; extensionless
  directory routes redirect to a trailing slash. No listing or SPA fallback.
- Missing assets/JSON/routes and outside-prefix paths return 404. Malformed or
  traversal paths return 400. Changed/unavailable sealed files return 503.
- GET/HEAD have consistent MIME, length, SHA-256 ETag and Last-Modified headers.
  HEAD never emits a body. Conditional requests support 304 and If-Range.
- Single `bytes=start-end`, `bytes=start-` and `bytes=-suffix` ranges return 206.
  Unsatisfiable, malformed and multiple ranges return 416 with `bytes */size`.
  Unknown range units are also rejected with 416. Large responses stream in
  64 KiB chunks. Gzipped files remain compressed bytes, without transparent
  decompression or Content-Encoding.
- SIGTERM or Ctrl-C stops accepting requests and closes the listener. Request
  workers are daemon threads and are not drained during shutdown.

## Local verification

```sh
python -B -m unittest discover -s tests/kind_static -v
python scripts/seal-kind-static.py --help
git diff --check
```

Fixtures are entirely synthetic, including the byte-range file. Tests cover
root and two separately sealed nested prefixes, real HTTP, concurrent reads,
cache validators, missing assets, unsafe paths, symlink replacement, occupied
port errors and subprocess signal shutdown with Node/npm absent from PATH.

## Static-dev source and local artifacts

`static-dev` is the development source. `static` alone is the accepted production
lineage. `dynamic-dev`, `dynamic`, and historical `main` are not changed by this
workflow; `dev` is never a release source. A local development build is not a
production deployment. The approved ModelSEED prefix guard remains unchanged.
The runtime prefix must match the compiled prefix, including when used behind
KIND. Gavin must confirm the actual proxy prefix before an external KIND build.

Use the declared `ai-ale-dev` environment and a worktree-local server and port.
Provide absolute source and destination paths to the guarded refresh script:

```sh
bash ops/refresh-db.sh /approved/read-only/mirror.db "$PWD/data/lims_indexed.db"
# Prepare HTTPVFS first: prebake checks its source identity.
SRC=data/lims_indexed.db bash scripts/prepare-httpvfs-db.sh
SQLITE_PATH="$PWD/data/lims_indexed.db" npm run build
# Start a local Next server on an unused loopback port against that same DB.
BASE=http://localhost:3468 SRC=data/lims_indexed.db npm run prebake
BASE=http://localhost:3468 SRC=data/lims_indexed.db node scripts/verify-static-parity.mjs
STATIC_DEVELOPMENT=1 BASE_PATH=/annotation/projects/aiale-dev bash scripts/build-static.sh
python scripts/seal-kind-static.py --bundle out --root-path /annotation/projects/aiale-dev \
  --commit "$(git rev-parse HEAD)" --viewer-version "$(node -p 'require("./package.json").version')" \
  --allow-local-lims
python -m ai_ale_kind_static doctor --bundle out --root-path /annotation/projects/aiale-dev
```

Seal only a verified export built from the named source commit. Do not substitute
an old commit for dirty code; commit verified source, rebuild, then seal. The seal
asserts provenance; it does not authenticate source or authorize data release.
The wrapper clears static `.next` on exit, so rebuild before returning to server
mode. Stop only the worktree-local server, never the shared viewer.

`data/`, its archive history, `public/data/`, `public/db/`, and `out/` are ignored
generated artifacts. Do not force-add them. Keep the verified real-data export
in the local worktree for review. The code-only wheel is separate:

```sh
python -m pip wheel --no-deps --no-build-isolation --wheel-dir dist .
```

The explicit package list excludes frontend exports, DBs, tests and Node
artifacts from the wheel. Installing or publishing requires its own authorized
environment/release action. Tests use synthetic fixtures; authorized local
real-data serving additionally binds its identity to the baked snapshot hash.

External gates remain: Gavin's authoritative package identity and KIND contract,
actual root-prefix/proxy acceptance, notebook/container expectations, real-data
redistribution approval, registration, publication, tag, promotion to `static`,
and deployment. No `release.yaml`, external plugin ID, or catalog claim is
invented here.
