import { describe, expect, it } from "vitest";

import {
  createCoverageLedger,
  recordAreaCoverage,
} from "@inspection/domain/inspection/mobile";
import { domainFixtureIds } from "@inspection/test-fixtures/domain";

import { createSyntheticReviewItems } from "../review/demo-review-items";
import {
  acceptReviewItem,
  type InvestigationReviewItem,
} from "../review/investigation-review";
import {
  approvalBindingMatches,
  approvalReviewVersions,
  approvalSnapshotPayload,
  moduleCoverageRevision,
  verifyApprovalBinding,
} from "./approval-binding";

const approvingInspector = {
  inspectorId: domainFixtureIds.inspectorId,
  displayName: "Synthetic Build Week building inspector",
  credential: "Synthetic fixture credential",
  confirmedAt: "2026-07-17T09:00:00.000+10:00",
  authority: "synthetic_fixture" as const,
};

describe("exact module approval binding", () => {
  it("invalidates approval when coverage or an accepted review version changes", () => {
    const accepted = createSyntheticReviewItems().map((item) => ({
      ...item,
      status: "accepted" as const,
    }));
    const reviewVersions = approvalReviewVersions(accepted, "building");
    const binding = {
      approvingInspector,
      coverageRevision: 9,
      module: "building" as const,
      reviewVersions,
      snapshotSha256: "a".repeat(64),
    };

    expect(
      approvalBindingMatches({
        binding,
        coverageRevision: 9,
        module: "building",
        reviewItems: accepted,
      }),
    ).toBe(true);
    expect(
      approvalBindingMatches({
        binding,
        coverageRevision: 10,
        module: "building",
        reviewItems: accepted,
      }),
    ).toBe(false);
    expect(
      approvalBindingMatches({
        binding,
        coverageRevision: 9,
        module: "building",
        reviewItems: accepted.map((item) =>
          item.module === "building"
            ? {
                ...item,
                finding: { ...item.finding, versionId: "version-changed" },
              }
            : item,
        ),
      }),
    ).toBe(false);
    expect(
      approvalBindingMatches({
        binding,
        coverageRevision: 9,
        module: "building",
        reviewItems: [
          ...accepted,
          {
            ...accepted.find((item) => item.module === "building")!,
            reviewId: "new-unreviewed-building-item",
            status: "awaiting_decision",
          },
        ],
      }),
    ).toBe(false);
  });

  it("hash-verifies the actual job-scoped module snapshot", async () => {
    const accepted = createSyntheticReviewItems().map((item) => ({
      ...item,
      status: "accepted" as const,
    }));
    const coverage = inspectedCoverage();
    const payload = approvalSnapshotPayload({
      approvingInspector,
      coverage,
      jobId: domainFixtureIds.jobId,
      module: "building",
      reviewItems: accepted,
    });
    expect(payload).toContain("coverage-building-1");
    expect(payload).toContain("Shower floor inspected visually.");
    expect(payload).toBe(
      approvalSnapshotPayload({
        approvingInspector,
        coverage,
        jobId: domainFixtureIds.jobId,
        module: "building",
        reviewItems: accepted,
      }),
    );

    const binding = {
      approvingInspector,
      coverageRevision: 1,
      module: "building" as const,
      reviewVersions: approvalReviewVersions(accepted, "building"),
      snapshotSha256: await digest(payload),
    };
    await expect(
      verifyApprovalBinding({
        binding,
        coverage,
        digest,
        jobId: domainFixtureIds.jobId,
        module: "building",
        reviewItems: accepted,
      }),
    ).resolves.toBe(true);
    await expect(
      verifyApprovalBinding({
        binding: {
          ...binding,
          approvingInspector: {
            ...approvingInspector,
            credential: "Substituted credential",
          },
        },
        coverage,
        digest,
        jobId: domainFixtureIds.jobId,
        module: "building",
        reviewItems: accepted,
      }),
    ).resolves.toBe(false);
    await expect(
      verifyApprovalBinding({
        binding: { ...binding, snapshotSha256: "c".repeat(64) },
        coverage,
        digest,
        jobId: domainFixtureIds.jobId,
        module: "building",
        reviewItems: accepted,
      }),
    ).resolves.toBe(false);
  });

  it("binds content, evidence, provenance, verifier and review checks", async () => {
    const accepted = createSyntheticReviewItems().map(acceptReviewItem);
    const coverage = inspectedCoverage();
    const baselinePayload = approvalSnapshotPayload({
      approvingInspector,
      coverage,
      jobId: domainFixtureIds.jobId,
      module: "building",
      reviewItems: accepted,
    });
    const binding = {
      approvingInspector,
      coverageRevision: 1,
      module: "building" as const,
      reviewVersions: approvalReviewVersions(accepted, "building"),
      snapshotSha256: await digest(baselinePayload),
    };
    const building = accepted.find((item) => item.module === "building")!;
    const variants: readonly InvestigationReviewItem[][] = [
      accepted.map((item) =>
        item.module === "building"
          ? ({
              ...item,
              finding: {
                ...item.finding,
                content: {
                  ...item.finding.content,
                  observation: "Mutated with the stale claimed content hash.",
                },
              },
            } as InvestigationReviewItem)
          : item,
      ),
      accepted.map((item) =>
        item.module === "building"
          ? {
              ...item,
              provenance: { ...item.provenance, packetHash: "9".repeat(64) },
            }
          : item,
      ),
      accepted.map((item) =>
        item.module === "building" && item.finding.verifier.status === "passed"
          ? {
              ...item,
              finding: {
                ...item.finding,
                verifier: {
                  ...item.finding.verifier,
                  verifierVersion: "mutated-verifier",
                },
              },
            }
          : item,
      ),
      accepted.map((item) =>
        item.module === "building"
          ? {
              ...item,
              finding: {
                ...item.finding,
                authorship: {
                  ...item.finding.authorship,
                  sourceArtifactReferences:
                    item.finding.authorship.sourceArtifactReferences.map(
                      (source) => ({ ...source, contentHash: "8".repeat(64) }),
                    ),
                },
              },
            }
          : item,
      ),
      accepted.map((item) =>
        item.module === "building"
          ? {
              ...item,
              checks: item.checks.map((check) => ({
                ...check,
                explanation: "Mutated review check.",
              })),
            }
          : item,
      ),
    ];

    expect(building.status).toBe("accepted");
    for (const reviewItems of variants) {
      await expect(
        verifyApprovalBinding({
          binding,
          coverage,
          digest,
          jobId: domainFixtureIds.jobId,
          module: "building",
          reviewItems,
        }),
      ).resolves.toBe(false);
    }
  });

  it("advances only the professional module whose coverage changed", () => {
    const initial = createCoverageLedger({
      areas: [
        {
          applicableModules: ["building", "timber_pest"],
          areaId: "area-main-bathroom",
          label: "Main bathroom",
        },
      ],
      commissionedModules: [
        { module: "building", moduleId: "module-building" },
        { module: "timber_pest", moduleId: "module-timber-pest" },
      ],
      jobId: "job-1",
      organizationId: "organization-1",
    });
    const buildingRecorded = recordAreaCoverage(initial, {
      areaId: "area-main-bathroom",
      coverageEntryId: "coverage-building-1",
      expectedRevision: initial.revision,
      inspectorId: "inspector-1",
      module: "building",
      recordedAt: "2026-07-17T09:00:00.000+10:00",
      state: "inspected",
    });

    expect(moduleCoverageRevision(buildingRecorded, "building")).toBe(1);
    expect(moduleCoverageRevision(buildingRecorded, "timber_pest")).toBe(0);

    const pestRecorded = recordAreaCoverage(buildingRecorded, {
      areaId: "area-main-bathroom",
      coverageEntryId: "coverage-pest-1",
      expectedRevision: buildingRecorded.revision,
      inspectorId: "inspector-1",
      module: "timber_pest",
      recordedAt: "2026-07-17T09:01:00.000+10:00",
      state: "inspected",
    });

    expect(moduleCoverageRevision(pestRecorded, "building")).toBe(1);
    expect(moduleCoverageRevision(pestRecorded, "timber_pest")).toBe(1);
  });

  it("rejects a structurally valid binding for a different job", async () => {
    const coverage = inspectedCoverage();
    const accepted = createSyntheticReviewItems().map(acceptReviewItem);
    const binding = {
      approvingInspector,
      coverageRevision: 1,
      module: "building" as const,
      reviewVersions: approvalReviewVersions(accepted, "building"),
      snapshotSha256: "a".repeat(64),
    };

    await expect(
      verifyApprovalBinding({
        binding,
        coverage,
        digest: () => Promise.resolve("a".repeat(64)),
        jobId: "wrong-job",
        module: "building",
        reviewItems: accepted,
      }),
    ).resolves.toBe(false);
  });
});

function inspectedCoverage() {
  const initial = createCoverageLedger({
    areas: [
      {
        applicableModules: ["building"],
        areaId: "area-main-bathroom",
        label: "Main bathroom",
      },
    ],
    commissionedModules: [
      {
        module: "building",
        moduleId: domainFixtureIds.buildingModuleId,
      },
    ],
    jobId: domainFixtureIds.jobId,
    organizationId: domainFixtureIds.organizationId,
  });
  return recordAreaCoverage(initial, {
    areaId: "area-main-bathroom",
    coverageEntryId: "coverage-building-1",
    detail: "Shower floor inspected visually.",
    expectedRevision: 0,
    inspectorId: "inspector-1",
    module: "building",
    recordedAt: "2026-07-17T09:00:00.000+10:00",
    state: "inspected",
  });
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const result = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(result), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
