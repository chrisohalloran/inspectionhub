import { deepFreeze } from "@inspection/domain";

import { BookingConflictError } from "./errors.js";
import { inspectCommand, type CommandMetadata } from "./idempotency.js";
import {
  SlotBookSchema,
  type SlotBook,
  type SlotInventoryEntry,
} from "./schemas.js";

export type SlotDefinition = Readonly<{
  slotId: string;
  startsAt: string;
  endsAt: string;
  inspectorId: string;
}>;

export function createSlotBook(
  definitions: readonly SlotDefinition[],
): SlotBook {
  const uniqueSlotIds = new Set(
    definitions.map((definition) => definition.slotId),
  );
  if (uniqueSlotIds.size !== definitions.length) {
    throw new BookingConflictError(
      "duplicate_slot",
      "Slot inventory cannot contain duplicate slot identifiers",
    );
  }
  for (const definition of definitions) {
    if (Date.parse(definition.endsAt) <= Date.parse(definition.startsAt)) {
      throw new BookingConflictError(
        "invalid_slot",
        "Every slot must end after it starts",
      );
    }
  }
  for (let leftIndex = 0; leftIndex < definitions.length; leftIndex += 1) {
    const left = definitions[leftIndex];
    if (left === undefined) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < definitions.length;
      rightIndex += 1
    ) {
      const right = definitions[rightIndex];
      if (right === undefined || left.inspectorId !== right.inspectorId)
        continue;
      if (
        Date.parse(left.startsAt) < Date.parse(right.endsAt) &&
        Date.parse(right.startsAt) < Date.parse(left.endsAt)
      ) {
        throw new BookingConflictError(
          "overlapping_inspector_slots",
          "One inspector cannot have overlapping slot definitions",
          { leftSlotId: left.slotId, rightSlotId: right.slotId },
        );
      }
    }
  }
  return freezeSlotBook({
    revision: 0,
    slots: definitions.map((definition) => ({
      ...definition,
      state: "available" as const,
      hold: null,
      confirmedBookingId: null,
    })),
    commandReceipts: [],
  });
}

type HoldSlotCommand = CommandMetadata &
  Readonly<{
    holdId: string;
    bookingId: string;
    slotId: string;
    now: string;
    expiresAt: string;
  }>;

export function holdSlot(
  state: SlotBook,
  command: HoldSlotCommand,
): Readonly<{ state: SlotBook; replayed: boolean }> {
  const parsed = SlotBookSchema.parse(state);
  const decision = inspectCommand(
    parsed.revision,
    parsed.commandReceipts,
    command,
    "slot.hold",
    withoutMetadata(command),
  );
  if (decision.replayed) {
    return { state, replayed: true };
  }
  if (Date.parse(command.expiresAt) <= Date.parse(command.now)) {
    throw new BookingConflictError(
      "invalid_hold_expiry",
      "A slot hold must expire after it is created",
    );
  }
  const index = parsed.slots.findIndex(
    (slot) => slot.slotId === command.slotId,
  );
  const slot = parsed.slots[index];
  if (slot === undefined) {
    throw new BookingConflictError(
      "slot_not_found",
      "The requested slot does not exist",
    );
  }
  if (slot.state === "confirmed") {
    throw new BookingConflictError(
      "slot_unavailable",
      "The requested slot is confirmed",
    );
  }
  if (
    slot.state === "held" &&
    Date.parse(slot.hold.expiresAt) > Date.parse(command.now)
  ) {
    throw new BookingConflictError(
      "slot_unavailable",
      "The requested slot is held by another booking",
    );
  }
  const replacement: SlotInventoryEntry = {
    slotId: slot.slotId,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    inspectorId: slot.inspectorId,
    state: "held",
    hold: {
      holdId: command.holdId,
      bookingId: command.bookingId,
      expiresAt: command.expiresAt,
    },
    confirmedBookingId: null,
  };
  const slots = [...parsed.slots];
  slots[index] = replacement;
  return {
    state: freezeSlotBook({
      revision: parsed.revision + 1,
      slots,
      commandReceipts: [...parsed.commandReceipts, decision.receipt],
    }),
    replayed: false,
  };
}

type ConfirmSlotCommand = CommandMetadata &
  Readonly<{
    bookingId: string;
    holdId: string;
    now: string;
  }>;

export function confirmSlotHold(
  state: SlotBook,
  command: ConfirmSlotCommand,
): Readonly<{ state: SlotBook; replayed: boolean }> {
  const parsed = SlotBookSchema.parse(state);
  const decision = inspectCommand(
    parsed.revision,
    parsed.commandReceipts,
    command,
    "slot.confirm",
    withoutMetadata(command),
  );
  if (decision.replayed) {
    return { state, replayed: true };
  }
  const index = parsed.slots.findIndex(
    (slot) => slot.state === "held" && slot.hold.holdId === command.holdId,
  );
  const slot = parsed.slots[index];
  if (slot === undefined || slot.state !== "held") {
    throw new BookingConflictError(
      "hold_not_found",
      "The slot hold is no longer active",
    );
  }
  if (slot.hold.bookingId !== command.bookingId) {
    throw new BookingConflictError(
      "hold_owner_mismatch",
      "The booking does not own this slot hold",
    );
  }
  if (Date.parse(slot.hold.expiresAt) <= Date.parse(command.now)) {
    throw new BookingConflictError("hold_expired", "The slot hold has expired");
  }
  const slots = [...parsed.slots];
  slots[index] = {
    slotId: slot.slotId,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    inspectorId: slot.inspectorId,
    state: "confirmed",
    hold: null,
    confirmedBookingId: command.bookingId,
  };
  return {
    state: freezeSlotBook({
      revision: parsed.revision + 1,
      slots,
      commandReceipts: [...parsed.commandReceipts, decision.receipt],
    }),
    replayed: false,
  };
}

function withoutMetadata<T extends CommandMetadata>(
  command: T,
): Omit<T, keyof CommandMetadata> {
  const payload: Record<string, unknown> = { ...command };
  delete payload.expectedRevision;
  delete payload.idempotencyKey;
  return payload as Omit<T, keyof CommandMetadata>;
}

function freezeSlotBook(state: SlotBook): SlotBook {
  return deepFreeze(SlotBookSchema.parse(state));
}
