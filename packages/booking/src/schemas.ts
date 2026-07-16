import { SignedAgreementSnapshotSchema } from "@inspection/agreements";
import {
  CommissionedModulesSchema,
  IdSchema,
  Sha256Schema,
  TimestampSchema,
} from "@inspection/contracts";
import { sha256 } from "@inspection/domain";
import { z } from "zod";

export const PropertyQuoteInputSchema = z.strictObject({
  propertyType: z.enum(["detached_house", "duplex", "townhouse", "unit"]),
  storeys: z.int().min(1).max(4),
  bedrooms: z.int().min(0).max(20),
  suburb: z.string().trim().min(1).max(120),
  postcode: z.string().regex(/^\d{4}$/u),
});
export type PropertyQuoteInput = z.infer<typeof PropertyQuoteInputSchema>;

export const ModulePriceRuleSchema = z.strictObject({
  label: z.string().trim().min(1).max(200),
  baseAmountCents: z.int().nonnegative(),
  additionalStoreyAmountCents: z.int().nonnegative(),
  additionalBedroomOverFourAmountCents: z.int().nonnegative(),
});

export const QuoteRuleVersionSchema = z.strictObject({
  ruleSetId: IdSchema,
  version: z.int().positive(),
  status: z.enum(["draft", "published", "retired"]),
  currency: z.literal("AUD"),
  publishedAt: TimestampSchema.nullable(),
  building: ModulePriceRuleSchema,
  timberPest: ModulePriceRuleSchema,
});
export type QuoteRuleVersion = z.infer<typeof QuoteRuleVersionSchema>;

export const QuoteLineItemSchema = z.strictObject({
  module: z.enum(["building", "timber_pest"]),
  label: z.string().trim().min(1).max(200),
  amountCents: z.int().nonnegative(),
});

export const QuoteSnapshotSchema = z
  .strictObject({
    quoteId: IdSchema,
    ruleSetId: IdSchema,
    ruleVersion: z.int().positive(),
    commissionedModules: CommissionedModulesSchema,
    property: PropertyQuoteInputSchema,
    currency: z.literal("AUD"),
    lineItems: z.array(QuoteLineItemSchema).min(1).max(2),
    totalAmountCents: z.int().nonnegative(),
    createdAt: TimestampSchema,
    expiresAt: TimestampSchema,
  })
  .superRefine((quote, context) => {
    const lineItemModules = quote.lineItems.map((lineItem) => lineItem.module);
    if (lineItemModules.join(",") !== quote.commissionedModules.join(",")) {
      context.addIssue({
        code: "custom",
        path: ["lineItems"],
        message: "Quote line items must exactly match commissioned modules",
      });
    }
    const lineItemTotal = quote.lineItems.reduce(
      (total, lineItem) => total + lineItem.amountCents,
      0,
    );
    if (lineItemTotal !== quote.totalAmountCents) {
      context.addIssue({
        code: "custom",
        path: ["totalAmountCents"],
        message: "Quote total must equal the sum of its module line items",
      });
    }
  });
export type QuoteSnapshot = z.infer<typeof QuoteSnapshotSchema>;

export const ContactSnapshotSchema = z.strictObject({
  contactId: IdSchema,
  name: z.string().trim().min(1).max(200),
  email: z.email(),
  phone: z.string().trim().min(7).max(30),
});

export const ContactRoleAssignmentSchema = z.strictObject({
  assignmentId: IdSchema,
  contact: ContactSnapshotSchema,
});

export const AssignedInspectorSchema = z.strictObject({
  inspectorId: IdSchema,
  displayName: z.string().trim().min(1).max(200),
  credentialVersion: z.string().trim().min(1).max(200),
});

export const BookingParticipantsSchema = z
  .strictObject({
    client: ContactRoleAssignmentSchema,
    reportRecipient: ContactRoleAssignmentSchema,
    invoiceContact: ContactRoleAssignmentSchema,
    accessContact: ContactRoleAssignmentSchema,
    assignedInspector: AssignedInspectorSchema,
  })
  .superRefine((participants, context) => {
    const assignmentIds = [
      participants.client.assignmentId,
      participants.reportRecipient.assignmentId,
      participants.invoiceContact.assignmentId,
      participants.accessContact.assignmentId,
    ];
    if (new Set(assignmentIds).size !== assignmentIds.length) {
      context.addIssue({
        code: "custom",
        message: "Every participant role requires its own assignment record",
      });
    }
  });
export type BookingParticipants = z.infer<typeof BookingParticipantsSchema>;

export const PropertySnapshotSchema = z.strictObject({
  propertyId: IdSchema,
  addressLine1: z.string().trim().min(1).max(300),
  suburb: z.string().trim().min(1).max(120),
  state: z.literal("QLD"),
  postcode: z.string().regex(/^\d{4}$/u),
  accessNotes: z.string().trim().max(4_000),
});

export const BookingInputSnapshotSchema = z.strictObject({
  quote: QuoteSnapshotSchema,
  property: PropertySnapshotSchema,
  participants: BookingParticipantsSchema,
  capturedAt: TimestampSchema,
});
export type BookingInputSnapshot = z.infer<typeof BookingInputSnapshotSchema>;

export const SlotHoldSnapshotSchema = z.strictObject({
  slotId: IdSchema,
  holdId: IdSchema,
  startsAt: TimestampSchema,
  endsAt: TimestampSchema,
  expiresAt: TimestampSchema,
});
export type SlotHoldSnapshot = z.infer<typeof SlotHoldSnapshotSchema>;

export const BookingSlotProjectionSchema = z.strictObject({
  state: z.enum(["held", "confirmed", "released", "expired"]),
  slotId: IdSchema,
  holdId: IdSchema,
  startsAt: TimestampSchema,
  endsAt: TimestampSchema,
  expiresAt: TimestampSchema,
  confirmedAt: TimestampSchema.nullable(),
});
export type BookingSlotProjection = z.infer<typeof BookingSlotProjectionSchema>;

export const SlotHistoryEntrySchema = z.strictObject({
  state: z.enum(["superseded", "cancelled", "expired"]),
  slotId: IdSchema,
  holdId: IdSchema,
  startsAt: TimestampSchema,
  endsAt: TimestampSchema,
  recordedAt: TimestampSchema,
});

export const AgreementProjectionSchema = z
  .strictObject({
    state: z.enum(["unsigned", "signed"]),
    snapshot: SignedAgreementSnapshotSchema.nullable(),
  })
  .superRefine((agreement, context) => {
    if ((agreement.state === "signed") !== (agreement.snapshot !== null)) {
      context.addIssue({
        code: "custom",
        message: "Signed agreement state and snapshot must change together",
      });
    }
  });

export const PaymentProjectionSchema = z.strictObject({
  state: z.enum([
    "not_started",
    "pending",
    "paid",
    "declined",
    "failed",
    "unknown",
    "refund_pending",
    "refunded",
    "refund_failed",
  ]),
  attempt: z.int().nonnegative(),
  intentId: z.string().trim().min(1).max(300).nullable(),
  providerReference: z.string().trim().min(1).max(300).nullable(),
  failureCode: z.string().trim().min(1).max(300).nullable(),
  terminal: z.boolean(),
});

export const CalendarProjectionSchema = z.strictObject({
  state: z.enum([
    "not_requested",
    "pending",
    "confirmed",
    "reservation_failed",
    "unknown",
    "cancellation_pending",
    "cancelled",
    "cancellation_failed",
  ]),
  eventReference: z.string().trim().min(1).max(300).nullable(),
  failureCode: z.string().trim().min(1).max(300).nullable(),
  retryable: z.boolean(),
});

export const AccessProjectionSchema = z.strictObject({
  state: z.enum([
    "not_requested",
    "confirmation_pending",
    "confirmed",
    "overridden",
    "invalidated",
  ]),
  generation: z.int().positive(),
  activeLinkId: IdSchema.nullable(),
  activeTokenFingerprint: Sha256Schema.nullable(),
  supersededLinkIds: z.array(IdSchema),
  confirmedAt: TimestampSchema.nullable(),
  overrideReason: z.string().trim().min(1).max(4_000).nullable(),
});

export const ReminderSchema = z.strictObject({
  reminderId: IdSchema,
  generation: z.int().positive(),
  scheduledFor: TimestampSchema,
  channel: z.enum(["email", "sms"]),
  state: z.enum(["scheduled", "sent", "invalidated", "failed", "unknown"]),
});

export const NotificationProjectionSchema = z.strictObject({
  generation: z.int().positive(),
  reminders: z.array(ReminderSchema),
});

export const ReadinessActionSchema = z.strictObject({
  dependency: z.enum(["slot", "agreement", "payment", "calendar", "access"]),
  responsibleRole: z.enum([
    "client",
    "access_contact",
    "system",
    "administrator",
  ]),
  action: z.string().trim().min(1).max(300),
});

export const ReadinessProjectionSchema = z.strictObject({
  ready: z.boolean(),
  slot: z.enum(["ready", "action_required"]),
  agreement: z.enum(["ready", "action_required"]),
  payment: z.enum(["ready", "action_required", "provider_recovery"]),
  calendar: z.enum(["ready", "action_required", "provider_recovery"]),
  access: z.enum(["ready", "action_required"]),
  actions: z.array(ReadinessActionSchema),
});
export type ReadinessProjection = z.infer<typeof ReadinessProjectionSchema>;

export const CommandReceiptSchema = z.strictObject({
  idempotencyKey: z.string().trim().min(1).max(300),
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
});

export const ProviderCallbackReceiptSchema = z.strictObject({
  providerEventId: z.string().trim().min(1).max(300),
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
});

export const RescheduleProjectionSchema = z.strictObject({
  candidateSlot: SlotHoldSnapshotSchema,
  previousCalendarEventReference: z.string().trim().min(1).max(300).nullable(),
});

export const BookingStateSchema = z
  .strictObject({
    bookingId: IdSchema,
    organizationId: IdSchema,
    revision: z.int().nonnegative(),
    lifecycle: z.enum([
      "draft",
      "confirmed",
      "reschedule_pending",
      "cancel_pending",
      "cancelled",
    ]),
    input: BookingInputSnapshotSchema,
    quote: QuoteSnapshotSchema,
    slot: BookingSlotProjectionSchema,
    slotHistory: z.array(SlotHistoryEntrySchema),
    agreement: AgreementProjectionSchema,
    payment: PaymentProjectionSchema,
    calendar: CalendarProjectionSchema,
    access: AccessProjectionSchema,
    notifications: NotificationProjectionSchema,
    readiness: ReadinessProjectionSchema,
    reschedule: RescheduleProjectionSchema.nullable(),
    cancellationReason: z.string().trim().min(1).max(4_000).nullable(),
    commandReceipts: z.array(CommandReceiptSchema),
    providerCallbackReceipts: z.array(ProviderCallbackReceiptSchema),
  })
  .superRefine((state, context) => {
    if (sha256(state.quote) !== sha256(state.input.quote)) {
      context.addIssue({
        code: "custom",
        path: ["quote"],
        message:
          "The booking quote projection must equal the preserved input quote snapshot",
      });
    }
  });
export type BookingState = z.infer<typeof BookingStateSchema>;

const SlotInventoryFields = {
  slotId: IdSchema,
  startsAt: TimestampSchema,
  endsAt: TimestampSchema,
  inspectorId: IdSchema,
};

export const AvailableSlotSchema = z.strictObject({
  ...SlotInventoryFields,
  state: z.literal("available"),
  hold: z.null(),
  confirmedBookingId: z.null(),
});
export const HeldSlotSchema = z.strictObject({
  ...SlotInventoryFields,
  state: z.literal("held"),
  hold: z.strictObject({
    holdId: IdSchema,
    bookingId: IdSchema,
    expiresAt: TimestampSchema,
  }),
  confirmedBookingId: z.null(),
});
export const ConfirmedSlotSchema = z.strictObject({
  ...SlotInventoryFields,
  state: z.literal("confirmed"),
  hold: z.null(),
  confirmedBookingId: IdSchema,
});
export const SlotInventoryEntrySchema = z.discriminatedUnion("state", [
  AvailableSlotSchema,
  HeldSlotSchema,
  ConfirmedSlotSchema,
]);
export type SlotInventoryEntry = z.infer<typeof SlotInventoryEntrySchema>;

export const SlotBookSchema = z.strictObject({
  revision: z.int().nonnegative(),
  slots: z.array(SlotInventoryEntrySchema),
  commandReceipts: z.array(CommandReceiptSchema),
});
export type SlotBook = z.infer<typeof SlotBookSchema>;
