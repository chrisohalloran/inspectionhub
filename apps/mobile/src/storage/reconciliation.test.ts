import { describe, expect, it } from "vitest";

import { InMemoryCaptureLedger } from "./in-memory-capture-ledger.js";
import { reconcileCaptureStorage } from "./reconciliation.js";
import type { CaptureIntent, DurableArtifact } from "../capture/types.js";

const intent: CaptureIntent = {
  areaId: "area-main-bathroom",
  captureId: "capture-reconcile",
  capturedAt: "2026-07-14T08:00:00.000Z",
  deviceId: "device-field-01",
  evidenceRole: "private_coverage",
  jobId: "job-demo",
  kind: "photo",
  sequence: 4,
  state: "pending",
};

const final: DurableArtifact = {
  byteLength: 4096,
  captureId: intent.captureId,
  directorySync: "synced",
  fileUri: "file:///durable/capture-reconcile.capture",
  immutable: true,
  queueLane: "photo_upload",
  sha256: "b".repeat(64),
};

describe("capture startup reconciliation", () => {
  it("adopts a valid final using its pre-existing capture intent and never issues a new identity", async () => {
    const ledger = new InMemoryCaptureLedger();
    await ledger.beginIntent(intent);

    const result = await reconcileCaptureStorage({
      finals: [{ artifact: final, integrity: "valid" }],
      ledger,
      partials: [],
    });

    expect(result.actions).toEqual([
      {
        captureId: intent.captureId,
        kind: "adopted_final",
      },
    ]);
    expect(ledger.getArtifact(intent.captureId)?.captureId).toBe(
      intent.captureId,
    );
    expect(ledger.getIntent(intent.captureId)?.state).toBe("acknowledged");
  });

  it("quarantines partial-only residue without acknowledging it", async () => {
    const ledger = new InMemoryCaptureLedger();
    await ledger.beginIntent(intent);

    const result = await reconcileCaptureStorage({
      finals: [],
      ledger,
      partials: [
        {
          captureId: intent.captureId,
          fileUri: "file:///durable/.capture-reconcile.boundary.partial",
        },
      ],
    });

    expect(result.actions).toEqual([
      {
        captureId: intent.captureId,
        kind: "quarantine_partial",
        reason: "publication_incomplete",
      },
    ]);
    expect(ledger.getArtifact(intent.captureId)).toBeUndefined();
    expect(ledger.getIntent(intent.captureId)?.state).toBe("quarantined");
  });

  it.each(["corrupt", "hash_mismatch"] as const)(
    "quarantines a %s final and marks evidence at risk",
    async (integrity) => {
      const ledger = new InMemoryCaptureLedger();
      await ledger.beginIntent(intent);

      const result = await reconcileCaptureStorage({
        finals: [{ artifact: final, integrity }],
        ledger,
        partials: [],
      });

      expect(result.actions[0]).toMatchObject({
        captureId: intent.captureId,
        kind: "quarantine_final",
        reason: integrity,
      });
      expect(result.evidenceAtRisk).toEqual([intent.captureId]);
      expect(ledger.getArtifact(intent.captureId)).toBeUndefined();
    },
  );

  it("reports a durable ledger entry with a missing final as evidence at risk", async () => {
    const ledger = new InMemoryCaptureLedger();
    await ledger.beginIntent(intent);
    await ledger.commitDurableCapture(intent.captureId, final);

    const result = await reconcileCaptureStorage({
      finals: [],
      ledger,
      partials: [],
    });

    expect(result.actions).toEqual([
      {
        captureId: intent.captureId,
        kind: "ledger_missing_final",
      },
    ]);
    expect(result.evidenceAtRisk).toEqual([intent.captureId]);
    expect(ledger.getIntent(intent.captureId)?.state).toBe("evidence_at_risk");
  });

  it("does not treat a partial as a valid replacement for a committed final", async () => {
    const ledger = new InMemoryCaptureLedger();
    await ledger.beginIntent(intent);
    await ledger.commitDurableCapture(intent.captureId, final);

    const result = await reconcileCaptureStorage({
      finals: [],
      ledger,
      partials: [
        {
          captureId: intent.captureId,
          fileUri: "file:///durable/.capture-reconcile.partial",
        },
      ],
    });

    expect(result.actions).toEqual([
      {
        captureId: intent.captureId,
        kind: "quarantine_partial",
        reason: "publication_incomplete",
      },
      { captureId: intent.captureId, kind: "ledger_missing_final" },
    ]);
    expect(result.evidenceAtRisk).toEqual([intent.captureId]);
  });

  it("resumes an acknowledgement after termination between SQLite commit and UI acknowledgement", async () => {
    const ledger = new InMemoryCaptureLedger();
    await ledger.beginIntent(intent);
    await ledger.commitDurableCapture(intent.captureId, final);

    const result = await reconcileCaptureStorage({
      finals: [{ artifact: final, integrity: "valid" }],
      ledger,
      partials: [],
    });

    expect(result.actions).toEqual([
      {
        captureId: intent.captureId,
        kind: "resume_acknowledgement",
      },
    ]);
    expect(result.evidenceAtRisk).toEqual([]);
    expect(ledger.getIntent(intent.captureId)?.state).toBe("acknowledged");

    const repeated = await reconcileCaptureStorage({
      finals: [{ artifact: final, integrity: "valid" }],
      ledger,
      partials: [],
    });

    expect(repeated.actions).toEqual([]);
    expect(repeated.evidenceAtRisk).toEqual([]);
  });
});
