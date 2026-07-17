import { describe, expect, it } from "vitest";
import { domainFixtureIds } from "@inspection/test-fixtures/domain";

import type { CaptureIntent, DurableArtifact } from "../capture/types.js";
import { createSyntheticReviewItems } from "../review/demo-review-items.js";
import { acceptReviewItem } from "../review/investigation-review.js";
import {
  captureLedgerSchemaSql,
  createSQLiteCaptureLedger,
  type SQLiteCaptureConnection,
  type SQLiteValue,
} from "./sqlite-capture-ledger.js";

type RecordedCall = {
  params: readonly SQLiteValue[];
  sql: string;
  transaction: number;
};

class RecordingSQLite implements SQLiteCaptureConnection {
  readonly calls: RecordedCall[] = [];
  readonly execs: string[] = [];
  transactionCount = 0;
  failArtifactInsert = false;
  fieldSessionSnapshot: string | undefined;
  readonly fieldWorkflowEvents: {
    job_id: string;
    revision: number;
    transition_type: string;
    workflow_json: string;
  }[] = [];
  #activeTransaction = 0;

  execAsync(source: string): Promise<void> {
    this.execs.push(source);
    return Promise.resolve();
  }

  getAllAsync<T>(
    source: string,
    ...params: readonly SQLiteValue[]
  ): Promise<T[]> {
    void params;
    if (source.includes("FROM field_session")) {
      return Promise.resolve(
        (this.fieldSessionSnapshot === undefined
          ? []
          : [{ snapshot_json: this.fieldSessionSnapshot }]) as T[],
      );
    }
    if (source.includes("FROM field_workflow_events")) {
      return Promise.resolve([...this.fieldWorkflowEvents] as T[]);
    }
    return Promise.resolve([]);
  }

  getFirstAsync<T>(
    source: string,
    ...params: readonly SQLiteValue[]
  ): Promise<T | null> {
    this.calls.push({
      params,
      sql: source,
      transaction: this.#activeTransaction,
    });
    return Promise.resolve({ nextOrdinal: 1 } as T);
  }

  runAsync(
    source: string,
    ...params: readonly SQLiteValue[]
  ): Promise<unknown> {
    this.calls.push({
      params,
      sql: source,
      transaction: this.#activeTransaction,
    });
    if (
      this.failArtifactInsert &&
      source.includes("INSERT INTO capture_artifacts")
    ) {
      return Promise.reject(new Error("injected SQLite failure"));
    }
    if (source.includes("INSERT INTO field_session")) {
      this.fieldSessionSnapshot = String(params[0]);
    }
    if (source.includes("INSERT INTO field_workflow_events")) {
      this.fieldWorkflowEvents.push({
        job_id: String(params[0]),
        revision: Number(params[1]),
        transition_type: String(params[2]),
        workflow_json: String(params[4]),
      });
    }
    return Promise.resolve({ changes: 1, lastInsertRowId: 1 });
  }

  async withExclusiveTransactionAsync(
    task: (transaction: SQLiteCaptureConnection) => Promise<void>,
  ): Promise<void> {
    this.transactionCount += 1;
    this.#activeTransaction = this.transactionCount;
    try {
      await task(this);
    } finally {
      this.#activeTransaction = 0;
    }
  }
}

const intent: CaptureIntent = {
  areaId: "area-main-bathroom",
  captureId: "capture-sqlite",
  capturedAt: "2026-07-14T08:00:00.000Z",
  deviceId: "device-field-01",
  evidenceRole: "private_coverage",
  jobId: "job-demo",
  kind: "photo",
  sequence: 1,
  state: "pending",
};

const artifact: DurableArtifact = {
  byteLength: 2048,
  captureId: intent.captureId,
  directorySync: "synced",
  fileUri: "file:///durable/capture-sqlite.capture",
  immutable: true,
  queueLane: "photo_upload",
  sha256: "e".repeat(64),
};

describe("Expo SQLite capture ledger", () => {
  it("defines constrained append-only local tables without media payload columns", () => {
    expect(captureLedgerSchemaSql).toContain(
      "CREATE TABLE IF NOT EXISTS capture_intents",
    );
    expect(captureLedgerSchemaSql).toContain(
      "CREATE TABLE IF NOT EXISTS local_capture_events",
    );
    expect(captureLedgerSchemaSql).toContain(
      "CREATE TABLE IF NOT EXISTS capture_performance_samples",
    );
    expect(captureLedgerSchemaSql).toContain(
      "CREATE TABLE IF NOT EXISTS capture_acknowledgements",
    );
    expect(captureLedgerSchemaSql).toContain(
      "CREATE TABLE IF NOT EXISTS field_workflow_events",
    );
    expect(captureLedgerSchemaSql).toContain(
      "CHECK (evidence_role = 'private_coverage')",
    );
    expect(captureLedgerSchemaSql).not.toMatch(
      /media_(?:bytes|content)|transcript_text/iu,
    );
    expect(captureLedgerSchemaSql).not.toMatch(
      /UPDATE\s+local_capture_events|DELETE\s+FROM\s+local_capture_events/iu,
    );
    expect(captureLedgerSchemaSql).toContain(
      "capture performance samples are append-only",
    );
    expect(captureLedgerSchemaSql).toContain(
      "capture acknowledgements are append-only",
    );
    expect(captureLedgerSchemaSql).toContain(
      "field workflow events are append-only",
    );
  });

  it("commits artifact, queue, durable intent, and redacted events in one transaction", async () => {
    const database = new RecordingSQLite();
    const ledger = await createSQLiteCaptureLedger(database);
    await ledger.beginIntent(intent);
    await ledger.commitDurableCapture(intent.captureId, artifact);

    const commitCalls = database.calls.filter((call) => call.transaction === 2);
    expect(
      commitCalls.some((call) =>
        call.sql.includes("INSERT INTO capture_artifacts"),
      ),
    ).toBe(true);
    expect(
      commitCalls.some((call) =>
        call.sql.includes("INSERT INTO capture_queue"),
      ),
    ).toBe(true);
    expect(
      commitCalls.some((call) => call.sql.includes("UPDATE capture_intents")),
    ).toBe(true);
    expect(
      commitCalls.filter((call) =>
        call.sql.includes("INSERT INTO local_capture_events"),
      ),
    ).toHaveLength(2);
    expect(ledger.getArtifact(intent.captureId)).toEqual(artifact);
    const eventCalls = database.calls.filter((call) =>
      call.sql.includes("INSERT INTO local_capture_events"),
    );
    expect(JSON.stringify(eventCalls)).not.toContain(intent.capturedAt);
    expect(JSON.stringify(eventCalls)).not.toContain(artifact.fileUri);
  });

  it("does not publish cache state when the SQLite transaction rolls back", async () => {
    const database = new RecordingSQLite();
    const ledger = await createSQLiteCaptureLedger(database);
    await ledger.beginIntent(intent);
    database.failArtifactInsert = true;

    await expect(
      ledger.commitDurableCapture(intent.captureId, artifact),
    ).rejects.toThrow("injected SQLite failure");
    expect(ledger.getArtifact(intent.captureId)).toBeUndefined();
    expect(ledger.getQueue(intent.captureId)).toBeUndefined();
    expect(ledger.getIntent(intent.captureId)?.state).toBe("pending");
  });

  it("records acknowledgement in an upgrade-safe append-only receipt", async () => {
    const database = new RecordingSQLite();
    const ledger = await createSQLiteCaptureLedger(database);
    await ledger.beginIntent(intent);
    await ledger.commitDurableCapture(intent.captureId, artifact);
    await ledger.markIntent(intent.captureId, "acknowledged");

    expect(ledger.getIntent(intent.captureId)?.state).toBe("acknowledged");
    const acknowledgement = database.calls.find((call) =>
      call.sql.includes("INSERT OR IGNORE INTO capture_acknowledgements"),
    );
    expect(acknowledgement?.transaction).toBe(3);
    expect(acknowledgement?.params).toEqual([intent.captureId]);
  });

  it("stores a redacted benchmark sample in its own append-only transaction", async () => {
    const database = new RecordingSQLite();
    const ledger = await createSQLiteCaptureLedger(database);
    await ledger.beginIntent(intent);
    await ledger.recordPerformanceSample({
      captureId: intent.captureId,
      interactionLatencyMs: 94,
      interactionType: "shutter_acknowledgement",
      kind: "photo",
      localDurableSaveMs: 618,
      recordedAt: "2026-07-15T10:00:00.000Z",
    });

    const samples = ledger.listPerformanceSamples();
    expect(samples).toEqual([
      {
        captureId: intent.captureId,
        interactionLatencyMs: 94,
        interactionType: "shutter_acknowledgement",
        kind: "photo",
        localDurableSaveMs: 618,
        recordedAt: "2026-07-15T10:00:00.000Z",
      },
    ]);
    const insert = database.calls.find((call) =>
      call.sql.includes("INSERT INTO capture_performance_samples"),
    );
    expect(insert?.transaction).toBe(2);
    expect(JSON.stringify(insert)).not.toMatch(/file:\/\/|media|transcript/iu);
  });

  it("persists the field workflow with its package manifest before UI confirmation", async () => {
    const database = new RecordingSQLite();
    const ledger = await createSQLiteCaptureLedger(database);
    const accepted = createSyntheticReviewItems().map(acceptReviewItem);
    await ledger.saveFieldSession({
      areaId: "area-main-bathroom",
      cachedAssignedJobIds: [domainFixtureIds.jobId],
      commissionedModules: [
        {
          module: "building",
          moduleId: domainFixtureIds.buildingModuleId,
        },
        {
          module: "timber_pest",
          moduleId: domainFixtureIds.timberPestModuleId,
        },
      ],
      deviceId: "device-field-01",
      deviceState: "enrolled",
      jobId: domainFixtureIds.jobId,
      nextSequence: 2,
      organizationId: domainFixtureIds.organizationId,
      session: "valid",
      updatedAt: "2026-07-16T01:00:01.000Z",
      workflow: {
        approvedModules: ["building", "timber_pest"],
        deliveryState: "queued",
        investigationStatus: "completed_findings",
        lastTransition: "package_confirmed",
        moduleApprovalBindings: [
          approvalBinding(accepted[0]!, "a"),
          approvalBinding(accepted[1]!, "b"),
        ],
        packageManifestSha256: "c".repeat(64),
        processedFindingCandidateIds: [],
        reviewItems: accepted,
        revision: 6,
        updatedAt: "2026-07-16T01:00:00.000Z",
      },
    });

    const reopened = await createSQLiteCaptureLedger(database);
    const saved = reopened.getFieldSession();
    expect(saved?.workflow).toMatchObject({
      approvedModules: ["building", "timber_pest"],
      deliveryState: "queued",
      packageManifestSha256: "c".repeat(64),
      revision: 6,
    });
    const write = database.calls.find((call) =>
      call.sql.includes("INSERT INTO field_session"),
    );
    expect(write?.transaction).toBe(1);
    expect(String(write?.params[0])).toContain('"deliveryState":"queued"');
    const event = database.calls.find((call) =>
      call.sql.includes("INSERT INTO field_workflow_events"),
    );
    expect(event?.transaction).toBe(1);
    expect(event?.params.slice(0, 3)).toEqual([
      domainFixtureIds.jobId,
      6,
      "package_confirmed",
    ]);
  });
});

function approvalBinding(
  review: ReturnType<typeof acceptReviewItem>,
  seed: string,
) {
  return {
    coverageRevision: 4,
    module: review.module,
    reviewVersions: [
      {
        contentHash: review.finding.contentHash,
        reviewId: review.reviewId,
        versionId: review.finding.versionId,
      },
    ],
    snapshotSha256: seed.repeat(64),
  };
}
