# KIND and static export boundary

The viewer has two deliberately different delivery modes. This document records the
contract for the static lineage. It does not register, publish, or deploy the viewer.

## Static export readiness

A static export is **not** launched by the dynamic KIND adapter. Static readiness is
artifact-based and is established only after the deployed static site proves all of the
following at its configured base path:

1. the site root returns the exported application;
2. `data/manifest.json` is present and identifies the prebaked curated-view artifacts;
3. every manifest-referenced artifact required by the selected snapshot is retrievable;
4. the HTTPVFS SQLite asset supports a SQLite byte-range request.

The static build uses `scripts/prebake.mjs` to snapshot curated API responses and
`scripts/prepare-httpvfs-db.sh` to prepare the browser-queryable SQLite asset. The
export itself is built with `scripts/build-static.sh`, which supplies the static base
path and temporarily removes API route handlers because route handlers cannot be part
of a Next static export. `src/lib/dataSource.ts` maps supported curated `/api/*` calls
to the matching prebaked artifact in static mode; endpoints without a baked equivalent
remain unavailable rather than becoming runtime API dependencies.

These checks prove only that a named static artifact set is serveable. They do not
assert an external KIND registration, package identity, catalog entry, or deployment
approval.

## Dynamic adapter boundary

The local dynamic KIND adapter, its `kind/` package, `pyproject.toml`, and
`/api/kind-ready` endpoint are server-only concerns. They launch and probe the dynamic
`npm start` application and are not included in a static export. Static readiness must
therefore never be represented as a successful `/api/kind-ready` probe.

A change that needs dynamic KIND behavior belongs on the dynamic lineage. A change
that affects static readiness must preserve the artifact checks above and must not add
an API, launcher, authentication, AI, or workspace runtime dependency to the static
export.

`.omo/` is ignored repository-local transient session state. It is neither KIND
package input nor a static artifact and must not be committed or included in a release.

## Validation boundary

Before an authorized static release, inspect the generated manifest and verify the
root, manifest, required artifacts, and SQLite byte-range response at the approved
static URL. Building artifacts, copying them to a webroot, and probing a deployed URL
are separate operations and require their own authorization.
