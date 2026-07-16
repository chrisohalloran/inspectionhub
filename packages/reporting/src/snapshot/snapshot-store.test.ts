import {
  buildingModuleSnapshotFixture,
  domainFixtureIds,
} from "@inspection/test-fixtures/domain";
import { describe, expect, it } from "vitest";

import {
  InMemoryModuleSnapshotStore,
  SnapshotConflictError,
} from "./snapshot-store.js";

const key = {
  organizationId: domainFixtureIds.organizationId,
  jobId: domainFixtureIds.jobId,
  module: "building" as const,
};

describe("immutable module snapshot store", () => {
  it("creates canonical immutable snapshots and advances by compare-and-set", () => {
    const store = new InMemoryModuleSnapshotStore();
    const first = store.create(buildingModuleSnapshotFixture(1), 0);
    const second = store.create(buildingModuleSnapshotFixture(2), 1);

    expect(store.getCurrent(key)).toBe(second);
    expect(store.history(key)).toEqual([first, second]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.canonicalHash).not.toBe(second.canonicalHash);
  });

  it("rejects stale and skipped revisions without mutating current state", () => {
    const store = new InMemoryModuleSnapshotStore();
    const first = store.create(buildingModuleSnapshotFixture(1), 0);

    expect(() => store.create(buildingModuleSnapshotFixture(2), 0)).toThrow(
      SnapshotConflictError,
    );
    expect(() =>
      store.create({ ...buildingModuleSnapshotFixture(2), revision: 3 }, 1),
    ).toThrow("advance the current module revision exactly once");
    expect(store.getCurrent(key)).toBe(first);
  });

  it("preserves prior records and rejects reused snapshot identities", () => {
    const store = new InMemoryModuleSnapshotStore();
    const first = store.create(buildingModuleSnapshotFixture(1), 0);

    expect(() => store.create(buildingModuleSnapshotFixture(1), 1)).toThrow(
      "revision",
    );
    expect(store.getById(first.snapshotId)).toBe(first);
  });
});
