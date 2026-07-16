import type { CurrentApprovalReader } from "@inspection/approvals";
import type {
  CommissionedModules,
  ModuleSnapshot,
  ModuleType,
} from "@inspection/contracts";
import { deepFreeze, sha256 } from "@inspection/domain";
import type {
  ModuleSnapshotKey,
  SnapshotReader,
} from "@inspection/reporting/snapshot";

import {
  isManifestSendable,
  manifestCoversEvidence,
  verifyDurabilityManifest,
} from "./manifest.js";
import { DeliveryConflictError } from "./repository.js";
import type { InMemoryDeliveryRepository } from "./repository.js";
import type {
  DeliveryPackageRecord,
  DurabilityManifest,
  FrozenModuleReference,
} from "./types.js";

export class DeliveryGateError extends Error {
  constructor(
    readonly code:
      | "delivery_manifest_scope_mismatch"
      | "delivery_manifest_divergence"
      | "delivery_snapshot_changed"
      | "delivery_module_withdrawn"
      | "delivery_module_set_invalid",
    message: string,
  ) {
    super(message);
    this.name = "DeliveryGateError";
  }
}

export type ConfirmPackageCommand = Readonly<{
  packageId: string;
  organizationId: string;
  jobId: string;
  commissionedModules: CommissionedModules;
  manifest: DurabilityManifest;
  expectedPackageRevision: number;
  idempotencyKey: string;
  confirmedAt: string;
}>;

export type ConfirmPackageResult = Readonly<{
  package: DeliveryPackageRecord;
  outcome: "waiting_for_approval" | "waiting_for_evidence" | "queued";
  blockers: readonly string[];
  replayed: boolean;
}>;

/**
 * Freezes the exact commissioned snapshot set and inserts its outbox record in
 * one repository transaction. It cannot invoke a delivery provider.
 */
export class DeliveryPackageService {
  constructor(
    private readonly repository: InMemoryDeliveryRepository,
    private readonly snapshots: SnapshotReader,
    private readonly approvals: CurrentApprovalReader,
  ) {}

  confirm(command: ConfirmPackageCommand): ConfirmPackageResult {
    assertCanonicalModuleSet(command.commissionedModules);
    if (
      command.manifest.organizationId !== command.organizationId ||
      command.manifest.jobId !== command.jobId
    ) {
      throw new DeliveryGateError(
        "delivery_manifest_scope_mismatch",
        "Durability manifest does not belong to this organisation and job",
      );
    }
    if (!verifyDurabilityManifest(command.manifest)) {
      throw new DeliveryGateError(
        "delivery_manifest_divergence",
        "Durability manifest content does not match its canonical hash",
      );
    }
    const fingerprint = sha256({
      packageId: command.packageId,
      organizationId: command.organizationId,
      jobId: command.jobId,
      commissionedModules: command.commissionedModules,
      manifestHash: command.manifest.canonicalHash,
      expectedPackageRevision: command.expectedPackageRevision,
    });
    const scopedIdempotencyKey = `${command.organizationId}:${command.idempotencyKey}`;

    return this.repository.transact((transaction) => {
      const replay = transaction.getIdempotentPackage(
        scopedIdempotencyKey,
        fingerprint,
      );
      if (replay !== undefined) {
        return resultFor(replay, true);
      }

      const exact = this.#resolveExactApprovals(command);
      const blockers = exact.blockers;
      const sendableManifest =
        isManifestSendable(command.manifest) &&
        manifestCoversEvidence(command.manifest, exact.requiredEvidenceHashes);
      const existing = transaction.getPackage(command.packageId);
      const nextRevision = command.expectedPackageRevision + 1;
      const state =
        blockers.length > 0
          ? "waiting_for_approval"
          : sendableManifest
            ? "queued"
            : "waiting_for_evidence";
      const frozen = state === "queued" ? exact.references : [];
      const next = deepFreeze({
        packageId: command.packageId,
        organizationId: command.organizationId,
        jobId: command.jobId,
        commissionedModules: command.commissionedModules,
        moduleSnapshots: frozen,
        durabilityManifestId: command.manifest.manifestId,
        durabilityManifestHash: command.manifest.canonicalHash,
        revision: nextRevision,
        state,
        idempotencyKey: command.idempotencyKey,
        frozenAt: state === "queued" ? command.confirmedAt : null,
        updatedAt: command.confirmedAt,
        providerReference: null,
        failureCode: null,
        interventionRequired: false,
        cancellationReason: null,
      } satisfies DeliveryPackageRecord);

      if (
        existing !== undefined &&
        (existing.organizationId !== command.organizationId ||
          existing.jobId !== command.jobId ||
          JSON.stringify(existing.commissionedModules) !==
            JSON.stringify(command.commissionedModules))
      ) {
        throw new DeliveryConflictError(
          "An existing package cannot change tenant, job, or commissioned module set",
        );
      }
      transaction.writePackage(next, command.expectedPackageRevision);
      transaction.bindIdempotency(
        scopedIdempotencyKey,
        fingerprint,
        command.packageId,
      );

      if (state === "queued") {
        transaction.enqueueOutbox({
          packageId: command.packageId,
          organizationId: command.organizationId,
          jobId: command.jobId,
          state: "queued",
          idempotencyKey: `send:${command.packageId}:${nextRevision}`,
          requestFingerprint: sha256({
            packageId: command.packageId,
            moduleSnapshots: frozen,
            manifestHash: command.manifest.canonicalHash,
          }),
          createdAt: command.confirmedAt,
          updatedAt: command.confirmedAt,
        });
      }
      transaction.appendEvent({
        packageId: command.packageId,
        organizationId: command.organizationId,
        jobId: command.jobId,
        type:
          state === "queued"
            ? "delivery.package_frozen"
            : state === "waiting_for_approval"
              ? "delivery.waiting_for_approval"
              : "delivery.waiting_for_evidence",
        packageRevision: nextRevision,
        recordedAt: command.confirmedAt,
        safeMetadata: {
          state,
          moduleCount: command.commissionedModules.length,
          blockerCount: blockers.length,
        },
      });
      return {
        ...resultFor(next, false),
        blockers:
          state === "waiting_for_evidence"
            ? ["required_evidence_not_durable"]
            : blockers,
      };
    });
  }

  #resolveExactApprovals(command: ConfirmPackageCommand): Readonly<{
    references: readonly FrozenModuleReference[];
    blockers: readonly string[];
    requiredEvidenceHashes: readonly string[];
  }> {
    const references: FrozenModuleReference[] = [];
    const blockers: string[] = [];
    const requiredEvidenceHashes = new Set<string>();
    for (const module of command.commissionedModules) {
      const key: ModuleSnapshotKey = {
        organizationId: command.organizationId,
        jobId: command.jobId,
        module,
      };
      if (this.approvals.isWithdrawn(key)) {
        blockers.push(`${module}_withdrawn`);
        continue;
      }
      const snapshot = this.snapshots.getCurrent(key);
      const approval = this.approvals.getCurrentApproval(key);
      if (snapshot === undefined || approval === undefined) {
        blockers.push(`${module}_not_approved`);
        continue;
      }
      if (
        approval.snapshotId !== snapshot.snapshotId ||
        approval.snapshotHash !== snapshot.canonicalHash ||
        approval.snapshotRevision !== snapshot.revision
      ) {
        throw new DeliveryGateError(
          "delivery_snapshot_changed",
          `${module} approval is not for the exact current snapshot`,
        );
      }
      references.push(reference(snapshot, approval));
      for (const hash of snapshot.evidenceHashes) {
        requiredEvidenceHashes.add(hash);
      }
    }
    return deepFreeze({
      references,
      blockers,
      requiredEvidenceHashes: [...requiredEvidenceHashes].sort(),
    });
  }
}

function resultFor(
  value: DeliveryPackageRecord,
  replayed: boolean,
): ConfirmPackageResult {
  const outcome =
    value.state === "waiting_for_approval"
      ? "waiting_for_approval"
      : value.state === "waiting_for_evidence"
        ? "waiting_for_evidence"
        : "queued";
  return {
    package: value,
    outcome,
    blockers:
      outcome === "waiting_for_evidence"
        ? ["required_evidence_not_durable"]
        : [],
    replayed,
  };
}

function reference(
  snapshot: ModuleSnapshot,
  approval: ReturnType<CurrentApprovalReader["getCurrentApproval"]> & {},
): FrozenModuleReference {
  return deepFreeze({
    module: snapshot.module,
    moduleId: snapshot.moduleId,
    snapshotId: snapshot.snapshotId,
    snapshotHash: snapshot.canonicalHash,
    snapshotRevision: snapshot.revision,
    approvalId: approval.approvalId,
    approvalModuleRevision: approval.moduleRevision,
  });
}

function assertCanonicalModuleSet(modules: CommissionedModules): void {
  const canonical: readonly ModuleType[] = ["building", "timber_pest"];
  const indices = modules.map((module) => canonical.indexOf(module));
  if (
    new Set(modules).size !== modules.length ||
    indices.some((index, offset) => offset > 0 && index <= indices[offset - 1]!)
  ) {
    throw new DeliveryGateError(
      "delivery_module_set_invalid",
      "Commissioned modules must be unique and in canonical order",
    );
  }
}
