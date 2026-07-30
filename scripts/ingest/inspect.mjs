#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { inspectSqlite } from "../../src/modules/ingestion/manifest.mjs";
const args = process.argv.slice(2); const option = (name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const sqlite = option("--sqlite"); const out = option("--out"); const sha256 = option("--sha256");
if (!sqlite || !out) throw new Error("Usage: ingest:inspect --sqlite FILE --out MANIFEST [--sha256 SHA256]");
writeFileSync(out, `${JSON.stringify(inspectSqlite(sqlite, sha256), null, 2)}\n`, { mode: 0o600 });
