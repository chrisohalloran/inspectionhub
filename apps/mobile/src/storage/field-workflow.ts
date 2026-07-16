import type {
  FieldWorkflowSnapshot,
  FieldSessionSnapshot,
} from "../capture/types";
import type { InvestigationReviewItem } from "../review/investigation-review";

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
  "review_changed",
  "workflow_initialized",
]);

export function initialFieldWorkflow(
  reviewItems: readonly InvestigationReviewItem[],
  updatedAt: string = new Date().toISOString(),
): FieldWorkflowSnapshot {
  return cloneFieldWorkflow({
    approvedModules: [],
    deliveryState: "waiting_for_approval",
    investigationStatus: "none",
    lastTransition: "workflow_initialized",
    packageManifestSha256: null,
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
  if (workflow.investigationStatus === investigationStatus) {
    return workflow;
  }
  return cloneFieldWorkflow({
    ...workflow,
    investigationStatus,
    lastTransition: "investigation_reconciled",
    revision: workflow.revision + 1,
    updatedAt,
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
    !Array.isArray(candidate.reviewItems) ||
    !candidate.reviewItems.every(isStoredReviewItem) ||
    !Number.isSafeInteger(candidate.revision) ||
    (candidate.revision ?? 0) < 1 ||
    typeof candidate.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.updatedAt)) ||
    !(
      candidate.packageManifestSha256 === null ||
      (typeof candidate.packageManifestSha256 === "string" &&
        /^[a-f0-9]{64}$/u.test(candidate.packageManifestSha256))
    )
  ) {
    throw new Error("Stored field workflow is invalid");
  }
  return cloneFieldWorkflow(candidate as FieldWorkflowSnapshot);
}

function isStoredReviewItem(value: unknown): value is InvestigationReviewItem {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<InvestigationReviewItem>;
  return (
    typeof candidate.reviewId === "string" &&
    candidate.reviewId.length > 0 &&
    typeof candidate.investigationId === "string" &&
    candidate.investigationId.length > 0 &&
    (candidate.module === "building" || candidate.module === "timber_pest") &&
    ["accepted", "awaiting_decision", "rejected", "stale"].includes(
      candidate.status ?? "",
    ) &&
    typeof candidate.finding === "object" &&
    candidate.finding !== null &&
    typeof candidate.provenance === "object" &&
    candidate.provenance !== null &&
    Array.isArray(candidate.checks)
  );
}
