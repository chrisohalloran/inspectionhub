import { randomUUID } from "node:crypto";

import {
  ModuleApprovalSchema,
  type ModuleApproval,
  type ModuleSnapshot,
  type ModuleType,
} from "@inspection/contracts";
import { deepFreeze } from "@inspection/domain";
import type {
  ModuleSnapshotKey,
  SnapshotReader,
} from "@inspection/reporting/snapshot";

export type ApprovalErrorCode =
  | "approval_revision_conflict"
  | "approval_snapshot_stale"
  | "approval_inspector_not_assigned"
  | "approval_inspector_ineligible"
  | "approval_recent_auth_required"
  | "approval_credential_mismatch"
  | "approval_module_withdrawn"
  | "approval_missing_snapshot";

export class ApprovalError extends Error {
  constructor(
    readonly code: ApprovalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApprovalError";
  }
}

export type ApprovalRecord = Readonly<
  ModuleApproval & {
    snapshotRevision: number;
    credentialVersion: string;
    moduleRevision: number;
  }
>;

export type ApprovalAuditEvent = Readonly<{
  eventId: string;
  type: "approval.recorded" | "approval.invalidated" | "approval.withdrawn";
  organizationId: string;
  jobId: string;
  module: ModuleType;
  moduleRevision: number;
  snapshotId: string;
  approvalId: string | null;
  inspectorId: string;
  recordedAt: string;
  reasonCode: string;
}>;

export type ApprovalCommand = Readonly<{
  organizationId: string;
  jobId: string;
  module: ModuleType;
  snapshotId: string;
  snapshotHash: string;
  expectedModuleRevision: number;
  inspectorId: string;
  credentialVersion: string;
  recentAuthentication: boolean;
  idempotencyKey: string;
  approvedAt: string;
}>;

export type InspectorAuthority = Readonly<{
  assignedInspectorId: string;
  eligible: boolean;
  credentialVersion: string;
}>;

export interface InspectorAuthorityPort {
  getAuthority(key: ModuleSnapshotKey): InspectorAuthority;
}

export interface CurrentApprovalReader {
  getCurrentApproval(key: ModuleSnapshotKey): ApprovalRecord | undefined;
  isWithdrawn(key: ModuleSnapshotKey): boolean;
}

type MutableModuleApprovalState = {
  revision: number;
  currentApproval: ApprovalRecord | undefined;
  withdrawn: boolean;
  withdrawnSnapshotId: string | undefined;
  idempotency: Map<
    string,
    Readonly<{ fingerprint: string; approval: ApprovalRecord }>
  >;
};

/**
 * Records independent, exact-snapshot professional approvals. It has no send
 * operation: package confirmation is a separate authority and transaction.
 */
export class InMemoryApprovalService implements CurrentApprovalReader {
  readonly #states = new Map<string, MutableModuleApprovalState>();
  readonly #events: ApprovalAuditEvent[] = [];

  constructor(
    private readonly snapshots: SnapshotReader,
    private readonly authority: InspectorAuthorityPort,
    private readonly ids: () => string = randomUUID,
  ) {}

  approve(command: ApprovalCommand): ApprovalRecord {
    const key = moduleKey(command);
    const state = this.#state(key);
    const fingerprint = approvalFingerprint(command);
    const replay = state.idempotency.get(command.idempotencyKey);
    if (replay !== undefined) {
      if (replay.fingerprint !== fingerprint) {
        throw new ApprovalError(
          "approval_revision_conflict",
          "Approval idempotency key was reused for different content",
        );
      }
      return replay.approval;
    }
    if (state.revision !== command.expectedModuleRevision) {
      throw new ApprovalError(
        "approval_revision_conflict",
        `Expected module revision ${command.expectedModuleRevision}, current revision is ${state.revision}`,
      );
    }
    if (state.withdrawn) {
      throw new ApprovalError(
        "approval_module_withdrawn",
        "A withdrawn module requires a new snapshot before approval",
      );
    }
    if (!command.recentAuthentication) {
      throw new ApprovalError(
        "approval_recent_auth_required",
        "Approval requires refreshed authentication",
      );
    }

    const authority = this.authority.getAuthority(key);
    if (authority.assignedInspectorId !== command.inspectorId) {
      throw new ApprovalError(
        "approval_inspector_not_assigned",
        "Only the single assigned inspector can approve this module",
      );
    }
    if (!authority.eligible) {
      throw new ApprovalError(
        "approval_inspector_ineligible",
        "The assigned inspector is not currently eligible to approve",
      );
    }
    if (authority.credentialVersion !== command.credentialVersion) {
      throw new ApprovalError(
        "approval_credential_mismatch",
        "Approval credential version is no longer current",
      );
    }

    const snapshot = this.snapshots.getCurrent(key);
    if (snapshot === undefined) {
      throw new ApprovalError(
        "approval_missing_snapshot",
        "No current immutable module snapshot exists",
      );
    }
    assertExactSnapshot(snapshot, command);
    if (
      snapshot.inspector.inspectorId !== command.inspectorId ||
      snapshot.inspector.credentialVersion !== command.credentialVersion
    ) {
      throw new ApprovalError(
        "approval_credential_mismatch",
        "Snapshot inspector attribution does not match this approval authority",
      );
    }

    const moduleRevision = state.revision + 1;
    const approval = deepFreeze({
      ...ModuleApprovalSchema.parse({
        approvalId: this.ids(),
        organizationId: command.organizationId,
        jobId: command.jobId,
        moduleId: snapshot.moduleId,
        module: command.module,
        snapshotId: snapshot.snapshotId,
        snapshotHash: snapshot.canonicalHash,
        inspectorId: command.inspectorId,
        approvedAt: command.approvedAt,
      }),
      snapshotRevision: snapshot.revision,
      credentialVersion: command.credentialVersion,
      moduleRevision,
    });
    state.revision = moduleRevision;
    state.currentApproval = approval;
    state.idempotency.set(command.idempotencyKey, {
      fingerprint,
      approval,
    });
    this.#events.push(
      deepFreeze({
        eventId: this.ids(),
        type: "approval.recorded",
        ...key,
        moduleRevision,
        snapshotId: snapshot.snapshotId,
        approvalId: approval.approvalId,
        inspectorId: command.inspectorId,
        recordedAt: command.approvedAt,
        reasonCode: "exact_snapshot_approved",
      }),
    );
    return approval;
  }

  /**
   * Called after the snapshot store advances this module. No other module key
   * is touched, so a Building edit cannot invalidate Timber Pest approval.
   */
  invalidateForSnapshotEdit(
    input: Readonly<{
      organizationId: string;
      jobId: string;
      module: ModuleType;
      expectedModuleRevision: number;
      priorSnapshotId: string;
      newSnapshotId: string;
      inspectorId: string;
      recordedAt: string;
    }>,
  ): number {
    const key = moduleKey(input);
    const state = this.#state(key);
    if (state.revision !== input.expectedModuleRevision) {
      throw new ApprovalError(
        "approval_revision_conflict",
        "Module changed before approval invalidation was recorded",
      );
    }
    const currentSnapshot = this.snapshots.getCurrent(key);
    if (
      currentSnapshot?.snapshotId !== input.newSnapshotId ||
      currentSnapshot.revision < 1
    ) {
      throw new ApprovalError(
        "approval_snapshot_stale",
        "Invalidation must name the exact new current snapshot",
      );
    }
    const priorApproval = state.currentApproval;
    if (
      priorApproval !== undefined &&
      priorApproval.snapshotId !== input.priorSnapshotId
    ) {
      throw new ApprovalError(
        "approval_snapshot_stale",
        "The current approval is not for the edited snapshot",
      );
    }
    state.revision += 1;
    state.currentApproval = undefined;
    state.withdrawn = false;
    state.withdrawnSnapshotId = undefined;
    this.#events.push(
      deepFreeze({
        eventId: this.ids(),
        type: "approval.invalidated",
        ...key,
        moduleRevision: state.revision,
        snapshotId: input.newSnapshotId,
        approvalId: priorApproval?.approvalId ?? null,
        inspectorId: input.inspectorId,
        recordedAt: input.recordedAt,
        reasonCode: "module_snapshot_edited",
      }),
    );
    return state.revision;
  }

  withdraw(
    input: Readonly<{
      organizationId: string;
      jobId: string;
      module: ModuleType;
      expectedModuleRevision: number;
      inspectorId: string;
      recentAuthentication: boolean;
      recordedAt: string;
      reasonCode: string;
    }>,
  ): number {
    const key = moduleKey(input);
    const state = this.#state(key);
    if (state.revision !== input.expectedModuleRevision) {
      throw new ApprovalError(
        "approval_revision_conflict",
        "Module revision changed before withdrawal",
      );
    }
    if (!input.recentAuthentication) {
      throw new ApprovalError(
        "approval_recent_auth_required",
        "Withdrawal requires refreshed authentication",
      );
    }
    const authority = this.authority.getAuthority(key);
    if (authority.assignedInspectorId !== input.inspectorId) {
      throw new ApprovalError(
        "approval_inspector_not_assigned",
        "Only the assigned signing inspector may withdraw the module",
      );
    }
    const snapshot = this.snapshots.getCurrent(key);
    if (snapshot === undefined) {
      throw new ApprovalError(
        "approval_missing_snapshot",
        "No current snapshot exists to withdraw",
      );
    }
    state.revision += 1;
    const priorApprovalId = state.currentApproval?.approvalId ?? null;
    state.currentApproval = undefined;
    state.withdrawn = true;
    state.withdrawnSnapshotId = snapshot.snapshotId;
    this.#events.push(
      deepFreeze({
        eventId: this.ids(),
        type: "approval.withdrawn",
        ...key,
        moduleRevision: state.revision,
        snapshotId: snapshot.snapshotId,
        approvalId: priorApprovalId,
        inspectorId: input.inspectorId,
        recordedAt: input.recordedAt,
        reasonCode: input.reasonCode,
      }),
    );
    return state.revision;
  }

  reopenWithNewSnapshot(key: ModuleSnapshotKey): void {
    const state = this.#state(key);
    const current = this.snapshots.getCurrent(key);
    if (current === undefined) {
      throw new ApprovalError(
        "approval_missing_snapshot",
        "A new current snapshot is required to reopen a withdrawn module",
      );
    }
    if (
      !state.withdrawn ||
      state.withdrawnSnapshotId === undefined ||
      current.snapshotId === state.withdrawnSnapshotId
    ) {
      throw new ApprovalError(
        "approval_snapshot_stale",
        "Reopening a withdrawn module requires a new replacement snapshot",
      );
    }
    state.withdrawn = false;
    state.withdrawnSnapshotId = undefined;
    state.currentApproval = undefined;
    state.revision += 1;
  }

  getCurrentApproval(key: ModuleSnapshotKey): ApprovalRecord | undefined {
    return this.#state(key).currentApproval;
  }

  getRevision(key: ModuleSnapshotKey): number {
    return this.#state(key).revision;
  }

  isWithdrawn(key: ModuleSnapshotKey): boolean {
    return this.#state(key).withdrawn;
  }

  events(): readonly ApprovalAuditEvent[] {
    return deepFreeze([...this.#events]);
  }

  #state(key: ModuleSnapshotKey): MutableModuleApprovalState {
    const identity = moduleIdentity(key);
    const existing = this.#states.get(identity);
    if (existing !== undefined) return existing;
    const created: MutableModuleApprovalState = {
      revision: 0,
      currentApproval: undefined,
      withdrawn: false,
      withdrawnSnapshotId: undefined,
      idempotency: new Map(),
    };
    this.#states.set(identity, created);
    return created;
  }
}

export class InMemoryInspectorAuthority implements InspectorAuthorityPort {
  readonly #authorities = new Map<string, InspectorAuthority>();

  set(key: ModuleSnapshotKey, authority: InspectorAuthority): void {
    this.#authorities.set(moduleIdentity(key), deepFreeze({ ...authority }));
  }

  getAuthority(key: ModuleSnapshotKey): InspectorAuthority {
    const authority = this.#authorities.get(moduleIdentity(key));
    if (authority === undefined) {
      throw new ApprovalError(
        "approval_inspector_not_assigned",
        "No inspector is assigned to this module",
      );
    }
    return authority;
  }
}

function assertExactSnapshot(
  snapshot: ModuleSnapshot,
  command: ApprovalCommand,
): void {
  if (
    snapshot.organizationId !== command.organizationId ||
    snapshot.jobId !== command.jobId ||
    snapshot.module !== command.module ||
    snapshot.snapshotId !== command.snapshotId ||
    snapshot.canonicalHash !== command.snapshotHash
  ) {
    throw new ApprovalError(
      "approval_snapshot_stale",
      "Approval must bind the exact current snapshot identity and hash",
    );
  }
}

function approvalFingerprint(command: ApprovalCommand): string {
  return [
    command.organizationId,
    command.jobId,
    command.module,
    command.snapshotId,
    command.snapshotHash,
    command.expectedModuleRevision,
    command.inspectorId,
    command.credentialVersion,
  ].join(":");
}

function moduleKey(input: {
  organizationId: string;
  jobId: string;
  module: ModuleType;
}): ModuleSnapshotKey {
  return {
    organizationId: input.organizationId,
    jobId: input.jobId,
    module: input.module,
  };
}

function moduleIdentity(key: ModuleSnapshotKey): string {
  return `${key.organizationId}:${key.jobId}:${key.module}`;
}
