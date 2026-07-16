import type { SQLiteDatabase } from "expo-sqlite";

import type {
  LocalInspectionSnapshotPort,
  LocalInspectionSnapshotRecord,
} from "./local-inspection-repository";

type SnapshotRow = {
  aggregate_id: string;
  aggregate_kind: "coverage" | "investigation";
  aggregate_revision: number;
  schema_version: 1;
  snapshot_json: string;
  snapshot_sha256: string;
  updated_at: string;
};

export class SqliteInspectionSnapshotPort implements LocalInspectionSnapshotPort {
  readonly #database: SQLiteDatabase;

  constructor(database: SQLiteDatabase) {
    this.#database = database;
  }

  async initialise(): Promise<void> {
    await this.#database.execAsync(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS local_inspection_snapshots (
        aggregate_kind TEXT NOT NULL CHECK (aggregate_kind IN ('coverage', 'investigation')),
        aggregate_id TEXT NOT NULL,
        aggregate_revision INTEGER NOT NULL CHECK (aggregate_revision >= 0),
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        snapshot_json TEXT NOT NULL,
        snapshot_sha256 TEXT NOT NULL CHECK (length(snapshot_sha256) = 64),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (aggregate_kind, aggregate_id)
      );
      CREATE TABLE IF NOT EXISTS local_inspection_events (
        event_id TEXT PRIMARY KEY,
        aggregate_kind TEXT NOT NULL CHECK (aggregate_kind IN ('coverage', 'investigation')),
        aggregate_id TEXT NOT NULL,
        aggregate_revision INTEGER NOT NULL CHECK (aggregate_revision >= 0),
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        safe_metadata_json TEXT NOT NULL,
        snapshot_sha256 TEXT NOT NULL CHECK (length(snapshot_sha256) = 64),
        UNIQUE (aggregate_kind, aggregate_id, aggregate_revision)
      );
      CREATE TRIGGER IF NOT EXISTS local_inspection_events_no_update
      BEFORE UPDATE ON local_inspection_events
      BEGIN SELECT RAISE(ABORT, 'local inspection events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS local_inspection_events_no_delete
      BEFORE DELETE ON local_inspection_events
      BEGIN SELECT RAISE(ABORT, 'local inspection events are append-only'); END;
    `);
  }

  async readSnapshot(
    aggregateKind: "coverage" | "investigation",
    aggregateId: string,
  ): Promise<LocalInspectionSnapshotRecord | null> {
    const row = await this.#database.getFirstAsync<SnapshotRow>(
      `SELECT aggregate_kind, aggregate_id, aggregate_revision, schema_version,
              snapshot_json, snapshot_sha256, updated_at
       FROM local_inspection_snapshots
       WHERE aggregate_kind = ? AND aggregate_id = ?`,
      aggregateKind,
      aggregateId,
    );
    return row === null ? null : mapSnapshotRow(row);
  }

  async compareAndSet(
    input: Parameters<LocalInspectionSnapshotPort["compareAndSet"]>[0],
  ): Promise<"saved" | "revision_conflict"> {
    let result: "saved" | "revision_conflict" = "revision_conflict";
    await this.#database.withExclusiveTransactionAsync(async (transaction) => {
      const current = await transaction.getFirstAsync<{
        aggregate_revision: number;
      }>(
        `SELECT aggregate_revision FROM local_inspection_snapshots
         WHERE aggregate_kind = ? AND aggregate_id = ?`,
        input.snapshot.aggregateKind,
        input.snapshot.aggregateId,
      );
      const currentRevision = current?.aggregate_revision ?? null;
      if (currentRevision !== input.expectedStoredRevision) {
        return;
      }
      await transaction.runAsync(
        `INSERT INTO local_inspection_snapshots (
           aggregate_kind, aggregate_id, aggregate_revision, schema_version,
           snapshot_json, snapshot_sha256, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (aggregate_kind, aggregate_id) DO UPDATE SET
           aggregate_revision = excluded.aggregate_revision,
           schema_version = excluded.schema_version,
           snapshot_json = excluded.snapshot_json,
           snapshot_sha256 = excluded.snapshot_sha256,
           updated_at = excluded.updated_at`,
        input.snapshot.aggregateKind,
        input.snapshot.aggregateId,
        input.snapshot.aggregateRevision,
        input.snapshot.schemaVersion,
        input.snapshot.snapshotJson,
        input.snapshot.snapshotSha256,
        input.snapshot.updatedAt,
      );
      await transaction.runAsync(
        `INSERT INTO local_inspection_events (
           event_id, aggregate_kind, aggregate_id, aggregate_revision,
           event_type, occurred_at, safe_metadata_json, snapshot_sha256
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        input.event.eventId,
        input.event.aggregateKind,
        input.event.aggregateId,
        input.event.aggregateRevision,
        input.event.eventType,
        input.event.occurredAt,
        input.event.safeMetadataJson,
        input.event.snapshotSha256,
      );
      result = "saved";
    });
    return result;
  }
}

function mapSnapshotRow(row: SnapshotRow): LocalInspectionSnapshotRecord {
  return {
    aggregateId: row.aggregate_id,
    aggregateKind: row.aggregate_kind,
    aggregateRevision: row.aggregate_revision,
    schemaVersion: row.schema_version,
    snapshotJson: row.snapshot_json,
    snapshotSha256: row.snapshot_sha256,
    updatedAt: row.updated_at,
  };
}
