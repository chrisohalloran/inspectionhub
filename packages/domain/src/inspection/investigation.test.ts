import { describe, expect, it } from "vitest";

import { DomainConflictError } from "../errors.js";
import {
  attachInvestigationEvidence,
  changeInvestigationArea,
  finishInvestigation,
  orderedInvestigationEvidence,
  pauseInvestigation,
  reassignInvestigationEvidenceArea,
  recordInvestigationMeasurement,
  recordInvestigationObservation,
  resumeInvestigation,
  startInvestigation,
} from "./investigation.js";

const jobId = "job-cracked-tile";
const inspectorId = "inspector-qld-building";
const bathroom = "area-main-bathroom";
const exterior = "area-external-east-wall";
const buildingModuleId = "module-building";
const pestModuleId = "module-timber-pest";

function newInvestigation() {
  return startInvestigation({
    investigationId: "investigation-cracked-tile",
    organizationId: "organization-demo",
    jobId,
    commissionedModules: [
      { module: "building", moduleId: buildingModuleId },
      { module: "timber_pest", moduleId: pestModuleId },
    ],
    areaId: bathroom,
    startedAt: "2026-07-14T08:05:00.000+10:00",
    inspectorId,
  });
}

const recentArtifacts = [
  {
    artifactId: "photo-three",
    artifactKind: "photo" as const,
    captureAreaId: bathroom,
    capturedAt: "2026-07-14T08:04:03.000+10:00",
    captureSequence: 3,
    jobId,
  },
  {
    artifactId: "photo-one",
    artifactKind: "photo" as const,
    captureAreaId: bathroom,
    capturedAt: "2026-07-14T08:04:01.000+10:00",
    captureSequence: 1,
    jobId,
  },
  {
    artifactId: "photo-two",
    artifactKind: "photo" as const,
    captureAreaId: bathroom,
    capturedAt: "2026-07-14T08:04:02.000+10:00",
    captureSequence: 2,
    jobId,
  },
];

describe("investigation evidence thread", () => {
  it("starts in one action, retroactively links three recent captures, and orders the evidence by capture context", () => {
    const started = newInvestigation();
    const attached = attachInvestigationEvidence(started, {
      expectedRevision: 0,
      artifacts: recentArtifacts,
      attachedAt: "2026-07-14T08:05:01.000+10:00",
      inspectorId,
      source: "attached_recent",
    });

    expect(started.status).toBe("active");
    expect(attached.evidence).toHaveLength(3);
    expect(
      orderedInvestigationEvidence(attached).map((item) => item.artifactId),
    ).toEqual(["photo-one", "photo-two", "photo-three"]);
    expect(
      attached.evidence.every((item) => item.source === "attached_recent"),
    ).toBe(true);
    expect(Object.isFrozen(attached.evidence)).toBe(true);
  });

  it("retains one ordered thread as the inspector moves from the bathroom to the exterior", () => {
    let state = attachInvestigationEvidence(newInvestigation(), {
      expectedRevision: 0,
      artifacts: recentArtifacts,
      attachedAt: "2026-07-14T08:05:01.000+10:00",
      inspectorId,
      source: "attached_recent",
    });
    state = changeInvestigationArea(state, {
      expectedRevision: 1,
      areaId: exterior,
      enteredAt: "2026-07-14T08:08:00.000+10:00",
    });
    state = attachInvestigationEvidence(state, {
      expectedRevision: 2,
      artifacts: [
        {
          artifactId: "photo-exterior-context",
          artifactKind: "photo",
          captureAreaId: exterior,
          capturedAt: "2026-07-14T08:08:03.000+10:00",
          captureSequence: 4,
          jobId,
        },
      ],
      attachedAt: "2026-07-14T08:08:03.500+10:00",
      inspectorId,
      source: "captured_during_investigation",
    });

    expect(state.areaVisits.map((visit) => visit.areaId)).toEqual([
      bathroom,
      exterior,
    ]);
    expect(
      orderedInvestigationEvidence(state).map((item) => item.currentAreaId),
    ).toEqual([bathroom, bathroom, bathroom, exterior]);
    expect(state.timeline.map((entry) => entry.ordinal)).toEqual(
      state.timeline.map((_, index) => index + 1),
    );
  });

  it("corrects an accidental area assignment without rewriting original capture metadata", () => {
    const attached = attachInvestigationEvidence(newInvestigation(), {
      expectedRevision: 0,
      artifacts: [recentArtifacts[0]!],
      attachedAt: "2026-07-14T08:05:01.000+10:00",
      inspectorId,
      source: "attached_recent",
    });
    const reassigned = reassignInvestigationEvidenceArea(attached, {
      expectedRevision: 1,
      artifactId: "photo-three",
      areaId: exterior,
      assignedAt: "2026-07-14T08:06:00.000+10:00",
      inspectorId,
    });

    expect(reassigned.evidence[0]).toMatchObject({
      captureAreaId: bathroom,
      currentAreaId: exterior,
    });
    expect(reassigned.evidence[0]?.areaAssignmentHistory).toEqual([
      expect.objectContaining({ areaId: bathroom, reason: "capture_context" }),
      expect.objectContaining({
        areaId: exterior,
        reason: "inspector_correction",
      }),
    ]);
  });

  it("pauses and resumes explicitly, then finishes immediately while AI work remains asynchronous", () => {
    let state = attachInvestigationEvidence(newInvestigation(), {
      expectedRevision: 0,
      artifacts: [recentArtifacts[0]!],
      attachedAt: "2026-07-14T08:05:01.000+10:00",
      inspectorId,
      source: "attached_recent",
    });
    state = pauseInvestigation(state, {
      expectedRevision: 1,
      pausedAt: "2026-07-14T08:06:00.000+10:00",
    });
    expect(() =>
      attachInvestigationEvidence(state, {
        expectedRevision: 2,
        artifacts: [recentArtifacts[1]!],
        attachedAt: "2026-07-14T08:06:01.000+10:00",
        inspectorId,
        source: "attached_recent",
      }),
    ).toThrowError(DomainConflictError);
    state = resumeInvestigation(state, {
      expectedRevision: 2,
      resumedAt: "2026-07-14T08:07:00.000+10:00",
    });
    state = finishInvestigation(state, {
      expectedRevision: 3,
      completedAt: "2026-07-14T08:08:00.000+10:00",
      inspectorId,
      draftingDisposition: "queue_ai_asynchronously",
      outcome: "finding_candidates",
      moduleLinks: [
        {
          findingCandidateId: "candidate-building",
          module: "building",
          moduleId: buildingModuleId,
          sourceArtifactIds: ["photo-three"],
        },
      ],
    });

    expect(state.status).toBe("completed_findings");
    expect(state.completion?.draftingDisposition).toBe(
      "queue_ai_asynchronously",
    );
  });

  it("links one original to separate Building and Timber Pest candidate schemas without duplication", () => {
    const attached = attachInvestigationEvidence(newInvestigation(), {
      expectedRevision: 0,
      artifacts: [recentArtifacts[0]!],
      attachedAt: "2026-07-14T08:05:01.000+10:00",
      inspectorId,
      source: "attached_recent",
    });
    const completed = finishInvestigation(attached, {
      expectedRevision: 1,
      completedAt: "2026-07-14T08:09:00.000+10:00",
      inspectorId,
      draftingDisposition: "manual_only",
      outcome: "finding_candidates",
      moduleLinks: [
        {
          findingCandidateId: "candidate-building",
          module: "building",
          moduleId: buildingModuleId,
          sourceArtifactIds: ["photo-three"],
        },
        {
          findingCandidateId: "candidate-timber-pest",
          module: "timber_pest",
          moduleId: pestModuleId,
          sourceArtifactIds: ["photo-three"],
        },
      ],
    });

    expect(completed.evidence).toHaveLength(1);
    expect(
      completed.completion?.moduleLinks.map((link) => link.module),
    ).toEqual(["building", "timber_pest"]);
    expect(completed.completion?.moduleLinks[0]?.sourceArtifactIds[0]).toBe(
      completed.completion?.moduleLinks[1]?.sourceArtifactIds[0],
    );
  });

  it("closes a checked concern as no reportable finding without AI or invented output", () => {
    let state = newInvestigation();
    state = recordInvestigationObservation(state, {
      expectedRevision: 0,
      observation: {
        areaId: bathroom,
        observationId: "observation-checked-stain",
        recordedAt: "2026-07-14T08:06:00.000+10:00",
        recordedByInspectorId: inspectorId,
        text: "Checked the apparent mark from adjacent surfaces; no reportable condition identified.",
      },
    });
    state = finishInvestigation(state, {
      expectedRevision: 1,
      completedAt: "2026-07-14T08:07:00.000+10:00",
      inspectorId,
      draftingDisposition: "manual_only",
      outcome: "no_reportable_finding",
    });

    expect(state.status).toBe("completed_no_reportable_finding");
    expect(state.completion?.moduleLinks).toEqual([]);
  });

  it("records structured measurements and rejects stale writes", () => {
    const state = recordInvestigationMeasurement(newInvestigation(), {
      expectedRevision: 0,
      measurement: {
        areaId: bathroom,
        measuredAt: "2026-07-14T08:06:00.000+10:00",
        measuredByInspectorId: inspectorId,
        measurementId: "measurement-crack-width",
        kind: "crack_width",
        value: 1.5,
        unit: "millimetres",
        note: "Widest visible point",
      },
    });

    expect(state.measurements[0]).toMatchObject({
      value: 1.5,
      unit: "millimetres",
    });
    expect(() =>
      pauseInvestigation(state, {
        expectedRevision: 0,
        pausedAt: "2026-07-14T08:07:00.000+10:00",
      }),
    ).toThrowError(DomainConflictError);
  });
});
