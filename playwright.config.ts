import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: "frontend/e2e",
  outputDir: process.env.CAL_TEST_ARTIFACTS ?? join(tmpdir(), "cal-playwright"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  globalTimeout: 120000,
  reporter: "list",
  use: {
    baseURL: process.env.CAL_E2E_URL ?? "http://127.0.0.1:15173",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: process.env.CAL_E2E_URL
    ? []
    : [
        {
          command: "go run .",
          cwd: "backend",
          env: { APP_ADDR: "127.0.0.1:18080" },
          url: "http://127.0.0.1:18080/api/health",
          reuseExistingServer: false,
          timeout: 60000,
          gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
        },
        {
          command: "npm exec vite -- --host 127.0.0.1 --port 15173 --strictPort",
          env: { CAL_API_TARGET: "http://127.0.0.1:18080" },
          url: "http://127.0.0.1:15173",
          reuseExistingServer: false,
          timeout: 30000,
          gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
        },
      ],
});
