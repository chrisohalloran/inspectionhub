import { describe, expect, it } from "vitest";

import {
  attachInvestigationEvidence,
  changeInvestigationArea,
  createCoverageLedger,
  finishInvestigation,
  recordAreaCoverage,
  recordInvestigationObservation,
  startInvestigation,
} from "@inspection/domain/inspection/mobile";

import {
  approvalSnapshotPayload,
  deliveryPackageManifestPayload,
} from "../completion/approval-binding";
import {
  createRecipientPackageSnapshot,
  projectRecipientOverview,
  verifyRecipientPackageSnapshot,
} from "../recipient/recipient-overview";
import { createFindingCandidateLinks } from "../investigations/field-actions";
import { acceptReviewItem } from "./investigation-review";
import {
  createSeededInvestigationReview,
  SEEDED_CRACKED_TILE_OBSERVATION_TEXT,
  SEEDED_CRACKED_TILE_SCENARIO_ID,
} from "./seeded-vertical-slice";

const at = "2026-07-17T10:00:00.000+10:00";
const ids = {
  photo: "71000000-0000-4000-8000-000000000001",
  voice: "71000000-0000-4000-8000-000000000002",
  organization: "71000000-0000-4000-8000-000000000003",
  job: "71000000-0000-4000-8000-000000000004",
  module: "71000000-0000-4000-8000-000000000005",
  investigation: "71000000-0000-4000-8000-000000000006",
  inspector: "71000000-0000-4000-8000-000000000007",
  observation: "71000000-0000-4000-8000-000000000008",
  candidate: "71000000-0000-4000-8000-000000000009",
  unrelatedObservation: "71000000-0000-4000-8000-000000000010",
};
const hashes = new Map([
  [ids.photo, "a".repeat(64)],
  [ids.voice, "b".repeat(64)],
]);

describe("seeded capture-to-recipient vertical slice", () => {
  it("preserves fresh photo and voice identity through packet, review, package and recipient overview", async () => {
    const investigation = completedInvestigation({
      addTrailingUnselectedObservation: true,
    });
    let nextId = 0;
    const drafted = await createSeededInvestigationReview({
      scenarioId: SEEDED_CRACKED_TILE_SCENARIO_ID,
      investigation,
      coverage: coverage(),
      artifactHash: (artifactId) => hashes.get(artifactId),
      areaLabel: () => "Second floor / Main bathroom",
      createdAt: at,
      digest,
      idFactory: () =>
        `72000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`,
    });

    expect(drafted.packet.evidence).toEqual([
      expect.objectContaining({
        artifactId: ids.photo,
        contentHash: "a".repeat(64),
        captureAreaId: "area-main-bathroom",
        currentAreaId: "area-main-bathroom",
      }),
      expect.objectContaining({
        artifactId: ids.voice,
        contentHash: "b".repeat(64),
        captureAreaId: "area-main-bathroom",
        currentAreaId: "area-main-bathroom",
      }),
    ]);
    expect(drafted.packet.scenarioId).toBe(SEEDED_CRACKED_TILE_SCENARIO_ID);
    expect(drafted.packet.observations).toEqual([
      expect.objectContaining({
        observationId: ids.observation,
        areaId: "area-main-bathroom",
        text: SEEDED_CRACKED_TILE_OBSERVATION_TEXT,
      }),
    ]);
    expect(drafted.reviewItems[0]?.finding.content.location).toBe(
      "Second floor / Main bathroom",
    );
    const review = acceptReviewItem(drafted.reviewItems[0]!);
    expect(review.provenance.packetHash).toBe(drafted.packet.canonicalHash);
    expect(review.finding.authorship.sourceArtifactReferences).toEqual([
      {
        kind: "original",
        artifactId: ids.photo,
        contentHash: "a".repeat(64),
      },
      {
        kind: "original",
        artifactId: ids.voice,
        contentHash: "b".repeat(64),
      },
    ]);
    const completedCoverage = coverage();
    const approvingInspector = {
      inspectorId: ids.inspector,
      displayName: "Licensed Queensland inspector",
      credential: "Completed residential building inspection licence",
      confirmedAt: at,
      authority: "synthetic_fixture" as const,
    };
    const binding = {
      approvingInspector,
      coverageRevision: 1,
      module: "building" as const,
      reviewVersions: [
        {
          contentHash: review.finding.contentHash,
          reviewId: review.reviewId,
          versionId: review.finding.versionId,
        },
      ],
      snapshotSha256: await digest(
        approvalSnapshotPayload({
          approvingInspector,
          coverage: completedCoverage,
          jobId: investigation.jobId,
          module: "building",
          reviewItems: [review],
        }),
      ),
    };
    const recipientPackage = await createRecipientPackageSnapshot({
      approvalBindings: [binding],
      commissionedModules: ["building"],
      coverage: completedCoverage,
      digest,
      issuedAt: at,
      jobId: investigation.jobId,
      organizationId: investigation.organizationId,
      propertyLabel: "12 Example Street (synthetic)",
      reportVersionId: "runtime-report-version",
      reviewItems: [review],
    });
    await expect(
      verifyRecipientPackageSnapshot(recipientPackage, digest),
    ).resolves.toBe(true);
    const overview = projectRecipientOverview({
      packageSnapshot: recipientPackage,
      reviewItems: [review],
    });
    const packageManifestSha256 = await digest(
      deliveryPackageManifestPayload({
        approvalBindings: [binding],
        commissionedModules: ["building"],
        jobId: investigation.jobId,
        recipientPackageHash: recipientPackage.canonicalHash,
        reviewItems: [review],
      }),
    );

    expect(packageManifestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(recipientPackage.modules[0]?.approvalSnapshotSha256).toBe(
      binding.snapshotSha256,
    );
    expect(overview.modules[0]?.findings[0]?.evidenceSourceCount).toBe(2);
    expect(overview.modules[0]?.materialLimitations).toEqual([
      {
        areaLabel: "Second floor / Main bathroom",
        description:
          "Shower base access was limited by fixed finishes during the visual inspection.",
        recordedAt: at,
      },
    ]);
    expect(JSON.stringify(overview)).not.toContain(ids.photo);
    expect(JSON.stringify(overview)).not.toContain(ids.voice);
  });

  it("fails closed when a candidate source hash is missing or selected wording is unrelated", async () => {
    await expect(
      createSeededInvestigationReview({
        scenarioId: SEEDED_CRACKED_TILE_SCENARIO_ID,
        investigation: completedInvestigation(),
        coverage: coverage(),
        artifactHash: () => undefined,
        areaLabel: () => "Second floor / Main bathroom",
        createdAt: at,
        digest,
        idFactory: () => "72000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow("no verified local content hash");

    await expect(
      createSeededInvestigationReview({
        scenarioId: SEEDED_CRACKED_TILE_SCENARIO_ID,
        investigation: completedInvestigation({
          observationText:
            "Minor cracking was observed in an external driveway slab.",
        }),
        coverage: coverage(),
        artifactHash: (artifactId) => hashes.get(artifactId),
        areaLabel: () => "Second floor / Main bathroom",
        createdAt: at,
        digest,
        idFactory: () => "72000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow(
      "Selected observation is not compatible with the cracked-tile synthetic scenario",
    );
  });

  it("requires the explicit immutable synthetic scenario identifier", async () => {
    await expect(
      createSeededInvestigationReview({
        scenarioId:
          "inspectionhub.synthetic.unrelated.v1" as typeof SEEDED_CRACKED_TILE_SCENARIO_ID,
        investigation: completedInvestigation(),
        coverage: coverage(),
        artifactHash: (artifactId) => hashes.get(artifactId),
        areaLabel: () => "Second floor / Main bathroom",
        createdAt: at,
        digest,
        idFactory: () => "72000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow("Unsupported deterministic synthetic scenario");
  });

  it("requires exact commissioned identities while allowing a candidate for one commissioned module", async () => {
    const investigation = completedInvestigation();
    const mismatchedCoverage = {
      ...coverage(),
      commissionedModules: [
        { module: "building" as const, moduleId: "substituted-module" },
      ],
    };
    await expect(
      createSeededInvestigationReview({
        scenarioId: SEEDED_CRACKED_TILE_SCENARIO_ID,
        investigation,
        coverage: mismatchedCoverage,
        artifactHash: (artifactId) => hashes.get(artifactId),
        areaLabel: () => "Second floor / Main bathroom",
        createdAt: at,
        digest,
        idFactory: () => "72000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow("exact commissioned module identities");

    const extraCommission = [
      ...investigation.commissionedModules,
      { module: "timber_pest" as const, moduleId: "module-timber-pest" },
    ];
    const drafted = await createSeededInvestigationReview({
      scenarioId: SEEDED_CRACKED_TILE_SCENARIO_ID,
      investigation: {
        ...investigation,
        commissionedModules: extraCommission,
      },
      coverage: { ...coverage(), commissionedModules: extraCommission },
      artifactHash: (artifactId) => hashes.get(artifactId),
      areaLabel: () => "Second floor / Main bathroom",
      createdAt: at,
      digest,
      idFactory: () => "72000000-0000-4000-8000-000000000001",
    });
    expect(drafted.packet.modules).toEqual(
      investigation.completion?.moduleLinks,
    );

    const completion = investigation.completion;
    if (completion === undefined || completion === null) {
      throw new Error("Completed fixture is missing its completion");
    }
    await expect(
      createSeededInvestigationReview({
        scenarioId: SEEDED_CRACKED_TILE_SCENARIO_ID,
        investigation: {
          ...investigation,
          completion: {
            ...completion,
            moduleLinks: completion.moduleLinks.map((link) => ({
              ...link,
              moduleId: "substituted-module",
            })),
          },
        },
        coverage: coverage(),
        artifactHash: (artifactId) => hashes.get(artifactId),
        areaLabel: () => "Second floor / Main bathroom",
        createdAt: at,
        digest,
        idFactory: () => "72000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow("exact commissioned module identities");
  });
});

function completedInvestigation(
  options: Readonly<{
    addTrailingUnselectedObservation?: boolean;
    observationText?: string;
  }> = {},
) {
  let investigation = startInvestigation({
    areaId: "area-main-bathroom",
    commissionedModules: [{ module: "building", moduleId: ids.module }],
    inspectorId: ids.inspector,
    investigationId: ids.investigation,
    jobId: ids.job,
    organizationId: ids.organization,
    startedAt: at,
  });
  investigation = attachInvestigationEvidence(investigation, {
    artifacts: [
      {
        artifactId: ids.photo,
        artifactKind: "photo",
        captureAreaId: "area-main-bathroom",
        capturedAt: at,
        captureSequence: 1,
        jobId: investigation.jobId,
      },
      {
        artifactId: ids.voice,
        artifactKind: "voice_note",
        captureAreaId: "area-main-bathroom",
        capturedAt: at,
        captureSequence: 2,
        jobId: investigation.jobId,
      },
    ],
    attachedAt: at,
    expectedRevision: investigation.revision,
    inspectorId: ids.inspector,
    source: "captured_during_investigation",
  });
  investigation = recordInvestigationObservation(investigation, {
    expectedRevision: investigation.revision,
    observation: {
      areaId: "area-main-bathroom",
      observationId: ids.observation,
      recordedAt: at,
      recordedByInspectorId: ids.inspector,
      text: options.observationText ?? SEEDED_CRACKED_TILE_OBSERVATION_TEXT,
    },
  });
  investigation = changeInvestigationArea(investigation, {
    areaId: "area-roof-void",
    enteredAt: at,
    expectedRevision: investigation.revision,
  });
  if (options.addTrailingUnselectedObservation === true) {
    investigation = recordInvestigationObservation(investigation, {
      expectedRevision: investigation.revision,
      observation: {
        areaId: "area-roof-void",
        observationId: ids.unrelatedObservation,
        recordedAt: at,
        recordedByInspectorId: ids.inspector,
        text: "The accessible roof void was inspected after the bathroom.",
      },
    });
  }
  const moduleLinks = createFindingCandidateLinks({
    idFactory: () => ids.candidate,
    investigation,
    moduleSelections: [
      {
        module: "building",
        sourceArtifactIds: [ids.photo, ids.voice],
        sourceObservationIds: [ids.observation],
      },
    ],
  });
  return finishInvestigation(investigation, {
    completedAt: at,
    draftingDisposition: "queue_ai_asynchronously",
    expectedRevision: investigation.revision,
    inspectorId: ids.inspector,
    moduleLinks,
    outcome: "finding_candidates",
  });
}

function coverage() {
  const ledger = createCoverageLedger({
    areas: [
      {
        applicableModules: ["building"],
        areaId: "area-main-bathroom",
        label: "Second floor / Main bathroom",
      },
      {
        applicableModules: ["building"],
        areaId: "area-roof-void",
        label: "Roof void",
      },
    ],
    commissionedModules: [{ module: "building", moduleId: ids.module }],
    jobId: ids.job,
    organizationId: ids.organization,
  });
  return recordAreaCoverage(ledger, {
    areaId: "area-main-bathroom",
    coverageEntryId: "coverage-main-bathroom-building",
    detail:
      "Shower base access was limited by fixed finishes during the visual inspection.",
    expectedRevision: ledger.revision,
    inspectorId: ids.inspector,
    limitationId: "limitation-main-bathroom-building",
    material: true,
    module: "building",
    recordedAt: at,
    state: "access_limited",
  });
}

async function digest(payload: string): Promise<string> {
  const bytes = new TextEncoder().encode(payload);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
