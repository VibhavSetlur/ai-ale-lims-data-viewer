"""Local-only launcher compatible with the documented KIND app contract."""
from __future__ import annotations

import argparse
import html
import http.client
import json
import os
from pathlib import Path
import shutil
import re
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from . import APP_ID

REPO = Path(__file__).resolve().parent.parent
READY_PATH = "/api/kind-ready"


def manifest() -> dict:
    return {
        "type": "app",
        "id": APP_ID,
        "launch": {
            "cmd": [APP_ID, "serve", "--port", "{port}", "--root-path", "{proxy_path}", "--no-king"],
            "ready_probe": {"path": READY_PATH, "timeout_s": 45},
        },
        "title": "AI ALE LIMS Viewer (local adapter)",
        "description": "Unregistered local-only manifest. Owner approval is required before catalog onboarding.",
    }


def validate_manifest(data: dict) -> None:
    if data.get("type") != "app":
        raise ValueError("manifest type must be 'app'")
    app_id = data.get("id")
    if not isinstance(app_id, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)+", app_id):
        raise ValueError("manifest id must be a canonical hyphenated id")
    launch = data.get("launch")
    cmd = launch.get("cmd") if isinstance(launch, dict) else None
    if not isinstance(cmd, list) or not cmd or not all(isinstance(item, str) and item for item in cmd):
        raise ValueError("manifest launch.cmd must be a nonempty string list")
    required = ("--port", "{port}", "--root-path", "{proxy_path}", "--no-king")
    if any(item not in cmd for item in required):
        raise ValueError("manifest launch.cmd lacks required KIND placeholders or flags")


def validate_root_path(value: str) -> str:
    segments = value.split("/")
    if (
        not value.startswith("/")
        or value == "/"
        or value.endswith("/")
        or "//" in value
        or any(c.isspace() for c in value)
        or any(segment in {".", ".."} for segment in segments)
        or any(character in value for character in "\\?#%")
    ):
        raise argparse.ArgumentTypeError("root path must be an absolute, normalized path without a trailing slash")
    return value


def validate_port(value: str) -> int:
    try:
        port = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("port must be an integer") from exc
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("port must be between 1 and 65535")
    return port


def _proxy_handler(root_path: str, upstream_port: int):
    class Proxy(BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urlsplit(self.path)
            prefix = root_path + "/"
            if parsed.path == root_path:
                self.send_response(308); self.send_header("Location", prefix); self.end_headers(); return
            if not parsed.path.startswith(prefix):
                self.send_error(404); return
            path = parsed.path[len(root_path):] or "/"
            if parsed.query:
                path += "?" + parsed.query
            try:
                conn = http.client.HTTPConnection("127.0.0.1", upstream_port, timeout=3)
                conn.request("GET", path, headers={"Host": "127.0.0.1"})
                response = conn.getresponse()
                body = response.read()
                content_type = response.getheader("Content-Type", "")
                if "text/html" in content_type:
                    body = body.replace(b'href="/', f'href="{root_path}/'.encode()).replace(b'src="/', f'src="{root_path}/'.encode())
                self.send_response(response.status)
                for key, value in response.getheaders():
                    if key.lower() not in {"connection", "content-length", "transfer-encoding"}:
                        self.send_header(key, value)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers(); self.wfile.write(body)
                conn.close()
            except OSError:
                self.send_error(502)
        def log_message(self, format, *args):
            return
    return Proxy


def wait_ready(port: int, timeout: float = 45) -> bool:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=1)
            conn.request("GET", READY_PATH)
            status = conn.getresponse().status; conn.close()
            if status < 500:
                return True
        except OSError:
            pass
        time.sleep(0.2)
    return False


def serve(args: argparse.Namespace) -> int:
    if not (REPO / ".next").is_dir():
        print("error: server Next build is required (.next missing); run npm run build first", file=sys.stderr)
        return 2
    npm = shutil.which("npm")
    if not npm:
        print("error: npm was not found on PATH", file=sys.stderr)
        return 2
    upstream_port = args.port + 1 if args.port < 65535 else args.port - 1
    env = {**os.environ, "PORT": str(upstream_port), "HOSTNAME": "127.0.0.1"}
    child = subprocess.Popen([npm, "start"], cwd=REPO, env=env, start_new_session=True)
    proxy = None
    try:
        if not wait_ready(upstream_port):
            print("error: Next server did not pass /api/kind-ready", file=sys.stderr)
            return 1
        proxy = ThreadingHTTPServer(("127.0.0.1", args.port), _proxy_handler(args.root_path, upstream_port))
        print(f"local KIND proxy listening at http://127.0.0.1:{args.port}{args.root_path}/")
        proxy.serve_forever()
        return 0
    except KeyboardInterrupt:
        return 0
    finally:
        if proxy:
            proxy.server_close()
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()


def doctor() -> int:
    checks = {"python": sys.version_info >= (3, 10), "node": bool(shutil.which("node")), "npm": bool(shutil.which("npm")), "package.json": (REPO / "package.json").is_file(), "next build": (REPO / ".next").is_dir()}
    for name, ok in checks.items():
        print(f"{'ok' if ok else 'warning'}: {name}")
    return 0 if all(checks.values()) else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m kind", description="Local-only, unregistered KIND adapter")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("info", help="show local manifest")
    install = sub.add_parser("kind-install", help="validate and emit local manifest")
    install.add_argument("--output", type=Path)
    sub.add_parser("doctor", help="check local prerequisites without network access")
    run = sub.add_parser("serve", help="start loopback proxy and Next server")
    run.add_argument("--port", type=validate_port, required=True)
    run.add_argument("--root-path", type=validate_root_path, required=True)
    run.add_argument("--no-king", action="store_true", required=True)
    args = parser.parse_args(argv)
    if args.command == "info":
        print(json.dumps(manifest(), indent=2, sort_keys=True)); return 0
    if args.command == "doctor": return doctor()
    if args.command == "kind-install":
        local_manifest = manifest()
        try:
            validate_manifest(local_manifest)
        except ValueError as exc:
            parser.error(str(exc))
        data = json.dumps(local_manifest, indent=2, sort_keys=True) + "\n"
        if args.output:
            try:
                args.output.resolve().relative_to((REPO / "kind").resolve())
            except ValueError:
                parser.error("--output must be under this repository's kind/ directory")
            args.output.parent.mkdir(parents=True, exist_ok=True); args.output.write_text(data)
        else: print(data, end="")
        return 0
    return serve(args)

if __name__ == "__main__":
    raise SystemExit(main())
