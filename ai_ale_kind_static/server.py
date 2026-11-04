"""Read-only loopback HTTP serving of validated static bundles."""
from __future__ import annotations

import json
import mimetypes
import os
import re
import signal
import threading
from email.utils import formatdate, parsedate_to_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote_to_bytes, urlsplit

from .bundle import Bundle, BundleError, CHUNK_SIZE

HEALTH_PATH = "api/kind-ready"
MIME_TYPES = {".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".sqlite": "application/octet-stream", ".db": "application/octet-stream", ".gz": "application/gzip"}


def byte_range(value: str, size: int) -> tuple[int, int]:
    """Single ranges only. Malformed, multiple and unsatisfiable ranges are 416."""
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value)
    if not match or not any(match.groups()) or size == 0:
        raise ValueError("unsupported byte range")
    first, last = match.groups()
    if len(first) > 20 or len(last) > 20:
        raise ValueError("range value is too large")
    if not first:
        suffix = int(last)
        if suffix == 0:
            raise ValueError("empty suffix range")
        return max(0, size - suffix), size - 1
    start = int(first)
    end = min(int(last), size - 1) if last else size - 1
    if start >= size or end < start:
        raise ValueError("unsatisfiable byte range")
    return start, end


def _not_modified(value: str, modified: float) -> bool:
    try:
        return int(modified) <= parsedate_to_datetime(value).timestamp()
    except (ValueError, TypeError, OverflowError):
        return False


def handler_for(bundle: Bundle):
    class StaticHandler(BaseHTTPRequestHandler):
        server_version = "AI-ALE-Local-Static"
        sys_version = ""

        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def log_message(self, format, *args):
            # Avoid logging paths, queries or notebook tokens.
            return

        def send_bytes(self, status: int, body: bytes = b"", headers: dict | None = None):
            self.send_response(status)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def do_GET(self):
            try:
                self.handle_request()
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                return

        def do_HEAD(self):
            self.do_GET()

        def handle_request(self):
            try:
                parsed = urlsplit(self.path)
                if parsed.scheme or parsed.netloc or parsed.fragment or re.search(r"%(?![0-9a-fA-F]{2})", parsed.path):
                    raise ValueError("invalid request target")
                # Encoded separators are rejected rather than changing route boundaries.
                if re.search(r"%(?:2f|5c)", parsed.path, re.IGNORECASE):
                    raise ValueError("encoded separator")
                path = unquote_to_bytes(parsed.path).decode("utf-8", "strict")
                if not path.startswith("/") or any(c in path for c in "\\%") or any(ord(c) < 32 or ord(c) == 127 for c in path):
                    raise ValueError("invalid path")
                segments = path.split("/")[1:]
                if any(p in {".", ".."} for p in segments) or any(not p for p in segments[:-1]):
                    raise ValueError("non-normalized path")
            except (ValueError, UnicodeError):
                self.send_bytes(400)
                return
            if bundle.prefix and path == bundle.prefix:
                self.send_bytes(308, headers={"Location": bundle.prefix + "/" + ("?" + parsed.query if parsed.query else "")})
                return
            if not path.startswith(bundle.prefix + "/"):
                self.send_bytes(404)
                return
            name = path[len(bundle.prefix) + 1:]
            if name == HEALTH_PATH:
                body = json.dumps({"status": "ready", "identity": bundle.identity}, sort_keys=True).encode()
                self.send_bytes(200, body, {"Content-Type": "application/json", "Cache-Control": "no-store"})
                return
            if not name or name.endswith("/"):
                name += "index.html"
            elif name not in bundle.files and name + "/index.html" in bundle.files:
                self.send_bytes(308, headers={"Location": path + "/" + ("?" + parsed.query if parsed.query else "")})
                return
            if name not in bundle.files:
                self.send_bytes(404)
                return
            try:
                stream = bundle.open_file(name)
            except (BundleError, OSError):
                self.send_bytes(503, b"sealed file unavailable; revalidate bundle\n", {"Content-Type": "text/plain", "Cache-Control": "no-store"})
                return
            with stream:
                record = bundle.files[name]
                etag = '"' + record.sha256 + '"'
                modified = formatdate(record.modified, usegmt=True)
                headers = {"ETag": etag, "Last-Modified": modified, "Accept-Ranges": "bytes", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"}
                none_match = self.headers.get("If-None-Match")
                if none_match is not None:
                    cached = any(tag.strip().removeprefix("W/") in {etag, "*"} for tag in none_match.split(","))
                else:
                    cached = _not_modified(self.headers.get("If-Modified-Since", ""), record.modified)
                if cached:
                    # 304 has no body and no Content-Length (representation length is not zero).
                    self.send_response(304)
                    for key, value in headers.items():
                        self.send_header(key, value)
                    self.end_headers()
                    return
                start, end, status = 0, record.size - 1, 200
                requested = self.headers.get("Range")
                if_range = self.headers.get("If-Range")
                if requested and (not if_range or if_range == etag or (not if_range.startswith(('"', 'W/')) and _not_modified(if_range, record.modified))):
                    try:
                        start, end = byte_range(requested, record.size)
                    except ValueError:
                        self.send_bytes(416, headers={**headers, "Content-Range": f"bytes */{record.size}"})
                        return
                    status = 206
                    headers["Content-Range"] = f"bytes {start}-{end}/{record.size}"
                length = max(0, end - start + 1)
                suffix = os.path.splitext(name)[1].lower()
                headers["Content-Type"] = MIME_TYPES.get(suffix) or mimetypes.guess_type(name)[0] or "application/octet-stream"
                self.send_response(status)
                self.send_header("Content-Length", str(length))
                for key, value in headers.items():
                    self.send_header(key, value)
                self.end_headers()
                if self.command == "HEAD":
                    return
                stream.seek(start)
                while length:
                    chunk = stream.read(min(length, CHUNK_SIZE))
                    if not chunk:
                        self.close_connection = True
                        break
                    self.wfile.write(chunk)
                    length -= len(chunk)

    return StaticHandler


class StaticServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False


def create_server(bundle: Bundle, port: int) -> StaticServer:
    """Port 0 is permitted for test callers, not the public CLI."""
    try:
        return StaticServer(("127.0.0.1", port), handler_for(bundle))
    except OSError as exc:
        raise BundleError(f"cannot bind loopback port {port}; port may be occupied or unavailable") from exc


def serve(bundle: Bundle, port: int) -> int:
    server = create_server(bundle, port)
    previous = {}
    stopping = threading.Event()

    def stop(signum, frame):
        if not stopping.is_set():
            stopping.set()
            # shutdown must not run on the serve_forever thread.
            threading.Thread(target=server.shutdown, daemon=True).start()

    try:
        for signum in (signal.SIGINT, signal.SIGTERM):
            previous[signum] = signal.signal(signum, stop)
        print(f"local static viewer ready at http://127.0.0.1:{server.server_port}{bundle.prefix}/", flush=True)
        server.serve_forever(poll_interval=0.1)
        return 0
    finally:
        server.server_close()
        for signum, old_handler in previous.items():
            signal.signal(signum, old_handler)
