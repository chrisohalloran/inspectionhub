import {
  persistCapture,
  quarantineCaptureResidue,
  scanCaptureResidues,
} from "../../modules/expo-durable-file";
import type { DurableFilePort } from "./ports";
import type { CaptureResidueInventory } from "./startup-recovery";

/**
 * The only production adapter from U4 into the native durability primitive.
 * The native module owns file sync and atomic publication; this adapter owns no
 * acknowledgement or SQLite state.
 */
export const expoDurableFilePort: DurableFilePort = {
  persistCapture,
};

export const expoCaptureResidueInventory: CaptureResidueInventory = {
  quarantine: quarantineCaptureResidue,
  scan: scanCaptureResidues,
};
