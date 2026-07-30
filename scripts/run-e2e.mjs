import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { rmSync } from "node:fs";
import { dirname } from "node:path";

const fixture = spawnSync("node", ["scripts/create-e2e-sqlite-fixture.mjs"], { encoding: "utf8" });
if (fixture.status !== 0 || !fixture.stdout.trim()) {
  process.stderr.write(fixture.stderr || "Unable to create E2E SQLite fixture.\n");
  process.exit(fixture.status ?? 1);
}

const databasePath = fixture.stdout.trim();
const server = createServer();
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to select an isolated Playwright port");
  server.close(() => {
    const playwright = spawn("npx", ["playwright", "test"], {
      env: { ...process.env, LEGACY_SQLITE_PATH: databasePath, PLAYWRIGHT_PORT: String(address.port) },
      stdio: "inherit",
    });
    playwright.on("exit", (code, signal) => {
      rmSync(dirname(databasePath), { recursive: true, force: true });
      process.exit(code ?? (signal ? 1 : 0));
    });
  });
});
