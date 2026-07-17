import { describe, expect, it } from "vitest";

import {
  cloneFieldWorkflow,
  initialFieldWorkflow,
  parseFieldSession,
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
  it("migrates the exact origin/main demo session identity before strict parsing", () => {
    const updatedAt = "2026-07-16T00:00:00.000Z";
    const legacyReviewItems = createSyntheticReviewItems();
    const parsed = parseFieldSession({
      areaId: "area-main-bathroom",
      cachedAssignedJobIds: [legacyReviewItems[0]!.finding.jobId],
      deviceId: "device-field-01",
      deviceState: "enrolled",
      jobId: legacyReviewItems[0]!.finding.jobId,
      nextSequence: 1,
      session: "valid",
      updatedAt,
      workflow: {
        approvedModules: [],
        deliveryState: "waiting_for_approval",
        investigationStatus: "none",
        lastTransition: "workflow_initialized",
        packageManifestSha256: null,
        reviewItems: legacyReviewItems,
        revision: 1,
        updatedAt,
      },
    });

    expect(parsed.organizationId).toBe(
      legacyReviewItems[0]!.finding.organizationId,
    );
    expect(parsed.propertyLabel).toBe("Synthetic two-storey dwelling");
    expect(parsed.commissionedModules).toEqual([
      {
        module: "building",
        moduleId: legacyReviewItems[0]!.finding.moduleId,
      },
      {
        module: "timber_pest",
        moduleId: legacyReviewItems[1]!.finding.moduleId,
      },
    ]);
    expect(parsed.workflow).toMatchObject({
      approvedModules: [],
      recipientPackage: null,
      reviewItems: [],
      sourcePackets: [],
    });
  });

  it("rejects adversarial legacy reviews instead of deriving session identity from them", () => {
    const updatedAt = "2026-07-16T00:00:00.000Z";
    const adversarialReviews = createSyntheticReviewItems().map((item) => ({
      ...item,
      finding: {
        ...item.finding,
        organizationId: "organization-attacker-controlled",
      },
    }));

    expect(() =>
      parseFieldSession({
        areaId: "area-main-bathroom",
        cachedAssignedJobIds: [adversarialReviews[0]!.finding.jobId],
        deviceId: "device-field-01",
        deviceState: "enrolled",
        jobId: adversarialReviews[0]!.finding.jobId,
        nextSequence: 1,
        session: "valid",
        updatedAt,
        workflow: {
          approvedModules: [],
          deliveryState: "waiting_for_approval",
          investigationStatus: "none",
          lastTransition: "workflow_initialized",
          packageManifestSha256: null,
          reviewItems: adversarialReviews,
          revision: 1,
          updatedAt,
        },
      }),
    ).toThrow("Stored field session is invalid");
  });

  it("backfills only the exact known demo session property label", () => {
    const parsed = parseFieldSession({
      areaId: "area-main-bathroom",
      cachedAssignedJobIds: ["50000000-0000-4000-8000-000000000002"],
      commissionedModules: [
        {
          module: "building",
          moduleId: "50000000-0000-4000-8000-000000000003",
        },
        {
          module: "timber_pest",
          moduleId: "50000000-0000-4000-8000-000000000004",
        },
      ],
      deviceId: "device-field-01",
      deviceState: "enrolled",
      jobId: "50000000-0000-4000-8000-000000000002",
      nextSequence: 1,
      organizationId: "50000000-0000-4000-8000-000000000001",
      session: "valid",
      updatedAt: "2026-07-16T00:00:00.000Z",
    });

    expect(parsed.propertyLabel).toBe("Synthetic two-storey dwelling");
  });

  it("accepts a current workflow-less session without inventing a package error", () => {
    expect(() =>
      parseFieldSession({
        areaId: "area-main-bathroom",
        cachedAssignedJobIds: ["job-1"],
        commissionedModules: [
          { module: "building", moduleId: "module-building" },
        ],
        deviceId: "device-field-01",
        deviceState: "enrolled",
        jobId: "job-1",
        nextSequence: 1,
        organizationId: "organization-1",
        propertyLabel: "12 Example Street",
        session: "valid",
        updatedAt: "2026-07-16T00:00:00.000Z",
      }),
    ).not.toThrow();
  });

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
      propertyLabel: "12 Example Street",
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
      propertyLabel: "12 Example Street",
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
      propertyLabel: "12 Example Street",
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
    const initial = initialFieldWorkflow(
      accepted,
      "2026-07-16T01:00:00.000Z",
      sourcePacketsFor(accepted),
    );
    const saved = parseFieldWorkflow({
      ...initial,
      approvedModules: ["building", "timber_pest"],
      deliveryState: "waiting_for_evidence",
      moduleApprovalBindings: [
        approvalBindingForReview(accepted[0]!, "a"),
        approvalBindingForReview(accepted[1]!, "c"),
      ],
      packageManifestSha256: "b".repeat(64),
      recipientPackage: recipientPackage(accepted),
      revision: 9,
    });
    const restored = cloneFieldWorkflow(saved);

    expect(restored).toEqual(saved);
    expect(restored).not.toBe(saved);
    expect(restored.approvedModules).not.toBe(saved.approvedModules);
  });

  it("invalidates legacy caller-attributed packages until each module is re-approved", () => {
    const accepted = createSyntheticReviewItems().map(acceptReviewItem);
    const current = {
      ...initialFieldWorkflow(
        accepted,
        "2026-07-16T01:00:00.000Z",
        sourcePacketsFor(accepted),
      ),
      approvedModules: ["building", "timber_pest"] as const,
      deliveryState: "queued" as const,
      moduleApprovalBindings: [
        approvalBindingForReview(accepted[0]!, "a"),
        approvalBindingForReview(accepted[1]!, "c"),
      ],
      packageManifestSha256: "b".repeat(64),
      recipientPackage: recipientPackage(accepted),
    };
    const legacyBindings = current.moduleApprovalBindings.map((binding) => ({
      coverageRevision: binding.coverageRevision,
      module: binding.module,
      reviewVersions: binding.reviewVersions,
      snapshotSha256: binding.snapshotSha256,
    }));
    const legacyModules = current.recipientPackage.modules.map((module) => ({
      module: module.module,
      moduleId: module.moduleId,
      coverageRevision: module.coverageRevision,
      approvalSnapshotSha256: module.approvalSnapshotSha256,
      inspector: module.inspector,
      materialLimitations: module.materialLimitations,
      findings: module.findings,
    }));
    expect(
      parseFieldWorkflow({
        ...current,
        moduleApprovalBindings: legacyBindings,
        recipientPackage: {
          ...current.recipientPackage,
          schemaVersion: "field-recipient-package-v3",
          modules: legacyModules,
        },
      }),
    ).toMatchObject({
      approvedModules: [],
      deliveryState: "waiting_for_approval",
      lastTransition: "professional_state_changed",
      moduleApprovalBindings: [],
      packageManifestSha256: null,
      recipientPackage: null,
    });
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

    const accepted = createSyntheticReviewItems().map(acceptReviewItem);
    const approved = {
      ...initialFieldWorkflow(
        accepted,
        "2026-07-16T01:00:00.000Z",
        sourcePacketsFor(accepted),
      ),
      approvedModules: ["building", "timber_pest"] as const,
      deliveryState: "queued" as const,
      moduleApprovalBindings: [
        approvalBindingForReview(accepted[0]!, "a"),
        approvalBindingForReview(accepted[1]!, "c"),
      ],
      packageManifestSha256: "b".repeat(64),
      recipientPackage: recipientPackage(accepted),
    };
    expect(() =>
      parseFieldWorkflow({
        ...approved,
        recipientPackage: {
          ...approved.recipientPackage,
          modules: approved.recipientPackage.modules.map((module) =>
            module.module === "building"
              ? {
                  ...module,
                  findings: module.findings.map((finding) => ({
                    ...finding,
                    contentHash: "9".repeat(64),
                  })),
                }
              : module,
          ),
        },
      }),
    ).toThrow("Stored field workflow is invalid");
    expect(() =>
      parseFieldWorkflow({
        ...approved,
        recipientPackage: {
          ...approved.recipientPackage,
          modules: approved.recipientPackage.modules.map((module) =>
            module.module === "building"
              ? {
                  ...module,
                  inspector: {
                    ...module.inspector,
                    credential: "Substituted credential",
                  },
                }
              : module,
          ),
        },
      }),
    ).toThrow("Stored field workflow is invalid");
  });

  it("migrates legacy AI workflow state to review-required without trusting an absent packet", () => {
    const accepted = createSyntheticReviewItems().map(acceptReviewItem);
    const current = {
      ...initialFieldWorkflow(accepted),
      approvedModules: ["building", "timber_pest"] as const,
      deliveryState: "queued" as const,
      moduleApprovalBindings: [
        approvalBindingForReview(accepted[0]!, "a"),
        approvalBindingForReview(accepted[1]!, "c"),
      ],
      packageManifestSha256: "b".repeat(64),
      recipientPackage: recipientPackage(accepted),
    };
    const {
      recipientPackage: _recipientPackage,
      sourcePackets: _sourcePackets,
      ...legacy
    } = current;
    void _recipientPackage;
    void _sourcePackets;

    expect(parseFieldWorkflow(legacy)).toMatchObject({
      approvedModules: [],
      deliveryState: "waiting_for_approval",
      moduleApprovalBindings: [],
      packageManifestSha256: null,
      processedFindingCandidateIds: [],
      recipientPackage: null,
      reviewItems: [],
      sourcePackets: [],
    });
  });

  it("rejects accepted review state without exact finding authority", () => {
    const accepted = acceptReviewItem(createSyntheticReviewItems()[0]!);
    const initial = initialFieldWorkflow(
      [accepted],
      "2026-07-16T01:00:00.000Z",
      sourcePacketsFor([accepted]),
    );

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

  it("rejects duplicate authorship that substitutes a different packet source", () => {
    const accepted = acceptReviewItem(createSyntheticReviewItems()[0]!);
    const authoredSource =
      accepted.finding.authorship.sourceArtifactReferences[0]!;
    const forgedReview = {
      ...accepted,
      finding: {
        ...accepted.finding,
        authorship: {
          ...accepted.finding.authorship,
          sourceArtifactReferences: [authoredSource, authoredSource],
        },
      },
      provenance: {
        ...accepted.provenance,
        sourceArtifactIds: [
          authoredSource.artifactId,
          authoredSource.artifactId,
        ],
      },
    };
    const packet = sourcePacketsFor([accepted])[0]!;
    const forgedPacket = {
      ...packet,
      sources: [
        packet.sources[0]!,
        {
          artifactId: "substituted-packet-source",
          contentHash: "9".repeat(64),
        },
      ],
    };
    const workflow = initialFieldWorkflow(
      [forgedReview],
      "2026-07-16T01:00:00.000Z",
      [forgedPacket],
    );

    expect(() => parseFieldWorkflow(workflow)).toThrow(
      "Stored field workflow is invalid",
    );
  });
});

function approvalBinding(module: "building" | "timber_pest", seed: string) {
  return {
    approvingInspector: inspectorAuthority(module),
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
    approvingInspector: inspectorAuthority(review.module),
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

function recipientPackage(accepted: ReturnType<typeof acceptReviewItem>[]) {
  return {
    schemaVersion: "field-recipient-package-v4" as const,
    reportVersionId: "report-version-1",
    organizationId: accepted[0]!.finding.organizationId,
    jobId: accepted[0]!.finding.jobId,
    propertyLabel: "12 Example Street (synthetic)",
    issuedAt: "2026-07-16T01:00:00.000Z",
    canonicalHash: "d".repeat(64),
    coverageIdentity: {
      organizationId: accepted[0]!.finding.organizationId,
      jobId: accepted[0]!.finding.jobId,
      ledgerRevision: 8,
    },
    modules: accepted.map((review, index) => ({
      module: review.module,
      moduleId: review.finding.moduleId,
      coverageRevision: 4,
      approvalSnapshotSha256: (index === 0 ? "a" : "c").repeat(64),
      approvingInspectorId: inspectorAuthority(review.module).inspectorId,
      inspector: recipientInspectorAuthority(review.module),
      materialLimitations: [],
      findings: [
        {
          findingId: review.finding.findingId,
          reviewId: review.reviewId,
          versionId: review.finding.versionId,
          contentHash: review.finding.contentHash,
          packetId: review.provenance.packetId,
          packetHash: review.provenance.packetHash,
          evidenceSourceCount:
            review.finding.authorship.sourceArtifactReferences.length,
        },
      ],
    })),
  };
}

function inspectorAuthority(module: "building" | "timber_pest") {
  return {
    inspectorId: `inspector-${module}`,
    displayName: "Licensed inspector",
    credential: "Synthetic credential",
    confirmedAt: "2026-07-16T01:00:00.000Z",
    authority: "synthetic_fixture" as const,
  };
}

function recipientInspectorAuthority(module: "building" | "timber_pest") {
  const authority = inspectorAuthority(module);
  return {
    displayName: authority.displayName,
    credential: authority.credential,
    confirmedAt: authority.confirmedAt,
    authority: authority.authority,
  };
}

function sourcePacketsFor(accepted: ReturnType<typeof acceptReviewItem>[]) {
  return accepted.map((review) => ({
    schemaVersion: "synthetic-fixture-source-packet-v1" as const,
    fixtureId:
      review.module === "building"
        ? ("inspectionhub.synthetic.building-review.v1" as const)
        : ("inspectionhub.synthetic.timber-pest-review.v1" as const),
    packetId: review.provenance.packetId,
    packetRevision: 1 as const,
    canonicalHash: review.provenance.packetHash,
    organizationId: review.finding.organizationId,
    jobId: review.finding.jobId,
    investigationId: review.investigationId,
    createdAt: "2026-07-15T02:00:00.000Z",
    model: "gpt-5.6-synthetic-build-week" as const,
    promptVersion: "inspection-draft-v1" as const,
    skillVersions: ["report-language-v1"] as const,
    sources: review.finding.authorship.sourceArtifactReferences.map(
      ({ artifactId, contentHash }) => ({ artifactId, contentHash }),
    ),
    assumptions: review.provenance.assumptions,
  }));
}
