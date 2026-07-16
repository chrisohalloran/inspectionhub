import { describe, expect, it } from "vitest";

import type { EventDraftV1 } from "@inspection/contracts";

import {
  EVENT_SCHEMA_UPCASTERS,
  EventIntegrityError,
  createEventEnvelope,
  createLegacyEventEnvelopeV0,
  createReplayCheckpoint,
  replayInspectionProjection,
  upcastEventStream,
  type LegacyEventDraftV0,
  type LegacyEventEnvelopeV0,
  type StoredEventEnvelope,
} from "./index.js";

const ids = {
  organization: "20000000-0000-4000-8000-000000000001",
  job: "20000000-0000-4000-8000-000000000002",
  session: "20000000-0000-4000-8000-000000000003",
  inspector: "20000000-0000-4000-8000-000000000004",
  correlation: "20000000-0000-4000-8000-000000000005",
  buildingSnapshot: "20000000-0000-4000-8000-000000000006",
  buildingApproval: "20000000-0000-4000-8000-000000000007",
  pestSnapshot: "20000000-0000-4000-8000-000000000008",
  pestApproval: "20000000-0000-4000-8000-000000000009",
  replacementPestSnapshot: "20000000-0000-4000-8000-000000000010",
  checkpoint: "20000000-0000-4000-8000-000000000011",
};

const at = "2026-07-14T08:00:00.000Z";

describe("deterministic event replay", () => {
  it("reconstructs the booking-to-suppression lifecycle without merging professional modules", () => {
    const history = lifecycleHistory();

    const booked = replayInspectionProjection(history.slice(0, 1));
    const inspecting = replayInspectionProjection(history.slice(0, 2));
    const buildingApproved = replayInspectionProjection(history.slice(0, 5));
    const bothApproved = replayInspectionProjection(history.slice(0, 8));
    const delivered = replayInspectionProjection(history.slice(0, 12));
    const final = replayInspectionProjection(history);

    expect(booked.bookingStatus).toBe("booked");
    expect(inspecting.inspectionStatus).toBe("in_progress");
    expect(buildingApproved.modules.building.status).toBe("approved");
    expect(buildingApproved.modules.timberPest.status).toBe("not_started");
    expect(bothApproved.modules.building.currentSnapshotId).toBe(
      ids.buildingSnapshot,
    );
    expect(bothApproved.modules.timberPest.currentSnapshotId).toBe(
      ids.pestSnapshot,
    );
    expect(delivered.inspectionStatus).toBe("completed");
    expect(delivered.packageStatus).toBe("confirmed");
    expect(delivered.deliveryStatus).toBe("delivered");

    expect(final).toMatchObject({
      bookingStatus: "booked",
      inspectionStatus: "completed",
      packageStatus: "cancelled",
      deliveryStatus: "delivered",
      recipientAccessStatus: "revoked",
      deletionStatus: "deletion_suppressed",
    });
    expect(final.modules.building).toMatchObject({
      module: "building",
      status: "withdrawn",
      currentSnapshotId: ids.buildingSnapshot,
      currentApprovalId: null,
      amendmentCount: 0,
    });
    expect(final.modules.timberPest).toMatchObject({
      module: "timber_pest",
      status: "amendment_pending",
      currentSnapshotId: ids.replacementPestSnapshot,
      currentApprovalId: null,
      amendmentCount: 1,
    });
    expect(final.compactionCheckpointIds).toEqual([ids.checkpoint]);
    expect(replayInspectionProjection(history)).toEqual(final);
    expect(Object.isFrozen(final)).toBe(true);
    expect(Object.isFrozen(final.modules)).toBe(true);
  });

  it("uses verified checkpoints while retaining and verifying complete raw history", () => {
    const history = lifecycleHistory();
    const checkpoint = createReplayCheckpoint(history, 13);
    const replayed = replayInspectionProjection(history, checkpoint);

    expect(replayed).toEqual(replayInspectionProjection(history));
    expect(checkpoint.rawHistoryEventHash).toBe(history[12]?.eventHash);

    expect(() =>
      replayInspectionProjection(history.slice(13), checkpoint),
    ).toThrowError(EventIntegrityError);

    const tamperedCheckpoint = {
      ...checkpoint,
      projection: {
        ...checkpoint.projection,
        packageStatus: "cancelled" as const,
      },
    };
    expect(() =>
      replayInspectionProjection(history, tamperedCheckpoint),
    ).toThrowError(/checkpoint projection failed integrity verification/u);
  });

  it("projects explicit booking cancellation without erasing the booking history", () => {
    const booked = currentEvent(1, "booking.created", {}, null);
    const cancelled = currentEvent(2, "booking.cancelled", {}, booked);
    const projection = replayInspectionProjection([booked, cancelled]);

    expect(projection.bookingStatus).toBe("cancelled");
    expect(projection.revision).toBe(2);
    expect(projection.lastEventId).toBe(cancelled.eventId);
  });
});

describe("event schema upcasting", () => {
  it("replays a real v0 signed-off pest event identically to its v1 equivalent", () => {
    const legacyFixture = legacyPestApprovalFixture();
    const currentEquivalent = currentEvent(
      1,
      "approval.module_approved",
      {
        module: "timber_pest",
        snapshotId: ids.pestSnapshot,
        approvalId: ids.pestApproval,
      },
      null,
      legacyFixture.eventId,
    );

    expect(EVENT_SCHEMA_UPCASTERS[0]).toBeTypeOf("function");
    const [upcasted] = upcastEventStream([legacyFixture]);
    expect(upcasted).toMatchObject({
      schemaVersion: 1,
      eventType: "approval.module_approved",
      organizationId: ids.organization,
      aggregate: { type: "inspection_job", id: ids.job },
      safeMetadata: {
        module: "timber_pest",
        snapshotId: ids.pestSnapshot,
        approvalId: ids.pestApproval,
      },
    });
    expect(legacyFixture.metadata.moduleName).toBe("pest");
    expect(replayInspectionProjection([legacyFixture])).toEqual(
      replayInspectionProjection([currentEquivalent]),
    );
  });

  it("rejects a mutated legacy payload before it reaches the projection", () => {
    const legacyFixture = legacyPestApprovalFixture();
    const mutated = {
      ...legacyFixture,
      metadata: {
        ...legacyFixture.metadata,
        approvalId: ids.buildingApproval,
      },
    } as LegacyEventEnvelopeV0;

    expect(() => replayInspectionProjection([mutated])).toThrowError(
      /Legacy event payload was mutated/u,
    );
  });
});

function lifecycleHistory(): readonly StoredEventEnvelope[] {
  const specs: readonly Readonly<{
    type: string;
    metadata: EventDraftV1["safeMetadata"];
  }>[] = [
    { type: "booking.created", metadata: { status: "confirmed" } },
    { type: "inspection.started", metadata: {} },
    { type: "inspection.module_started", metadata: { module: "building" } },
    {
      type: "inspection.module_completed",
      metadata: { module: "building" },
    },
    {
      type: "approval.module_approved",
      metadata: {
        module: "building",
        snapshotId: ids.buildingSnapshot,
        approvalId: ids.buildingApproval,
      },
    },
    {
      type: "inspection.module_started",
      metadata: { module: "timber_pest" },
    },
    {
      type: "inspection.module_completed",
      metadata: { module: "timber_pest" },
    },
    {
      type: "approval.module_approved",
      metadata: {
        module: "timber_pest",
        snapshotId: ids.pestSnapshot,
        approvalId: ids.pestApproval,
      },
    },
    { type: "inspection.completed", metadata: {} },
    { type: "report.package_confirmed", metadata: {} },
    { type: "delivery.delivered", metadata: {} },
    { type: "recipient_access.grant_issued", metadata: {} },
    {
      type: "system.compaction_checkpoint",
      metadata: { checkpointId: ids.checkpoint },
    },
    {
      type: "amendment.module_amended",
      metadata: {
        module: "timber_pest",
        replacementSnapshotId: ids.replacementPestSnapshot,
      },
    },
    {
      type: "approval.module_withdrawn",
      metadata: { module: "building" },
    },
    { type: "report.package_cancelled", metadata: {} },
    { type: "recipient_access.grant_revoked", metadata: {} },
    { type: "system.deletion_suppressed", metadata: {} },
  ];

  let previous: StoredEventEnvelope | null = null;
  return specs.map((spec, index) => {
    const event = currentEvent(index + 1, spec.type, spec.metadata, previous);
    previous = event;
    return event;
  });
}

function currentEvent(
  aggregateVersion: number,
  eventType: string,
  safeMetadata: EventDraftV1["safeMetadata"],
  previous: StoredEventEnvelope | null,
  eventId = eventUuid(aggregateVersion),
) {
  if (previous !== null && previous.schemaVersion === 0) {
    throw new Error("This fixture helper creates all-current streams only");
  }
  return createEventEnvelope(
    {
      schemaVersion: 1,
      eventId,
      eventType,
      organizationId: ids.organization,
      aggregate: { type: "inspection_job", id: ids.job },
      aggregateVersion,
      sessionId: ids.session,
      actor: { type: "inspector", id: ids.inspector },
      clientOccurredAt: at,
      serverRecordedAt: at,
      idempotencyKey: `replay-fixture-${aggregateVersion}`,
      safeMetadata,
      protectedArtifactReferences: [],
      correlationId: ids.correlation,
      causationId: null,
    },
    previous,
  );
}

function legacyPestApprovalFixture(): LegacyEventEnvelopeV0 {
  const draft: LegacyEventDraftV0 = {
    schemaVersion: 0,
    eventId: eventUuid(1),
    name: "inspection.module_signed_off",
    tenantId: ids.organization,
    stream: { name: "inspection_job", id: ids.job },
    sequence: 1,
    sessionId: ids.session,
    actorKind: "inspector",
    actorId: ids.inspector,
    occurredAt: at,
    recordedAt: at,
    deduplicationKey: "replay-fixture-1",
    metadata: {
      moduleName: "pest",
      snapshotId: ids.pestSnapshot,
      approvalId: ids.pestApproval,
    },
    artifacts: [],
    traceId: ids.correlation,
    parentEventId: null,
  };
  return createLegacyEventEnvelopeV0(draft, null);
}

function eventUuid(sequence: number): string {
  return `30000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}
