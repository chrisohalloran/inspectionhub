import { describe, expect, it } from "vitest";

import { buildCrackedTileInvestigationFixture } from "./cracked-tile.js";
import { buildMixedModuleInvestigationFixture } from "./mixed-module.js";

describe("inspection investigation fixtures", () => {
  it("provides the full cracked-tile sequence with bounded assumptions and material roof limitations", () => {
    const fixture = buildCrackedTileInvestigationFixture();

    expect(
      fixture.investigation.evidence.slice(0, 3).map((item) => item.source),
    ).toEqual(["attached_recent", "attached_recent", "attached_recent"]);
    expect(
      fixture.investigation.areaVisits.map((visit) => visit.areaId),
    ).toEqual([
      "fixture-area-second-floor-main-bathroom",
      "fixture-area-external-east-wall",
    ]);
    expect(fixture.oracle.constructionAssumptions[0]).toContain(
      "not visually confirmed",
    );
    expect(fixture.oracle.inspectorClassification).toMatchObject({
      classification: "major_defect",
      attribution: "inspector",
    });
    expect(fixture.oracle.furtherInvestigation).toContain(
      "suitably licensed and qualified builder or tiler",
    );
    expect(
      fixture.coverage.limitations.filter((item) => item.status === "active"),
    ).toHaveLength(2);
    expect(fixture.packet.modules).toEqual(
      fixture.investigation.commissionedModules,
    );
  });

  it("shares one immutable original across distinct module candidate links", () => {
    const fixture = buildMixedModuleInvestigationFixture();

    expect(fixture.investigation.evidence).toHaveLength(1);
    expect(fixture.investigation.completion?.moduleLinks).toEqual([
      expect.objectContaining({
        module: "building",
        sourceArtifactIds: [fixture.oracle.sharedOriginalId],
        sourceObservationIds: [fixture.oracle.sharedObservationId],
      }),
      expect.objectContaining({
        module: "timber_pest",
        sourceArtifactIds: [fixture.oracle.sharedOriginalId],
        sourceObservationIds: [fixture.oracle.sharedObservationId],
      }),
    ]);
    expect(fixture.oracle.building.schema).not.toBe(
      fixture.oracle.timberPest.schema,
    );
  });
});
