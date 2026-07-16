import { parseEnvironment } from "@inspection/config";
import {
  ContentQuarantinePipeline,
  DeterministicSandboxDecoder,
  InMemoryPrivateObjectStore,
  InMemorySyncRepository,
} from "@inspection/storage";
import { InMemoryDurableTaskQueue } from "@inspection/task-queue";

export * from "./tasks/evidence-handlers.js";
export * from "./tasks/runtime.js";
import { createEvidenceTaskHandlers } from "./tasks/evidence-handlers.js";
import {
  createWorkerRuntime,
  runPersistentWorkerLoop,
} from "./tasks/runtime.js";

export function readWorkerConfiguration(input: Record<string, unknown>) {
  return parseEnvironment("worker", input);
}

export async function startWorker(
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<void> {
  const configuration = readWorkerConfiguration(input);
  if (configuration.PROVIDER_MODE === "live") {
    throw new Error(
      "Live worker requires the production Postgres/private-object-store adapter; the local fake is fail-closed.",
    );
  }
  const store = new InMemoryPrivateObjectStore();
  const queue = new InMemoryDurableTaskQueue();
  const repository = new InMemorySyncRepository(undefined, (intent) => {
    const result = queue.enqueue(intent);
    return { taskId: result.task.taskId, replayed: result.replayed };
  });
  const contentPipeline = new ContentQuarantinePipeline({
    store,
    repository,
    decoder: new DeterministicSandboxDecoder(),
  });
  process.stdout.write(
    "Inspection worker started with the fenced local adapter; awaiting durable work.\n",
  );
  await runPersistentWorkerLoop({
    runtime: createWorkerRuntime({
      queue,
      workerId: configuration.WORKER_ID,
      handlers: createEvidenceTaskHandlers({ contentPipeline, repository }),
    }),
    signal,
  });
}

if (process.env.NODE_ENV !== "test") {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  void startWorker(process.env, controller.signal).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Worker startup failed"}\n`,
    );
    process.exitCode = 1;
  });
}
