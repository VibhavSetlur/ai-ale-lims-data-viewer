import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 30_000 + Math.floor(Math.random() * 10_000));
export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `ASSISTANT_MODE=fake npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/mutations/cohort`,
    reuseExistingServer: false,
  },
});
