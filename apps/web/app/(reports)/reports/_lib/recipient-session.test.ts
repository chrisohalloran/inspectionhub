import { afterEach, describe, expect, it, vi } from "vitest";

import { demoRecipientAuthEnabled } from "./recipient-session";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("recipient demo feature boundary", () => {
  it("enables the public recipient demo in preview without broad fixtures", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "preview");
    vi.stubEnv("RECIPIENT_DEMO_ACCESS_ENABLED", "true");
    vi.stubEnv("BUILD_WEEK_FIXTURES_ENABLED", "false");

    expect(demoRecipientAuthEnabled()).toBe(true);
  });

  it("keeps the production environment and disabled preview fail closed", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("RECIPIENT_DEMO_ACCESS_ENABLED", "true");
    expect(demoRecipientAuthEnabled()).toBe(false);

    vi.stubEnv("APP_ENV", "preview");
    vi.stubEnv("RECIPIENT_DEMO_ACCESS_ENABLED", "false");
    vi.stubEnv("BUILD_WEEK_FIXTURES_ENABLED", "true");
    expect(demoRecipientAuthEnabled()).toBe(false);
  });

  it("retains the explicit local production-build test harness", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("RECIPIENT_DEMO_ACCESS_ENABLED", "true");
    vi.stubEnv("BUILD_WEEK_FIXTURES_ENABLED", "true");
    expect(demoRecipientAuthEnabled()).toBe(true);

    vi.stubEnv("BUILD_WEEK_FIXTURES_ENABLED", "false");
    expect(demoRecipientAuthEnabled()).toBe(false);
  });
});
