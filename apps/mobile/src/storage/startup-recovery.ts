import type {
  FinalFileObservation,
  PartialFileObservation,
  ReconciliationAction,
  ReconciliationResult,
} from "./reconciliation";
import { reconcileCaptureStorage } from "./reconciliation";
import type { CaptureLedger } from "./ports";

export type CaptureResidueInventory = {
  quarantine(input: {
    captureId: string;
    residue: "final" | "partial";
    reason: string;
  }): Promise<void>;
  scan(): Promise<{
    finals: readonly FinalFileObservation[];
    partials: readonly PartialFileObservation[];
  }>;
};

function quarantineInstruction(
  action: ReconciliationAction,
):
  | { captureId: string; reason: string; residue: "final" | "partial" }
  | undefined {
  if (action.kind === "quarantine_final") {
    return {
      captureId: action.captureId,
      reason: action.reason,
      residue: "final",
    };
  }
  if (action.kind === "quarantine_partial") {
    return {
      captureId: action.captureId,
      reason: action.reason,
      residue: "partial",
    };
  }
  return undefined;
}

/** Runs only after the local ledger and protected-data filesystem are available. */
export async function runStartupCaptureRecovery(input: {
  inventory: CaptureResidueInventory;
  ledger: CaptureLedger;
}): Promise<ReconciliationResult> {
  const observed = await input.inventory.scan();
  const result = await reconcileCaptureStorage({
    ...observed,
    ledger: input.ledger,
  });
  for (const action of result.actions) {
    const instruction = quarantineInstruction(action);
    if (instruction !== undefined) {
      await input.inventory.quarantine(instruction);
    }
  }
  return result;
}
