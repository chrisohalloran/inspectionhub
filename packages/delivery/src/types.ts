import type { CommissionedModules, ModuleType } from "@inspection/contracts";

export type DurabilityEntryStatus =
  "verified" | "missing" | "quarantined" | "checksum_mismatch";

export type DurabilityManifestEntry = Readonly<{
  artifactId: string;
  contentHash: string;
  byteLength: number;
  requiredOriginal: boolean;
  status: DurabilityEntryStatus;
  verifiedAt: string | null;
}>;

export type DurabilityManifest = Readonly<{
  manifestId: string;
  organizationId: string;
  jobId: string;
  revision: number;
  entries: readonly DurabilityManifestEntry[];
  canonicalHash: string;
}>;

export type FrozenModuleReference = Readonly<{
  module: ModuleType;
  moduleId: string;
  snapshotId: string;
  snapshotHash: string;
  snapshotRevision: number;
  approvalId: string;
  approvalModuleRevision: number;
}>;

export type DeliveryState =
  | "waiting_for_approval"
  | "waiting_for_evidence"
  | "queued"
  | "sending"
  | "provider_accepted"
  | "sent"
  | "failed"
  | "unknown"
  | "cancelled";

export type DeliveryPackageRecord = Readonly<{
  packageId: string;
  organizationId: string;
  jobId: string;
  commissionedModules: CommissionedModules;
  moduleSnapshots: readonly FrozenModuleReference[];
  durabilityManifestId: string;
  durabilityManifestHash: string;
  revision: number;
  state: DeliveryState;
  idempotencyKey: string;
  frozenAt: string | null;
  updatedAt: string;
  providerReference: string | null;
  failureCode: string | null;
  interventionRequired: boolean;
  cancellationReason: string | null;
}>;

export type DeliveryOutboxRecord = Readonly<{
  outboxId: string;
  packageId: string;
  organizationId: string;
  jobId: string;
  state: "queued" | "processing" | "completed" | "cancelled";
  idempotencyKey: string;
  requestFingerprint: string;
  createdAt: string;
  updatedAt: string;
}>;

export type DeliveryAuditEvent = Readonly<{
  eventId: string;
  packageId: string;
  organizationId: string;
  jobId: string;
  type:
    | "delivery.waiting_for_approval"
    | "delivery.waiting_for_evidence"
    | "delivery.package_frozen"
    | "delivery.send_started"
    | "delivery.provider_accepted"
    | "delivery.sent"
    | "delivery.failed"
    | "delivery.unknown"
    | "delivery.cancelled";
  packageRevision: number;
  recordedAt: string;
  safeMetadata: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type DeliveryProviderRequest = Readonly<{
  packageId: string;
  organizationId: string;
  jobId: string;
  idempotencyKey: string;
  requestFingerprint: string;
}>;

export type DeliveryProviderResult =
  | Readonly<{ state: "accepted"; providerReference: string }>
  | Readonly<{ state: "sent"; providerReference: string }>
  | Readonly<{
      state: "failed";
      code: string;
      retryable: boolean;
    }>
  | Readonly<{ state: "unknown"; reconciliationKey: string }>;

export interface DeliveryProviderPort {
  send(request: DeliveryProviderRequest): Promise<DeliveryProviderResult>;
}

export type ProfessionalDeliveryStatus = Readonly<{
  jobCancelled: boolean;
  withdrawnModules: readonly ModuleType[];
}>;

export interface ProfessionalDeliveryStatusPort {
  readStatus(
    input: Readonly<{
      organizationId: string;
      jobId: string;
    }>,
  ): ProfessionalDeliveryStatus;
}
