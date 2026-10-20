#!/usr/bin/env python3
"""Validate a SQLite LIMS snapshot and emit durable, machine-readable evidence."""
import hashlib
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

if len(sys.argv) != 2:
    print("usage: validate-snapshot.py DATABASE", file=sys.stderr)
    sys.exit(2)

path = sys.argv[1]
try:
    stat = os.stat(path)
    if stat.st_size == 0:
        raise RuntimeError("database is empty")
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    connection = sqlite3.connect(f"file:{os.path.abspath(path)}?mode=ro", uri=True)
    integrity = connection.execute("PRAGMA integrity_check").fetchone()
    if integrity is None or integrity[0].lower() != "ok":
        raise RuntimeError(f"integrity_check returned {integrity!r}")
    tables = [row[0] for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )]
    if not tables:
        raise RuntimeError("database has no user tables")
    counts = {}
    for table in tables:
        quoted = '"' + table.replace('"', '""') + '"'
        counts[table] = connection.execute(f"SELECT COUNT(*) FROM {quoted}").fetchone()[0]
    # A LIMS mirror must have at least one populated table. We intentionally do not
    # require a fixed table list: upstream schema additions/removals are evidence to
    # review, not a reason to publish a partly understood hard-coded schema.
    if not any(counts.values()):
        raise RuntimeError("all user tables are empty")
    connection.close()
    print(json.dumps({
        "validatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "path": os.path.abspath(path),
        "sha256": digest.hexdigest(),
        "bytes": stat.st_size,
        "mtimeEpoch": int(stat.st_mtime),
        "integrity": "ok",
        "tables": counts,
    }, sort_keys=True))
except Exception as error:
    print(f"snapshot validation failed: {error}", file=sys.stderr)
    sys.exit(1)
