import {
  buildingModuleSnapshotFixture,
  domainFixtureIds,
  timberPestModuleSnapshotFixture,
} from "@inspection/test-fixtures/domain";
import { describe, expect, it } from "vitest";
import { InMemoryModuleSnapshotStore } from "@inspection/reporting/snapshot";

import {
  ApprovalError,
  InMemoryApprovalService,
  InMemoryInspectorAuthority,
} from "./approval-service.js";

const timestamp = "2026-07-15T02:00:00.000Z";
const buildingKey = {
  organizationId: domainFixtureIds.organizationId,
  jobId: domainFixtureIds.jobId,
  module: "building" as const,
};
const pestKey = { ...buildingKey, module: "timber_pest" as const };

function setup() {
  const snapshots = new InMemoryModuleSnapshotStore();
  const building = snapshots.create(buildingModuleSnapshotFixture(1), 0);
  const pest = snapshots.create(timberPestModuleSnapshotFixture(1), 0);
  const authority = new InMemoryInspectorAuthority();
  const assigned = {
    assignedInspectorId: domainFixtureIds.inspectorId,
    eligible: true,
    credentialVersion: "fixture-credential-v1",
  };
  authority.set(buildingKey, assigned);
  authority.set(pestKey, assigned);
  const approvals = new InMemoryApprovalService(
    snapshots,
    authority,
    (() => {
      let sequence = 800;
      return () =>
        `50000000-0000-4000-8000-${(++sequence).toString().padStart(12, "0")}`;
    })(),
  );
  return { snapshots, building, pest, authority, approvals };
}

function approve(
  context: ReturnType<typeof setup>,
  module: "building" | "timber_pest",
  expectedModuleRevision = 0,
  idempotencyKey = `approve:${module}:${expectedModuleRevision}`,
) {
  const snapshot = module === "building" ? context.building : context.pest;
  return context.approvals.approve({
    organizationId: domainFixtureIds.organizationId,
    jobId: domainFixtureIds.jobId,
    module,
    snapshotId: snapshot.snapshotId,
    snapshotHash: snapshot.canonicalHash,
    expectedModuleRevision,
    inspectorId: domainFixtureIds.inspectorId,
    credentialVersion: "fixture-credential-v1",
    recentAuthentication: true,
    idempotencyKey,
    approvedAt: timestamp,
  });
}

describe("module approval service", () => {
  it("records independent approvals for exact immutable module snapshots", () => {
    const context = setup();
    const building = approve(context, "building");

    expect(building.snapshotId).toBe(context.building.snapshotId);
    expect(context.approvals.getCurrentApproval(buildingKey)).toBe(building);
    expect(context.approvals.getCurrentApproval(pestKey)).toBeUndefined();
    expect(context.approvals.events()[0]?.type).toBe("approval.recorded");
  });

  it("replays one idempotent approval and rejects key reuse", () => {
    const context = setup();
    const first = approve(context, "building", 0, "same-key");
    const replay = approve(context, "building", 0, "same-key");

    expect(replay).toBe(first);
    expect(context.approvals.events()).toHaveLength(1);
    expect(() =>
      context.approvals.approve({
        organizationId: domainFixtureIds.organizationId,
        jobId: domainFixtureIds.jobId,
        module: "building",
        snapshotId: context.building.snapshotId,
        snapshotHash: context.building.canonicalHash,
        expectedModuleRevision: 1,
        inspectorId: domainFixtureIds.inspectorId,
        credentialVersion: "fixture-credential-v1",
        recentAuthentication: true,
        idempotencyKey: "same-key",
        approvedAt: timestamp,
      }),
    ).toThrow(ApprovalError);
  });

  it("rejects an offline stale approval after another device advances revision", () => {
    const context = setup();
    approve(context, "building");

    expect(() => approve(context, "building", 0, "old-device")).toThrow(
      "current revision is 1",
    );
    expect(context.approvals.getCurrentApproval(pestKey)).toBeUndefined();
  });

  it("requires the assigned eligible inspector, current credential and recent auth", () => {
    const context = setup();
    const base = {
      organizationId: domainFixtureIds.organizationId,
      jobId: domainFixtureIds.jobId,
      module: "building" as const,
      snapshotId: context.building.snapshotId,
      snapshotHash: context.building.canonicalHash,
      expectedModuleRevision: 0,
      credentialVersion: "fixture-credential-v1",
      idempotencyKey: "authority-check",
      approvedAt: timestamp,
    };
    expect(() =>
      context.approvals.approve({
        ...base,
        inspectorId: "50000000-0000-4000-8000-000000000099",
        recentAuthentication: true,
      }),
    ).toThrow("single assigned inspector");
    expect(() =>
      context.approvals.approve({
        ...base,
        inspectorId: domainFixtureIds.inspectorId,
        recentAuthentication: false,
      }),
    ).toThrow("refreshed authentication");
    context.authority.set(buildingKey, {
      assignedInspectorId: domainFixtureIds.inspectorId,
      eligible: false,
      credentialVersion: "fixture-credential-v1",
    });
    expect(() =>
      context.approvals.approve({
        ...base,
        inspectorId: domainFixtureIds.inspectorId,
        recentAuthentication: true,
      }),
    ).toThrow("not currently eligible");
  });

  it("invalidates only the edited module approval", () => {
    const context = setup();
    approve(context, "building");
    const pestApproval = approve(context, "timber_pest");
    const priorBuilding = context.building;
    const edited = context.snapshots.create(
      buildingModuleSnapshotFixture(2),
      1,
    );

    const revision = context.approvals.invalidateForSnapshotEdit({
      ...buildingKey,
      expectedModuleRevision: 1,
      priorSnapshotId: priorBuilding.snapshotId,
      newSnapshotId: edited.snapshotId,
      inspectorId: domainFixtureIds.inspectorId,
      recordedAt: timestamp,
    });

    expect(revision).toBe(2);
    expect(context.approvals.getCurrentApproval(buildingKey)).toBeUndefined();
    expect(context.approvals.getCurrentApproval(pestKey)).toBe(pestApproval);
  });

  it("withdraws current professional authority and blocks approval until reopened", () => {
    const context = setup();
    approve(context, "building");
    context.approvals.withdraw({
      ...buildingKey,
      expectedModuleRevision: 1,
      inspectorId: domainFixtureIds.inspectorId,
      recentAuthentication: true,
      recordedAt: timestamp,
      reasonCode: "material_error",
    });

    expect(context.approvals.isWithdrawn(buildingKey)).toBe(true);
    expect(context.approvals.getCurrentApproval(buildingKey)).toBeUndefined();
    expect(() => approve(context, "building", 2, "after-withdrawal")).toThrow(
      "requires a new snapshot",
    );
    expect(() => context.approvals.reopenWithNewSnapshot(buildingKey)).toThrow(
      "requires a new replacement snapshot",
    );

    context.snapshots.create(buildingModuleSnapshotFixture(2), 1);
    context.approvals.reopenWithNewSnapshot(buildingKey);
    expect(context.approvals.isWithdrawn(buildingKey)).toBe(false);
    expect(context.approvals.getRevision(buildingKey)).toBe(3);
  });
});
