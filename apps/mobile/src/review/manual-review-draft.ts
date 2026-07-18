import {
  ProvisionalFindingSchema,
  type FindingContent,
  type ProvisionalFinding,
} from "@inspection/contracts";
import type { Investigation } from "@inspection/domain/inspection/mobile";

import { canonicalJson } from "../integrity/canonical-json";
import {
  createInvestigationReviewItem,
  type InvestigationReviewItem,
} from "./investigation-review";

type Digest = (payload: string) => Promise<string>;

export async function createManualInvestigationReview(input: {
  readonly investigation: Investigation;
  readonly artifactHash: (artifactId: string) => string | undefined;
  readonly areaLabel: (areaId: string) => string;
  readonly digest: Digest;
  readonly idFactory: () => string;
}): Promise<readonly InvestigationReviewItem[]> {
  const completion = input.investigation.completion;
  if (
    input.investigation.status !== "completed_findings" ||
    completion?.outcome !== "finding_candidates" ||
    completion.moduleLinks.length === 0
  ) {
    throw new Error(
      "Manual drafting requires a completed investigation with finding candidates.",
    );
  }

  return Promise.all(
    completion.moduleLinks.map(async (link) => {
      const sourceArtifactReferences = link.sourceArtifactIds.map(
        (artifactId) => {
          const contentHash = input.artifactHash(artifactId);
          if (
            contentHash === undefined ||
            !/^[a-f0-9]{64}$/u.test(contentHash)
          ) {
            throw new Error(
              `Selected evidence ${artifactId} has no verified local content hash.`,
            );
          }
          return {
            kind: "original" as const,
            artifactId,
            contentHash,
          };
        },
      );
      const observations = link.sourceObservationIds.map((observationId) => {
        const observation = input.investigation.observations.find(
          (candidate) => candidate.observationId === observationId,
        );
        if (observation === undefined) {
          throw new Error(
            `Selected observation ${observationId} is no longer available.`,
          );
        }
        return observation;
      });
      const firstAreaId =
        observations[0]?.areaId ??
        input.investigation.evidence.find(({ artifactId }) =>
          link.sourceArtifactIds.includes(artifactId),
        )?.currentAreaId;
      if (firstAreaId === undefined || observations.length === 0) {
        throw new Error(
          "Manual drafting requires selected evidence and an inspector observation.",
        );
      }
      const sharedContent = {
        location: input.areaLabel(firstAreaId),
        observation: observations
          .map(({ text }) => text)
          .filter((value, index, values) => values.indexOf(value) === index)
          .join(" "),
        apparentExtent: "Complete the apparent extent before acceptance.",
        qualifiedOpinion: "Complete the qualified opinion before acceptance.",
        uncertainty: [],
        furtherInvestigation: null,
      };
      const content: FindingContent =
        link.module === "building"
          ? {
              ...sharedContent,
              module: "building",
              classification: "other_building_condition",
            }
          : {
              ...sharedContent,
              module: "timber_pest",
              category: "conducive_condition",
            };
      const contentHash = await input.digest(canonicalJson(content));
      const versionId = input.idFactory();
      const finding: ProvisionalFinding = ProvisionalFindingSchema.parse({
        status: "provisional",
        findingId: link.findingCandidateId,
        versionId,
        organizationId: input.investigation.organizationId,
        jobId: input.investigation.jobId,
        moduleId: link.moduleId,
        contentHash,
        content,
        authorship: {
          origin: "human",
          sourceArtifactReferences,
          transcriptSpanReferences: [],
        },
        verifier: { status: "not_required", reason: "human_authored" },
      });
      const packetHash = await input.digest(
        canonicalJson({
          investigationId: input.investigation.investigationId,
          module: link.module,
          sourceArtifactReferences,
          sourceObservationIds: link.sourceObservationIds,
        }),
      );
      return createInvestigationReviewItem({
        reviewId: input.idFactory(),
        investigationId: input.investigation.investigationId,
        finding,
        provenance: {
          packetId: `manual-${link.findingCandidateId}`,
          packetRevision: 1,
          packetHash,
          sourceRevision: 1,
          sourceArtifactIds: link.sourceArtifactIds,
          transcriptSpanIds: [],
          transcriptUncertainty: [],
          assumptions: [],
        },
        checks: [
          {
            checkId: input.idFactory(),
            code: "manual_finding_details_required",
            severity: "blocking",
            state: "open",
            explanation:
              "Complete the classification or category, apparent extent and qualified opinion before accepting this finding.",
          },
        ],
      });
    }),
  );
}
