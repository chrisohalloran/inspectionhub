import { describe, expect, it } from "vitest";

import { InMemoryCaptureLedger } from "../storage/in-memory-capture-ledger.js";
import { recordManualFallback } from "./manual-note.js";

describe("manual note fallback", () => {
  it("persists and queues without a media artifact", async () => {
    const ledger = new InMemoryCaptureLedger();

    await expect(
      recordManualFallback({
        areaId: "area-main-bathroom",
        idFactory: () => "note-camera-denied",
        jobId: "job-demo",
        ledger,
        recordedAt: "2026-07-14T08:05:00.000Z",
        text: "Cracking observed; camera permission unavailable.",
      }),
    ).resolves.toEqual({
      noteId: "note-camera-denied",
      state: "queued_locally",
    });
    expect(ledger.getArtifact("note-camera-denied")).toBeUndefined();
    expect(ledger.getQueue("note-camera-denied")).toEqual({
      captureId: "note-camera-denied",
      lane: "manual_note_sync",
      state: "pending",
    });
    expect(JSON.stringify(ledger.listEvents())).not.toContain(
      "Cracking observed",
    );
  });
});
