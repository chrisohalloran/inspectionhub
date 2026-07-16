import { describe, expect, it } from "vitest";

import { InMemoryCaptureLedger } from "./in-memory-capture-ledger.js";

describe("capture performance samples", () => {
  it("stores non-sensitive raw latency samples for the predeclared benchmark", async () => {
    const ledger = new InMemoryCaptureLedger();
    await ledger.recordPerformanceSample({
      captureId: "capture-performance-1",
      interactionLatencyMs: 91,
      interactionType: "shutter_acknowledgement",
      kind: "photo",
      localDurableSaveMs: 612,
      recordedAt: "2026-07-15T10:00:00.000Z",
    });

    expect(ledger.listPerformanceSamples()).toEqual([
      {
        captureId: "capture-performance-1",
        interactionLatencyMs: 91,
        interactionType: "shutter_acknowledgement",
        kind: "photo",
        localDurableSaveMs: 612,
        recordedAt: "2026-07-15T10:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(ledger.listPerformanceSamples())).not.toMatch(
      /file:\/\/|media|transcript|address/iu,
    );
  });
});
