import { describe, expect, it } from "vitest";

import {
  attachInvestigationEvidence,
  startInvestigation,
} from "@inspection/domain/inspection/mobile";

import {
  createFindingCandidateLinks,
  isAttachableCaptureState,
  selectAttachableRecentCaptures,
} from "./field-actions.js";

const jobId = "job-u5-field-actions";
const bathroom = "area-main-bathroom";

function investigation() {
  return startInvestigation({
    areaId: bathroom,
    commissionedModules: [
      { module: "building", moduleId: "module-building" },
      { module: "timber_pest", moduleId: "module-timber-pest" },
    ],
    inspectorId: "inspector-1",
    investigationId: "investigation-1",
    jobId,
    organizationId: "organization-1",
    startedAt: "2026-07-17T08:00:00.000+10:00",
  });
}

const captures = [
  {
    artifactId: "photo-1",
    artifactKind: "photo" as const,
    captureAreaId: bathroom,
    capturedAt: "2026-07-17T07:59:01.000+10:00",
    captureSequence: 1,
    jobId,
  },
  {
    artifactId: "photo-2",
    artifactKind: "photo" as const,
    captureAreaId: bathroom,
    capturedAt: "2026-07-17T07:59:02.000+10:00",
    captureSequence: 2,
    jobId,
  },
  {
    artifactId: "photo-3",
    artifactKind: "photo" as const,
    captureAreaId: bathroom,
    capturedAt: "2026-07-17T07:59:03.000+10:00",
    captureSequence: 3,
    jobId,
  },
  {
    artifactId: "photo-4",
    artifactKind: "photo" as const,
    captureAreaId: bathroom,
    capturedAt: "2026-07-17T07:59:04.000+10:00",
    captureSequence: 4,
    jobId,
  },
  {
    artifactId: "other-job",
    artifactKind: "photo" as const,
    captureAreaId: bathroom,
    capturedAt: "2026-07-17T07:59:05.000+10:00",
    captureSequence: 5,
    jobId: "job-other",
  },
] as const;

describe("integrated investigation field actions", () => {
  it("only exposes capture identities that passed durable acknowledgement", () => {
    expect(isAttachableCaptureState("acknowledged")).toBe(true);
    for (const state of [
      "durable",
      "evidence_at_risk",
      "failed",
      "pending",
      "quarantined",
    ] as const) {
      expect(isAttachableCaptureState(state)).toBe(false);
    }
  });

  it("selects the latest three same-job captures that are not already attached", () => {
    const withExisting = attachInvestigationEvidence(investigation(), {
      artifacts: [captures[3]],
      attachedAt: "2026-07-17T08:00:01.000+10:00",
      expectedRevision: 0,
      inspectorId: "inspector-1",
      source: "captured_during_investigation",
    });

    expect(
      selectAttachableRecentCaptures({
        beforeOrAt: "2026-07-17T08:00:02.000+10:00",
        captures,
        investigation: withExisting,
        limit: 3,
      }).map((capture) => capture.artifactId),
    ).toEqual(["photo-1", "photo-2", "photo-3"]);
  });

  it("builds separate Building and Timber Pest candidates that share immutable sources", () => {
    const withEvidence = attachInvestigationEvidence(investigation(), {
      artifacts: [captures[0]],
      attachedAt: "2026-07-17T08:00:01.000+10:00",
      expectedRevision: 0,
      inspectorId: "inspector-1",
      source: "attached_recent",
    });
    let nextId = 0;

    const links = createFindingCandidateLinks({
      idFactory: () => `candidate-${++nextId}`,
      investigation: withEvidence,
      modules: ["building", "timber_pest"],
    });

    expect(links).toEqual([
      {
        findingCandidateId: "candidate-1",
        module: "building",
        moduleId: "module-building",
        sourceArtifactIds: ["photo-1"],
      },
      {
        findingCandidateId: "candidate-2",
        module: "timber_pest",
        moduleId: "module-timber-pest",
        sourceArtifactIds: ["photo-1"],
      },
    ]);
    expect(links[0]?.sourceArtifactIds[0]).toBe(links[1]?.sourceArtifactIds[0]);
  });

  it("rejects an empty or uncommissioned module selection before completion", () => {
    expect(() =>
      createFindingCandidateLinks({
        idFactory: () => "candidate",
        investigation: investigation(),
        modules: [],
      }),
    ).toThrow("Select at least one commissioned module");
  });
});
