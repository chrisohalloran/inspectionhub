import { describe, expect, it } from "vitest";

import type { InvestigationEvidence } from "@inspection/domain/inspection/mobile";

import { visibleEvidencePage } from "./evidence-area-list.js";

describe("evidence area correction list", () => {
  it("keeps older evidence reachable in stable newest-first pages", () => {
    const evidence = Array.from({ length: 12 }, (_, index) => item(index + 1));

    expect(
      visibleEvidencePage(evidence, 5).map((entry) => entry.captureSequence),
    ).toEqual([12, 11, 10, 9, 8]);
    expect(
      visibleEvidencePage(evidence, 10).map((entry) => entry.captureSequence),
    ).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    expect(
      visibleEvidencePage(evidence, 15).map((entry) => entry.captureSequence),
    ).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });
});

function item(captureSequence: number): InvestigationEvidence {
  return {
    areaAssignmentHistory: [],
    artifactId: `photo-${captureSequence}`,
    artifactKind: "photo",
    attachedAt: "2026-07-17T08:00:00.000+10:00",
    attachedByInspectorId: "inspector-1",
    captureAreaId: "area-main-bathroom",
    capturedAt: `2026-07-17T08:00:${String(captureSequence).padStart(2, "0")}.000+10:00`,
    captureSequence,
    currentAreaId: "area-main-bathroom",
    linkOrdinal: captureSequence,
    source: "attached_recent",
  };
}
