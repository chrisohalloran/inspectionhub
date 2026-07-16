import { describe, expect, it } from "vitest";

import { DeterministicObservedProvider } from "./index.js";

describe("DeterministicObservedProvider", () => {
  it("replays one observed effect and rejects key reuse with another fingerprint", async () => {
    const provider = new DeterministicObservedProvider({
      handler: (payload: { amountCents: number }) => ({
        chargedAmountCents: payload.amountCents,
      }),
    });
    const request = {
      operation: "payment.checkout" as const,
      idempotencyKey: "checkout-1",
      requestFingerprint: "fingerprint-1",
      payload: { amountCents: 80_000 },
    };

    const first = await provider.execute(request);
    const replay = await provider.execute(request);
    expect(first).toMatchObject({ state: "accepted", replayed: false });
    expect(replay).toMatchObject({ state: "accepted", replayed: true });
    await expect(
      provider.execute({ ...request, requestFingerprint: "fingerprint-2" }),
    ).rejects.toThrow(/fingerprint/i);
  });

  it("makes unknown outcomes literal until reconciliation", async () => {
    const provider = new DeterministicObservedProvider({
      mode: "unknown",
      handler: (payload: string) => payload,
    });
    const request = {
      operation: "calendar.reserve" as const,
      idempotencyKey: "calendar-1",
      requestFingerprint: "fingerprint-calendar-1",
      payload: "slot-1",
    };

    await expect(provider.execute(request)).resolves.toMatchObject({
      state: "unknown",
      replayed: false,
    });
    provider.reconcile("calendar-1", {
      state: "accepted",
      providerReference: "calendar-event-1",
      value: "slot-1",
      replayed: false,
    });
    await expect(provider.execute(request)).resolves.toMatchObject({
      state: "accepted",
      replayed: true,
    });
  });
});
