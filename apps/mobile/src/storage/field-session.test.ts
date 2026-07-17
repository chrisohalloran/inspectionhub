import { describe, expect, it } from "vitest";

import { InMemoryCaptureLedger } from "./in-memory-capture-ledger.js";
import { initialFieldWorkflow } from "./field-workflow.js";

describe("open field session persistence", () => {
  it("preserves the exact open job, area, investigation and sequence", async () => {
    const ledger = new InMemoryCaptureLedger();
    const workflow = initialFieldWorkflow([], "2026-07-14T08:10:00.000Z");
    await ledger.saveFieldSession({
      activeInvestigationId: "investigation-cracked-tile",
      areaId: "area-main-bathroom",
      cachedAssignedJobIds: ["job-demo"],
      commissionedModules: [
        { module: "building", moduleId: "module-building" },
      ],
      deviceId: "device-field-01",
      deviceState: "enrolled",
      jobId: "job-demo",
      nextSequence: 14,
      organizationId: "organization-demo",
      session: "expired",
      updatedAt: "2026-07-14T08:11:00.000Z",
      workflow,
    });

    expect(ledger.getFieldSession()).toEqual({
      activeInvestigationId: "investigation-cracked-tile",
      areaId: "area-main-bathroom",
      cachedAssignedJobIds: ["job-demo"],
      commissionedModules: [
        { module: "building", moduleId: "module-building" },
      ],
      deviceId: "device-field-01",
      deviceState: "enrolled",
      jobId: "job-demo",
      nextSequence: 14,
      organizationId: "organization-demo",
      session: "expired",
      updatedAt: "2026-07-14T08:11:00.000Z",
      workflow,
    });
  });

  it("rejects a same-revision workflow rewrite", async () => {
    const ledger = new InMemoryCaptureLedger();
    const session = {
      areaId: "area-main-bathroom",
      cachedAssignedJobIds: ["job-demo"],
      commissionedModules: [
        { module: "building" as const, moduleId: "module-building" },
      ],
      deviceId: "device-field-01",
      deviceState: "enrolled" as const,
      jobId: "job-demo",
      nextSequence: 1,
      organizationId: "organization-demo",
      session: "valid" as const,
      updatedAt: "2026-07-16T01:00:00.000Z",
      workflow: {
        approvedModules: [] as const,
        deliveryState: "waiting_for_approval" as const,
        investigationStatus: "none" as const,
        lastTransition: "workflow_initialized" as const,
        moduleApprovalBindings: [] as const,
        packageManifestSha256: null,
        processedFindingCandidateIds: [] as const,
        reviewItems: [] as const,
        revision: 1,
        updatedAt: "2026-07-16T01:00:00.000Z",
      },
    };
    await ledger.saveFieldSession(session);

    expect(() =>
      ledger.saveFieldSession({
        ...session,
        workflow: {
          ...session.workflow,
          updatedAt: "2026-07-16T01:00:01.000Z",
        },
      }),
    ).toThrow("append exactly one immutable revision");
    expect(ledger.getFieldSession()?.workflow?.deliveryState).toBe(
      "waiting_for_approval",
    );
  });
});
