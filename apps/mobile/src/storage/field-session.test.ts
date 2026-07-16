import { describe, expect, it } from "vitest";

import { InMemoryCaptureLedger } from "./in-memory-capture-ledger.js";

describe("open field session persistence", () => {
  it("preserves the exact open job, area, investigation and sequence", async () => {
    const ledger = new InMemoryCaptureLedger();
    await ledger.saveFieldSession({
      activeInvestigationId: "investigation-cracked-tile",
      areaId: "area-main-bathroom",
      cachedAssignedJobIds: ["job-demo"],
      deviceId: "device-field-01",
      deviceState: "enrolled",
      jobId: "job-demo",
      nextSequence: 14,
      session: "expired",
      updatedAt: "2026-07-14T08:11:00.000Z",
      workflow: {
        approvedModules: ["building", "timber_pest"],
        deliveryState: "queued",
        investigationStatus: "completed_findings",
        lastTransition: "package_confirmed",
        packageManifestSha256: "a".repeat(64),
        reviewItems: [],
        revision: 7,
        updatedAt: "2026-07-14T08:10:00.000Z",
      },
    });

    expect(ledger.getFieldSession()).toEqual({
      activeInvestigationId: "investigation-cracked-tile",
      areaId: "area-main-bathroom",
      cachedAssignedJobIds: ["job-demo"],
      deviceId: "device-field-01",
      deviceState: "enrolled",
      jobId: "job-demo",
      nextSequence: 14,
      session: "expired",
      updatedAt: "2026-07-14T08:11:00.000Z",
      workflow: {
        approvedModules: ["building", "timber_pest"],
        deliveryState: "queued",
        investigationStatus: "completed_findings",
        lastTransition: "package_confirmed",
        packageManifestSha256: "a".repeat(64),
        reviewItems: [],
        revision: 7,
        updatedAt: "2026-07-14T08:10:00.000Z",
      },
    });
  });

  it("rejects a same-revision workflow rewrite", async () => {
    const ledger = new InMemoryCaptureLedger();
    const session = {
      areaId: "area-main-bathroom",
      cachedAssignedJobIds: ["job-demo"],
      deviceId: "device-field-01",
      deviceState: "enrolled" as const,
      jobId: "job-demo",
      nextSequence: 1,
      session: "valid" as const,
      updatedAt: "2026-07-16T01:00:00.000Z",
      workflow: {
        approvedModules: [] as const,
        deliveryState: "waiting_for_approval" as const,
        investigationStatus: "none" as const,
        lastTransition: "workflow_initialized" as const,
        packageManifestSha256: null,
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
          deliveryState: "sent",
        },
      }),
    ).toThrow("append exactly one immutable revision");
    expect(ledger.getFieldSession()?.workflow?.deliveryState).toBe(
      "waiting_for_approval",
    );
  });
});
