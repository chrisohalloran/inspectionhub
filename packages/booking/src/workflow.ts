import {
  SignedAgreementSnapshotSchema,
  verifySignedAgreementSnapshot,
  type SignedAgreementSnapshot,
} from "@inspection/agreements";
import { deepFreeze, sha256 } from "@inspection/domain";

import { BookingConflictError } from "./errors.js";
import { inspectCommand, type CommandMetadata } from "./idempotency.js";
import {
  BookingInputSnapshotSchema,
  BookingStateSchema,
  QuoteSnapshotSchema,
  SlotHoldSnapshotSchema,
  type BookingState,
  type ReadinessProjection,
  type SlotHoldSnapshot,
} from "./schemas.js";

export type SideEffectObservation =
  | Readonly<{
      state: "accepted";
      providerReference: string;
      value: unknown;
      replayed: boolean;
    }>
  | Readonly<{
      state: "failed";
      code: string;
      retryable: boolean;
    }>
  | Readonly<{
      state: "unknown";
      reconciliationKey: string;
    }>;

type TransitionResult = Readonly<{
  state: BookingState;
  replayed: boolean;
}>;

export function createBooking(
  input: Readonly<{
    bookingId: string;
    organizationId: string;
    quote: unknown;
    property: unknown;
    participants: unknown;
    slotHold: SlotHoldSnapshot;
    capturedAt: string;
  }>,
): BookingState {
  const quote = QuoteSnapshotSchema.parse(input.quote);
  const slotHold = SlotHoldSnapshotSchema.parse(input.slotHold);
  if (Date.parse(quote.expiresAt) <= Date.parse(input.capturedAt)) {
    throw new BookingConflictError("quote_expired", "The quote has expired");
  }
  if (Date.parse(slotHold.expiresAt) <= Date.parse(input.capturedAt)) {
    throw new BookingConflictError(
      "hold_expired",
      "The initial slot hold has expired",
    );
  }
  if (Date.parse(slotHold.endsAt) <= Date.parse(slotHold.startsAt)) {
    throw new BookingConflictError(
      "invalid_slot",
      "The slot must end after it starts",
    );
  }
  const bookingInput = BookingInputSnapshotSchema.parse({
    quote,
    property: input.property,
    participants: input.participants,
    capturedAt: input.capturedAt,
  });
  if (
    bookingInput.property.suburb !== quote.property.suburb ||
    bookingInput.property.postcode !== quote.property.postcode
  ) {
    throw new BookingConflictError(
      "quote_property_mismatch",
      "The booking property must match the quoted suburb and postcode",
    );
  }
  return freezeBooking({
    bookingId: input.bookingId,
    organizationId: input.organizationId,
    revision: 0,
    lifecycle: "draft",
    input: bookingInput,
    quote,
    slot: {
      state: "held",
      ...slotHold,
      confirmedAt: null,
    },
    slotHistory: [],
    agreement: { state: "unsigned", snapshot: null },
    payment: {
      state: "not_started",
      attempt: 0,
      intentId: null,
      providerReference: null,
      failureCode: null,
      terminal: false,
    },
    calendar: {
      state: "not_requested",
      eventReference: null,
      failureCode: null,
      retryable: false,
    },
    access: {
      state: "not_requested",
      generation: 1,
      activeLinkId: null,
      activeTokenFingerprint: null,
      supersededLinkIds: [],
      confirmedAt: null,
      overrideReason: null,
    },
    notifications: { generation: 1, reminders: [] },
    readiness: emptyReadiness(),
    reschedule: null,
    cancellationReason: null,
    commandReceipts: [],
    providerCallbackReceipts: [],
  });
}

export function confirmBookingSlot(
  state: BookingState,
  command: CommandMetadata,
  confirmedAt: string,
): TransitionResult {
  return transition(
    state,
    command,
    "booking.slot.confirm",
    { confirmedAt },
    (current) => {
      if (current.slot.state !== "held") {
        throw new BookingConflictError(
          "slot_not_held",
          "Only a held slot can be confirmed",
        );
      }
      if (Date.parse(current.slot.expiresAt) <= Date.parse(confirmedAt)) {
        throw new BookingConflictError(
          "hold_expired",
          "The booking slot hold has expired",
        );
      }
      return {
        ...current,
        slot: { ...current.slot, state: "confirmed" as const, confirmedAt },
      };
    },
  );
}

export function applySignedAgreement(
  state: BookingState,
  command: CommandMetadata,
  snapshot: SignedAgreementSnapshot,
): TransitionResult {
  return transition(
    state,
    command,
    "booking.agreement.sign",
    snapshot,
    (current) => {
      const parsed = SignedAgreementSnapshotSchema.parse(snapshot);
      if (!verifySignedAgreementSnapshot(parsed)) {
        throw new BookingConflictError(
          "agreement_hash_mismatch",
          "The signed agreement snapshot failed integrity validation",
        );
      }
      if (
        parsed.bookingId !== current.bookingId ||
        parsed.organizationId !== current.organizationId
      ) {
        throw new BookingConflictError(
          "agreement_booking_mismatch",
          "The signed agreement belongs to another booking",
        );
      }
      if (
        parsed.signer.assignmentId !==
          current.input.participants.client.assignmentId ||
        parsed.signer.contactId !==
          current.input.participants.client.contact.contactId
      ) {
        throw new BookingConflictError(
          "agreement_signer_mismatch",
          "The booking client must sign the pre-inspection agreement",
        );
      }
      if (
        parsed.commissionedModules.join(",") !==
        current.quote.commissionedModules.join(",")
      ) {
        throw new BookingConflictError(
          "agreement_scope_mismatch",
          "The signed agreement must cover the exact commissioned modules",
        );
      }
      return {
        ...current,
        agreement: { state: "signed" as const, snapshot: parsed },
      };
    },
  );
}

export function beginPayment(
  state: BookingState,
  command: CommandMetadata,
  intentId: string,
): TransitionResult {
  return transition(
    state,
    command,
    "booking.payment.begin",
    { intentId },
    (current) => {
      if (
        !["not_started", "declined", "failed"].includes(current.payment.state)
      ) {
        throw new BookingConflictError(
          "payment_not_retryable",
          `Payment cannot begin from ${current.payment.state}`,
        );
      }
      return {
        ...current,
        payment: {
          state: "pending" as const,
          attempt: current.payment.attempt + 1,
          intentId,
          providerReference: null,
          failureCode: null,
          terminal: false,
        },
      };
    },
  );
}

export type PaymentCallback =
  | Readonly<{
      providerEventId: string;
      eventType: "checkout_succeeded";
      intentId: string;
      providerReference: string;
      observedAt: string;
    }>
  | Readonly<{
      providerEventId: string;
      eventType: "checkout_declined";
      intentId: string;
      providerReference: string;
      reasonCode: string;
      observedAt: string;
    }>
  | Readonly<{
      providerEventId: string;
      eventType: "refund_succeeded";
      providerReference: string;
      observedAt: string;
    }>
  | Readonly<{
      providerEventId: string;
      eventType: "refund_failed";
      providerReference: string;
      reasonCode: string;
      retryable: boolean;
      observedAt: string;
    }>;

export function applyPaymentCallback(
  state: BookingState,
  callback: PaymentCallback,
): TransitionResult {
  const current = BookingStateSchema.parse(state);
  const requestFingerprint = sha256(callback);
  const prior = current.providerCallbackReceipts.find(
    (receipt) => receipt.providerEventId === callback.providerEventId,
  );
  if (prior !== undefined) {
    if (prior.requestFingerprint !== requestFingerprint) {
      throw new BookingConflictError(
        "provider_event_reused",
        "A provider event id cannot be reused with a different payload",
      );
    }
    return { state, replayed: true };
  }
  let payment = current.payment;
  if (callback.eventType === "checkout_succeeded") {
    if (callback.intentId !== payment.intentId) {
      if (
        !["refund_pending", "refunded", "refund_failed"].includes(
          payment.state,
        ) &&
        current.lifecycle !== "cancel_pending" &&
        current.lifecycle !== "cancelled"
      ) {
        payment = {
          ...payment,
          state: "unknown",
          providerReference: callback.providerReference,
          failureCode: "checkout_intent_mismatch_reconciliation_required",
          terminal: false,
        };
      }
    } else if (
      !["refund_pending", "refunded", "refund_failed"].includes(
        payment.state,
      ) &&
      current.lifecycle !== "cancel_pending" &&
      current.lifecycle !== "cancelled"
    ) {
      payment = {
        ...payment,
        state: "paid",
        providerReference: callback.providerReference,
        failureCode: null,
        terminal: false,
      };
    }
  } else if (callback.eventType === "checkout_declined") {
    if (
      callback.intentId === payment.intentId &&
      !["paid", "refund_pending", "refunded", "refund_failed"].includes(
        payment.state,
      )
    ) {
      payment = {
        ...payment,
        state: "declined",
        providerReference: callback.providerReference,
        failureCode: callback.reasonCode,
        terminal: false,
      };
    }
  } else if (callback.eventType === "refund_succeeded") {
    payment = {
      ...payment,
      state: "refunded",
      providerReference: callback.providerReference,
      failureCode: null,
      terminal: true,
    };
  } else {
    payment = {
      ...payment,
      state: "refund_failed",
      providerReference: callback.providerReference,
      failureCode: callback.reasonCode,
      terminal: !callback.retryable,
    };
  }
  return {
    state: freezeBooking({
      ...current,
      revision: current.revision + 1,
      payment,
      providerCallbackReceipts: [
        ...current.providerCallbackReceipts,
        { providerEventId: callback.providerEventId, requestFingerprint },
      ],
    }),
    replayed: false,
  };
}

export function observeCalendarReservation(
  state: BookingState,
  command: CommandMetadata,
  observation: SideEffectObservation,
): TransitionResult {
  return transition(
    state,
    command,
    "booking.calendar.reserve.observe",
    observation,
    (current) => {
      if (observation.state === "accepted") {
        return {
          ...current,
          calendar: {
            state: "confirmed" as const,
            eventReference: observation.providerReference,
            failureCode: null,
            retryable: false,
          },
        };
      }
      if (observation.state === "failed") {
        return {
          ...current,
          calendar: {
            state: "reservation_failed" as const,
            eventReference: null,
            failureCode: observation.code,
            retryable: observation.retryable,
          },
        };
      }
      return {
        ...current,
        calendar: {
          state: "unknown" as const,
          eventReference: null,
          failureCode: observation.reconciliationKey,
          retryable: false,
        },
      };
    },
  );
}

export function issueAccessRequest(
  state: BookingState,
  command: CommandMetadata,
  linkId: string,
  tokenFingerprint: string,
): TransitionResult {
  return transition(
    state,
    command,
    "booking.access.issue",
    { linkId, tokenFingerprint },
    (current) => ({
      ...current,
      access: {
        ...current.access,
        state: "confirmation_pending" as const,
        activeLinkId: linkId,
        activeTokenFingerprint: tokenFingerprint,
        confirmedAt: null,
        overrideReason: null,
      },
    }),
  );
}

export function confirmAccess(
  state: BookingState,
  command: CommandMetadata,
  linkId: string,
  confirmedAt: string,
): TransitionResult {
  return transition(
    state,
    command,
    "booking.access.confirm",
    { linkId, confirmedAt },
    (current) => {
      if (current.access.supersededLinkIds.includes(linkId)) {
        throw new BookingConflictError(
          "stale_access_link",
          "This access confirmation link is stale",
        );
      }
      if (
        current.access.state !== "confirmation_pending" ||
        current.access.activeLinkId !== linkId
      ) {
        throw new BookingConflictError(
          "invalid_access_link",
          "This access confirmation link is not active",
        );
      }
      return {
        ...current,
        access: {
          ...current.access,
          state: "confirmed" as const,
          confirmedAt,
        },
      };
    },
  );
}

export function overrideAccess(
  state: BookingState,
  command: CommandMetadata,
  reason: string,
): TransitionResult {
  return transition(
    state,
    command,
    "booking.access.override",
    { reason },
    (current) => ({
      ...current,
      access: {
        ...current.access,
        state: "overridden" as const,
        overrideReason: reason,
        confirmedAt: null,
      },
    }),
  );
}

export function activateBooking(
  state: BookingState,
  command: CommandMetadata,
  activatedAt: string,
): TransitionResult {
  return transition(
    state,
    command,
    "booking.activate",
    { activatedAt },
    (current) => {
      const readiness = deriveReadiness(current);
      if (!readiness.ready) {
        throw new BookingConflictError(
          "booking_not_ready",
          "A booking cannot be confirmed until every readiness dependency is satisfied",
          { actions: readiness.actions },
        );
      }
      return { ...current, lifecycle: "confirmed" as const };
    },
  );
}

export function scheduleReminder(
  state: BookingState,
  command: CommandMetadata,
  reminder: Readonly<{
    reminderId: string;
    scheduledFor: string;
    channel: "email" | "sms";
  }>,
): TransitionResult {
  return transition(
    state,
    command,
    "booking.reminder.schedule",
    reminder,
    (current) => ({
      ...current,
      notifications: {
        ...current.notifications,
        reminders: [
          ...current.notifications.reminders,
          {
            ...reminder,
            generation: current.notifications.generation,
            state: "scheduled" as const,
          },
        ],
      },
    }),
  );
}

export function requestReschedule(
  state: BookingState,
  command: CommandMetadata,
  candidateSlot: SlotHoldSnapshot,
  requestedAt: string,
): TransitionResult {
  return transition(
    state,
    command,
    "booking.reschedule.request",
    { candidateSlot, requestedAt },
    (current) => {
      if (current.lifecycle !== "confirmed") {
        throw new BookingConflictError(
          "booking_not_reschedulable",
          `A ${current.lifecycle} booking cannot begin rescheduling`,
        );
      }
      const candidate = SlotHoldSnapshotSchema.parse(candidateSlot);
      if (Date.parse(candidate.expiresAt) <= Date.parse(requestedAt)) {
        throw new BookingConflictError(
          "hold_expired",
          "The candidate reschedule hold has expired",
        );
      }
      if (Date.parse(candidate.endsAt) <= Date.parse(candidate.startsAt)) {
        throw new BookingConflictError(
          "invalid_slot",
          "The candidate reschedule slot must end after it starts",
        );
      }
      if (candidate.slotId === current.slot.slotId) {
        throw new BookingConflictError(
          "same_slot",
          "A reschedule must select another slot",
        );
      }
      return {
        ...current,
        lifecycle: "reschedule_pending" as const,
        calendar: {
          ...current.calendar,
          state: "pending" as const,
          failureCode: null,
          retryable: false,
        },
        reschedule: {
          candidateSlot: candidate,
          previousCalendarEventReference: current.calendar.eventReference,
        },
      };
    },
  );
}

export function completeReschedule(
  state: BookingState,
  command: CommandMetadata,
  observation: SideEffectObservation,
  recordedAt: string,
): TransitionResult {
  return transition(
    state,
    command,
    "booking.reschedule.complete",
    { observation, recordedAt },
    (current) => {
      if (
        current.lifecycle !== "reschedule_pending" ||
        current.reschedule === null
      ) {
        throw new BookingConflictError(
          "reschedule_not_pending",
          "No booking reschedule is pending",
        );
      }
      if (observation.state === "failed") {
        return {
          ...current,
          calendar: {
            ...current.calendar,
            state: "reservation_failed" as const,
            failureCode: observation.code,
            retryable: observation.retryable,
          },
        };
      }
      if (observation.state === "unknown") {
        return {
          ...current,
          calendar: {
            ...current.calendar,
            state: "unknown" as const,
            failureCode: observation.reconciliationKey,
            retryable: false,
          },
        };
      }
      const oldLinkIds = current.access.activeLinkId
        ? [...current.access.supersededLinkIds, current.access.activeLinkId]
        : current.access.supersededLinkIds;
      return {
        ...current,
        lifecycle: "confirmed" as const,
        slotHistory: [
          ...current.slotHistory,
          {
            state: "superseded" as const,
            slotId: current.slot.slotId,
            holdId: current.slot.holdId,
            startsAt: current.slot.startsAt,
            endsAt: current.slot.endsAt,
            recordedAt,
          },
        ],
        slot: {
          state: "confirmed" as const,
          ...current.reschedule.candidateSlot,
          confirmedAt: recordedAt,
        },
        calendar: {
          state: "confirmed" as const,
          eventReference: observation.providerReference,
          failureCode: null,
          retryable: false,
        },
        access: {
          state: "not_requested" as const,
          generation: current.access.generation + 1,
          activeLinkId: null,
          activeTokenFingerprint: null,
          supersededLinkIds: oldLinkIds,
          confirmedAt: null,
          overrideReason: null,
        },
        notifications: invalidateReminders(current.notifications),
        reschedule: null,
      };
    },
  );
}

export function requestCancellation(
  state: BookingState,
  command: CommandMetadata,
  reason: string,
): TransitionResult {
  return transition(
    state,
    command,
    "booking.cancel.request",
    { reason },
    (current) => {
      if (!["confirmed", "reschedule_pending"].includes(current.lifecycle)) {
        throw new BookingConflictError(
          "booking_not_cancellable",
          `A ${current.lifecycle} booking cannot be cancelled`,
        );
      }
      return {
        ...current,
        lifecycle: "cancel_pending" as const,
        cancellationReason: reason,
        payment:
          current.payment.state === "paid"
            ? { ...current.payment, state: "refund_pending" as const }
            : current.payment,
        calendar:
          current.calendar.state === "confirmed"
            ? { ...current.calendar, state: "cancellation_pending" as const }
            : current.calendar,
      };
    },
  );
}

export function completeCancellation(
  state: BookingState,
  command: CommandMetadata,
  observations: Readonly<{
    calendar: SideEffectObservation;
    refund: SideEffectObservation;
  }>,
  recordedAt: string,
): TransitionResult {
  return transition(
    state,
    command,
    "booking.cancel.complete",
    { observations, recordedAt },
    (current) => {
      if (current.lifecycle !== "cancel_pending") {
        throw new BookingConflictError(
          "cancellation_not_pending",
          "No booking cancellation is pending",
        );
      }
      const calendar = cancellationCalendarProjection(
        current.calendar,
        observations.calendar,
      );
      const payment = cancellationPaymentProjection(
        current.payment,
        observations.refund,
      );
      const supersededLinkIds = current.access.activeLinkId
        ? [...current.access.supersededLinkIds, current.access.activeLinkId]
        : current.access.supersededLinkIds;
      return {
        ...current,
        lifecycle: "cancelled" as const,
        slotHistory: [
          ...current.slotHistory,
          {
            state: "cancelled" as const,
            slotId: current.slot.slotId,
            holdId: current.slot.holdId,
            startsAt: current.slot.startsAt,
            endsAt: current.slot.endsAt,
            recordedAt,
          },
        ],
        slot: { ...current.slot, state: "released" as const },
        calendar,
        payment,
        access: {
          ...current.access,
          state: "invalidated" as const,
          activeLinkId: null,
          activeTokenFingerprint: null,
          supersededLinkIds,
          confirmedAt: null,
          overrideReason: null,
        },
        notifications: invalidateReminders(current.notifications),
        reschedule: null,
      };
    },
  );
}

function transition(
  state: BookingState,
  command: CommandMetadata,
  operation: string,
  payload: unknown,
  mutate: (current: BookingState) => BookingState,
): TransitionResult {
  const current = BookingStateSchema.parse(state);
  const decision = inspectCommand(
    current.revision,
    current.commandReceipts,
    command,
    operation,
    payload,
  );
  if (decision.replayed) {
    return { state, replayed: true };
  }
  const mutated = mutate(current);
  return {
    state: freezeBooking({
      ...mutated,
      revision: current.revision + 1,
      commandReceipts: [...current.commandReceipts, decision.receipt],
    }),
    replayed: false,
  };
}

function freezeBooking(state: BookingState): BookingState {
  const withReadiness = { ...state, readiness: deriveReadiness(state) };
  return deepFreeze(BookingStateSchema.parse(withReadiness));
}

function deriveReadiness(state: BookingState): ReadinessProjection {
  const slotReady = state.slot.state === "confirmed";
  const agreementReady = state.agreement.state === "signed";
  const paymentReady = state.payment.state === "paid";
  const calendarReady = state.calendar.state === "confirmed";
  const accessReady = ["confirmed", "overridden"].includes(state.access.state);
  const actions: ReadinessProjection["actions"][number][] = [];
  if (!slotReady) {
    actions.push({
      dependency: "slot",
      responsibleRole: "client",
      action: "Confirm an available inspection slot",
    });
  }
  if (!agreementReady) {
    actions.push({
      dependency: "agreement",
      responsibleRole: "client",
      action: "Sign the pre-inspection agreement",
    });
  }
  if (!paymentReady) {
    actions.push({
      dependency: "payment",
      responsibleRole: state.payment.state === "declined" ? "client" : "system",
      action:
        state.payment.state === "declined"
          ? "Retry payment"
          : "Resolve payment processing",
    });
  }
  if (!calendarReady) {
    actions.push({
      dependency: "calendar",
      responsibleRole: "system",
      action: "Confirm the calendar reservation",
    });
  }
  if (!accessReady) {
    actions.push({
      dependency: "access",
      responsibleRole: "access_contact",
      action: "Confirm property access",
    });
  }
  return {
    ready:
      slotReady &&
      agreementReady &&
      paymentReady &&
      calendarReady &&
      accessReady,
    slot: slotReady ? "ready" : "action_required",
    agreement: agreementReady ? "ready" : "action_required",
    payment: paymentReady
      ? "ready"
      : ["failed", "unknown", "refund_failed"].includes(state.payment.state)
        ? "provider_recovery"
        : "action_required",
    calendar: calendarReady
      ? "ready"
      : ["reservation_failed", "cancellation_failed", "unknown"].includes(
            state.calendar.state,
          )
        ? "provider_recovery"
        : "action_required",
    access: accessReady ? "ready" : "action_required",
    actions,
  };
}

function emptyReadiness(): ReadinessProjection {
  return {
    ready: false,
    slot: "action_required",
    agreement: "action_required",
    payment: "action_required",
    calendar: "action_required",
    access: "action_required",
    actions: [],
  };
}

function invalidateReminders(
  notifications: BookingState["notifications"],
): BookingState["notifications"] {
  return {
    generation: notifications.generation + 1,
    reminders: notifications.reminders.map((reminder) =>
      reminder.state === "scheduled"
        ? { ...reminder, state: "invalidated" as const }
        : reminder,
    ),
  };
}

function cancellationCalendarProjection(
  current: BookingState["calendar"],
  observation: SideEffectObservation,
): BookingState["calendar"] {
  if (observation.state === "accepted") {
    return {
      state: "cancelled",
      eventReference: observation.providerReference,
      failureCode: null,
      retryable: false,
    };
  }
  if (observation.state === "failed") {
    return {
      ...current,
      state: "cancellation_failed",
      failureCode: observation.code,
      retryable: observation.retryable,
    };
  }
  return {
    ...current,
    state: "unknown",
    failureCode: observation.reconciliationKey,
    retryable: false,
  };
}

function cancellationPaymentProjection(
  current: BookingState["payment"],
  observation: SideEffectObservation,
): BookingState["payment"] {
  if (observation.state === "accepted") {
    return {
      ...current,
      state: "refunded",
      providerReference: observation.providerReference,
      failureCode: null,
      terminal: true,
    };
  }
  if (observation.state === "failed") {
    return {
      ...current,
      state: "refund_failed",
      failureCode: observation.code,
      terminal: !observation.retryable,
    };
  }
  return {
    ...current,
    state: "unknown",
    failureCode: observation.reconciliationKey,
    terminal: false,
  };
}
