# Local KIND adapter

`python3 -m kind` is a local, stdlib-only compatibility adapter. It is not an external KIND registration, catalog entry, release, or deployment.

## Local checks

```sh
python3 -m kind info
python3 -m kind kind-install
python3 -m kind doctor
```

`kind-install` validates and prints the local manifest. `--output` is deliberately limited to a path beneath this repository's `kind/` directory. It never writes `~/.king` and never invokes KIND.

The provisional local manifest id and console name are `ai-ale-lims-viewer-kind`. Its documented command is `ai-ale-lims-viewer-kind serve --port {port} --root-path {proxy_path} --no-king`. `pyproject.toml` supplies that console only when this local package is installed by an owner-approved packaging path; this repository does not install it or claim that it is already on `PATH`. The id is unregistered and must not be catalog registered without owner approval.

## Serving locally

After a server-mode `npm run build`, run `python3 -m kind serve --port 9000 --root-path /user/example/proxy/9000 --no-king`. The launcher binds only to `127.0.0.1`, starts `npm start` with fixed argv, waits for `/api/kind-ready`, and exposes a loopback proxy. The proxy requires the trailing slash, strips the root prefix for Next, does not forward proxy headers, and rewrites HTML absolute root `href` and `src` URLs to the root prefix. Stop with Ctrl-C to terminate the child process group.

`/api/kind-ready` is intentionally separate from `/api/health`: it returns quick JSON without importing or querying the database. Dynamic server behavior remains distinct from static-only `next.config.ts` base-path behavior.

No `release.yaml` is issued: its durable identity and release metadata require owner-approved catalog identity, repository, and release policy. The manifest exists only in memory until `kind-install` prints it or writes it beneath `kind/`; that emitted JSON is neither an executable artifact nor a registration request.

## Static isolation and local verification

The adapter is server-mode only. It launches `npm start` behind a local proxy; it does not invoke static builds, prebake data, or consume `NEXT_PUBLIC_BASE_PATH`. Static mode continues to use its existing baked-data boundary, so no static deployment, manifest, or data claim follows from this adapter.

Run the repository-owned checks without installing anything:

```sh
python3 -m unittest kind.test_cli
python3 -m kind info
python3 -m kind kind-install
python3 -m kind doctor
```

`info` and `kind-install` exercise the manifest path. `doctor` reports local prerequisites and returns nonzero when a server build is absent, so it is diagnostic rather than a deployment or readiness claim. The focused unit suite exercises manifest validation, local-output confinement, root-path handling, proxy rewriting, readiness-route independence, and child cleanup.

## External actions required

1. Approve the durable KIND package and catalog identity, including the distribution and console name.
2. Name the manifest and catalog owner, and provide the authoritative KIND schema, runtime, and registration procedure.
3. Approve the data-access, retention, and redaction policy for a KIND-hosted dynamic viewer.
4. Approve the release and catalog acceptance process before creating `release.yaml`, publishing a package, or registering the manifest.
