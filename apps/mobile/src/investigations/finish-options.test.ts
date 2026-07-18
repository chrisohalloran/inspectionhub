import { describe, expect, it } from "vitest";

import {
  createFindingCandidateChoice,
  createNoReportableFindingChoice,
  deriveInvestigationFinishActionView,
  investigationFinishOptions,
} from "./finish-options.js";

describe("finish investigation choices", () => {
  it("finishes no-reportable-finding without inventing module output or waiting for AI", () => {
    expect(createNoReportableFindingChoice()).toEqual({
      outcome: "no_reportable_finding",
      draftingDisposition: "manual_only",
      moduleLinks: [],
    });
  });

  it("queues optional AI asynchronously while the field finish remains immediate", () => {
    expect(
      createFindingCandidateChoice({
        useAiWhenAvailable: true,
        moduleLinks: [
          {
            findingCandidateId: "candidate-building",
            module: "building",
            moduleId: "module-building",
            sourceArtifactIds: ["photo-1"],
            sourceObservationIds: ["observation-1"],
          },
        ],
      }),
    ).toMatchObject({ draftingDisposition: "queue_ai_asynchronously" });
    expect(investigationFinishOptions.finishNow.hint).toContain(
      "never blocks field capture",
    );
    expect(
      Object.values(investigationFinishOptions).every(
        (option) => option.minimumTargetSize >= 48,
      ),
    ).toBe(true);
  });

  it("disables every completion action while voice capture can still attach evidence", () => {
    for (const voiceState of ["starting", "recording", "saving"] as const) {
      expect(
        deriveInvestigationFinishActionView({ busy: false, voiceState }),
      ).toMatchObject({
        finishDisabled: true,
        noReportableFindingDisabled: true,
        saveFindingCandidateDisabled: true,
      });
    }

    expect(
      deriveInvestigationFinishActionView({
        busy: false,
        voiceState: "idle",
      }),
    ).toMatchObject({
      blockedReason: null,
      finishDisabled: false,
      noReportableFindingDisabled: false,
      saveFindingCandidateDisabled: false,
    });
  });
});
