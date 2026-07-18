import { describe, expect, it } from "vitest";

import { projectCompletion } from "./completion-state.js";

const building = {
  module: "building" as const,
  label: "Building" as const,
  reviewComplete: true,
  approvalState: "approved" as const,
  snapshotRevision: 2,
  approvalSnapshotRevision: 2,
  coverageIssues: 0,
  unresolvedChecks: 0,
};
const pest = {
  module: "timber_pest" as const,
  label: "Timber Pest" as const,
  reviewComplete: true,
  approvalState: "approved" as const,
  snapshotRevision: 1,
  approvalSnapshotRevision: 1,
  coverageIssues: 0,
  unresolvedChecks: 0,
};

describe("mobile completion projection", () => {
  it("allows package confirmation only after independent exact approvals", () => {
    const projection = projectCompletion({
      commissionedModules: ["building", "timber_pest"],
      modules: [building, pest],
      aiAvailable: true,
      professionalWorkOpen: false,
    });
    expect(projection.canConfirmPackage).toBe(true);
    expect(projection.primaryStatus).toContain("independently approved");
  });

  it("keeps Building approval while Timber Pest is incomplete", () => {
    const projection = projectCompletion({
      commissionedModules: ["building", "timber_pest"],
      modules: [
        building,
        { ...pest, reviewComplete: false, approvalState: "not_ready" },
      ],
      aiAvailable: true,
      professionalWorkOpen: false,
    });
    expect(projection.canConfirmPackage).toBe(false);
    expect(projection.modules[0]?.approvalState).toBe("approved");
    expect(projection.blockers).toContain("Timber Pest: review incomplete");
  });

  it("blocks a stale exact-revision approval", () => {
    const projection = projectCompletion({
      commissionedModules: ["building", "timber_pest"],
      modules: [
        { ...building, snapshotRevision: 3, approvalSnapshotRevision: 2 },
        pest,
      ],
      aiAvailable: true,
      professionalWorkOpen: false,
    });
    expect(projection.canConfirmPackage).toBe(false);
    expect(projection.blockers).toContain("Building: approval is stale");
  });

  it("blocks professional approval and packaging while area coverage remains incomplete", () => {
    const projection = projectCompletion({
      commissionedModules: ["building", "timber_pest"],
      modules: [
        { ...building, approvalState: "ready", coverageIssues: 2 },
        pest,
      ],
      aiAvailable: true,
      professionalWorkOpen: false,
    });
    expect(projection.canConfirmPackage).toBe(false);
    expect(projection.blockers).toContain(
      "Building: 2 coverage item(s) incomplete",
    );
  });

  it("keeps manual completion available through total AI outage", () => {
    const projection = projectCompletion({
      commissionedModules: ["building", "timber_pest"],
      modules: [building, pest],
      aiAvailable: false,
      professionalWorkOpen: false,
    });
    expect(projection.manualMode).toBe(true);
    expect(projection.canConfirmPackage).toBe(true);
  });

  it("blocks packaging while an investigation remains active or paused", () => {
    const projection = projectCompletion({
      commissionedModules: ["building", "timber_pest"],
      modules: [building, pest],
      aiAvailable: true,
      professionalWorkOpen: true,
    });

    expect(projection.canConfirmPackage).toBe(false);
    expect(projection.blockers).toContain(
      "Inspection: finish the open investigation",
    );
  });
});
