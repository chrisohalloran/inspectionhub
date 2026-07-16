import type { ProvisionalFinding } from "@inspection/contracts";
import {
  confirmedBuildingFinding,
  confirmedTimberPestFinding,
} from "@inspection/test-fixtures/domain";

import {
  createInvestigationReviewItem,
  type InvestigationReviewItem,
} from "./investigation-review";

const verifiedAt = "2026-07-15T02:00:00.000Z";

export function createSyntheticReviewItems(): readonly InvestigationReviewItem[] {
  return [
    reviewItem({
      base: confirmedBuildingFinding,
      investigationId: "51000000-0000-4000-8000-000000000001",
      packetHash: "d".repeat(64),
      packetId: "51000000-0000-4000-8000-000000000002",
      reviewId: "51000000-0000-4000-8000-000000000003",
      safeArtifactId: "51000000-0000-4000-8000-000000000004",
      safeHash: "e".repeat(64),
    }),
    reviewItem({
      base: {
        ...confirmedTimberPestFinding,
        content: {
          module: "timber_pest" as const,
          location: "Accessible internal, external and roof-void areas",
          observation:
            "No visible evidence of timber pest activity was observed in the accessible areas inspected at the inspection time.",
          apparentExtent:
            "Accessible inspected surfaces only; concealed, obstructed and inaccessible areas are excluded.",
          qualifiedOpinion:
            "This visual result does not exclude concealed or future timber pest activity.",
          uncertainty: [
            "Concealed framing, enclosed voids and obstructed surfaces were not visible.",
          ],
          furtherInvestigation: null,
          category: "no_visible_evidence" as const,
        },
      },
      investigationId: "52000000-0000-4000-8000-000000000001",
      packetHash: "f".repeat(64),
      packetId: "52000000-0000-4000-8000-000000000002",
      reviewId: "52000000-0000-4000-8000-000000000003",
      safeArtifactId: "52000000-0000-4000-8000-000000000004",
      safeHash: "1".repeat(64),
    }),
  ];
}

function reviewItem(input: {
  base: typeof confirmedBuildingFinding | typeof confirmedTimberPestFinding;
  investigationId: string;
  packetHash: string;
  packetId: string;
  reviewId: string;
  safeArtifactId: string;
  safeHash: string;
}): InvestigationReviewItem {
  const original = input.base.authorship.sourceArtifactReferences[0];
  if (original === undefined)
    throw new Error("Synthetic review requires evidence");
  const source = {
    kind: "derivative" as const,
    artifactId: input.safeArtifactId,
    contentHash: input.safeHash,
    parentArtifactId: original.artifactId,
    transformation: "safe_proxy" as const,
  };
  const finding: ProvisionalFinding = {
    status: "provisional",
    findingId: input.base.findingId,
    versionId: input.base.versionId,
    organizationId: input.base.organizationId,
    jobId: input.base.jobId,
    moduleId: input.base.moduleId,
    contentHash: input.base.contentHash,
    content: input.base.content,
    authorship: {
      origin: "ai",
      model: "gpt-5.6-synthetic-build-week",
      promptVersion: "inspection-draft-v1",
      skillVersions: ["report-language-v1"],
      packetRevision: 1,
      sourceArtifactReferences: [source],
      transcriptSpanReferences: [],
    },
    verifier: {
      status: "passed",
      draftVersionId: input.base.versionId,
      contentHash: input.base.contentHash,
      verifierVersion: "deterministic-verifier-v1",
      verifiedAt,
    },
  } as ProvisionalFinding;
  return createInvestigationReviewItem({
    reviewId: input.reviewId,
    investigationId: input.investigationId,
    finding,
    provenance: {
      packetId: input.packetId,
      packetRevision: 1,
      packetHash: input.packetHash,
      sourceRevision: 1,
      sourceArtifactIds: [input.safeArtifactId],
      transcriptSpanIds: [],
      transcriptUncertainty: [],
      assumptions:
        finding.content.module === "building"
          ? [
              "The supporting floor construction and waterproof membrane were not visually confirmed.",
            ]
          : [],
    },
    checks: [
      {
        checkId:
          finding.content.module === "building"
            ? "check-building-extent"
            : "check-pest-access",
        code:
          finding.content.module === "building"
            ? "extent_reviewed"
            : "accessible_areas_bounded",
        severity: "advisory",
        state: "open",
        explanation:
          finding.content.module === "building"
            ? "Confirm the apparent extent against the accessible adjacent surfaces inspected."
            : "Confirm that the result names only accessible inspected areas and the inspection time.",
      },
    ],
  });
}
