# AI-ALE viewer deployment: summary (for Chris Henry)

What you asked for: a public ModelSEED-hosted home for the AI-ALE LIMS viewer,
reachable at a modelseed.org URL like the Escher builder.

Where it will live:
  https://modelseed.org/annotation/projects/aiale/
(Filipe Liu owns that static-hosting path and is setting up the folder + perms.)

How it is deployed (the short version):
  The viewer is published as a STATIC site. We pre-compute the data the viewer
  needs from the LIMS SQLite snapshot into small data files, and ship those plus
  the page itself as plain static files. No server, no database process, no
  container is needed on the ModelSEED side. This is the same style as Escher.

What the public site shows:
  The curated, read-only views the lab cares about:
  - Mutation Explorer (sample selection + comparative mutation calls)
  - Copy Number trends (dgoA* amplification over the ALE timecourse)
  - Barcode charts
  - Growth curves
  It does NOT expose the raw database-table browser (that stays in the internal
  build for power users); the public audience does not need it.

Two builds, one codebase:
  - PUBLIC (modelseed.org): the static site above. Deployed via Filipe.
  - INTERNAL (poplar): the full app with the raw table browser + live CSV export,
    for the team. Unchanged.

Keeping it current:
  When the LIMS snapshot is refreshed, regenerating the public site is two
  commands on Vibhav's side and re-placing the files. No code changes.

Who does what:
  - Vibhav: builds + maintains both versions, regenerates on data refresh.
  - Filipe: hosts the static files at the modelseed.org/annotation path.
  - Seaver: only involved if we instead fold this into the main ModelSEED-UI
    (an alternative we can do later); not needed for the static path.

Status: the static build is built and verified working locally end to end
(loads at the subpath, correct data, low memory, no errors). Waiting on Filipe to
create the hosting folder, then we place the files and it is live.
