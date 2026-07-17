import type { FieldWorkflowSnapshot } from "../capture/types";
import type { InvestigationModuleLink } from "@inspection/domain/inspection/mobile";
import { markReviewItemStale } from "../review/investigation-review";

export type EvidenceRiskInvalidation = Pick<
  FieldWorkflowSnapshot,
  | "approvedModules"
  | "deliveryState"
  | "moduleApprovalBindings"
  | "packageManifestSha256"
  | "recipientPackage"
  | "reviewItems"
>;

export function findingCandidateAtRiskSourceIds(input: {
  readonly captureIds: readonly string[];
  readonly moduleLinks: readonly InvestigationModuleLink[];
}): readonly string[] {
  const atRisk = new Set(input.captureIds);
  return Object.freeze([
    ...new Set(
      input.moduleLinks.flatMap(({ sourceArtifactIds }) =>
        sourceArtifactIds.filter((artifactId) => atRisk.has(artifactId)),
      ),
    ),
  ]);
}

/**
 * Missing or corrupt originals invalidate every professional decision that
 * cites them before the field shell is allowed to become ready.
 */
export function invalidateProfessionalStateForEvidenceRisk(input: {
  readonly captureIds: readonly string[];
  readonly recordedAt: string;
  readonly workflow: FieldWorkflowSnapshot;
}): EvidenceRiskInvalidation | undefined {
  const atRisk = new Set(input.captureIds);
  if (atRisk.size === 0) return undefined;
  const affectedModules = new Set<"building" | "timber_pest">();
  const nextReviewItems = input.workflow.reviewItems.map((item) => {
    const riskySource = item.finding.authorship.sourceArtifactReferences.find(
      ({ artifactId }) => atRisk.has(artifactId),
    );
    if (riskySource === undefined) return item;
    affectedModules.add(item.module);
    return markReviewItemStale(item, riskySource.artifactId, input.recordedAt);
  });
  if (affectedModules.size === 0) return undefined;
  return {
    approvedModules: input.workflow.approvedModules.filter(
      (module) => !affectedModules.has(module),
    ),
    deliveryState: "waiting_for_approval",
    moduleApprovalBindings: input.workflow.moduleApprovalBindings.filter(
      (binding) => !affectedModules.has(binding.module),
    ),
    packageManifestSha256: null,
    recipientPackage: null,
    reviewItems: nextReviewItems,
  };
}
