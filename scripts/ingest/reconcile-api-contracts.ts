import { readFileSync } from "node:fs";
import { MysqlScientificRepository } from "../../src/server/db/scientific/mysql";
import { SqliteScientificRepository } from "../../src/server/db/scientific/sqlite";
import { runApiContractFixtures, type ApiContractFixture } from "../../src/shared/test/api-contract-fixtures";

type Input = { sqlite: string; mysqlUrl: string; database: string; fixtures: ApiContractFixture[] };
const input = JSON.parse(readFileSync(0, "utf8")) as Input;
const normalize = (value: unknown): unknown => Array.isArray(value) ? value.map(normalize) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "request").sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)])) : typeof value === "bigint" ? value.toString() : Buffer.isBuffer(value) ? value.toString("base64") : value;
const canonical = (value: unknown) => JSON.stringify(normalize(value));
const sqlite = new SqliteScientificRepository(input.sqlite); const mysql = new MysqlScientificRepository(input.mysqlUrl, input.database);
try {
  const [left, right] = await Promise.all([runApiContractFixtures(sqlite, input.fixtures), runApiContractFixtures(mysql, input.fixtures)]); const differences: string[] = [];
  for (const fixture of input.fixtures) { if (left[fixture.name].status !== right[fixture.name].status || canonical(left[fixture.name].payload) !== canonical(right[fixture.name].payload)) differences.push(`api fixture ${fixture.name}: normalized success/error payload, warnings, provenance, or capability outcome differs`); if (left[fixture.name].csv !== right[fixture.name].csv) differences.push(`api fixture ${fixture.name}: CSV bytes differ`); }
  process.stdout.write(JSON.stringify({ differences }));
} finally { await mysql.close(); }
