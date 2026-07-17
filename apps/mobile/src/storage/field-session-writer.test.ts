import { describe, expect, it } from "vitest";

import type { FieldSessionSnapshot } from "../capture/types";
import { SerializedFieldSessionWriter } from "./field-session-writer";
import { initialFieldWorkflow } from "./field-workflow";

describe("serialized field-session writer", () => {
  it("derives overlapping updates from the latest committed snapshot", async () => {
    const persisted: FieldSessionSnapshot[] = [];
    let releaseFirst!: () => void;
    const firstWriteBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const writer = new SerializedFieldSessionWriter({
      initial: session(),
      persist: async (snapshot) => {
        if (persisted.length === 0) await firstWriteBlocked;
        persisted.push(snapshot);
      },
      onCommitted: () => undefined,
    });

    const areaChange = writer.update((current) => ({
      ...current,
      areaId: "area-roof",
      updatedAt: "2026-07-17T01:00:01.000Z",
    }));
    const sequenceReservation = writer.update((current) => ({
      ...current,
      nextSequence: current.nextSequence + 1,
      updatedAt: "2026-07-17T01:00:02.000Z",
    }));
    releaseFirst();

    await expect(areaChange).resolves.toMatchObject({ areaId: "area-roof" });
    await expect(sequenceReservation).resolves.toMatchObject({
      areaId: "area-roof",
      nextSequence: 2,
    });
    expect(persisted.at(-1)).toMatchObject({
      areaId: "area-roof",
      nextSequence: 2,
    });
  });

  it("keeps the last committed state when persistence fails", async () => {
    let fail = true;
    const writer = new SerializedFieldSessionWriter({
      initial: session(),
      persist: () => {
        if (fail) {
          fail = false;
          return Promise.reject(new Error("disk unavailable"));
        }
        return Promise.resolve();
      },
      onCommitted: () => undefined,
    });

    await expect(
      writer.update((current) => ({ ...current, areaId: "area-failed" })),
    ).rejects.toThrow("disk unavailable");
    await expect(
      writer.update((current) => ({
        ...current,
        nextSequence: current.nextSequence + 1,
      })),
    ).resolves.toMatchObject({ areaId: "area-main", nextSequence: 2 });
  });
});

function session(): FieldSessionSnapshot {
  return {
    areaId: "area-main",
    cachedAssignedJobIds: ["job-1"],
    commissionedModules: [{ module: "building", moduleId: "module-building" }],
    deviceId: "device-1",
    deviceState: "enrolled",
    jobId: "job-1",
    nextSequence: 1,
    organizationId: "organization-1",
    propertyLabel: "12 Example Street",
    session: "valid",
    updatedAt: "2026-07-17T01:00:00.000Z",
    workflow: initialFieldWorkflow([], "2026-07-17T01:00:00.000Z"),
  };
}
