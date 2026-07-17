import { describe, expect, it } from "vitest";

import { createCoverageLedger, recordAreaCoverage } from "./coverage.js";
import {
  attachInvestigationEvidence,
  finishInvestigation,
  pauseInvestigation,
  recordInvestigationObservation,
  resumeInvestigation,
  startInvestigation,
} from "./investigation.js";
import {
  parseCoverageLedgerSnapshot,
  parseInvestigationSnapshot,
} from "./snapshot-validation.js";

describe("professional snapshot validation", () => {
  it("round-trips domain-created coverage and investigation aggregates", () => {
    const coverage = recordAreaCoverage(createCoverage(), {
      areaId: "area-bathroom",
      coverageEntryId: "coverage-building-1",
      expectedRevision: 0,
      inspectorId: "inspector-1",
      module: "building",
      recordedAt: "2026-07-17T09:00:00.000+10:00",
      state: "inspected",
    });
    const investigation = startInvestigation({
      areaId: "area-bathroom",
      commissionedModules: [
        { module: "building", moduleId: "module-building" },
      ],
      inspectorId: "inspector-1",
      investigationId: "investigation-1",
      jobId: "job-1",
      organizationId: "organization-1",
      startedAt: "2026-07-17T09:00:00.000+10:00",
    });

    expect(parseCoverageLedgerSnapshot(structuredClone(coverage))).toEqual(
      coverage,
    );
    expect(parseInvestigationSnapshot(structuredClone(investigation))).toEqual(
      investigation,
    );
  });

  it("rejects checksummed-shape bypasses and impossible nested state", () => {
    const coverage = createCoverage();
    expect(() =>
      parseCoverageLedgerSnapshot({
        ...coverage,
        commissionedModules: [],
      }),
    ).toThrow("Stored coverage snapshot is invalid");
    expect(() =>
      parseCoverageLedgerSnapshot({
        ...coverage,
        areas: [],
      }),
    ).toThrow("Stored coverage snapshot is invalid");

    const investigation = startInvestigation({
      areaId: "area-bathroom",
      commissionedModules: [
        { module: "building", moduleId: "module-building" },
      ],
      inspectorId: "inspector-1",
      investigationId: "investigation-1",
      jobId: "job-1",
      organizationId: "organization-1",
      startedAt: "2026-07-17T09:00:00.000+10:00",
    });
    const { currentAreaId: _removed, ...withoutCurrentArea } = investigation;
    void _removed;
    expect(() => parseInvestigationSnapshot(withoutCurrentArea)).toThrow(
      "Stored investigation snapshot is invalid",
    );
    expect(() =>
      parseInvestigationSnapshot({
        ...investigation,
        commissionedModules: [],
      }),
    ).toThrow("Stored investigation snapshot is invalid");
  });

  it("restores a finding candidate sourced only by an inspector observation", () => {
    const started = startInvestigation({
      areaId: "area-bathroom",
      commissionedModules: [
        { module: "building", moduleId: "module-building" },
      ],
      inspectorId: "inspector-1",
      investigationId: "investigation-observation",
      jobId: "job-1",
      organizationId: "organization-1",
      startedAt: "2026-07-17T09:00:00.000+10:00",
    });
    const observed = recordInvestigationObservation(started, {
      expectedRevision: 0,
      observation: {
        areaId: "area-bathroom",
        observationId: "observation-1",
        recordedAt: "2026-07-17T09:01:00.000+10:00",
        recordedByInspectorId: "inspector-1",
        text: "Cracked shower-base tiles were observed.",
      },
    });
    const completed = finishInvestigation(observed, {
      completedAt: "2026-07-17T09:02:00.000+10:00",
      draftingDisposition: "queue_ai_asynchronously",
      expectedRevision: 1,
      inspectorId: "inspector-1",
      moduleLinks: [
        {
          findingCandidateId: "candidate-building-1",
          module: "building",
          moduleId: "module-building",
          sourceArtifactIds: [],
        },
      ],
      outcome: "finding_candidates",
    });

    expect(parseInvestigationSnapshot(structuredClone(completed))).toEqual(
      completed,
    );
    expect(() =>
      parseInvestigationSnapshot({ ...completed, revision: 1 }),
    ).toThrow("revision history is invalid");
  });

  it("rejects revisions below evidence, observation and pause-resume history", () => {
    const started = startInvestigation({
      areaId: "area-bathroom",
      commissionedModules: [
        { module: "building", moduleId: "module-building" },
      ],
      inspectorId: "inspector-1",
      investigationId: "investigation-revision",
      jobId: "job-1",
      organizationId: "organization-1",
      startedAt: "2026-07-17T09:00:00.000+10:00",
    });
    const attached = attachInvestigationEvidence(started, {
      artifacts: [
        {
          artifactId: "artifact-1",
          artifactKind: "photo",
          captureAreaId: "area-bathroom",
          capturedAt: "2026-07-17T09:00:30.000+10:00",
          captureSequence: 1,
          jobId: "job-1",
        },
      ],
      attachedAt: "2026-07-17T09:01:00.000+10:00",
      expectedRevision: 0,
      inspectorId: "inspector-1",
      source: "attached_recent",
    });
    const paused = pauseInvestigation(started, {
      expectedRevision: 0,
      pausedAt: "2026-07-17T09:01:00.000+10:00",
    });
    const resumed = resumeInvestigation(paused, {
      expectedRevision: 1,
      resumedAt: "2026-07-17T09:02:00.000+10:00",
    });

    expect(() =>
      parseInvestigationSnapshot({ ...attached, revision: 0 }),
    ).toThrow("revision history is invalid");
    expect(() =>
      parseInvestigationSnapshot({ ...paused, revision: 0 }),
    ).toThrow("revision history is invalid");
    expect(() =>
      parseInvestigationSnapshot({ ...resumed, revision: 1 }),
    ).toThrow("revision history is invalid");
  });
});

function createCoverage() {
  return createCoverageLedger({
    areas: [
      {
        applicableModules: ["building"],
        areaId: "area-bathroom",
        label: "Bathroom",
      },
    ],
    commissionedModules: [{ module: "building", moduleId: "module-building" }],
    jobId: "job-1",
    organizationId: "organization-1",
  });
}
