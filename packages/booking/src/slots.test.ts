import { describe, expect, it } from "vitest";

import {
  BookingConflictError,
  confirmSlotHold,
  createSlotBook,
  holdSlot,
} from "./index.js";

const slotId = "31000000-0000-4000-8000-000000000001";
const firstBookingId = "31000000-0000-4000-8000-000000000002";
const secondBookingId = "31000000-0000-4000-8000-000000000003";

describe("slot holds and confirmation", () => {
  it("rejects overlapping definitions for one inspector but allows adjacent slots", () => {
    const inspectorId = "31000000-0000-4000-8000-000000000004";
    expect(() =>
      createSlotBook([
        {
          slotId,
          startsAt: "2026-07-15T09:00:00.000+10:00",
          endsAt: "2026-07-15T10:00:00.000+10:00",
          inspectorId,
        },
        {
          slotId: "31000000-0000-4000-8000-000000000007",
          startsAt: "2026-07-15T09:30:00.000+10:00",
          endsAt: "2026-07-15T10:30:00.000+10:00",
          inspectorId,
        },
      ]),
    ).toThrow(/overlapping/i);

    expect(
      createSlotBook([
        {
          slotId,
          startsAt: "2026-07-15T09:00:00.000+10:00",
          endsAt: "2026-07-15T10:00:00.000+10:00",
          inspectorId,
        },
        {
          slotId: "31000000-0000-4000-8000-000000000007",
          startsAt: "2026-07-15T10:00:00.000+10:00",
          endsAt: "2026-07-15T11:00:00.000+10:00",
          inspectorId,
        },
      ]).slots,
    ).toHaveLength(2);
  });

  it("allows only one client to hold and confirm a slot", () => {
    const empty = createSlotBook([
      {
        slotId,
        startsAt: "2026-07-15T09:00:00.000+10:00",
        endsAt: "2026-07-15T10:00:00.000+10:00",
        inspectorId: "31000000-0000-4000-8000-000000000004",
      },
    ]);
    const held = holdSlot(empty, {
      expectedRevision: 0,
      idempotencyKey: "hold:first",
      holdId: "31000000-0000-4000-8000-000000000005",
      bookingId: firstBookingId,
      slotId,
      now: "2026-07-14T09:00:00.000+10:00",
      expiresAt: "2026-07-14T09:10:00.000+10:00",
    });

    expect(() =>
      holdSlot(held.state, {
        expectedRevision: 1,
        idempotencyKey: "hold:second",
        holdId: "31000000-0000-4000-8000-000000000006",
        bookingId: secondBookingId,
        slotId,
        now: "2026-07-14T09:01:00.000+10:00",
        expiresAt: "2026-07-14T09:11:00.000+10:00",
      }),
    ).toThrowError(BookingConflictError);

    expect(() =>
      confirmSlotHold(held.state, {
        expectedRevision: 1,
        idempotencyKey: "confirm:wrong-client",
        bookingId: secondBookingId,
        holdId: "31000000-0000-4000-8000-000000000005",
        now: "2026-07-14T09:02:00.000+10:00",
      }),
    ).toThrow(/does not own/i);

    const confirmed = confirmSlotHold(held.state, {
      expectedRevision: 1,
      idempotencyKey: "confirm:first",
      bookingId: firstBookingId,
      holdId: "31000000-0000-4000-8000-000000000005",
      now: "2026-07-14T09:02:00.000+10:00",
    });
    const replayed = confirmSlotHold(confirmed.state, {
      expectedRevision: 1,
      idempotencyKey: "confirm:first",
      bookingId: firstBookingId,
      holdId: "31000000-0000-4000-8000-000000000005",
      now: "2026-07-14T09:02:00.000+10:00",
    });

    expect(confirmed.state.slots[0]?.state).toBe("confirmed");
    expect(replayed.replayed).toBe(true);
    expect(replayed.state.revision).toBe(2);
  });

  it("expires a hold before making the slot available again", () => {
    const initial = createSlotBook([
      {
        slotId,
        startsAt: "2026-07-15T09:00:00.000+10:00",
        endsAt: "2026-07-15T10:00:00.000+10:00",
        inspectorId: "31000000-0000-4000-8000-000000000004",
      },
    ]);
    const first = holdSlot(initial, {
      expectedRevision: 0,
      idempotencyKey: "hold:expiring",
      holdId: "31000000-0000-4000-8000-000000000005",
      bookingId: firstBookingId,
      slotId,
      now: "2026-07-14T09:00:00.000+10:00",
      expiresAt: "2026-07-14T09:05:00.000+10:00",
    });
    const second = holdSlot(first.state, {
      expectedRevision: 1,
      idempotencyKey: "hold:after-expiry",
      holdId: "31000000-0000-4000-8000-000000000006",
      bookingId: secondBookingId,
      slotId,
      now: "2026-07-14T09:06:00.000+10:00",
      expiresAt: "2026-07-14T09:16:00.000+10:00",
    });

    expect(second.state.slots[0]).toMatchObject({
      state: "held",
      hold: { bookingId: secondBookingId },
    });
  });
});
