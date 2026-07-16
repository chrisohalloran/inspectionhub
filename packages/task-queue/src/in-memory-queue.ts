import { randomUUID } from "node:crypto";

import type {
  AsyncTaskRecord,
  EnqueueTask,
  LeaseCommand,
  SafeTaskEvent,
  TaskCheckpoint,
  TaskLease,
} from "./types.js";

type MutableTask = {
  -readonly [Key in keyof Omit<AsyncTaskRecord, "checkpoints">]: Omit<
    AsyncTaskRecord,
    "checkpoints"
  >[Key];
} & { checkpoints: TaskCheckpoint[] };

const fingerprintPattern = /^[0-9a-f]{64}$/;

export class InMemoryDurableTaskQueue {
  readonly #tasks = new Map<string, MutableTask>();
  readonly #idempotencyIndex = new Map<string, string>();
  readonly #events: SafeTaskEvent[] = [];
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  enqueue(input: EnqueueTask): {
    readonly task: AsyncTaskRecord;
    readonly replayed: boolean;
  } {
    validateEnqueue(input);
    const idempotencyIndexKey = `${input.organizationId}:${input.idempotencyKey}`;
    const priorId = this.#idempotencyIndex.get(idempotencyIndexKey);
    if (priorId !== undefined) {
      const prior = this.#requireTask(priorId);
      if (prior.requestFingerprint !== input.requestFingerprint) {
        throw new Error(
          "Task idempotency key cannot be reused with a different fingerprint",
        );
      }
      this.#event(prior, "task.replayed", {});
      return { task: snapshot(prior), replayed: true };
    }
    const now = this.#now().toISOString();
    const task: MutableTask = {
      ...input,
      taskId: input.taskId ?? randomUUID(),
      dependencyTaskIds: Object.freeze([...(input.dependencyTaskIds ?? [])]),
      state: "queued",
      attemptCount: 0,
      maxAttempts: input.maxAttempts ?? 5,
      availableAt: input.availableAt ?? now,
      leaseGeneration: 0,
      checkpoints: [],
      createdAt: now,
      updatedAt: now,
    };
    if (this.#tasks.has(task.taskId))
      throw new Error("Task identity already exists");
    this.#tasks.set(task.taskId, task);
    this.#idempotencyIndex.set(idempotencyIndexKey, task.taskId);
    this.#event(task, "task.enqueued", { taskType: task.taskType });
    return { task: snapshot(task), replayed: false };
  }

  lease(workerId: string, leaseDurationMs: number): TaskLease | undefined {
    if (
      !workerId.trim() ||
      !Number.isInteger(leaseDurationMs) ||
      leaseDurationMs < 1000 ||
      leaseDurationMs > 900_000
    ) {
      throw new Error(
        "Worker lease must be named and between 1 and 900 seconds",
      );
    }
    this.recoverExpiredLeases();
    this.reconcileBlockedDependencies();
    const nowMs = this.#now().getTime();
    const candidate = [...this.#tasks.values()]
      .filter(
        (task) =>
          (task.state === "queued" || task.state === "retry_wait") &&
          Date.parse(task.availableAt) <= nowMs &&
          task.attemptCount < task.maxAttempts &&
          this.#dependenciesSucceeded(task),
      )
      .sort((left, right) =>
        `${left.availableAt}:${left.createdAt}:${left.taskId}`.localeCompare(
          `${right.availableAt}:${right.createdAt}:${right.taskId}`,
        ),
      )[0];
    if (candidate === undefined) return undefined;
    candidate.state = "running";
    candidate.attemptCount += 1;
    candidate.leaseGeneration += 1;
    candidate.leaseToken = randomUUID();
    candidate.leasedBy = workerId;
    candidate.leasedUntil = new Date(nowMs + leaseDurationMs).toISOString();
    candidate.heartbeatAt = this.#now().toISOString();
    candidate.updatedAt = candidate.heartbeatAt;
    this.#event(candidate, "task.leased", {
      attempt: candidate.attemptCount,
      generation: candidate.leaseGeneration,
      workerId,
    });
    return {
      task: snapshot(candidate),
      generation: candidate.leaseGeneration,
      leaseToken: candidate.leaseToken,
      leasedUntil: candidate.leasedUntil,
    };
  }

  heartbeat(command: LeaseCommand, leaseDurationMs: number): boolean {
    const task = this.#validLease(command);
    if (task === undefined) return false;
    if (
      !Number.isInteger(leaseDurationMs) ||
      leaseDurationMs < 1000 ||
      leaseDurationMs > 900_000
    ) {
      throw new Error("Heartbeat lease extension is outside policy");
    }
    const now = this.#now();
    task.heartbeatAt = now.toISOString();
    task.leasedUntil = new Date(now.getTime() + leaseDurationMs).toISOString();
    task.updatedAt = now.toISOString();
    this.#event(task, "task.heartbeat", { generation: task.leaseGeneration });
    return true;
  }

  checkpoint(
    command: LeaseCommand,
    checkpoint: Omit<TaskCheckpoint, "checkpointId" | "recordedAt">,
  ): boolean {
    const task = this.#validLease(command);
    if (task === undefined) return false;
    if (!/^[a-z][a-z0-9_.-]{0,79}$/.test(checkpoint.name)) {
      throw new Error("Checkpoint name is invalid");
    }
    for (const hash of checkpoint.metadataHashes) {
      if (!fingerprintPattern.test(hash))
        throw new Error("Checkpoint metadata must be hashes");
    }
    const recorded: TaskCheckpoint = Object.freeze({
      checkpointId: randomUUID(),
      name: checkpoint.name,
      artifactRefs: Object.freeze([...checkpoint.artifactRefs]),
      metadataHashes: Object.freeze([...checkpoint.metadataHashes]),
      recordedAt: this.#now().toISOString(),
    });
    task.checkpoints.push(recorded);
    task.updatedAt = recorded.recordedAt;
    this.#event(task, "task.checkpoint", {
      checkpoint: checkpoint.name,
      artifactRefCount: checkpoint.artifactRefs.length,
    });
    return true;
  }

  recordToolEvent(
    command: LeaseCommand,
    phase: "requested" | "started" | "result",
    toolName: string,
    resultCode?: string,
  ): boolean {
    const task = this.#validLease(command);
    if (task === undefined) return false;
    const safeToolName = safeCode(toolName);
    const safeResult =
      resultCode === undefined ? undefined : safeCode(resultCode);
    this.#event(task, `tool.${phase}`, {
      toolName: safeToolName,
      ...(safeResult === undefined ? {} : { resultCode: safeResult }),
      generation: command.generation,
    });
    return true;
  }

  assertLease(command: LeaseCommand): void {
    if (this.#validLease(command) === undefined) {
      throw new Error(
        "Worker lease is no longer valid for a side-effect commit",
      );
    }
  }

  complete(command: LeaseCommand, resultArtifactId?: string): boolean {
    const task = this.#validLease(command);
    if (task === undefined) return false;
    task.state = "succeeded";
    if (resultArtifactId !== undefined)
      task.resultArtifactId = resultArtifactId;
    clearLease(task);
    task.updatedAt = this.#now().toISOString();
    this.#event(task, "task.completed", {
      generation: command.generation,
      resultRecorded: resultArtifactId !== undefined,
    });
    return true;
  }

  fail(
    command: LeaseCommand,
    errorCode: string,
    options: { readonly retryable: boolean; readonly retryDelayMs?: number },
  ): boolean {
    if (
      options.retryDelayMs !== undefined &&
      (!Number.isSafeInteger(options.retryDelayMs) ||
        options.retryDelayMs < 0 ||
        options.retryDelayMs > 86_400_000)
    ) {
      throw new Error("Task retry delay is outside policy");
    }
    const task = this.#validLease(command);
    if (task === undefined) return false;
    task.lastErrorCode = safeCode(errorCode);
    const retryable = options.retryable && task.attemptCount < task.maxAttempts;
    task.state = retryable ? "retry_wait" : "dead_letter";
    task.availableAt = new Date(
      this.#now().getTime() +
        (options.retryDelayMs ?? boundedBackoff(task.attemptCount)),
    ).toISOString();
    clearLease(task);
    task.updatedAt = this.#now().toISOString();
    this.#event(
      task,
      retryable ? "task.retry_scheduled" : "task.dead_lettered",
      { attempt: task.attemptCount, errorCode: task.lastErrorCode },
    );
    return true;
  }

  markUnknown(command: LeaseCommand, reconciliationKeyHash: string): boolean {
    if (!fingerprintPattern.test(reconciliationKeyHash)) {
      throw new Error("Unknown provider reconciliation key must be hashed");
    }
    const task = this.#validLease(command);
    if (task === undefined) return false;
    task.state = "unknown";
    task.unknownReconciliationHash = reconciliationKeyHash;
    clearLease(task);
    task.updatedAt = this.#now().toISOString();
    this.#event(task, "task.unknown", { reconciliationKeyHash });
    return true;
  }

  /**
   * Persists an observed provider outcome independently of an expired worker
   * lease. The exact request fingerprint binds the observation to the original
   * idempotent call, preventing a stale worker from changing another request.
   */
  recordUnknownObservation(
    taskId: string,
    requestFingerprint: string,
    reconciliationKeyHash: string,
  ): boolean {
    if (!fingerprintPattern.test(reconciliationKeyHash)) {
      throw new Error("Unknown provider reconciliation key must be hashed");
    }
    const task = this.#requireTask(taskId);
    if (task.requestFingerprint !== requestFingerprint) {
      throw new Error("Unknown provider observation fingerprint diverged");
    }
    if (task.state === "unknown") {
      if (task.unknownReconciliationHash !== reconciliationKeyHash) {
        throw new Error("Unknown provider reconciliation observation diverged");
      }
      return true;
    }
    if (
      ["succeeded", "dead_letter", "cancelled", "superseded"].includes(
        task.state,
      )
    ) {
      return false;
    }
    task.state = "unknown";
    task.unknownReconciliationHash = reconciliationKeyHash;
    clearLease(task);
    task.updatedAt = this.#now().toISOString();
    this.#event(task, "task.unknown", { reconciliationKeyHash });
    return true;
  }

  reconcileUnknown(
    taskId: string,
    expectedReconciliationKeyHash: string,
    observed: "succeeded" | "retry" | "failed",
  ): boolean {
    const task = this.#requireTask(taskId);
    if (
      task.state !== "unknown" ||
      task.unknownReconciliationHash !== expectedReconciliationKeyHash
    )
      return false;
    task.state =
      observed === "succeeded"
        ? "succeeded"
        : observed === "retry" && task.attemptCount < task.maxAttempts
          ? "retry_wait"
          : "dead_letter";
    task.availableAt = this.#now().toISOString();
    task.updatedAt = task.availableAt;
    this.#event(
      task,
      task.state === "succeeded"
        ? "task.completed"
        : task.state === "retry_wait"
          ? "task.retry_scheduled"
          : "task.dead_lettered",
      { reconciled: true },
    );
    return true;
  }

  supersedePacket(
    organizationId: string,
    packetId: string,
    newerRevision: number,
  ): readonly string[] {
    if (!Number.isSafeInteger(newerRevision) || newerRevision < 1) {
      throw new Error("New packet revision is invalid");
    }
    const superseded: string[] = [];
    for (const task of this.#tasks.values()) {
      if (
        task.organizationId === organizationId &&
        task.packetId === packetId &&
        task.packetRevision !== undefined &&
        task.packetRevision < newerRevision &&
        !["dead_letter", "cancelled", "superseded"].includes(task.state)
      ) {
        task.state = "superseded";
        task.supersededByRevision = newerRevision;
        clearLease(task);
        task.updatedAt = this.#now().toISOString();
        superseded.push(task.taskId);
        this.#event(task, "task.superseded", { newerRevision });
      }
    }
    return superseded;
  }

  cancel(taskId: string, reasonCode: string): boolean {
    const task = this.#requireTask(taskId);
    if (
      ["succeeded", "dead_letter", "cancelled", "superseded"].includes(
        task.state,
      )
    ) {
      return false;
    }
    task.state = "cancelled";
    clearLease(task);
    task.lastErrorCode = safeCode(reasonCode);
    task.updatedAt = this.#now().toISOString();
    this.#event(task, "task.cancelled", { reasonCode: task.lastErrorCode });
    return true;
  }

  recoverExpiredLeases(): readonly string[] {
    const nowMs = this.#now().getTime();
    const recovered: string[] = [];
    for (const task of this.#tasks.values()) {
      if (
        task.state === "running" &&
        task.leasedUntil !== undefined &&
        Date.parse(task.leasedUntil) < nowMs
      ) {
        task.state =
          task.attemptCount < task.maxAttempts ? "retry_wait" : "dead_letter";
        task.lastErrorCode = "lease_expired";
        task.availableAt = this.#now().toISOString();
        clearLease(task);
        task.updatedAt = task.availableAt;
        recovered.push(task.taskId);
        this.#event(
          task,
          task.state === "retry_wait"
            ? "task.retry_scheduled"
            : "task.dead_lettered",
          { errorCode: "lease_expired" },
        );
      }
    }
    return recovered;
  }

  reconcileBlockedDependencies(): readonly string[] {
    const cancelled: string[] = [];
    for (const task of this.#tasks.values()) {
      if (
        (task.state === "queued" || task.state === "retry_wait") &&
        (task.dependencyTaskIds ?? []).some((taskId) => {
          const state = this.#tasks.get(taskId)?.state;
          return (
            state === "dead_letter" ||
            state === "cancelled" ||
            state === "superseded"
          );
        })
      ) {
        task.state = "cancelled";
        task.lastErrorCode = "dependency_terminal";
        task.updatedAt = this.#now().toISOString();
        cancelled.push(task.taskId);
        this.#event(task, "task.cancelled", {
          reasonCode: "dependency_terminal",
        });
      }
    }
    return cancelled;
  }

  task(taskId: string): AsyncTaskRecord | undefined {
    const task = this.#tasks.get(taskId);
    return task === undefined ? undefined : snapshot(task);
  }

  tasks(): readonly AsyncTaskRecord[] {
    return [...this.#tasks.values()].map(snapshot);
  }

  events(): readonly SafeTaskEvent[] {
    return [...this.#events];
  }

  #dependenciesSucceeded(task: MutableTask): boolean {
    return (task.dependencyTaskIds ?? []).every(
      (taskId) => this.#tasks.get(taskId)?.state === "succeeded",
    );
  }

  #validLease(command: LeaseCommand): MutableTask | undefined {
    const task = this.#tasks.get(command.taskId);
    if (
      task === undefined ||
      task.state !== "running" ||
      task.leaseGeneration !== command.generation ||
      task.leaseToken !== command.leaseToken ||
      task.leasedUntil === undefined ||
      Date.parse(task.leasedUntil) < this.#now().getTime()
    ) {
      return undefined;
    }
    return task;
  }

  #requireTask(taskId: string): MutableTask {
    const task = this.#tasks.get(taskId);
    if (task === undefined) throw new Error("Task was not found");
    return task;
  }

  #event(
    task: MutableTask,
    eventType: SafeTaskEvent["eventType"],
    safeMetadata: SafeTaskEvent["safeMetadata"],
  ): void {
    this.#events.push(
      Object.freeze({
        eventId: randomUUID(),
        taskId: task.taskId,
        organizationId: task.organizationId,
        eventType,
        safeMetadata: Object.freeze({ ...safeMetadata }),
        recordedAt: this.#now().toISOString(),
      }),
    );
  }
}

function validateEnqueue(input: EnqueueTask): void {
  for (const [label, value] of [
    ["organizationId", input.organizationId],
    ["taskType", input.taskType],
    ["aggregateType", input.aggregateType],
    ["aggregateId", input.aggregateId],
    ["idempotencyKey", input.idempotencyKey],
  ] as const) {
    if (!value.trim() || value.length > 240)
      throw new Error(`${label} is invalid`);
  }
  if (!fingerprintPattern.test(input.requestFingerprint)) {
    throw new Error("Task request fingerprint is invalid");
  }
  if (
    input.maxAttempts !== undefined &&
    (!Number.isSafeInteger(input.maxAttempts) ||
      input.maxAttempts < 1 ||
      input.maxAttempts > 100)
  ) {
    throw new Error("Task max attempts is outside policy");
  }
  if (
    (input.packetId === undefined) !== (input.packetRevision === undefined) ||
    (input.packetRevision !== undefined &&
      (!Number.isSafeInteger(input.packetRevision) || input.packetRevision < 1))
  ) {
    throw new Error(
      "Packet task must bind an ID and positive revision together",
    );
  }
  if (
    input.availableAt !== undefined &&
    !Number.isFinite(Date.parse(input.availableAt))
  ) {
    throw new Error("Task availableAt timestamp is invalid");
  }
  const dependencies = input.dependencyTaskIds ?? [];
  if (
    new Set(dependencies).size !== dependencies.length ||
    (input.taskId !== undefined && dependencies.includes(input.taskId))
  ) {
    throw new Error(
      "Task dependencies must be unique and cannot reference self",
    );
  }
}

function clearLease(task: MutableTask): void {
  delete task.leaseToken;
  delete task.leasedBy;
  delete task.leasedUntil;
  delete task.heartbeatAt;
}

function boundedBackoff(attempt: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.min(attempt - 1, 6));
}

function safeCode(value: string): string {
  if (!/^[a-z][a-z0-9_.-]{0,79}$/.test(value)) {
    throw new Error("Task error/reason code is not safe metadata");
  }
  return value;
}

function snapshot(task: MutableTask): AsyncTaskRecord {
  return Object.freeze({
    ...task,
    dependencyTaskIds: Object.freeze([...(task.dependencyTaskIds ?? [])]),
    checkpoints: Object.freeze([...task.checkpoints]),
  });
}
