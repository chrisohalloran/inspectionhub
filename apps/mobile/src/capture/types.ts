import type { InvestigationStatus } from "@inspection/domain/inspection/types";

import type { FieldDeliveryState } from "../delivery/delivery-status";
import type { InvestigationReviewItem } from "../review/investigation-review";

export type CaptureKind = "photo" | "voice";

export type QueueLane = "manual_note_sync" | "photo_upload" | "voice_upload";

export type DeviceState = "enrolled" | "lost" | "revoked";

export type FieldWorkflowSnapshot = {
  approvedModules: readonly ("building" | "timber_pest")[];
  deliveryState: FieldDeliveryState;
  investigationStatus: InvestigationStatus | "none";
  lastTransition:
    | "delivery_state_changed"
    | "investigation_completed"
    | "investigation_paused"
    | "investigation_reconciled"
    | "investigation_resumed"
    | "investigation_started"
    | "module_approved"
    | "package_confirmed"
    | "review_changed"
    | "workflow_initialized";
  packageManifestSha256: string | null;
  reviewItems: readonly InvestigationReviewItem[];
  revision: number;
  updatedAt: string;
};

export type FieldSessionSnapshot = {
  activeInvestigationId?: string;
  areaId: string;
  cachedAssignedJobIds: readonly string[];
  deviceId: string;
  deviceState: DeviceState;
  jobId: string;
  lastInvestigationId?: string;
  nextSequence: number;
  session: "expired" | "valid";
  updatedAt: string;
  workflow?: FieldWorkflowSnapshot;
};

export type CapturePermission = "denied" | "granted" | "unavailable";

export type CaptureRequest = {
  areaId: string;
  captureId?: string;
  capturedAt: string;
  debugFailurePoint?:
    | "none"
    | "return_after_atomic_rename"
    | "return_after_partial_sync"
    | "terminate_after_copy"
    | "terminate_after_hash"
    | "terminate_after_atomic_rename"
    | "terminate_after_partial_sync";
  deviceId: string;
  deviceState?: DeviceState;
  jobId: string;
  kind: CaptureKind;
  permission: CapturePermission;
  sequence: number;
  sourceUri: string;
};

export type CaptureIntentState =
  | "acknowledged"
  | "durable"
  | "evidence_at_risk"
  | "failed"
  | "pending"
  | "quarantined";

export type CaptureIntent = {
  areaId: string;
  captureId: string;
  capturedAt: string;
  deviceId: string;
  evidenceRole: "private_coverage";
  failureCode?: string;
  jobId: string;
  kind: CaptureKind;
  sequence: number;
  state: CaptureIntentState;
};

export type DurableArtifact = {
  byteLength: number;
  captureId: string;
  directorySync: "synced" | "unsupported";
  fileUri: string;
  immutable: true;
  queueLane: Extract<QueueLane, "photo_upload" | "voice_upload">;
  sha256: string;
};

export type CaptureQueueState =
  | "blocked_revoked"
  | "blocked_session"
  | "failed"
  | "pending"
  | "server_durable"
  | "uploading";

export type CaptureQueueItem = {
  captureId: string;
  lane: QueueLane;
  state: CaptureQueueState;
};

export type ManualNote = {
  areaId: string;
  jobId: string;
  noteId: string;
  recordedAt: string;
  text: string;
};

export type LocalCaptureEvent = {
  captureId: string;
  code?: string;
  ordinal: number;
  type:
    | "artifact_committed"
    | "capture_intent_reserved"
    | "capture_intent_state_changed"
    | "manual_note_recorded"
    | "queue_enqueued"
    | "queue_state_changed";
};

export type CaptureAcknowledgement = {
  captureId: string;
  kind: "acknowledged";
  localDurableSaveMs: number;
  queueLane: Extract<QueueLane, "photo_upload" | "voice_upload">;
  stateTrace: readonly CaptureMachineState[];
};

export type CapturePerformanceSample = {
  captureId: string;
  interactionLatencyMs: number;
  interactionType: "shutter_acknowledgement" | "voice_start";
  kind: CaptureKind;
  localDurableSaveMs: number;
  recordedAt: string;
};

export type CaptureBlocked = {
  captureId?: never;
  fallback?: "manual_note";
  kind: "blocked";
  reason:
    | "camera_permission_denied"
    | "camera_permission_unavailable"
    | "device_lost"
    | "device_revoked"
    | "microphone_permission_denied"
    | "microphone_permission_unavailable";
  stateTrace: readonly CaptureMachineState[];
};

export type CaptureFailure = {
  captureId: string;
  fallback: "manual_note";
  kind: "failed";
  reason: "ledger_commit_failed" | "native_durability_failed";
  residue:
    | "final_without_artifact_ledger"
    | "native_state_unknown"
    | "none"
    | "partial_possible";
  stateTrace: readonly CaptureMachineState[];
};

export type CaptureResult =
  CaptureAcknowledgement | CaptureBlocked | CaptureFailure;

export type CaptureMachineState =
  | "acknowledged"
  | "blocked"
  | "committing_ledger"
  | "failed"
  | "idle"
  | "persisting_file"
  | "reserving_identity";
