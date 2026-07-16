import { describe, expect, it } from "vitest";

import { demoActors, demoJob } from "./demo.js";

describe("demo fixtures", () => {
  it("keeps people in distinct roles", () => {
    const ids = Object.values(demoActors).map((actor) => actor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("commissions both independently governed modules", () => {
    expect(demoJob.commissionedModules).toEqual(["building", "timber_pest"]);
  });
});
