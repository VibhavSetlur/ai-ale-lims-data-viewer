#!/usr/bin/env python3
"""Fail closed when a prebake server is not serving the selected SQLite source."""
from __future__ import annotations
import argparse, hashlib, json, sqlite3, sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen


def get_json(base: str, path: str) -> dict:
    with urlopen(base.rstrip("/") + path, timeout=30) as response:
        if response.status != 200:
            raise RuntimeError(f"{path} returned HTTP {response.status}")
        return json.load(response)


def source_identity(path: Path) -> tuple[str, int, str, dict[str, int], set[str]]:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    stat = path.stat()
    con = sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True)
    try:
        tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        counts = {t: int(con.execute('SELECT COUNT(*) FROM "' + t.replace('"', '""') + '"').fetchone()[0]) for t in tables}
        experiments = {str(r[0]) for r in con.execute('SELECT DISTINCT "Experiment" FROM "Seq_samples" WHERE "Experiment" IS NOT NULL AND "Experiment" != ""')}
    finally:
        con.close()
    return digest, stat.st_size, datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"), counts, experiments


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True)
    parser.add_argument("--source", type=Path, required=True)
    args = parser.parse_args()
    try:
        source_hash, source_size, source_mtime, source_counts, source_experiments = source_identity(args.source)
        health = get_json(args.base, "/api/health")
        db = health.get("db", {})
        if db.get("driver") != "sqlite" or not db.get("ok"):
            raise RuntimeError(f"server database is not healthy SQLite: {db}")
        if int(db.get("size_bytes", -1)) != source_size:
            raise RuntimeError(f"server DB size {db.get('size_bytes')} != source size {source_size}")
        server_mtime = str(db.get("mtime", ""))
        if server_mtime[:23] != source_mtime[:23]:
            raise RuntimeError(f"server DB mtime {server_mtime} != source mtime {source_mtime}")
        config = get_json(args.base, "/api/config")
        configured = Path(str(config.get("sqlitePath", ""))).resolve()
        if configured != args.source.resolve():
            raise RuntimeError(f"server SQLITE_PATH {configured} != selected source {args.source.resolve()}")
        table_payload = get_json(args.base, "/api/tables?withCounts=1")
        server_counts = {str(row["name"]): int(row["rowCount"]) for row in table_payload.get("tables", [])}
        if server_counts != source_counts:
            missing = sorted(set(source_counts) - set(server_counts))
            extra = sorted(set(server_counts) - set(source_counts))
            mismatched = sorted(k for k in source_counts.keys() & server_counts.keys() if source_counts[k] != server_counts[k])[:10]
            raise RuntimeError(f"server table identity differs: missing={missing[:10]} extra={extra[:10]} mismatched={mismatched}")
        mutations = get_json(args.base, "/api/mutations")
        server_experiments = {str(x) for x in mutations.get("experiments", [])}
        if server_experiments != source_experiments:
            raise RuntimeError(f"server mutation experiments {sorted(server_experiments)} != source {sorted(source_experiments)}")
        result = {"status": "ok", "sourceSha256": source_hash, "bytes": source_size, "tables": len(source_counts), "experiments": sorted(source_experiments)}
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as exc:
        print(f"server source validation failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
