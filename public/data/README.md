# Pre-baked static data artifacts

These files are GENERATED, not hand-written, and are gitignored.

Generate them with the server running:

    npm run prebake        # snapshots the live API into *.json + *.json.gz here
                           # plus manifest.json (content hashes for cache-busting)

The STATIC build (`npm run build:static`) copies whatever is here into `out/data/`.
The viewer in static mode reads `data/manifest.json` then the per-experiment file,
loading ONE experiment at a time to keep browser memory low.

Do not commit the generated artifacts; re-run `npm run prebake` after a DB refresh.
See ../../docs/DEPLOYMENT_DESIGN.md for the full pipeline.
