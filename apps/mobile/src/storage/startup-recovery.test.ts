import { describe, expect, it, vi } from "vitest";

import type { CaptureIntent, DurableArtifact } from "../capture/types.js";
import { InMemoryCaptureLedger } from "./in-memory-capture-ledger.js";
import { runStartupCaptureRecovery } from "./startup-recovery.js";

const intent: CaptureIntent = {
  areaId: "area-main-bathroom",
  captureId: "capture-startup",
  capturedAt: "2026-07-14T08:00:00.000Z",
  deviceId: "device-field-01",
  evidenceRole: "private_coverage",
  jobId: "job-demo",
  kind: "photo",
  sequence: 8,
  state: "pending",
};

const final: DurableArtifact = {
  byteLength: 2048,
  captureId: intent.captureId,
  directorySync: "synced",
  fileUri: "file:///durable/capture-startup.capture",
  immutable: true,
  queueLane: "photo_upload",
  sha256: "d".repeat(64),
};

describe("startup capture recovery runner", () => {
  it("scans before acknowledgement and adopts the same valid final identity", async () => {
    const ledger = new InMemoryCaptureLedger();
    await ledger.beginIntent(intent);
    const quarantine = vi.fn(() => Promise.resolve());

    const result = await runStartupCaptureRecovery({
      inventory: {
        quarantine,
        scan: () =>
          Promise.resolve({
            finals: [{ artifact: final, integrity: "valid" as const }],
            partials: [],
          }),
      },
      ledger,
    });

    expect(result.actions).toEqual([
      { captureId: intent.captureId, kind: "adopted_final" },
    ]);
    expect(ledger.getArtifact(intent.captureId)?.captureId).toBe(
      intent.captureId,
    );
    expect(quarantine).not.toHaveBeenCalled();
  });

  it("executes the quarantine action for an incomplete publication", async () => {
    const ledger = new InMemoryCaptureLedger();
    await ledger.beginIntent(intent);
    const quarantine = vi.fn(() => Promise.resolve());

    await runStartupCaptureRecovery({
      inventory: {
        quarantine,
        scan: () =>
          Promise.resolve({
            finals: [],
            partials: [
              {
                captureId: intent.captureId,
                fileUri: "file:///durable/.capture-startup.partial",
              },
            ],
          }),
      },
      ledger,
    });

    expect(quarantine).toHaveBeenCalledWith({
      captureId: intent.captureId,
      reason: "publication_incomplete",
      residue: "partial",
    });
  });
});
