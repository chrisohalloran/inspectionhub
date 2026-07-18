import { describe, expect, it } from "vitest";
import {
  createCoverageLedger,
  recordAreaCoverage,
  type CoverageLedger,
} from "@inspection/domain/inspection/mobile";

import { acceptReviewItem } from "../review/investigation-review.js";
import { createSyntheticReviewFixture } from "../review/demo-review-items.js";
import { approvalSnapshotPayload } from "../completion/approval-binding.js";
import {
  createRecipientPackageSnapshot,
  projectRecipientOverview,
  verifyRecipientPackageSnapshot,
  type RecipientInspectorAuthority,
} from "./recipient-overview.js";

describe("protected recipient package and safe projection", () => {
  it("binds exact approvals and projects no private evidence identities", async () => {
    const fixture = await createSyntheticReviewFixture(digest);
    const accepted = fixture.reviewItems.map(acceptReviewItem);
    const baseCoverage = coverageFor(accepted);
    const coverage: CoverageLedger = {
      ...baseCoverage,
      limitations: [
        ...baseCoverage.limitations,
        {
          areaId: "area-main-bathroom",
          description: "Non-material limitation must not reach the overview.",
          limitationId: "limitation-non-material",
          material: false,
          module: "building",
          moduleId: accepted[0]!.finding.moduleId,
          recordedAt: "2026-07-17T00:31:00.000Z",
          status: "active",
          supersededAt: null,
        },
        {
          areaId: "area-external-east",
          description: "Superseded limitation must not reach the overview.",
          limitationId: "limitation-superseded",
          material: true,
          module: "timber_pest",
          moduleId: accepted[1]!.finding.moduleId,
          recordedAt: "2026-07-17T00:31:00.000Z",
          status: "superseded",
          supersededAt: "2026-07-17T00:32:00.000Z",
        },
      ],
    };
    const snapshot = await createRecipientPackageSnapshot({
      approvalBindings: await Promise.all(
        accepted.map((review) => signedApprovalBinding(review, coverage)),
      ),
      commissionedModules: ["building", "timber_pest"],
      coverage,
      digest,
      issuedAt: "2026-07-17T01:00:00.000Z",
      jobId: accepted[0]!.finding.jobId,
      organizationId: accepted[0]!.finding.organizationId,
      propertyLabel: "12 Example Street (synthetic)",
      reportVersionId: "report-version-1",
      reviewItems: accepted,
    });

    await expect(
      verifyRecipientPackageSnapshot(snapshot, digest),
    ).resolves.toBe(true);
    const projection = projectRecipientOverview({
      packageSnapshot: snapshot,
      reviewItems: accepted,
    });
    expect(projection.modules).toHaveLength(2);
    expect(snapshot.coverageIdentity).toEqual({
      organizationId: accepted[0]!.finding.organizationId,
      jobId: accepted[0]!.finding.jobId,
      ledgerRevision: 2,
    });
    expect(snapshot.modules[0]).toMatchObject({
      coverageRevision: 1,
      materialLimitations: [
        {
          areaLabel: "Second floor / Main bathroom",
          description:
            "Shower base access was limited by fixed finishes during the visual inspection.",
        },
      ],
      moduleId: accepted[0]!.finding.moduleId,
    });
    expect(projection.modules[0]?.materialLimitations).toEqual([
      {
        areaLabel: "Second floor / Main bathroom",
        description:
          "Shower base access was limited by fixed finishes during the visual inspection.",
        recordedAt: "2026-07-17T00:30:00.000Z",
      },
    ]);
    expect(snapshot.modules[0]?.approvingInspectorId).toBe(
      approvingInspector.inspectorId,
    );
    expect(projection.modules[0]?.inspector).toEqual(inspector);
    expect(JSON.stringify(projection)).not.toMatch(
      /artifactId|contentHash|packetId|packetHash|reviewId|findingId|limitationId|moduleId/u,
    );
  });

  it("rejects changed references and duplicate recipient modules", async () => {
    const fixture = await createSyntheticReviewFixture(digest);
    const accepted = fixture.reviewItems.map(acceptReviewItem);
    const coverage = coverageFor(accepted);
    const snapshot = await createRecipientPackageSnapshot({
      approvalBindings: await Promise.all(
        accepted.map((review) => signedApprovalBinding(review, coverage)),
      ),
      commissionedModules: ["building", "timber_pest"],
      coverage,
      digest,
      issuedAt: "2026-07-17T01:00:00.000Z",
      jobId: accepted[0]!.finding.jobId,
      organizationId: accepted[0]!.finding.organizationId,
      propertyLabel: "12 Example Street (synthetic)",
      reportVersionId: "report-version-1",
      reviewItems: accepted,
    });
    const changedReference = {
      ...snapshot,
      modules: snapshot.modules.map((module, index) =>
        index === 0
          ? {
              ...module,
              findings: module.findings.map((finding) => ({
                ...finding,
                packetId: "substituted-packet",
              })),
            }
          : module,
      ),
    };

    await expect(
      verifyRecipientPackageSnapshot(changedReference, digest),
    ).resolves.toBe(false);
    await expect(
      verifyRecipientPackageSnapshot(
        {
          ...snapshot,
          modules: snapshot.modules.map((module, index) =>
            index === 0
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
        digest,
      ),
    ).resolves.toBe(false);
    expect(() =>
      projectRecipientOverview({
        packageSnapshot: changedReference,
        reviewItems: accepted,
      }),
    ).toThrow("does not match exact review authority");
    expect(() =>
      projectRecipientOverview({
        packageSnapshot: {
          ...snapshot,
          modules: [snapshot.modules[0]!, snapshot.modules[0]!],
        },
        reviewItems: accepted,
      }),
    ).toThrow("structure is invalid");

    await expect(
      verifyRecipientPackageSnapshot(
        {
          ...snapshot,
          coverageIdentity: {
            ...snapshot.coverageIdentity,
            ledgerRevision: snapshot.coverageIdentity.ledgerRevision + 1,
          },
        },
        digest,
      ),
    ).resolves.toBe(false);
  });

  it("refuses duplicate commissioned modules before package creation", async () => {
    const fixture = await createSyntheticReviewFixture(digest);
    const accepted = fixture.reviewItems.map(acceptReviewItem);

    await expect(
      createRecipientPackageSnapshot({
        approvalBindings: [
          await signedApprovalBinding(
            accepted[0]!,
            coverageFor([accepted[0]!]),
          ),
        ],
        commissionedModules: ["building", "building"],
        coverage: coverageFor([accepted[0]!]),
        digest,
        issuedAt: "2026-07-17T01:00:00.000Z",
        jobId: accepted[0]!.finding.jobId,
        organizationId: accepted[0]!.finding.organizationId,
        propertyLabel: "12 Example Street (synthetic)",
        reportVersionId: "report-version-1",
        reviewItems: [accepted[0]!],
      }),
    ).rejects.toThrow("unique commissioned modules");
  });

  it("refuses duplicate or cross-job review authority before package creation", async () => {
    const fixture = await createSyntheticReviewFixture(digest);
    const accepted = fixture.reviewItems.map(acceptReviewItem);

    await expect(
      createRecipientPackageSnapshot({
        approvalBindings: [
          await signedApprovalBinding(
            accepted[0]!,
            coverageFor([accepted[0]!]),
          ),
        ],
        commissionedModules: ["building"],
        coverage: coverageFor([accepted[0]!]),
        digest,
        issuedAt: "2026-07-17T01:00:00.000Z",
        jobId: accepted[0]!.finding.jobId,
        organizationId: accepted[0]!.finding.organizationId,
        propertyLabel: "12 Example Street (synthetic)",
        reportVersionId: "report-version-1",
        reviewItems: [accepted[0]!, accepted[0]!],
      }),
    ).rejects.toThrow("unique and belong to the exact commissioned job");

    await expect(
      createRecipientPackageSnapshot({
        approvalBindings: [approvalBinding(accepted[0]!, "a".repeat(64))],
        commissionedModules: ["building"],
        coverage: coverageFor([accepted[0]!], "different-job"),
        digest,
        issuedAt: "2026-07-17T01:00:00.000Z",
        jobId: "different-job",
        organizationId: accepted[0]!.finding.organizationId,
        propertyLabel: "12 Example Street (synthetic)",
        reportVersionId: "report-version-1",
        reviewItems: [accepted[0]!],
      }),
    ).rejects.toThrow("unique and belong to the exact commissioned job");
  });

  it("rejects stale approval coverage revisions", async () => {
    const fixture = await createSyntheticReviewFixture(digest);
    const accepted = fixture.reviewItems.map(acceptReviewItem);

    await expect(
      createRecipientPackageSnapshot({
        approvalBindings: [
          {
            ...(await signedApprovalBinding(
              accepted[0]!,
              coverageFor([accepted[0]!]),
            )),
            coverageRevision: 0,
          },
        ],
        commissionedModules: ["building"],
        coverage: coverageFor([accepted[0]!]),
        digest,
        issuedAt: "2026-07-17T01:00:00.000Z",
        jobId: accepted[0]!.finding.jobId,
        organizationId: accepted[0]!.finding.organizationId,
        propertyLabel: "12 Example Street (synthetic)",
        reportVersionId: "report-version-1",
        reviewItems: [accepted[0]!],
      }),
    ).rejects.toThrow("coverage revision and approval");
  });
});

const inspector: RecipientInspectorAuthority = {
  displayName: "Synthetic inspector",
  credential: "Synthetic fixture credential",
  confirmedAt: "2026-07-17T01:00:00.000Z",
  authority: "synthetic_fixture",
};
const approvingInspector = {
  ...inspector,
  inspectorId: "inspector-1",
};

function approvalBinding(
  review: ReturnType<typeof acceptReviewItem>,
  snapshotSha256: string,
) {
  return {
    approvingInspector,
    coverageRevision: 1,
    module: review.module,
    reviewVersions: [
      {
        contentHash: review.finding.contentHash,
        reviewId: review.reviewId,
        versionId: review.finding.versionId,
      },
    ],
    snapshotSha256,
  };
}

async function signedApprovalBinding(
  review: ReturnType<typeof acceptReviewItem>,
  coverage: CoverageLedger,
) {
  return approvalBinding(
    review,
    await digest(
      approvalSnapshotPayload({
        approvingInspector,
        coverage,
        jobId: review.finding.jobId,
        module: review.module,
        reviewItems: [review],
      }),
    ),
  );
}

function coverageFor(
  accepted: readonly ReturnType<typeof acceptReviewItem>[],
  jobId = accepted[0]!.finding.jobId,
): CoverageLedger {
  const modules = accepted.map((review) => ({
    module: review.module,
    moduleId: review.finding.moduleId,
  }));
  let coverage = createCoverageLedger({
    areas: modules.map(({ module }) => ({
      applicableModules: [module],
      areaId:
        module === "building" ? "area-main-bathroom" : "area-external-east",
      label:
        module === "building"
          ? "Second floor / Main bathroom"
          : "Exterior / East elevation",
    })),
    commissionedModules: modules,
    jobId,
    organizationId: accepted[0]!.finding.organizationId,
  });
  for (const { module } of modules) {
    coverage = recordAreaCoverage(coverage, {
      areaId:
        module === "building" ? "area-main-bathroom" : "area-external-east",
      coverageEntryId: `coverage-${module}`,
      expectedRevision: coverage.revision,
      inspectorId: "inspector-1",
      ...(module === "building"
        ? {
            detail:
              "Shower base access was limited by fixed finishes during the visual inspection.",
            limitationId: "limitation-building-1",
            material: true,
          }
        : {}),
      module,
      recordedAt: "2026-07-17T00:30:00.000Z",
      state: module === "building" ? "access_limited" : "inspected",
    });
  }
  return coverage;
}

async function digest(payload: string): Promise<string> {
  const result = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(result), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
