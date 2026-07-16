import {
  ContentQuarantinePipeline,
  DeterministicSandboxDecoder,
  EvidenceSyncService,
  InMemoryPrivateObjectStore,
  InMemorySyncRepository,
  reconcileEvidence,
  sha256,
  type ImmutableObjectStore,
} from "@inspection/storage";
import { InMemoryDurableTaskQueue } from "@inspection/task-queue";
import { describe, expect, it } from "vitest";

import { createEvidenceTaskHandlers } from "./evidence-handlers.js";
import { createWorkerRuntime, runPersistentWorkerLoop } from "./runtime.js";

function jpeg(): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x01,
    0x01, 0xff, 0xd9,
  ]);
}

describe("evidence worker handlers", () => {
  it("keeps polling until graceful shutdown instead of exiting after startup", async () => {
    const controller = new AbortController();
    let cycles = 0;
    await runPersistentWorkerLoop({
      runtime: {
        runOnce: () => {
          cycles += 1;
          if (cycles === 2) controller.abort();
          return Promise.resolve(cycles === 1 ? "idle" : "succeeded");
        },
      },
      signal: controller.signal,
      idlePollMs: 10,
    });
    expect(cycles).toBe(2);
  });

  it("creates a safe proxy through the fenced worker and leaves protected references in checkpoints", async () => {
    const bytes = jpeg();
    const store = new InMemoryPrivateObjectStore();
    const queue = new InMemoryDurableTaskQueue();
    const repository = new InMemorySyncRepository(undefined, (input) => {
      const result = queue.enqueue(input);
      return { taskId: result.task.taskId, replayed: result.replayed };
    });
    const sync = new EvidenceSyncService({ store, repository });
    const principal = {
      organizationId: "org-alpha",
      actorId: "inspector",
      assignedJobIds: new Set(["job-one"]),
    };
    const intent = sync.issueUploadIntent(principal, {
      artifactId: "artifact-one",
      captureId: "capture-one",
      organizationId: "org-alpha",
      jobId: "job-one",
      captureSequence: 1,
      capturedAt: "2026-07-15T00:00:00.000Z",
      mediaType: "image/jpeg",
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
    });
    await sync.upload(intent.intentId, intent.uploadToken, bytes, "image/jpeg");
    await sync.finalize(principal, intent.intentId, intent.uploadToken);

    const runtime = createWorkerRuntime({
      queue,
      workerId: "worker-one",
      handlers: createEvidenceTaskHandlers({
        contentPipeline: new ContentQuarantinePipeline({
          store,
          repository,
          decoder: new DeterministicSandboxDecoder(),
        }),
        repository,
      }),
      leaseDurationMs: 1000,
    });
    await expect(runtime.runOnce()).resolves.toBe("succeeded");
    expect(queue.tasks()[0]?.state).toBe("succeeded");
    expect(typeof queue.tasks()[0]?.resultArtifactId).toBe("string");
    expect(queue.tasks()[0]?.checkpoints[0]?.name).toBe(
      "content.safe_proxy_persisted",
    );
    expect(repository.trustedProxyFor("artifact-one")).toBeDefined();
  });

  it("fences the trust commit when a lease expires during proxy persistence", async () => {
    let now = new Date("2026-07-15T00:00:00.000Z");
    let expireOnSafePut = true;
    const backingStore = new InMemoryPrivateObjectStore(() => now);
    const store: ImmutableObjectStore = {
      head: (key) => backingStore.head(key),
      read: (key) => backingStore.read(key),
      list: (prefix) => backingStore.list(prefix),
      putImmutable: async (key, bytes, mediaType) => {
        const result = await backingStore.putImmutable(key, bytes, mediaType);
        if (expireOnSafePut && key.startsWith("safe/")) {
          expireOnSafePut = false;
          now = new Date(now.getTime() + 2000);
        }
        return result;
      },
    };
    const queue = new InMemoryDurableTaskQueue(() => now);
    const repository = new InMemorySyncRepository(
      () => now,
      (input) => {
        const result = queue.enqueue(input);
        return { taskId: result.task.taskId, replayed: result.replayed };
      },
    );
    const sync = new EvidenceSyncService({ store, repository, now: () => now });
    const bytes = jpeg();
    const principal = {
      organizationId: "org-alpha",
      actorId: "inspector",
      assignedJobIds: new Set(["job-one"]),
    };
    const intent = sync.issueUploadIntent(principal, {
      artifactId: "artifact-stale",
      captureId: "capture-stale",
      organizationId: "org-alpha",
      jobId: "job-one",
      captureSequence: 1,
      capturedAt: now.toISOString(),
      mediaType: "image/jpeg",
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
    });
    await sync.upload(intent.intentId, intent.uploadToken, bytes, "image/jpeg");
    await sync.finalize(principal, intent.intentId, intent.uploadToken);

    const handlers = createEvidenceTaskHandlers({
      contentPipeline: new ContentQuarantinePipeline({
        store,
        repository,
        decoder: new DeterministicSandboxDecoder(),
        now: () => now,
      }),
      repository,
    });
    await expect(
      createWorkerRuntime({
        queue,
        workerId: "worker-stale",
        handlers,
        leaseDurationMs: 1000,
      }).runOnce(),
    ).rejects.toThrow(/lease/i);
    expect(repository.trustedProxyFor("artifact-stale")).toBeUndefined();
    expect(await backingStore.list("safe/org-alpha/")).toHaveLength(1);

    await expect(
      createWorkerRuntime({
        queue,
        workerId: "worker-replacement",
        handlers,
        leaseDurationMs: 1000,
      }).runOnce(),
    ).resolves.toBe("succeeded");
    expect(repository.trustedProxyFor("artifact-stale")).toBeDefined();
    const reconciliation = await reconcileEvidence({
      organizationId: "org-alpha",
      store,
      repository,
    });
    const orphan = reconciliation.find(({ detail }) =>
      /no fenced proxy provenance/i.test(detail),
    );
    expect(orphan?.state).toBe("object_only");
  });
});
