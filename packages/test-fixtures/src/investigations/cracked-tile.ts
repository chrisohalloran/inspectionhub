import {
  attachInvestigationEvidence,
  changeInvestigationArea,
  createCoverageLedger,
  createInvestigationPacket,
  finishInvestigation,
  recordAreaCoverage,
  recordInvestigationMeasurement,
  recordInvestigationObservation,
  startInvestigation,
} from "@inspection/domain";

export const crackedTileFixtureIds = {
  organizationId: "fixture-organization-building-pest",
  jobId: "fixture-job-cracked-tile",
  inspectorId: "fixture-inspector-qld-building",
  buildingModuleId: "fixture-module-building",
  timberPestModuleId: "fixture-module-timber-pest",
  investigationId: "fixture-investigation-cracked-tile",
  bathroomAreaId: "fixture-area-second-floor-main-bathroom",
  exteriorAreaId: "fixture-area-external-east-wall",
  roofVoidAreaId: "fixture-area-roof-void",
  bathroomOverviewId: "fixture-photo-bathroom-overview",
  showerCloseupId: "fixture-photo-shower-crack-closeup",
  floorContextId: "fixture-photo-floor-crack-context",
  exteriorContextId: "fixture-photo-exterior-context",
} as const;

const at = {
  firstPhoto: "2026-07-14T08:04:01.000+10:00",
  secondPhoto: "2026-07-14T08:04:02.000+10:00",
  thirdPhoto: "2026-07-14T08:04:03.000+10:00",
  started: "2026-07-14T08:05:00.000+10:00",
  observed: "2026-07-14T08:06:00.000+10:00",
  measured: "2026-07-14T08:06:30.000+10:00",
  exterior: "2026-07-14T08:08:00.000+10:00",
  exteriorPhoto: "2026-07-14T08:08:03.000+10:00",
  completed: "2026-07-14T08:10:00.000+10:00",
} as const;

export const crackedTileFixtureOracle = {
  observedFacts: [
    "Several tiles are cracked in the shower base and main bathroom floor area.",
    "The bathroom is on the second floor.",
  ],
  apparentExtent:
    "Cracking was visible across several tiles in the shower base and adjoining bathroom floor area at the inspection time.",
  constructionAssumptions: [
    "A timber-joist floor with tile underlay is considered likely but was not visually confirmed.",
  ],
  qualifiedHypotheses: [
    "Movement in the floor or supporting substrate may have contributed to the cracking.",
  ],
  potentialConsequences: [
    "Movement may have affected the concealed waterproofing membrane; its condition was not visually verifiable.",
  ],
  inspectorClassification: {
    module: "building",
    classification: "major_defect",
    attribution: "inspector",
  },
  furtherInvestigation:
    "Recommend the owner engage a suitably licensed and qualified builder or tiler to investigate.",
  prohibitedAdvice: [
    "purchase recommendation",
    "settlement recommendation",
    "negotiation advice",
    "repair-cost estimate",
  ],
} as const;

export function buildCrackedTileInvestigationFixture() {
  const ids = crackedTileFixtureIds;
  let investigation = startInvestigation({
    investigationId: ids.investigationId,
    organizationId: ids.organizationId,
    jobId: ids.jobId,
    commissionedModules: [
      { module: "building", moduleId: ids.buildingModuleId },
      { module: "timber_pest", moduleId: ids.timberPestModuleId },
    ],
    areaId: ids.bathroomAreaId,
    startedAt: at.started,
    inspectorId: ids.inspectorId,
  });
  investigation = attachInvestigationEvidence(investigation, {
    expectedRevision: investigation.revision,
    artifacts: [
      {
        artifactId: ids.floorContextId,
        artifactKind: "photo",
        captureAreaId: ids.bathroomAreaId,
        capturedAt: at.thirdPhoto,
        captureSequence: 103,
        jobId: ids.jobId,
      },
      {
        artifactId: ids.bathroomOverviewId,
        artifactKind: "photo",
        captureAreaId: ids.bathroomAreaId,
        capturedAt: at.firstPhoto,
        captureSequence: 101,
        jobId: ids.jobId,
      },
      {
        artifactId: ids.showerCloseupId,
        artifactKind: "photo",
        captureAreaId: ids.bathroomAreaId,
        capturedAt: at.secondPhoto,
        captureSequence: 102,
        jobId: ids.jobId,
      },
    ],
    attachedAt: "2026-07-14T08:05:01.000+10:00",
    inspectorId: ids.inspectorId,
    source: "attached_recent",
  });
  investigation = recordInvestigationObservation(investigation, {
    expectedRevision: investigation.revision,
    observation: {
      areaId: ids.bathroomAreaId,
      observationId: "fixture-observation-cracked-tiles",
      recordedAt: at.observed,
      recordedByInspectorId: ids.inspectorId,
      text: crackedTileFixtureOracle.observedFacts.join(" "),
    },
  });
  investigation = recordInvestigationMeasurement(investigation, {
    expectedRevision: investigation.revision,
    measurement: {
      areaId: ids.bathroomAreaId,
      measuredAt: at.measured,
      measuredByInspectorId: ids.inspectorId,
      measurementId: "fixture-measurement-largest-visible-crack",
      kind: "crack_width",
      value: 1.5,
      unit: "millimetres",
      note: "Approximate width at the widest visible point.",
    },
  });
  investigation = changeInvestigationArea(investigation, {
    expectedRevision: investigation.revision,
    areaId: ids.exteriorAreaId,
    enteredAt: at.exterior,
  });
  investigation = attachInvestigationEvidence(investigation, {
    expectedRevision: investigation.revision,
    artifacts: [
      {
        artifactId: ids.exteriorContextId,
        artifactKind: "photo",
        captureAreaId: ids.exteriorAreaId,
        capturedAt: at.exteriorPhoto,
        captureSequence: 104,
        jobId: ids.jobId,
      },
    ],
    attachedAt: "2026-07-14T08:08:03.500+10:00",
    inspectorId: ids.inspectorId,
    source: "captured_during_investigation",
  });
  investigation = recordInvestigationObservation(investigation, {
    expectedRevision: investigation.revision,
    observation: {
      areaId: ids.exteriorAreaId,
      observationId: "fixture-observation-exterior-check",
      recordedAt: "2026-07-14T08:08:30.000+10:00",
      recordedByInspectorId: ids.inspectorId,
      text: "No corresponding surface cracking was visible on the accessible external wall area checked at the inspection time.",
    },
  });
  investigation = finishInvestigation(investigation, {
    expectedRevision: investigation.revision,
    completedAt: at.completed,
    inspectorId: ids.inspectorId,
    draftingDisposition: "queue_ai_asynchronously",
    outcome: "finding_candidates",
    moduleLinks: [
      {
        findingCandidateId: "fixture-candidate-cracked-tiles-building",
        module: "building",
        moduleId: ids.buildingModuleId,
        sourceArtifactIds: [
          ids.bathroomOverviewId,
          ids.showerCloseupId,
          ids.floorContextId,
          ids.exteriorContextId,
        ],
        sourceObservationIds: [
          "fixture-observation-cracked-tiles",
          "fixture-observation-exterior-check",
        ],
      },
    ],
  });

  let coverage = createCoverageLedger({
    organizationId: ids.organizationId,
    jobId: ids.jobId,
    commissionedModules: [
      { module: "building", moduleId: ids.buildingModuleId },
      { module: "timber_pest", moduleId: ids.timberPestModuleId },
    ],
    areas: [
      {
        areaId: ids.bathroomAreaId,
        label: "Second floor / Main bathroom",
        applicableModules: ["building", "timber_pest"],
      },
      {
        areaId: ids.exteriorAreaId,
        label: "External east wall",
        applicableModules: ["building", "timber_pest"],
      },
      {
        areaId: ids.roofVoidAreaId,
        label: "Roof void",
        applicableModules: ["building", "timber_pest"],
      },
    ],
  });
  for (const [areaId, module] of [
    [ids.bathroomAreaId, "building"],
    [ids.bathroomAreaId, "timber_pest"],
    [ids.exteriorAreaId, "building"],
    [ids.exteriorAreaId, "timber_pest"],
  ] as const) {
    coverage = recordAreaCoverage(coverage, {
      expectedRevision: coverage.revision,
      coverageEntryId: `fixture-coverage-${areaId}-${module}`,
      areaId,
      module,
      state: "inspected",
      recordedAt: at.completed,
      inspectorId: ids.inspectorId,
    });
  }
  for (const module of ["building", "timber_pest"] as const) {
    coverage = recordAreaCoverage(coverage, {
      expectedRevision: coverage.revision,
      coverageEntryId: `fixture-coverage-roof-${module}`,
      areaId: ids.roofVoidAreaId,
      module,
      state: "inaccessible",
      detail:
        module === "building"
          ? "The roof void was not safely accessible for visual Building inspection at the inspection time."
          : "The roof void timbers were not safely accessible for visual Timber Pest inspection at the inspection time.",
      limitationId: `fixture-limitation-roof-${module}`,
      material: true,
      recordedAt: at.completed,
      inspectorId: ids.inspectorId,
    });
  }

  const packet = createInvestigationPacket({
    packetId: "fixture-packet-cracked-tile-v1",
    packetRevision: 1,
    investigation,
    coverageLedger: coverage,
    selectedArtifactIds: [
      ids.bathroomOverviewId,
      ids.showerCloseupId,
      ids.floorContextId,
      ids.exteriorContextId,
    ],
    moduleSchemas: [
      {
        module: "building",
        moduleId: ids.buildingModuleId,
        schemaVersion: "building-finding-v1",
      },
      {
        module: "timber_pest",
        moduleId: ids.timberPestModuleId,
        schemaVersion: "timber-pest-finding-v1",
      },
    ],
    versionPins: {
      model: "synthetic-drafting-model-v1",
      promptVersion: "inspection-draft-v1",
      skillVersions: [
        "building-inspection-v1",
        "report-language-v1",
        "timber-pest-inspection-v1",
      ],
    },
    unknowns: [
      "The supporting floor construction was not visually confirmed.",
      "The concealed waterproofing membrane condition was not visually verifiable.",
    ],
    createdAt: "2026-07-14T08:10:01.000+10:00",
  });

  return { coverage, investigation, packet, oracle: crackedTileFixtureOracle };
}
