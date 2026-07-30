import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PLAYWRIGHT_PORT must be an available TCP port");
}
export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `ASSISTANT_MODE=fake npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/mutations/cohort`,
    reuseExistingServer: false,
  },
});
