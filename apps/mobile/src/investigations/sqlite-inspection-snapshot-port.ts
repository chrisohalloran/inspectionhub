import type { SQLiteDatabase } from "expo-sqlite";

import type {
  LocalInspectionSnapshotPort,
  LocalInspectionSnapshotRecord,
} from "./local-inspection-repository";

type SnapshotRow = {
  aggregate_id: string;
  aggregate_kind: "coverage" | "investigation";
  aggregate_revision: number;
  job_id: string | null;
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
        job_id TEXT,
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
      CREATE TABLE IF NOT EXISTS local_inspection_snapshot_quarantines (
        aggregate_kind TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        quarantined_at TEXT NOT NULL,
        PRIMARY KEY (aggregate_kind, aggregate_id)
      );
      CREATE TRIGGER IF NOT EXISTS local_inspection_events_no_update
      BEFORE UPDATE ON local_inspection_events
      BEGIN SELECT RAISE(ABORT, 'local inspection events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS local_inspection_events_no_delete
      BEFORE DELETE ON local_inspection_events
      BEGIN SELECT RAISE(ABORT, 'local inspection events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS local_inspection_snapshot_quarantines_no_update
      BEFORE UPDATE ON local_inspection_snapshot_quarantines
      BEGIN SELECT RAISE(ABORT, 'local inspection quarantines are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS local_inspection_snapshot_quarantines_no_delete
      BEFORE DELETE ON local_inspection_snapshot_quarantines
      BEGIN SELECT RAISE(ABORT, 'local inspection quarantines are append-only'); END;
    `);
    const columns = await this.#database.getAllAsync<{ name: string }>(
      "PRAGMA table_info(local_inspection_snapshots)",
    );
    if (!columns.some((column) => column.name === "job_id")) {
      await this.#database.execAsync(
        "ALTER TABLE local_inspection_snapshots ADD COLUMN job_id TEXT",
      );
    }
    await this.#backfillLegacyJobIds();
    await this.#database.execAsync(`
      CREATE INDEX IF NOT EXISTS local_inspection_snapshots_job
      ON local_inspection_snapshots (aggregate_kind, job_id, aggregate_id);
    `);
  }

  async readSnapshot(
    aggregateKind: "coverage" | "investigation",
    aggregateId: string,
  ): Promise<LocalInspectionSnapshotRecord | null> {
    const row = await this.#database.getFirstAsync<SnapshotRow>(
      `SELECT aggregate_kind, aggregate_id, aggregate_revision, job_id, schema_version,
              snapshot_json, snapshot_sha256, updated_at
       FROM local_inspection_snapshots
       WHERE aggregate_kind = ? AND aggregate_id = ?`,
      aggregateKind,
      aggregateId,
    );
    return row === null ? null : mapSnapshotRow(row);
  }

  async listSnapshotsForJob(
    aggregateKind: "coverage" | "investigation",
    jobId: string,
  ): Promise<readonly LocalInspectionSnapshotRecord[]> {
    const rows = await this.#database.getAllAsync<SnapshotRow>(
      `SELECT aggregate_kind, aggregate_id, aggregate_revision, job_id, schema_version,
              snapshot_json, snapshot_sha256, updated_at
       FROM local_inspection_snapshots
       WHERE aggregate_kind = ? AND job_id = ?
       ORDER BY aggregate_id ASC`,
      aggregateKind,
      jobId,
    );
    return rows.map(mapSnapshotRow);
  }

  async readEventHistory(
    aggregateKind: "coverage" | "investigation",
    aggregateId: string,
  ): Promise<
    readonly Readonly<{
      aggregateRevision: number;
      snapshotSha256: string;
    }>[]
  > {
    const rows = await this.#database.getAllAsync<{
      aggregate_revision: number;
      snapshot_sha256: string;
    }>(
      `SELECT aggregate_revision, snapshot_sha256
       FROM local_inspection_events
       WHERE aggregate_kind = ? AND aggregate_id = ?
       ORDER BY aggregate_revision ASC`,
      aggregateKind,
      aggregateId,
    );
    return rows.map((row) => ({
      aggregateRevision: row.aggregate_revision,
      snapshotSha256: row.snapshot_sha256,
    }));
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
           aggregate_kind, aggregate_id, aggregate_revision, job_id, schema_version,
           snapshot_json, snapshot_sha256, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (aggregate_kind, aggregate_id) DO UPDATE SET
           aggregate_revision = excluded.aggregate_revision,
           job_id = excluded.job_id,
           schema_version = excluded.schema_version,
           snapshot_json = excluded.snapshot_json,
           snapshot_sha256 = excluded.snapshot_sha256,
           updated_at = excluded.updated_at`,
        input.snapshot.aggregateKind,
        input.snapshot.aggregateId,
        input.snapshot.aggregateRevision,
        input.snapshot.jobId,
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

  async #backfillLegacyJobIds(): Promise<void> {
    const rows = await this.#database.getAllAsync<
      Pick<SnapshotRow, "aggregate_id" | "aggregate_kind" | "snapshot_json">
    >(
      `SELECT aggregate_kind, aggregate_id, snapshot_json
       FROM local_inspection_snapshots
       WHERE job_id IS NULL
       ORDER BY aggregate_kind, aggregate_id`,
    );
    for (const row of rows) {
      const jobId = legacyJobId(row.snapshot_json);
      if (jobId === null) {
        await this.#database.runAsync(
          `INSERT OR IGNORE INTO local_inspection_snapshot_quarantines (
             aggregate_kind, aggregate_id, reason, quarantined_at
           ) VALUES (?, ?, ?, ?)`,
          row.aggregate_kind,
          row.aggregate_id,
          "legacy_job_identity_unreadable",
          new Date().toISOString(),
        );
        continue;
      }
      await this.#database.runAsync(
        `UPDATE local_inspection_snapshots
         SET job_id = ?
         WHERE aggregate_kind = ? AND aggregate_id = ? AND job_id IS NULL`,
        jobId,
        row.aggregate_kind,
        row.aggregate_id,
      );
    }
  }
}

function mapSnapshotRow(row: SnapshotRow): LocalInspectionSnapshotRecord {
  return {
    aggregateId: row.aggregate_id,
    aggregateKind: row.aggregate_kind,
    aggregateRevision: row.aggregate_revision,
    jobId: row.job_id,
    schemaVersion: row.schema_version,
    snapshotJson: row.snapshot_json,
    snapshotSha256: row.snapshot_sha256,
    updatedAt: row.updated_at,
  };
}

export function legacyJobId(snapshotJson: string): string | null {
  try {
    const parsed = JSON.parse(snapshotJson) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const jobId = (parsed as Record<string, unknown>).jobId;
    return typeof jobId === "string" && isSafeJobId(jobId) ? jobId : null;
  } catch {
    return null;
  }
}

function isSafeJobId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}
