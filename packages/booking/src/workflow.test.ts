import { describe, expect, it } from "vitest";

import { signAgreement } from "@inspection/agreements";

import {
  BookingConflictError,
  BookingStateSchema,
  activateBooking,
  applyPaymentCallback,
  applySignedAgreement,
  beginPayment,
  completeCancellation,
  completeReschedule,
  confirmAccess,
  confirmBookingSlot,
  createBooking,
  issueAccessRequest,
  observeCalendarReservation,
  requestCancellation,
  requestReschedule,
  scheduleReminder,
} from "./index.js";

const at = "2026-07-14T10:00:00.000+10:00";
const ids = {
  bookingId: "32000000-0000-4000-8000-000000000001",
  organizationId: "32000000-0000-4000-8000-000000000002",
  quoteId: "32000000-0000-4000-8000-000000000003",
  slotId: "32000000-0000-4000-8000-000000000004",
  holdId: "32000000-0000-4000-8000-000000000005",
  inspectorId: "32000000-0000-4000-8000-000000000006",
  clientContactId: "32000000-0000-4000-8000-000000000007",
  clientAssignmentId: "32000000-0000-4000-8000-000000000008",
  recipientContactId: "32000000-0000-4000-8000-000000000009",
  recipientAssignmentId: "32000000-0000-4000-8000-000000000010",
  invoiceContactId: "32000000-0000-4000-8000-000000000011",
  invoiceAssignmentId: "32000000-0000-4000-8000-000000000012",
  accessContactId: "32000000-0000-4000-8000-000000000013",
  accessAssignmentId: "32000000-0000-4000-8000-000000000014",
  propertyId: "32000000-0000-4000-8000-000000000015",
  templateId: "32000000-0000-4000-8000-000000000016",
  agreementId: "32000000-0000-4000-8000-000000000017",
};

function initialBooking() {
  return createBooking({
    bookingId: ids.bookingId,
    organizationId: ids.organizationId,
    quote: {
      quoteId: ids.quoteId,
      ruleSetId: "32000000-0000-4000-8000-000000000018",
      ruleVersion: 1,
      commissionedModules: ["building", "timber_pest"],
      property: {
        propertyType: "detached_house",
        storeys: 2,
        bedrooms: 4,
        suburb: "Southport",
        postcode: "4215",
      },
      currency: "AUD",
      lineItems: [
        {
          module: "building",
          label: "Building inspection",
          amountCents: 50_000,
        },
        {
          module: "timber_pest",
          label: "Timber pest inspection",
          amountCents: 30_000,
        },
      ],
      totalAmountCents: 80_000,
      createdAt: at,
      expiresAt: "2026-07-14T11:00:00.000+10:00",
    },
    property: {
      propertyId: ids.propertyId,
      addressLine1: "10 Example Street",
      suburb: "Southport",
      state: "QLD",
      postcode: "4215",
      accessNotes: "Agent holds the keys.",
    },
    participants: {
      client: assignment(
        ids.clientAssignmentId,
        ids.clientContactId,
        "Casey Client",
        "casey@example.test",
      ),
      reportRecipient: assignment(
        ids.recipientAssignmentId,
        ids.recipientContactId,
        "Riley Recipient",
        "riley@example.test",
      ),
      invoiceContact: assignment(
        ids.invoiceAssignmentId,
        ids.invoiceContactId,
        "Indigo Invoice",
        "indigo@example.test",
      ),
      accessContact: assignment(
        ids.accessAssignmentId,
        ids.accessContactId,
        "Alex Access",
        "alex@example.test",
      ),
      assignedInspector: {
        inspectorId: ids.inspectorId,
        displayName: "Taylor Inspector",
        credentialVersion: "qld-completed-residential-v1",
      },
    },
    slotHold: {
      slotId: ids.slotId,
      holdId: ids.holdId,
      startsAt: "2026-07-15T09:00:00.000+10:00",
      endsAt: "2026-07-15T10:00:00.000+10:00",
      expiresAt: "2026-07-14T10:10:00.000+10:00",
    },
    capturedAt: at,
  });
}

function assignment(
  assignmentId: string,
  contactId: string,
  name: string,
  email: string,
) {
  return {
    assignmentId,
    contact: { contactId, name, email, phone: "+61400000000" },
  };
}

function signedAgreement() {
  return signAgreement({
    agreementId: ids.agreementId,
    bookingId: ids.bookingId,
    organizationId: ids.organizationId,
    template: {
      templateId: ids.templateId,
      version: 1,
      status: "published",
      publishedAt: at,
      title: "Pre-inspection agreement",
      introductoryText: "Review the scope.",
      building: {
        heading: "Building scope",
        body: "Visual building inspection.",
      },
      timberPest: {
        heading: "Timber pest scope",
        body: "Visual timber pest inspection.",
      },
      acknowledgementText: "I agree.",
    },
    commissionedModules: ["building", "timber_pest"],
    signer: {
      assignmentId: ids.clientAssignmentId,
      contactId: ids.clientContactId,
      name: "Casey Client",
      email: "casey@example.test",
    },
    typedName: "Casey Client",
    acknowledgementAccepted: true,
    signedAt: at,
  });
}

function bookingAwaitingOnlyAgreementAndAccess() {
  let state = initialBooking();
  state = confirmBookingSlot(
    state,
    command("slot-confirm", state.revision),
    at,
  ).state;
  state = beginPayment(
    state,
    command("checkout", state.revision),
    "checkout-intent-1",
  ).state;
  state = applyPaymentCallback(state, {
    providerEventId: "evt-paid-1",
    eventType: "checkout_succeeded",
    intentId: "checkout-intent-1",
    providerReference: "pi_1",
    observedAt: at,
  }).state;
  state = observeCalendarReservation(
    state,
    command("calendar-reserved", state.revision),
    {
      state: "accepted",
      providerReference: "event-1",
      replayed: false,
      value: null,
    },
  ).state;
  return issueAccessRequest(
    state,
    command("access-request", state.revision),
    "32000000-0000-4000-8000-000000000019",
    "a".repeat(64),
  ).state;
}

function readyBooking() {
  let state = bookingAwaitingOnlyAgreementAndAccess();
  state = applySignedAgreement(
    state,
    command("agreement", state.revision),
    signedAgreement(),
  ).state;
  state = confirmAccess(
    state,
    command("access-confirm", state.revision),
    "32000000-0000-4000-8000-000000000019",
    at,
  ).state;
  return activateBooking(state, command("activate", state.revision), at).state;
}

function command(idempotencyKey: string, expectedRevision: number) {
  return { idempotencyKey, expectedRevision };
}

describe("booking workflow and literal readiness", () => {
  it("keeps participant roles separate and exposes only responsible actions", () => {
    const state = bookingAwaitingOnlyAgreementAndAccess();

    expect(
      new Set([
        state.input.participants.client.assignmentId,
        state.input.participants.reportRecipient.assignmentId,
        state.input.participants.invoiceContact.assignmentId,
        state.input.participants.accessContact.assignmentId,
      ]).size,
    ).toBe(4);
    expect(state.readiness.ready).toBe(false);
    expect(state.readiness.actions).toEqual([
      {
        dependency: "agreement",
        responsibleRole: "client",
        action: "Sign the pre-inspection agreement",
      },
      {
        dependency: "access",
        responsibleRole: "access_contact",
        action: "Confirm property access",
      },
    ]);
  });

  it("rejects state whose quote projection drifts from the preserved input quote", () => {
    const state = initialBooking();
    const drifted = {
      ...state,
      quote: {
        ...state.quote,
        lineItems: state.quote.lineItems.map((lineItem, index) =>
          index === 0
            ? { ...lineItem, amountCents: lineItem.amountCents + 1 }
            : lineItem,
        ),
        totalAmountCents: state.quote.totalAmountCents + 1,
      },
    };

    expect(() => BookingStateSchema.parse(drifted)).toThrow(
      /preserved input quote snapshot/i,
    );
  });

  it("preserves all captured input after payment decline and supports a new attempt", () => {
    let state = initialBooking();
    const originalInput = state.input;
    state = confirmBookingSlot(
      state,
      command("slot-confirm", state.revision),
      at,
    ).state;
    state = beginPayment(
      state,
      command("checkout-1", state.revision),
      "checkout-intent-1",
    ).state;
    state = applyPaymentCallback(state, {
      providerEventId: "evt-declined-1",
      eventType: "checkout_declined",
      intentId: "checkout-intent-1",
      providerReference: "checkout-1",
      reasonCode: "card_declined",
      observedAt: at,
    }).state;

    expect(state.payment.state).toBe("declined");
    expect(state.input).toEqual(originalInput);
    const retried = beginPayment(
      state,
      command("checkout-2", state.revision),
      "checkout-intent-2",
    ).state;
    expect(retried.payment).toMatchObject({ state: "pending", attempt: 2 });
    expect(retried.input).toEqual(originalInput);
  });

  it("deduplicates payment callbacks and refuses payload changes for a provider event id", () => {
    let state = initialBooking();
    state = beginPayment(
      state,
      command("checkout", state.revision),
      "checkout-intent-1",
    ).state;
    const callback = {
      providerEventId: "evt-paid-1",
      eventType: "checkout_succeeded" as const,
      intentId: "checkout-intent-1",
      providerReference: "pi-1",
      observedAt: at,
    };
    const paid = applyPaymentCallback(state, callback);
    const replayed = applyPaymentCallback(paid.state, callback);

    expect(replayed.replayed).toBe(true);
    expect(replayed.state.revision).toBe(paid.state.revision);
    expect(() =>
      applyPaymentCallback(paid.state, {
        ...callback,
        providerReference: "pi-tampered",
      }),
    ).toThrow(/payload/i);
  });

  it("does not let an old checkout success mark a newer payment attempt paid", () => {
    let state = initialBooking();
    const originalInput = state.input;
    state = beginPayment(
      state,
      command("checkout-old", state.revision),
      "checkout-intent-old",
    ).state;
    state = applyPaymentCallback(state, {
      providerEventId: "evt-old-declined",
      eventType: "checkout_declined",
      intentId: "checkout-intent-old",
      providerReference: "checkout-old",
      reasonCode: "card_declined",
      observedAt: at,
    }).state;
    state = beginPayment(
      state,
      command("checkout-new", state.revision),
      "checkout-intent-new",
    ).state;
    state = applyPaymentCallback(state, {
      providerEventId: "evt-old-late-success",
      eventType: "checkout_succeeded",
      intentId: "checkout-intent-old",
      providerReference: "pi-old",
      observedAt: at,
    }).state;

    expect(state.payment).toMatchObject({
      state: "unknown",
      intentId: "checkout-intent-new",
      failureCode: "checkout_intent_mismatch_reconciliation_required",
    });
    expect(state.input).toEqual(originalInput);

    state = applyPaymentCallback(state, {
      providerEventId: "evt-new-success",
      eventType: "checkout_succeeded",
      intentId: "checkout-intent-new",
      providerReference: "pi-new",
      observedAt: at,
    }).state;
    expect(state.payment.state).toBe("paid");
  });

  it("resolves concurrent reschedules once and invalidates stale access and reminders", () => {
    let state = readyBooking();
    state = scheduleReminder(state, command("reminder-v1", state.revision), {
      reminderId: "32000000-0000-4000-8000-000000000020",
      scheduledFor: "2026-07-15T07:00:00.000+10:00",
      channel: "email",
    }).state;
    const baseRevision = state.revision;
    const firstRequest = requestReschedule(
      state,
      command("reschedule-1", baseRevision),
      {
        slotId: "32000000-0000-4000-8000-000000000021",
        holdId: "32000000-0000-4000-8000-000000000022",
        startsAt: "2026-07-16T10:00:00.000+10:00",
        endsAt: "2026-07-16T11:00:00.000+10:00",
        expiresAt: "2026-07-14T10:20:00.000+10:00",
      },
      at,
    );

    expect(() =>
      requestReschedule(
        firstRequest.state,
        command("reschedule-2", baseRevision),
        {
          slotId: "32000000-0000-4000-8000-000000000023",
          holdId: "32000000-0000-4000-8000-000000000024",
          startsAt: "2026-07-17T10:00:00.000+10:00",
          endsAt: "2026-07-17T11:00:00.000+10:00",
          expiresAt: "2026-07-14T10:20:00.000+10:00",
        },
        at,
      ),
    ).toThrowError(BookingConflictError);

    const replay = requestReschedule(
      firstRequest.state,
      command("reschedule-1", baseRevision),
      {
        slotId: "32000000-0000-4000-8000-000000000021",
        holdId: "32000000-0000-4000-8000-000000000022",
        startsAt: "2026-07-16T10:00:00.000+10:00",
        endsAt: "2026-07-16T11:00:00.000+10:00",
        expiresAt: "2026-07-14T10:20:00.000+10:00",
      },
      at,
    );
    expect(replay.replayed).toBe(true);

    const completed = completeReschedule(
      firstRequest.state,
      command("reschedule-calendar-1", firstRequest.state.revision),
      {
        state: "accepted",
        providerReference: "event-2",
        replayed: false,
        value: null,
      },
      at,
    ).state;

    expect(completed.lifecycle).toBe("confirmed");
    expect(completed.slot).toMatchObject({
      state: "confirmed",
      slotId: "32000000-0000-4000-8000-000000000021",
    });
    expect(completed.slotHistory.at(-1)?.state).toBe("superseded");
    expect(completed.access.state).toBe("not_requested");
    expect(completed.access.supersededLinkIds).toContain(
      "32000000-0000-4000-8000-000000000019",
    );
    expect(completed.notifications.reminders[0]?.state).toBe("invalidated");
    expect(completed.payment.state).toBe("paid");

    expect(() =>
      confirmAccess(
        completed,
        command("stale-access", completed.revision),
        "32000000-0000-4000-8000-000000000019",
        at,
      ),
    ).toThrow(/stale/i);
  });

  it("rejects an expired candidate hold when rescheduling is requested", () => {
    const state = readyBooking();

    expect(() =>
      requestReschedule(
        state,
        command("reschedule-expired", state.revision),
        {
          slotId: "32000000-0000-4000-8000-000000000021",
          holdId: "32000000-0000-4000-8000-000000000022",
          startsAt: "2026-07-16T10:00:00.000+10:00",
          endsAt: "2026-07-16T11:00:00.000+10:00",
          expiresAt: at,
        },
        at,
      ),
    ).toThrow(/hold has expired/i);
  });

  it("commits cancellation while exposing calendar and terminal refund failures", () => {
    let state = readyBooking();
    state = scheduleReminder(state, command("reminder-v1", state.revision), {
      reminderId: "32000000-0000-4000-8000-000000000020",
      scheduledFor: "2026-07-15T07:00:00.000+10:00",
      channel: "email",
    }).state;
    const cancellationCommand = command("cancel", state.revision);
    const cancellation = requestCancellation(
      state,
      cancellationCommand,
      "Client requested cancellation",
    );
    const cancellationReplay = requestCancellation(
      cancellation.state,
      cancellationCommand,
      "Client requested cancellation",
    );
    expect(cancellationReplay.replayed).toBe(true);

    const completionCommand = command(
      "cancel-provider-results",
      cancellation.state.revision,
    );
    const observations = {
      calendar: {
        state: "failed" as const,
        code: "calendar_unavailable",
        retryable: true,
      },
      refund: {
        state: "failed" as const,
        code: "refund_rejected",
        retryable: false,
      },
    };
    const completion = completeCancellation(
      cancellation.state,
      completionCommand,
      observations,
      at,
    );
    const completionReplay = completeCancellation(
      completion.state,
      completionCommand,
      observations,
      at,
    );
    expect(completionReplay.replayed).toBe(true);
    state = completion.state;

    expect(state.lifecycle).toBe("cancelled");
    expect(state.calendar.state).toBe("cancellation_failed");
    expect(state.payment.state).toBe("refund_failed");
    expect(state.payment.terminal).toBe(true);
    expect(state.notifications.reminders[0]?.state).toBe("invalidated");
    expect(state.access.state).toBe("invalidated");

    const latePaid = applyPaymentCallback(state, {
      providerEventId: "evt-late-paid",
      eventType: "checkout_succeeded",
      intentId: "checkout-intent-1",
      providerReference: "pi-1",
      observedAt: at,
    }).state;
    expect(latePaid.payment.state).toBe("refund_failed");
  });

  it("deduplicates refund callbacks and ignores a later checkout replay", () => {
    let state = readyBooking();
    state = requestCancellation(
      state,
      command("cancel-refund", state.revision),
      "Client requested cancellation",
    ).state;
    const refundCallback = {
      providerEventId: "evt-refund-success",
      eventType: "refund_succeeded" as const,
      providerReference: "refund-1",
      observedAt: at,
    };
    const refunded = applyPaymentCallback(state, refundCallback);
    const replayed = applyPaymentCallback(refunded.state, refundCallback);

    expect(replayed.replayed).toBe(true);
    expect(replayed.state.payment.state).toBe("refunded");

    const lateCheckoutReplay = applyPaymentCallback(refunded.state, {
      providerEventId: "evt-checkout-replayed-after-refund",
      eventType: "checkout_succeeded",
      intentId: "checkout-intent-1",
      providerReference: "pi_1",
      observedAt: at,
    });
    expect(lateCheckoutReplay.state.payment.state).toBe("refunded");
  });
});
