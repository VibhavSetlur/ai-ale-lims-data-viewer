# AI-ALE LIMS viewer operations and integration

This is the detailed operational authority for the static viewer. The root [`README.md`](../README.md) is the short operator entry point. The static lineage is the only lineage covered by this workflow.

## 1. Branch authority and scope

- `static-dev` is the implementation and verification branch.
- `static` is the accepted static release branch reviewed by the deployment owner.
- `dynamic-dev` and `dynamic` are intentionally unchanged. Dynamic services, authentication, AI integration, and dynamic KIND adapters are later work.
- `main`, `dev`, and compatibility deployment branches are not release sources.

Implement and verify in a clean `static-dev` worktree. Promote the accepted commit to `static` only after the static checks below pass. A Git push, branch promotion, webroot write, or external deployment is a separate state-changing operation and must be confirmed in the actual session.

## 2. Data assets

The static source assets are local, generated, and ignored by Git:

| Profile | Required path | Meaning |
|---|---|---|
| `trimmed` | `data/lims_TFMN1_indexed.db` | Reduced TFMN1/public snapshot candidate |
| `full` | `data/lims_indexed.db` | Full research snapshot candidate |

The filename is not proof of contents. `ops/validate.py` checks that the file exists, is non-empty, passes SQLite integrity checking, has populated user tables, and reports its SHA-256, size, modification time, table inventory, and row counts. A release manifest records the exact source identity.

Do not copy deployed artifacts back into the source database. Do not commit databases, generated JSON, HTTPVFS databases, `.local/`, or `out/`.

## 3. Refreshing one source asset

Refresh is explicit and profile-specific. It copies an upstream SQLite mirror to a temporary destination, validates it, adds the local indexes needed by the viewer where the schema permits, archives the previous destination, and atomically replaces the selected asset:

```bash
ops/data-refresh.sh --profile trimmed --source /approved/mirror-tfmn1.db
ops/data-refresh.sh --profile full --source /approved/full-mirror.db
ops/validate.py --profile trimmed
ops/validate.py --profile full
```

The refresh script does not choose a profile from mtime or URL, and it does not start a server or publish a release. An existing asset is archived under `data/archive/` before replacement. If validation fails, the selected existing asset remains in place.

## 4. Static profiles and targets

Profile and target are independent selections. The convenience mapping trimmed to `aiale` and full to `aiale-dev` is not a restriction.

| Target | Compiled path | Use |
|---|---|---|
| `aiale` | `/annotation/projects/aiale` | Static target selected by the operator |
| `aiale-dev` | `/annotation/projects/aiale-dev` | Static development/review target selected by the operator |
| `kind` | explicit `--root-path`, or empty root | Local bundle handoff to KIND owner |

All four URL combinations are valid:

```text
trimmed -> aiale
trimmed -> aiale-dev
full    -> aiale
full    -> aiale-dev
```

The first line above is the same as the common default. The `kind` target is not a URL registration and does not claim external KIND readiness.

## 5. Release command and generated state

Use one command for a release:

```bash
ops/static-release.sh --profile trimmed --target aiale --dry-run
ops/static-release.sh --profile trimmed --target aiale
ops/static-release.sh --profile full --target aiale-dev
ops/static-release.sh --profile full --target aiale --channel static
ops/static-release.sh --profile trimmed --target kind --root-path /user/me/proxy/9000
```

The command validates the source, creates isolated state, prepares HTTPVFS from the exact source, runs the server against that exact source, prebakes the curated API responses, builds the selected static base path, validates the result, and leaves the selected bundle in `out/`.

The generated layout is:

```text
.local/releases/<profile>/
  data/       prebaked JSON and manifest for this profile
  db/         profile-specific HTTPVFS database, worker, wasm, config
  out/        retained copy of this profile/target's final bundle
  server.log  local build-server log, ignored
out/          current selected handoff bundle only
```

During a build, `public/data` and `public/db` are temporary links to the selected profile. They are restored when the command exits. The release operation never intentionally mixes the two profiles. The final `out/data/manifest.json` contains `profile`, `target`, `basePath`, source SHA-256, byte size, source mtime, snapshot timestamp, table counts, and artifact hashes.

## 6. Validation

`ops/validate.py` is the source and release validator:

```bash
ops/validate.py --profile full
ops/validate.py --profile trimmed --release .local/releases/trimmed --out out --target aiale --root-path /annotation/projects/aiale
```

It checks source existence, SQLite integrity, populated tables, profile identity, manifest presence, source hash agreement, target/base-path agreement, HTTPVFS config and source hash, HTTPVFS symlink, output index, and output manifest agreement. It fails closed on a missing or mismatched identity.

The local KIND launcher has additional seal and HTTP checks. It is tested with synthetic fixtures and can validate a real local export after sealing it with the explicit local-data flag:

```bash
python -B -m unittest discover -s tests/kind_static -v
python scripts/seal-kind-static.py --bundle out --root-path /user/me/proxy/9000 \
  --commit "$(git rev-parse HEAD)" \
  --viewer-version "$(node -p 'require(\"./package.json\").version')" \
  --allow-local-lims
python -m ai_ale_kind_static doctor --bundle out --root-path /user/me/proxy/9000
```

A sealed bundle must be copied or rebuilt if its contents change. The launcher validates the exact compiled prefix and rejects path mismatches, unsealed files, symlinks, digest changes, unsafe paths, and malformed metadata.

## 7. Full verification matrix

For each of these four builds:

```text
trimmed -> aiale
full    -> aiale
trimmed -> aiale-dev
full    -> aiale-dev
```

verify:

1. The selected source passes `ops/validate.py`.
2. The manifest profile and source SHA-256 match the selected file.
3. The manifest target and base path match the command.
4. Curated artifacts and capability flags come from the selected database.
5. The output contains no stale other-profile data.
6. `out/index.html`, `out/data/manifest.json`, and `out/db/config.json` exist.
7. HTTPVFS points to the hash-keyed selected database.
8. A local HTTP server serves the root, manifest, and a valid byte range from the database.
9. The local KIND doctor and range-serving checks pass for the selected KIND prefix where applicable.

Repository gates for changed code are:

```bash
npx tsc --noEmit
npm test
npm run build
git diff --check
python -B -m unittest discover -s tests/kind_static -v
```

A static export removes `.next` on exit so that a later server start cannot reuse a static export. Run `npm run build` again before server-mode verification.

## 8. Deployment handoff

The release command prepares `out/`; it does not silently write a webroot. After the deployment owner separately authorizes a target, inspect the destination and use an explicit copy or rsync of the contents of `out/` into that approved webroot. Do not touch another owner's workspace or webroot as part of local verification.

Before handoff, record:

- source profile and SHA-256;
- viewer version and source commit;
- target and compiled base path;
- manifest snapshot timestamp and table counts;
- output validation result;
- root response status;
- `data/manifest.json` response;
- HTTPVFS `Accept-Ranges` and a representative `206` byte-range response.

Rollback means restoring the previously retained webroot bundle. The `.local/releases/<profile>/out` copy and manifest provide the local evidence for which bundle was handed off.

## 9. KIND boundary

The repository includes provisional local static tooling only. It can seal, inspect, and serve a bundle without Node or the repository checkout. It does not register a package, create a catalog entry, set up a proxy, grant access, or deploy to KIND. The external KIND owner must provide the authoritative package identity, proxy/root prefix, packaging contract, registration steps, and data redistribution decision.

For a local handoff, build with the exact root prefix supplied by the owner:

```bash
ops/static-release.sh --profile full --target kind --root-path /user/me/proxy/9000
python scripts/seal-kind-static.py --bundle out --root-path /user/me/proxy/9000 \
  --commit "$(git rev-parse HEAD)" --viewer-version "$(node -p 'require(\"./package.json\").version')" \
  --allow-local-lims
python -m ai_ale_kind_static doctor --bundle out --root-path /user/me/proxy/9000
```

Do not call this external deployment complete. A root-prefix mismatch is a build failure, not something the launcher should rewrite.

## 10. Viewer behavior and provenance

The static viewer reads curated JSON under `<basePath>/data/` and queries the selected HTTPVFS SQLite database in the browser. Capability-dependent tabs, including barcode views, follow the selected snapshot. The UI should report missing data rather than infer it. The release manifest and in-app changelog distinguish viewer version from data snapshot identity.

The viewer is read-only. Static output has no live API dependency. Dynamic server mode remains a separate later concern.

## 11. Troubleshooting

- **Source not found:** place the named local asset at the exact profile path or run `ops/data-refresh.sh`.
- **Integrity or hash mismatch:** stop. Do not reuse generated data. Rebuild HTTPVFS and prebaked artifacts from one source.
- **Wrong target path:** rebuild with the target's exact base path. Do not patch HTML after export.
- **Manifest missing:** the prebake step did not complete; inspect `.local/releases/<profile>/server.log`.
- **HTTPVFS mismatch:** remove only the selected generated release and rebuild it. Never use a DB generated for another profile.
- **KIND doctor prefix failure:** obtain the exact proxy prefix and rebuild. No runtime rewriting is supported.
- **Server API 404 after a static build:** run `npm run build` before `npm start`.
- **A release is too large or slow:** inspect the source identity and generated artifact sizes before changing query scope. Do not silently ship a partial bake.

## 12. Maintained documentation boundary

This file and the root README are the maintained operational authorities for the static workflow. Existing historical/reference files may remain in the repository for application links or provenance, but they must not override these commands, branch rules, profile definitions, or deployment boundaries. The in-app Help and Guide remain user-facing product content; they are not release-operation instructions.
