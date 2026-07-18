import { describe, expect, it } from "vitest";

import {
  attachInvestigationEvidence,
  finishInvestigation,
  recordInvestigationObservation,
  startInvestigation,
} from "@inspection/domain/inspection/mobile";

import { createFindingCandidateLinks } from "../investigations/field-actions";
import { acceptReviewItem, resolveReviewCheck } from "./investigation-review";
import { createManualInvestigationReview } from "./manual-review-draft";

const at = "2026-07-18T10:00:00.000+10:00";
const ids = {
  artifact: "81000000-0000-4000-8000-000000000001",
  candidate: "81000000-0000-4000-8000-000000000002",
  investigation: "81000000-0000-4000-8000-000000000003",
  job: "81000000-0000-4000-8000-000000000004",
  module: "81000000-0000-4000-8000-000000000005",
  observation: "81000000-0000-4000-8000-000000000006",
  organization: "81000000-0000-4000-8000-000000000007",
  inspector: "81000000-0000-4000-8000-000000000008",
};

describe("manual investigation review drafting", () => {
  it("opens an inspector-authored draft from exact selected evidence without AI", async () => {
    const [draft] = await createManualInvestigationReview({
      investigation: completedInvestigation(),
      artifactHash: (artifactId) =>
        artifactId === ids.artifact ? "a".repeat(64) : undefined,
      areaLabel: () => "Second floor / Main bathroom",
      digest,
      idFactory: incrementingId(),
    });

    expect(draft).toMatchObject({
      module: "building",
      status: "awaiting_decision",
      finding: {
        findingId: ids.candidate,
        content: {
          location: "Second floor / Main bathroom",
          observation: "Cracking is visible through several bathroom tiles.",
        },
        authorship: {
          origin: "human",
          sourceArtifactReferences: [
            { artifactId: ids.artifact, contentHash: "a".repeat(64) },
          ],
        },
        verifier: { status: "not_required", reason: "human_authored" },
      },
    });
    const blockingCheck = draft?.checks[0];
    expect(blockingCheck).toMatchObject({
      code: "manual_finding_details_required",
      severity: "blocking",
      state: "open",
    });
    expect(() => acceptReviewItem(draft!)).toThrow("blocking");
    expect(
      acceptReviewItem(resolveReviewCheck(draft!, blockingCheck!.checkId))
        .decisionMode,
    ).toBe("human_authored");
  });

  it("fails closed when selected evidence has no durable identity", async () => {
    await expect(
      createManualInvestigationReview({
        investigation: completedInvestigation(),
        artifactHash: () => undefined,
        areaLabel: () => "Second floor / Main bathroom",
        digest,
        idFactory: incrementingId(),
      }),
    ).rejects.toThrow("no verified local content hash");
  });
});

function completedInvestigation() {
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
        artifactId: ids.artifact,
        artifactKind: "photo",
        captureAreaId: "area-main-bathroom",
        capturedAt: at,
        captureSequence: 1,
        jobId: ids.job,
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
      text: "Cracking is visible through several bathroom tiles.",
    },
  });
  const moduleLinks = createFindingCandidateLinks({
    idFactory: () => ids.candidate,
    investigation,
    moduleSelections: [
      {
        module: "building",
        sourceArtifactIds: [ids.artifact],
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

function digest(payload: string): Promise<string> {
  void payload;
  return Promise.resolve("b".repeat(64));
}

function incrementingId(): () => string {
  let value = 0;
  return () => `82000000-0000-4000-8000-${String(++value).padStart(12, "0")}`;
}
