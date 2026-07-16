import { describe, expect, it } from "vitest";

import { DeterministicFakeProvider } from "./fake-provider.js";

describe("DeterministicFakeProvider", () => {
  it("returns one observed result when the same intent is replayed", async () => {
    const provider = new DeterministicFakeProvider({
      handler: (value: number) => value * 2,
    });
    const request = { idempotencyKey: "intent-1", payload: 7 };

    await expect(provider.execute(request)).resolves.toMatchObject({
      state: "accepted",
      value: 14,
      replayed: false,
    });
    provider.setMode("replay");
    await expect(provider.execute(request)).resolves.toMatchObject({
      state: "accepted",
      value: 14,
      replayed: true,
    });
  });

  it("simulates recoverable failure without recording success", async () => {
    const provider = new DeterministicFakeProvider({
      mode: "failure",
      handler: (value: string) => value,
    });

    await expect(
      provider.execute({ idempotencyKey: "intent-2", payload: "payload" }),
    ).resolves.toEqual({
      state: "failed",
      code: "fake_provider_failure",
      retryable: true,
    });
  });
});
