import type { EventEnvelopeV1, ModuleType } from "@inspection/contracts";

import { deepFreeze, sha256 } from "./canonical.js";
import { EventIntegrityError } from "./errors.js";
import { upcastEventStream, type StoredEventEnvelope } from "./upcasters.js";

export type ProjectedModuleStatus =
  | "not_started"
  | "inspection_in_progress"
  | "inspection_completed"
  | "approved"
  | "amendment_pending"
  | "withdrawn";

export type ModuleReplayProjection = Readonly<{
  module: ModuleType;
  status: ProjectedModuleStatus;
  currentSnapshotId: string | null;
  currentApprovalId: string | null;
  amendmentCount: number;
}>;

export type InspectionReplayProjection = Readonly<{
  schemaVersion: 1;
  organizationId: string;
  aggregate: Readonly<{ type: string; id: string }>;
  revision: number;
  bookingStatus: "none" | "booked" | "cancelled";
  inspectionStatus: "not_started" | "in_progress" | "completed";
  modules: Readonly<{
    building: ModuleReplayProjection;
    timberPest: ModuleReplayProjection;
  }>;
  packageStatus: "none" | "confirmed" | "cancelled";
  deliveryStatus: "not_delivered" | "delivered";
  recipientAccessStatus: "none" | "active" | "revoked";
  deletionStatus: "active" | "deletion_suppressed";
  compactionCheckpointIds: readonly string[];
  lastEventId: string;
}>;

export type ReplayCheckpoint = Readonly<{
  schemaVersion: 1;
  throughAggregateVersion: number;
  rawHistoryEventHash: string;
  projectionHash: string;
  projection: InspectionReplayProjection;
}>;

export function replayInspectionProjection(
  rawHistory: readonly StoredEventEnvelope[],
  checkpoint?: ReplayCheckpoint,
): InspectionReplayProjection {
  const currentEvents = upcastEventStream(rawHistory);
  if (currentEvents.length === 0) {
    throw new EventIntegrityError("Cannot replay an empty event history", 0);
  }

  if (checkpoint === undefined) {
    return reduceEvents(currentEvents);
  }

  const checkpointIndex = checkpoint.throughAggregateVersion - 1;
  const rawCheckpointEvent = rawHistory[checkpointIndex];
  if (rawCheckpointEvent === undefined || checkpointIndex < 0) {
    throw new EventIntegrityError(
      "Replay checkpoint is outside the supplied raw history",
      Math.max(0, checkpointIndex),
    );
  }
  if (rawCheckpointEvent.eventHash !== checkpoint.rawHistoryEventHash) {
    throw new EventIntegrityError(
      "Replay checkpoint does not match the supplied raw history",
      checkpointIndex,
    );
  }
  if (sha256(checkpoint.projection) !== checkpoint.projectionHash) {
    throw new EventIntegrityError(
      "Replay checkpoint projection failed integrity verification",
      checkpointIndex,
    );
  }

  const verifiedPrefix = reduceEvents(
    currentEvents.slice(0, checkpoint.throughAggregateVersion),
  );
  if (sha256(verifiedPrefix) !== checkpoint.projectionHash) {
    throw new EventIntegrityError(
      "Replay checkpoint projection does not match recomputed raw history",
      checkpointIndex,
    );
  }

  return reduceEvents(
    currentEvents.slice(checkpoint.throughAggregateVersion),
    checkpoint.projection,
  );
}

/**
 * A checkpoint is a durable comparison point, never a replacement for raw
 * history: callers must still provide the complete chain beginning at version
 * one. The prefix is deliberately recomputed before the checkpoint is trusted.
 */
export function createReplayCheckpoint(
  rawHistory: readonly StoredEventEnvelope[],
  throughAggregateVersion = rawHistory.length,
): ReplayCheckpoint {
  const currentEvents = upcastEventStream(rawHistory);
  const checkpointIndex = throughAggregateVersion - 1;
  const rawCheckpointEvent = rawHistory[checkpointIndex];
  if (
    rawCheckpointEvent === undefined ||
    checkpointIndex < 0 ||
    throughAggregateVersion > currentEvents.length
  ) {
    throw new EventIntegrityError(
      "Replay checkpoint is outside the supplied raw history",
      Math.max(0, checkpointIndex),
    );
  }
  const projection = reduceEvents(
    currentEvents.slice(0, throughAggregateVersion),
  );
  return deepFreeze({
    schemaVersion: 1,
    throughAggregateVersion,
    rawHistoryEventHash: rawCheckpointEvent.eventHash,
    projectionHash: sha256(projection),
    projection,
  });
}

function reduceEvents(
  events: readonly EventEnvelopeV1[],
  seed?: InspectionReplayProjection,
): InspectionReplayProjection {
  if (events.length === 0) {
    if (seed === undefined) {
      throw new EventIntegrityError("Cannot reduce an empty event history", 0);
    }
    return deepFreeze(seed);
  }

  let projection = seed ?? initialProjection(events[0]!);
  for (const event of events) {
    projection = applyEvent(projection, event);
  }
  return deepFreeze(projection);
}

function initialProjection(event: EventEnvelopeV1): InspectionReplayProjection {
  return {
    schemaVersion: 1,
    organizationId: event.organizationId,
    aggregate: event.aggregate,
    revision: 0,
    bookingStatus: "none",
    inspectionStatus: "not_started",
    modules: {
      building: initialModule("building"),
      timberPest: initialModule("timber_pest"),
    },
    packageStatus: "none",
    deliveryStatus: "not_delivered",
    recipientAccessStatus: "none",
    deletionStatus: "active",
    compactionCheckpointIds: [],
    lastEventId: event.eventId,
  };
}

function initialModule(module: ModuleType): ModuleReplayProjection {
  return {
    module,
    status: "not_started",
    currentSnapshotId: null,
    currentApprovalId: null,
    amendmentCount: 0,
  };
}

function applyEvent(
  prior: InspectionReplayProjection,
  event: EventEnvelopeV1,
): InspectionReplayProjection {
  let next: InspectionReplayProjection = {
    ...prior,
    revision: event.aggregateVersion,
    lastEventId: event.eventId,
  };

  switch (event.eventType) {
    case "booking.created":
      next = { ...next, bookingStatus: "booked" };
      break;
    case "booking.cancelled":
      next = { ...next, bookingStatus: "cancelled" };
      break;
    case "inspection.started":
      next = { ...next, inspectionStatus: "in_progress" };
      break;
    case "inspection.completed":
      next = { ...next, inspectionStatus: "completed" };
      break;
    case "inspection.module_started":
      next = updateModule(next, event, {
        status: "inspection_in_progress",
      });
      break;
    case "inspection.module_completed":
      next = updateModule(next, event, {
        status: "inspection_completed",
      });
      break;
    case "approval.module_approved":
      next = updateModule(next, event, {
        status: "approved",
        currentSnapshotId: metadataString(event, "snapshotId"),
        currentApprovalId: metadataString(event, "approvalId"),
      });
      break;
    case "amendment.module_amended": {
      const module = metadataModule(event);
      const current = moduleProjection(next, module);
      next = updateModule(next, event, {
        status: "amendment_pending",
        currentSnapshotId: metadataString(event, "replacementSnapshotId"),
        currentApprovalId: null,
        amendmentCount: current.amendmentCount + 1,
      });
      break;
    }
    case "approval.module_withdrawn":
      next = updateModule(next, event, {
        status: "withdrawn",
        currentApprovalId: null,
      });
      break;
    case "report.package_confirmed":
      next = { ...next, packageStatus: "confirmed" };
      break;
    case "report.package_cancelled":
      next = { ...next, packageStatus: "cancelled" };
      break;
    case "delivery.delivered":
      next = { ...next, deliveryStatus: "delivered" };
      break;
    case "recipient_access.grant_issued":
      next = { ...next, recipientAccessStatus: "active" };
      break;
    case "recipient_access.grant_revoked":
      next = { ...next, recipientAccessStatus: "revoked" };
      break;
    case "system.deletion_suppressed":
      next = { ...next, deletionStatus: "deletion_suppressed" };
      break;
    case "system.compaction_checkpoint":
      next = {
        ...next,
        compactionCheckpointIds: [
          ...next.compactionCheckpointIds,
          metadataString(event, "checkpointId"),
        ],
      };
      break;
  }
  return deepFreeze(next);
}

function updateModule(
  projection: InspectionReplayProjection,
  event: EventEnvelopeV1,
  patch: Partial<Omit<ModuleReplayProjection, "module">>,
): InspectionReplayProjection {
  const module = metadataModule(event);
  if (module === "building") {
    return {
      ...projection,
      modules: {
        ...projection.modules,
        building: { ...projection.modules.building, ...patch },
      },
    };
  }
  return {
    ...projection,
    modules: {
      ...projection.modules,
      timberPest: { ...projection.modules.timberPest, ...patch },
    },
  };
}

function moduleProjection(
  projection: InspectionReplayProjection,
  module: ModuleType,
): ModuleReplayProjection {
  return module === "building"
    ? projection.modules.building
    : projection.modules.timberPest;
}

function metadataModule(event: EventEnvelopeV1): ModuleType {
  const module = event.safeMetadata.module;
  if (module !== "building" && module !== "timber_pest") {
    throw new EventIntegrityError(
      `${event.eventType} requires explicit building or timber_pest metadata`,
      event.aggregateVersion - 1,
    );
  }
  return module;
}

function metadataString(event: EventEnvelopeV1, key: string): string {
  const value = event.safeMetadata[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new EventIntegrityError(
      `${event.eventType} requires non-empty ${key} metadata`,
      event.aggregateVersion - 1,
    );
  }
  return value;
}
