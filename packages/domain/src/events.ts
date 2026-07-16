import {
  EventDraftV1Schema,
  EventEnvelopeV1Schema,
  type EventDraftV1,
  type EventEnvelopeV1,
} from "@inspection/contracts";

import { deepFreeze, sha256 } from "./canonical.js";
import { DomainConflictError, EventIntegrityError } from "./errors.js";

export function createEventEnvelope(
  input: EventDraftV1,
  previousEvent: EventEnvelopeV1 | null,
): EventEnvelopeV1 {
  const draft = EventDraftV1Schema.parse(input);
  if (previousEvent === null) {
    if (draft.aggregateVersion !== 1) {
      throw new DomainConflictError(
        "event_version_gap",
        "The first aggregate event version must be 1",
      );
    }
  } else {
    const previous = EventEnvelopeV1Schema.parse(previousEvent);
    if (
      previous.organizationId !== draft.organizationId ||
      previous.aggregate.type !== draft.aggregate.type ||
      previous.aggregate.id !== draft.aggregate.id
    ) {
      throw new DomainConflictError(
        "event_aggregate_mismatch",
        "Event chain cannot cross aggregate boundaries",
      );
    }
    if (draft.aggregateVersion !== previous.aggregateVersion + 1) {
      throw new DomainConflictError(
        "event_version_gap",
        "Aggregate event versions must be contiguous",
      );
    }
  }
  const payloadHash = hashEventPayload(draft);
  const previousEventHash = previousEvent?.eventHash ?? null;
  const eventWithoutHash = { ...draft, payloadHash, previousEventHash };
  return deepFreeze(
    EventEnvelopeV1Schema.parse({
      ...eventWithoutHash,
      eventHash: sha256(eventWithoutHash),
    }),
  );
}

export function verifyEventChain(events: readonly EventEnvelopeV1[]): boolean {
  let previous: EventEnvelopeV1 | null = null;
  events.forEach((candidate, index) => {
    let event: EventEnvelopeV1;
    try {
      event = EventEnvelopeV1Schema.parse(candidate);
    } catch {
      throw new EventIntegrityError(
        "Event envelope failed schema validation",
        index,
      );
    }
    if (index === 0 && event.aggregateVersion !== 1) {
      throw new EventIntegrityError(
        "Event chain does not begin at aggregate version 1",
        index,
      );
    }
    if (previous !== null) {
      if (
        event.organizationId !== previous.organizationId ||
        event.aggregate.type !== previous.aggregate.type ||
        event.aggregate.id !== previous.aggregate.id
      ) {
        throw new EventIntegrityError(
          "Event chain crossed aggregate boundaries",
          index,
        );
      }
      if (event.aggregateVersion !== previous.aggregateVersion + 1) {
        throw new EventIntegrityError(
          "Event chain has a gap or is reordered",
          index,
        );
      }
      if (event.previousEventHash !== previous.eventHash) {
        throw new EventIntegrityError(
          "Previous-event hash does not match",
          index,
        );
      }
    } else if (event.previousEventHash !== null) {
      throw new EventIntegrityError(
        "First event cannot reference an earlier event",
        index,
      );
    }
    if (event.payloadHash !== hashEventPayload(event)) {
      throw new EventIntegrityError("Event payload was mutated", index);
    }
    const { eventHash, ...eventWithoutHash } = event;
    if (eventHash !== sha256(eventWithoutHash)) {
      throw new EventIntegrityError("Event hash was mutated", index);
    }
    previous = event;
  });
  return true;
}

function hashEventPayload(event: EventDraftV1): string {
  return sha256({
    schemaVersion: event.schemaVersion,
    eventType: event.eventType,
    safeMetadata: event.safeMetadata,
    protectedArtifactReferences: event.protectedArtifactReferences,
  });
}
