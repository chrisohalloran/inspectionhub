import type {
  FieldWorkflowSnapshot,
  FieldSessionSnapshot,
  ModuleApprovalBinding,
} from "../capture/types";
import type { InvestigationReviewItem } from "../review/investigation-review";
import type {
  Investigation,
  ProfessionalModuleReference,
} from "@inspection/domain/inspection/mobile";
import { ProvisionalFindingSchema } from "@inspection/contracts";
import { reconcileProfessionalModulesForCandidates } from "../completion/professional-state";

const investigationStates = new Set([
  "active",
  "completed_findings",
  "completed_no_reportable_finding",
  "none",
  "paused",
]);
const deliveryStates = new Set([
  "cancelled",
  "failed",
  "provider_accepted",
  "queued",
  "sending",
  "sent",
  "unknown",
  "waiting_for_approval",
  "waiting_for_evidence",
]);
const workflowTransitions = new Set([
  "delivery_state_changed",
  "investigation_completed",
  "investigation_paused",
  "investigation_reconciled",
  "investigation_resumed",
  "investigation_started",
  "module_approved",
  "package_confirmed",
  "professional_state_changed",
  "review_changed",
  "workflow_initialized",
]);

function parseCommissionedModuleReferences(
  value: unknown,
): readonly ProfessionalModuleReference[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const references = value as unknown[];
  if (!references.every(isProfessionalModuleReference)) return undefined;
  if (
    new Set(references.map((reference) => reference.module)).size !==
      references.length ||
    new Set(references.map((reference) => reference.moduleId)).size !==
      references.length
  ) {
    return undefined;
  }
  return references;
}

function isProfessionalModuleReference(
  value: unknown,
): value is ProfessionalModuleReference {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.module === "building" || candidate.module === "timber_pest") &&
    typeof candidate.moduleId === "string" &&
    candidate.moduleId.length > 0
  );
}

export function initialFieldWorkflow(
  reviewItems: readonly InvestigationReviewItem[],
  updatedAt: string = new Date().toISOString(),
): FieldWorkflowSnapshot {
  return cloneFieldWorkflow({
    approvedModules: [],
    deliveryState: "waiting_for_approval",
    investigationStatus: "none",
    lastTransition: "workflow_initialized",
    moduleApprovalBindings: [],
    packageManifestSha256: null,
    processedFindingCandidateIds: [],
    reviewItems,
    revision: 1,
    updatedAt,
  });
}

export function cloneFieldSession(
  value: FieldSessionSnapshot,
): FieldSessionSnapshot {
  return {
    ...value,
    cachedAssignedJobIds: [...value.cachedAssignedJobIds],
    commissionedModules: value.commissionedModules.map((reference) => ({
      ...reference,
    })),
    ...(value.workflow === undefined
      ? {}
      : { workflow: cloneFieldWorkflow(value.workflow) }),
  };
}

export function cloneFieldWorkflow(
  value: FieldWorkflowSnapshot,
): FieldWorkflowSnapshot {
  return JSON.parse(JSON.stringify(value)) as FieldWorkflowSnapshot;
}

export function reconcileInvestigationStatus(
  workflow: FieldWorkflowSnapshot,
  investigationStatus: FieldWorkflowSnapshot["investigationStatus"],
  updatedAt: string = new Date().toISOString(),
): FieldWorkflowSnapshot {
  const open =
    investigationStatus === "active" || investigationStatus === "paused";
  const mustClearPackage =
    open &&
    (workflow.packageManifestSha256 !== null ||
      workflow.deliveryState !== "waiting_for_approval");
  if (
    workflow.investigationStatus === investigationStatus &&
    !mustClearPackage
  ) {
    return workflow;
  }
  return cloneFieldWorkflow({
    ...workflow,
    ...(open
      ? {
          deliveryState: "waiting_for_approval" as const,
          packageManifestSha256: null,
        }
      : {}),
    investigationStatus,
    lastTransition: "investigation_reconciled",
    revision: workflow.revision + 1,
    updatedAt,
  });
}

export function reconcileFieldSessionInvestigation(
  session: FieldSessionSnapshot,
  investigation: Investigation,
  updatedAt: string = new Date().toISOString(),
): FieldSessionSnapshot {
  assertInvestigationMatchesFieldSession(session, investigation);
  const open =
    investigation.status === "active" || investigation.status === "paused";
  if (open) {
    if (
      session.activeInvestigationId === investigation.investigationId &&
      session.areaId === investigation.currentAreaId
    ) {
      return session;
    }
    return cloneFieldSession({
      ...session,
      activeInvestigationId: investigation.investigationId,
      areaId: investigation.currentAreaId,
      updatedAt,
    });
  }
  if (
    session.activeInvestigationId === undefined &&
    session.lastInvestigationId === investigation.investigationId &&
    session.areaId === investigation.currentAreaId
  ) {
    return session;
  }
  const { activeInvestigationId: _removed, ...withoutActive } = session;
  void _removed;
  return cloneFieldSession({
    ...withoutActive,
    areaId: investigation.currentAreaId,
    lastInvestigationId: investigation.investigationId,
    updatedAt,
  });
}

export function reconcileDurableProfessionalState(
  session: FieldSessionSnapshot,
  investigation: Investigation,
  updatedAt: string = new Date().toISOString(),
): Readonly<{
  session: FieldSessionSnapshot;
  workflow: FieldWorkflowSnapshot;
}> {
  if (session.workflow === undefined) {
    throw new Error("Durable field session has no professional workflow");
  }
  assertInvestigationMatchesFieldSession(session, investigation);
  const statusWorkflow = reconcileInvestigationStatus(
    session.workflow,
    investigation.status,
    updatedAt,
  );
  const candidatePatch =
    investigation.completion?.outcome === "finding_candidates"
      ? reconcileProfessionalModulesForCandidates({
          candidates: investigation.completion.moduleLinks,
          investigationId: investigation.investigationId,
          recordedAt: investigation.completion.completedAt,
          workflow: statusWorkflow,
        })
      : undefined;
  const workflow =
    candidatePatch === undefined
      ? statusWorkflow
      : cloneFieldWorkflow({
          ...statusWorkflow,
          ...candidatePatch,
          lastTransition: "professional_state_changed",
          revision: session.workflow.revision + 1,
          updatedAt,
        });
  const sessionWithWorkflow =
    workflow === session.workflow
      ? session
      : cloneFieldSession({
          ...session,
          updatedAt,
          workflow,
        });
  return {
    session: reconcileFieldSessionInvestigation(
      sessionWithWorkflow,
      investigation,
      updatedAt,
    ),
    workflow,
  };
}

export function assertInvestigationMatchesFieldSession(
  session: FieldSessionSnapshot,
  investigation: Investigation,
): void {
  const expectedModules = [...session.commissionedModules].sort((left, right) =>
    left.module.localeCompare(right.module),
  );
  const actualModules = [...investigation.commissionedModules].sort(
    (left, right) => left.module.localeCompare(right.module),
  );
  if (
    investigation.jobId !== session.jobId ||
    investigation.organizationId !== session.organizationId ||
    actualModules.length !== expectedModules.length ||
    actualModules.some(
      (reference, index) =>
        reference.module !== expectedModules[index]?.module ||
        reference.moduleId !== expectedModules[index]?.moduleId,
    )
  ) {
    throw new Error(
      "Durable investigation belongs to a different job or professional commission",
    );
  }
}

export function parseFieldSession(value: unknown): FieldSessionSnapshot {
  if (typeof value !== "object" || value === null) {
    throw new Error("Stored field session is invalid");
  }
  const candidate = value as Partial<FieldSessionSnapshot>;
  const moduleReferences = parseCommissionedModuleReferences(
    candidate.commissionedModules,
  );
  if (
    (candidate.activeInvestigationId !== undefined &&
      typeof candidate.activeInvestigationId !== "string") ||
    typeof candidate.areaId !== "string" ||
    !Array.isArray(candidate.cachedAssignedJobIds) ||
    !candidate.cachedAssignedJobIds.every((item) => typeof item === "string") ||
    moduleReferences === undefined ||
    typeof candidate.deviceId !== "string" ||
    !["enrolled", "lost", "revoked"].includes(candidate.deviceState ?? "") ||
    typeof candidate.jobId !== "string" ||
    !candidate.cachedAssignedJobIds.includes(candidate.jobId) ||
    (candidate.lastInvestigationId !== undefined &&
      typeof candidate.lastInvestigationId !== "string") ||
    !Number.isSafeInteger(candidate.nextSequence) ||
    (candidate.nextSequence ?? 0) < 1 ||
    typeof candidate.organizationId !== "string" ||
    candidate.organizationId.length === 0 ||
    !["expired", "valid"].includes(candidate.session ?? "") ||
    typeof candidate.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.updatedAt))
  ) {
    throw new Error("Stored field session is invalid");
  }
  const session = {
    ...(candidate as FieldSessionSnapshot),
    commissionedModules: moduleReferences,
  };
  const workflow =
    candidate.workflow === undefined
      ? undefined
      : parseFieldWorkflow(candidate.workflow);
  const moduleByType = new Map(
    session.commissionedModules.map((reference) => [
      reference.module,
      reference.moduleId,
    ]),
  );
  if (
    workflow?.reviewItems.some(
      (item) =>
        item.finding.jobId !== session.jobId ||
        item.finding.organizationId !== session.organizationId ||
        moduleByType.get(item.module) !== item.finding.moduleId,
    ) === true
  ) {
    throw new Error(
      "Stored field workflow belongs to a different job or professional commission",
    );
  }
  return cloneFieldSession({
    ...session,
    ...(workflow === undefined ? {} : { workflow }),
  });
}

export function parseFieldWorkflow(value: unknown): FieldWorkflowSnapshot {
  if (typeof value !== "object" || value === null) {
    throw new Error("Stored field workflow is invalid");
  }
  const candidate = value as Partial<FieldWorkflowSnapshot>;
  if (
    !Array.isArray(candidate.approvedModules) ||
    !candidate.approvedModules.every(
      (module) => module === "building" || module === "timber_pest",
    ) ||
    new Set(candidate.approvedModules).size !==
      candidate.approvedModules.length ||
    typeof candidate.deliveryState !== "string" ||
    !deliveryStates.has(candidate.deliveryState) ||
    typeof candidate.investigationStatus !== "string" ||
    !investigationStates.has(candidate.investigationStatus) ||
    typeof candidate.lastTransition !== "string" ||
    !workflowTransitions.has(candidate.lastTransition) ||
    !Array.isArray(candidate.moduleApprovalBindings) ||
    !candidate.moduleApprovalBindings.every(isStoredModuleApprovalBinding) ||
    new Set(candidate.moduleApprovalBindings.map((binding) => binding.module))
      .size !== candidate.moduleApprovalBindings.length ||
    candidate.approvedModules.some(
      (module) =>
        !candidate.moduleApprovalBindings?.some(
          (binding) => binding.module === module,
        ),
    ) ||
    candidate.moduleApprovalBindings.some(
      (binding) => !candidate.approvedModules?.includes(binding.module),
    ) ||
    !Array.isArray(candidate.processedFindingCandidateIds) ||
    !candidate.processedFindingCandidateIds.every(
      (candidateId) =>
        typeof candidateId === "string" && candidateId.length > 0,
    ) ||
    new Set(candidate.processedFindingCandidateIds).size !==
      candidate.processedFindingCandidateIds.length ||
    !Array.isArray(candidate.reviewItems) ||
    !candidate.reviewItems.every(isStoredReviewItem) ||
    new Set(candidate.reviewItems.map((item) => item.reviewId)).size !==
      candidate.reviewItems.length ||
    !Number.isSafeInteger(candidate.revision) ||
    (candidate.revision ?? 0) < 1 ||
    typeof candidate.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.updatedAt)) ||
    !(
      candidate.packageManifestSha256 === null ||
      (typeof candidate.packageManifestSha256 === "string" &&
        /^[a-f0-9]{64}$/u.test(candidate.packageManifestSha256))
    ) ||
    (candidate.packageManifestSha256 === null &&
      candidate.deliveryState !== "waiting_for_approval") ||
    (candidate.packageManifestSha256 !== null &&
      (candidate.approvedModules.length === 0 ||
        candidate.deliveryState === "waiting_for_approval")) ||
    ((candidate.investigationStatus === "active" ||
      candidate.investigationStatus === "paused") &&
      (candidate.packageManifestSha256 !== null ||
        candidate.deliveryState !== "waiting_for_approval"))
  ) {
    throw new Error("Stored field workflow is invalid");
  }
  const workflow = candidate as FieldWorkflowSnapshot;
  for (const binding of workflow.moduleApprovalBindings) {
    const moduleItems = workflow.reviewItems.filter(
      (item) => item.module === binding.module,
    );
    const acceptedVersions = moduleItems
      .filter((item) => item.status === "accepted")
      .map((item) => ({
        contentHash: item.finding.contentHash,
        reviewId: item.reviewId,
        versionId: item.finding.versionId,
      }))
      .sort((left, right) => left.reviewId.localeCompare(right.reviewId));
    if (
      moduleItems.length === 0 ||
      !moduleItems.every((item) => item.status === "accepted") ||
      JSON.stringify(binding.reviewVersions) !==
        JSON.stringify(acceptedVersions)
    ) {
      throw new Error("Stored field workflow is invalid");
    }
  }
  return cloneFieldWorkflow(workflow);
}

function isStoredModuleApprovalBinding(
  value: unknown,
): value is FieldWorkflowSnapshot["moduleApprovalBindings"][number] {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<
    FieldWorkflowSnapshot["moduleApprovalBindings"][number]
  >;
  return (
    (candidate.module === "building" || candidate.module === "timber_pest") &&
    Number.isSafeInteger(candidate.coverageRevision) &&
    (candidate.coverageRevision ?? -1) >= 0 &&
    typeof candidate.snapshotSha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(candidate.snapshotSha256) &&
    isStoredApprovalReviewVersions(candidate.reviewVersions)
  );
}

function isStoredApprovalReviewVersions(
  value: unknown,
): value is ModuleApprovalBinding["reviewVersions"] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const versions: unknown[] = value;
  return versions.every(isStoredApprovalReviewVersion);
}

function isStoredApprovalReviewVersion(
  value: unknown,
): value is ModuleApprovalBinding["reviewVersions"][number] {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<
    ModuleApprovalBinding["reviewVersions"][number]
  >;
  return (
    typeof candidate.contentHash === "string" &&
    /^[a-f0-9]{64}$/u.test(candidate.contentHash) &&
    typeof candidate.reviewId === "string" &&
    candidate.reviewId.length > 0 &&
    typeof candidate.versionId === "string" &&
    candidate.versionId.length > 0
  );
}

function isStoredReviewItem(value: unknown): value is InvestigationReviewItem {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<InvestigationReviewItem>;
  const findingResult = ProvisionalFindingSchema.safeParse(candidate.finding);
  if (
    typeof candidate.reviewId === "string" &&
    candidate.reviewId.length > 0 &&
    typeof candidate.investigationId === "string" &&
    candidate.investigationId.length > 0 &&
    (candidate.module === "building" || candidate.module === "timber_pest") &&
    ["accepted", "awaiting_decision", "rejected", "stale"].includes(
      candidate.status ?? "",
    ) &&
    ["ai_unchanged", "ai_reverified", "human_authored", null].includes(
      candidate.decisionMode ?? null,
    ) &&
    findingResult.success &&
    findingResult.data.content.module === candidate.module &&
    isStoredReviewProvenance(candidate.provenance, findingResult.data) &&
    isStoredReviewChecks(candidate.checks)
  ) {
    const checks = candidate.checks;
    if (candidate.status === "accepted") {
      return (
        candidate.decisionMode !== null &&
        candidate.rejectionReason === null &&
        candidate.supersededByVersionId === null &&
        !checks.some(
          (check) => check.severity === "blocking" && check.state === "open",
        ) &&
        findingIsExactlyConfirmable(findingResult.data)
      );
    }
    if (candidate.status === "rejected") {
      return (
        candidate.decisionMode === null &&
        typeof candidate.rejectionReason === "string" &&
        candidate.rejectionReason.trim().length > 0
      );
    }
    if (candidate.status === "stale") {
      return (
        candidate.decisionMode === null &&
        typeof candidate.supersededByVersionId === "string" &&
        candidate.supersededByVersionId.length > 0
      );
    }
    return (
      candidate.decisionMode === null &&
      candidate.rejectionReason === null &&
      candidate.supersededByVersionId === null
    );
  }
  return false;
}

function isStoredReviewProvenance(
  value: unknown,
  finding: InvestigationReviewItem["finding"],
): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<InvestigationReviewItem["provenance"]>;
  if (
    typeof candidate.packetId !== "string" ||
    candidate.packetId.length === 0 ||
    !Number.isSafeInteger(candidate.packetRevision) ||
    (candidate.packetRevision ?? 0) < 1 ||
    typeof candidate.packetHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(candidate.packetHash) ||
    !Number.isSafeInteger(candidate.sourceRevision) ||
    (candidate.sourceRevision ?? 0) < 1 ||
    !isStringArray(candidate.sourceArtifactIds) ||
    !isStringArray(candidate.transcriptSpanIds) ||
    !isStringArray(candidate.transcriptUncertainty) ||
    !isStringArray(candidate.assumptions)
  ) {
    return false;
  }
  const authoredArtifacts = finding.authorship.sourceArtifactReferences.map(
    ({ artifactId }) => artifactId,
  );
  const authoredSpans = finding.authorship.transcriptSpanReferences;
  return (
    sameStringSet(authoredArtifacts, candidate.sourceArtifactIds) &&
    sameStringSet(authoredSpans, candidate.transcriptSpanIds) &&
    (finding.authorship.origin !== "ai" ||
      finding.authorship.packetRevision === candidate.packetRevision)
  );
}

function isStoredReviewChecks(
  value: unknown,
): value is InvestigationReviewItem["checks"] {
  if (!Array.isArray(value)) return false;
  const checks: unknown[] = value;
  return checks.every((item) => {
    if (typeof item !== "object" || item === null) return false;
    const candidate = item as Partial<
      InvestigationReviewItem["checks"][number]
    >;
    return (
      typeof candidate.checkId === "string" &&
      candidate.checkId.length > 0 &&
      typeof candidate.code === "string" &&
      candidate.code.length > 0 &&
      (candidate.severity === "blocking" ||
        candidate.severity === "advisory") &&
      (candidate.state === "open" || candidate.state === "resolved") &&
      typeof candidate.explanation === "string" &&
      candidate.explanation.length > 0
    );
  });
}

function findingIsExactlyConfirmable(
  finding: InvestigationReviewItem["finding"],
): boolean {
  if (finding.authorship.origin === "human") {
    return finding.verifier.status === "not_required";
  }
  return (
    finding.verifier.status === "passed" &&
    finding.verifier.draftVersionId === finding.versionId &&
    finding.verifier.contentHash === finding.contentHash
  );
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every((item) => rightSet.has(item))
  );
}
