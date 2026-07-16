import { describe, expect, it } from "vitest";

import type { CapturePerformanceSample } from "../capture/types.js";
import {
  evaluateCapturePerformance,
  nearestRankPercentile,
} from "./performance-benchmark.js";

function photoSample(
  index: number,
  interactionLatencyMs = 100,
  localDurableSaveMs = 600,
): CapturePerformanceSample {
  return {
    captureId: `photo-${index}`,
    interactionLatencyMs,
    interactionType: "shutter_acknowledgement",
    kind: "photo",
    localDurableSaveMs,
    recordedAt: `2026-07-15T10:${String(index % 60).padStart(2, "0")}:00.000Z`,
  };
}

function voiceSample(index: number): CapturePerformanceSample {
  return {
    captureId: `voice-${index}`,
    interactionLatencyMs: 200,
    interactionType: "voice_start",
    kind: "voice",
    localDurableSaveMs: 500,
    recordedAt: `2026-07-15T11:${String(index % 60).padStart(2, "0")}:00.000Z`,
  };
}

describe("capture performance benchmark", () => {
  it("uses nearest-rank and retains raw outliers", () => {
    expect(nearestRankPercentile([1, 2, 3, 4, 100], 0.95)).toBe(100);
  });

  it("passes only after every predeclared sample minimum and p95 target passes", () => {
    const samples = [
      ...Array.from({ length: 300 }, (_, index) => photoSample(index)),
      ...Array.from({ length: 30 }, (_, index) => voiceSample(index)),
    ];
    expect(evaluateCapturePerformance(samples)).toMatchObject({
      localDurableSave: { observedSamples: 300, p95Ms: 600, status: "pass" },
      overall: "pass",
      shutterAcknowledgement: {
        observedSamples: 300,
        p95Ms: 100,
        status: "pass",
      },
      voiceStart: { observedSamples: 30, p95Ms: 200, status: "pass" },
    });
  });

  it("does not turn an under-sampled or failed result into a pass", () => {
    const underSampled = [photoSample(1), voiceSample(1)];
    expect(evaluateCapturePerformance(underSampled).overall).toBe("pending");

    const failed = [
      ...Array.from({ length: 300 }, (_, index) =>
        photoSample(index, index >= 280 ? 151 : 100, 600),
      ),
      ...Array.from({ length: 30 }, (_, index) => voiceSample(index)),
    ];
    expect(evaluateCapturePerformance(failed)).toMatchObject({
      overall: "threshold_failed",
      shutterAcknowledgement: { p95Ms: 151, status: "threshold_failed" },
    });
  });
});
