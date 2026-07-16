import { describe, expect, it, vi } from "vitest";

import { createOtpVerificationHandler } from "./route";

describe("recipient OTP verification rate limit", () => {
  it("consumes the fixed recipient bucket before pending state or OTP verification", async () => {
    const readPendingSession = vi.fn(() => Promise.resolve("pending-token"));
    const completeOtp = vi.fn(() => Promise.resolve("session-token"));
    const consumeRateLimit = vi.fn(() =>
      Promise.resolve({ allowed: true, remaining: 29, retryAfterSeconds: 0 }),
    );
    const post = createOtpVerificationHandler({
      completeOtp,
      consumeRateLimit,
      readPendingSession,
    });

    const response = await post(otpRequest("482913"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/reports/demo");
    expect(consumeRateLimit).toHaveBeenCalledWith(
      "recipient_access",
      "recipient-otp-verify",
    );
    expect(readPendingSession).toHaveBeenCalledOnce();
    expect(completeOtp).toHaveBeenCalledWith("pending-token", "482913");
    expect(consumeRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      readPendingSession.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("rejects a durable limit breach without reading pending state or issuing a grant", async () => {
    const readPendingSession = vi.fn(() => Promise.resolve("pending-token"));
    const completeOtp = vi.fn(() => Promise.resolve("session-token"));
    const post = createOtpVerificationHandler({
      completeOtp,
      consumeRateLimit: () =>
        Promise.resolve({
          allowed: false,
          remaining: 0,
          retryAfterSeconds: 31,
        }),
      readPendingSession,
    });

    const response = await post(otpRequest("482913"));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("31");
    await expect(response.json()).resolves.toEqual({ error: "rate_limited" });
    expect(readPendingSession).not.toHaveBeenCalled();
    expect(completeOtp).not.toHaveBeenCalled();
  });

  it("fails closed before OTP state when the durable limiter is unavailable", async () => {
    const readPendingSession = vi.fn(() => Promise.resolve("pending-token"));
    const completeOtp = vi.fn(() => Promise.resolve("session-token"));
    const post = createOtpVerificationHandler({
      completeOtp,
      consumeRateLimit: () => Promise.reject(new Error("unavailable")),
      readPendingSession,
    });

    const response = await post(otpRequest("482913"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "security_boundary_unavailable",
    });
    expect(readPendingSession).not.toHaveBeenCalled();
    expect(completeOtp).not.toHaveBeenCalled();
  });
});

function otpRequest(otp: string): Request {
  const data = new FormData();
  data.set("otp", otp);
  return new Request("https://example.test/auth/verify/complete", {
    body: data,
    method: "POST",
  });
}
