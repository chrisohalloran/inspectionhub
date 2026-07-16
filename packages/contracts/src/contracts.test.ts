import { describe, expect, it } from "vitest";

import {
  ArtifactReferenceSchema,
  BuildingConfirmedFindingSchema,
  BuildingModuleSnapshotInputSchema,
  CommandEnvelopeSchema,
  CoverageEntrySchema,
  EventEnvelopeV1Schema,
  OriginalArtifactSchema,
  TimberPestConfirmedFindingSchema,
} from "./index.js";

const ids = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  jobId: "00000000-0000-4000-8000-000000000002",
  buildingModuleId: "00000000-0000-4000-8000-000000000003",
  pestModuleId: "00000000-0000-4000-8000-000000000004",
  artifactId: "00000000-0000-4000-8000-000000000005",
  buildingFindingId: "00000000-0000-4000-8000-000000000006",
  pestFindingId: "00000000-0000-4000-8000-000000000007",
  inspectorId: "00000000-0000-4000-8000-000000000008",
  snapshotId: "00000000-0000-4000-8000-000000000009",
};

const sha = "a".repeat(64);
const timestamp = "2026-07-14T06:00:00.000Z";

const originalReference = {
  kind: "original" as const,
  artifactId: ids.artifactId,
  contentHash: sha,
};

const inspectorAttribution = {
  inspectorId: ids.inspectorId,
  displayName: "Licensed Inspector",
  credentialVersion: "qld-completed-residential-v1",
  confirmedAt: timestamp,
};

const humanProvenance = {
  origin: "human" as const,
  sourceArtifactReferences: [originalReference],
  transcriptSpanReferences: [],
};

const buildingFinding = {
  status: "confirmed" as const,
  findingId: ids.buildingFindingId,
  versionId: "00000000-0000-4000-8000-000000000010",
  organizationId: ids.organizationId,
  jobId: ids.jobId,
  moduleId: ids.buildingModuleId,
  contentHash: "b".repeat(64),
  content: {
    module: "building" as const,
    location: "Second floor / Main bathroom",
    observation: "Cracking is visible in several floor and shower-base tiles.",
    apparentExtent: "Several tiles across the shower base and main floor area.",
    qualifiedOpinion:
      "Movement in the supporting floor assembly may have contributed.",
    uncertainty: ["The concealed construction was not visually confirmed."],
    furtherInvestigation:
      "Engage a suitably licensed and qualified builder or tiler to investigate.",
    classification: "major_defect" as const,
  },
  authorship: humanProvenance,
  inspectorAttribution,
  verifier: {
    status: "not_required" as const,
    reason: "human_authored" as const,
  },
};

const pestFinding = {
  status: "confirmed" as const,
  findingId: ids.pestFindingId,
  versionId: "00000000-0000-4000-8000-000000000011",
  organizationId: ids.organizationId,
  jobId: ids.jobId,
  moduleId: ids.pestModuleId,
  contentHash: "c".repeat(64),
  content: {
    module: "timber_pest" as const,
    location: "Subfloor / Bearer 2",
    observation: "Surface damage is visible to the timber member.",
    apparentExtent: "Visible on the photographed face only.",
    qualifiedOpinion:
      "The observed condition requires timber-pest-specific investigation.",
    uncertainty: ["Concealed faces were not accessible."],
    furtherInvestigation:
      "Undertake further inspection of the member and adjacent accessible timbers.",
    category: "timber_damage" as const,
  },
  authorship: humanProvenance,
  inspectorAttribution,
  verifier: {
    status: "not_required" as const,
    reason: "human_authored" as const,
  },
};

describe("artifact contracts", () => {
  it("keeps capture identity distinct when two genuine captures contain identical bytes", () => {
    const common = {
      kind: "original" as const,
      organizationId: ids.organizationId,
      jobId: ids.jobId,
      contentHash: sha,
      mediaType: "image/jpeg" as const,
      byteLength: 2048,
      capturedAt: timestamp,
      captureAreaId: "00000000-0000-4000-8000-000000000012",
      deviceId: "00000000-0000-4000-8000-000000000013",
      sequence: 1,
    };

    const first = OriginalArtifactSchema.parse({
      ...common,
      artifactId: ids.artifactId,
      captureId: "00000000-0000-4000-8000-000000000014",
    });
    const second = OriginalArtifactSchema.parse({
      ...common,
      artifactId: "00000000-0000-4000-8000-000000000015",
      captureId: "00000000-0000-4000-8000-000000000016",
      sequence: 2,
    });

    expect(first.contentHash).toBe(second.contentHash);
    expect(first.captureId).not.toBe(second.captureId);
    expect(first.artifactId).not.toBe(second.artifactId);
  });

  it("allows one immutable original reference in separate Building and Timber Pest findings", () => {
    expect(ArtifactReferenceSchema.parse(originalReference)).toEqual(
      originalReference,
    );
    expect(
      BuildingConfirmedFindingSchema.parse(buildingFinding).authorship
        .sourceArtifactReferences[0],
    ).toEqual(originalReference);
    expect(
      TimberPestConfirmedFindingSchema.parse(pestFinding).authorship
        .sourceArtifactReferences[0],
    ).toEqual(originalReference);
  });
});

describe("professional module contracts", () => {
  it("rejects Timber Pest taxonomy in a Building finding", () => {
    expect(() =>
      BuildingConfirmedFindingSchema.parse({
        ...buildingFinding,
        content: {
          ...buildingFinding.content,
          classification: undefined,
          category: "visible_evidence",
        },
      }),
    ).toThrow();
  });

  it("requires an explicit limitation when access is limited", () => {
    expect(() =>
      CoverageEntrySchema.parse({
        coverageEntryId: "00000000-0000-4000-8000-000000000017",
        module: "building",
        moduleId: ids.buildingModuleId,
        areaId: "00000000-0000-4000-8000-000000000018",
        state: "inaccessible",
        recordedAt: timestamp,
        recordedByInspectorId: ids.inspectorId,
      }),
    ).toThrow();
  });

  it("does not accept provisional or verifier-rejected text in a module snapshot", () => {
    const invalidFinding = {
      ...buildingFinding,
      status: "provisional",
      inspectorAttribution: undefined,
      verifier: {
        status: "rejected",
        draftVersionId: buildingFinding.versionId,
        contentHash: buildingFinding.contentHash,
        reasons: ["Unsupported factual addition"],
        verifiedAt: timestamp,
      },
    };

    expect(() =>
      BuildingModuleSnapshotInputSchema.parse(snapshotInput([invalidFinding])),
    ).toThrow();
  });
});

describe("versioned envelopes", () => {
  it("parses strict expected-revision commands and rejects unknown fields", () => {
    const command = {
      schemaVersion: 1 as const,
      type: "module.approve.v1" as const,
      commandId: "00000000-0000-4000-8000-000000000019",
      organizationId: ids.organizationId,
      aggregateId: ids.buildingModuleId,
      actor: { type: "inspector" as const, id: ids.inspectorId },
      expectedRevision: 3,
      idempotencyKey: "approve-building-3",
      occurredAt: timestamp,
      payload: {
        snapshotId: ids.snapshotId,
        snapshotHash: "d".repeat(64),
      },
    };

    expect(CommandEnvelopeSchema.parse(command).expectedRevision).toBe(3);
    expect(() =>
      CommandEnvelopeSchema.parse({ ...command, approveAndSend: true }),
    ).toThrow();
  });

  it("requires a tamper-evident event envelope with protected references separate from safe metadata", () => {
    const event = {
      schemaVersion: 1 as const,
      eventId: "00000000-0000-4000-8000-000000000020",
      eventType: "approval.module_approved",
      organizationId: ids.organizationId,
      aggregate: { type: "inspection_module", id: ids.buildingModuleId },
      aggregateVersion: 4,
      sessionId: "00000000-0000-4000-8000-000000000021",
      actor: { type: "inspector" as const, id: ids.inspectorId },
      clientOccurredAt: timestamp,
      serverRecordedAt: timestamp,
      idempotencyKey: "approve-building-3",
      safeMetadata: { module: "building", snapshotRevision: 3 },
      protectedArtifactReferences: [originalReference],
      correlationId: "00000000-0000-4000-8000-000000000022",
      causationId: "00000000-0000-4000-8000-000000000019",
      payloadHash: "e".repeat(64),
      previousEventHash: "f".repeat(64),
      eventHash: "1".repeat(64),
    };

    expect(EventEnvelopeV1Schema.parse(event).eventType).toBe(
      "approval.module_approved",
    );
    expect(() =>
      EventEnvelopeV1Schema.parse({ ...event, reportText: "sensitive" }),
    ).toThrow();
  });
});

function snapshotInput(findings: readonly unknown[]) {
  return {
    snapshotId: ids.snapshotId,
    organizationId: ids.organizationId,
    jobId: ids.jobId,
    moduleId: ids.buildingModuleId,
    module: "building" as const,
    revision: 1,
    createdAt: timestamp,
    inspector: inspectorAttribution,
    requirementVersion: "building-requirements-v1",
    templateVersion: "building-report-v1",
    findings,
    coverage: [],
    limitations: [],
    conclusion: {
      module: "building" as const,
      summary: "A major defect was identified.",
      majorDefectCount: 1,
      minorDefectCount: 0,
    },
    verifierResults: [],
    evidenceHashes: [sha],
    mediaSelection: [originalReference],
  };
}
