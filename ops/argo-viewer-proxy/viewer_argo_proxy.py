#!/usr/bin/env python3
"""Standalone Argo pass-through proxy for the ai-ale viewer, on 127.0.0.1:3459.

This is an independent implementation. It is NOT the reference proxy that
runs on 127.0.0.1:4000 (/scratch/vsetlur/argo-proxy/argo_proxy.py) and it
never reads, imports, or shells out to that script or its process.

Design points:
- Stdlib only (http.server, urllib, json, threading). PyYAML is used for
  config.yaml when available, with a built-in fallback config so a missing
  package never blocks startup.
- The caller's own Argo key is forwarded as both Authorization: Bearer and
  x-api-key. This service never stores, defaults, or reads a key from the
  environment. There is no "argo_default_user" concept here at all.
- Client auth on /v1/chat/completions is mandatory and checked before any
  upstream call is attempted.
- Bounded concurrency via a semaphore, non-blocking acquire, 503 when full.
- Every error body and every log line is passed through redact() so an
  active key can never leak into logs or responses.
"""

import http.server
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, "config.yaml")

BIND_HOST = "127.0.0.1"
FORBIDDEN_PORTS = {3457, 3458, 3306, 13306, 4000}
MAX_BODY_BYTES = 1 * 1024 * 1024  # 1 MiB

# Model ids that reject a custom temperature and want max_completion_tokens
# instead of max_tokens. Matched as substrings, same shape as the upstream
# family of restricted ids (gpt5 line and the o1/o3/o4 reasoning models).
RESTRICTED_PARAM_TOKENS = ("gpt5", "gpt-5", "o1", "o3", "o4")

DEFAULT_CONFIG = {
    "upstream": {
        "prod": "https://apps.inside.anl.gov/argoapi",
        "staging": "https://apps-stage.inside.anl.gov/argoapi",
    },
    "defaults": {"timeout": 300, "max_concurrency": 16},
    "models": {
        "opus": "claudeopus48",
        "opus48": "claudeopus48",
        "claudeopus48": "claudeopus48",
        "claudesonnet46": "claudesonnet46",
        "claudesonnet45": "claudesonnet45",
        "claudehaiku45": "claudehaiku45",
        "gpt55": "gpt55",
        "gpt54": "gpt54",
        "gpt54mini": "gpt54mini",
        "gpt54nano": "gpt54nano",
        "gpt52": "gpt52",
        "gpt51": "gpt51",
        "gpt5": "gpt5",
        "gpt5mini": "gpt5mini",
        "gpt5nano": "gpt5nano",
        "gpt41": "gpt41",
        "gpt41mini": "gpt41mini",
        "gpt41nano": "gpt41nano",
        "gpt4o": "gpt4o",
        "gpto4mini": "gpto4mini",
        "gpto3": "gpto3",
        "gpto3mini": "gpto3mini",
        "gpto1": "gpto1",
    },
}

# Populated by main() before the server starts serving requests.
CONFIG = DEFAULT_CONFIG
PORT = 3459
TIMEOUT = 300.0
SEMAPHORE = None


def load_config(path):
    """Load config.yaml with PyYAML when available. Any failure (missing
    package, missing file, unreadable, or malformed) falls back to the
    built-in default config so startup is never blocked by a missing dep."""
    try:
        import yaml
    except ImportError:
        return DEFAULT_CONFIG
    try:
        with open(path, "r") as fh:
            data = yaml.safe_load(fh)
        if not isinstance(data, dict):
            return DEFAULT_CONFIG
        upstream = data.get("upstream") or DEFAULT_CONFIG["upstream"]
        defaults = data.get("defaults") or DEFAULT_CONFIG["defaults"]
        models = data.get("models") or DEFAULT_CONFIG["models"]
        if not isinstance(models, dict) or not models:
            models = DEFAULT_CONFIG["models"]
        return {"upstream": upstream, "defaults": defaults, "models": models}
    except Exception:
        return DEFAULT_CONFIG


def redact(text, key):
    """Replace every occurrence of the active key with ***. Safe to call
    with a missing key or empty text; never raises."""
    if not text or not key:
        return text
    return text.replace(key, "***")


def is_claude_model(mid):
    return mid.lower().startswith("claude")


def is_restricted_param_model(mid):
    m = mid.lower()
    return any(tok in m for tok in RESTRICTED_PARAM_TOKENS)


def openai_messages_to_anthropic(messages):
    """Best-effort, independent translation of OpenAI-shaped chat messages
    into Anthropic messages-endpoint shape. Only plain text content is
    handled; tool-calling payloads are out of scope for this pass-through."""
    system_parts = []
    anthropic_messages = []
    for msg in messages or []:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role")
        content = msg.get("content")
        if isinstance(content, list):
            text = "".join(
                (block.get("text", "") if isinstance(block, dict) else str(block))
                for block in content
            )
        elif content is None:
            text = ""
        else:
            text = str(content)
        if role == "system":
            if text.strip():
                system_parts.append(text)
            continue
        if role not in ("user", "assistant"):
            role = "user"
        if not text.strip():
            text = "(empty)"
        anthropic_messages.append({"role": role, "content": [{"type": "text", "text": text}]})
    if not anthropic_messages:
        anthropic_messages = [{"role": "user", "content": [{"type": "text", "text": "(empty)"}]}]
    return system_parts, anthropic_messages


def anthropic_response_to_openai(data, model):
    content_blocks = data.get("content") or []
    text = "".join(
        block.get("text", "")
        for block in content_blocks
        if isinstance(block, dict) and block.get("type") == "text"
    )
    usage = data.get("usage") or {}
    prompt_tokens = usage.get("input_tokens", 0)
    completion_tokens = usage.get("output_tokens", 0)
    finish_reason = "stop" if data.get("stop_reason") else None
    return {
        "id": data.get("id"),
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": finish_reason,
            }
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
    }


def call_upstream(base, url_path, headers, body_bytes, timeout):
    url = base.rstrip("/") + url_path
    req = urllib.request.Request(url, data=body_bytes, method="POST")
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def forward_to_upstream(target_model, request_body, key):
    """Forward one chat request to Argo prod, failing over to staging on a
    5xx, network error, or timeout. Returns (status, body_bytes)."""
    bases = [CONFIG["upstream"].get("prod"), CONFIG["upstream"].get("staging")]
    bases = [b for b in bases if b]

    messages = request_body.get("messages", [])
    temperature = request_body.get("temperature", 1)
    max_tokens = request_body.get("max_tokens", 1024)

    common_headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + key,
        "x-api-key": key,
    }

    if is_claude_model(target_model):
        url_path = "/v1/messages"
        system_parts, anthropic_messages = openai_messages_to_anthropic(messages)
        body = {"model": target_model, "messages": anthropic_messages, "max_tokens": max_tokens}
        if system_parts:
            body["system"] = "\n".join(system_parts)
        headers = dict(common_headers)
        headers["anthropic-version"] = "2023-06-01"
        headers["anthropic-beta"] = "prompt-caching-2024-07-31"
    else:
        url_path = "/v1/chat/completions"
        body = {"model": target_model, "messages": messages, "stream": False}
        if is_restricted_param_model(target_model):
            body["max_completion_tokens"] = max_tokens
        else:
            body["temperature"] = temperature
            body["max_tokens"] = max_tokens
        # Pass tool definitions straight through when the caller supplies them.
        # The reference proxy drops these, so whether Argo honors them is
        # determined at runtime, not assumed.
        if isinstance(request_body.get("tools"), list) and request_body["tools"]:
            body["tools"] = request_body["tools"]
            if request_body.get("tool_choice") is not None:
                body["tool_choice"] = request_body["tool_choice"]
        headers = common_headers

    payload = json.dumps(body).encode("utf-8")

    last_status = 502
    for base in bases:
        try:
            status, raw = call_upstream(base, url_path, headers, payload, TIMEOUT)
        except Exception:
            # Network error or timeout: fail over to the next base.
            continue
        if status >= 500:
            last_status = status
            continue
        if is_claude_model(target_model) and status < 400:
            try:
                data = json.loads(raw)
                out = anthropic_response_to_openai(data, target_model)
                return status, json.dumps(out).encode("utf-8")
            except Exception:
                return 502, json.dumps({"error": {"code": "upstream_bad_response"}}).encode("utf-8")
        return status, raw
    return 502, json.dumps({"error": {"code": "upstream_unavailable", "last_status": last_status}}).encode("utf-8")


class ProxyHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "aiale-viewer-argo-proxy"
    sys_version = ""

    def log_message(self, format, *args):
        # Suppress the stdlib access log entirely. We emit our own
        # redacted, fixed-shape log line in _emit_log instead.
        pass

    def _client_key(self):
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return None
        key = auth[len("Bearer ") :].strip()
        return key or None

    def _emit_log(self, method, path, status, start_time, model, key):
        duration_ms = int((time.monotonic() - start_time) * 1000)
        line = "{} {} {} {}ms model={}".format(method, path, status, duration_ms, model or "-")
        line = redact(line, key)
        print(line, flush=True)

    def _write_json(self, status, payload, key=None, extra_headers=None):
        body = json.dumps(payload)
        body = redact(body, key)
        body_bytes = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body_bytes)))
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body_bytes)
        except Exception:
            pass

    def do_OPTIONS(self):
        start = time.monotonic()
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()
        self._emit_log("OPTIONS", self.path, 204, start, None, None)

    def _health_payload(self):
        return {
            "status": "ok",
            "service": "aiale-viewer-argo-proxy",
            "port": PORT,
            "upstream": CONFIG["upstream"].get("prod"),
            "models": len(CONFIG["models"]),
        }

    def _models_payload(self):
        data = [{"id": alias, "object": "model"} for alias in sorted(CONFIG["models"].keys())]
        return {"object": "list", "data": data}

    def do_GET(self):
        start = time.monotonic()
        if self.path == "/health":
            self._write_json(200, self._health_payload())
            self._emit_log("GET", self.path, 200, start, None, None)
            return
        if self.path == "/v1/models":
            self._write_json(200, self._models_payload())
            self._emit_log("GET", self.path, 200, start, None, None)
            return
        self._write_json(404, {"error": {"code": "not_found"}})
        self._emit_log("GET", self.path, 404, start, None, None)

    def do_HEAD(self):
        start = time.monotonic()
        if self.path == "/health":
            body_bytes = json.dumps(self._health_payload()).encode("utf-8")
            status = 200
        elif self.path == "/v1/models":
            body_bytes = json.dumps(self._models_payload()).encode("utf-8")
            status = 200
        else:
            body_bytes = json.dumps({"error": {"code": "not_found"}}).encode("utf-8")
            status = 404
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body_bytes)))
        self.end_headers()
        self._emit_log("HEAD", self.path, status, start, None, None)

    def _reject_method(self, verb):
        start = time.monotonic()
        self.close_connection = True
        self._write_json(
            405,
            {"error": {"code": "method_not_allowed"}},
            extra_headers={"Allow": "GET, HEAD, POST, OPTIONS"},
        )
        self._emit_log(verb, self.path, 405, start, None, None)

    def do_PUT(self):
        self._reject_method("PUT")

    def do_DELETE(self):
        self._reject_method("DELETE")

    def do_PATCH(self):
        self._reject_method("PATCH")

    def do_TRACE(self):
        self._reject_method("TRACE")

    def do_CONNECT(self):
        self._reject_method("CONNECT")

    def send_error(self, code, message=None, explain=None):
        if code == 501:
            self._reject_method(self.command)
            return
        super().send_error(code, message, explain)

    def do_POST(self):
        start = time.monotonic()
        if self.path != "/v1/chat/completions":
            self.close_connection = True
            self._write_json(404, {"error": {"code": "not_found"}})
            self._emit_log("POST", self.path, 404, start, None, None)
            return

        # Client auth is mandatory and checked before any upstream call.
        key = self._client_key()
        if not key:
            self.close_connection = True
            self._write_json(401, {"error": {"code": "missing_api_key"}})
            self._emit_log("POST", self.path, 401, start, None, None)
            return

        length = int(self.headers.get("Content-Length", 0) or 0)
        if length > MAX_BODY_BYTES:
            self.close_connection = True
            self._write_json(413, {"error": {"code": "payload_too_large"}}, key=key)
            self._emit_log("POST", self.path, 413, start, None, key)
            return

        raw_body = self.rfile.read(length) if length else b""
        try:
            req = json.loads(raw_body or b"{}")
        except Exception:
            self.close_connection = True
            self._write_json(400, {"error": {"code": "invalid_json"}}, key=key)
            self._emit_log("POST", self.path, 400, start, None, key)
            return

        alias = req.get("model", "") if isinstance(req, dict) else ""
        target = CONFIG["models"].get(alias)
        if not target:
            self.close_connection = True
            self._write_json(
                400,
                {
                    "error": {
                        "code": "unsupported_model",
                        "allowed": sorted(CONFIG["models"].keys()),
                    }
                },
                key=key,
            )
            self._emit_log("POST", self.path, 400, start, alias, key)
            return

        if SEMAPHORE is None or not SEMAPHORE.acquire(blocking=False):
            self._write_json(
                503,
                {"error": {"code": "proxy_busy"}},
                key=key,
                extra_headers={"Retry-After": "2"},
            )
            self._emit_log("POST", self.path, 503, start, target, key)
            return
        try:
            status, body_bytes = forward_to_upstream(target, req, key)
            body_text = redact(body_bytes.decode("utf-8", errors="replace"), key)
            body_bytes = body_text.encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body_bytes)))
            self.end_headers()
            try:
                self.wfile.write(body_bytes)
            except Exception:
                pass
            self._emit_log("POST", self.path, status, start, target, key)
        finally:
            SEMAPHORE.release()


def main():
    global CONFIG, PORT, TIMEOUT, SEMAPHORE

    port = int(os.environ.get("VIEWER_ARGO_PORT", "3459"))
    if port in FORBIDDEN_PORTS:
        sys.stderr.write(
            "refusing to start: port {} is reserved for another service, will not bind\n".format(port)
        )
        sys.exit(1)
    if BIND_HOST not in ("127.0.0.1", "localhost"):
        sys.stderr.write("refusing to start: bind host must be loopback\n")
        sys.exit(1)

    CONFIG = load_config(CONFIG_PATH)
    PORT = port
    TIMEOUT = float(os.environ.get("VIEWER_ARGO_TIMEOUT", str(CONFIG["defaults"].get("timeout", 300))))
    max_concurrency = int(
        os.environ.get("VIEWER_ARGO_MAX_CONCURRENCY", str(CONFIG["defaults"].get("max_concurrency", 16)))
    )
    SEMAPHORE = threading.BoundedSemaphore(max_concurrency)

    server = http.server.ThreadingHTTPServer((BIND_HOST, PORT), ProxyHandler)
    print("viewer-argo-proxy listening on http://{}:{}".format(BIND_HOST, PORT), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
