import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

const recipientDemoStateFile = join(
  tmpdir(),
  `inspectionhub-playwright-recipient-${randomUUID()}.jsonl`,
);

export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: [["list"]],
  retries: process.env.CI ? 1 : 0,
  testDir: ".",
  use: {
    baseURL: "http://127.0.0.1:3010",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node rate-limit-fixture-server.mjs",
      reuseExistingServer: false,
      timeout: 30_000,
      url: "http://127.0.0.1:54329/health",
    },
    {
      command:
        "pnpm --filter @inspection/reporting build && pnpm --filter @inspection/recipient-access build && pnpm --filter @inspection/web build && pnpm --filter @inspection/web exec next start --hostname 127.0.0.1 --port 3010",
      env: {
        ...process.env,
        APP_ENV: "test",
        BUILD_WEEK_FIXTURES_ENABLED: "true",
        PROVIDER_MODE: "fake",
        RATE_LIMIT_HASH_SECRET: "playwright-rate-limit-hash-secret-32-chars",
        RECIPIENT_AUTHORITY_ADAPTER: "fixture",
        RECIPIENT_DEMO_ACCESS_ENABLED: "true",
        RECIPIENT_DEMO_OTP: "482913",
        RECIPIENT_DEMO_STATE_FILE: recipientDemoStateFile,
        RECIPIENT_SESSION_SECRET:
          "playwright-recipient-session-secret-32-chars",
        SUPABASE_API_URL: "http://127.0.0.1:54329",
        SUPABASE_SERVICE_ROLE_KEY: "playwright-service-role-key",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: "http://127.0.0.1:3010",
    },
  ],
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.PLAYWRIGHT_USE_SYSTEM_CHROME
          ? "chrome"
          : undefined,
      },
    },
    {
      name: "320px-reflow",
      use: {
        channel: process.env.PLAYWRIGHT_USE_SYSTEM_CHROME
          ? "chrome"
          : undefined,
        viewport: { height: 720, width: 320 },
      },
    },
  ],
});
