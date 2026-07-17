import { describe, expect, it } from "vitest";

import {
  changeInvestigationArea,
  createCoverageLedger,
  recordAreaCoverage,
  startInvestigation,
} from "@inspection/domain/inspection/mobile";

import {
  LocalInspectionCorruptionError,
  LocalInspectionRevisionConflictError,
  createLocalInspectionRepository,
  type LocalInspectionSnapshotPort,
  type LocalInspectionSnapshotRecord,
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

  it("recovers an open job investigation when the field-session pointer was not committed", async () => {
    const storage = new InMemorySnapshotPort();
    const firstProcess = createLocalInspectionRepository({ digest, storage });
    const started = startInvestigation({
      areaId: "main-bathroom",
      commissionedModules: [
        { module: "building", moduleId: "module-building" },
      ],
      inspectorId: "inspector-1",
      investigationId: "investigation-orphan-boundary",
      jobId: "job-1",
      organizationId: "organization-1",
      startedAt: "2026-07-14T08:00:00.000+10:00",
    });
    await firstProcess.saveInvestigation({
      event: event("event-orphan-started", "investigation.started"),
      expectedStoredRevision: null,
      investigation: started,
      updatedAt: "2026-07-14T08:00:00.000+10:00",
    });

    const reopenedProcess = createLocalInspectionRepository({
      digest,
      storage,
    });
    await expect(
      reopenedProcess.findOpenInvestigationForJob("job-1"),
    ).resolves.toMatchObject({
      investigationId: "investigation-orphan-boundary",
      status: "active",
    });
  });

  it("does not let an unrelated corrupt job block current-job recovery", async () => {
    const storage = new InMemorySnapshotPort();
    const repository = createLocalInspectionRepository({ digest, storage });
    const started = startInvestigation({
      areaId: "main-bathroom",
      commissionedModules: [
        { module: "building", moduleId: "module-building" },
      ],
      inspectorId: "inspector-1",
      investigationId: "investigation-current-job",
      jobId: "job-1",
      organizationId: "organization-1",
      startedAt: "2026-07-14T08:00:00.000+10:00",
    });
    await repository.saveInvestigation({
      event: event("event-current-job", "investigation.started"),
      expectedStoredRevision: null,
      investigation: started,
      updatedAt: "2026-07-14T08:00:00.000+10:00",
    });
    storage.additionalSnapshots.push({
      aggregateId: "investigation-other-corrupt",
      aggregateKind: "investigation",
      aggregateRevision: 0,
      jobId: "job-2",
      schemaVersion: 1,
      snapshotJson: "not-json",
      snapshotSha256: "f".repeat(64),
      updatedAt: "2026-07-14T08:00:00.000+10:00",
    });

    await expect(
      repository.findOpenInvestigationForJob("job-1"),
    ).resolves.toMatchObject({ investigationId: "investigation-current-job" });
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
      jobId: "job-corrupt",
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

  it("rejects a rechecksummed snapshot whose revision has no contiguous event history", async () => {
    const storage = new InMemorySnapshotPort();
    const repository = createLocalInspectionRepository({ digest, storage });
    const started = startInvestigation({
      areaId: "main-bathroom",
      commissionedModules: [
        { module: "building", moduleId: "module-building" },
      ],
      inspectorId: "inspector-1",
      investigationId: "investigation-event-gap",
      jobId: "job-1",
      organizationId: "organization-1",
      startedAt: "2026-07-14T08:00:00.000+10:00",
    });
    await repository.saveInvestigation({
      event: event("event-started-gap", "investigation.started"),
      expectedStoredRevision: null,
      investigation: started,
      updatedAt: "2026-07-14T08:00:00.000+10:00",
    });
    const rewrittenJson = JSON.stringify({ ...started, revision: 1 });
    storage.snapshot = {
      ...storage.snapshot!,
      aggregateRevision: 1,
      snapshotJson: rewrittenJson,
      snapshotSha256: await digest.sha256(rewrittenJson),
    };

    await expect(
      repository.loadInvestigation("investigation-event-gap"),
    ).rejects.toThrow("event history does not match");
  });

  it("rejects a correctly checksummed but incomplete professional aggregate", async () => {
    const storage = new InMemorySnapshotPort();
    const snapshotJson = JSON.stringify({
      areas: [],
      entries: [],
      jobId: "job-shape-bypass",
      limitations: [],
      organizationId: "organization-1",
      revisitItems: [],
      revision: 0,
    });
    storage.snapshot = {
      aggregateId: "job-shape-bypass",
      aggregateKind: "coverage",
      aggregateRevision: 0,
      jobId: "job-shape-bypass",
      schemaVersion: 1,
      snapshotJson,
      snapshotSha256: await digest.sha256(snapshotJson),
      updatedAt: "2026-07-14T08:00:00.000+10:00",
    };
    const repository = createLocalInspectionRepository({ digest, storage });

    await expect(
      repository.loadCoverage("job-shape-bypass"),
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
    await expect(
      repository.saveInvestigation({
        investigation: started,
        expectedStoredRevision: null,
        event: {
          ...event("event-unsafe-status", "investigation.started"),
          safeMetadataJson: JSON.stringify({
            status: "Cracked shower tiles appear to indicate movement.",
          }),
        },
        updatedAt: "2026-07-14T08:00:00.000+10:00",
      }),
    ).rejects.toThrow("value is not allowed");
    expect(storage.events).toHaveLength(0);
  });

  it("accepts the redacted metadata used by coverage initialization and close-out", async () => {
    const storage = new InMemorySnapshotPort();
    const repository = createLocalInspectionRepository({ digest, storage });
    const coverage = createCoverageLedger({
      areas: [
        {
          applicableModules: ["building"],
          areaId: "area-roof-void",
          label: "Roof void",
        },
      ],
      commissionedModules: [
        { module: "building", moduleId: "module-building" },
      ],
      jobId: "job-coverage",
      organizationId: "organization-1",
    });
    await repository.saveCoverage({
      coverage,
      event: {
        eventId: "coverage-initialized",
        eventType: "area.coverage_initialized",
        occurredAt: "2026-07-17T08:00:00.000+10:00",
        safeMetadataJson: JSON.stringify({ status: "initialized" }),
      },
      expectedStoredRevision: null,
      updatedAt: "2026-07-17T08:00:00.000+10:00",
    });
    const closed = recordAreaCoverage(coverage, {
      areaId: "area-roof-void",
      coverageEntryId: "coverage-roof-building",
      expectedRevision: 0,
      inspectorId: "inspector-1",
      module: "building",
      recordedAt: "2026-07-17T08:01:00.000+10:00",
      state: "inspected",
    });
    await repository.saveCoverage({
      coverage: closed,
      event: {
        eventId: "coverage-recorded",
        eventType: "area.coverage_recorded",
        occurredAt: "2026-07-17T08:01:00.000+10:00",
        safeMetadataJson: JSON.stringify({
          areaId: "area-roof-void",
          coverageState: "inspected",
          module: "building",
        }),
      },
      expectedStoredRevision: 0,
      updatedAt: "2026-07-17T08:01:00.000+10:00",
    });

    expect(storage.events.map((item) => item.eventType)).toEqual([
      "area.coverage_initialized",
      "area.coverage_recorded",
    ]);
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
  readonly additionalSnapshots: LocalInspectionSnapshotRecord[] = [];
  readonly events: Parameters<
    LocalInspectionSnapshotPort["compareAndSet"]
  >[0]["event"][] = [];

  listSnapshotsForJob(
    aggregateKind: "coverage" | "investigation",
    jobId: string,
  ) {
    return Promise.resolve(
      [
        ...(this.snapshot === null ? [] : [this.snapshot]),
        ...this.additionalSnapshots,
      ].filter(
        (snapshot) =>
          snapshot.aggregateKind === aggregateKind && snapshot.jobId === jobId,
      ),
    );
  }

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

  readEventHistory(
    aggregateKind: "coverage" | "investigation",
    aggregateId: string,
  ) {
    return Promise.resolve(
      this.events
        .filter(
          (event) =>
            event.aggregateKind === aggregateKind &&
            event.aggregateId === aggregateId,
        )
        .sort((left, right) => left.aggregateRevision - right.aggregateRevision)
        .map((event) => ({
          aggregateRevision: event.aggregateRevision,
          snapshotSha256: event.snapshotSha256,
        })),
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
