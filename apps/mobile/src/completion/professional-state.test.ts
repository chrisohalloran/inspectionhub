import { describe, expect, it } from "vitest";

import { acceptReviewItem } from "../review/investigation-review.js";
import { createSyntheticReviewItems } from "../review/demo-review-items.js";
import { initialFieldWorkflow } from "../storage/field-workflow.js";
import {
  invalidateProfessionalModulesForCandidates,
  reconcileProfessionalModulesForCandidates,
} from "./professional-state.js";

describe("professional module invalidation", () => {
  it("invalidates only the module affected by a new candidate", () => {
    const [building, timberPest] = createSyntheticReviewItems().map((item) =>
      acceptReviewItem(item),
    );
    const workflow = {
      ...initialFieldWorkflow([building!, timberPest!]),
      approvedModules: ["building", "timber_pest"] as const,
      deliveryState: "queued" as const,
      moduleApprovalBindings: [
        binding("building", building!.reviewId),
        binding("timber_pest", timberPest!.reviewId),
      ],
      packageManifestSha256: "f".repeat(64),
    };

    const next = invalidateProfessionalModulesForCandidates({
      candidates: [
        {
          findingCandidateId: "53000000-0000-4000-8000-000000000001",
          module: "building",
        },
      ],
      investigationId: "investigation-new-building",
      recordedAt: "2026-07-17T02:00:00.000Z",
      workflow,
    });

    expect(next.approvedModules).toEqual(["timber_pest"]);
    expect(next.moduleApprovalBindings.map((item) => item.module)).toEqual([
      "timber_pest",
    ]);
    expect(
      next.reviewItems.find((item) => item.module === "building"),
    ).toMatchObject({
      status: "stale",
      supersededByVersionId: "53000000-0000-4000-8000-000000000001",
    });
    expect(
      next.reviewItems.find((item) => item.module === "timber_pest"),
    ).toEqual(timberPest);
    expect(next.deliveryState).toBe("waiting_for_approval");
    expect(next.packageManifestSha256).toBeNull();
    expect(next.processedFindingCandidateIds).toEqual([
      "53000000-0000-4000-8000-000000000001",
    ]);
    expect(
      reconcileProfessionalModulesForCandidates({
        candidates: [
          {
            findingCandidateId: "53000000-0000-4000-8000-000000000001",
            module: "building",
          },
        ],
        investigationId: "investigation-new-building",
        recordedAt: "2026-07-17T02:00:00.000Z",
        workflow: { ...workflow, ...next },
      }),
    ).toBeUndefined();

    const generatedForCandidate = {
      ...building!,
      investigationId: "investigation-new-building",
      status: "awaiting_decision" as const,
      decisionMode: null,
    };
    expect(
      reconcileProfessionalModulesForCandidates({
        candidates: [
          {
            findingCandidateId: "53000000-0000-4000-8000-000000000001",
            module: "building",
          },
        ],
        investigationId: "investigation-new-building",
        recordedAt: "2026-07-17T03:00:00.000Z",
        workflow: {
          ...workflow,
          ...next,
          reviewItems: [generatedForCandidate, timberPest!],
        },
      }),
    ).toBeUndefined();
  });
});

function binding(module: "building" | "timber_pest", reviewId: string) {
  return {
    coverageRevision: 4,
    module,
    reviewVersions: [
      {
        contentHash: "a".repeat(64),
        reviewId,
        versionId: `version-${module}`,
      },
    ],
    snapshotSha256: "b".repeat(64),
  };
}
