import type { ModuleType } from "@inspection/contracts";
import {
  type EvidenceAttachmentInput,
  type Investigation,
  type InvestigationModuleLink,
} from "@inspection/domain/inspection/mobile";

import { selectRecentJobCaptures } from "./recent-captures";
import type { CaptureIntentState } from "../capture/types";

export type FindingCandidateModuleSelection = Readonly<{
  module: ModuleType;
  sourceArtifactIds: readonly string[];
  sourceObservationIds: readonly string[];
}>;

export type RevisionBoundFindingCandidateModuleSelection = Readonly<
  FindingCandidateModuleSelection & {
    investigationRevision: number;
  }
>;

export function toggleFindingCandidateSource(
  drafts: readonly FindingCandidateModuleSelection[],
  input: Readonly<{
    module: ModuleType;
    sourceId: string;
    sourceType: "artifact" | "observation";
  }>,
): readonly FindingCandidateModuleSelection[] {
  if (input.sourceId.trim().length === 0) {
    throw new TypeError("A candidate source identity is required");
  }
  const current = drafts.find(({ module }) => module === input.module) ?? {
    module: input.module,
    sourceArtifactIds: [],
    sourceObservationIds: [],
  };
  const toggle = (values: readonly string[]): readonly string[] =>
    Object.freeze(
      values.includes(input.sourceId)
        ? values.filter((value) => value !== input.sourceId)
        : [...values, input.sourceId],
    );
  const next = Object.freeze({
    module: input.module,
    sourceArtifactIds:
      input.sourceType === "artifact"
        ? toggle(current.sourceArtifactIds)
        : Object.freeze([...current.sourceArtifactIds]),
    sourceObservationIds:
      input.sourceType === "observation"
        ? toggle(current.sourceObservationIds)
        : Object.freeze([...current.sourceObservationIds]),
  });
  return Object.freeze([
    ...drafts.filter(({ module }) => module !== input.module),
    next,
  ]);
}

export function confirmFindingCandidateSourceSelection(input: {
  readonly drafts: readonly FindingCandidateModuleSelection[];
  readonly investigation: Investigation;
  readonly module: ModuleType;
}): RevisionBoundFindingCandidateModuleSelection {
  if (input.investigation.status !== "active") {
    throw new TypeError(
      "Candidate sources can only be confirmed for an active investigation",
    );
  }
  const draft = input.drafts.find(({ module }) => module === input.module) ?? {
    module: input.module,
    sourceArtifactIds: [],
    sourceObservationIds: [],
  };
  createFindingCandidateLinks({
    idFactory: () => "candidate-source-validation",
    investigation: input.investigation,
    moduleSelections: [draft],
  });
  return Object.freeze({
    investigationRevision: input.investigation.revision,
    module: draft.module,
    sourceArtifactIds: Object.freeze([...draft.sourceArtifactIds]),
    sourceObservationIds: Object.freeze([...draft.sourceObservationIds]),
  });
}

export function isAttachableCaptureState(
  state: CaptureIntentState,
): state is Extract<CaptureIntentState, "acknowledged"> {
  return state === "acknowledged";
}

export function selectAttachableRecentCaptures(input: {
  readonly beforeOrAt: string;
  readonly captures: readonly EvidenceAttachmentInput[];
  readonly investigation: Investigation;
  readonly limit?: number;
}): readonly EvidenceAttachmentInput[] {
  const attachedIds = new Set(
    input.investigation.evidence.map((evidence) => evidence.artifactId),
  );
  return selectRecentJobCaptures({
    beforeOrAt: input.beforeOrAt,
    captures: input.captures.filter(
      (capture) => !attachedIds.has(capture.artifactId),
    ),
    jobId: input.investigation.jobId,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
}

export function createFindingCandidateLinks(input: {
  readonly idFactory: () => string;
  readonly investigation: Investigation;
  readonly moduleSelections: readonly FindingCandidateModuleSelection[];
}): readonly InvestigationModuleLink[] {
  if (input.moduleSelections.length === 0) {
    throw new TypeError("Select at least one commissioned module");
  }
  if (
    new Set(input.moduleSelections.map(({ module }) => module)).size !==
    input.moduleSelections.length
  ) {
    throw new TypeError("Each professional module may be selected only once");
  }
  const attachedArtifactIds = new Set(
    input.investigation.evidence.map(({ artifactId }) => artifactId),
  );
  const attachedObservationIds = new Set(
    input.investigation.observations.map(({ observationId }) => observationId),
  );
  for (const selection of input.moduleSelections) {
    const commissioned = input.investigation.commissionedModules.find(
      (reference) => reference.module === selection.module,
    );
    if (commissioned === undefined) {
      throw new TypeError(
        `${selection.module === "building" ? "Building" : "Timber Pest"} is not commissioned for this investigation`,
      );
    }
    if (selection.sourceArtifactIds.length === 0) {
      throw new TypeError(
        "Select at least one attached source artifact for each professional module",
      );
    }
    if (
      new Set(selection.sourceArtifactIds).size !==
      selection.sourceArtifactIds.length
    ) {
      throw new TypeError(
        "A professional module cannot repeat a source artifact",
      );
    }
    for (const artifactId of selection.sourceArtifactIds) {
      if (!attachedArtifactIds.has(artifactId)) {
        throw new TypeError(
          `Selected source artifact ${artifactId} is not attached to this investigation`,
        );
      }
    }
    if (selection.sourceObservationIds.length === 0) {
      throw new TypeError(
        "Select at least one inspector observation for each professional module",
      );
    }
    if (
      new Set(selection.sourceObservationIds).size !==
      selection.sourceObservationIds.length
    ) {
      throw new TypeError(
        "A professional module cannot repeat a source observation",
      );
    }
    for (const observationId of selection.sourceObservationIds) {
      if (!attachedObservationIds.has(observationId)) {
        throw new TypeError(
          `Selected source observation ${observationId} is not attached to this investigation`,
        );
      }
    }
  }
  return Object.freeze(
    input.moduleSelections.map((selection) => {
      const commissioned = input.investigation.commissionedModules.find(
        (reference) => reference.module === selection.module,
      );
      if (commissioned === undefined) {
        throw new TypeError("Validated commissioned module disappeared");
      }
      return Object.freeze({
        findingCandidateId: input.idFactory(),
        module: selection.module,
        moduleId: commissioned.moduleId,
        sourceArtifactIds: Object.freeze([...selection.sourceArtifactIds]),
        sourceObservationIds: Object.freeze([
          ...selection.sourceObservationIds,
        ]),
      });
    }),
  );
}
