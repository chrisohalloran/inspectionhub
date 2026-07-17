import type { ProvisionalFinding } from "@inspection/contracts";
import {
  confirmedBuildingFinding,
  confirmedTimberPestFinding,
} from "@inspection/test-fixtures/domain";

import {
  createInvestigationReviewItem,
  type InvestigationReviewItem,
} from "./investigation-review";
import {
  sealSyntheticFixtureSourcePacket,
  type SyntheticFixtureSourcePacket,
} from "./source-packet";

const verifiedAt = "2026-07-15T02:00:00.000Z";

export function createSyntheticReviewItems(input?: {
  readonly buildingPacketHash?: string;
  readonly timberPestPacketHash?: string;
}): readonly InvestigationReviewItem[] {
  return [
    reviewItem({
      base: confirmedBuildingFinding,
      contentHash:
        "0ddaaf2ea77adc9d1b48fe9e9117d9c0ce8c5a59ad4db5b6d01857c35e793d02",
      investigationId: "51000000-0000-4000-8000-000000000001",
      packetHash: input?.buildingPacketHash ?? "d".repeat(64),
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
      contentHash:
        "48629839b0ac762e17aa548c1c3b7d99eab443becb6bfd37f1d2ea0803a160e4",
      investigationId: "52000000-0000-4000-8000-000000000001",
      packetHash: input?.timberPestPacketHash ?? "f".repeat(64),
      packetId: "52000000-0000-4000-8000-000000000002",
      reviewId: "52000000-0000-4000-8000-000000000003",
      safeArtifactId: "52000000-0000-4000-8000-000000000004",
      safeHash: "1".repeat(64),
    }),
  ];
}

export async function createSyntheticReviewFixture(
  digest: (payload: string) => Promise<string>,
): Promise<
  Readonly<{
    reviewItems: readonly InvestigationReviewItem[];
    sourcePackets: readonly SyntheticFixtureSourcePacket[];
  }>
> {
  const provisionalItems = createSyntheticReviewItems();
  const packets = await Promise.all(
    provisionalItems.map((item) =>
      sealSyntheticFixtureSourcePacket(
        {
          schemaVersion: "synthetic-fixture-source-packet-v1",
          fixtureId:
            item.module === "building"
              ? "inspectionhub.synthetic.building-review.v1"
              : "inspectionhub.synthetic.timber-pest-review.v1",
          packetId: item.provenance.packetId,
          packetRevision: 1,
          organizationId: item.finding.organizationId,
          jobId: item.finding.jobId,
          investigationId: item.investigationId,
          createdAt: verifiedAt,
          model: "gpt-5.6-synthetic-build-week",
          promptVersion: "inspection-draft-v1",
          skillVersions: ["report-language-v1"],
          sources: item.finding.authorship.sourceArtifactReferences.map(
            ({ artifactId, contentHash }) => ({ artifactId, contentHash }),
          ),
          assumptions: item.provenance.assumptions,
        },
        digest,
      ),
    ),
  );
  const buildingPacket = packets.find(
    (packet) =>
      packet.fixtureId === "inspectionhub.synthetic.building-review.v1",
  );
  const timberPestPacket = packets.find(
    (packet) =>
      packet.fixtureId === "inspectionhub.synthetic.timber-pest-review.v1",
  );
  if (buildingPacket === undefined || timberPestPacket === undefined) {
    throw new Error("Synthetic review fixture is incomplete");
  }
  return Object.freeze({
    reviewItems: Object.freeze(
      createSyntheticReviewItems({
        buildingPacketHash: buildingPacket.canonicalHash,
        timberPestPacketHash: timberPestPacket.canonicalHash,
      }),
    ),
    sourcePackets: Object.freeze(packets),
  });
}

function reviewItem(input: {
  base: typeof confirmedBuildingFinding | typeof confirmedTimberPestFinding;
  contentHash: string;
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
    contentHash: input.contentHash,
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
      contentHash: input.contentHash,
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
