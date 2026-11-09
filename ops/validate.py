#!/usr/bin/env python3
"""Validate static source assets and generated profile/target bundles."""
from __future__ import annotations
import argparse, hashlib, json, os, sqlite3, sys
from pathlib import Path

PROFILES = {
    "trimmed": Path("data/lims_TFMN1_indexed.db"),
    "full": Path("data/lims_indexed.db"),
}
TARGETS = {"aiale": "/annotation/projects/aiale", "aiale-dev": "/annotation/projects/aiale-dev", "kind": ""}

def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def source_info(path: Path) -> dict:
    if not path.is_file(): raise ValueError(f"source DB not found: {path}")
    st = path.stat()
    if not st.st_size: raise ValueError(f"source DB is empty: {path}")
    con = sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True)
    try:
        integrity = con.execute("PRAGMA integrity_check").fetchone()
        if not integrity or integrity[0].lower() != "ok": raise ValueError(f"integrity_check failed for {path}: {integrity!r}")
        tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        counts = {t: con.execute('SELECT COUNT(*) FROM "' + t.replace('"', '""') + '"').fetchone()[0] for t in tables}
        if not tables or not any(counts.values()): raise ValueError(f"source DB has no populated user tables: {path}")
    finally: con.close()
    return {"path": str(path), "sha256": digest(path), "bytes": st.st_size, "mtime": st.st_mtime, "integrity": "ok", "tables": counts}

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--source", type=Path)
    p.add_argument("--profile", choices=PROFILES)
    p.add_argument("--release", type=Path)
    p.add_argument("--out", type=Path)
    p.add_argument("--target", choices=TARGETS)
    p.add_argument("--root-path")
    args = p.parse_args()
    root = Path.cwd()
    try:
        profile = args.profile
        if profile:
            expected = root / PROFILES[profile]
            source = (args.source or expected).resolve()
            if args.source is None and not source.exists():
                raise ValueError(f"profile {profile} requires {expected}; copy or refresh the asset first")
        elif args.source:
            source = args.source.resolve()
        else:
            raise ValueError("provide --profile or --source")
        info = source_info(source)
        if profile and source != (root / PROFILES[profile]).resolve():
            # Release commands may use an explicit absolute source, but make identity visible.
            info["profilePath"] = str(root / PROFILES[profile])
        if args.release:
            release = args.release.resolve()
            manifest_path = release / "data" / "manifest.json"
            config_path = release / "db" / "config.json"
            if not manifest_path.is_file(): raise ValueError(f"missing release manifest: {manifest_path}")
            manifest = json.loads(manifest_path.read_text())
            if profile and manifest.get("profile") != profile: raise ValueError(f"manifest profile {manifest.get('profile')!r} != {profile!r}")
            snap = manifest.get("snapshot", {})
            if snap.get("sha256") != info["sha256"]: raise ValueError("manifest source SHA-256 does not match selected source")
            if args.target and manifest.get("target") != args.target: raise ValueError("manifest target does not match requested target")
            if args.root_path is not None and manifest.get("basePath") != args.root_path: raise ValueError("manifest base path does not match requested root path")
            if not config_path.is_file(): raise ValueError(f"missing HTTPVFS config: {config_path}")
            config = json.loads(config_path.read_text())
            if config.get("sourceSha256") != info["sha256"]: raise ValueError("HTTPVFS source SHA-256 does not match selected source")
            link = release / "db" / "lims.db"
            if not link.is_symlink(): raise ValueError(f"missing HTTPVFS symlink: {link}")
            out = args.out.resolve() if args.out else release / "out"
            if not out.is_dir() or not (out / "index.html").is_file(): raise ValueError(f"incomplete static output: {out}")
            out_manifest = out / "data" / "manifest.json"
            if not out_manifest.is_file(): raise ValueError(f"output is missing data/manifest.json: {out}")
            output_manifest = json.loads(out_manifest.read_text())
            for key in ("profile", "target", "basePath", "snapshot"):
                if output_manifest.get(key) != manifest.get(key): raise ValueError(f"output manifest {key} differs from release manifest")
        print(json.dumps({"status": "ok", "profile": profile, "target": args.target, "source": info}, sort_keys=True))
        return 0
    except (OSError, sqlite3.Error, ValueError, json.JSONDecodeError) as e:
        print(f"validation failed: {e}", file=sys.stderr)
        return 1

if __name__ == "__main__": raise SystemExit(main())
