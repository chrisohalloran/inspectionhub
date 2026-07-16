import ExpoDurableFileModule from "./ExpoDurableFileModule";
import type {
  DurableCaptureInput,
  DurableCaptureResult,
  DurableResidueScan,
  NativeThermalState,
  QuarantineResidueInput,
} from "./ExpoDurableFile.types";

/**
 * Copies one temporary capture into private durable storage.
 *
 * This primitive intentionally does not acknowledge the capture or mutate the
 * SQLite ledger. The U4 storage service owns that transaction and reconciliation.
 */
export function persistCapture(
  input: DurableCaptureInput,
): Promise<DurableCaptureResult> {
  return ExpoDurableFileModule.persistCapture(
    input.captureId,
    input.sourceUri,
    input.debugFailurePoint ?? "none",
  );
}

export function scanCaptureResidues(): Promise<DurableResidueScan> {
  return ExpoDurableFileModule.scanCaptureResidues();
}

export function getThermalState(): Promise<NativeThermalState> {
  return ExpoDurableFileModule.getThermalState();
}

export function quarantineCaptureResidue(
  input: QuarantineResidueInput,
): Promise<void> {
  return ExpoDurableFileModule.quarantineCaptureResidue(
    input.captureId,
    input.residue,
    input.reason,
  );
}

export function terminateProcessForDurabilityOracle(): Promise<void> {
  return ExpoDurableFileModule.terminateProcessForDurabilityOracle();
}
