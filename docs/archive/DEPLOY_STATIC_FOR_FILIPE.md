# Deploy hand-off: AI-ALE viewer as a STATIC site (for Filipe Liu)

Audience: Filipe Liu (fliu). This is everything you need to host the AI-ALE
viewer at a modelseed.org URL. It is a STATIC site (no container, no server,
no database process) just like the Escher builder. Nothing here touches any of
your other services.

## What this is
A self-contained folder of static files (HTML + JS + CSS + pre-baked JSON data).
You serve it from a webroot; the browser does all the work. There is NO backend
process to run, NO port to open, NO database connection.

## The plan you offered (thank you)
> the path /scratch1/fliu/html/modelseed_annotation/projects points to
> https://modelseed.org/annotation/projects/ . pick a name and I make a folder
> and give you perms.

Proposed project name: **aiale**
So the target webroot + URL are:

    webroot:  /scratch1/fliu/html/modelseed_annotation/projects/aiale/
    URL:      https://modelseed.org/annotation/projects/aiale/

## Two ways to put the files there (your choice)

OPTION A - you grant me write perms on the folder, I drop the files in:
  1. You: `mkdir /scratch1/fliu/html/modelseed_annotation/projects/aiale`
     and give vsetlur write access.
  2. Me: copy the contents of my built `out/` folder into it. Done.

OPTION B - I hand you the built bundle, you place it:
  1. I produce a folder `out/` (a complete static site) and tell you its path
     (e.g. /scratch/vsetlur/ai-ale-lims-data-viewer/out/).
  2. You: copy its CONTENTS into the webroot:
     `cp -r /scratch/vsetlur/ai-ale-lims-data-viewer/out/. \
            /scratch1/fliu/html/modelseed_annotation/projects/aiale/`

Either works. I default to whichever you prefer; B keeps you in full control of
your filesystem.

## The ONE thing I need to confirm with you (affects file format)
Does the `/annotation/projects/` webroot automatically serve pre-gzipped files
with the right `Content-Encoding: gzip` header (the way Escher's assets are
served), or does it only serve plain files?

- If it serves `.json.gz` with gzip encoding -> I ship the `.gz` artifacts
  (~2.2 MB total instead of ~15 MB) and the data downloads ~6x smaller.
- If not -> I ship plain `.json` (works everywhere, just larger over the wire;
  the browser experience is identical). This is what the current bundle uses, so
  it is SAFE BY DEFAULT - no action needed from you if you are unsure.

The bundle today already includes BOTH `.json` and `.json.gz` for every data
file, so you can flip on gzip serving later with no rebuild.

## Updating it when the data changes (future DB refreshes)
The viewer reads a single SQLite snapshot. When that snapshot is refreshed, I
regenerate the bundle on my side with two commands and re-place the files. From
your side it is just "the files in the folder got replaced" - no config change,
no name change, no perms change ever again after the first setup.

## What it does NOT need (so you can say no to these)
- No Node.js / Next.js server process.
- No open port, no firewall rule, no reverse-proxy entry.
- No database, no DB credentials, no connection to poplar.
- No cron, no systemd unit.
It is as static as the Escher HTML page.

## Sanity check after placement
Open https://modelseed.org/annotation/projects/aiale/ - you should see the
"AI-ALE LIMS" viewer load with a Mutation Explorer, sample table, copy-number
chart, and barcode charts. If the page is blank, it is almost always a base-path
mismatch: tell me the EXACT final URL path and I rebuild with that path baked in
(the bundle hardcodes its own URL prefix, currently `/annotation/projects/aiale`).

## Contacts
- Bundle owner / rebuilds: Vibhav (vsetlur@anl.gov)
- Requested by: Chris Henry (a public ModelSEED home for the AI-ALE viewer)
