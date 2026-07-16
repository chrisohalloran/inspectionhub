import {
  ActiveRecipientGrantSchema,
  CommissionedModulesSchema,
  DeliveryPackageSchema,
  LifecycleRecordSchema,
  ModuleApprovalSchema,
  ModuleSnapshotSchema,
  ProfessionalModuleStateSchema,
  RecipientGrantSchema,
  type ActiveLifecycleRecord,
  type CommissionedModules,
  type DeliveryPackage,
  type LifecycleRecord,
  type ModuleSnapshot,
  type ModuleType,
  type ProfessionalModuleState,
  type RecipientGrant,
} from "@inspection/contracts";

import { deepFreeze } from "./canonical.js";
import { DomainConflictError } from "./errors.js";
import { verifyModuleSnapshotHash } from "./snapshots.js";

type ModuleIdentity = {
  readonly organizationId: string;
  readonly jobId: string;
  readonly moduleId: string;
  readonly module: ModuleType;
};

export function createInitialModuleState(
  identity: ModuleIdentity,
): ProfessionalModuleState {
  return freezeModuleState({
    ...identity,
    revision: 0,
    status: "draft",
    snapshots: [],
    approvals: [],
    amendments: [],
    currentSnapshotId: null,
    currentApprovalId: null,
    withdrawal: null,
    evidenceRisk: null,
  });
}

export function registerModuleSnapshot(
  state: ProfessionalModuleState,
  snapshot: ModuleSnapshot,
  expectedRevision: number,
): ProfessionalModuleState {
  assertRevision(state.revision, expectedRevision);
  if (state.snapshots.length > 0) {
    throw new DomainConflictError(
      "amendment_reason_required",
      "A later professional snapshot must use the explicit amendment transition",
    );
  }
  assertSnapshotForState(state, snapshot);
  if (snapshot.revision !== 1) {
    throw new DomainConflictError(
      "snapshot_revision_mismatch",
      "The initial module snapshot revision must be 1",
    );
  }
  return freezeModuleState({
    ...state,
    revision: state.revision + 1,
    status: "draft",
    snapshots: [...state.snapshots, snapshot],
    currentSnapshotId: snapshot.snapshotId,
    currentApprovalId: null,
    withdrawal: null,
    evidenceRisk: null,
  });
}

type ApprovalCommand = {
  readonly expectedRevision: number;
  readonly approvalId: string;
  readonly snapshotId: string;
  readonly snapshotHash: string;
  readonly inspectorId: string;
  readonly approvedAt: string;
};

export function approveModule(
  state: ProfessionalModuleState,
  command: ApprovalCommand,
): ProfessionalModuleState {
  assertRevision(state.revision, command.expectedRevision);
  if (state.status !== "draft") {
    throw new DomainConflictError(
      "module_not_approvable",
      `A ${state.status} module cannot be approved`,
    );
  }
  const snapshot = getCurrentSnapshot(state);
  if (
    snapshot.snapshotId !== command.snapshotId ||
    snapshot.canonicalHash !== command.snapshotHash
  ) {
    throw new DomainConflictError(
      "snapshot_conflict",
      "Approval must reference the exact current immutable snapshot",
      {
        currentSnapshotId: snapshot.snapshotId,
        currentSnapshotHash: snapshot.canonicalHash,
      },
    );
  }
  const approval = ModuleApprovalSchema.parse({
    approvalId: command.approvalId,
    organizationId: state.organizationId,
    jobId: state.jobId,
    moduleId: state.moduleId,
    module: state.module,
    snapshotId: snapshot.snapshotId,
    snapshotHash: snapshot.canonicalHash,
    inspectorId: command.inspectorId,
    approvedAt: command.approvedAt,
  });
  return freezeModuleState({
    ...state,
    revision: state.revision + 1,
    status: "approved",
    approvals: [...state.approvals, approval],
    currentApprovalId: approval.approvalId,
    withdrawal: null,
    evidenceRisk: null,
  });
}

type AmendmentCommand = {
  readonly expectedRevision: number;
  readonly amendmentId: string;
  readonly reason: string;
  readonly amendedByInspectorId: string;
  readonly amendedAt: string;
  readonly replacementSnapshot: ModuleSnapshot;
};

export function amendModule(
  state: ProfessionalModuleState,
  command: AmendmentCommand,
): ProfessionalModuleState {
  assertRevision(state.revision, command.expectedRevision);
  if (state.status !== "approved") {
    throw new DomainConflictError(
      "module_not_amendable",
      "Only an approved professional module may be amended",
    );
  }
  const prior = getCurrentSnapshot(state);
  assertSnapshotForState(state, command.replacementSnapshot);
  if (command.replacementSnapshot.revision !== prior.revision + 1) {
    throw new DomainConflictError(
      "snapshot_revision_mismatch",
      "Replacement snapshot must advance one revision",
    );
  }
  return freezeModuleState({
    ...state,
    revision: state.revision + 1,
    status: "draft",
    snapshots: [...state.snapshots, command.replacementSnapshot],
    amendments: [
      ...state.amendments,
      {
        amendmentId: command.amendmentId,
        priorSnapshotId: prior.snapshotId,
        replacementSnapshotId: command.replacementSnapshot.snapshotId,
        reason: command.reason,
        amendedByInspectorId: command.amendedByInspectorId,
        amendedAt: command.amendedAt,
      },
    ],
    currentSnapshotId: command.replacementSnapshot.snapshotId,
    currentApprovalId: null,
    withdrawal: null,
    evidenceRisk: null,
  });
}

type WithdrawalCommand = {
  readonly expectedRevision: number;
  readonly reason: string;
  readonly withdrawnByInspectorId: string;
  readonly withdrawnAt: string;
};

export function withdrawModule(
  state: ProfessionalModuleState,
  command: WithdrawalCommand,
): ProfessionalModuleState {
  assertRevision(state.revision, command.expectedRevision);
  if (state.status !== "approved") {
    throw new DomainConflictError(
      "module_not_withdrawable",
      "Only a currently approved module may be withdrawn",
    );
  }
  const snapshot = getCurrentSnapshot(state);
  return freezeModuleState({
    ...state,
    revision: state.revision + 1,
    status: "withdrawn",
    currentApprovalId: null,
    withdrawal: {
      reason: command.reason,
      withdrawnByInspectorId: command.withdrawnByInspectorId,
      withdrawnAt: command.withdrawnAt,
      withdrawnSnapshotId: snapshot.snapshotId,
    },
    evidenceRisk: null,
  });
}

type EvidenceAtRiskCommand = {
  readonly expectedRevision: number;
  readonly artifactIds: readonly string[];
  readonly reason: "device_lost_before_server_durability";
  readonly recordedAt: string;
};

export function markEvidenceAtRisk(
  state: ProfessionalModuleState,
  command: EvidenceAtRiskCommand,
): ProfessionalModuleState {
  assertRevision(state.revision, command.expectedRevision);
  if (state.status === "withdrawn") {
    throw new DomainConflictError(
      "withdrawn_module",
      "A withdrawn module cannot transition to evidence-at-risk",
    );
  }
  return freezeModuleState({
    ...state,
    revision: state.revision + 1,
    status: "evidence_at_risk",
    currentApprovalId: null,
    withdrawal: null,
    evidenceRisk: {
      artifactIds: [...command.artifactIds],
      reason: command.reason,
      recordedAt: command.recordedAt,
    },
  });
}

type InitialDeliveryPackageInput = {
  readonly packageId: string;
  readonly organizationId: string;
  readonly jobId: string;
  readonly commissionedModules: CommissionedModules;
};

export function createInitialDeliveryPackage(
  input: InitialDeliveryPackageInput,
): DeliveryPackage {
  const commissionedModules = CommissionedModulesSchema.parse(
    input.commissionedModules,
  );
  return deepFreeze(
    DeliveryPackageSchema.parse({
      ...input,
      commissionedModules,
      revision: 0,
      status: "pending",
      moduleSnapshots: [],
      blockers: commissionedModules.map((module) =>
        module === "building"
          ? "building_not_approved"
          : "timber_pest_not_approved",
      ),
    }),
  );
}

export function confirmDeliveryPackage(
  deliveryPackage: DeliveryPackage,
  expectedRevision: number,
  moduleStates: readonly ProfessionalModuleState[],
  confirmedAt: string,
): DeliveryPackage {
  assertRevision(deliveryPackage.revision, expectedRevision);
  if (deliveryPackage.status !== "pending") {
    throw new DomainConflictError(
      "package_not_confirmable",
      `A ${deliveryPackage.status} package cannot be confirmed`,
    );
  }
  if (moduleStates.length !== deliveryPackage.commissionedModules.length) {
    throw new DomainConflictError(
      "commissioned_module_set_mismatch",
      "Module states must match the exact commissioned set",
    );
  }
  const byModule = new Map<ModuleType, ProfessionalModuleState>();
  for (const state of moduleStates) {
    if (byModule.has(state.module)) {
      throw new DomainConflictError(
        "duplicate_module",
        `Duplicate ${state.module} state supplied`,
      );
    }
    byModule.set(state.module, state);
  }
  const moduleSnapshots = deliveryPackage.commissionedModules.map((module) => {
    const state = byModule.get(module);
    if (
      state === undefined ||
      state.organizationId !== deliveryPackage.organizationId ||
      state.jobId !== deliveryPackage.jobId ||
      state.status !== "approved" ||
      state.currentApprovalId === null
    ) {
      throw new DomainConflictError(
        "commissioned_module_not_approved",
        `${module} is not approved for this package`,
      );
    }
    const snapshot = getCurrentSnapshot(state);
    const approval = state.approvals.find(
      ({ approvalId }) => approvalId === state.currentApprovalId,
    );
    if (
      approval === undefined ||
      approval.snapshotId !== snapshot.snapshotId ||
      approval.snapshotHash !== snapshot.canonicalHash
    ) {
      throw new DomainConflictError(
        "approval_snapshot_mismatch",
        `${module} approval is stale or does not match`,
      );
    }
    return {
      module,
      moduleId: state.moduleId,
      snapshotId: snapshot.snapshotId,
      snapshotHash: snapshot.canonicalHash,
      approvalId: approval.approvalId,
    };
  });
  if (byModule.size !== deliveryPackage.commissionedModules.length) {
    throw new DomainConflictError(
      "commissioned_module_set_mismatch",
      "Extra professional module supplied",
    );
  }
  return deepFreeze(
    DeliveryPackageSchema.parse({
      packageId: deliveryPackage.packageId,
      organizationId: deliveryPackage.organizationId,
      jobId: deliveryPackage.jobId,
      commissionedModules: deliveryPackage.commissionedModules,
      revision: deliveryPackage.revision + 1,
      status: "confirmed",
      moduleSnapshots,
      confirmedAt,
    }),
  );
}

export function cancelDeliveryPackage(
  deliveryPackage: DeliveryPackage,
  expectedRevision: number,
  reason:
    "module_withdrawn" | "module_amended" | "grant_revoked" | "stale_snapshot",
  cancelledAt: string,
): DeliveryPackage {
  assertRevision(deliveryPackage.revision, expectedRevision);
  if (
    deliveryPackage.status === "cancelled" ||
    deliveryPackage.status === "suppressed"
  ) {
    throw new DomainConflictError(
      "package_terminal",
      `A ${deliveryPackage.status} package cannot be cancelled again`,
    );
  }
  return deepFreeze(
    DeliveryPackageSchema.parse({
      packageId: deliveryPackage.packageId,
      organizationId: deliveryPackage.organizationId,
      jobId: deliveryPackage.jobId,
      commissionedModules: deliveryPackage.commissionedModules,
      revision: deliveryPackage.revision + 1,
      status: "cancelled",
      moduleSnapshots: deliveryPackage.moduleSnapshots,
      cancelledAt,
      cancellationReason: reason,
    }),
  );
}

export function suppressDeliveryPackage(
  deliveryPackage: DeliveryPackage,
  expectedRevision: number,
  reason: "restore_reconciliation" | "professional_hold" | "dispute_hold",
  suppressedAt: string,
): DeliveryPackage {
  assertRevision(deliveryPackage.revision, expectedRevision);
  if (
    deliveryPackage.status === "cancelled" ||
    deliveryPackage.status === "suppressed"
  ) {
    throw new DomainConflictError(
      "package_terminal",
      `A ${deliveryPackage.status} package cannot be suppressed`,
    );
  }
  return deepFreeze(
    DeliveryPackageSchema.parse({
      packageId: deliveryPackage.packageId,
      organizationId: deliveryPackage.organizationId,
      jobId: deliveryPackage.jobId,
      commissionedModules: deliveryPackage.commissionedModules,
      revision: deliveryPackage.revision + 1,
      status: "suppressed",
      moduleSnapshots: deliveryPackage.moduleSnapshots,
      suppressedAt,
      suppressionReason: reason,
    }),
  );
}

type RecipientGrantInput = {
  readonly grantId: string;
  readonly organizationId: string;
  readonly jobId: string;
  readonly principalId: string;
  readonly reportVersionId: string;
  readonly permittedModules: CommissionedModules;
  readonly permittedActions: readonly (
    "read_report" | "download_pdf" | "view_curated_media" | "invite_recipient"
  )[];
  readonly issuedBy: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
};

export function createRecipientGrant(
  input: RecipientGrantInput,
): RecipientGrant {
  return deepFreeze(
    ActiveRecipientGrantSchema.parse({
      ...input,
      permittedActions: [...input.permittedActions],
      revision: 0,
      status: "active",
    }),
  );
}

export function revokeRecipientGrant(
  grant: RecipientGrant,
  expectedRevision: number,
  revokedBy: string,
  revocationReason: string,
  revokedAt: string,
): RecipientGrant {
  assertRevision(grant.revision, expectedRevision);
  if (grant.status !== "active") {
    throw new DomainConflictError(
      "grant_not_active",
      "Only an active recipient grant can be revoked",
    );
  }
  return deepFreeze(
    RecipientGrantSchema.parse({
      ...grant,
      revision: grant.revision + 1,
      status: "revoked",
      revokedBy,
      revokedAt,
      revocationReason,
    }),
  );
}

type LifecycleInput = Omit<ActiveLifecycleRecord, "revision" | "status">;

export function createLifecycleRecord(input: LifecycleInput): LifecycleRecord {
  return deepFreeze(
    LifecycleRecordSchema.parse({ ...input, revision: 0, status: "active" }),
  );
}

type SuppressDeletionInput = {
  readonly reason:
    | "retained_professional_reference"
    | "professional_hold"
    | "dispute_hold"
    | "tenant_offboarding"
    | "restore_reconciliation";
  readonly referenceIds: readonly string[];
  readonly recordedAt: string;
};

export function suppressDeletion(
  record: LifecycleRecord,
  expectedRevision: number,
  suppression: SuppressDeletionInput,
): LifecycleRecord {
  assertRevision(record.revision, expectedRevision);
  if (record.status === "purged") {
    throw new DomainConflictError(
      "already_purged",
      "A purged resource cannot be suppression-restored",
    );
  }
  return deepFreeze(
    LifecycleRecordSchema.parse({
      lifecycleId: record.lifecycleId,
      organizationId: record.organizationId,
      resourceType: record.resourceType,
      resourceId: record.resourceId,
      revision: record.revision + 1,
      status: "deletion_suppressed",
      suppression: {
        ...suppression,
        referenceIds: [...suppression.referenceIds],
      },
    }),
  );
}

function getCurrentSnapshot(state: ProfessionalModuleState): ModuleSnapshot {
  if (state.currentSnapshotId === null) {
    throw new DomainConflictError(
      "snapshot_missing",
      "No current immutable snapshot exists",
    );
  }
  const snapshot = state.snapshots.find(
    ({ snapshotId }) => snapshotId === state.currentSnapshotId,
  );
  if (snapshot === undefined) {
    throw new DomainConflictError(
      "snapshot_missing",
      "Current snapshot reference is invalid",
    );
  }
  return snapshot;
}

function assertSnapshotForState(
  state: ProfessionalModuleState,
  snapshot: ModuleSnapshot,
) {
  ModuleSnapshotSchema.parse(snapshot);
  if (!verifyModuleSnapshotHash(snapshot)) {
    throw new DomainConflictError(
      "snapshot_hash_invalid",
      "Snapshot canonical hash is invalid",
    );
  }
  if (
    snapshot.organizationId !== state.organizationId ||
    snapshot.jobId !== state.jobId ||
    snapshot.moduleId !== state.moduleId ||
    snapshot.module !== state.module
  ) {
    throw new DomainConflictError(
      "snapshot_module_mismatch",
      "Snapshot does not belong to this professional module",
    );
  }
}

function assertRevision(actualRevision: number, expectedRevision: number) {
  if (actualRevision !== expectedRevision) {
    throw new DomainConflictError(
      "stale_revision",
      "Expected revision is stale",
      {
        expectedRevision,
        actualRevision,
      },
    );
  }
}

function freezeModuleState(input: unknown): ProfessionalModuleState {
  return deepFreeze(ProfessionalModuleStateSchema.parse(input));
}
