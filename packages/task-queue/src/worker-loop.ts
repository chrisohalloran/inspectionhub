import type { InMemoryDurableTaskQueue } from "./in-memory-queue.js";
import type { AsyncTaskRecord, LeaseCommand } from "./types.js";

export class RetryableTaskError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export class UnknownTaskOutcome extends Error {
  constructor(readonly reconciliationKeyHash: string) {
    super("Task outcome is unknown and must be reconciled");
  }
}

export interface TaskExecutionContext {
  readonly task: AsyncTaskRecord;
  readonly assertLease: () => void;
  readonly checkpoint: (input: {
    readonly name: string;
    readonly artifactRefs?: readonly string[];
    readonly metadataHashes?: readonly string[];
  }) => void;
}

export type TaskHandler = (
  context: TaskExecutionContext,
) => Promise<{ readonly resultArtifactId?: string }>;

export async function runWorkerCycle(options: {
  queue: InMemoryDurableTaskQueue;
  workerId: string;
  leaseDurationMs: number;
  handlers: ReadonlyMap<string, TaskHandler>;
  heartbeatIntervalMs?: number;
}): Promise<"idle" | "succeeded" | "retry_wait" | "unknown" | "dead_letter"> {
  const lease = options.queue.lease(options.workerId, options.leaseDurationMs);
  if (lease === undefined) return "idle";
  const command: LeaseCommand = {
    taskId: lease.task.taskId,
    generation: lease.generation,
    leaseToken: lease.leaseToken,
  };
  const handler = options.handlers.get(lease.task.taskType);
  if (handler === undefined) {
    options.queue.fail(command, "handler_not_registered", { retryable: false });
    return "dead_letter";
  }
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ??
    Math.max(100, Math.floor(options.leaseDurationMs / 3));
  if (
    !Number.isSafeInteger(heartbeatIntervalMs) ||
    heartbeatIntervalMs < 50 ||
    heartbeatIntervalMs >= options.leaseDurationMs
  ) {
    throw new Error("Worker heartbeat interval must be shorter than its lease");
  }
  let heartbeatLost = false;
  const heartbeatTimer = setInterval(() => {
    if (!options.queue.heartbeat(command, options.leaseDurationMs)) {
      heartbeatLost = true;
    }
  }, heartbeatIntervalMs);
  heartbeatTimer.unref();
  try {
    if (!options.queue.recordToolEvent(command, "requested", "task.handler")) {
      throw new Error("Worker lease was fenced before tool request");
    }
    if (!options.queue.recordToolEvent(command, "started", "task.handler")) {
      throw new Error("Worker lease was fenced before tool start");
    }
    const result = await handler({
      task: lease.task,
      assertLease: () => {
        if (heartbeatLost) throw new Error("Worker heartbeat lost its lease");
        options.queue.assertLease(command);
      },
      checkpoint: ({ name, artifactRefs = [], metadataHashes = [] }) => {
        if (
          !options.queue.checkpoint(command, {
            name,
            artifactRefs,
            metadataHashes,
          })
        ) {
          throw new Error("Worker lease was fenced before checkpoint commit");
        }
      },
    });
    if (
      !options.queue.recordToolEvent(
        command,
        "result",
        "task.handler",
        "success",
      )
    ) {
      throw new Error("Worker lease was fenced before tool result");
    }
    if (!options.queue.complete(command, result.resultArtifactId)) {
      throw new Error("Worker lease was fenced before completion commit");
    }
    return "succeeded";
  } catch (error) {
    options.queue.recordToolEvent(
      command,
      "result",
      "task.handler",
      error instanceof UnknownTaskOutcome
        ? "unknown"
        : error instanceof RetryableTaskError
          ? "retryable_failure"
          : "terminal_failure",
    );
    if (error instanceof UnknownTaskOutcome) {
      if (
        !options.queue.recordUnknownObservation(
          lease.task.taskId,
          lease.task.requestFingerprint,
          error.reconciliationKeyHash,
        )
      ) {
        throw new Error(
          "Provider unknown observation reached a terminal task",
          {
            cause: error,
          },
        );
      }
      return "unknown";
    }
    const retryable = error instanceof RetryableTaskError;
    const code = retryable ? error.code : "unhandled_task_error";
    const changed = options.queue.fail(command, code, { retryable });
    if (!changed) throw error;
    return options.queue.task(command.taskId)?.state === "retry_wait"
      ? "retry_wait"
      : "dead_letter";
  } finally {
    clearInterval(heartbeatTimer);
  }
}
