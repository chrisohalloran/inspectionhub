import { randomUUID } from "node:crypto";

import type {
  ContentAssessment,
  DurabilityCommitResult,
  DurabilityTaskIntent,
  DurabilityTaskReceipt,
  DurableArtifactRecord,
  SafeProxyRecord,
  SafeSyncEvent,
  SyncOutboxRecord,
  UploadDescriptor,
} from "./types.js";

export class InMemorySyncRepository {
  readonly #artifacts = new Map<string, DurableArtifactRecord>();
  readonly #captureIndex = new Map<string, DurableArtifactRecord>();
  readonly #storageIndex = new Map<string, DurableArtifactRecord>();
  readonly #receipts = new Set<string>();
  readonly #assessments = new Map<string, ContentAssessment>();
  readonly #proxies = new Map<string, SafeProxyRecord>();
  readonly #events: SafeSyncEvent[] = [];
  readonly #outbox: SyncOutboxRecord[] = [];
  readonly #duplicateKeys = new Set<string>();
  readonly #unknownProviderKeys = new Set<string>();
  readonly #deletionSuppressions = new Set<string>();
  readonly #now: () => Date;
  readonly #enqueueTask:
    ((intent: DurabilityTaskIntent) => DurabilityTaskReceipt) | undefined;

  constructor(
    now: () => Date = () => new Date(),
    enqueueTask?: (intent: DurabilityTaskIntent) => DurabilityTaskReceipt,
  ) {
    this.#now = now;
    this.#enqueueTask = enqueueTask;
  }

  commitVerifiedDurability(input: {
    descriptor: UploadDescriptor;
    storageKey: string;
    objectVersion: string;
    observedSha256: string;
    observedByteLength: number;
  }): DurabilityCommitResult {
    const captureKey = `${input.descriptor.organizationId}:${input.descriptor.captureId}`;
    const existing = this.#captureIndex.get(captureKey);
    if (existing !== undefined) {
      if (
        existing.sha256 !== input.observedSha256 ||
        existing.byteLength !== input.observedByteLength
      ) {
        this.#appendEvent(
          existing.organizationId,
          existing.artifactId,
          "artifact.hash_divergence",
          { captureId: existing.captureId },
        );
        return { state: "hash_divergence", artifact: existing };
      }
      this.#duplicateKeys.add(existing.storageKey);
      this.#appendEvent(
        existing.organizationId,
        existing.artifactId,
        "artifact.duplicate_attempt",
        { captureId: existing.captureId },
      );
      return { state: "duplicate_attempt", artifact: existing };
    }
    if (this.#artifacts.has(input.descriptor.artifactId)) {
      throw new Error("Artifact identity already belongs to another capture");
    }
    const artifact: DurableArtifactRecord = Object.freeze({
      ...input.descriptor,
      storageKey: input.storageKey,
      objectVersion: input.objectVersion,
      observedAt: this.#now().toISOString(),
      trustState: "original_quarantined",
    });
    const taskReceipt = this.#enqueueTask?.({
      organizationId: artifact.organizationId,
      taskType: "content.validate_and_proxy",
      aggregateType: "artifact",
      aggregateId: artifact.artifactId,
      idempotencyKey: `content:${artifact.artifactId}`,
      requestFingerprint: artifact.sha256,
    });

    // The fake queue callback and following non-fallible map writes are one JS
    // critical section. The Postgres adapter maps all records to one RPC.
    this.#artifacts.set(artifact.artifactId, artifact);
    this.#captureIndex.set(captureKey, artifact);
    this.#storageIndex.set(artifact.storageKey, artifact);
    this.#receipts.add(artifact.artifactId);
    this.#appendEvent(
      artifact.organizationId,
      artifact.artifactId,
      "artifact.durability_verified",
      {
        byteLength: artifact.byteLength,
        objectVersion: artifact.objectVersion,
        sha256: artifact.sha256,
      },
    );
    this.#outbox.push(
      Object.freeze({
        outboxId: randomUUID(),
        organizationId: artifact.organizationId,
        aggregateId: artifact.artifactId,
        destination: "internal_task_queue",
        action: "content.validate_and_proxy",
        idempotencyKey: `content:${artifact.artifactId}`,
        requestFingerprint: artifact.sha256,
        ...(taskReceipt === undefined ? {} : { taskId: taskReceipt.taskId }),
        state:
          taskReceipt === undefined ? "pending_dispatch" : "observed_success",
        observedResult:
          taskReceipt === undefined
            ? "task_sink_unbound"
            : "task_enqueued_atomically",
        createdAt: this.#now().toISOString(),
      }),
    );
    return { state: "recorded", artifact };
  }

  recordAssessment(
    assessment: ContentAssessment,
    proxy?: SafeProxyRecord,
  ): void {
    if (this.#assessments.has(assessment.artifactId)) {
      throw new Error("Content assessment is append-only and already exists");
    }
    const original = this.#artifacts.get(assessment.artifactId);
    if (
      original === undefined ||
      original.organizationId !== assessment.organizationId
    ) {
      throw new Error(
        "Assessment must reference a tenant-owned durable original",
      );
    }
    if (assessment.state === "accepted" && proxy === undefined) {
      throw new Error("Accepted content requires a safe proxy");
    }
    if (assessment.state === "rejected" && proxy !== undefined) {
      throw new Error("Rejected content cannot have a safe proxy");
    }
    if (
      proxy !== undefined &&
      (proxy.parentArtifactId !== original.artifactId ||
        proxy.parentSha256 !== original.sha256 ||
        proxy.organizationId !== original.organizationId)
    ) {
      throw new Error("Safe proxy provenance does not match the original");
    }
    this.#assessments.set(assessment.artifactId, Object.freeze(assessment));
    if (proxy !== undefined)
      this.#proxies.set(proxy.artifactId, Object.freeze(proxy));
    this.#appendEvent(
      assessment.organizationId,
      assessment.artifactId,
      assessment.state === "accepted"
        ? "artifact.content_accepted"
        : "artifact.content_rejected",
      assessment.state === "accepted"
        ? { decoderVersion: assessment.decoderVersion }
        : {
            decoderVersion: assessment.decoderVersion,
            reasonCode: assessment.reasonCode ?? "unspecified",
          },
    );
  }

  artifact(id: string): DurableArtifactRecord | undefined {
    return this.#artifacts.get(id);
  }

  artifactByStorageKey(key: string): DurableArtifactRecord | undefined {
    return this.#storageIndex.get(key);
  }

  artifacts(): readonly DurableArtifactRecord[] {
    return [...this.#artifacts.values()];
  }

  hasDurabilityReceipt(artifactId: string): boolean {
    return this.#receipts.has(artifactId);
  }

  assessment(artifactId: string): ContentAssessment | undefined {
    return this.#assessments.get(artifactId);
  }

  proxies(): readonly SafeProxyRecord[] {
    return [...this.#proxies.values()];
  }

  proxyByStorageKey(key: string): SafeProxyRecord | undefined {
    return [...this.#proxies.values()].find(
      ({ storageKey }) => storageKey === key,
    );
  }

  proxy(id: string): SafeProxyRecord | undefined {
    return this.#proxies.get(id);
  }

  trustedProxyFor(originalArtifactId: string): SafeProxyRecord | undefined {
    const assessment = this.#assessments.get(originalArtifactId);
    if (assessment?.state !== "accepted") return undefined;
    return [...this.#proxies.values()].find(
      ({ parentArtifactId }) => parentArtifactId === originalArtifactId,
    );
  }

  events(): readonly SafeSyncEvent[] {
    return [...this.#events];
  }

  outbox(): readonly SyncOutboxRecord[] {
    return [...this.#outbox];
  }

  duplicateKeys(): ReadonlySet<string> {
    return this.#duplicateKeys;
  }

  recordUnknownProvider(key: string): void {
    this.#unknownProviderKeys.add(key);
  }

  unknownProviderKeys(): ReadonlySet<string> {
    return this.#unknownProviderKeys;
  }

  suppressDeletion(key: string): void {
    this.#deletionSuppressions.add(key);
  }

  deletionSuppressions(): ReadonlySet<string> {
    return this.#deletionSuppressions;
  }

  /** Integration-test seam for proving the row-only reconciliation state. */
  removeReceiptForTest(artifactId: string): void {
    this.#receipts.delete(artifactId);
  }

  #appendEvent(
    organizationId: string,
    aggregateId: string,
    eventType: SafeSyncEvent["eventType"],
    safeMetadata: SafeSyncEvent["safeMetadata"],
  ): void {
    this.#events.push(
      Object.freeze({
        eventId: randomUUID(),
        organizationId,
        aggregateId,
        eventType,
        safeMetadata: Object.freeze({ ...safeMetadata }),
        recordedAt: this.#now().toISOString(),
      }),
    );
  }
}
