import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { isExplicitTestMysqlUrl } from '../../src/modules/ingestion/contracts';

const root = join(process.cwd(), 'scripts/ingest/viewer2-ingest.mjs');
const folders: string[] = [];
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'viewer2-ingest-')); folders.push(folder); const sqlite = join(folder, 'source.sqlite'); const db = new Database(sqlite);
  db.exec('CREATE TABLE verAB_barcodes (id INTEGER PRIMARY KEY, deleted INTEGER, last_synced TEXT, barcode TEXT); CREATE TABLE samples (id INTEGER PRIMARY KEY, name TEXT);');
  db.prepare('INSERT INTO verAB_barcodes (id, deleted, last_synced, barcode) VALUES (?, ?, ?, ?)').run(1, 0, '2026-01-01', 'A'); db.prepare('INSERT INTO samples (id, name) VALUES (?, ?)').run(1, 'sample'); db.close(); return { folder, sqlite };
}
function run(...args: string[]) { return JSON.parse(execFileSync(process.execPath, [root, 'ingest', ...args], { encoding: 'utf8' })); }
afterEach(() => folders.splice(0).forEach(folder => rmSync(folder, { recursive: true, force: true })));

describe('viewer2 ingest candidate tooling', () => {
  it('inspects read-only SQLite and stages deterministic provenance without connecting to MySQL', () => {
    const { folder, sqlite } = fixture(); const manifestPath = join(folder, 'manifest.json'); const manifest = run('inspect', '--sqlite', sqlite, '--output', manifestPath);
    expect(manifest.sourceChecksum).toMatch(/^[a-f0-9]{64}$/); expect(manifest.capabilities.hasBarcodes).toBe(true); expect(manifest.tables.find((table: { name: string }) => table.name === 'verAB_barcodes').deletedCount).toBe(0);
    const stage = run('stage', '--manifest', manifestPath, '--sqlite', sqlite, '--candidate', 'candidate-a', '--output', join(folder, 'stage'), '--mysql-url', 'mysql://u:p@127.0.0.1/viewer2_test_ingest?test_only=1');
    expect(stage.rejectionCount).toBe(0); expect(readFileSync(join(folder, 'stage', 'compatibility.sql'), 'utf8')).toContain('CREATE TABLE `verAB_barcodes`');
    const reportPath = join(folder, 'report.json'); const report = run('reconcile', '--candidate', 'candidate-a', '--sqlite', sqlite, '--stage', join(folder, 'stage'), '--report', reportPath, '--mysql-url', 'mysql://u:p@127.0.0.1/viewer2_test_ingest?test_only=1');
    expect(report.blockingCount).toBe(0); const materialization = join(folder, 'materialization.json');
    expect(run('materialize', '--candidate', 'candidate-a', '--stage', join(folder, 'stage'), '--report', reportPath, '--output', materialization, '--mysql-url', 'mysql://u:p@127.0.0.1/viewer2_test_ingest?test_only=1').noOp).toBeUndefined();
    expect(run('materialize', '--candidate', 'candidate-a', '--stage', join(folder, 'stage'), '--report', reportPath, '--output', materialization, '--mysql-url', 'mysql://u:p@127.0.0.1/viewer2_test_ingest?test_only=1').noOp).toBe(true);
    const pointer = join(folder, 'pointer.json'); expect(() => run('publish', '--candidate', 'candidate-a', '--audience', 'test', '--report', reportPath, '--confirm', 'wrong', '--pointer', pointer, '--mysql-url', 'mysql://u:p@127.0.0.1/viewer2_test_ingest?test_only=1')).toThrow(/exactly equal/); expect(() => readFileSync(pointer)).toThrow();
  });
  it('fails closed for non-test URLs and keeps pointers unchanged when confirmation is wrong', () => {
    const { folder, sqlite } = fixture(); const manifest = join(folder, 'manifest.json'); run('inspect', '--sqlite', sqlite, '--output', manifest);
    expect(() => run('stage', '--manifest', manifest, '--sqlite', sqlite, '--candidate', 'candidate-a', '--output', join(folder, 'stage'), '--mysql-url', 'mysql://u:p@db.example/live')).toThrow(/test_only=1/);
    expect(isExplicitTestMysqlUrl('mysql://u:p@127.0.0.1/viewer2_test_x?test_only=1')).toBe(true); expect(isExplicitTestMysqlUrl('mysql://u:p@127.0.0.1/live?test_only=1')).toBe(false);
  });
});
