# Local KIND adapter

`python3 -m kind` is a local, stdlib-only compatibility adapter. It is not an external KIND registration, catalog entry, release, or deployment.

## Local checks

```sh
python3 -m kind info
python3 -m kind kind-install
python3 -m kind doctor
```

`kind-install` validates and prints the local manifest. `--output` is deliberately limited to a path beneath this repository's `kind/` directory. It never writes `~/.king` and never invokes KIND.

The provisional local manifest id and console name are `ai-ale-lims-viewer-kind`. Its documented command is `ai-ale-lims-viewer-kind serve --port {port} --root-path {proxy_path} --no-king`. The id is unregistered and must not be catalog registered without owner approval.

## Serving locally

After a server-mode `npm run build`, run `python3 -m kind serve --port 9000 --root-path /user/example/proxy/9000 --no-king`. The launcher binds only to `127.0.0.1`, starts `npm start` with fixed argv, waits for `/api/kind-ready`, and exposes a loopback proxy. The proxy requires the trailing slash, strips the root prefix for Next, does not forward proxy headers, and rewrites HTML absolute root `href` and `src` URLs to the root prefix. Stop with Ctrl-C to terminate the child process group.

`/api/kind-ready` is intentionally separate from `/api/health`: it returns quick JSON without importing or querying the database. Dynamic server behavior remains distinct from static-only `next.config.ts` base-path behavior.

No `release.yaml` is issued: its durable identity and release metadata require owner-approved catalog identity, repository, and release policy.
