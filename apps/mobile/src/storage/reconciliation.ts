import type { CaptureKind, DurableArtifact } from "../capture/types";
import type { CaptureLedger } from "./ports";

export type ObservedFinalFile = Omit<DurableArtifact, "queueLane">;

export type FinalFileObservation = {
  artifact: ObservedFinalFile;
  integrity: "corrupt" | "hash_mismatch" | "valid";
};

export type PartialFileObservation = {
  captureId: string;
  fileUri: string;
};

export type ReconciliationAction =
  | { captureId: string; kind: "adopted_final" }
  | { captureId: string; kind: "discard_pending_intent" }
  | { captureId: string; kind: "ledger_missing_final" }
  | {
      captureId: string;
      kind: "quarantine_final";
      reason:
        | "corrupt"
        | "hash_mismatch"
        | "ledger_identity_mismatch"
        | "missing_recovery_intent";
    }
  | {
      captureId: string;
      kind: "quarantine_partial";
      reason: "missing_recovery_intent" | "publication_incomplete";
    }
  | { captureId: string; kind: "resume_acknowledgement" };

export type ReconciliationResult = {
  actions: readonly ReconciliationAction[];
  evidenceAtRisk: readonly string[];
};

type ReconciliationInput = {
  finals: readonly FinalFileObservation[];
  ledger: CaptureLedger;
  partials: readonly PartialFileObservation[];
};

function artifactIdentityMatches(
  left: DurableArtifact,
  right: ObservedFinalFile,
): boolean {
  return (
    left.captureId === right.captureId &&
    left.byteLength === right.byteLength &&
    left.fileUri === right.fileUri &&
    left.sha256 === right.sha256 &&
    left.immutable === right.immutable
  );
}

function durableArtifactFromObservation(
  observed: ObservedFinalFile,
  kind: CaptureKind,
): DurableArtifact {
  return {
    ...observed,
    queueLane: kind === "photo" ? "photo_upload" : "voice_upload",
  };
}

/**
 * Reconciles observed native files against SQLite identities without creating a
 * replacement capture ID. The caller must perform any quarantine file move;
 * this projection records the required deterministic action and ledger state.
 */
export async function reconcileCaptureStorage({
  finals,
  ledger,
  partials,
}: ReconciliationInput): Promise<ReconciliationResult> {
  const actions: ReconciliationAction[] = [];
  const evidenceAtRisk = new Set<string>();
  const finalByCapture = new Map(
    finals.map((observation) => [observation.artifact.captureId, observation]),
  );
  const partialByCapture = new Map(
    partials.map((observation) => [observation.captureId, observation]),
  );
  const intents = ledger.listIntents();
  const intentIds = new Set(intents.map((intent) => intent.captureId));

  for (const intent of intents) {
    const observedFinal = finalByCapture.get(intent.captureId);
    const observedPartial = partialByCapture.get(intent.captureId);
    const ledgerArtifact = ledger.getArtifact(intent.captureId);

    if (observedFinal !== undefined) {
      if (observedFinal.integrity !== "valid") {
        await ledger.markIntent(
          intent.captureId,
          "evidence_at_risk",
          observedFinal.integrity,
        );
        actions.push({
          captureId: intent.captureId,
          kind: "quarantine_final",
          reason: observedFinal.integrity,
        });
        evidenceAtRisk.add(intent.captureId);
        continue;
      }

      if (
        ledgerArtifact !== undefined &&
        !artifactIdentityMatches(ledgerArtifact, observedFinal.artifact)
      ) {
        await ledger.markIntent(
          intent.captureId,
          "evidence_at_risk",
          "ledger_identity_mismatch",
        );
        actions.push({
          captureId: intent.captureId,
          kind: "quarantine_final",
          reason: "ledger_identity_mismatch",
        });
        evidenceAtRisk.add(intent.captureId);
        continue;
      }

      if (ledgerArtifact === undefined) {
        await ledger.commitDurableCapture(
          intent.captureId,
          durableArtifactFromObservation(observedFinal.artifact, intent.kind),
        );
        await ledger.markIntent(intent.captureId, "acknowledged");
        actions.push({ captureId: intent.captureId, kind: "adopted_final" });
      } else if (intent.state !== "acknowledged") {
        await ledger.markIntent(intent.captureId, "acknowledged");
        actions.push({
          captureId: intent.captureId,
          kind: "resume_acknowledgement",
        });
      }
      continue;
    }

    if (observedPartial !== undefined) {
      if (ledgerArtifact !== undefined) {
        await ledger.markIntent(
          intent.captureId,
          "evidence_at_risk",
          "final_missing_partial_present",
        );
        actions.push({
          captureId: intent.captureId,
          kind: "quarantine_partial",
          reason: "publication_incomplete",
        });
        actions.push({
          captureId: intent.captureId,
          kind: "ledger_missing_final",
        });
        evidenceAtRisk.add(intent.captureId);
        continue;
      }
      await ledger.markIntent(
        intent.captureId,
        "quarantined",
        "publication_incomplete",
      );
      actions.push({
        captureId: intent.captureId,
        kind: "quarantine_partial",
        reason: "publication_incomplete",
      });
      continue;
    }

    if (ledgerArtifact !== undefined) {
      await ledger.markIntent(
        intent.captureId,
        "evidence_at_risk",
        "final_missing",
      );
      actions.push({
        captureId: intent.captureId,
        kind: "ledger_missing_final",
      });
      evidenceAtRisk.add(intent.captureId);
      continue;
    }

    await ledger.markIntent(intent.captureId, "failed", "no_file_residue");
    actions.push({
      captureId: intent.captureId,
      kind: "discard_pending_intent",
    });
  }

  for (const observedFinal of finals) {
    const captureId = observedFinal.artifact.captureId;
    if (!intentIds.has(captureId)) {
      actions.push({
        captureId,
        kind: "quarantine_final",
        reason: "missing_recovery_intent",
      });
      evidenceAtRisk.add(captureId);
    }
  }

  for (const observedPartial of partials) {
    if (!intentIds.has(observedPartial.captureId)) {
      actions.push({
        captureId: observedPartial.captureId,
        kind: "quarantine_partial",
        reason: "missing_recovery_intent",
      });
    }
  }

  return {
    actions,
    evidenceAtRisk: [...evidenceAtRisk],
  };
}
