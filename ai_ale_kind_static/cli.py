"""Checkout-independent local static launcher with no serving dependencies."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

from . import TOOL_ID, __version__
from .bundle import BundleError, normalize_prefix, validate_bundle
from .server import HEALTH_PATH, serve

BUNDLE_ENV = "AI_ALE_KIND_STATIC_BUNDLE"


def port_value(value: str) -> int:
    try:
        port = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("port must be an integer") from exc
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("port must be between 1 and 65535")
    return port


def prefix_value(value: str) -> str:
    try:
        return normalize_prefix(value)
    except BundleError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc


def info() -> dict:
    return {"tool": TOOL_ID, "version": __version__, "status": "provisional-local-tooling", "registered": False, "mode": "static", "dependencies": "Python standard library only", "bundle_env": BUNDLE_ENV, "health_path": "/" + HEALTH_PATH, "prefix_policy": "runtime root path must equal sealed compiled prefix"}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog=TOOL_ID, description="Provisional local static tooling, not KIND catalog registration")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("info", help="show tooling identity, not a catalog manifest")
    for command in ("doctor", "serve"):
        sub = commands.add_parser(command, help="validate bundle offline" if command == "doctor" else "serve a sealed bundle on loopback")
        sub.add_argument("--bundle", type=Path, help=f"sealed bundle directory (or {BUNDLE_ENV})")
        sub.add_argument("--root-path", type=prefix_value, required=True, help="exact compiled prefix; use an empty string for root")
        if command == "serve":
            sub.add_argument("--port", type=port_value, required=True)
            sub.add_argument("--no-king", action="store_true", help="compatibility flag; no registration occurs with or without it")
    args = parser.parse_args(argv)
    if args.command == "info":
        print(json.dumps(info(), indent=2, sort_keys=True))
        return 0
    bundle_path = args.bundle or os.environ.get(BUNDLE_ENV)
    if not bundle_path:
        print(f"error: specify --bundle or {BUNDLE_ENV}; no checkout or artifact fallback is used", file=sys.stderr)
        return 2
    try:
        bundle = validate_bundle(bundle_path, args.root_path)
        if args.command == "doctor":
            print(json.dumps({"status": "ready", "identity": bundle.identity, "validated_files": len(bundle.files)}, indent=2, sort_keys=True))
            return 0
        return serve(bundle, args.port)
    except BundleError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
