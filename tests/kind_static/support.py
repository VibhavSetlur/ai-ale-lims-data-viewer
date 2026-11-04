"""Small synthetic fixtures only, never viewer data."""
import hashlib
import json
from pathlib import Path
import subprocess

from ai_ale_kind_static.bundle import SCHEMA, SEAL_NAME

SOURCE_COMMIT = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()


def fixture(root: Path, prefix: str = "/user/alice/proxy/9000") -> dict:
    contents = {
        "index.html": f'<html><script src="{prefix}/app.js"></script></html>'.encode(),
        "route/index.html": b"<html>nested route</html>",
        "app.js": b"console.log('synthetic');",
        "style.css": b"body { color: black; }",
        "data/manifest.json": b'{"id":"synthetic-test"}',
        "data/test.db": bytes(range(256)) * 1024,
        "empty.bin": b"",
        "worker.wasm": b"\x00asm",
    }
    for name, body in contents.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    files = {name: {"size": len(body), "sha256": hashlib.sha256(body).hexdigest()} for name, body in contents.items()}
    seal = {"schema": SCHEMA, "viewer_version": "1.15.1", "source": {"commit": SOURCE_COMMIT, "label": "dev-synthetic-launcher-proof"}, "compiled_prefix": prefix, "mode": "static", "channel": "kind-local", "data": {"id": "synthetic-test", "manifest": "data/manifest.json", "manifest_sha256": files["data/manifest.json"]["sha256"]}, "files": files}
    write_seal(root, seal)
    return seal


def write_seal(root: Path, seal: dict):
    (root / SEAL_NAME).write_text(json.dumps(seal), encoding="utf-8")
