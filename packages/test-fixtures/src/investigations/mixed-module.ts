import {
  attachInvestigationEvidence,
  finishInvestigation,
  recordInvestigationObservation,
  startInvestigation,
} from "@inspection/domain";

export const mixedModuleFixtureOracle = {
  sharedOriginalId: "fixture-photo-timber-member",
  sharedObservationId: "fixture-observation-timber-member",
  building: {
    schema: "building",
    question:
      "Condition and structural significance of the visible timber damage",
  },
  timberPest: {
    schema: "timber_pest",
    question: "Visible timber-pest evidence, damage, and conducive conditions",
  },
} as const;

export function buildMixedModuleInvestigationFixture() {
  let investigation = startInvestigation({
    investigationId: "fixture-investigation-mixed-module",
    organizationId: "fixture-organization-building-pest",
    jobId: "fixture-job-mixed-module",
    commissionedModules: [
      { module: "building", moduleId: "fixture-module-mixed-building" },
      {
        module: "timber_pest",
        moduleId: "fixture-module-mixed-timber-pest",
      },
    ],
    areaId: "fixture-area-subfloor",
    startedAt: "2026-07-14T10:00:00.000+10:00",
    inspectorId: "fixture-inspector-building-pest",
  });
  investigation = attachInvestigationEvidence(investigation, {
    expectedRevision: investigation.revision,
    artifacts: [
      {
        artifactId: mixedModuleFixtureOracle.sharedOriginalId,
        artifactKind: "photo",
        captureAreaId: "fixture-area-subfloor",
        capturedAt: "2026-07-14T10:00:01.000+10:00",
        captureSequence: 201,
        jobId: "fixture-job-mixed-module",
      },
    ],
    attachedAt: "2026-07-14T10:00:01.500+10:00",
    inspectorId: "fixture-inspector-building-pest",
    source: "captured_during_investigation",
  });
  investigation = recordInvestigationObservation(investigation, {
    expectedRevision: investigation.revision,
    observation: {
      areaId: "fixture-area-subfloor",
      observationId: mixedModuleFixtureOracle.sharedObservationId,
      recordedAt: "2026-07-14T10:00:30.000+10:00",
      recordedByInspectorId: "fixture-inspector-building-pest",
      text: "Visible timber damage was observed on the accessible member.",
    },
  });
  investigation = finishInvestigation(investigation, {
    expectedRevision: investigation.revision,
    completedAt: "2026-07-14T10:03:00.000+10:00",
    inspectorId: "fixture-inspector-building-pest",
    draftingDisposition: "manual_only",
    outcome: "finding_candidates",
    moduleLinks: [
      {
        findingCandidateId: "fixture-candidate-building-timber-damage",
        module: "building",
        moduleId: "fixture-module-mixed-building",
        sourceArtifactIds: [mixedModuleFixtureOracle.sharedOriginalId],
        sourceObservationIds: [mixedModuleFixtureOracle.sharedObservationId],
      },
      {
        findingCandidateId: "fixture-candidate-pest-visible-evidence",
        module: "timber_pest",
        moduleId: "fixture-module-mixed-timber-pest",
        sourceArtifactIds: [mixedModuleFixtureOracle.sharedOriginalId],
        sourceObservationIds: [mixedModuleFixtureOracle.sharedObservationId],
      },
    ],
  });
  return { investigation, oracle: mixedModuleFixtureOracle };
}
