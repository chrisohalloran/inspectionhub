import { afterEach, describe, expect, it, vi } from "vitest";

import { createAccessWebhookHandler } from "./handler";

const fixtureHeaders = {
  "content-type": "application/json",
  "x-inspection-fixture": "synthetic-build-week",
};

describe("access webhook fixture boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exercises superseded-link denial in a production build only when explicitly enabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BUILD_WEEK_FIXTURES_ENABLED", "true");

    const consumeRateLimit = vi.fn(() =>
      Promise.resolve({ allowed: true, remaining: 29, retryAfterSeconds: 0 }),
    );
    const post = createAccessWebhookHandler({ consumeRateLimit });
    const response = await post(
      new Request("https://example.test/api/webhooks/access", {
        body: JSON.stringify({ token: "access-v1-superseded" }),
        headers: fixtureHeaders,
        method: "POST",
      }),
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "access_link_superseded",
      state: "invalidated",
    });
    expect(consumeRateLimit).toHaveBeenCalledWith(
      "recipient_access",
      "access-webhook",
    );
  });

  it("fails closed when either trusted configuration or the fixture header is absent", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const post = createAccessWebhookHandler({
      consumeRateLimit: () =>
        Promise.resolve({ allowed: true, remaining: 29, retryAfterSeconds: 0 }),
    });
    const disabled = await post(
      new Request("https://example.test/api/webhooks/access", {
        body: JSON.stringify({ token: "access-v1-superseded" }),
        headers: fixtureHeaders,
        method: "POST",
      }),
    );
    expect(disabled.status).toBe(404);

    vi.stubEnv("BUILD_WEEK_FIXTURES_ENABLED", "true");
    const missingHeader = await post(
      new Request("https://example.test/api/webhooks/access", {
        body: JSON.stringify({ token: "access-v1-superseded" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(missingHeader.status).toBe(404);
  });

  it("rejects a durable access rate-limit breach before token evaluation", async () => {
    vi.stubEnv("BUILD_WEEK_FIXTURES_ENABLED", "true");
    const post = createAccessWebhookHandler({
      consumeRateLimit: () =>
        Promise.resolve({
          allowed: false,
          remaining: 0,
          retryAfterSeconds: 23,
        }),
    });

    const response = await post(
      new Request("https://example.test/api/webhooks/access", {
        body: JSON.stringify({ token: "access-v2-current" }),
        headers: fixtureHeaders,
        method: "POST",
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("23");
    await expect(response.json()).resolves.toEqual({ error: "rate_limited" });
  });
});
