import { describe, expect, it } from "vitest";

import {
  cloneFieldWorkflow,
  initialFieldWorkflow,
  parseFieldWorkflow,
  reconcileDurableProfessionalState,
  reconcileFieldSessionInvestigation,
  reconcileInvestigationStatus,
} from "./field-workflow.js";
import {
  startInvestigation,
  finishInvestigation,
} from "@inspection/domain/inspection/mobile";
import { acceptReviewItem } from "../review/investigation-review.js";
import { createSyntheticReviewItems } from "../review/demo-review-items.js";

describe("protected field workflow snapshot", () => {
  it("reconciles a stale session area and clears a completed active pointer after restart", () => {
    const workflow = initialFieldWorkflow([], "2026-07-16T00:00:00.000Z");
    const session = {
      activeInvestigationId: "investigation-1",
      areaId: "area-bathroom",
      cachedAssignedJobIds: ["job-1"],
      commissionedModules: [
        { module: "building" as const, moduleId: "module-1" },
      ],
      deviceId: "device-1",
      deviceState: "enrolled" as const,
      jobId: "job-1",
      nextSequence: 1,
      organizationId: "organization-1",
      session: "valid" as const,
      updatedAt: "2026-07-16T00:00:00.000Z",
      workflow,
    };
    const active = startInvestigation({
      areaId: "area-roof",
      commissionedModules: [{ module: "building", moduleId: "module-1" }],
      inspectorId: "inspector-1",
      investigationId: "investigation-1",
      jobId: "job-1",
      organizationId: "organization-1",
      startedAt: "2026-07-16T00:00:00.000Z",
    });
    const reconciled = reconcileFieldSessionInvestigation(
      session,
      active,
      "2026-07-16T01:00:00.000Z",
    );
    expect(reconciled).toMatchObject({
      activeInvestigationId: "investigation-1",
      areaId: "area-roof",
    });

    const completed = finishInvestigation(active, {
      completedAt: "2026-07-16T01:30:00.000Z",
      draftingDisposition: "manual_only",
      expectedRevision: 0,
      inspectorId: "inspector-1",
      outcome: "no_reportable_finding",
    });
    const closed = reconcileFieldSessionInvestigation(
      reconciled,
      completed,
      "2026-07-16T02:00:00.000Z",
    );
    expect(closed.activeInvestigationId).toBeUndefined();
    expect(closed.lastInvestigationId).toBe("investigation-1");
    expect(closed.workflow).toEqual(reconciled.workflow);
  });

  it("does not rewrite an immutable workflow when durable status already agrees", () => {
    const workflow = initialFieldWorkflow([], "2026-07-16T00:00:00.000Z");

    expect(
      reconcileInvestigationStatus(
        workflow,
        "none",
        "2026-07-16T01:00:00.000Z",
      ),
    ).toBe(workflow);
  });

  it("appends an explicit reconciliation revision when durable status differs", () => {
    const workflow = initialFieldWorkflow([], "2026-07-16T00:00:00.000Z");

    expect(
      reconcileInvestigationStatus(
        workflow,
        "active",
        "2026-07-16T01:00:00.000Z",
      ),
    ).toMatchObject({
      investigationStatus: "active",
      lastTransition: "investigation_reconciled",
      revision: 2,
      updatedAt: "2026-07-16T01:00:00.000Z",
    });
  });

  it("repairs the session and workflow after the aggregate committed before session state", () => {
    const workflow = {
      ...initialFieldWorkflow([], "2026-07-16T00:00:00.000Z"),
      approvedModules: ["building"] as const,
      deliveryState: "queued" as const,
      moduleApprovalBindings: [approvalBinding("building", "a")],
      packageManifestSha256: "b".repeat(64),
    };
    const session = {
      areaId: "area-bathroom",
      cachedAssignedJobIds: ["job-1"],
      commissionedModules: [
        { module: "building" as const, moduleId: "module-1" },
      ],
      deviceId: "device-1",
      deviceState: "enrolled" as const,
      jobId: "job-1",
      nextSequence: 1,
      organizationId: "organization-1",
      session: "valid" as const,
      updatedAt: "2026-07-16T00:00:00.000Z",
      workflow,
    };
    const active = startInvestigation({
      areaId: "area-roof",
      commissionedModules: [{ module: "building", moduleId: "module-1" }],
      inspectorId: "inspector-1",
      investigationId: "investigation-1",
      jobId: "job-1",
      organizationId: "organization-1",
      startedAt: "2026-07-16T00:30:00.000Z",
    });

    const reconciled = reconcileDurableProfessionalState(
      session,
      active,
      "2026-07-16T01:00:00.000Z",
    );

    expect(reconciled.session).toMatchObject({
      activeInvestigationId: "investigation-1",
      areaId: "area-roof",
    });
    expect(reconciled.workflow).toMatchObject({
      deliveryState: "waiting_for_approval",
      investigationStatus: "active",
      packageManifestSha256: null,
    });
    expect(reconciled.session.workflow).toEqual(reconciled.workflow);
  });

  it("fails closed before reconciling a foreign job or professional commission", () => {
    const session = {
      areaId: "area-bathroom",
      cachedAssignedJobIds: ["job-1"],
      commissionedModules: [
        { module: "building" as const, moduleId: "module-1" },
      ],
      deviceId: "device-1",
      deviceState: "enrolled" as const,
      jobId: "job-1",
      nextSequence: 1,
      organizationId: "organization-1",
      session: "valid" as const,
      updatedAt: "2026-07-16T00:00:00.000Z",
      workflow: initialFieldWorkflow([], "2026-07-16T00:00:00.000Z"),
    };
    const foreign = startInvestigation({
      areaId: "area-roof",
      commissionedModules: [{ module: "building", moduleId: "foreign-module" }],
      inspectorId: "inspector-2",
      investigationId: "foreign-investigation",
      jobId: "job-2",
      organizationId: "organization-2",
      startedAt: "2026-07-16T01:00:00.000Z",
    });
    const foreignCompleted = finishInvestigation(foreign, {
      completedAt: "2026-07-16T01:30:00.000Z",
      draftingDisposition: "manual_only",
      expectedRevision: 0,
      inspectorId: "inspector-2",
      outcome: "no_reportable_finding",
    });

    expect(() => reconcileFieldSessionInvestigation(session, foreign)).toThrow(
      "different job or professional commission",
    );
    expect(() =>
      reconcileDurableProfessionalState(session, foreignCompleted),
    ).toThrow("different job or professional commission");
  });

  it("round-trips independently approved package and delivery state", () => {
    const accepted = createSyntheticReviewItems().map((item) =>
      acceptReviewItem(item),
    );
    const initial = initialFieldWorkflow(accepted, "2026-07-16T01:00:00.000Z");
    const saved = parseFieldWorkflow({
      ...initial,
      approvedModules: ["building", "timber_pest"],
      deliveryState: "waiting_for_evidence",
      moduleApprovalBindings: [
        approvalBindingForReview(accepted[0]!, "a"),
        approvalBindingForReview(accepted[1]!, "c"),
      ],
      packageManifestSha256: "b".repeat(64),
      revision: 9,
    });
    const restored = cloneFieldWorkflow(saved);

    expect(restored).toEqual(saved);
    expect(restored).not.toBe(saved);
    expect(restored.approvedModules).not.toBe(saved.approvedModules);
  });

  it("fails closed on forged approval or package state", () => {
    const initial = initialFieldWorkflow([], "2026-07-16T01:00:00.000Z");
    expect(() =>
      parseFieldWorkflow({
        ...initial,
        approvedModules: ["building", "building"],
      }),
    ).toThrow("Stored field workflow is invalid");
    expect(() =>
      parseFieldWorkflow({
        ...initial,
        packageManifestSha256: "not-a-digest",
      }),
    ).toThrow("Stored field workflow is invalid");
    expect(() =>
      parseFieldWorkflow({
        ...initial,
        deliveryState: "sent",
        packageManifestSha256: "a".repeat(64),
      }),
    ).toThrow("Stored field workflow is invalid");
  });

  it("rejects accepted review state without exact finding authority", () => {
    const accepted = acceptReviewItem(createSyntheticReviewItems()[0]!);
    const initial = initialFieldWorkflow([accepted]);

    expect(() =>
      parseFieldWorkflow({
        ...initial,
        reviewItems: [
          {
            ...accepted,
            finding: { ...accepted.finding, verifier: { status: "pending" } },
          },
        ],
      }),
    ).toThrow("Stored field workflow is invalid");
  });
});

function approvalBinding(module: "building" | "timber_pest", seed: string) {
  return {
    coverageRevision: 4,
    module,
    reviewVersions: [
      {
        contentHash: seed.repeat(64),
        reviewId: `review-${module}`,
        versionId: `version-${module}`,
      },
    ],
    snapshotSha256: seed.repeat(64),
  };
}

function approvalBindingForReview(
  review: ReturnType<typeof acceptReviewItem>,
  seed: string,
) {
  return {
    coverageRevision: 4,
    module: review.module,
    reviewVersions: [
      {
        contentHash: review.finding.contentHash,
        reviewId: review.reviewId,
        versionId: review.finding.versionId,
      },
    ],
    snapshotSha256: seed.repeat(64),
  };
}
