import { describe, expect, it, vi } from "vitest";

import { createInvitationRedemptionHandler } from "./route";

describe("recipient invitation redemption rate limit", () => {
  it("consumes the fixed recipient bucket before invitation state is written", async () => {
    const beginInvitation = vi.fn(() => Promise.resolve("pending-token"));
    const consumeRateLimit = vi.fn(() =>
      Promise.resolve({ allowed: true, remaining: 29, retryAfterSeconds: 0 }),
    );
    const post = createInvitationRedemptionHandler({
      beginInvitation,
      consumeRateLimit,
    });

    const response = await post(redemptionRequest("demo-invite-unique-value"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/auth/verify");
    expect(consumeRateLimit).toHaveBeenCalledWith(
      "recipient_access",
      "recipient-invitation-redeem",
    );
    expect(beginInvitation).toHaveBeenCalledOnce();
    expect(consumeRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      beginInvitation.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("rejects a durable limit breach without writing attacker-selected invitation state", async () => {
    const beginInvitation = vi.fn(() => Promise.resolve("pending-token"));
    const post = createInvitationRedemptionHandler({
      beginInvitation,
      consumeRateLimit: () =>
        Promise.resolve({
          allowed: false,
          remaining: 0,
          retryAfterSeconds: 17,
        }),
    });

    const response = await post(redemptionRequest("demo-invite-arbitrary"));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    await expect(response.json()).resolves.toEqual({ error: "rate_limited" });
    expect(beginInvitation).not.toHaveBeenCalled();
  });

  it("fails closed before invitation state when the durable limiter is unavailable", async () => {
    const beginInvitation = vi.fn(() => Promise.resolve("pending-token"));
    const post = createInvitationRedemptionHandler({
      beginInvitation,
      consumeRateLimit: () => Promise.reject(new Error("unavailable")),
    });

    const response = await post(redemptionRequest("demo-invite-arbitrary"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "security_boundary_unavailable",
    });
    expect(beginInvitation).not.toHaveBeenCalled();
  });
});

function redemptionRequest(invitationToken: string): Request {
  const data = new FormData();
  data.set("invitationToken", invitationToken);
  data.set("email", "recipient@example.com");
  return new Request("https://example.test/auth/invitation/redeem", {
    body: data,
    method: "POST",
  });
}
