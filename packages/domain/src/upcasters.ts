import {
  EventDraftV1Schema,
  EventEnvelopeV1Schema,
  type EventDraftV1,
  type EventEnvelopeV1,
} from "@inspection/contracts";

import { deepFreeze, sha256 } from "./canonical.js";
import { createEventEnvelope } from "./events.js";
import { DomainConflictError, EventIntegrityError } from "./errors.js";

/**
 * The persisted shape used by the first field prototype. Keeping the shape
 * explicit makes migration behaviour reviewable instead of hiding it in a
 * permissive parser.
 */
export type LegacyEventDraftV0 = Readonly<{
  schemaVersion: 0;
  eventId: string;
  name: string;
  tenantId: string;
  stream: Readonly<{ name: string; id: string }>;
  sequence: number;
  sessionId: string;
  actorKind:
    | "inspector"
    | "administrator"
    | "client"
    | "recipient"
    | "access_contact"
    | "provider"
    | "system";
  actorId: string | null;
  occurredAt: string | null;
  recordedAt: string;
  deduplicationKey: string;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
  artifacts: EventDraftV1["protectedArtifactReferences"];
  traceId: string;
  parentEventId: string | null;
}>;

export type LegacyEventEnvelopeV0 = LegacyEventDraftV0 &
  Readonly<{
    payloadHash: string;
    previousEventHash: string | null;
    eventHash: string;
  }>;

export type StoredEventEnvelope = EventEnvelopeV1 | LegacyEventEnvelopeV0;

type LegacyV0Upcaster = (event: LegacyEventEnvelopeV0) => EventDraftV1;

const legacyEventNames: Readonly<Record<string, string>> = Object.freeze({
  "inspection.module_signed_off": "approval.module_approved",
  "inspection.module_reopened": "amendment.module_amended",
  "delivery.package_voided": "report.package_cancelled",
});

function upcastLegacyV0(event: LegacyEventEnvelopeV0): EventDraftV1 {
  const safeMetadata = { ...event.metadata };
  const legacyModule = safeMetadata.moduleName;
  if (typeof legacyModule === "string") {
    safeMetadata.module =
      legacyModule === "pest" ? "timber_pest" : legacyModule;
    delete safeMetadata.moduleName;
  }
  const legacyBookingState = safeMetadata.bookingState;
  if (typeof legacyBookingState === "string") {
    safeMetadata.status = legacyBookingState;
    delete safeMetadata.bookingState;
  }

  return EventDraftV1Schema.parse({
    schemaVersion: 1,
    eventId: event.eventId,
    eventType: legacyEventNames[event.name] ?? event.name,
    organizationId: event.tenantId,
    aggregate: {
      type: event.stream.name,
      id: event.stream.id,
    },
    aggregateVersion: event.sequence,
    sessionId: event.sessionId,
    actor: {
      type: event.actorKind,
      id: event.actorKind === "system" ? null : event.actorId,
    },
    clientOccurredAt: event.occurredAt,
    serverRecordedAt: event.recordedAt,
    idempotencyKey: event.deduplicationKey,
    safeMetadata,
    protectedArtifactReferences: event.artifacts,
    correlationId: event.traceId,
    causationId: event.parentEventId,
  });
}

/** Every historical schema must register one deterministic step to v1. */
export const EVENT_SCHEMA_UPCASTERS: Readonly<Record<0, LegacyV0Upcaster>> =
  Object.freeze({
    0: upcastLegacyV0,
  });

export function createLegacyEventEnvelopeV0(
  input: LegacyEventDraftV0,
  previousEvent: StoredEventEnvelope | null,
): LegacyEventEnvelopeV0 {
  assertLegacyDraft(input, input.sequence - 1);
  if (previousEvent === null) {
    if (input.sequence !== 1) {
      throw new DomainConflictError(
        "event_version_gap",
        "The first legacy event sequence must be 1",
      );
    }
  } else {
    const previousIdentity = eventIdentity(previousEvent);
    if (
      previousIdentity.organizationId !== input.tenantId ||
      previousIdentity.aggregateType !== input.stream.name ||
      previousIdentity.aggregateId !== input.stream.id
    ) {
      throw new DomainConflictError(
        "event_aggregate_mismatch",
        "Legacy event chain cannot cross aggregate boundaries",
      );
    }
    if (input.sequence !== previousIdentity.aggregateVersion + 1) {
      throw new DomainConflictError(
        "event_version_gap",
        "Legacy event sequences must be contiguous",
      );
    }
  }

  const payloadHash = legacyPayloadHash(input);
  const eventWithoutHash = {
    ...input,
    payloadHash,
    previousEventHash: previousEvent?.eventHash ?? null,
  };
  return deepFreeze({
    ...eventWithoutHash,
    eventHash: sha256(eventWithoutHash),
  });
}

/**
 * Verifies the original persisted bytes and hash links before any upcaster or
 * projection sees the stream.
 */
export function verifyStoredEventChain(
  events: readonly StoredEventEnvelope[],
): true {
  let previous: StoredEventEnvelope | null = null;
  events.forEach((candidate, index) => {
    const event = verifyStoredEvent(candidate, index);
    const identity = eventIdentity(event);
    if (index === 0 && identity.aggregateVersion !== 1) {
      throw new EventIntegrityError(
        "Stored event chain does not begin at aggregate version 1",
        index,
      );
    }
    if (previous === null) {
      if (event.previousEventHash !== null) {
        throw new EventIntegrityError(
          "First stored event cannot reference an earlier event",
          index,
        );
      }
    } else {
      const previousIdentity = eventIdentity(previous);
      if (
        identity.organizationId !== previousIdentity.organizationId ||
        identity.aggregateType !== previousIdentity.aggregateType ||
        identity.aggregateId !== previousIdentity.aggregateId
      ) {
        throw new EventIntegrityError(
          "Stored event chain crossed aggregate boundaries",
          index,
        );
      }
      if (identity.aggregateVersion !== previousIdentity.aggregateVersion + 1) {
        throw new EventIntegrityError(
          "Stored event chain has a gap or is reordered",
          index,
        );
      }
      if (event.previousEventHash !== previous.eventHash) {
        throw new EventIntegrityError(
          "Stored previous-event hash does not match",
          index,
        );
      }
    }
    previous = event;
  });
  return true;
}

export function upcastEventStream(
  events: readonly StoredEventEnvelope[],
): readonly EventEnvelopeV1[] {
  verifyStoredEventChain(events);
  let previous: EventEnvelopeV1 | null = null;
  const currentEvents = events.map((storedEvent, index) => {
    let draft: EventDraftV1;
    try {
      draft =
        storedEvent.schemaVersion === 0
          ? EVENT_SCHEMA_UPCASTERS[0](storedEvent)
          : currentDraft(storedEvent);
    } catch (error) {
      throw new EventIntegrityError(
        `Stored event cannot be upcast to schema v1: ${error instanceof Error ? error.message : "unknown validation failure"}`,
        index,
      );
    }
    const current = createEventEnvelope(draft, previous);
    previous = current;
    return current;
  });
  return deepFreeze(currentEvents);
}

function currentDraft(event: EventEnvelopeV1): EventDraftV1 {
  return EventDraftV1Schema.parse({
    schemaVersion: event.schemaVersion,
    eventId: event.eventId,
    eventType: event.eventType,
    organizationId: event.organizationId,
    aggregate: event.aggregate,
    aggregateVersion: event.aggregateVersion,
    sessionId: event.sessionId,
    actor: event.actor,
    clientOccurredAt: event.clientOccurredAt,
    serverRecordedAt: event.serverRecordedAt,
    idempotencyKey: event.idempotencyKey,
    safeMetadata: event.safeMetadata,
    protectedArtifactReferences: event.protectedArtifactReferences,
    correlationId: event.correlationId,
    causationId: event.causationId,
  });
}

function verifyStoredEvent(
  candidate: StoredEventEnvelope,
  index: number,
): StoredEventEnvelope {
  if (candidate.schemaVersion === 0) {
    assertLegacyDraft(candidate, index);
    if (candidate.payloadHash !== legacyPayloadHash(candidate)) {
      throw new EventIntegrityError("Legacy event payload was mutated", index);
    }
    const { eventHash, ...eventWithoutHash } = candidate;
    if (eventHash !== sha256(eventWithoutHash)) {
      throw new EventIntegrityError("Legacy event hash was mutated", index);
    }
    return candidate;
  }

  let event: EventEnvelopeV1;
  try {
    event = EventEnvelopeV1Schema.parse(candidate);
  } catch {
    throw new EventIntegrityError(
      "Current event envelope failed schema validation",
      index,
    );
  }
  if (event.payloadHash !== currentPayloadHash(event)) {
    throw new EventIntegrityError("Current event payload was mutated", index);
  }
  const { eventHash, ...eventWithoutHash } = event;
  if (eventHash !== sha256(eventWithoutHash)) {
    throw new EventIntegrityError("Current event hash was mutated", index);
  }
  return event;
}

function assertLegacyDraft(
  event: LegacyEventDraftV0,
  index: number,
): asserts event is LegacyEventDraftV0 {
  const actorIdValid =
    event.actorKind === "system"
      ? event.actorId === null
      : typeof event.actorId === "string";
  if (
    event.schemaVersion !== 0 ||
    typeof event.eventId !== "string" ||
    typeof event.name !== "string" ||
    typeof event.tenantId !== "string" ||
    typeof event.stream?.name !== "string" ||
    typeof event.stream.id !== "string" ||
    !Number.isInteger(event.sequence) ||
    event.sequence < 1 ||
    typeof event.sessionId !== "string" ||
    !actorIdValid ||
    typeof event.recordedAt !== "string" ||
    typeof event.deduplicationKey !== "string" ||
    typeof event.metadata !== "object" ||
    !Array.isArray(event.artifacts) ||
    typeof event.traceId !== "string"
  ) {
    throw new EventIntegrityError(
      "Legacy event envelope failed schema validation",
      index,
    );
  }
}

function legacyPayloadHash(event: LegacyEventDraftV0): string {
  return sha256({
    schemaVersion: event.schemaVersion,
    name: event.name,
    metadata: event.metadata,
    artifacts: event.artifacts,
  });
}

function currentPayloadHash(event: EventDraftV1): string {
  return sha256({
    schemaVersion: event.schemaVersion,
    eventType: event.eventType,
    safeMetadata: event.safeMetadata,
    protectedArtifactReferences: event.protectedArtifactReferences,
  });
}

function eventIdentity(event: StoredEventEnvelope): Readonly<{
  organizationId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
}> {
  return event.schemaVersion === 0
    ? {
        organizationId: event.tenantId,
        aggregateType: event.stream.name,
        aggregateId: event.stream.id,
        aggregateVersion: event.sequence,
      }
    : {
        organizationId: event.organizationId,
        aggregateType: event.aggregate.type,
        aggregateId: event.aggregate.id,
        aggregateVersion: event.aggregateVersion,
      };
}
