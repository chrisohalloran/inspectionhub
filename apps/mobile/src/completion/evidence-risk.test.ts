import { describe, expect, it } from "vitest";

import { acceptReviewItem } from "../review/investigation-review";
import { createSyntheticReviewItems } from "../review/demo-review-items";
import { initialFieldWorkflow } from "../storage/field-workflow";
import {
  findingCandidateAtRiskSourceIds,
  invalidateProfessionalStateForEvidenceRisk,
} from "./evidence-risk";

describe("evidence-at-risk professional invalidation", () => {
  it("identifies completed candidate sources that recovery must not regenerate", () => {
    expect(
      findingCandidateAtRiskSourceIds({
        captureIds: ["photo-missing", "unrelated-capture"],
        moduleLinks: [
          {
            findingCandidateId: "candidate-building",
            module: "building",
            moduleId: "module-building",
            sourceArtifactIds: ["photo-safe", "photo-missing"],
            sourceObservationIds: ["observation-building"],
          },
        ],
      }),
    ).toEqual(["photo-missing"]);
  });

  it("stales the dependent module and clears package authority", () => {
    const accepted = createSyntheticReviewItems().map(acceptReviewItem);
    const workflow = {
      ...initialFieldWorkflow(accepted),
      approvedModules: ["building", "timber_pest"] as const,
      deliveryState: "queued" as const,
      moduleApprovalBindings: accepted.map((item, index) => ({
        approvingInspector: {
          inspectorId: `inspector-${item.module}`,
          displayName: "Synthetic inspector",
          credential: "Synthetic fixture credential",
          confirmedAt: "2026-07-17T06:00:00.000Z",
          authority: "synthetic_fixture" as const,
        },
        coverageRevision: 1,
        module: item.module,
        reviewVersions: [
          {
            contentHash: item.finding.contentHash,
            reviewId: item.reviewId,
            versionId: item.finding.versionId,
          },
        ],
        snapshotSha256: (index === 0 ? "a" : "b").repeat(64),
      })),
      packageManifestSha256: "c".repeat(64),
      recipientPackage: null,
    };
    const riskyId =
      accepted[0]!.finding.authorship.sourceArtifactReferences[0]!.artifactId;

    const invalidated = invalidateProfessionalStateForEvidenceRisk({
      captureIds: [riskyId],
      recordedAt: "2026-07-17T06:00:00.000Z",
      workflow,
    });

    expect(invalidated).toMatchObject({
      approvedModules: ["timber_pest"],
      deliveryState: "waiting_for_approval",
      packageManifestSha256: null,
      recipientPackage: null,
    });
    expect(
      invalidated?.reviewItems.find((item) => item.module === "building"),
    ).toMatchObject({ status: "stale", supersededByVersionId: riskyId });
  });
});
