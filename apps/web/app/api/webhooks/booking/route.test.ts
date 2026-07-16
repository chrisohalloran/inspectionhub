import { afterEach, describe, expect, it, vi } from "vitest";

import { createBookingWebhookHandler } from "./route";

const fixtureHeaders = {
  "content-type": "application/json",
  "x-inspection-fixture": "synthetic-build-week",
};

describe("booking webhook fixture boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts the synthetic webhook in a production build only when explicitly enabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BUILD_WEEK_FIXTURES_ENABLED", "true");

    const consumeRateLimit = vi.fn(() =>
      Promise.resolve({ allowed: true, remaining: 119, retryAfterSeconds: 0 }),
    );
    const post = createBookingWebhookHandler({ consumeRateLimit });
    const response = await post(
      new Request("https://example.test/api/webhooks/booking", {
        body: JSON.stringify({
          bookingId: "SI-1042",
          eventId: "evt-production-fixture-enabled",
          intentId: "checkout-intent-1",
          kind: "checkout.succeeded",
          providerReference: "pi-old",
        }),
        headers: fixtureHeaders,
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "reconciliation_required",
      replayed: false,
      transitionCount: 0,
    });
    expect(consumeRateLimit).toHaveBeenCalledWith(
      "provider_callback",
      "booking-webhook",
    );
  });

  it("fails closed when either trusted configuration or the fixture header is absent", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const post = createBookingWebhookHandler({
      consumeRateLimit: () =>
        Promise.resolve({
          allowed: true,
          remaining: 119,
          retryAfterSeconds: 0,
        }),
    });
    const disabled = await post(
      new Request("https://example.test/api/webhooks/booking", {
        body: "{}",
        headers: fixtureHeaders,
        method: "POST",
      }),
    );
    expect(disabled.status).toBe(404);

    vi.stubEnv("BUILD_WEEK_FIXTURES_ENABLED", "true");
    const missingHeader = await post(
      new Request("https://example.test/api/webhooks/booking", {
        body: "{}",
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(missingHeader.status).toBe(404);
  });

  it("rejects a durable callback rate-limit breach before processing payload", async () => {
    vi.stubEnv("BUILD_WEEK_FIXTURES_ENABLED", "true");
    const post = createBookingWebhookHandler({
      consumeRateLimit: () =>
        Promise.resolve({
          allowed: false,
          remaining: 0,
          retryAfterSeconds: 17,
        }),
    });

    const response = await post(
      new Request("https://example.test/api/webhooks/booking", {
        body: "not-json",
        headers: fixtureHeaders,
        method: "POST",
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    await expect(response.json()).resolves.toEqual({ error: "rate_limited" });
  });
});
