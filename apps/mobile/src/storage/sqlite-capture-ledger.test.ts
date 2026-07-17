import { describe, expect, it } from "vitest";
import { domainFixtureIds } from "@inspection/test-fixtures/domain";

import type { CaptureIntent, DurableArtifact } from "../capture/types.js";
import { recordManualFallback } from "../capture/manual-note.js";
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
  readonly manualNoteIdentities: {
    content_hash: string;
    note_id: string;
    schema_version: string;
  }[] = [];
  readonly manualNotes: {
    area_id: string;
    job_id: string;
    note_id: string;
    note_text: string;
    recorded_at: string;
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
    if (source.includes("FROM manual_notes note")) {
      const rows = this.manualNotes.map((note) => ({
        ...note,
        content_hash:
          this.manualNoteIdentities.find(
            (identity) => identity.note_id === note.note_id,
          )?.content_hash ?? null,
        schema_version:
          this.manualNoteIdentities.find(
            (identity) => identity.note_id === note.note_id,
          )?.schema_version ?? null,
      }));
      return Promise.resolve(
        (source.includes("identity.note_id IS NULL")
          ? rows.filter((row) => row.content_hash === null)
          : rows) as T[],
      );
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
    if (source.includes("INSERT INTO manual_notes")) {
      const noteId = String(params[0]);
      if (this.manualNotes.some((note) => note.note_id === noteId)) {
        return Promise.reject(
          new Error("UNIQUE constraint failed: manual_notes.note_id"),
        );
      }
      this.manualNotes.push({
        note_id: noteId,
        job_id: String(params[1]),
        area_id: String(params[2]),
        recorded_at: String(params[3]),
        note_text: String(params[4]),
      });
    }
    if (source.includes("INSERT INTO manual_note_content_identities")) {
      const noteId = String(params[0]);
      if (
        this.manualNoteIdentities.some(
          (identity) => identity.note_id === noteId,
        )
      ) {
        return Promise.reject(
          new Error(
            "UNIQUE constraint failed: manual_note_content_identities.note_id",
          ),
        );
      }
      this.manualNoteIdentities.push({
        note_id: noteId,
        schema_version: String(params[1]),
        content_hash: String(params[2]),
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
      "CREATE TABLE IF NOT EXISTS manual_note_content_identities",
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
    expect(captureLedgerSchemaSql).toContain("manual notes are append-only");
    expect(captureLedgerSchemaSql).toContain(
      "manual note content identities are append-only",
    );
  });

  it("commits artifact, queue, durable intent, and redacted events in one transaction", async () => {
    const database = new RecordingSQLite();
    const ledger = await createSQLiteCaptureLedger(database, testDigest);
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
    const ledger = await createSQLiteCaptureLedger(database, testDigest);
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
    const ledger = await createSQLiteCaptureLedger(database, testDigest);
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
    const ledger = await createSQLiteCaptureLedger(database, testDigest);
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
    const ledger = await createSQLiteCaptureLedger(database, testDigest);
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
      propertyLabel: "12 Example Street (synthetic)",
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
        recipientPackage: recipientPackage(accepted),
        reviewItems: accepted,
        revision: 6,
        sourcePackets: sourcePacketsFor(accepted),
        updatedAt: "2026-07-16T01:00:00.000Z",
      },
    });

    const reopened = await createSQLiteCaptureLedger(database, testDigest);
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

  it("persists and hydrates hash-bound manual notes atomically", async () => {
    const database = new RecordingSQLite();
    const ledger = await createSQLiteCaptureLedger(database, testDigest);
    const recorded = await recordManualFallback({
      areaId: "area-main-bathroom",
      digest: testDigest,
      idFactory: () => "note-sqlite",
      jobId: "job-demo",
      ledger,
      recordedAt: "2026-07-14T08:05:00.000Z",
      text: "Cracking observed.",
    });

    const reopened = await createSQLiteCaptureLedger(database, testDigest);
    expect(reopened.getManualNote(recorded.noteId)).toEqual({
      areaId: "area-main-bathroom",
      contentHash: recorded.contentHash,
      jobId: "job-demo",
      noteId: "note-sqlite",
      recordedAt: "2026-07-14T08:05:00.000Z",
      schemaVersion: "manual-note-v1",
      text: "Cracking observed.",
    });
    expect(reopened.listManualNotes()).toEqual([
      reopened.getManualNote(recorded.noteId),
    ]);
    const noteInsert = database.calls.find((call) =>
      call.sql.includes("INSERT INTO manual_notes"),
    );
    const identityInsert = database.calls.find((call) =>
      call.sql.includes("INSERT INTO manual_note_content_identities"),
    );
    expect(noteInsert?.transaction).toBeGreaterThan(0);
    expect(identityInsert?.transaction).toBe(noteInsert?.transaction);
    await expect(
      recordManualFallback({
        areaId: "area-main-bathroom",
        digest: testDigest,
        idFactory: () => "note-sqlite",
        jobId: "job-demo",
        ledger,
        recordedAt: "2026-07-14T08:05:00.000Z",
        text: "Changed content under a reused identity.",
      }),
    ).rejects.toThrow("Manual note identity already exists");
    await expect(
      ledger.recordManualNote({
        ...ledger.getManualNote(recorded.noteId)!,
        contentHash: "0".repeat(64),
        noteId: "note-forged-sqlite",
      }),
    ).rejects.toThrow("Manual note content hash does not match");
    expect(ledger.getManualNote("note-forged-sqlite")).toBeUndefined();

    await ledger.beginIntent({
      ...intent,
      captureId: "note-sqlite-capture-conflict",
    });
    await expect(
      recordManualFallback({
        areaId: "area-main-bathroom",
        digest: testDigest,
        idFactory: () => "note-sqlite-capture-conflict",
        jobId: "job-demo",
        ledger,
        recordedAt: "2026-07-14T08:06:00.000Z",
        text: "Conflicting identity.",
      }),
    ).rejects.toThrow("Manual note identity conflicts with capture identity");
    expect(
      ledger.getManualNote("note-sqlite-capture-conflict"),
    ).toBeUndefined();
  });

  it("backfills legacy note identities without rewriting prior note rows", async () => {
    const database = new RecordingSQLite();
    database.manualNotes.push({
      area_id: "area-main-bathroom",
      job_id: "job-demo",
      note_id: "note-legacy",
      note_text: "Legacy manual observation.",
      recorded_at: "2026-07-14T08:05:00.000Z",
    });

    const ledger = await createSQLiteCaptureLedger(database, testDigest);

    expect(ledger.getManualNote("note-legacy")?.contentHash).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    expect(database.manualNoteIdentities).toHaveLength(1);
    expect(
      database.calls.some((call) => /UPDATE\s+manual_notes/iu.test(call.sql)),
    ).toBe(false);
  });

  it("fails hydration closed when persisted note content no longer matches its identity", async () => {
    const database = new RecordingSQLite();
    const ledger = await createSQLiteCaptureLedger(database, testDigest);
    await recordManualFallback({
      areaId: "area-main-bathroom",
      digest: testDigest,
      idFactory: () => "note-tampered",
      jobId: "job-demo",
      ledger,
      recordedAt: "2026-07-14T08:05:00.000Z",
      text: "Original observation.",
    });
    database.manualNotes[0]!.note_text = "Content changed after persistence.";

    await expect(
      createSQLiteCaptureLedger(database, testDigest),
    ).rejects.toThrow("Manual note content hash does not match");
  });
});

function approvalBinding(
  review: ReturnType<typeof acceptReviewItem>,
  seed: string,
) {
  return {
    approvingInspector: inspectorAuthority(review.module),
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

function recipientPackage(accepted: ReturnType<typeof acceptReviewItem>[]) {
  return {
    schemaVersion: "field-recipient-package-v4" as const,
    reportVersionId: "report-version-1",
    organizationId: domainFixtureIds.organizationId,
    jobId: domainFixtureIds.jobId,
    propertyLabel: "12 Example Street (synthetic)",
    issuedAt: "2026-07-16T01:00:00.000Z",
    canonicalHash: "d".repeat(64),
    coverageIdentity: {
      organizationId: domainFixtureIds.organizationId,
      jobId: domainFixtureIds.jobId,
      ledgerRevision: 8,
    },
    modules: accepted.map((review, index) => ({
      module: review.module,
      moduleId: review.finding.moduleId,
      coverageRevision: 4,
      approvalSnapshotSha256: (index === 0 ? "a" : "b").repeat(64),
      approvingInspectorId: inspectorAuthority(review.module).inspectorId,
      inspector: recipientInspectorAuthority(review.module),
      materialLimitations: [],
      findings: [
        {
          findingId: review.finding.findingId,
          reviewId: review.reviewId,
          versionId: review.finding.versionId,
          contentHash: review.finding.contentHash,
          packetId: review.provenance.packetId,
          packetHash: review.provenance.packetHash,
          evidenceSourceCount:
            review.finding.authorship.sourceArtifactReferences.length,
        },
      ],
    })),
  };
}

function inspectorAuthority(module: "building" | "timber_pest") {
  return {
    inspectorId: `inspector-${module}`,
    displayName: "Licensed inspector",
    credential: "Synthetic credential",
    confirmedAt: "2026-07-16T01:00:00.000Z",
    authority: "synthetic_fixture" as const,
  };
}

function recipientInspectorAuthority(module: "building" | "timber_pest") {
  const authority = inspectorAuthority(module);
  return {
    displayName: authority.displayName,
    credential: authority.credential,
    confirmedAt: authority.confirmedAt,
    authority: authority.authority,
  };
}

function sourcePacketsFor(accepted: ReturnType<typeof acceptReviewItem>[]) {
  return accepted.map((review) => ({
    schemaVersion: "synthetic-fixture-source-packet-v1" as const,
    fixtureId:
      review.module === "building"
        ? ("inspectionhub.synthetic.building-review.v1" as const)
        : ("inspectionhub.synthetic.timber-pest-review.v1" as const),
    packetId: review.provenance.packetId,
    packetRevision: 1 as const,
    canonicalHash: review.provenance.packetHash,
    organizationId: review.finding.organizationId,
    jobId: review.finding.jobId,
    investigationId: review.investigationId,
    createdAt: "2026-07-15T02:00:00.000Z",
    model: "gpt-5.6-synthetic-build-week" as const,
    promptVersion: "inspection-draft-v1" as const,
    skillVersions: ["report-language-v1"] as const,
    sources: review.finding.authorship.sourceArtifactReferences.map(
      ({ artifactId, contentHash }) => ({ artifactId, contentHash }),
    ),
    assumptions: review.provenance.assumptions,
  }));
}

function testDigest(value: string): Promise<string> {
  let state = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    state = Math.imul(state ^ value.charCodeAt(index), 16_777_619) >>> 0;
  }
  return Promise.resolve(state.toString(16).padStart(8, "0").repeat(8));
}
