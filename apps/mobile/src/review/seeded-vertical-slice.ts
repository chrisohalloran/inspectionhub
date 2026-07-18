import {
  ProvisionalFindingSchema,
  type FindingContent,
  type ProvisionalFinding,
} from "@inspection/contracts";
import type {
  CoverageLedger,
  Investigation,
  InvestigationModuleLink,
} from "@inspection/domain/inspection/mobile";

import { canonicalJson } from "../integrity/canonical-json";
import {
  createInvestigationReviewItem,
  type InvestigationReviewItem,
} from "./investigation-review";

export const SEEDED_CRACKED_TILE_SCENARIO_ID =
  "inspectionhub.synthetic.cracked-tiles.v1" as const;
export const SEEDED_CRACKED_TILE_OBSERVATION_TEXT =
  "Cracking was observed through several tiles in the shower base and main bathroom floor area." as const;

export type SeededSyntheticScenarioId = typeof SEEDED_CRACKED_TILE_SCENARIO_ID;

export type SeededSourcePacket = Readonly<{
  schemaVersion: "seeded-source-packet-v1";
  scenarioId: SeededSyntheticScenarioId;
  packetId: string;
  packetRevision: 1;
  canonicalHash: string;
  organizationId: string;
  jobId: string;
  investigationId: string;
  investigationRevision: number;
  createdAt: string;
  model: "deterministic-synthetic-build-week-v1";
  promptVersion: "seeded-inspection-draft-v1";
  skillVersions: readonly [
    "building-inspection@1.0.0",
    "timber-pest-inspection@1.0.0",
    "report-language@1.0.0",
  ];
  modules: readonly InvestigationModuleLink[];
  evidence: readonly Readonly<{
    artifactId: string;
    artifactKind: "manual_note" | "photo" | "voice_note";
    contentHash: string;
    captureAreaId: string;
    currentAreaId: string;
    capturedAt: string;
    captureSequence: number;
  }>[];
  observations: Investigation["observations"];
  measurements: Investigation["measurements"];
  coverageRevision: number;
  unknowns: readonly string[];
}>;

type Digest = (payload: string) => Promise<string>;

export async function createSeededInvestigationReview(input: {
  readonly scenarioId: SeededSyntheticScenarioId;
  readonly investigation: Investigation;
  readonly coverage: CoverageLedger;
  readonly artifactHash: (artifactId: string) => string | undefined;
  readonly areaLabel: (areaId: string) => string;
  readonly createdAt: string;
  readonly digest: Digest;
  readonly idFactory: () => string;
}): Promise<
  Readonly<{
    packet: SeededSourcePacket;
    reviewItems: readonly InvestigationReviewItem[];
  }>
> {
  if (input.scenarioId !== SEEDED_CRACKED_TILE_SCENARIO_ID) {
    throw new Error("Unsupported deterministic synthetic scenario");
  }
  const completion = input.investigation.completion;
  if (
    input.investigation.status !== "completed_findings" ||
    completion?.outcome !== "finding_candidates" ||
    completion.moduleLinks.length === 0
  ) {
    throw new Error(
      "A seeded draft requires a completed investigation with finding candidates",
    );
  }
  if (
    input.coverage.organizationId !== input.investigation.organizationId ||
    input.coverage.jobId !== input.investigation.jobId
  ) {
    throw new Error("Draft coverage belongs to a different inspection");
  }
  const linkedModules = completion.moduleLinks.map(({ module, moduleId }) => ({
    module,
    moduleId,
  }));
  if (
    !sameExactModuleSet(
      input.investigation.commissionedModules,
      input.coverage.commissionedModules,
    ) ||
    !isExactCommissionedModuleSubset(
      input.investigation.commissionedModules,
      linkedModules,
    )
  ) {
    throw new Error(
      "Seeded packet requires exact commissioned module identities",
    );
  }
  for (const link of completion.moduleLinks) {
    if (link.module !== "building") {
      throw new Error(
        "The cracked-tile synthetic scenario supports only the Building module",
      );
    }
    if (
      link.sourceArtifactIds.length === 0 ||
      new Set(link.sourceArtifactIds).size !== link.sourceArtifactIds.length
    ) {
      throw new Error(
        "Each seeded candidate requires unique inspector-selected field evidence",
      );
    }
    if (link.sourceObservationIds.length !== 1) {
      throw new Error(
        "The cracked-tile synthetic scenario requires exactly one selected inspector observation",
      );
    }
  }
  const selectedIds = new Set(
    completion.moduleLinks.flatMap((link) => link.sourceArtifactIds),
  );
  if (selectedIds.size === 0) {
    throw new Error(
      "A seeded draft requires inspector-selected field evidence",
    );
  }
  const evidence = input.investigation.evidence
    .filter(({ artifactId }) => selectedIds.has(artifactId))
    .map((item) => {
      const contentHash = input.artifactHash(item.artifactId);
      if (contentHash === undefined || !/^[a-f0-9]{64}$/u.test(contentHash)) {
        throw new Error(
          `Selected evidence ${item.artifactId} has no verified local content hash`,
        );
      }
      return {
        artifactId: item.artifactId,
        artifactKind: item.artifactKind,
        contentHash,
        captureAreaId: item.captureAreaId,
        currentAreaId: item.currentAreaId,
        capturedAt: item.capturedAt,
        captureSequence: item.captureSequence,
      } as const;
    });
  if (
    evidence.length !== selectedIds.size ||
    completion.moduleLinks.some((link) =>
      link.sourceArtifactIds.some(
        (artifactId) =>
          !evidence.some((item) => item.artifactId === artifactId),
      ),
    )
  ) {
    throw new Error(
      "Every candidate source must remain attached to the completed investigation",
    );
  }
  const selectedObservationIds = new Set(
    completion.moduleLinks.flatMap((link) => link.sourceObservationIds),
  );
  const observations = input.investigation.observations.filter(
    ({ observationId }) => selectedObservationIds.has(observationId),
  );
  if (
    observations.length !== selectedObservationIds.size ||
    observations.some(
      (observation) =>
        observation.text !== SEEDED_CRACKED_TILE_OBSERVATION_TEXT ||
        observation.recordedByInspectorId !==
          input.investigation.startedByInspectorId,
    )
  ) {
    throw new Error(
      "Selected observation is not compatible with the cracked-tile synthetic scenario",
    );
  }
  const packetWithoutHash = {
    schemaVersion: "seeded-source-packet-v1" as const,
    scenarioId: input.scenarioId,
    packetId: input.idFactory(),
    packetRevision: 1 as const,
    organizationId: input.investigation.organizationId,
    jobId: input.investigation.jobId,
    investigationId: input.investigation.investigationId,
    investigationRevision: input.investigation.revision,
    createdAt: input.createdAt,
    model: "deterministic-synthetic-build-week-v1" as const,
    promptVersion: "seeded-inspection-draft-v1" as const,
    skillVersions: [
      "building-inspection@1.0.0",
      "timber-pest-inspection@1.0.0",
      "report-language@1.0.0",
    ] as const,
    modules: completion.moduleLinks,
    evidence,
    observations,
    measurements: input.investigation.measurements,
    coverageRevision: input.coverage.revision,
    unknowns: [
      "The seeded draft does not infer a condition from image pixels.",
      "Concealed construction and inaccessible surfaces remain outside the visual inspection.",
    ],
  };
  const packet: SeededSourcePacket = Object.freeze({
    ...packetWithoutHash,
    canonicalHash: await input.digest(canonicalJson(packetWithoutHash)),
  });
  const reviewItems = await Promise.all(
    completion.moduleLinks.map(async (link) => {
      const sourceEvidence = link.sourceArtifactIds.map((artifactId) => {
        const source = evidence.find((item) => item.artifactId === artifactId);
        if (source === undefined) {
          throw new Error(
            "Candidate evidence is missing from its exact packet",
          );
        }
        return {
          kind: "original" as const,
          artifactId: source.artifactId,
          contentHash: source.contentHash,
        };
      });
      const content = seededFindingContent(link, observations, input.areaLabel);
      const contentHash = await input.digest(canonicalJson(content));
      const versionId = input.idFactory();
      const finding: ProvisionalFinding = ProvisionalFindingSchema.parse({
        status: "provisional",
        findingId: link.findingCandidateId,
        versionId,
        organizationId: packet.organizationId,
        jobId: packet.jobId,
        moduleId: link.moduleId,
        contentHash,
        content,
        authorship: {
          origin: "ai",
          model: packet.model,
          promptVersion: packet.promptVersion,
          skillVersions: packet.skillVersions,
          packetRevision: packet.packetRevision,
          sourceArtifactReferences: sourceEvidence,
          transcriptSpanReferences: [],
        },
        verifier: {
          status: "passed",
          draftVersionId: versionId,
          contentHash,
          verifierVersion: "deterministic-seeded-verifier-v1",
          verifiedAt: input.createdAt,
        },
      });
      return createInvestigationReviewItem({
        reviewId: input.idFactory(),
        investigationId: packet.investigationId,
        finding,
        provenance: {
          packetId: packet.packetId,
          packetRevision: packet.packetRevision,
          packetHash: packet.canonicalHash,
          sourceRevision: 1,
          sourceArtifactIds: link.sourceArtifactIds,
          transcriptSpanIds: [],
          transcriptUncertainty: [],
          assumptions: packet.unknowns,
        },
        checks: [
          {
            checkId: input.idFactory(),
            code: "seeded_wording_inspector_review",
            severity: "advisory",
            state: "open",
            explanation:
              "This deterministic Build Week wording must be checked against the inspector's site observation before acceptance.",
          },
        ],
      });
    }),
  );
  return Object.freeze({ packet, reviewItems: Object.freeze(reviewItems) });
}

function sameExactModuleSet(
  left: readonly Readonly<{ module: string; moduleId: string }>[],
  right: readonly Readonly<{ module: string; moduleId: string }>[],
): boolean {
  const identity = (reference: { module: string; moduleId: string }) =>
    JSON.stringify([reference.module, reference.moduleId]);
  const leftKeys = left.map(identity).sort();
  const rightKeys = right.map(identity).sort();
  return (
    hasUniqueModuleTypes(left) &&
    hasUniqueModuleTypes(right) &&
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index])
  );
}

function isExactCommissionedModuleSubset(
  commissioned: readonly Readonly<{ module: string; moduleId: string }>[],
  selected: readonly Readonly<{ module: string; moduleId: string }>[],
): boolean {
  if (
    selected.length === 0 ||
    !hasUniqueModuleTypes(commissioned) ||
    !hasUniqueModuleTypes(selected)
  ) {
    return false;
  }
  const commissionedIdentities = new Set(
    commissioned.map(({ module, moduleId }) =>
      JSON.stringify([module, moduleId]),
    ),
  );
  return selected.every(({ module, moduleId }) =>
    commissionedIdentities.has(JSON.stringify([module, moduleId])),
  );
}

function hasUniqueModuleTypes(
  references: readonly Readonly<{ module: string }>[],
): boolean {
  return (
    new Set(references.map(({ module }) => module)).size === references.length
  );
}

function seededFindingContent(
  link: InvestigationModuleLink,
  observations: Investigation["observations"],
  areaLabel: (areaId: string) => string,
): FindingContent {
  if (link.module !== "building" || link.sourceObservationIds.length !== 1) {
    throw new Error(
      "The cracked-tile synthetic scenario cannot draft this candidate",
    );
  }
  const observation = observations.find(
    ({ observationId }) => observationId === link.sourceObservationIds[0],
  );
  if (
    observation === undefined ||
    observation.text !== SEEDED_CRACKED_TILE_OBSERVATION_TEXT
  ) {
    throw new Error(
      "Selected observation is not compatible with the cracked-tile synthetic scenario",
    );
  }
  const location = areaLabel(observation.areaId);
  if (location.trim().length === 0) {
    throw new Error("Selected observation has no reportable area label");
  }
  return {
    module: "building",
    location,
    observation: observation.text,
    apparentExtent:
      "Cracking was recorded across several tiles in the shower base and adjoining bathroom floor area.",
    qualifiedOpinion:
      "The observed pattern is consistent with possible movement in the concealed floor or subfloor assembly; the concealed construction and membrane condition were not visually confirmed.",
    uncertainty: [
      "The supporting floor construction, tile underlay and waterproof membrane were concealed from view.",
    ],
    furtherInvestigation:
      "Engage a suitably licensed and qualified builder or tiler to investigate.",
    classification: "major_defect",
  };
}
