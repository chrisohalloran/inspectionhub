import { sha256 } from "@inspection/domain";
import type { ExternalEgressGuard } from "@inspection/security";

import { DeliveryConflictError } from "./repository.js";
import type { InMemoryDeliveryRepository } from "./repository.js";
import type {
  DeliveryPackageRecord,
  DeliveryProviderPort,
  DeliveryProviderResult,
  ProfessionalDeliveryStatus,
  ProfessionalDeliveryStatusPort,
} from "./types.js";

export type SendHooks = Readonly<{
  /** Test/adapter boundary used to model a committed withdrawal race. */
  beforeProviderCall?: () => void | Promise<void>;
  /** Models provider success followed by process death before local logging. */
  afterProviderCall?: (result: DeliveryProviderResult) => void | Promise<void>;
}>;

export class DeliveryWorker {
  constructor(
    private readonly repository: InMemoryDeliveryRepository,
    private readonly professionalStatus: ProfessionalDeliveryStatusPort,
    private readonly provider: DeliveryProviderPort,
    private readonly egressGuard: ExternalEgressGuard,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async send(
    packageId: string,
    hooks: SendHooks = {},
  ): Promise<DeliveryPackageRecord> {
    const started = this.repository.transact((transaction) => {
      const current = transaction.getPackage(packageId);
      if (current === undefined)
        throw new Error("Delivery package does not exist");
      if (current.state === "cancelled") return current;
      if (current.state !== "queued") {
        throw new DeliveryConflictError(
          `Only a queued package can start sending; current state is ${current.state}`,
        );
      }
      const at = this.now();
      const next = transaction.transition(packageId, "queued", "sending", at);
      transaction.updateOutbox(packageId, "processing", at);
      transaction.appendEvent({
        packageId,
        organizationId: current.organizationId,
        jobId: current.jobId,
        type: "delivery.send_started",
        packageRevision: next.revision,
        recordedAt: at,
        safeMetadata: { priorState: current.state },
      });
      return next;
    });
    if (started.state === "cancelled") return started;

    const firstGuard = this.#readStatus(started);
    if (this.#isBlocked(started, firstGuard)) {
      return this.#cancelBlocked(started, firstGuard);
    }

    await hooks.beforeProviderCall?.();

    const blockedBeforeAuthorisation = this.#revalidateSendability(started);
    if (blockedBeforeAuthorisation !== null) {
      return blockedBeforeAuthorisation;
    }
    try {
      await this.egressGuard.requireEgress({
        organizationId: started.organizationId,
        boundary: "delivery_provider",
      });
    } catch {
      return this.#recordEgressBlocked(started);
    }

    const outbox = this.repository.getOutboxForPackage(packageId);
    if (outbox === undefined)
      throw new Error("Delivery outbox record is missing");

    // No await may be introduced between this authoritative revalidation and
    // provider.send. In the current single-process transaction boundary this
    // closes cancellation and withdrawal changes committed while egress
    // authorisation was pending.
    const blockedImmediatelyBeforeSend = this.#revalidateSendability(started);
    if (blockedImmediatelyBeforeSend !== null) {
      return blockedImmediatelyBeforeSend;
    }
    let result: DeliveryProviderResult;
    try {
      result = await this.provider.send({
        packageId,
        organizationId: started.organizationId,
        jobId: started.jobId,
        idempotencyKey: outbox.idempotencyKey,
        requestFingerprint: outbox.requestFingerprint,
      });
      await hooks.afterProviderCall?.(result);
    } catch {
      return this.#recordUnknown(
        started,
        "provider_result_not_durably_recorded",
      );
    }
    return this.#recordResult(started, result);
  }

  cancelPackage(
    packageId: string,
    reason: "job_cancelled" | "module_withdrawn" | "delivery_suspended",
  ): DeliveryPackageRecord {
    return this.repository.transact((transaction) => {
      const current = transaction.getPackage(packageId);
      if (current === undefined)
        throw new Error("Delivery package does not exist");
      if (current.state === "sent") {
        throw new DeliveryConflictError(
          "A sent copy cannot be recalled; withdrawal must be represented by notice and audit history",
        );
      }
      if (current.state === "cancelled") return current;
      const at = this.now();
      const next = transaction.transition(
        packageId,
        [
          "waiting_for_approval",
          "waiting_for_evidence",
          "queued",
          "sending",
          "provider_accepted",
          "failed",
          "unknown",
        ],
        "cancelled",
        at,
        { cancellationReason: reason },
      );
      const outbox = this.repository.getOutboxForPackage(packageId);
      if (outbox !== undefined) {
        transaction.updateOutbox(packageId, "cancelled", at);
      }
      transaction.appendEvent({
        packageId,
        organizationId: current.organizationId,
        jobId: current.jobId,
        type: "delivery.cancelled",
        packageRevision: next.revision,
        recordedAt: at,
        safeMetadata: { reason },
      });
      return next;
    });
  }

  retry(packageId: string): DeliveryPackageRecord {
    return this.repository.transact((transaction) => {
      const current = transaction.getPackage(packageId);
      if (current === undefined)
        throw new Error("Delivery package does not exist");
      if (current.state !== "failed" || current.interventionRequired) {
        throw new DeliveryConflictError(
          "Only a retryable failed delivery can be queued automatically",
        );
      }
      const at = this.now();
      const next = transaction.transition(packageId, "failed", "queued", at, {
        failureCode: null,
      });
      transaction.updateOutbox(packageId, "queued", at);
      return next;
    });
  }

  markProviderSent(
    packageId: string,
    providerReference: string,
  ): DeliveryPackageRecord {
    return this.repository.transact((transaction) => {
      const current = transaction.getPackage(packageId);
      if (current === undefined)
        throw new Error("Delivery package does not exist");
      const at = this.now();
      const next = transaction.transition(
        packageId,
        ["provider_accepted", "unknown", "cancelled"],
        "sent",
        at,
        { providerReference, failureCode: null, interventionRequired: false },
      );
      transaction.updateOutbox(packageId, "completed", at);
      transaction.appendEvent({
        packageId,
        organizationId: current.organizationId,
        jobId: current.jobId,
        type: "delivery.sent",
        packageRevision: next.revision,
        recordedAt: at,
        safeMetadata: {
          providerReference,
          observedAfterCancellation: current.state === "cancelled",
        },
      });
      return next;
    });
  }

  #recordResult(
    started: DeliveryPackageRecord,
    result: DeliveryProviderResult,
  ): DeliveryPackageRecord {
    if (result.state === "unknown") {
      return this.#recordUnknown(started, result.reconciliationKey);
    }
    return this.repository.transact((transaction) => {
      const current = transaction.getPackage(started.packageId);
      if (current?.state === "cancelled" && result.state === "sent") {
        const at = this.now();
        const next = transaction.transition(
          started.packageId,
          "cancelled",
          "sent",
          at,
          { providerReference: result.providerReference },
        );
        transaction.updateOutbox(started.packageId, "completed", at);
        transaction.appendEvent({
          packageId: started.packageId,
          organizationId: started.organizationId,
          jobId: started.jobId,
          type: "delivery.sent",
          packageRevision: next.revision,
          recordedAt: at,
          safeMetadata: {
            providerReference: result.providerReference,
            observedAfterCancellation: true,
          },
        });
        return next;
      }
      if (current?.state === "cancelled") return current;
      if (current?.state !== "sending") {
        throw new DeliveryConflictError(
          "Provider result is stale for the current delivery state",
        );
      }
      const at = this.now();
      if (result.state === "sent") {
        const next = transaction.transition(
          started.packageId,
          "sending",
          "sent",
          at,
          { providerReference: result.providerReference },
        );
        transaction.updateOutbox(started.packageId, "completed", at);
        transaction.appendEvent({
          packageId: started.packageId,
          organizationId: started.organizationId,
          jobId: started.jobId,
          type: "delivery.sent",
          packageRevision: next.revision,
          recordedAt: at,
          safeMetadata: { providerReference: result.providerReference },
        });
        return next;
      }
      if (result.state === "accepted") {
        const next = transaction.transition(
          started.packageId,
          "sending",
          "provider_accepted",
          at,
          { providerReference: result.providerReference },
        );
        transaction.appendEvent({
          packageId: started.packageId,
          organizationId: started.organizationId,
          jobId: started.jobId,
          type: "delivery.provider_accepted",
          packageRevision: next.revision,
          recordedAt: at,
          safeMetadata: { providerReference: result.providerReference },
        });
        return next;
      }
      const next = transaction.transition(
        started.packageId,
        "sending",
        "failed",
        at,
        {
          failureCode: result.code,
          interventionRequired: !result.retryable,
        },
      );
      transaction.updateOutbox(
        started.packageId,
        result.retryable ? "queued" : "completed",
        at,
      );
      transaction.appendEvent({
        packageId: started.packageId,
        organizationId: started.organizationId,
        jobId: started.jobId,
        type: "delivery.failed",
        packageRevision: next.revision,
        recordedAt: at,
        safeMetadata: {
          code: result.code,
          retryable: result.retryable,
          interventionRequired: !result.retryable,
        },
      });
      return next;
    });
  }

  #recordUnknown(
    started: DeliveryPackageRecord,
    reconciliationKey: string,
  ): DeliveryPackageRecord {
    return this.repository.transact((transaction) => {
      const current = transaction.getPackage(started.packageId);
      if (current?.state === "cancelled") return current;
      const at = this.now();
      const next = transaction.transition(
        started.packageId,
        "sending",
        "unknown",
        at,
        { failureCode: "provider_outcome_unknown" },
      );
      transaction.appendEvent({
        packageId: started.packageId,
        organizationId: started.organizationId,
        jobId: started.jobId,
        type: "delivery.unknown",
        packageRevision: next.revision,
        recordedAt: at,
        safeMetadata: { reconciliationHash: sha256(reconciliationKey) },
      });
      return next;
    });
  }

  #recordEgressBlocked(started: DeliveryPackageRecord): DeliveryPackageRecord {
    return this.repository.transact((transaction) => {
      const current = transaction.getPackage(started.packageId);
      if (current?.state === "cancelled") return current;
      if (current?.state !== "sending") {
        throw new DeliveryConflictError(
          "Delivery changed while restore egress was being authorised",
        );
      }
      const at = this.now();
      const next = transaction.transition(
        started.packageId,
        "sending",
        "failed",
        at,
        {
          failureCode: "restore_egress_blocked",
          interventionRequired: false,
        },
      );
      transaction.updateOutbox(started.packageId, "queued", at);
      transaction.appendEvent({
        packageId: started.packageId,
        organizationId: started.organizationId,
        jobId: started.jobId,
        type: "delivery.failed",
        packageRevision: next.revision,
        recordedAt: at,
        safeMetadata: {
          code: "restore_egress_blocked",
          retryable: true,
          interventionRequired: false,
        },
      });
      return next;
    });
  }

  #readStatus(
    packageRecord: DeliveryPackageRecord,
  ): ProfessionalDeliveryStatus {
    return this.professionalStatus.readStatus({
      organizationId: packageRecord.organizationId,
      jobId: packageRecord.jobId,
    });
  }

  #revalidateSendability(
    started: DeliveryPackageRecord,
  ): DeliveryPackageRecord | null {
    const current = this.repository.getPackage(started.packageId);
    if (current?.state === "cancelled") return current;
    if (current?.state !== "sending") {
      throw new DeliveryConflictError(
        "Package state changed immediately before provider delivery",
      );
    }
    const status = this.#readStatus(current);
    if (this.#isBlocked(current, status)) {
      return this.#cancelBlocked(current, status);
    }
    return null;
  }

  #isBlocked(
    packageRecord: DeliveryPackageRecord,
    status: ProfessionalDeliveryStatus,
  ): boolean {
    return (
      status.jobCancelled ||
      packageRecord.commissionedModules.some((module) =>
        status.withdrawnModules.includes(module),
      )
    );
  }

  #cancelBlocked(
    packageRecord: DeliveryPackageRecord,
    status: ProfessionalDeliveryStatus,
  ): DeliveryPackageRecord {
    return this.cancelPackage(
      packageRecord.packageId,
      status.jobCancelled ? "job_cancelled" : "module_withdrawn",
    );
  }
}

export class InMemoryProfessionalDeliveryStatus implements ProfessionalDeliveryStatusPort {
  readonly #statuses = new Map<string, ProfessionalDeliveryStatus>();

  set(
    organizationId: string,
    jobId: string,
    status: ProfessionalDeliveryStatus,
  ): void {
    this.#statuses.set(`${organizationId}:${jobId}`, {
      jobCancelled: status.jobCancelled,
      withdrawnModules: [...status.withdrawnModules],
    });
  }

  readStatus(
    input: Readonly<{
      organizationId: string;
      jobId: string;
    }>,
  ): ProfessionalDeliveryStatus {
    return (
      this.#statuses.get(`${input.organizationId}:${input.jobId}`) ?? {
        jobCancelled: false,
        withdrawnModules: [],
      }
    );
  }
}
