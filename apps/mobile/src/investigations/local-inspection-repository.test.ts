import { describe, expect, it } from "vitest";

import {
  changeInvestigationArea,
  startInvestigation,
} from "@inspection/domain/inspection/mobile";

import {
  LocalInspectionCorruptionError,
  LocalInspectionRevisionConflictError,
  createLocalInspectionRepository,
  type LocalInspectionSnapshotPort,
} from "./local-inspection-repository.js";

const digest = {
  sha256(value: string): Promise<string> {
    let sum = 0;
    for (const character of value) {
      sum = (sum + (character.codePointAt(0) ?? 0)) % 256;
    }
    return Promise.resolve(sum.toString(16).padStart(64, "0"));
  },
};

describe("durable local investigation repository", () => {
  it("restores the active area thread after a process restart", async () => {
    const storage = new InMemorySnapshotPort();
    const firstProcess = createLocalInspectionRepository({ digest, storage });
    const started = startInvestigation({
      investigationId: "investigation-resume",
      organizationId: "organization-1",
      jobId: "job-1",
      commissionedModules: [
        { module: "building", moduleId: "module-building" },
      ],
      areaId: "main-bathroom",
      startedAt: "2026-07-14T08:00:00.000+10:00",
      inspectorId: "inspector-1",
    });
    await firstProcess.saveInvestigation({
      investigation: started,
      expectedStoredRevision: null,
      event: event("event-started", "investigation.started"),
      updatedAt: "2026-07-14T08:00:00.000+10:00",
    });
    const moved = changeInvestigationArea(started, {
      expectedRevision: 0,
      areaId: "external-east-wall",
      enteredAt: "2026-07-14T08:05:00.000+10:00",
    });
    await firstProcess.saveInvestigation({
      investigation: moved,
      expectedStoredRevision: 0,
      event: event("event-area", "investigation.area_changed"),
      updatedAt: "2026-07-14T08:05:00.000+10:00",
    });

    const reopenedProcess = createLocalInspectionRepository({
      digest,
      storage,
    });
    await expect(
      reopenedProcess.loadInvestigation("investigation-resume"),
    ).resolves.toMatchObject({
      currentAreaId: "external-east-wall",
      revision: 1,
      status: "active",
    });
    expect(storage.events.map((item) => item.eventType)).toEqual([
      "investigation.started",
      "investigation.area_changed",
    ]);
  });

  it("rejects a stale compare-and-set without replacing the durable current thread", async () => {
    const storage = new InMemorySnapshotPort();
    const repository = createLocalInspectionRepository({ digest, storage });
    const started = startInvestigation({
      investigationId: "investigation-stale",
      organizationId: "organization-1",
      jobId: "job-1",
      commissionedModules: [
        { module: "building", moduleId: "module-building" },
      ],
      areaId: "main-bathroom",
      startedAt: "2026-07-14T08:00:00.000+10:00",
      inspectorId: "inspector-1",
    });
    await repository.saveInvestigation({
      investigation: started,
      expectedStoredRevision: null,
      event: event("event-started", "investigation.started"),
      updatedAt: "2026-07-14T08:00:00.000+10:00",
    });

    await expect(
      repository.saveInvestigation({
        investigation: started,
        expectedStoredRevision: null,
        event: event("event-stale", "investigation.started"),
        updatedAt: "2026-07-14T08:00:01.000+10:00",
      }),
    ).rejects.toBeInstanceOf(LocalInspectionRevisionConflictError);
    expect(storage.events).toHaveLength(1);
  });

  it("detects a corrupted local snapshot before restoring professional state", async () => {
    const storage = new InMemorySnapshotPort();
    storage.snapshot = {
      aggregateId: "investigation-corrupt",
      aggregateKind: "investigation",
      aggregateRevision: 0,
      schemaVersion: 1,
      snapshotJson: '{"investigationId":"investigation-corrupt","revision":0}',
      snapshotSha256: "f".repeat(64),
      updatedAt: "2026-07-14T08:00:00.000+10:00",
    };
    const repository = createLocalInspectionRepository({ digest, storage });

    await expect(
      repository.loadInvestigation("investigation-corrupt"),
    ).rejects.toBeInstanceOf(LocalInspectionCorruptionError);
  });

  it("keeps event metadata free of evidence paths, observations, and snapshot content", async () => {
    const storage = new InMemorySnapshotPort();
    const repository = createLocalInspectionRepository({ digest, storage });
    const started = startInvestigation({
      investigationId: "investigation-redacted",
      organizationId: "organization-1",
      jobId: "job-1",
      commissionedModules: [
        { module: "building", moduleId: "module-building" },
      ],
      areaId: "main-bathroom",
      startedAt: "2026-07-14T08:00:00.000+10:00",
      inspectorId: "inspector-1",
    });
    await repository.saveInvestigation({
      investigation: started,
      expectedStoredRevision: null,
      event: event("event-redacted", "investigation.started"),
      updatedAt: "2026-07-14T08:00:00.000+10:00",
    });

    const eventsJson = JSON.stringify(storage.events);
    expect(eventsJson).not.toContain("snapshotJson");
    expect(eventsJson).not.toContain("file://");
    expect(eventsJson).not.toContain("observation");
  });

  it("rejects professional content disguised as event metadata", async () => {
    const storage = new InMemorySnapshotPort();
    const repository = createLocalInspectionRepository({ digest, storage });
    const started = startInvestigation({
      investigationId: "investigation-unsafe-metadata",
      organizationId: "organization-1",
      jobId: "job-1",
      commissionedModules: [
        { module: "building", moduleId: "module-building" },
      ],
      areaId: "main-bathroom",
      startedAt: "2026-07-14T08:00:00.000+10:00",
      inspectorId: "inspector-1",
    });

    await expect(
      repository.saveInvestigation({
        investigation: started,
        expectedStoredRevision: null,
        event: {
          ...event("event-unsafe", "investigation.started"),
          safeMetadataJson: JSON.stringify({
            observation:
              "Professional content must stay in the protected snapshot.",
          }),
        },
        updatedAt: "2026-07-14T08:00:00.000+10:00",
      }),
    ).rejects.toThrow("non-allowlisted key");
    expect(storage.events).toHaveLength(0);
  });
});

function event(
  eventId: string,
  eventType: "investigation.area_changed" | "investigation.started",
) {
  return {
    eventId,
    eventType,
    occurredAt: "2026-07-14T08:00:00.000+10:00",
    safeMetadataJson: "{}",
  };
}

class InMemorySnapshotPort implements LocalInspectionSnapshotPort {
  snapshot: Awaited<ReturnType<LocalInspectionSnapshotPort["readSnapshot"]>> =
    null;
  readonly events: Parameters<
    LocalInspectionSnapshotPort["compareAndSet"]
  >[0]["event"][] = [];

  readSnapshot(
    aggregateKind: "coverage" | "investigation",
    aggregateId: string,
  ) {
    return Promise.resolve(
      this.snapshot?.aggregateKind === aggregateKind &&
        this.snapshot.aggregateId === aggregateId
        ? this.snapshot
        : null,
    );
  }

  compareAndSet(
    input: Parameters<LocalInspectionSnapshotPort["compareAndSet"]>[0],
  ): Promise<"saved" | "revision_conflict"> {
    const currentRevision = this.snapshot?.aggregateRevision ?? null;
    if (currentRevision !== input.expectedStoredRevision) {
      return Promise.resolve("revision_conflict");
    }
    this.snapshot = input.snapshot;
    this.events.push(input.event);
    return Promise.resolve("saved");
  }
}
