import type {
  InMemoryDurableTaskQueue,
  TaskHandler,
} from "@inspection/task-queue";
import { runWorkerCycle } from "@inspection/task-queue";

export interface WorkerRuntime {
  runOnce(): Promise<
    "idle" | "succeeded" | "retry_wait" | "unknown" | "dead_letter"
  >;
}

export async function runPersistentWorkerLoop(options: {
  readonly runtime: WorkerRuntime;
  readonly signal: AbortSignal;
  readonly idlePollMs?: number;
}): Promise<void> {
  const idlePollMs = options.idlePollMs ?? 500;
  if (
    !Number.isSafeInteger(idlePollMs) ||
    idlePollMs < 10 ||
    idlePollMs > 60_000
  ) {
    throw new Error("Worker idle poll interval is outside policy");
  }
  while (!options.signal.aborted) {
    const result = await options.runtime.runOnce();
    if (result === "idle") await abortableDelay(idlePollMs, options.signal);
  }
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    timer.unref();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function createWorkerRuntime(options: {
  readonly queue: InMemoryDurableTaskQueue;
  readonly workerId: string;
  readonly handlers: ReadonlyMap<string, TaskHandler>;
  readonly leaseDurationMs?: number;
}): WorkerRuntime {
  const leaseDurationMs = options.leaseDurationMs ?? 120_000;
  return {
    runOnce: () =>
      runWorkerCycle({
        queue: options.queue,
        workerId: options.workerId,
        handlers: options.handlers,
        leaseDurationMs,
      }),
  };
}
