import { describe, expect, it } from "vitest";

import { DomainConflictError } from "../errors.js";
import { createCoverageLedger, recordAreaCoverage } from "./coverage.js";
import {
  attachInvestigationEvidence,
  finishInvestigation,
  startInvestigation,
} from "./investigation.js";
import { createInvestigationPacket } from "./packet.js";

describe("bounded investigation packet seed", () => {
  it("freezes only inspector-selected attached evidence and records exact source revisions", () => {
    const started = startInvestigation({
      investigationId: "investigation-1",
      organizationId: "organization-1",
      jobId: "job-1",
      commissionedModules: [
        { module: "building", moduleId: "module-building" },
      ],
      areaId: "bathroom",
      startedAt: "2026-07-14T08:00:00.000+10:00",
      inspectorId: "inspector-1",
    });
    const attached = attachInvestigationEvidence(started, {
      expectedRevision: 0,
      artifacts: [
        {
          artifactId: "photo-1",
          artifactKind: "photo",
          captureAreaId: "bathroom",
          capturedAt: "2026-07-14T07:59:00.000+10:00",
          captureSequence: 1,
          jobId: "job-1",
        },
        {
          artifactId: "photo-private-coverage",
          artifactKind: "photo",
          captureAreaId: "bathroom",
          capturedAt: "2026-07-14T07:59:30.000+10:00",
          captureSequence: 2,
          jobId: "job-1",
        },
        {
          artifactId: "voice-1",
          artifactKind: "voice_note",
          captureAreaId: "bathroom",
          capturedAt: "2026-07-14T07:59:45.000+10:00",
          captureSequence: 3,
          jobId: "job-1",
        },
      ],
      attachedAt: "2026-07-14T08:00:01.000+10:00",
      inspectorId: "inspector-1",
      source: "attached_recent",
    });
    const completed = finishInvestigation(attached, {
      expectedRevision: 1,
      completedAt: "2026-07-14T08:01:00.000+10:00",
      inspectorId: "inspector-1",
      draftingDisposition: "queue_ai_asynchronously",
      outcome: "finding_candidates",
      moduleLinks: [
        {
          findingCandidateId: "candidate-1",
          module: "building",
          moduleId: "module-building",
          sourceArtifactIds: ["photo-1"],
        },
      ],
    });
    let coverage = createCoverageLedger({
      organizationId: "organization-1",
      jobId: "job-1",
      commissionedModules: [
        { module: "building", moduleId: "module-building" },
      ],
      areas: [
        {
          areaId: "bathroom",
          label: "Bathroom",
          applicableModules: ["building"],
        },
      ],
    });
    coverage = recordAreaCoverage(coverage, {
      expectedRevision: 0,
      coverageEntryId: "coverage-1",
      areaId: "bathroom",
      module: "building",
      state: "inspected",
      recordedAt: "2026-07-14T08:01:00.000+10:00",
      inspectorId: "inspector-1",
    });

    const packet = createInvestigationPacket({
      packetId: "packet-1",
      packetRevision: 1,
      investigation: completed,
      coverageLedger: coverage,
      selectedArtifactIds: ["photo-1", "voice-1"],
      transcriptSpans: [
        {
          correctedText:
            "Several tiles are cracked; the floor construction was not visually confirmed.",
          correctionOrigin: "inspector",
          endMilliseconds: 5200,
          spanId: "span-1",
          startMilliseconds: 1000,
          voiceArtifactId: "voice-1",
        },
      ],
      contradictions: [
        {
          contradictionId: "contradiction-1",
          description:
            "The apparent surface movement has not been confirmed from concealed construction.",
          resolution: null,
          sourceArtifactIds: ["photo-1"],
          status: "unresolved",
        },
      ],
      priorInspectorFeedback: [
        {
          feedbackId: "feedback-1",
          modules: ["building"],
          text: "Keep the construction statement qualified unless the substrate is visible.",
        },
      ],
      moduleSchemas: [
        {
          module: "building",
          moduleId: "module-building",
          schemaVersion: "building-finding-v1",
        },
      ],
      versionPins: {
        model: "synthetic-model-v1",
        promptVersion: "inspection-draft-v1",
        skillVersions: ["building-inspection-v1"],
      },
      unknowns: ["Subfloor construction was not visually confirmed."],
      createdAt: "2026-07-14T08:02:00.000+10:00",
    });

    expect(packet.evidence.map((item) => item.artifactId)).toEqual([
      "photo-1",
      "voice-1",
    ]);
    expect(JSON.stringify(packet)).not.toContain("photo-private-coverage");
    expect(packet.investigationRevision).toBe(2);
    expect(packet.transcriptSpans[0]).toMatchObject({
      correctionOrigin: "inspector",
      voiceArtifactId: "voice-1",
    });
    expect(packet.contradictions[0]).toMatchObject({ status: "unresolved" });
    expect(packet.priorInspectorFeedback[0]?.modules).toEqual(["building"]);
    expect(packet.canonicalHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(packet)).toBe(true);
  });

  it("rejects unselected foreign or unattached artifacts", () => {
    const state = finishInvestigation(
      startInvestigation({
        investigationId: "investigation-empty",
        organizationId: "organization-1",
        jobId: "job-1",
        commissionedModules: [
          { module: "building", moduleId: "module-building" },
        ],
        areaId: "bathroom",
        startedAt: "2026-07-14T08:00:00.000+10:00",
        inspectorId: "inspector-1",
      }),
      {
        expectedRevision: 0,
        completedAt: "2026-07-14T08:01:00.000+10:00",
        inspectorId: "inspector-1",
        draftingDisposition: "manual_only",
        outcome: "no_reportable_finding",
      },
    );
    const coverage = createCoverageLedger({
      organizationId: "organization-1",
      jobId: "job-1",
      commissionedModules: [
        { module: "building", moduleId: "module-building" },
      ],
      areas: [
        {
          applicableModules: ["building"],
          areaId: "bathroom",
          label: "Bathroom",
        },
      ],
    });

    expect(() =>
      createInvestigationPacket({
        packetId: "packet-invalid",
        packetRevision: 1,
        investigation: state,
        coverageLedger: coverage,
        selectedArtifactIds: ["not-attached"],
        moduleSchemas: [
          {
            module: "building",
            moduleId: "module-building",
            schemaVersion: "building-finding-v1",
          },
        ],
        versionPins: {
          model: "manual-path",
          promptVersion: "inspection-draft-v1",
          skillVersions: [],
        },
        unknowns: [],
        createdAt: "2026-07-14T08:02:00.000+10:00",
      }),
    ).toThrowError(DomainConflictError);
  });
});
