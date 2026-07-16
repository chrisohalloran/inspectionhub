import { describe, expect, it } from "vitest";

import type {
  BuildingModuleSnapshotInput,
  TimberPestModuleSnapshotInput,
} from "@inspection/contracts";

import {
  DomainConflictError,
  EventIntegrityError,
  amendModule,
  approveModule,
  cancelDeliveryPackage,
  confirmDeliveryPackage,
  createEventEnvelope,
  createIdempotencyLedger,
  createInitialDeliveryPackage,
  createInitialModuleState,
  createModuleSnapshot,
  createRecipientGrant,
  createLifecycleRecord,
  markEvidenceAtRisk,
  registerModuleSnapshot,
  registerVersionedCommand,
  revokeRecipientGrant,
  suppressDeletion,
  verifyEventChain,
  verifyModuleSnapshotHash,
  withdrawModule,
} from "./index.js";

const ids = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  jobId: "10000000-0000-4000-8000-000000000002",
  buildingModuleId: "10000000-0000-4000-8000-000000000003",
  pestModuleId: "10000000-0000-4000-8000-000000000004",
  inspectorId: "10000000-0000-4000-8000-000000000005",
  artifactId: "10000000-0000-4000-8000-000000000006",
  recipientId: "10000000-0000-4000-8000-000000000007",
};

const at = "2026-07-14T06:30:00.000Z";
const artifactReference = {
  kind: "original" as const,
  artifactId: ids.artifactId,
  contentHash: "a".repeat(64),
};

describe("immutable module snapshots", () => {
  it("creates deterministic canonical hashes and detects any professional-content mutation", () => {
    const snapshot = createModuleSnapshot(buildingSnapshotInput(1));
    const repeated = createModuleSnapshot(buildingSnapshotInput(1));
    const changed = createModuleSnapshot({
      ...buildingSnapshotInput(1),
      conclusion: {
        ...buildingSnapshotInput(1).conclusion,
        summary: "Changed professional conclusion.",
      },
    });

    expect(snapshot.canonicalHash).toBe(repeated.canonicalHash);
    expect(changed.canonicalHash).not.toBe(snapshot.canonicalHash);
    expect(verifyModuleSnapshotHash(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.findings)).toBe(true);
  });

  it("binds every professional snapshot category into the canonical hash", () => {
    const baselineInput = buildingSnapshotInput(1);
    const baselineHash = createModuleSnapshot(baselineInput).canonicalHash;
    const alternateEvidenceHash = "d".repeat(64);
    const variants: readonly BuildingModuleSnapshotInput[] = [
      { ...baselineInput, createdAt: "2026-07-14T06:31:00.000Z" },
      {
        ...baselineInput,
        inspector: {
          ...baselineInput.inspector,
          credentialVersion: "qld-building-v2",
        },
        findings: [
          {
            ...baselineInput.findings[0]!,
            inspectorAttribution: {
              ...baselineInput.findings[0]!.inspectorAttribution,
              credentialVersion: "qld-building-v2",
            },
          },
        ],
      },
      { ...baselineInput, requirementVersion: "building-requirements-v2" },
      { ...baselineInput, templateVersion: "building-template-v2" },
      {
        ...baselineInput,
        findings: [
          {
            ...baselineInput.findings[0]!,
            content: {
              ...baselineInput.findings[0]!.content,
              observation: "Changed observation.",
            },
          },
        ],
      },
      {
        ...baselineInput,
        coverage: [
          {
            coverageEntryId: "10000000-0000-4000-8000-000000000019",
            module: "building",
            moduleId: ids.buildingModuleId,
            areaId: "10000000-0000-4000-8000-000000000020",
            state: "inspected",
            recordedAt: at,
            recordedByInspectorId: ids.inspectorId,
          },
        ],
      },
      {
        ...baselineInput,
        limitations: [
          {
            limitationId: "10000000-0000-4000-8000-000000000021",
            module: "building",
            moduleId: ids.buildingModuleId,
            areaId: "10000000-0000-4000-8000-000000000022",
            material: true,
            description: "Roof void inaccessible at inspection time.",
            recordedAt: at,
            recordedByInspectorId: ids.inspectorId,
          },
        ],
      },
      {
        ...baselineInput,
        conclusion: {
          ...baselineInput.conclusion,
          summary: "Changed professional conclusion.",
        },
      },
      {
        ...baselineInput,
        verifierResults: [
          {
            status: "passed",
            draftVersionId: "10000000-0000-4000-8000-000000000023",
            contentHash: "e".repeat(64),
            verifierVersion: "verifier-v1",
            verifiedAt: at,
          },
        ],
      },
      {
        ...baselineInput,
        evidenceHashes: [
          ...baselineInput.evidenceHashes,
          alternateEvidenceHash,
        ],
      },
      {
        ...baselineInput,
        evidenceHashes: [
          ...baselineInput.evidenceHashes,
          alternateEvidenceHash,
        ],
        mediaSelection: [
          ...baselineInput.mediaSelection,
          {
            kind: "derivative",
            artifactId: "10000000-0000-4000-8000-000000000024",
            parentArtifactId: ids.artifactId,
            contentHash: alternateEvidenceHash,
            transformation: "annotation",
          },
        ],
      },
    ];

    for (const variant of variants) {
      expect(createModuleSnapshot(variant).canonicalHash).not.toBe(
        baselineHash,
      );
    }
  });
});

describe("exact-snapshot professional transitions", () => {
  it("rejects stale revisions and approves only the exact current snapshot", () => {
    const initial = createInitialModuleState({
      organizationId: ids.organizationId,
      jobId: ids.jobId,
      moduleId: ids.buildingModuleId,
      module: "building",
    });
    const snapshot = createModuleSnapshot(buildingSnapshotInput(1));
    const withSnapshot = registerModuleSnapshot(initial, snapshot, 0);

    expect(() =>
      registerModuleSnapshot(withSnapshot, snapshot, 0),
    ).toThrowError(DomainConflictError);
    expect(() =>
      approveModule(withSnapshot, {
        expectedRevision: 1,
        approvalId: "10000000-0000-4000-8000-000000000008",
        snapshotId: snapshot.snapshotId,
        snapshotHash: "f".repeat(64),
        inspectorId: ids.inspectorId,
        approvedAt: at,
      }),
    ).toThrowError(DomainConflictError);

    const approved = approveModule(withSnapshot, {
      expectedRevision: 1,
      approvalId: "10000000-0000-4000-8000-000000000008",
      snapshotId: snapshot.snapshotId,
      snapshotHash: snapshot.canonicalHash,
      inspectorId: ids.inspectorId,
      approvedAt: at,
    });

    expect(approved.status).toBe("approved");
    expect(approved.approvals).toHaveLength(1);
    expect(approved.currentApprovalId).toBe(
      "10000000-0000-4000-8000-000000000008",
    );
  });

  it("keeps one approved module intact when the other module is incomplete", () => {
    const building = approvedBuildingState();
    const pest = createInitialModuleState({
      organizationId: ids.organizationId,
      jobId: ids.jobId,
      moduleId: ids.pestModuleId,
      module: "timber_pest",
    });
    const pending = createInitialDeliveryPackage({
      packageId: "10000000-0000-4000-8000-000000000009",
      organizationId: ids.organizationId,
      jobId: ids.jobId,
      commissionedModules: ["building", "timber_pest"],
    });

    expect(() =>
      confirmDeliveryPackage(pending, 0, [building, pest], at),
    ).toThrowError(DomainConflictError);
    expect(building.status).toBe("approved");
    expect(pending.status).toBe("pending");
  });

  it("freezes the exact commissioned snapshot set and rejects extra or mixed module versions", () => {
    const building = approvedBuildingState();
    const pest = approvedPestState();
    const pending = createInitialDeliveryPackage({
      packageId: "10000000-0000-4000-8000-000000000010",
      organizationId: ids.organizationId,
      jobId: ids.jobId,
      commissionedModules: ["building", "timber_pest"],
    });
    const confirmed = confirmDeliveryPackage(pending, 0, [building, pest], at);

    expect(confirmed.status).toBe("confirmed");
    if (confirmed.status === "confirmed") {
      expect(confirmed.moduleSnapshots.map(({ module }) => module)).toEqual([
        "building",
        "timber_pest",
      ]);
      expect(confirmed.moduleSnapshots[0]?.snapshotHash).toBe(
        building.snapshots[0]?.canonicalHash,
      );
    }

    expect(() =>
      confirmDeliveryPackage(pending, 0, [building, pest, pest], at),
    ).toThrowError(DomainConflictError);
  });

  it("preserves history through withdrawal, cancels delivery, and marks lost-device evidence at risk", () => {
    const building = approvedBuildingState();
    const packageState = confirmDeliveryPackage(
      createInitialDeliveryPackage({
        packageId: "10000000-0000-4000-8000-000000000011",
        organizationId: ids.organizationId,
        jobId: ids.jobId,
        commissionedModules: ["building"],
      }),
      0,
      [building],
      at,
    );
    const withdrawn = withdrawModule(building, {
      expectedRevision: building.revision,
      reason: "Material error identified before send.",
      withdrawnByInspectorId: ids.inspectorId,
      withdrawnAt: at,
    });
    const cancelled = cancelDeliveryPackage(
      packageState,
      packageState.revision,
      "module_withdrawn",
      at,
    );
    const atRisk = markEvidenceAtRisk(approvedBuildingState(), {
      expectedRevision: 2,
      artifactIds: [ids.artifactId],
      reason: "device_lost_before_server_durability",
      recordedAt: at,
    });

    expect(withdrawn.status).toBe("withdrawn");
    expect(withdrawn.snapshots).toHaveLength(1);
    expect(withdrawn.approvals).toHaveLength(1);
    expect(cancelled.status).toBe("cancelled");
    expect(atRisk.status).toBe("evidence_at_risk");
    expect(atRisk.currentApprovalId).toBeNull();
  });

  it("creates an amendment snapshot without rewriting the prior approved version", () => {
    const approved = approvedBuildingState();
    const replacement = createModuleSnapshot({
      ...buildingSnapshotInput(2),
      conclusion: {
        ...buildingSnapshotInput(2).conclusion,
        summary: "Amended conclusion with corrected caption context.",
      },
    });
    const amended = amendModule(approved, {
      expectedRevision: approved.revision,
      amendmentId: "10000000-0000-4000-8000-000000000018",
      reason: "Correct the finding caption context.",
      amendedByInspectorId: ids.inspectorId,
      amendedAt: at,
      replacementSnapshot: replacement,
    });

    expect(amended.status).toBe("draft");
    expect(amended.snapshots).toHaveLength(2);
    expect(amended.snapshots[0]?.snapshotId).toBe(
      approved.snapshots[0]?.snapshotId,
    );
    expect(amended.approvals).toEqual(approved.approvals);
    expect(amended.currentApprovalId).toBeNull();
    expect(amended.amendments[0]?.priorSnapshotId).toBe(
      approved.currentSnapshotId,
    );
  });
});

describe("revocation and deletion suppression", () => {
  it("revokes a recipient capability exactly once using expected revision", () => {
    const grant = createRecipientGrant({
      grantId: "10000000-0000-4000-8000-000000000012",
      organizationId: ids.organizationId,
      jobId: ids.jobId,
      principalId: ids.recipientId,
      reportVersionId: "10000000-0000-4000-8000-000000000013",
      permittedModules: ["building"],
      permittedActions: ["read_report", "download_pdf"],
      issuedBy: ids.inspectorId,
      issuedAt: at,
      expiresAt: "2026-07-21T06:30:00.000Z",
    });
    const revoked = revokeRecipientGrant(
      grant,
      0,
      ids.inspectorId,
      "Recipient changed",
      at,
    );

    expect(revoked.status).toBe("revoked");
    expect(() =>
      revokeRecipientGrant(revoked, 0, ids.inspectorId, "Replay", at),
    ).toThrowError(DomainConflictError);
  });

  it("suppresses physical deletion while retained professional references exist", () => {
    const record = createLifecycleRecord({
      lifecycleId: "10000000-0000-4000-8000-000000000014",
      organizationId: ids.organizationId,
      resourceType: "artifact",
      resourceId: ids.artifactId,
      recordedAt: at,
    });
    const suppressed = suppressDeletion(record, 0, {
      reason: "retained_professional_reference",
      referenceIds: ["10000000-0000-4000-8000-000000000015"],
      recordedAt: at,
    });

    expect(suppressed.status).toBe("deletion_suppressed");
    if (suppressed.status === "deletion_suppressed") {
      expect(suppressed.suppression.referenceIds).toHaveLength(1);
    }
  });
});

describe("tamper-evident event continuity", () => {
  it("accepts a canonical chain and detects mutation, gaps, and reordering", () => {
    const first = createEventEnvelope(
      eventDraft(1, "inspection.started"),
      null,
    );
    const second = createEventEnvelope(
      eventDraft(2, "system.compaction_recorded"),
      first,
    );
    const third = createEventEnvelope(
      eventDraft(3, "approval.module_approved"),
      second,
    );

    expect(verifyEventChain([first, second, third])).toBe(true);
    expect(() => verifyEventChain([first, third])).toThrowError(
      EventIntegrityError,
    );
    expect(() => verifyEventChain([second, first, third])).toThrowError(
      EventIntegrityError,
    );
    expect(() =>
      verifyEventChain([
        { ...first, safeMetadata: { changed: true } },
        second,
        third,
      ]),
    ).toThrowError(EventIntegrityError);
    expect([first, second, third]).toHaveLength(3);
  });
});

describe("versioned-command idempotency", () => {
  it("accepts one command, returns identical retries as no-ops, and rejects key reuse with another payload", () => {
    const ledger = createIdempotencyLedger();
    const command = approvalCommand("f".repeat(64));
    const accepted = registerVersionedCommand(ledger, command);
    const replayed = registerVersionedCommand(accepted.ledger, command);

    expect(accepted.outcome).toBe("accepted");
    expect(replayed.outcome).toBe("replay");
    expect(replayed.ledger).toBe(accepted.ledger);
    expect(accepted.ledger.records).toHaveLength(1);
    expect(() =>
      registerVersionedCommand(
        accepted.ledger,
        approvalCommand("e".repeat(64)),
      ),
    ).toThrowError(DomainConflictError);
  });
});

function eventDraft(version: number, eventType: string) {
  return {
    schemaVersion: 1 as const,
    eventId: `20000000-0000-4000-8000-${version.toString().padStart(12, "0")}`,
    eventType,
    organizationId: ids.organizationId,
    aggregate: { type: "inspection_module", id: ids.buildingModuleId },
    aggregateVersion: version,
    sessionId: "20000000-0000-4000-8000-000000000010",
    actor: { type: "system" as const, id: null },
    clientOccurredAt: null,
    serverRecordedAt: at,
    idempotencyKey: `event-${version}`,
    safeMetadata: { version },
    protectedArtifactReferences: [],
    correlationId: "20000000-0000-4000-8000-000000000011",
    causationId: null,
  };
}

function approvalCommand(snapshotHash: string) {
  return {
    schemaVersion: 1 as const,
    type: "module.approve.v1" as const,
    commandId: "20000000-0000-4000-8000-000000000012",
    organizationId: ids.organizationId,
    aggregateId: ids.buildingModuleId,
    actor: { type: "inspector" as const, id: ids.inspectorId },
    expectedRevision: 1,
    idempotencyKey: "approve-building-snapshot-1",
    occurredAt: at,
    payload: {
      snapshotId: "20000000-0000-4000-8000-000000000013",
      snapshotHash,
    },
  };
}

function approvedBuildingState() {
  const initial = createInitialModuleState({
    organizationId: ids.organizationId,
    jobId: ids.jobId,
    moduleId: ids.buildingModuleId,
    module: "building",
  });
  const snapshot = createModuleSnapshot(buildingSnapshotInput(1));
  const withSnapshot = registerModuleSnapshot(initial, snapshot, 0);
  return approveModule(withSnapshot, {
    expectedRevision: 1,
    approvalId: "10000000-0000-4000-8000-000000000016",
    snapshotId: snapshot.snapshotId,
    snapshotHash: snapshot.canonicalHash,
    inspectorId: ids.inspectorId,
    approvedAt: at,
  });
}

function approvedPestState() {
  const initial = createInitialModuleState({
    organizationId: ids.organizationId,
    jobId: ids.jobId,
    moduleId: ids.pestModuleId,
    module: "timber_pest",
  });
  const snapshot = createModuleSnapshot(pestSnapshotInput(1));
  const withSnapshot = registerModuleSnapshot(initial, snapshot, 0);
  return approveModule(withSnapshot, {
    expectedRevision: 1,
    approvalId: "10000000-0000-4000-8000-000000000017",
    snapshotId: snapshot.snapshotId,
    snapshotHash: snapshot.canonicalHash,
    inspectorId: ids.inspectorId,
    approvedAt: at,
  });
}

function buildingSnapshotInput(revision: number): BuildingModuleSnapshotInput {
  return {
    snapshotId: `30000000-0000-4000-8000-${revision.toString().padStart(12, "0")}`,
    organizationId: ids.organizationId,
    jobId: ids.jobId,
    moduleId: ids.buildingModuleId,
    module: "building",
    revision,
    createdAt: at,
    inspector: {
      inspectorId: ids.inspectorId,
      displayName: "Licensed Inspector",
      credentialVersion: "qld-building-v1",
      confirmedAt: at,
    },
    requirementVersion: "building-requirements-v1",
    templateVersion: "building-template-v1",
    findings: [
      {
        status: "confirmed",
        findingId: "30000000-0000-4000-8000-000000000020",
        versionId: "30000000-0000-4000-8000-000000000021",
        organizationId: ids.organizationId,
        jobId: ids.jobId,
        moduleId: ids.buildingModuleId,
        contentHash: "b".repeat(64),
        content: {
          module: "building",
          location: "Second floor / Main bathroom",
          observation: "Cracking is visible in several tiles.",
          apparentExtent: "Shower base and main floor area.",
          qualifiedOpinion:
            "Movement in the supporting floor may have contributed.",
          uncertainty: ["Concealed construction was not visually confirmed."],
          furtherInvestigation:
            "Engage a suitably licensed and qualified builder or tiler to investigate.",
          classification: "major_defect",
        },
        authorship: {
          origin: "human",
          sourceArtifactReferences: [artifactReference],
          transcriptSpanReferences: [],
        },
        inspectorAttribution: {
          inspectorId: ids.inspectorId,
          displayName: "Licensed Inspector",
          credentialVersion: "qld-building-v1",
          confirmedAt: at,
        },
        verifier: { status: "not_required", reason: "human_authored" },
      },
    ],
    coverage: [],
    limitations: [],
    conclusion: {
      module: "building",
      summary: "A major defect was identified.",
      majorDefectCount: 1,
      minorDefectCount: 0,
    },
    verifierResults: [],
    evidenceHashes: [artifactReference.contentHash],
    mediaSelection: [artifactReference],
  };
}

function pestSnapshotInput(revision: number): TimberPestModuleSnapshotInput {
  return {
    snapshotId: `40000000-0000-4000-8000-${revision.toString().padStart(12, "0")}`,
    organizationId: ids.organizationId,
    jobId: ids.jobId,
    moduleId: ids.pestModuleId,
    module: "timber_pest",
    revision,
    createdAt: at,
    inspector: {
      inspectorId: ids.inspectorId,
      displayName: "Licensed Inspector",
      credentialVersion: "qld-pest-v1",
      confirmedAt: at,
    },
    requirementVersion: "timber-pest-requirements-v1",
    templateVersion: "timber-pest-template-v1",
    findings: [],
    coverage: [],
    limitations: [],
    conclusion: {
      module: "timber_pest",
      summary:
        "No visible evidence was observed in accessible inspected areas at the inspection time.",
      visibleEvidenceObserved: false,
      categoriesObserved: [],
    },
    verifierResults: [],
    evidenceHashes: [artifactReference.contentHash],
    mediaSelection: [artifactReference],
  };
}
