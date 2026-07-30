#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { APPROVED_SOURCE_SHA256, inspectSqlite, inspectSqliteFixture } from "../../src/modules/ingestion/manifest.mjs";
const args = process.argv.slice(2); const option = (name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const sqlite = option("--sqlite"); const out = option("--out"); const sha256 = option("--sha256") ?? APPROVED_SOURCE_SHA256; const testFixture = option("--test-fixture");
if (!sqlite || !out) throw new Error("Usage: ingest:inspect --sqlite FILE --out MANIFEST [--sha256 approved-source-sha256]");
if (testFixture && process.env.NODE_ENV !== "test") throw new Error("--test-fixture is available only when NODE_ENV=test.");
const fixture = testFixture ? JSON.parse(readFileSync(testFixture, "utf8")) : undefined;
if (fixture && sha256 !== APPROVED_SOURCE_SHA256) throw new Error("Test fixtures must not override the production approved source checksum option.");
writeFileSync(out, `${JSON.stringify(fixture ? inspectSqliteFixture(sqlite, fixture) : inspectSqlite(sqlite, sha256), null, 2)}\n`, { mode: 0o600 });
