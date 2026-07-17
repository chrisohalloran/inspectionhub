import type {
  CaptureIntent,
  CaptureIntentState,
  CaptureQueueItem,
  CapturePerformanceSample,
  DurableArtifact,
  FieldSessionSnapshot,
  LocalCaptureEvent,
  ManualNote,
  QueueLane,
} from "../capture/types";
import { transitionQueueState, type QueueEvent } from "../sync/queue-machine";
import {
  cloneFieldSession,
  parseFieldSession,
  parseFieldWorkflow,
} from "./field-workflow";
import type { CaptureLedger } from "./ports";

export type SQLiteValue = null | number | string;

export interface SQLiteCaptureConnection {
  execAsync(source: string): Promise<void>;
  getAllAsync<T>(
    source: string,
    ...params: readonly SQLiteValue[]
  ): Promise<T[]>;
  getFirstAsync<T>(
    source: string,
    ...params: readonly SQLiteValue[]
  ): Promise<T | null>;
  runAsync(source: string, ...params: readonly SQLiteValue[]): Promise<unknown>;
  withExclusiveTransactionAsync(
    task: (transaction: SQLiteCaptureConnection) => Promise<void>,
  ): Promise<void>;
}

export const captureLedgerSchemaSql = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS capture_intents (
  capture_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  device_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('photo', 'voice')),
  evidence_role TEXT NOT NULL CHECK (evidence_role = 'private_coverage'),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  state TEXT NOT NULL CHECK (state IN ('pending', 'durable', 'acknowledged', 'quarantined', 'failed', 'evidence_at_risk')),
  failure_code TEXT,
  UNIQUE(job_id, device_id, sequence)
);

CREATE TABLE IF NOT EXISTS capture_artifacts (
  capture_id TEXT PRIMARY KEY REFERENCES capture_intents(capture_id),
  file_uri TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  byte_length INTEGER NOT NULL CHECK (byte_length > 0),
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  directory_sync TEXT NOT NULL CHECK (directory_sync = 'synced'),
  queue_lane TEXT NOT NULL CHECK (queue_lane IN ('photo_upload', 'voice_upload'))
);

-- Separate acknowledgement receipts keep upgrades compatible with the first
-- launch schema whose capture_intents CHECK predated the acknowledged state.
CREATE TABLE IF NOT EXISTS capture_acknowledgements (
  capture_id TEXT PRIMARY KEY REFERENCES capture_intents(capture_id),
  acknowledged_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS capture_acknowledgements_no_update
BEFORE UPDATE ON capture_acknowledgements
BEGIN SELECT RAISE(ABORT, 'capture acknowledgements are append-only'); END;

CREATE TRIGGER IF NOT EXISTS capture_acknowledgements_no_delete
BEFORE DELETE ON capture_acknowledgements
BEGIN SELECT RAISE(ABORT, 'capture acknowledgements are append-only'); END;

CREATE TABLE IF NOT EXISTS capture_queue (
  capture_id TEXT PRIMARY KEY,
  lane TEXT NOT NULL CHECK (lane IN ('photo_upload', 'voice_upload', 'manual_note_sync')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'uploading', 'blocked_session', 'blocked_revoked', 'failed', 'server_durable'))
);

CREATE TABLE IF NOT EXISTS manual_notes (
  note_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  note_text TEXT NOT NULL CHECK (length(trim(note_text)) > 0)
);

CREATE TABLE IF NOT EXISTS local_capture_events (
  ordinal INTEGER PRIMARY KEY,
  capture_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('capture_intent_reserved', 'artifact_committed', 'capture_intent_state_changed', 'manual_note_recorded', 'queue_enqueued', 'queue_state_changed')),
  code TEXT
);

CREATE TRIGGER IF NOT EXISTS local_capture_events_no_update
BEFORE UPDATE ON local_capture_events
BEGIN SELECT RAISE(ABORT, 'local capture events are append-only'); END;

CREATE TRIGGER IF NOT EXISTS local_capture_events_no_delete
BEFORE DELETE ON local_capture_events
BEGIN SELECT RAISE(ABORT, 'local capture events are append-only'); END;

CREATE TABLE IF NOT EXISTS capture_performance_samples (
  capture_id TEXT PRIMARY KEY REFERENCES capture_intents(capture_id),
  kind TEXT NOT NULL CHECK (kind IN ('photo', 'voice')),
  interaction_type TEXT NOT NULL CHECK (interaction_type IN ('shutter_acknowledgement', 'voice_start')),
  interaction_latency_ms REAL NOT NULL CHECK (interaction_latency_ms >= 0),
  local_durable_save_ms REAL NOT NULL CHECK (local_durable_save_ms >= 0),
  recorded_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS capture_performance_samples_no_update
BEFORE UPDATE ON capture_performance_samples
BEGIN SELECT RAISE(ABORT, 'capture performance samples are append-only'); END;

CREATE TRIGGER IF NOT EXISTS capture_performance_samples_no_delete
BEFORE DELETE ON capture_performance_samples
BEGIN SELECT RAISE(ABORT, 'capture performance samples are append-only'); END;

CREATE TABLE IF NOT EXISTS field_session (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  snapshot_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS field_workflow_events (
  job_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  transition_type TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  workflow_json TEXT NOT NULL,
  PRIMARY KEY (job_id, revision)
);

CREATE TRIGGER IF NOT EXISTS field_workflow_events_no_update
BEFORE UPDATE ON field_workflow_events
BEGIN SELECT RAISE(ABORT, 'field workflow events are append-only'); END;

CREATE TRIGGER IF NOT EXISTS field_workflow_events_no_delete
BEFORE DELETE ON field_workflow_events
BEGIN SELECT RAISE(ABORT, 'field workflow events are append-only'); END;
`;

type IntentRow = {
  area_id: string;
  capture_id: string;
  captured_at: string;
  device_id: string;
  evidence_role: "private_coverage";
  failure_code: string | null;
  job_id: string;
  kind: "photo" | "voice";
  sequence: number;
  state: CaptureIntentState;
};

type ArtifactRow = {
  byte_length: number;
  capture_id: string;
  directory_sync: "synced";
  file_uri: string;
  immutable: 1;
  queue_lane: "photo_upload" | "voice_upload";
  sha256: string;
};

type AcknowledgementRow = {
  capture_id: string;
};

type QueueRow = {
  capture_id: string;
  lane: QueueLane;
  state: CaptureQueueItem["state"];
};

type EventRow = {
  capture_id: string;
  code: string | null;
  event_type: LocalCaptureEvent["type"];
  ordinal: number;
};

type PerformanceSampleRow = {
  capture_id: string;
  interaction_latency_ms: number;
  interaction_type: CapturePerformanceSample["interactionType"];
  kind: CapturePerformanceSample["kind"];
  local_durable_save_ms: number;
  recorded_at: string;
};

type FieldWorkflowEventRow = {
  job_id: string;
  revision: number;
  transition_type: string;
  workflow_json: string;
};

function cloneIntent(value: CaptureIntent): CaptureIntent {
  return { ...value };
}

function cloneArtifact(value: DurableArtifact): DurableArtifact {
  return { ...value };
}

function cloneQueue(value: CaptureQueueItem): CaptureQueueItem {
  return { ...value };
}

function assertArtifact(artifact: DurableArtifact): void {
  if (
    !artifact.immutable ||
    artifact.directorySync !== "synced" ||
    artifact.byteLength <= 0 ||
    !/^[a-f0-9]{64}$/u.test(artifact.sha256) ||
    !artifact.fileUri.startsWith("file://")
  ) {
    throw new Error("Durable artifact identity is invalid");
  }
}

function parseSession(value: string): FieldSessionSnapshot {
  return parseFieldSession(JSON.parse(value) as unknown);
}

export class SQLiteCaptureLedger implements CaptureLedger {
  readonly #database: SQLiteCaptureConnection;
  readonly #artifacts = new Map<string, DurableArtifact>();
  readonly #events: LocalCaptureEvent[] = [];
  readonly #intents = new Map<string, CaptureIntent>();
  readonly #performanceSamples = new Map<string, CapturePerformanceSample>();
  readonly #queue = new Map<string, CaptureQueueItem>();
  #fieldSession: FieldSessionSnapshot | undefined;

  constructor(database: SQLiteCaptureConnection) {
    this.#database = database;
  }

  async hydrate(): Promise<void> {
    const [
      intents,
      artifacts,
      acknowledgements,
      queue,
      events,
      performanceSamples,
      sessions,
      workflowEvents,
    ] = await Promise.all([
      this.#database.getAllAsync<IntentRow>(
        "SELECT * FROM capture_intents ORDER BY capture_id",
      ),
      this.#database.getAllAsync<ArtifactRow>(
        "SELECT * FROM capture_artifacts ORDER BY capture_id",
      ),
      this.#database.getAllAsync<AcknowledgementRow>(
        "SELECT capture_id FROM capture_acknowledgements ORDER BY capture_id",
      ),
      this.#database.getAllAsync<QueueRow>(
        "SELECT * FROM capture_queue ORDER BY capture_id",
      ),
      this.#database.getAllAsync<EventRow>(
        "SELECT * FROM local_capture_events ORDER BY ordinal",
      ),
      this.#database.getAllAsync<PerformanceSampleRow>(
        "SELECT * FROM capture_performance_samples ORDER BY recorded_at, capture_id",
      ),
      this.#database.getAllAsync<{ snapshot_json: string }>(
        "SELECT snapshot_json FROM field_session WHERE singleton = 1",
      ),
      this.#database.getAllAsync<FieldWorkflowEventRow>(
        "SELECT job_id, revision, transition_type, workflow_json FROM field_workflow_events ORDER BY job_id, revision",
      ),
    ]);
    const acknowledgedCaptureIds = new Set(
      acknowledgements.map((row) => row.capture_id),
    );
    for (const row of intents) {
      const value: CaptureIntent = {
        areaId: row.area_id,
        captureId: row.capture_id,
        capturedAt: row.captured_at,
        deviceId: row.device_id,
        evidenceRole: row.evidence_role,
        jobId: row.job_id,
        kind: row.kind,
        sequence: row.sequence,
        state: acknowledgedCaptureIds.has(row.capture_id)
          ? "acknowledged"
          : row.state,
        ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
      };
      this.#intents.set(value.captureId, value);
    }
    for (const row of artifacts) {
      this.#artifacts.set(row.capture_id, {
        byteLength: row.byte_length,
        captureId: row.capture_id,
        directorySync: row.directory_sync,
        fileUri: row.file_uri,
        immutable: true,
        queueLane: row.queue_lane,
        sha256: row.sha256,
      });
    }
    for (const row of queue) {
      this.#queue.set(row.capture_id, {
        captureId: row.capture_id,
        lane: row.lane,
        state: row.state,
      });
    }
    this.#events.push(
      ...events.map((row) => ({
        captureId: row.capture_id,
        ordinal: row.ordinal,
        type: row.event_type,
        ...(row.code === null ? {} : { code: row.code }),
      })),
    );
    for (const row of performanceSamples) {
      this.#performanceSamples.set(row.capture_id, {
        captureId: row.capture_id,
        interactionLatencyMs: row.interaction_latency_ms,
        interactionType: row.interaction_type,
        kind: row.kind,
        localDurableSaveMs: row.local_durable_save_ms,
        recordedAt: row.recorded_at,
      });
    }
    const session = sessions[0];
    if (session !== undefined) {
      this.#fieldSession = parseSession(session.snapshot_json);
      const workflow = this.#fieldSession.workflow;
      const latestEvent = workflowEvents
        .filter((event) => event.job_id === this.#fieldSession?.jobId)
        .at(-1);
      if (latestEvent !== undefined) {
        const eventWorkflow = parseFieldWorkflow(
          JSON.parse(latestEvent.workflow_json) as unknown,
        );
        if (
          workflow === undefined ||
          latestEvent.revision !== workflow.revision ||
          latestEvent.transition_type !== workflow.lastTransition ||
          JSON.stringify(eventWorkflow) !== JSON.stringify(workflow)
        ) {
          throw new Error(
            "Stored field workflow does not match its append-only event head",
          );
        }
      }
    }
  }

  async #appendEvent(
    transaction: SQLiteCaptureConnection,
    event: Omit<LocalCaptureEvent, "ordinal">,
  ): Promise<LocalCaptureEvent> {
    const next = await transaction.getFirstAsync<{ nextOrdinal: number }>(
      "SELECT COALESCE(MAX(ordinal), 0) + 1 AS nextOrdinal FROM local_capture_events",
    );
    const ordinal = next?.nextOrdinal;
    if (ordinal === undefined) {
      throw new Error("Could not allocate local event ordinal");
    }
    await transaction.runAsync(
      "INSERT INTO local_capture_events (ordinal, capture_id, event_type, code) VALUES (?, ?, ?, ?)",
      ordinal,
      event.captureId,
      event.type,
      event.code ?? null,
    );
    return { ...event, ordinal };
  }

  async beginIntent(intent: CaptureIntent): Promise<void> {
    if (this.#intents.has(intent.captureId)) {
      throw new Error(`Capture identity already reserved: ${intent.captureId}`);
    }
    let event: LocalCaptureEvent | undefined;
    await this.#database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        "INSERT INTO capture_intents (capture_id, job_id, area_id, captured_at, device_id, kind, evidence_role, sequence, state, failure_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        intent.captureId,
        intent.jobId,
        intent.areaId,
        intent.capturedAt,
        intent.deviceId,
        intent.kind,
        intent.evidenceRole,
        intent.sequence,
        intent.state,
        intent.failureCode ?? null,
      );
      event = await this.#appendEvent(transaction, {
        captureId: intent.captureId,
        type: "capture_intent_reserved",
      });
    });
    this.#intents.set(intent.captureId, cloneIntent(intent));
    if (event !== undefined) this.#events.push(event);
  }

  async commitDurableCapture(
    captureId: string,
    artifact: DurableArtifact,
  ): Promise<void> {
    const intent = this.#intents.get(captureId);
    if (intent === undefined)
      throw new Error(`Capture intent not found: ${captureId}`);
    if (artifact.captureId !== captureId)
      throw new Error("Artifact identity does not match its capture intent");
    assertArtifact(artifact);
    const existing = this.#artifacts.get(captureId);
    if (existing !== undefined) {
      if (JSON.stringify(existing) === JSON.stringify(artifact)) return;
      throw new Error(`Conflicting durable artifact identity: ${captureId}`);
    }

    const appended: LocalCaptureEvent[] = [];
    await this.#database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        "INSERT INTO capture_artifacts (capture_id, file_uri, sha256, byte_length, immutable, directory_sync, queue_lane) VALUES (?, ?, ?, ?, 1, ?, ?)",
        captureId,
        artifact.fileUri,
        artifact.sha256,
        artifact.byteLength,
        artifact.directorySync,
        artifact.queueLane,
      );
      await transaction.runAsync(
        "INSERT INTO capture_queue (capture_id, lane, state) VALUES (?, ?, 'pending')",
        captureId,
        artifact.queueLane,
      );
      await transaction.runAsync(
        "UPDATE capture_intents SET state = 'durable', failure_code = NULL WHERE capture_id = ?",
        captureId,
      );
      appended.push(
        await this.#appendEvent(transaction, {
          captureId,
          type: "artifact_committed",
        }),
      );
      appended.push(
        await this.#appendEvent(transaction, {
          captureId,
          type: "queue_enqueued",
        }),
      );
    });
    this.#artifacts.set(captureId, cloneArtifact(artifact));
    this.#queue.set(captureId, {
      captureId,
      lane: artifact.queueLane,
      state: "pending",
    });
    this.#intents.set(captureId, { ...intent, state: "durable" });
    this.#events.push(...appended);
  }

  getArtifact(captureId: string): DurableArtifact | undefined {
    const value = this.#artifacts.get(captureId);
    return value === undefined ? undefined : cloneArtifact(value);
  }

  getFieldSession(): FieldSessionSnapshot | undefined {
    return this.#fieldSession === undefined
      ? undefined
      : cloneFieldSession(this.#fieldSession);
  }

  getIntent(captureId: string): CaptureIntent | undefined {
    const value = this.#intents.get(captureId);
    return value === undefined ? undefined : cloneIntent(value);
  }

  getQueue(captureId: string): CaptureQueueItem | undefined {
    const value = this.#queue.get(captureId);
    return value === undefined ? undefined : cloneQueue(value);
  }

  listArtifacts(): readonly DurableArtifact[] {
    return [...this.#artifacts.values()].map(cloneArtifact);
  }

  listEvents(): readonly LocalCaptureEvent[] {
    return this.#events.map((value) => ({ ...value }));
  }

  listIntents(): readonly CaptureIntent[] {
    return [...this.#intents.values()].map(cloneIntent);
  }

  listPerformanceSamples(): readonly CapturePerformanceSample[] {
    return [...this.#performanceSamples.values()].map((sample) => ({
      ...sample,
    }));
  }

  listQueue(lane?: QueueLane): readonly CaptureQueueItem[] {
    return [...this.#queue.values()]
      .filter((value) => lane === undefined || value.lane === lane)
      .map(cloneQueue);
  }

  async applyQueueEvent(captureId: string, event: QueueEvent): Promise<void> {
    const current = this.#queue.get(captureId);
    if (current === undefined)
      throw new Error(`Capture queue item not found: ${captureId}`);
    const state = transitionQueueState(current.state, event);
    let appended: LocalCaptureEvent | undefined;
    await this.#database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        "UPDATE capture_queue SET state = ? WHERE capture_id = ?",
        state,
        captureId,
      );
      appended = await this.#appendEvent(transaction, {
        captureId,
        code: event,
        type: "queue_state_changed",
      });
    });
    this.#queue.set(captureId, { ...current, state });
    if (appended !== undefined) this.#events.push(appended);
  }

  async markIntent(
    captureId: string,
    state: CaptureIntentState,
    failureCode?: string,
  ): Promise<void> {
    const current = this.#intents.get(captureId);
    if (current === undefined)
      throw new Error(`Capture intent not found: ${captureId}`);
    let appended: LocalCaptureEvent | undefined;
    await this.#database.withExclusiveTransactionAsync(async (transaction) => {
      if (state === "acknowledged") {
        await transaction.runAsync(
          "INSERT OR IGNORE INTO capture_acknowledgements (capture_id, acknowledged_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
          captureId,
        );
      } else {
        await transaction.runAsync(
          "UPDATE capture_intents SET state = ?, failure_code = ? WHERE capture_id = ?",
          state,
          failureCode ?? null,
          captureId,
        );
      }
      appended = await this.#appendEvent(transaction, {
        captureId,
        ...(failureCode === undefined ? {} : { code: failureCode }),
        type: "capture_intent_state_changed",
      });
    });
    this.#intents.set(captureId, {
      ...current,
      state,
      ...(failureCode === undefined ? {} : { failureCode }),
    });
    if (appended !== undefined) this.#events.push(appended);
  }

  async recordManualNote(note: ManualNote): Promise<void> {
    if (note.text.trim().length === 0)
      throw new Error("Manual note text is required");
    const appended: LocalCaptureEvent[] = [];
    await this.#database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        "INSERT INTO manual_notes (note_id, job_id, area_id, recorded_at, note_text) VALUES (?, ?, ?, ?, ?)",
        note.noteId,
        note.jobId,
        note.areaId,
        note.recordedAt,
        note.text,
      );
      await transaction.runAsync(
        "INSERT INTO capture_queue (capture_id, lane, state) VALUES (?, 'manual_note_sync', 'pending')",
        note.noteId,
      );
      appended.push(
        await this.#appendEvent(transaction, {
          captureId: note.noteId,
          type: "manual_note_recorded",
        }),
      );
      appended.push(
        await this.#appendEvent(transaction, {
          captureId: note.noteId,
          type: "queue_enqueued",
        }),
      );
    });
    this.#queue.set(note.noteId, {
      captureId: note.noteId,
      lane: "manual_note_sync",
      state: "pending",
    });
    this.#events.push(...appended);
  }

  async recordPerformanceSample(
    sample: CapturePerformanceSample,
  ): Promise<void> {
    if (
      sample.interactionLatencyMs < 0 ||
      sample.localDurableSaveMs < 0 ||
      !Number.isFinite(sample.interactionLatencyMs) ||
      !Number.isFinite(sample.localDurableSaveMs)
    ) {
      throw new Error(
        "Capture performance sample must contain finite non-negative latency",
      );
    }
    if (this.#performanceSamples.has(sample.captureId)) {
      throw new Error(
        `Capture performance sample already exists: ${sample.captureId}`,
      );
    }
    await this.#database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        "INSERT INTO capture_performance_samples (capture_id, kind, interaction_type, interaction_latency_ms, local_durable_save_ms, recorded_at) VALUES (?, ?, ?, ?, ?, ?)",
        sample.captureId,
        sample.kind,
        sample.interactionType,
        sample.interactionLatencyMs,
        sample.localDurableSaveMs,
        sample.recordedAt,
      );
    });
    this.#performanceSamples.set(sample.captureId, { ...sample });
  }

  async saveFieldSession(snapshot: FieldSessionSnapshot): Promise<void> {
    const validated = parseFieldSession(snapshot);
    const currentWorkflow = this.#fieldSession?.workflow;
    const nextWorkflow = validated.workflow;
    if (currentWorkflow !== undefined && nextWorkflow === undefined) {
      throw new Error("A protected field workflow cannot be removed");
    }
    const workflowChanged =
      nextWorkflow !== undefined &&
      currentWorkflow?.revision !== nextWorkflow.revision;
    if (
      currentWorkflow !== undefined &&
      nextWorkflow !== undefined &&
      ((workflowChanged &&
        nextWorkflow.revision !== currentWorkflow.revision + 1) ||
        (!workflowChanged &&
          JSON.stringify(nextWorkflow) !== JSON.stringify(currentWorkflow)))
    ) {
      throw new Error(
        "Field workflow transitions must append exactly one immutable revision",
      );
    }
    const serialised = JSON.stringify(validated);
    await this.#database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        "INSERT INTO field_session (singleton, snapshot_json) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET snapshot_json = excluded.snapshot_json",
        serialised,
      );
      if (workflowChanged && nextWorkflow !== undefined) {
        await transaction.runAsync(
          "INSERT INTO field_workflow_events (job_id, revision, transition_type, recorded_at, workflow_json) VALUES (?, ?, ?, ?, ?)",
          validated.jobId,
          nextWorkflow.revision,
          nextWorkflow.lastTransition,
          nextWorkflow.updatedAt,
          JSON.stringify(nextWorkflow),
        );
      }
    });
    this.#fieldSession = cloneFieldSession(validated);
  }
}

export async function createSQLiteCaptureLedger(
  database: SQLiteCaptureConnection,
): Promise<SQLiteCaptureLedger> {
  await database.execAsync(captureLedgerSchemaSql);
  const ledger = new SQLiteCaptureLedger(database);
  await ledger.hydrate();
  return ledger;
}
