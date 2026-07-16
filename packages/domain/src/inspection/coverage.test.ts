import { describe, expect, it } from "vitest";

import { DomainConflictError } from "../errors.js";
import {
  coverageCompletionIssues,
  createCoverageLedger,
  currentCoverageEntries,
  recordAreaCoverage,
} from "./coverage.js";

const inspectorId = "inspector-qld-building";
const buildingModuleId = "module-building";
const pestModuleId = "module-timber-pest";
const areas = [
  {
    areaId: "area-main-bathroom",
    label: "Second floor / Main bathroom",
    applicableModules: ["building", "timber_pest"] as const,
  },
  {
    areaId: "area-roof-void",
    label: "Roof void",
    applicableModules: ["building", "timber_pest"] as const,
  },
];

function ledger() {
  return createCoverageLedger({
    organizationId: "organization-demo",
    jobId: "job-cracked-tile",
    commissionedModules: [
      { module: "building", moduleId: buildingModuleId },
      { module: "timber_pest", moduleId: pestModuleId },
    ],
    areas,
  });
}

describe("inspector-set coverage ledger", () => {
  it("requires a literal state for every applicable area and module without inferring photo percentages", () => {
    const initial = ledger();

    expect(coverageCompletionIssues(initial)).toHaveLength(4);
    expect(JSON.stringify(initial)).not.toMatch(/percent|%/iu);
  });

  it("closes an inaccessible roof void with separate material module limitations", () => {
    let state = ledger();
    state = recordAreaCoverage(state, {
      expectedRevision: 0,
      coverageEntryId: "coverage-building-roof",
      areaId: "area-roof-void",
      module: "building",
      state: "inaccessible",
      detail:
        "Roof void access hatch could not be safely opened at the inspection time.",
      limitationId: "limitation-building-roof",
      material: true,
      recordedAt: "2026-07-14T09:00:00.000+10:00",
      inspectorId,
    });
    state = recordAreaCoverage(state, {
      expectedRevision: 1,
      coverageEntryId: "coverage-pest-roof",
      areaId: "area-roof-void",
      module: "timber_pest",
      state: "inaccessible",
      detail:
        "Roof void timbers were not visually accessible at the inspection time.",
      limitationId: "limitation-pest-roof",
      material: true,
      recordedAt: "2026-07-14T09:00:10.000+10:00",
      inspectorId,
    });

    expect(
      state.limitations.filter((item) => item.status === "active"),
    ).toEqual([
      expect.objectContaining({ module: "building", material: true }),
      expect.objectContaining({ module: "timber_pest", material: true }),
    ]);
    expect(
      currentCoverageEntries(state).filter(
        (entry) => entry.areaId === "area-roof-void",
      ),
    ).toHaveLength(2);
  });

  it("creates a visible revisit item and resolves it only when the inspector records a later judgement", () => {
    let state = ledger();
    state = recordAreaCoverage(state, {
      expectedRevision: 0,
      coverageEntryId: "coverage-bathroom-revisit",
      areaId: "area-main-bathroom",
      module: "building",
      state: "revisit",
      detail: "Return after checking the corresponding external wall.",
      revisitItemId: "revisit-bathroom-building",
      recordedAt: "2026-07-14T08:30:00.000+10:00",
      inspectorId,
    });
    expect(coverageCompletionIssues(state)).toContainEqual({
      areaId: "area-main-bathroom",
      module: "building",
      moduleId: buildingModuleId,
      reason: "revisit_open",
    });

    state = recordAreaCoverage(state, {
      expectedRevision: 1,
      coverageEntryId: "coverage-bathroom-inspected",
      areaId: "area-main-bathroom",
      module: "building",
      state: "inspected",
      recordedAt: "2026-07-14T08:40:00.000+10:00",
      inspectorId,
    });

    expect(state.revisitItems[0]).toMatchObject({
      status: "resolved",
      resolvedAt: "2026-07-14T08:40:00.000+10:00",
    });
    expect(coverageCompletionIssues(state)).not.toContainEqual(
      expect.objectContaining({ reason: "revisit_open" }),
    );
  });

  it("preserves coverage history while the latest judgement supersedes the active limitation", () => {
    let state = ledger();
    state = recordAreaCoverage(state, {
      expectedRevision: 0,
      coverageEntryId: "coverage-limited",
      areaId: "area-main-bathroom",
      module: "building",
      state: "access_limited",
      detail: "Stored goods obscured part of the floor.",
      limitationId: "limitation-bathroom",
      recordedAt: "2026-07-14T08:30:00.000+10:00",
      inspectorId,
    });
    state = recordAreaCoverage(state, {
      expectedRevision: 1,
      coverageEntryId: "coverage-inspected",
      areaId: "area-main-bathroom",
      module: "building",
      state: "inspected",
      recordedAt: "2026-07-14T08:35:00.000+10:00",
      inspectorId,
    });

    expect(state.entries).toHaveLength(2);
    expect(currentCoverageEntries(state)).toEqual([
      expect.objectContaining({ state: "inspected", revision: 2 }),
    ]);
    expect(state.limitations[0]).toMatchObject({ status: "superseded" });
  });

  it("fails closed when limitation detail, revisit identity, or expected revision is missing", () => {
    expect(() =>
      recordAreaCoverage(ledger(), {
        expectedRevision: 0,
        coverageEntryId: "coverage-invalid",
        areaId: "area-roof-void",
        module: "building",
        state: "inaccessible",
        recordedAt: "2026-07-14T09:00:00.000+10:00",
        inspectorId,
      }),
    ).toThrowError(DomainConflictError);
    expect(() =>
      recordAreaCoverage(ledger(), {
        expectedRevision: 4,
        coverageEntryId: "coverage-stale",
        areaId: "area-main-bathroom",
        module: "building",
        state: "inspected",
        recordedAt: "2026-07-14T09:00:00.000+10:00",
        inspectorId,
      }),
    ).toThrowError(DomainConflictError);
  });
});
