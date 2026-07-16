import type { CapturePerformanceSample } from "../capture/types";

export const launchCapturePerformanceRubric = {
  localDurableSave: { minimumSamples: 300, p95MaximumMs: 750 },
  shutterAcknowledgement: { minimumSamples: 300, p95MaximumMs: 150 },
  voiceStart: { minimumSamples: 30, p95MaximumMs: 300 },
} as const;

type MetricVerdict = {
  minimumSamples: number;
  observedSamples: number;
  p95Ms?: number;
  p95MaximumMs: number;
  status: "insufficient_samples" | "pass" | "threshold_failed";
};

export type CapturePerformanceVerdict = {
  localDurableSave: MetricVerdict;
  overall: "pass" | "pending" | "threshold_failed";
  shutterAcknowledgement: MetricVerdict;
  voiceStart: MetricVerdict;
};

export function nearestRankPercentile(
  values: readonly number[],
  percentile: number,
): number | undefined {
  if (values.length === 0) return undefined;
  if (percentile <= 0 || percentile > 1) {
    throw new Error("Percentile must be greater than zero and at most one");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(percentile * sorted.length);
  return sorted[rank - 1];
}

function verdict(
  values: readonly number[],
  rubric: { minimumSamples: number; p95MaximumMs: number },
): MetricVerdict {
  const p95Ms = nearestRankPercentile(values, 0.95);
  if (values.length < rubric.minimumSamples || p95Ms === undefined) {
    return {
      minimumSamples: rubric.minimumSamples,
      observedSamples: values.length,
      ...(p95Ms === undefined ? {} : { p95Ms }),
      p95MaximumMs: rubric.p95MaximumMs,
      status: "insufficient_samples",
    };
  }
  return {
    minimumSamples: rubric.minimumSamples,
    observedSamples: values.length,
    p95Ms,
    p95MaximumMs: rubric.p95MaximumMs,
    status: p95Ms <= rubric.p95MaximumMs ? "pass" : "threshold_failed",
  };
}

export function evaluateCapturePerformance(
  samples: readonly CapturePerformanceSample[],
): CapturePerformanceVerdict {
  const photoSamples = samples.filter((sample) => sample.kind === "photo");
  const voiceSamples = samples.filter((sample) => sample.kind === "voice");
  const result = {
    localDurableSave: verdict(
      photoSamples.map((sample) => sample.localDurableSaveMs),
      launchCapturePerformanceRubric.localDurableSave,
    ),
    shutterAcknowledgement: verdict(
      photoSamples
        .filter(
          (sample) => sample.interactionType === "shutter_acknowledgement",
        )
        .map((sample) => sample.interactionLatencyMs),
      launchCapturePerformanceRubric.shutterAcknowledgement,
    ),
    voiceStart: verdict(
      voiceSamples
        .filter((sample) => sample.interactionType === "voice_start")
        .map((sample) => sample.interactionLatencyMs),
      launchCapturePerformanceRubric.voiceStart,
    ),
  };
  const statuses = Object.values(result).map((metric) => metric.status);
  return {
    ...result,
    overall: statuses.includes("threshold_failed")
      ? "threshold_failed"
      : statuses.includes("insufficient_samples")
        ? "pending"
        : "pass",
  };
}
