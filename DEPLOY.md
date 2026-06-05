# Deploy: AI-ALE LIMS data viewer behind modelseed.org/projects/aiale

This is the deploy handoff for Dan/Boris. The viewer is a Next.js app
serving the AI-ALE mutation explorer + barcode charts + copy-number heatmap.
It runs on Poplar and reads the LIMS mirror as a **local SQLite file** —
no remote DB API call, so no new firewall hole is needed.

## What runs where

| Component | Where | Port | Process |
|---|---|---|---|
| Viewer (this app) | poplar | **3457** (0.0.0.0) | `next start` under user `vsetlur` |
| LIMS mirror (read) | poplar | (file, no socket) | `/scratch1/fliu/hub_scratch/synbio/lims_mirror.backup.db` |
| ModelSEED-UI staging | poplar | 3000 (docker) | unchanged — independent container |
| ModelSEED-UI production | poplar | 3001 (docker) | unchanged — independent container |

Port 3457 was chosen because (a) it's unused on poplar, (b) it's never been
used by ModelSEED, and (c) Chris's team has been pointing at it for weeks
during dev. The viewer process is `npm start` running under `vsetlur` —
no Docker, no shared kernel namespace, no shared volumes with ModelSEED's
containers.

## What Dan needs to add to the nginx config for modelseed.org

A new `location` block that proxies `/projects/aiale` (and below) to
`poplar:3457`. Pattern follows the recent ModelSEED upgrades.

```nginx
# modelseed.org/projects/aiale -> AI-ALE LIMS viewer on Poplar:3457
location ^~ /projects/aiale {
    # strip the prefix so Next.js sees a normal URL space
    rewrite ^/projects/aiale(/.*)$ $1 break;
    rewrite ^/projects/aiale$       /  break;

    proxy_pass         http://poplar.cels.anl.gov:3457;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_set_header   X-Forwarded-Host  $host;
    proxy_set_header   X-Forwarded-Prefix /projects/aiale;

    # Next.js streams API responses; allow time for large CSV exports.
    proxy_read_timeout 120s;
    proxy_buffering    off;
}
```

**Upstream health check** the viewer exposes for nginx (or any monitor):

```
GET http://poplar.cels.anl.gov:3457/api/health
=> 200  { "status": "ok",  ... }   when the DB file is reachable
=> 503  { "status": "degraded", ... } when the DB probe fails
```

If you want passive checks via `nginx_upstream_check_module`, point it at
`/api/health` and watch for 200.

If the Next.js app needs to know the public URL prefix at build time, we can
set `NEXT_PUBLIC_BASE_PATH=/projects/aiale` and rebuild — but the current
viewer uses only relative URLs, so the rewrite above is sufficient and no
rebuild is needed.

## Firewall (ANL side)

**Inbound from modelseed.org host -> poplar:3457**: this is the only hole
needed. Same kind of upstream rule you already have for the rest of the
ModelSEED stack on poplar, just on a different port. Source-restrict to
the modelseed.org host(s) if your policy allows.

**Outbound from poplar**: none. The viewer reads a file on a mounted
filesystem — there is no remote DB API call to anywhere. The
`/scratch1/...lims_mirror.backup.db` file is refreshed by the existing
LIMS sync job (Fei's process, runs out-of-band).

## What's running today

```bash
# On poplar, as vsetlur:
$ ss -tlnp | grep 3457
LISTEN 0 511 0.0.0.0:3457 ... users:(("next-server (v1",pid=...))

$ curl -s http://localhost:3457/api/health | jq .status
"ok"
```

The process is currently managed by `ops/serve.sh` + `ops/stop.sh` (tmux +
nohup). The systemd unit at `ops/ai-ale-viewer.service` is recommended
for the long-term deploy — install it once and the viewer auto-restarts on
crash and survives reboot (with `loginctl enable-linger vsetlur`).

## Promote to systemd (one-time, on poplar as vsetlur)

```bash
mkdir -p ~/.config/systemd/user
cp /scratch/vsetlur/ai-ale-lims-data-viewer/ops/ai-ale-viewer.service \
   ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now ai-ale-viewer

# Survive reboots even when vsetlur isn't logged in:
loginctl enable-linger vsetlur

# Verify:
systemctl --user status ai-ale-viewer
journalctl --user -u ai-ale-viewer -f
curl -s http://localhost:3457/api/health | jq
```

## Updating the viewer

```bash
cd /scratch/vsetlur/ai-ale-lims-data-viewer
git pull
npm install        # only if package.json changed
npm run build
systemctl --user restart ai-ale-viewer    # (or ops/stop.sh && ops/serve.sh)
```

## Rollback

The PID file at `ops/server.pid` records the running process. To stop the
viewer entirely without touching anything else on poplar:

```bash
/scratch/vsetlur/ai-ale-lims-data-viewer/ops/stop.sh
# or, if installed as a systemd unit:
systemctl --user stop ai-ale-viewer
```

Neither command touches ModelSEED's docker containers on ports 3000/3001.

## Why not Docker?

The plan is to use Docker eventually (matches ModelSEED's deploy style),
but the `vsetlur` account is not in the `docker` group on poplar and the
socket rejects connections. Granting `docker` group membership unblocks
a `docker compose up` deploy using the existing `Dockerfile` +
`docker-compose.yml` in this repo — request when convenient. Until then
the tmux/systemd deploy is functionally equivalent for serving on
port 3457 and equally compatible with the nginx proxy config above.

## Contacts

- App owner: Vibhav (vsetlur@anl.gov)
- LIMS mirror file owner: Fei Liu
- Group meeting context: 2026-06-03 (group meeting), 2026-06-05 Slack
  (Natasha confirmed `verAB_barcodes` table populated; dgoA copy
  number + OD data still in flight)
