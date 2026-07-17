import type { FieldWorkflowSnapshot } from "../capture/types";
import { markReviewItemStale } from "../review/investigation-review";

type Module = "building" | "timber_pest";

export type ProfessionalStateInvalidation = Pick<
  FieldWorkflowSnapshot,
  | "approvedModules"
  | "deliveryState"
  | "moduleApprovalBindings"
  | "packageManifestSha256"
  | "processedFindingCandidateIds"
  | "reviewItems"
>;

export function invalidateProfessionalModulesForCandidates(input: {
  readonly candidates: readonly Readonly<{
    findingCandidateId: string;
    module: Module;
  }>[];
  readonly investigationId: string;
  readonly recordedAt: string;
  readonly workflow: FieldWorkflowSnapshot;
}): ProfessionalStateInvalidation {
  const candidateByModule = new Map<Module, string>();
  const unprocessedCandidates = input.candidates.filter(
    (candidate) =>
      !input.workflow.processedFindingCandidateIds.includes(
        candidate.findingCandidateId,
      ),
  );
  for (const candidate of unprocessedCandidates) {
    if (candidateByModule.has(candidate.module)) {
      throw new Error(
        `A completed investigation cannot create duplicate ${candidate.module} candidates`,
      );
    }
    candidateByModule.set(candidate.module, candidate.findingCandidateId);
  }
  if (input.candidates.length === 0) {
    throw new Error("Professional invalidation requires a finding candidate");
  }
  if (candidateByModule.size === 0) {
    return {
      approvedModules: input.workflow.approvedModules,
      deliveryState: input.workflow.deliveryState,
      moduleApprovalBindings: input.workflow.moduleApprovalBindings,
      packageManifestSha256: input.workflow.packageManifestSha256,
      processedFindingCandidateIds: input.workflow.processedFindingCandidateIds,
      reviewItems: input.workflow.reviewItems,
    };
  }
  return {
    approvedModules: input.workflow.approvedModules.filter(
      (module) => !candidateByModule.has(module),
    ),
    deliveryState: "waiting_for_approval",
    moduleApprovalBindings: input.workflow.moduleApprovalBindings.filter(
      (binding) => !candidateByModule.has(binding.module),
    ),
    packageManifestSha256: null,
    processedFindingCandidateIds: [
      ...input.workflow.processedFindingCandidateIds,
      ...unprocessedCandidates.map((candidate) => candidate.findingCandidateId),
    ],
    reviewItems: input.workflow.reviewItems.map((item) => {
      const candidateId = candidateByModule.get(item.module);
      return candidateId === undefined ||
        item.investigationId === input.investigationId
        ? item
        : markReviewItemStale(item, candidateId, input.recordedAt);
    }),
  };
}

export function reconcileProfessionalModulesForCandidates(input: {
  readonly candidates: readonly Readonly<{
    findingCandidateId: string;
    module: Module;
  }>[];
  readonly investigationId: string;
  readonly recordedAt: string;
  readonly workflow: FieldWorkflowSnapshot;
}): ProfessionalStateInvalidation | undefined {
  const invalidated = invalidateProfessionalModulesForCandidates(input);
  const current: ProfessionalStateInvalidation = {
    approvedModules: input.workflow.approvedModules,
    deliveryState: input.workflow.deliveryState,
    moduleApprovalBindings: input.workflow.moduleApprovalBindings,
    packageManifestSha256: input.workflow.packageManifestSha256,
    processedFindingCandidateIds: input.workflow.processedFindingCandidateIds,
    reviewItems: input.workflow.reviewItems,
  };
  return JSON.stringify(invalidated) === JSON.stringify(current)
    ? undefined
    : invalidated;
}
