import { describe, expect, it } from "vitest";

import type { FieldSessionSnapshot } from "../capture/types.js";
import { fieldJobContext } from "./field-job-context.js";

describe("field job context", () => {
  it("projects exact non-demo job identity without fixture substitution", () => {
    const session: FieldSessionSnapshot = {
      areaId: "area-real-bathroom",
      cachedAssignedJobIds: ["job-real-42"],
      commissionedModules: [
        { module: "building", moduleId: "module-real-building" },
      ],
      deviceId: "device-real-1",
      deviceState: "enrolled",
      jobId: "job-real-42",
      nextSequence: 1,
      organizationId: "organization-real-7",
      propertyLabel: "42 Actual Street, Southport",
      session: "valid",
      updatedAt: "2026-07-17T09:00:00.000+10:00",
    };

    expect(fieldJobContext(session)).toEqual({
      commissionedModules: [
        { module: "building", moduleId: "module-real-building" },
      ],
      commissionedModuleTypes: ["building"],
      jobId: "job-real-42",
      organizationId: "organization-real-7",
      propertyLabel: "42 Actual Street, Southport",
    });
  });
});
