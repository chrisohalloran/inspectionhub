import { describe, expect, it } from "vitest";

import { GoogleCalendarTestAdapter } from "./google-calendar/calendar-adapter.js";
import { createProviderRuntime } from "./runtime.js";
import { StripeTestAdapter } from "./stripe/stripe-adapter.js";

describe("Build Week provider adapters", () => {
  it("makes checkout replay literal and rejects key reuse with changed input", async () => {
    const adapter = new StripeTestAdapter();
    const request = {
      amountCents: 71_500,
      bookingId: "SI-1042",
      currency: "AUD" as const,
      idempotencyKey: "checkout-SI-1042-v1",
      returnUrl: "https://inspectionhub.test/booking/complete",
    };
    expect(await adapter.checkout(request)).toMatchObject({
      state: "accepted",
      replayed: false,
    });
    expect(await adapter.checkout(request)).toMatchObject({
      state: "accepted",
      replayed: true,
    });
    await expect(
      adapter.checkout({ ...request, amountCents: 71_501 }),
    ).rejects.toThrow(/fingerprint/i);
  });

  it("rejects a conflicting calendar reservation before side effects", async () => {
    const adapter = new GoogleCalendarTestAdapter({
      busy: [
        {
          inspectorId: "INS-001",
          startsAt: "2026-07-15T09:00:00+10:00",
          endsAt: "2026-07-15T10:00:00+10:00",
        },
      ],
    });
    await expect(
      adapter.reserve({
        bookingId: "SI-1042",
        idempotencyKey: "reserve-SI-1042-v1",
        inspectorId: "INS-001",
        startsAt: "2026-07-15T09:30:00+10:00",
        endsAt: "2026-07-15T10:30:00+10:00",
      }),
    ).resolves.toMatchObject({
      state: "failed",
      code: "calendar_conflict",
      replayed: false,
    });
  });

  it("fails closed when live providers are requested before activation", () => {
    expect(() => createProviderRuntime("live")).toThrow(/egress guard/);
    expect(() =>
      createProviderRuntime("live", {
        egressGuard: {
          async requireEgress(): Promise<void> {
            await Promise.resolve();
          },
        },
      }),
    ).toThrow(/Revenue Activation/);
    const runtime = createProviderRuntime("fake");
    expect(runtime.calendar).toBeInstanceOf(GoogleCalendarTestAdapter);
    expect(runtime.payments).toBeInstanceOf(StripeTestAdapter);
  });
});
