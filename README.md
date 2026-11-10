# AI-ALE static operations handoff

This repository is the static release source for operators, maintainers, and deployment reviewers. Work on `static-dev`, verify there, and promote accepted commits to `static`. This document describes data refresh, release, validation, deployment, rollback, and the provisional local KIND handoff. It is not a product guide.

## Branch authority and release boundary

- `static-dev` is the implementation and verification branch.
- `static` is the accepted static release branch and the source for an authorized static release.
- `dynamic-dev` and `dynamic` are separate server lineages and are not touched by this workflow.
- `main`, `dev`, and compatibility deployment branches are not release sources.
- A release creates `out/`; it does not deploy, write a webroot, or register with KIND.
- Generated databases, prebaked JSON, HTTPVFS files, `.local/`, and `out/` are ignored local artifacts. Never commit them.

## Data sources and profiles

The canonical trimmed source is:

```text
/scratch1/fliu/hub_scratch/synbio/lims_mirror_TFMN1.db
```

The full source is not yet tied to an authoritative upstream path. Supply it explicitly with `--source` until that path is confirmed. A refresh copies the selected source into the indexed local destination, validates it, creates indexes where the schema permits, and records the source identity. It does not read live webroot artifacts and never refreshes from a deployed bundle.

| Profile | Indexed destination | Refresh source |
|---|---|---|
| `trimmed` | `data/lims_TFMN1_indexed.db` | canonical path above unless `--source` overrides it |
| `full` | `data/lims_indexed.db` | required explicit `--source` |

The indexed destination is an operator-created working asset, not proof of upstream provenance. Release manifests preserve the source SHA-256, byte size, source mtime, snapshot timestamp, table counts, profile, target, base path, and artifact hashes. The release snapshot under `.local/releases/<profile>/data/source.db` is the immutable SQLite input used by the release stages.

### Refresh commands

```bash
# Trimmed, using the canonical source:
ops/data-refresh.sh --profile trimmed

# Trimmed, with an explicit source:
ops/data-refresh.sh --profile trimmed --source /path/to/mirror.db

# Full, always explicit:
ops/data-refresh.sh --profile full --source /path/to/full-mirror.db

# Validate either indexed destination:
ops/validate.py --profile trimmed
ops/validate.py --profile full
```

Refresh archives an existing destination under `data/archive/`, creates a transactionally consistent copy, checks SQLite integrity and populated tables, adds supported indexes, and atomically replaces the destination. If validation fails, the new destination is not installed. The source is not modified.

## Profiles, targets, and approved URLs

Profiles and targets are independent. Valid static targets are:

| Target | Compiled base path | Approved URL | Approved webroot |
|---|---|---|---|
| `aiale` | `/annotation/projects/aiale` | `https://modelseed.org/annotation/projects/aiale/` | `/scratch1/fliu/html/modelseed_annotation/projects/aiale/` |
| `aiale-dev` | `/annotation/projects/aiale-dev` | `https://modelseed.org/annotation/projects/aiale-dev/` | `/scratch1/fliu/html/modelseed_annotation/projects/aiale-dev/` |
| `kind` | explicit `--root-path`, including empty root | owner-supplied local or proxy prefix | none |

The normal public pairing is `trimmed -> aiale` or `full -> aiale-dev`, but the scripts permit either profile with either approved target. KIND is a local handoff target, not an external registration or deployment target.

## Operations inventory

The tracked `ops/` files are the complete operational surface:

- `ops/data-refresh.sh`: refreshes one named profile from an explicit SQLite source. Reads the source and selected destination, writes `data/<profile destination>`, archives the prior destination under `data/archive/`, and invokes validation. It does not release or deploy.
- `ops/static-release.sh`: builds one profile and target. Reads the selected source, package/build scripts, and repository code. Writes `.local/releases/<profile>/data`, `.local/releases/<profile>/db`, `.local/releases/<profile>/out`, `out/`, temporary `public/data` and `public/db` links, and the ignored `server.log`. It starts only a bounded build-time loopback server, verifies source parity, stops it, validates the resulting bundle, and does not write a webroot.
- `ops/validate.py`: validates a source, or a release and output bundle against that source. It reads SQLite, manifests, HTTPVFS config, and generated output, and writes only its JSON report to stdout when redirected. It is a validator, not a builder.
- `ops/deploy-static.sh`: validates an existing bundle and performs a dry-run or an explicitly requested deployment to the allowlisted `aiale` or `aiale-dev` webroot. `--apply` writes a timestamped sibling backup and synchronizes bundle contents. It does not refresh or build.
- `ops/verify-server-source.py`: compatibility helper used by `static-release.sh`. It reads the bounded build-time server health, config, table counts, and mutation experiment response, compares them to the selected SQLite source, and writes a JSON result to stdout. It is not a production health check and does not deploy.

`ops/.gitignore` ignores only transient `server.log` and `server.pid`. The `ops/__pycache__/` directory is generated Python cache and is ignored by the repository-wide Python rules, not an additional tracked operator script.

## Release procedure

Use the exact source and target you intend to hand off. The dry run validates without creating generated output:

```bash
ops/static-release.sh --profile trimmed --target aiale --dry-run
```

Build a release:

```bash
ops/static-release.sh --profile trimmed --target aiale
ops/static-release.sh --profile full --target aiale-dev
```

Options accepted by `static-release.sh` are `--profile trimmed|full`, `--source PATH`, `--target aiale|aiale-dev|kind`, `--root-path PATH`, `--channel static|static-dev`, `--port PORT`, and `--dry-run`. `--root-path` is required for an exact KIND prefix when the default empty root is not correct. The default channel is `static-dev` unless `RELEASE_CHANNEL` is set.

The release takes one SQLite backup snapshot, prepares HTTPVFS from that snapshot, runs the application only as a bounded build-time compatibility server, verifies the server source identity, prebakes curated artifacts, builds the selected base path, and validates parity. It leaves the selected bundle in `out/` and a retained copy in `.local/releases/<profile>/out/`.

Generated layout:

```text
.local/releases/<profile>/
  data/       source snapshot, prebaked JSON, manifest
  db/         hash-keyed HTTPVFS database, worker, wasm, config
  out/        retained final bundle for this profile and target
  server.log  ignored bounded build-server log
out/          current selected handoff bundle only
```

During the build, `public/data` and `public/db` are temporary links to the selected profile and are restored on exit. A release may remove `.next` as part of static build behavior. Run `npm run build` again before server-mode compatibility checks.

## Validation and parity

```bash
# Source validation:
ops/validate.py --profile trimmed
ops/validate.py --profile full

# Release and output validation:
ops/validate.py --profile trimmed \
  --release .local/releases/trimmed --out out \
  --target aiale --root-path /annotation/projects/aiale

# Local KIND test suite:
python -B -m unittest discover -s tests/kind_static -v
```

Validation fails closed on missing or corrupt SQLite, missing populated tables, profile mismatch, source hash mismatch, target or base-path mismatch, HTTPVFS mismatch, missing output files, stale profile data, or curated artifact parity failures. Before handoff, check `out/index.html`, `out/data/manifest.json`, `out/db/config.json`, and a local HTTP byte range.

## Static release and deployment are separate

A release is not a deployment. After separate deployment authorization, first inspect the bundle with the safe default dry run:

```bash
ops/deploy-static.sh --target aiale --profile trimmed --bundle out --dry-run
```

Apply only to the approved webroot selected by the target:

```bash
ops/deploy-static.sh --target aiale --profile trimmed --bundle out --apply
ops/deploy-static.sh --target aiale-dev --profile full --bundle out --apply
```

`--target` and `--profile` are required. `--bundle` defaults to `out`. Without `--apply`, the script remains dry-run even if `--dry-run` is omitted. The script validates the manifest and source identity, creates a timestamped backup of the current webroot, then synchronizes the contents of `out/`, not the `out/` directory itself. It never accepts an arbitrary destination.

### Rollback

Record the printed `backup=` path before deployment. To roll back, stop serving the affected webroot if required by the host, inspect the backup, and restore its contents to the same approved webroot with the host's authorized file operation. Re-run the URL, manifest, and byte-range checks. Do not use a different target or copy a deployed artifact back into `data/`. The retained `.local/releases/<profile>/out/` and manifest identify the release that was handed off.

## Local KIND handoff

The repository has provisional checkout-independent local tooling only. It can validate, seal, and serve a static bundle. It does not register a KIND package, create a catalog entry, configure a proxy, grant access, or establish external readiness.

The KIND owner must supply the authoritative package identity, exact proxy/root prefix, packaging contract, registration procedure, access requirements, and the decision on whether this data may be redistributed. Build with the exact supplied prefix:

```bash
ops/static-release.sh --profile full --target kind --root-path /owner/exact/prefix
python scripts/seal-kind-static.py --bundle out --root-path /owner/exact/prefix \
  --commit "$(git rev-parse HEAD)" \
  --viewer-version "$(node -p 'require(\"./package.json\").version')" \
  --allow-local-lims
python -m ai_ale_kind_static doctor --bundle out --root-path /owner/exact/prefix
python -m ai_ale_kind_static serve --bundle out --root-path /owner/exact/prefix \
  --port 8765 --no-king
```

`doctor` validates the sealed bundle offline. `serve` serves it on loopback only. Check the root, manifest, and HTTPVFS range in another shell:

```bash
curl -i http://127.0.0.1:8765/owner/exact/prefix/
curl -i http://127.0.0.1:8765/owner/exact/prefix/data/manifest.json
curl -i -H 'Range: bytes=0-99' \
  http://127.0.0.1:8765/owner/exact/prefix/db/lims.db
```

The range response must be `206 Partial Content` with the expected `Content-Range`. Use the exact prefix, not a runtime rewrite. If no prefix is supplied, build with `--root-path ''` and serve with the same empty root argument.

## Build-time server compatibility boundary

`npm run dev`, `npm start`, `Dockerfile`, and `docker-compose.yml` are retained for server-mode development or the bounded release build only. They require Node and a local database configuration, do not serve `out/`, do not define the static deployment path, and do not establish KIND readiness. Do not present `npm run dev` as the normal static workflow.

## Troubleshooting and handoff checklist

- Source missing: confirm the profile path or provide `--source`; full refresh requires it.
- Integrity or hash mismatch: stop and rebuild every generated artifact from one source snapshot.
- Wrong base path: rebuild with the exact target or KIND prefix. Do not patch exported HTML.
- Missing manifest or parity failure: inspect `.local/releases/<profile>/server.log`, then rerun the release.
- HTTPVFS mismatch: rebuild the selected profile; never mix profile directories.
- KIND prefix failure: obtain the owner-supplied prefix and rebuild. No runtime rewriting is supported.
- Server API failure after static build: run `npm run build` before `npm start`.

Before handoff, record branch and commit, profile, source path and SHA-256, target and base path, viewer version, snapshot timestamp and table counts, validation output, bundle manifest, URL status, manifest response, and a representative `206` byte-range response. Confirm that no webroot was changed unless the deployment owner explicitly authorized `--apply`. For KIND, attach the owner-supplied identity, prefix, packaging and redistribution decisions, and clearly label external registration as unresolved until the owner confirms it.

For the detailed command reference and maintained operations authority, see [`docs/README.md`](docs/README.md). For contribution checks and code conventions, see [`CONTRIBUTING.md`](CONTRIBUTING.md).
