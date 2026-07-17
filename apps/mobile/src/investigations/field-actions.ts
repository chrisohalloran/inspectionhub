import type { ModuleType } from "@inspection/contracts";
import {
  orderedInvestigationEvidence,
  type EvidenceAttachmentInput,
  type Investigation,
  type InvestigationModuleLink,
} from "@inspection/domain/inspection/mobile";

import { selectRecentJobCaptures } from "./recent-captures";
import type { CaptureIntentState } from "../capture/types";

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
  readonly modules: readonly ModuleType[];
}): readonly InvestigationModuleLink[] {
  if (input.modules.length === 0) {
    throw new TypeError("Select at least one commissioned module");
  }
  if (new Set(input.modules).size !== input.modules.length) {
    throw new TypeError("Each professional module may be selected only once");
  }
  const sourceArtifactIds = orderedInvestigationEvidence(
    input.investigation,
  ).map((evidence) => evidence.artifactId);
  return input.modules.map((module) => {
    const commissioned = input.investigation.commissionedModules.find(
      (reference) => reference.module === module,
    );
    if (commissioned === undefined) {
      throw new TypeError(
        `${module === "building" ? "Building" : "Timber Pest"} is not commissioned for this investigation`,
      );
    }
    return {
      findingCandidateId: input.idFactory(),
      module,
      moduleId: commissioned.moduleId,
      sourceArtifactIds,
    };
  });
}
