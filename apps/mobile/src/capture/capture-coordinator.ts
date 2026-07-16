import { CaptureMachine } from "./capture-machine";
import type {
  CaptureIntent,
  CaptureRequest,
  CaptureResult,
  DurableArtifact,
} from "./types";
import type { CaptureLedger, DurableFilePort } from "../storage/ports";

type CaptureCoordinatorDependencies = {
  boundaryHook?: (
    boundary: "after_acknowledgement" | "after_sqlite_commit",
  ) => Promise<void> | void;
  durableFiles: DurableFilePort;
  idFactory: () => string;
  ledger: CaptureLedger;
  monotonicClock?: () => number;
};

function permissionReason(
  request: CaptureRequest,
):
  | "camera_permission_denied"
  | "camera_permission_unavailable"
  | "microphone_permission_denied"
  | "microphone_permission_unavailable"
  | undefined {
  if (request.permission === "granted") {
    return undefined;
  }
  return `${request.kind === "photo" ? "camera" : "microphone"}_permission_${request.permission}`;
}

function queueLane(kind: CaptureRequest["kind"]): DurableArtifact["queueLane"] {
  return kind === "photo" ? "photo_upload" : "voice_upload";
}

function failureResidue(
  artifactState: "final_may_exist" | "none" | "partial_preserved_debug",
): "none" | "partial_possible" | "final_without_artifact_ledger" {
  if (artifactState === "none") {
    return "none";
  }
  if (artifactState === "final_may_exist") {
    return "final_without_artifact_ledger";
  }
  return "partial_possible";
}

export function createCaptureCoordinator({
  boundaryHook,
  durableFiles,
  idFactory,
  ledger,
  monotonicClock = () => globalThis.performance.now(),
}: CaptureCoordinatorDependencies): {
  capture(request: CaptureRequest): Promise<CaptureResult>;
} {
  return {
    async capture(request): Promise<CaptureResult> {
      const machine = new CaptureMachine();
      if (request.deviceState === "revoked" || request.deviceState === "lost") {
        machine.send("block");
        return {
          kind: "blocked",
          reason:
            request.deviceState === "revoked"
              ? "device_revoked"
              : "device_lost",
          stateTrace: machine.trace,
        };
      }

      const deniedReason = permissionReason(request);
      if (deniedReason !== undefined) {
        machine.send("block");
        return {
          fallback: "manual_note",
          kind: "blocked",
          reason: deniedReason,
          stateTrace: machine.trace,
        };
      }

      const durableStartedAt = monotonicClock();

      machine.send("reserve_identity");
      const captureId = request.captureId ?? idFactory();
      const intent: CaptureIntent = {
        areaId: request.areaId,
        captureId,
        capturedAt: request.capturedAt,
        deviceId: request.deviceId,
        evidenceRole: "private_coverage",
        jobId: request.jobId,
        kind: request.kind,
        sequence: request.sequence,
        state: "pending",
      };

      try {
        await ledger.beginIntent(intent);
      } catch {
        machine.send("fail");
        return {
          captureId,
          fallback: "manual_note",
          kind: "failed",
          reason: "ledger_commit_failed",
          residue: "none",
          stateTrace: machine.trace,
        };
      }

      machine.send("persist_file");
      let persisted: Awaited<ReturnType<DurableFilePort["persistCapture"]>>;
      try {
        persisted = await durableFiles.persistCapture({
          captureId,
          ...(request.debugFailurePoint === undefined
            ? {}
            : { debugFailurePoint: request.debugFailurePoint }),
          sourceUri: request.sourceUri,
        });
      } catch {
        await ledger.markIntent(captureId, "failed", "NATIVE_BRIDGE_REJECTED");
        machine.send("fail");
        return {
          captureId,
          fallback: "manual_note",
          kind: "failed",
          reason: "native_durability_failed",
          residue: "native_state_unknown",
          stateTrace: machine.trace,
        };
      }
      if (!persisted.ok) {
        await ledger.markIntent(captureId, "failed", persisted.error.code);
        machine.send("fail");
        return {
          captureId,
          fallback: "manual_note",
          kind: "failed",
          reason: "native_durability_failed",
          residue: failureResidue(persisted.error.artifactState),
          stateTrace: machine.trace,
        };
      }

      if (persisted.directorySync !== "synced") {
        await ledger.markIntent(
          captureId,
          "evidence_at_risk",
          "DIRECTORY_SYNC_UNSUPPORTED",
        );
        machine.send("fail");
        return {
          captureId,
          fallback: "manual_note",
          kind: "failed",
          reason: "native_durability_failed",
          residue: "final_without_artifact_ledger",
          stateTrace: machine.trace,
        };
      }

      machine.send("commit_ledger");
      const artifact: DurableArtifact = {
        byteLength: persisted.byteLength,
        captureId: persisted.captureId,
        directorySync: persisted.directorySync,
        fileUri: persisted.fileUri,
        immutable: persisted.immutable,
        queueLane: queueLane(request.kind),
        sha256: persisted.sha256,
      };
      try {
        await ledger.commitDurableCapture(captureId, artifact);
      } catch {
        machine.send("fail");
        return {
          captureId,
          fallback: "manual_note",
          kind: "failed",
          reason: "ledger_commit_failed",
          residue: "final_without_artifact_ledger",
          stateTrace: machine.trace,
        };
      }

      await boundaryHook?.("after_sqlite_commit");
      const localDurableSaveMs = Math.max(
        0,
        monotonicClock() - durableStartedAt,
      );

      machine.send("acknowledge");
      await boundaryHook?.("after_acknowledgement");
      await ledger.markIntent(captureId, "acknowledged");
      return {
        captureId,
        kind: "acknowledged",
        localDurableSaveMs,
        queueLane: artifact.queueLane,
        stateTrace: machine.trace,
      };
    },
  };
}
