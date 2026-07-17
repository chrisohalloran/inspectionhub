import { describe, expect, it } from "vitest";

import {
  legacyJobId,
  SqliteInspectionSnapshotPort,
} from "./sqlite-inspection-snapshot-port";

describe("legacy local inspection snapshot metadata", () => {
  it("extracts only an explicit non-empty job identity for indexed backfill", () => {
    expect(legacyJobId(JSON.stringify({ jobId: "job-1" }))).toBe("job-1");
    expect(legacyJobId(JSON.stringify({ jobId: "" }))).toBeNull();
    expect(legacyJobId(JSON.stringify({ jobId: " job-1 " }))).toBeNull();
    expect(
      legacyJobId(JSON.stringify({ jobId: "job/../../other" })),
    ).toBeNull();
    expect(legacyJobId(JSON.stringify({ jobId: "x".repeat(129) }))).toBeNull();
    expect(legacyJobId(JSON.stringify({ jobId: 42 }))).toBeNull();
    expect(legacyJobId("not-json")).toBeNull();
  });

  it("backfills safe legacy job identities and quarantines unreadable rows", async () => {
    const database = new RecordingInspectionSQLite([
      row(
        "coverage",
        "coverage-good",
        null,
        JSON.stringify({ jobId: "job-1" }),
      ),
      row("investigation", "investigation-bad", null, "not-json"),
    ]);
    database.columns = ["aggregate_kind", "aggregate_id"];
    const port = new SqliteInspectionSnapshotPort(database as never);

    await port.initialise();

    expect(database.execs.join("\n")).toContain(
      "ALTER TABLE local_inspection_snapshots ADD COLUMN job_id TEXT",
    );
    expect(database.rows[0]?.job_id).toBe("job-1");
    expect(database.quarantines).toEqual([
      {
        aggregateId: "investigation-bad",
        aggregateKind: "investigation",
        reason: "legacy_job_identity_unreadable",
      },
    ]);
  });

  it("lists only the requested job and maps the indexed identity", async () => {
    const database = new RecordingInspectionSQLite([
      row(
        "coverage",
        "coverage-1",
        "job-1",
        JSON.stringify({ jobId: "job-1" }),
      ),
      row(
        "coverage",
        "coverage-2",
        "job-2",
        JSON.stringify({ jobId: "job-2" }),
      ),
    ]);
    const port = new SqliteInspectionSnapshotPort(database as never);

    await expect(
      port.listSnapshotsForJob("coverage", "job-1"),
    ).resolves.toEqual([
      expect.objectContaining({ aggregateId: "coverage-1", jobId: "job-1" }),
    ]);
    expect(database.lastListParams).toEqual(["coverage", "job-1"]);
  });

  it("atomically writes the snapshot and event or returns a revision conflict", async () => {
    const database = new RecordingInspectionSQLite([]);
    const port = new SqliteInspectionSnapshotPort(database as never);
    const snapshot = {
      aggregateId: "coverage-1",
      aggregateKind: "coverage" as const,
      aggregateRevision: 1,
      jobId: "job-1",
      schemaVersion: 1 as const,
      snapshotJson: JSON.stringify({ jobId: "job-1", revision: 1 }),
      snapshotSha256: "a".repeat(64),
      updatedAt: "2026-07-17T08:00:00.000Z",
    };
    const event = {
      aggregateId: "coverage-1",
      aggregateKind: "coverage" as const,
      aggregateRevision: 1,
      eventId: "event-1",
      eventType: "area.coverage_recorded" as const,
      occurredAt: snapshot.updatedAt,
      safeMetadataJson: "{}",
      snapshotSha256: snapshot.snapshotSha256,
    };

    await expect(
      port.compareAndSet({ expectedStoredRevision: null, event, snapshot }),
    ).resolves.toBe("saved");
    expect(database.transactionCount).toBe(1);
    expect(database.rows).toEqual([
      expect.objectContaining({
        aggregate_id: "coverage-1",
        aggregate_revision: 1,
        job_id: "job-1",
      }),
    ]);
    expect(database.events).toEqual([
      expect.objectContaining({ eventId: "event-1", aggregateRevision: 1 }),
    ]);

    await expect(
      port.compareAndSet({ expectedStoredRevision: null, event, snapshot }),
    ).resolves.toBe("revision_conflict");
    expect(database.events).toHaveLength(1);
  });
});

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

class RecordingInspectionSQLite {
  columns = ["aggregate_kind", "aggregate_id", "job_id"];
  readonly execs: string[] = [];
  readonly events: Array<{ eventId: string; aggregateRevision: number }> = [];
  lastListParams: unknown[] = [];
  readonly quarantines: Array<{
    aggregateId: string;
    aggregateKind: string;
    reason: string;
  }> = [];
  transactionCount = 0;

  constructor(readonly rows: SnapshotRow[]) {}

  execAsync(sql: string): Promise<void> {
    this.execs.push(sql);
    return Promise.resolve();
  }

  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    if (sql.includes("PRAGMA table_info")) {
      return Promise.resolve(this.columns.map((name) => ({ name })) as T[]);
    }
    if (sql.includes("WHERE job_id IS NULL")) {
      return Promise.resolve(
        this.rows
          .filter((item) => item.job_id === null)
          .map((item) => ({
            aggregate_id: item.aggregate_id,
            aggregate_kind: item.aggregate_kind,
            snapshot_json: item.snapshot_json,
          })) as T[],
      );
    }
    if (sql.includes("WHERE aggregate_kind = ? AND job_id = ?")) {
      this.lastListParams = params;
      return Promise.resolve(
        this.rows.filter(
          (item) =>
            item.aggregate_kind === params[0] && item.job_id === params[1],
        ) as T[],
      );
    }
    return Promise.resolve([]);
  }

  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
    if (sql.includes("SELECT aggregate_revision FROM")) {
      const current = this.rows.find(
        (item) =>
          item.aggregate_kind === params[0] && item.aggregate_id === params[1],
      );
      return Promise.resolve(
        (current === undefined
          ? null
          : { aggregate_revision: current.aggregate_revision }) as T | null,
      );
    }
    const current = this.rows.find(
      (item) =>
        item.aggregate_kind === params[0] && item.aggregate_id === params[1],
    );
    return Promise.resolve((current ?? null) as T | null);
  }

  runAsync(sql: string, ...params: unknown[]): Promise<unknown> {
    if (
      sql.includes(
        "INSERT OR IGNORE INTO local_inspection_snapshot_quarantines",
      )
    ) {
      this.quarantines.push({
        aggregateKind: String(params[0]),
        aggregateId: String(params[1]),
        reason: String(params[2]),
      });
    } else if (sql.includes("UPDATE local_inspection_snapshots")) {
      const current = this.rows.find(
        (item) =>
          item.aggregate_kind === params[1] && item.aggregate_id === params[2],
      );
      if (current?.job_id === null) current.job_id = String(params[0]);
    } else if (sql.includes("INSERT INTO local_inspection_snapshots")) {
      const next = row(
        params[0] as SnapshotRow["aggregate_kind"],
        String(params[1]),
        String(params[3]),
        String(params[5]),
        Number(params[2]),
        String(params[6]),
        String(params[7]),
      );
      const index = this.rows.findIndex(
        (item) =>
          item.aggregate_kind === next.aggregate_kind &&
          item.aggregate_id === next.aggregate_id,
      );
      if (index === -1) this.rows.push(next);
      else this.rows[index] = next;
    } else if (sql.includes("INSERT INTO local_inspection_events")) {
      this.events.push({
        eventId: String(params[0]),
        aggregateRevision: Number(params[3]),
      });
    }
    return Promise.resolve({ changes: 1 });
  }

  async withExclusiveTransactionAsync(
    task: (database: RecordingInspectionSQLite) => Promise<void>,
  ): Promise<void> {
    this.transactionCount += 1;
    await task(this);
  }
}

function row(
  aggregateKind: SnapshotRow["aggregate_kind"],
  aggregateId: string,
  jobId: string | null,
  snapshotJson: string,
  aggregateRevision = 0,
  snapshotSha256 = "a".repeat(64),
  updatedAt = "2026-07-17T08:00:00.000Z",
): SnapshotRow {
  return {
    aggregate_id: aggregateId,
    aggregate_kind: aggregateKind,
    aggregate_revision: aggregateRevision,
    job_id: jobId,
    schema_version: 1,
    snapshot_json: snapshotJson,
    snapshot_sha256: snapshotSha256,
    updated_at: updatedAt,
  };
}
