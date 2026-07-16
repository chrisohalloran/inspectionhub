import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  availableLoopbackPort,
  createJudgeDemoState,
  judgeDemoEnvironment,
  LOOPBACK_HOST,
  removeJudgeDemoState,
  requestedWebPort,
  SYNTHETIC_OTP,
} from "./config.mjs";

describe("local judge demo boundary", () => {
  it("overrides unsafe inherited values with test-only loopback fixtures", () => {
    const environment = judgeDemoEnvironment({
      baseEnvironment: {
        APP_ENV: "production",
        DATABASE_URL: "postgresql://live-system",
        GOOGLE_CALENDAR_CREDENTIALS_JSON: "live-calendar-must-not-escape",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "live-browser-key-must-not-escape",
        OPENAI_API_KEY: "live-key-must-not-escape",
        PROVIDER_MODE: "live",
        RECIPIENT_AUTHORITY_ADAPTER: "supabase",
      },
      rateLimitPort: 54329,
      recipientStateFile: "/tmp/unique-recipient.jsonl",
    });

    expect(environment).toMatchObject({
      APP_ENV: "test",
      BUILD_WEEK_FIXTURES_ENABLED: "true",
      DATABASE_URL: "",
      GOOGLE_CALENDAR_CREDENTIALS_JSON: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      NEXT_PUBLIC_SUPABASE_URL: "",
      OPENAI_API_KEY: "",
      PROVIDER_MODE: "fake",
      RECIPIENT_AUTHORITY_ADAPTER: "fixture",
      RECIPIENT_DEMO_OTP: SYNTHETIC_OTP,
      SUPABASE_API_URL: `http://${LOOPBACK_HOST}:54329`,
    });
  });

  it("accepts only unprivileged local web ports", () => {
    expect(requestedWebPort({ JUDGE_DEMO_PORT: "4010" })).toBe(4010);
    expect(requestedWebPort({})).toBeUndefined();
    expect(() => requestedWebPort({ JUDGE_DEMO_PORT: "0" })).toThrow();
    expect(() => requestedWebPort({ JUDGE_DEMO_PORT: "public" })).toThrow();
  });

  it("allocates an unprivileged loopback port for judge services", async () => {
    const port = await availableLoopbackPort();
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThanOrEqual(1024);
    expect(port).toBeLessThanOrEqual(65_535);
  });

  it("creates unique state and removes the whole fixture directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "judge-demo-config-test-"));
    const first = await createJudgeDemoState(root);
    const second = await createJudgeDemoState(root);
    expect(first.directory).not.toBe(second.directory);
    await removeJudgeDemoState(first.directory);
    await expect(access(first.directory)).rejects.toThrow();
    await removeJudgeDemoState(second.directory);
    await removeJudgeDemoState(root);
  });
});
