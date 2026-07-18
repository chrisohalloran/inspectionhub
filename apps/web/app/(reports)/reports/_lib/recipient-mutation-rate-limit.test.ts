import { describe, expect, it, vi } from "vitest";

import { enforceRecipientMutationRateLimit } from "./recipient-mutation-rate-limit";

describe("public recipient mutation rate limit", () => {
  it("uses bounded global and per-grant buckets after authentication", async () => {
    const consume = vi.fn(() =>
      Promise.resolve({ allowed: true, remaining: 29, retryAfterSeconds: 0 }),
    );

    await expect(
      enforceRecipientMutationRateLimit(
        "share",
        "grant_01J00000000000000000000000",
        consume,
      ),
    ).resolves.toBeNull();
    expect(consume.mock.calls).toEqual([
      [
        "recipient_access",
        "recipient-demo-share-grant_01J00000000000000000000000",
      ],
      ["recipient_demo_global", "recipient-demo-share-global"],
    ]);
  });

  it("applies the authenticated global circuit after the grant allowance", async () => {
    const consume = vi
      .fn()
      .mockResolvedValueOnce({
        allowed: true,
        remaining: 29,
        retryAfterSeconds: 0,
      })
      .mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 31,
      });
    const response = await enforceRecipientMutationRateLimit(
      "share",
      "grant_01J00000000000000000000000",
      consume,
    );

    expect(response?.status).toBe(429);
    expect(consume.mock.calls).toEqual([
      [
        "recipient_access",
        "recipient-demo-share-grant_01J00000000000000000000000",
      ],
      ["recipient_demo_global", "recipient-demo-share-global"],
    ]);
  });

  it("returns a retryable response without reaching mutation authority", async () => {
    const consume = vi.fn().mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 19,
    });
    const response = await enforceRecipientMutationRateLimit(
      "contact",
      "grant_01J00000000000000000000000",
      consume,
    );

    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("19");
    expect(consume).toHaveBeenCalledTimes(1);
    await expect(response?.json()).resolves.toEqual({ error: "rate_limited" });
  });

  it("fails closed when the durable limiter is unavailable", async () => {
    const response = await enforceRecipientMutationRateLimit(
      "share",
      "grant_01J00000000000000000000000",
      () => Promise.reject(new Error("unavailable")),
    );

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({
      error: "security_boundary_unavailable",
    });
  });

  it("rejects malformed grant identity without consuming a shared bucket", async () => {
    const consume = vi.fn();
    const response = await enforceRecipientMutationRateLimit(
      "share",
      "bad grant",
      consume,
    );

    expect(response?.status).toBe(503);
    expect(consume).not.toHaveBeenCalled();
  });
});
