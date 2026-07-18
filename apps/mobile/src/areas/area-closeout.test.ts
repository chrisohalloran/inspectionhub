import { describe, expect, it } from "vitest";

import { createCoverageLedger } from "@inspection/domain/inspection/mobile";

import { closeOutArea } from "./area-closeout.js";

describe("durable field area close-out", () => {
  it("records an inaccessible limitation and exposes remaining module coverage work", () => {
    const initial = createCoverageLedger({
      areas: [
        {
          applicableModules: ["building", "timber_pest"],
          areaId: "area-roof-void",
          label: "Roof void",
        },
      ],
      commissionedModules: [
        { module: "building", moduleId: "module-building" },
        { module: "timber_pest", moduleId: "module-timber-pest" },
      ],
      jobId: "job-1",
      organizationId: "organization-1",
    });

    const result = closeOutArea(initial, {
      areaId: "area-roof-void",
      coverageEntryId: "coverage-roof-building",
      detail: "Access hatch was obstructed at the time of inspection.",
      inspectorId: "inspector-1",
      limitationId: "limitation-roof-building",
      material: true,
      module: "building",
      recordedAt: "2026-07-17T09:00:00.000+10:00",
      state: "inaccessible",
    });

    expect(result.ledger.limitations).toEqual([
      expect.objectContaining({
        areaId: "area-roof-void",
        material: true,
        module: "building",
        status: "active",
      }),
    ]);
    expect(result.remainingIssueCount).toBe(1);
    expect(result.announcement).toContain(
      "Building coverage recorded as inaccessible",
    );
  });
});
