export const acceptedUploadMediaTypes = [
  "image/jpeg",
  "image/heic",
  "audio/m4a",
  "audio/wav",
] as const;

export type UploadMediaType = (typeof acceptedUploadMediaTypes)[number];

export interface SyncPrincipal {
  readonly organizationId: string;
  readonly actorId: string;
  readonly assignedJobIds: ReadonlySet<string>;
}

export interface UploadDescriptor {
  readonly artifactId: string;
  readonly captureId: string;
  readonly organizationId: string;
  readonly jobId: string;
  readonly captureSequence: number;
  readonly capturedAt: string;
  readonly mediaType: UploadMediaType;
  readonly byteLength: number;
  readonly sha256: string;
  readonly deviceId?: string;
  readonly captureArea?: string;
}

export interface UploadIntent {
  readonly intentId: string;
  readonly uploadToken: string;
  readonly storageKey: string;
  readonly expiresAt: string;
  readonly descriptor: UploadDescriptor;
}

export interface StoredObjectMetadata {
  readonly key: string;
  readonly version: string;
  readonly byteLength: number;
  readonly mediaType: string;
  readonly createdAt: string;
}

export interface ImmutableObjectStore {
  putImmutable(
    key: string,
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<StoredObjectMetadata>;
  head(key: string): Promise<StoredObjectMetadata | undefined>;
  read(key: string): Promise<Uint8Array | undefined>;
  list(prefix: string): Promise<readonly StoredObjectMetadata[]>;
}

export type ArtifactTrustState =
  "original_quarantined" | "safe_proxy" | "content_rejected";

export interface DurableArtifactRecord extends UploadDescriptor {
  readonly storageKey: string;
  readonly objectVersion: string;
  readonly observedAt: string;
  readonly trustState: "original_quarantined";
}

export interface SafeProxyRecord {
  readonly artifactId: string;
  readonly organizationId: string;
  readonly jobId: string;
  readonly parentArtifactId: string;
  readonly parentSha256: string;
  readonly storageKey: string;
  readonly objectVersion: string;
  readonly mediaType: "image/jpeg" | "audio/wav";
  readonly byteLength: number;
  readonly sha256: string;
  readonly transformation: "safe_proxy";
  readonly transformationVersion: string;
  readonly trustState: "safe_proxy";
  readonly createdAt: string;
}

export interface ContentAssessment {
  readonly assessmentId: string;
  readonly artifactId: string;
  readonly organizationId: string;
  readonly state: "accepted" | "rejected";
  readonly reasonCode?: string;
  readonly observedMediaType?: UploadMediaType;
  readonly width?: number;
  readonly height?: number;
  readonly durationMs?: number;
  readonly decoderVersion: string;
  readonly createdAt: string;
  readonly safeProxyArtifactId?: string;
}

export interface SafeSyncEvent {
  readonly eventId: string;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly eventType:
    | "artifact.durability_verified"
    | "artifact.content_accepted"
    | "artifact.content_rejected"
    | "artifact.duplicate_attempt"
    | "artifact.hash_divergence";
  readonly safeMetadata: Readonly<Record<string, string | number | boolean>>;
  readonly recordedAt: string;
}

export interface SyncOutboxRecord {
  readonly outboxId: string;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly destination: "internal_task_queue";
  readonly action: "content.validate_and_proxy";
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly taskId?: string;
  readonly state: "observed_success" | "pending_dispatch";
  readonly observedResult: "task_enqueued_atomically" | "task_sink_unbound";
  readonly createdAt: string;
}

export interface DurabilityCommitResult {
  readonly state: "recorded" | "duplicate_attempt" | "hash_divergence";
  readonly artifact: DurableArtifactRecord;
}

export interface DurabilityTaskIntent {
  readonly organizationId: string;
  readonly taskType: "content.validate_and_proxy";
  readonly aggregateType: "artifact";
  readonly aggregateId: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
}

export interface DurabilityTaskReceipt {
  readonly taskId: string;
  readonly replayed: boolean;
}

export type ReconciliationState =
  | "consistent"
  | "object_only"
  | "row_only"
  | "missing_object"
  | "divergent_checksum"
  | "duplicate_attempt"
  | "unknown_provider"
  | "content_quarantine"
  | "deletion_suppression";

export interface ReconciliationFinding {
  readonly state: ReconciliationState;
  readonly organizationId: string;
  readonly key: string;
  readonly artifactId?: string;
  readonly detail: string;
}
