import { describe, expect, it } from "vitest";

import {
  createCoverageLedger,
  recordAreaCoverage,
} from "@inspection/domain/inspection/mobile";

import { areaCoverageSummary, coverageOptions } from "./coverage-options.js";

describe("area coverage field interaction", () => {
  it("offers every inspector-set state as a labelled 48-pixel target", () => {
    expect(coverageOptions.map((option) => option.state)).toEqual([
      "inspected",
      "access_limited",
      "inaccessible",
      "not_applicable",
      "revisit",
    ]);
    expect(
      coverageOptions.every((option) => option.minimumTargetSize >= 48),
    ).toBe(true);
    expect(
      coverageOptions.every(
        (option) => option.label.length > 0 && option.hint.length > 0,
      ),
    ).toBe(true);
  });

  it("presents literal judgements and limitations without photo-derived percentages", () => {
    let ledger = createCoverageLedger({
      organizationId: "organization-1",
      jobId: "job-1",
      commissionedModules: [
        { module: "building", moduleId: "module-building" },
      ],
      areas: [
        {
          areaId: "roof-void",
          label: "Roof void",
          applicableModules: ["building"],
        },
      ],
    });
    ledger = recordAreaCoverage(ledger, {
      expectedRevision: 0,
      coverageEntryId: "coverage-roof",
      areaId: "roof-void",
      module: "building",
      state: "inaccessible",
      detail: "Access hatch could not be safely opened at the inspection time.",
      limitationId: "limitation-roof",
      recordedAt: "2026-07-14T09:00:00.000+10:00",
      inspectorId: "inspector-1",
    });

    const summary = areaCoverageSummary(ledger, "roof-void");
    expect(summary).toEqual([
      "Building: Inaccessible. Access hatch could not be safely opened at the inspection time.",
    ]);
    expect(summary.join(" ")).not.toMatch(/%|percent|complete/iu);
  });
});
