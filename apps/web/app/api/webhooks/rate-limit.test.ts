import { describe, expect, it, vi } from "vitest";

import { createSupabaseBoundaryRateLimit } from "./rate-limit";

describe("durable webhook rate-limit adapter", () => {
  it("sends only a keyed digest and fixed policy to the database command", async () => {
    const fetcher = vi.fn((input: string, init: RequestInit) => {
      void input;
      void init;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            { allowed: true, remaining: 29, retry_after_seconds: 0 },
          ]),
      });
    });
    const consume = createSupabaseBoundaryRateLimit({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "synthetic-service-credential",
      hashSecret: "rate-limit-hash-secret-with-at-least-32-characters",
      fetcher,
    });

    await expect(
      consume("recipient_access", "access-webhook"),
    ).resolves.toEqual({
      allowed: true,
      remaining: 29,
      retryAfterSeconds: 0,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://project.supabase.co/rest/v1/rpc/command_consume_rate_limit",
    );
    const body = init?.body;
    expect(typeof body).toBe("string");
    if (typeof body !== "string") throw new Error("Expected JSON request body");
    expect(body).not.toContain("access-webhook");
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Expected JSON request record");
    }
    const record = parsed as Record<string, unknown>;
    expect(record.target_policy_name).toBe("recipient_access");
    expect(record.target_opaque_key_sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("fails closed when the shared store is unavailable", async () => {
    const consume = createSupabaseBoundaryRateLimit({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "synthetic-service-credential",
      hashSecret: "rate-limit-hash-secret-with-at-least-32-characters",
      fetcher: () =>
        Promise.resolve({ ok: false, json: () => Promise.resolve(null) }),
    });

    await expect(
      consume("provider_callback", "booking-webhook"),
    ).rejects.toThrow("unavailable");
  });
});
