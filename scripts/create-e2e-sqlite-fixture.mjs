import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "viewer2-e2e-"));
const path = join(directory, "scientific-catalog.db");
const db = new Database(path);
db.exec(`
  CREATE TABLE samples (id INTEGER PRIMARY KEY, name TEXT, deleted INTEGER);
  INSERT INTO samples VALUES (1, 'alpha', 0);
  CREATE TABLE Mutations (Seq_sample TEXT, Experiment TEXT, Breseq_registry_ID TEXT, gene_name TEXT, position INTEGER, frequency REAL, type TEXT);
  INSERT INTO Mutations VALUES ('s1', 'e1', 'r1', 'gyrA', 42, 0.4, 'SNP');
  CREATE TABLE Robotic_OD (sample_name TEXT, transfer INTEGER, od REAL, timepoint INTEGER, experiment TEXT);
  INSERT INTO Robotic_OD VALUES ('s1', 1, 0.2, 1, 'e1'), ('s1', 1, 0.5, 2, 'e1');
  CREATE TABLE Copy_numbers (Seqsample TEXT, Region_name TEXT, Region_CN REAL);
  INSERT INTO Copy_numbers VALUES ('s1', 'region-1', 1.5);
  CREATE TABLE verAB_barcodes (Seqsample TEXT, Candidate TEXT, Count INTEGER);
  INSERT INTO verAB_barcodes VALUES ('s1', 'A1-B1', 10);
`);
db.close();
process.stdout.write(path);
