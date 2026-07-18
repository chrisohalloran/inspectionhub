import { describe, expect, it } from "vitest";

import { InMemoryCaptureLedger } from "../storage/in-memory-capture-ledger.js";
import { recordManualFallback } from "./manual-note.js";

describe("manual note fallback", () => {
  it("persists and queues without a media artifact", async () => {
    const ledger = new InMemoryCaptureLedger({
      manualNoteDigest: testDigest,
    });

    await expect(
      recordManualFallback({
        areaId: "area-main-bathroom",
        digest: testDigest,
        idFactory: () => "note-camera-denied",
        jobId: "job-demo",
        ledger,
        recordedAt: "2026-07-14T08:05:00.000Z",
        text: "Cracking observed; camera permission unavailable.",
      }),
    ).resolves.toEqual({
      contentHash:
        "67d7842e67d7842e67d7842e67d7842e67d7842e67d7842e67d7842e67d7842e",
      noteId: "note-camera-denied",
      state: "queued_locally",
    });
    expect(ledger.getManualNote("note-camera-denied")).toEqual({
      areaId: "area-main-bathroom",
      contentHash:
        "67d7842e67d7842e67d7842e67d7842e67d7842e67d7842e67d7842e67d7842e",
      jobId: "job-demo",
      noteId: "note-camera-denied",
      recordedAt: "2026-07-14T08:05:00.000Z",
      schemaVersion: "manual-note-v1",
      text: "Cracking observed; camera permission unavailable.",
    });
    expect(ledger.listManualNotes()).toEqual([
      ledger.getManualNote("note-camera-denied"),
    ]);
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

  it("canonicalises note text and fails closed on duplicate or forged identities", async () => {
    const ledger = new InMemoryCaptureLedger({
      manualNoteDigest: testDigest,
    });
    const input = {
      areaId: "area-main-bathroom",
      digest: testDigest,
      idFactory: () => "note-stable-identity",
      jobId: "job-demo",
      ledger,
      recordedAt: "2026-07-14T08:05:00.000Z",
      text: "  Movement observed.\r\nFurther inspection required.  ",
    };

    const first = await recordManualFallback(input);
    expect(ledger.getManualNote(first.noteId)?.text).toBe(
      "Movement observed.\nFurther inspection required.",
    );
    await expect(recordManualFallback(input)).rejects.toThrow(
      "Manual note identity already exists",
    );
    await expect(
      ledger.recordManualNote({
        ...ledger.getManualNote(first.noteId)!,
        contentHash: "0".repeat(64),
        noteId: "note-forged-hash",
      }),
    ).rejects.toThrow("Manual note content hash does not match");
    expect(ledger.getManualNote("note-forged-hash")).toBeUndefined();

    await ledger.beginIntent({
      areaId: "area-main-bathroom",
      captureId: "note-capture-conflict",
      capturedAt: "2026-07-14T08:06:00.000Z",
      deviceId: "device-field-01",
      evidenceRole: "private_coverage",
      jobId: "job-demo",
      kind: "photo",
      sequence: 1,
      state: "pending",
    });
    await expect(
      recordManualFallback({
        ...input,
        idFactory: () => "note-capture-conflict",
      }),
    ).rejects.toThrow("Manual note identity conflicts with capture identity");
    expect(ledger.getManualNote("note-capture-conflict")).toBeUndefined();
  });
});

function testDigest(value: string): Promise<string> {
  let state = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    state = Math.imul(state ^ value.charCodeAt(index), 16_777_619) >>> 0;
  }
  return Promise.resolve(state.toString(16).padStart(8, "0").repeat(8));
}
