export type DebugFailurePoint =
  | "none"
  | "terminate_after_copy"
  | "terminate_after_hash"
  | "return_after_partial_sync"
  | "terminate_after_partial_sync"
  | "return_after_atomic_rename"
  | "terminate_after_atomic_rename";

export type DirectorySyncStatus = "synced" | "unsupported";

export type NativeThermalState =
  "critical" | "fair" | "nominal" | "serious" | "unknown";

export type DurableCaptureStage =
  | "validation"
  | "prepare_destination"
  | "copy"
  | "partial_sync"
  | "hash"
  | "make_immutable"
  | "atomic_rename"
  | "directory_sync"
  | "complete";

export type DurableCaptureErrorCode =
  | "INVALID_CAPTURE_ID"
  | "INVALID_SOURCE_URI"
  | "PATH_TRAVERSAL"
  | "SOURCE_NOT_REGULAR_FILE"
  | "SOURCE_UNREADABLE"
  | "SOURCE_INSIDE_DURABLE_ROOT"
  | "FINAL_ALREADY_EXISTS"
  | "DESTINATION_UNAVAILABLE"
  | "PARTIAL_CREATE_FAILED"
  | "PARTIAL_SYNC_FAILED"
  | "HASH_FAILED"
  | "IMMUTABILITY_FAILED"
  | "ATOMIC_RENAME_UNAVAILABLE"
  | "DIRECTORY_SYNC_FAILED"
  | "DEBUG_FAILURE_DISABLED"
  | "DEBUG_FAILURE_INJECTED"
  | "IO_FAILURE";

export type DurableCaptureInput = {
  /** Opaque caller-generated identity. It is never derived from file content. */
  captureId: string;
  /** A local file:// URI. content:// and network URLs are deliberately rejected. */
  sourceUri: string;
  /** Development builds only. Production builds fail closed when this is not `none`. */
  debugFailurePoint?: DebugFailurePoint;
};

export type DurableCaptureError = {
  code: DurableCaptureErrorCode;
  stage: DurableCaptureStage;
  message: string;
  retryable: boolean;
  artifactState: "none" | "partial_preserved_debug" | "final_may_exist";
};

export type DurableCaptureSuccess = {
  ok: true;
  storageBoundaryVersion: 1;
  captureId: string;
  fileUri: string;
  sha256: string;
  byteLength: number;
  immutable: true;
  directorySync: DirectorySyncStatus;
};

export type DurableCaptureFailure = {
  ok: false;
  storageBoundaryVersion: 1;
  captureId: string;
  error: DurableCaptureError;
  /** Present only in debuggable builds for the physical-device durability oracle. */
  debugArtifactUri?: string;
};

export type DurableCaptureResult =
  DurableCaptureSuccess | DurableCaptureFailure;

export type DurableFinalFileObservation = {
  artifact: Omit<DurableCaptureSuccess, "ok" | "storageBoundaryVersion">;
  integrity: "corrupt" | "hash_mismatch" | "valid";
};

export type DurablePartialFileObservation = {
  captureId: string;
  fileUri: string;
};

export type DurableResidueScan = {
  finals: readonly DurableFinalFileObservation[];
  partials: readonly DurablePartialFileObservation[];
  storageBoundaryVersion: 1;
};

export type QuarantineResidueInput = {
  captureId: string;
  reason: string;
  residue: "final" | "partial";
};
