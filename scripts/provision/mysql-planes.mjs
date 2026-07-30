#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import mysql from "mysql2/promise";
const [command, ...args] = process.argv.slice(2); const option = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const secretsFile = option("--secrets-file");
if (!secretsFile || !["apply", "verify"].includes(command)) throw new Error("Usage: mysql-planes.mjs apply|verify --secrets-file FILE");
if ((statSync(secretsFile).mode & 0o077) !== 0) throw new Error("Secrets file must be mode 0600.");
const secrets = JSON.parse(readFileSync(secretsFile, "utf8"));
for (const name of ["adminUrl", "scientificIngestPassword", "scientificReadPassword", "operationalAppPassword"]) if (typeof secrets[name] !== "string" || !secrets[name]) throw new Error(`Missing ${name}.`);
const account = (user) => `'${user.replaceAll("'", "''")}'@'localhost'`;
const users = { ingest: "aiale_scientific_ingest", read: "aiale_scientific_read", app: "aiale_operational_app" };
const root = await mysql.createConnection(secrets.adminUrl);
try {
  if (command === "apply") {
    await root.query("CREATE DATABASE IF NOT EXISTS `aiale_scientific_a3a286b4` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs"); await root.query("CREATE DATABASE IF NOT EXISTS `aiale_operational` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs");
    for (const [key, user] of Object.entries(users)) await root.query(`CREATE USER IF NOT EXISTS ${account(user)} IDENTIFIED BY ?`, [secrets[`${key === "app" ? "operationalApp" : `scientific${key[0].toUpperCase()}${key.slice(1)}`}Password`]]);
    await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP ON \`aiale_scientific_a3a286b4\`.* TO ${account(users.ingest)}`); await root.query(`GRANT SELECT ON \`aiale_scientific_a3a286b4\`.* TO ${account(users.read)}`); await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP ON \`aiale_operational\`.* TO ${account(users.app)}`); console.log("PASS planes-created");
  } else {
    let failed = false;
    for (const [name, user, database, privilege] of [["scientific-ingest-grant", users.ingest, "aiale_scientific_a3a286b4", "INSERT"], ["scientific-read-grant", users.read, "aiale_scientific_a3a286b4", "SELECT"], ["operational-app-grant", users.app, "aiale_operational", "INSERT"]]) { const [rows] = await root.query("SELECT COUNT(*) AS count FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = ? AND TABLE_SCHEMA = ? AND PRIVILEGE_TYPE = ?", [`'${user}'@'localhost'`, database, privilege]); const pass = Number(rows[0].count) > 0; console.log(`${pass ? "PASS" : "FAIL"} ${name}`); failed ||= !pass; }
    for (const [name, user, database] of [["scientific-read-no-operational", users.read, "aiale_operational"], ["scientific-ingest-no-operational", users.ingest, "aiale_operational"], ["operational-app-no-scientific", users.app, "aiale_scientific_a3a286b4"]]) { const [rows] = await root.query("SELECT COUNT(*) AS count FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = ? AND TABLE_SCHEMA = ?", [`'${user}'@'localhost'`, database]); const pass = Number(rows[0].count) === 0; console.log(`${pass ? "PASS" : "FAIL"} ${name}`); failed ||= !pass; }
    if (failed) process.exitCode = 1;
  }
} finally { await root.end(); }
