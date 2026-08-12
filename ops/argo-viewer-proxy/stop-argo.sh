#!/usr/bin/env bash
# Stop the viewer's own Argo pass-through proxy. Only ever touches tmux
# session "ai-ale-argo" and processes running this proxy's own script.
#
# Safety: the reference proxy on 127.0.0.1:4000 runs a different file,
# /scratch/vsetlur/argo-proxy/argo_proxy.py. Our match string below is the
# full basename "viewer_argo_proxy.py", which is not a substring of
# "argo_proxy.py" or any path under /scratch/vsetlur/argo-proxy. A process
# match on that exact filename can therefore never hit the reference proxy
# (PID 1944584) or any process started from that directory.
set -euo pipefail

SESSION="ai-ale-argo"
MATCH="viewer_argo_proxy.py"

if tmux has-session -t "$SESSION" 2>/dev/null; then
    tmux kill-session -t "$SESSION"
    echo "stopped tmux session '$SESSION'"
else
    echo "tmux session '$SESSION' is not running"
fi

# Belt and suspenders for any stray process not under the tmux session.
# pkill -f matches the full command line, and "$MATCH" only appears in
# command lines that invoke this proxy's own script by name.
pkill -f "$MATCH" 2>/dev/null || true

echo "done"
