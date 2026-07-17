import { describe, expect, it } from "vitest";

import {
  attachInvestigationEvidence,
  recordInvestigationObservation,
  startInvestigation,
} from "@inspection/domain/inspection/mobile";

import {
  confirmFindingCandidateSourceSelection,
  createFindingCandidateLinks,
  isAttachableCaptureState,
  selectAttachableRecentCaptures,
  toggleFindingCandidateSource,
} from "./field-actions.js";

const jobId = "job-u5-field-actions";
const bathroom = "area-main-bathroom";
const buildingObservationId = "observation-building";
const timberPestObservationId = "observation-timber-pest";

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

  it("builds candidates only from the artifacts and observations selected for each module", () => {
    const withSources = investigationWithSources();
    let nextId = 0;

    const links = createFindingCandidateLinks({
      idFactory: () => `candidate-${++nextId}`,
      investigation: withSources,
      moduleSelections: [
        {
          module: "building",
          sourceArtifactIds: ["photo-1"],
          sourceObservationIds: [buildingObservationId],
        },
        {
          module: "timber_pest",
          sourceArtifactIds: ["photo-2"],
          sourceObservationIds: [timberPestObservationId],
        },
      ],
    });

    expect(links).toEqual([
      {
        findingCandidateId: "candidate-1",
        module: "building",
        moduleId: "module-building",
        sourceArtifactIds: ["photo-1"],
        sourceObservationIds: [buildingObservationId],
      },
      {
        findingCandidateId: "candidate-2",
        module: "timber_pest",
        moduleId: "module-timber-pest",
        sourceArtifactIds: ["photo-2"],
        sourceObservationIds: [timberPestObservationId],
      },
    ]);
    expect(links[0]?.sourceArtifactIds).not.toContain("photo-2");
    expect(Object.isFrozen(links[0]?.sourceArtifactIds)).toBe(true);
    expect(Object.isFrozen(links[0]?.sourceObservationIds)).toBe(true);
  });

  it("builds and freezes a revision-bound selection only from explicit source toggles", () => {
    const withSources = investigationWithSources();
    let drafts = toggleFindingCandidateSource([], {
      module: "building",
      sourceId: "photo-1",
      sourceType: "artifact",
    });
    drafts = toggleFindingCandidateSource(drafts, {
      module: "building",
      sourceId: buildingObservationId,
      sourceType: "observation",
    });

    const selection = confirmFindingCandidateSourceSelection({
      drafts,
      investigation: withSources,
      module: "building",
    });

    expect(selection).toEqual({
      investigationRevision: withSources.revision,
      module: "building",
      sourceArtifactIds: ["photo-1"],
      sourceObservationIds: [buildingObservationId],
    });
    expect(selection.sourceArtifactIds).not.toContain("photo-2");
    expect(Object.isFrozen(selection)).toBe(true);
    expect(Object.isFrozen(selection.sourceArtifactIds)).toBe(true);
    expect(Object.isFrozen(selection.sourceObservationIds)).toBe(true);
  });

  it("removes an explicitly toggled source and refuses to confirm an incomplete draft", () => {
    const withSources = investigationWithSources();
    let drafts = toggleFindingCandidateSource([], {
      module: "building",
      sourceId: "photo-1",
      sourceType: "artifact",
    });
    drafts = toggleFindingCandidateSource(drafts, {
      module: "building",
      sourceId: "photo-1",
      sourceType: "artifact",
    });

    expect(drafts[0]?.sourceArtifactIds).toEqual([]);
    expect(() =>
      confirmFindingCandidateSourceSelection({
        drafts,
        investigation: withSources,
        module: "building",
      }),
    ).toThrow("Select at least one attached source artifact");
  });

  it("rejects empty, duplicate, unattached, or uncommissioned selections before allocating IDs", () => {
    const withSources = investigationWithSources();
    let idAllocations = 0;
    const idFactory = () => `candidate-${++idAllocations}`;

    expect(() =>
      createFindingCandidateLinks({
        idFactory,
        investigation: withSources,
        moduleSelections: [],
      }),
    ).toThrow("Select at least one commissioned module");

    expect(() =>
      createFindingCandidateLinks({
        idFactory,
        investigation: withSources,
        moduleSelections: [
          {
            module: "building",
            sourceArtifactIds: ["photo-1"],
            sourceObservationIds: [buildingObservationId],
          },
          {
            module: "building",
            sourceArtifactIds: ["photo-2"],
            sourceObservationIds: [buildingObservationId],
          },
        ],
      }),
    ).toThrow("Each professional module may be selected only once");

    expect(() =>
      createFindingCandidateLinks({
        idFactory,
        investigation: withSources,
        moduleSelections: [
          {
            module: "building",
            sourceArtifactIds: [],
            sourceObservationIds: [buildingObservationId],
          },
        ],
      }),
    ).toThrow("Select at least one attached source artifact");

    expect(() =>
      createFindingCandidateLinks({
        idFactory,
        investigation: withSources,
        moduleSelections: [
          {
            module: "building",
            sourceArtifactIds: ["photo-1", "photo-1"],
            sourceObservationIds: [buildingObservationId],
          },
        ],
      }),
    ).toThrow("cannot repeat a source artifact");

    expect(() =>
      createFindingCandidateLinks({
        idFactory,
        investigation: withSources,
        moduleSelections: [
          {
            module: "building",
            sourceArtifactIds: ["photo-not-attached"],
            sourceObservationIds: [buildingObservationId],
          },
        ],
      }),
    ).toThrow("is not attached to this investigation");

    expect(() =>
      createFindingCandidateLinks({
        idFactory,
        investigation: withSources,
        moduleSelections: [
          {
            module: "building",
            sourceArtifactIds: ["photo-1"],
            sourceObservationIds: [],
          },
        ],
      }),
    ).toThrow("Select at least one inspector observation");

    expect(() =>
      createFindingCandidateLinks({
        idFactory,
        investigation: withSources,
        moduleSelections: [
          {
            module: "building",
            sourceArtifactIds: ["photo-1"],
            sourceObservationIds: [
              buildingObservationId,
              buildingObservationId,
            ],
          },
        ],
      }),
    ).toThrow("cannot repeat a source observation");

    expect(() =>
      createFindingCandidateLinks({
        idFactory,
        investigation: withSources,
        moduleSelections: [
          {
            module: "building",
            sourceArtifactIds: ["photo-1"],
            sourceObservationIds: ["observation-not-attached"],
          },
        ],
      }),
    ).toThrow("is not attached to this investigation");

    expect(() =>
      createFindingCandidateLinks({
        idFactory,
        investigation: {
          ...withSources,
          commissionedModules: [
            { module: "building", moduleId: "module-building" },
          ],
        },
        moduleSelections: [
          {
            module: "timber_pest",
            sourceArtifactIds: ["photo-2"],
            sourceObservationIds: [timberPestObservationId],
          },
        ],
      }),
    ).toThrow("Timber Pest is not commissioned");

    expect(idAllocations).toBe(0);
  });
});

function investigationWithSources() {
  let withSources = attachInvestigationEvidence(investigation(), {
    artifacts: [captures[0], captures[1]],
    attachedAt: "2026-07-17T08:00:01.000+10:00",
    expectedRevision: 0,
    inspectorId: "inspector-1",
    source: "attached_recent",
  });
  withSources = recordInvestigationObservation(withSources, {
    expectedRevision: withSources.revision,
    observation: {
      areaId: bathroom,
      observationId: buildingObservationId,
      recordedAt: "2026-07-17T08:00:02.000+10:00",
      recordedByInspectorId: "inspector-1",
      text: "Cracked bathroom tiles were observed.",
    },
  });
  return recordInvestigationObservation(withSources, {
    expectedRevision: withSources.revision,
    observation: {
      areaId: bathroom,
      observationId: timberPestObservationId,
      recordedAt: "2026-07-17T08:00:03.000+10:00",
      recordedByInspectorId: "inspector-1",
      text: "A conducive moisture condition was observed.",
    },
  });
}
