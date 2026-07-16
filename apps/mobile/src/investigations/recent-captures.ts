import type { EvidenceAttachmentInput } from "@inspection/domain/inspection/mobile";

export function selectRecentJobCaptures(input: {
  readonly captures: readonly EvidenceAttachmentInput[];
  readonly jobId: string;
  readonly beforeOrAt: string;
  readonly limit?: number;
}): readonly EvidenceAttachmentInput[] {
  const limit = input.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError("Recent capture limit must be a positive integer");
  }
  return input.captures
    .filter(
      (capture) =>
        capture.jobId === input.jobId && capture.capturedAt <= input.beforeOrAt,
    )
    .sort(
      (a, b) =>
        b.capturedAt.localeCompare(a.capturedAt) ||
        b.captureSequence - a.captureSequence,
    )
    .slice(0, limit)
    .sort(
      (a, b) =>
        a.capturedAt.localeCompare(b.capturedAt) ||
        a.captureSequence - b.captureSequence,
    );
}
