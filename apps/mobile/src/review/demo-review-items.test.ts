import { describe, expect, it } from "vitest";

import { projectCompletion } from "../completion/completion-state.js";
import { acceptReviewItem } from "./investigation-review.js";
import { createSyntheticReviewItems } from "./demo-review-items.js";

describe("synthetic field review integration", () => {
  it("starts with separate exact-version Building and Timber Pest suggestions", () => {
    const items = createSyntheticReviewItems();
    expect(items.map((item) => item.module)).toEqual([
      "building",
      "timber_pest",
    ]);
    expect(
      items.every(
        (item) =>
          item.finding.authorship.origin === "ai" &&
          item.finding.verifier.status === "passed" &&
          item.finding.verifier.draftVersionId === item.finding.versionId &&
          item.finding.verifier.contentHash === item.finding.contentHash,
      ),
    ).toBe(true);
    expect(items[1]?.finding.content).toMatchObject({
      module: "timber_pest",
      category: "no_visible_evidence",
    });
    expect(items[1]?.finding.content.observation).toContain(
      "accessible areas inspected at the inspection time",
    );
  });

  it("requires separate current approvals before package confirmation", () => {
    const [building, pest] = createSyntheticReviewItems().map(acceptReviewItem);
    const beforeApproval = projectCompletion({
      commissionedModules: ["building", "timber_pest"],
      aiAvailable: true,
      modules: [
        moduleState("building", building?.status === "accepted", false),
        moduleState("timber_pest", pest?.status === "accepted", false),
      ],
    });
    expect(beforeApproval.canConfirmPackage).toBe(false);

    const approved = projectCompletion({
      commissionedModules: ["building", "timber_pest"],
      aiAvailable: true,
      modules: [
        moduleState("building", building?.status === "accepted", true),
        moduleState("timber_pest", pest?.status === "accepted", true),
      ],
    });
    expect(approved.canConfirmPackage).toBe(true);
  });
});

function moduleState(
  module: "building" | "timber_pest",
  reviewComplete: boolean,
  approved: boolean,
) {
  return {
    module,
    label:
      module === "building" ? ("Building" as const) : ("Timber Pest" as const),
    reviewComplete,
    approvalState: approved ? ("approved" as const) : ("ready" as const),
    snapshotRevision: 1,
    approvalSnapshotRevision: approved ? 1 : null,
    unresolvedChecks: 0,
  };
}
