import type { InvestigationEvidence } from "@inspection/domain/inspection/mobile";

export function visibleEvidencePage(
  evidence: readonly InvestigationEvidence[],
  visibleCount: number,
): readonly InvestigationEvidence[] {
  if (!Number.isInteger(visibleCount) || visibleCount < 1) {
    throw new TypeError("Visible evidence count must be a positive integer");
  }
  return [...evidence]
    .sort((left, right) => right.linkOrdinal - left.linkOrdinal)
    .slice(0, visibleCount);
}
