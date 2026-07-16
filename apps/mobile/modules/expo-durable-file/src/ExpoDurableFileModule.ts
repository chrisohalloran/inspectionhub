import { NativeModule, requireNativeModule } from "expo";

import type {
  DebugFailurePoint,
  DurableCaptureResult,
  DurableResidueScan,
  NativeThermalState,
  QuarantineResidueInput,
} from "./ExpoDurableFile.types";

declare class ExpoDurableFileNativeModule extends NativeModule {
  persistCapture(
    captureId: string,
    sourceUri: string,
    debugFailurePoint: DebugFailurePoint,
  ): Promise<DurableCaptureResult>;
  getThermalState(): Promise<NativeThermalState>;
  quarantineCaptureResidue(
    captureId: string,
    residue: QuarantineResidueInput["residue"],
    reason: string,
  ): Promise<void>;
  scanCaptureResidues(): Promise<DurableResidueScan>;
  terminateProcessForDurabilityOracle(): Promise<void>;
}

export default requireNativeModule<ExpoDurableFileNativeModule>(
  "ExpoDurableFile",
);
