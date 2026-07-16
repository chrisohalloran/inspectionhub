import {
  DeterministicSandboxDecoder,
  EvidenceSyncService,
  InMemoryPrivateObjectStore,
  InMemorySyncRepository,
  ContentQuarantinePipeline,
  type SyncPrincipal,
} from "@inspection/storage";
import { InMemoryDurableTaskQueue } from "@inspection/task-queue";

export interface LocalSyncRuntime {
  readonly store: InMemoryPrivateObjectStore;
  readonly repository: InMemorySyncRepository;
  readonly sync: EvidenceSyncService;
  readonly content: ContentQuarantinePipeline;
  readonly queue: InMemoryDurableTaskQueue;
}

let localRuntime: LocalSyncRuntime | undefined;

export function getSyncRuntime(): LocalSyncRuntime {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.SYNC_FAKE_RUNTIME_ENABLED !== "true"
  ) {
    throw new Error(
      "The in-memory sync adapter is disabled in production; configure the Postgres/private-object-store adapter.",
    );
  }
  localRuntime ??= createLocalRuntime();
  return localRuntime;
}

export function createLocalRuntime(): LocalSyncRuntime {
  const store = new InMemoryPrivateObjectStore();
  const queue = new InMemoryDurableTaskQueue();
  const repository = new InMemorySyncRepository(undefined, (intent) => {
    const result = queue.enqueue(intent);
    return { taskId: result.task.taskId, replayed: result.replayed };
  });
  return {
    store,
    repository,
    sync: new EvidenceSyncService({ store, repository }),
    content: new ContentQuarantinePipeline({
      store,
      repository,
      decoder: new DeterministicSandboxDecoder(),
    }),
    queue,
  };
}

export function authenticateLocalSyncRequest(request: Request): SyncPrincipal {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.SYNC_FAKE_RUNTIME_ENABLED !== "true"
  ) {
    throw new Error(
      "Local sync request authentication is disabled in production",
    );
  }
  const actorId = request.headers.get("x-sync-test-actor");
  const organizationId = request.headers.get("x-organization-id");
  const jobs = request.headers.get("x-assigned-job-ids");
  if (actorId === null || organizationId === null || jobs === null) {
    throw new Error("Authenticated tenant and assigned-job scope are required");
  }
  return {
    actorId,
    organizationId,
    assignedJobIds: new Set(
      jobs
        .split(",")
        .map((job) => job.trim())
        .filter(Boolean),
    ),
  };
}

export function syncError(error: unknown): Response {
  const message =
    error instanceof Error ? error.message : "Sync request failed";
  const denied = /denied|required|invalid token|disabled in production/i.test(
    message,
  );
  return Response.json(
    {
      error: denied ? "sync_scope_denied" : "sync_request_rejected",
      detail: message,
    },
    { status: denied ? 403 : 400 },
  );
}
