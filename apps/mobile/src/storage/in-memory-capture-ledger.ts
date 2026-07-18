import type {
  CaptureIntent,
  CaptureIntentState,
  CaptureQueueItem,
  CapturePerformanceSample,
  DurableArtifact,
  FieldSessionSnapshot,
  LocalCaptureEvent,
  ManualNote,
  ManualNoteDigest,
  QueueLane,
} from "../capture/types";
import { assertManualNoteIdentity } from "../capture/manual-note-content";
import { transitionQueueState, type QueueEvent } from "../sync/queue-machine";
import { cloneFieldSession, parseFieldSession } from "./field-workflow";
import type { CaptureLedger } from "./ports";

type InMemoryCaptureLedgerOptions = {
  failNextCommit?: boolean;
  manualNoteDigest?: ManualNoteDigest;
};

function cloneIntent(intent: CaptureIntent): CaptureIntent {
  return { ...intent };
}

function cloneArtifact(artifact: DurableArtifact): DurableArtifact {
  return { ...artifact };
}

function cloneQueueItem(item: CaptureQueueItem): CaptureQueueItem {
  return { ...item };
}

function cloneManualNote(note: ManualNote): ManualNote {
  return { ...note };
}

function assertArtifactIdentity(artifact: DurableArtifact): void {
  if (!artifact.immutable) {
    throw new Error("Capture artifact must be immutable");
  }
  if (artifact.byteLength <= 0) {
    throw new Error("Capture artifact must contain bytes");
  }
  if (!/^[a-f0-9]{64}$/u.test(artifact.sha256)) {
    throw new Error("Capture artifact must have a lowercase SHA-256 identity");
  }
  if (!artifact.fileUri.startsWith("file://")) {
    throw new Error("Capture artifact must use an app-owned file URI");
  }
}

/**
 * Deterministic SQLite contract fake. `commitDurableCapture` models one SQLite
 * transaction: artifact, upload queue, and durable intent state appear together
 * or none of them do.
 */
export class InMemoryCaptureLedger implements CaptureLedger {
  readonly #artifacts = new Map<string, DurableArtifact>();
  readonly #events: LocalCaptureEvent[] = [];
  readonly #intents = new Map<string, CaptureIntent>();
  readonly #manualNotes = new Map<string, ManualNote>();
  readonly #performanceSamples = new Map<string, CapturePerformanceSample>();
  readonly #queue = new Map<string, CaptureQueueItem>();
  #fieldSession: FieldSessionSnapshot | undefined;
  #failNextCommit: boolean;
  readonly #manualNoteDigest: ManualNoteDigest | undefined;

  constructor(options: InMemoryCaptureLedgerOptions = {}) {
    this.#failNextCommit = options.failNextCommit ?? false;
    this.#manualNoteDigest = options.manualNoteDigest;
  }

  #appendEvent(event: Omit<LocalCaptureEvent, "ordinal">): void {
    this.#events.push({ ...event, ordinal: this.#events.length + 1 });
  }

  beginIntent(intent: CaptureIntent): Promise<void> {
    if (this.#intents.has(intent.captureId)) {
      throw new Error(`Capture identity already reserved: ${intent.captureId}`);
    }
    this.#intents.set(intent.captureId, cloneIntent(intent));
    this.#appendEvent({
      captureId: intent.captureId,
      type: "capture_intent_reserved",
    });
    return Promise.resolve();
  }

  commitDurableCapture(
    captureId: string,
    artifact: DurableArtifact,
  ): Promise<void> {
    const intent = this.#intents.get(captureId);
    if (intent === undefined) {
      throw new Error(`Capture intent not found: ${captureId}`);
    }
    if (artifact.captureId !== captureId) {
      throw new Error("Artifact identity does not match its capture intent");
    }
    assertArtifactIdentity(artifact);

    const currentArtifact = this.#artifacts.get(captureId);
    if (currentArtifact !== undefined) {
      if (
        currentArtifact.sha256 === artifact.sha256 &&
        currentArtifact.fileUri === artifact.fileUri &&
        currentArtifact.byteLength === artifact.byteLength
      ) {
        return Promise.resolve();
      }
      throw new Error(`Conflicting durable artifact identity: ${captureId}`);
    }

    if (this.#failNextCommit) {
      this.#failNextCommit = false;
      throw new Error("Injected SQLite transaction failure");
    }

    const nextArtifact = cloneArtifact(artifact);
    const nextQueue: CaptureQueueItem = {
      captureId,
      lane: artifact.queueLane,
      state: "pending",
    };
    const nextIntent: CaptureIntent = {
      ...intent,
      state: "durable",
    };

    this.#artifacts.set(captureId, nextArtifact);
    this.#queue.set(captureId, nextQueue);
    this.#intents.set(captureId, nextIntent);
    this.#appendEvent({ captureId, type: "artifact_committed" });
    this.#appendEvent({ captureId, type: "queue_enqueued" });
    return Promise.resolve();
  }

  getArtifact(captureId: string): DurableArtifact | undefined {
    const artifact = this.#artifacts.get(captureId);
    return artifact === undefined ? undefined : cloneArtifact(artifact);
  }

  getFieldSession(): FieldSessionSnapshot | undefined {
    return this.#fieldSession === undefined
      ? undefined
      : cloneFieldSession(this.#fieldSession);
  }

  getIntent(captureId: string): CaptureIntent | undefined {
    const intent = this.#intents.get(captureId);
    return intent === undefined ? undefined : cloneIntent(intent);
  }

  getManualNote(noteId: string): ManualNote | undefined {
    const note = this.#manualNotes.get(noteId);
    return note === undefined ? undefined : cloneManualNote(note);
  }

  getQueue(captureId: string): CaptureQueueItem | undefined {
    const item = this.#queue.get(captureId);
    return item === undefined ? undefined : cloneQueueItem(item);
  }

  listArtifacts(): readonly DurableArtifact[] {
    return [...this.#artifacts.values()].map(cloneArtifact);
  }

  listEvents(): readonly LocalCaptureEvent[] {
    return this.#events.map((event) => ({ ...event }));
  }

  listIntents(): readonly CaptureIntent[] {
    return [...this.#intents.values()].map(cloneIntent);
  }

  listManualNotes(): readonly ManualNote[] {
    return [...this.#manualNotes.values()].map(cloneManualNote);
  }

  listPerformanceSamples(): readonly CapturePerformanceSample[] {
    return [...this.#performanceSamples.values()].map((sample) => ({
      ...sample,
    }));
  }

  listQueue(lane?: QueueLane): readonly CaptureQueueItem[] {
    return [...this.#queue.values()]
      .filter((item) => lane === undefined || item.lane === lane)
      .map(cloneQueueItem);
  }

  applyQueueEvent(captureId: string, event: QueueEvent): Promise<void> {
    const item = this.#queue.get(captureId);
    if (item === undefined) {
      throw new Error(`Capture queue item not found: ${captureId}`);
    }
    this.#queue.set(captureId, {
      ...item,
      state: transitionQueueState(item.state, event),
    });
    this.#appendEvent({
      captureId,
      code: event,
      type: "queue_state_changed",
    });
    return Promise.resolve();
  }

  markIntent(
    captureId: string,
    state: CaptureIntentState,
    failureCode?: string,
  ): Promise<void> {
    const intent = this.#intents.get(captureId);
    if (intent === undefined) {
      throw new Error(`Capture intent not found: ${captureId}`);
    }
    const next: CaptureIntent = { ...intent, state };
    if (failureCode !== undefined) {
      next.failureCode = failureCode;
    } else {
      delete next.failureCode;
    }
    this.#intents.set(captureId, next);
    this.#appendEvent({
      captureId,
      ...(failureCode === undefined ? {} : { code: failureCode }),
      type: "capture_intent_state_changed",
    });
    return Promise.resolve();
  }

  async recordManualNote(note: ManualNote): Promise<void> {
    if (this.#manualNotes.has(note.noteId)) {
      throw new Error(`Manual note identity already exists: ${note.noteId}`);
    }
    if (
      this.#artifacts.has(note.noteId) ||
      this.#intents.has(note.noteId) ||
      this.#queue.has(note.noteId)
    ) {
      throw new Error(
        `Manual note identity conflicts with capture identity: ${note.noteId}`,
      );
    }
    if (this.#manualNoteDigest === undefined) {
      throw new Error("Manual note digest is unavailable");
    }
    const verified = await assertManualNoteIdentity(
      note,
      this.#manualNoteDigest,
    );
    this.#manualNotes.set(verified.noteId, cloneManualNote(verified));
    this.#queue.set(note.noteId, {
      captureId: note.noteId,
      lane: "manual_note_sync",
      state: "pending",
    });
    this.#appendEvent({
      captureId: note.noteId,
      type: "manual_note_recorded",
    });
    this.#appendEvent({ captureId: note.noteId, type: "queue_enqueued" });
  }

  recordPerformanceSample(sample: CapturePerformanceSample): Promise<void> {
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
    this.#performanceSamples.set(sample.captureId, { ...sample });
    return Promise.resolve();
  }

  saveFieldSession(snapshot: FieldSessionSnapshot): Promise<void> {
    const validated = parseFieldSession(snapshot);
    const currentWorkflow = this.#fieldSession?.workflow;
    const nextWorkflow = validated.workflow;
    if (currentWorkflow !== undefined && nextWorkflow === undefined) {
      throw new Error("A protected field workflow cannot be removed");
    }
    if (
      currentWorkflow !== undefined &&
      nextWorkflow !== undefined &&
      (nextWorkflow.revision < currentWorkflow.revision ||
        (nextWorkflow.revision > currentWorkflow.revision &&
          nextWorkflow.revision !== currentWorkflow.revision + 1) ||
        (nextWorkflow.revision === currentWorkflow.revision &&
          JSON.stringify(nextWorkflow) !== JSON.stringify(currentWorkflow)))
    ) {
      throw new Error(
        "Field workflow transitions must append exactly one immutable revision",
      );
    }
    this.#fieldSession = cloneFieldSession(validated);
    return Promise.resolve();
  }
}
