import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  InMemoryDurableTaskQueue,
  RetryableTaskError,
  UnknownTaskOutcome,
  runWorkerCycle,
  type EnqueueTask,
} from "./index.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function task(
  idempotencyKey: string,
  overrides: Partial<EnqueueTask> = {},
): EnqueueTask {
  return {
    organizationId: "org-alpha",
    taskType: "safe_proxy.create",
    aggregateType: "artifact",
    aggregateId: `artifact-${idempotencyKey}`,
    idempotencyKey,
    requestFingerprint: hash(idempotencyKey),
    ...overrides,
  };
}

describe("durable fenced task queue", () => {
  it("replays identical enqueue and rejects idempotency-key fingerprint divergence", () => {
    const queue = new InMemoryDurableTaskQueue();
    const first = queue.enqueue(task("key-one"));
    const replay = queue.enqueue(task("key-one"));
    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({
      replayed: true,
      task: { taskId: first.task.taskId },
    });
    expect(() =>
      queue.enqueue(task("key-one", { requestFingerprint: hash("different") })),
    ).toThrow(/fingerprint/);
  });

  it("recovers a lost worker, increments its fencing generation and rejects stale completion", () => {
    let now = new Date("2026-07-15T00:00:00.000Z");
    const queue = new InMemoryDurableTaskQueue(() => now);
    queue.enqueue(task("lost-worker"));
    const first = queue.lease("worker-one", 1000);
    expect(first).toBeDefined();
    now = new Date("2026-07-15T00:00:02.000Z");
    const second = queue.lease("worker-two", 1000);
    expect(second).toMatchObject({ generation: 2, task: { attemptCount: 2 } });
    expect(
      queue.complete({
        taskId: first?.task.taskId ?? "",
        generation: first?.generation ?? 0,
        leaseToken: first?.leaseToken ?? "",
      }),
    ).toBe(false);
    expect(
      queue.complete({
        taskId: second?.task.taskId ?? "",
        generation: second?.generation ?? 0,
        leaseToken: second?.leaseToken ?? "",
      }),
    ).toBe(true);
  });

  it("persists safe checkpoints and dead-letters after bounded retries", () => {
    let now = new Date("2026-07-15T00:00:00.000Z");
    const queue = new InMemoryDurableTaskQueue(() => now);
    const enqueued = queue.enqueue(task("bounded", { maxAttempts: 2 })).task;
    const first = queue.lease("worker", 1000);
    expect(
      queue.checkpoint(
        {
          taskId: first?.task.taskId ?? "",
          generation: first?.generation ?? 0,
          leaseToken: first?.leaseToken ?? "",
        },
        {
          name: "object.read_verified",
          artifactRefs: ["artifact-one"],
          metadataHashes: [hash("safe-metadata")],
        },
      ),
    ).toBe(true);
    expect(
      queue.fail(
        {
          taskId: first?.task.taskId ?? "",
          generation: first?.generation ?? 0,
          leaseToken: first?.leaseToken ?? "",
        },
        "proxy_decoder_timeout",
        { retryable: true, retryDelayMs: 1 },
      ),
    ).toBe(true);
    now = new Date("2026-07-15T00:00:00.002Z");
    const second = queue.lease("worker", 1000);
    queue.fail(
      {
        taskId: second?.task.taskId ?? "",
        generation: second?.generation ?? 0,
        leaseToken: second?.leaseToken ?? "",
      },
      "proxy_decoder_timeout",
      { retryable: true },
    );
    expect(queue.task(enqueued.taskId)).toMatchObject({
      state: "dead_letter",
      attemptCount: 2,
      lastErrorCode: "proxy_decoder_timeout",
    });
    expect(queue.task(enqueued.taskId)?.checkpoints).toHaveLength(1);
    expect(JSON.stringify(queue.events())).not.toContain("safe-metadata");
  });

  it("cancels dependants visibly when a prerequisite reaches a terminal state", () => {
    const queue = new InMemoryDurableTaskQueue();
    queue.enqueue(task("terminal-parent", { taskId: "terminal-parent" }));
    queue.enqueue(
      task("blocked-child", {
        taskId: "blocked-child",
        dependencyTaskIds: ["terminal-parent"],
      }),
    );
    const lease = queue.lease("worker", 1000);
    queue.fail(
      {
        taskId: lease?.task.taskId ?? "",
        generation: lease?.generation ?? 0,
        leaseToken: lease?.leaseToken ?? "",
      },
      "terminal_input",
      { retryable: false },
    );
    expect(queue.lease("worker", 1000)).toBeUndefined();
    expect(queue.task("blocked-child")).toMatchObject({
      state: "cancelled",
      lastErrorCode: "dependency_terminal",
    });
  });

  it("waits for out-of-order dependencies and supersedes old packet work including completed drafts", () => {
    const queue = new InMemoryDurableTaskQueue();
    const child = queue.enqueue(
      task("draft", {
        taskId: "child",
        taskType: "ai.draft",
        dependencyTaskIds: ["parent"],
        packetId: "packet-one",
        packetRevision: 1,
      }),
    ).task;
    expect(queue.lease("worker", 1000)).toBeUndefined();
    queue.enqueue(task("proxy", { taskId: "parent" }));
    const parent = queue.lease("worker", 1000);
    queue.complete({
      taskId: parent?.task.taskId ?? "",
      generation: parent?.generation ?? 0,
      leaseToken: parent?.leaseToken ?? "",
    });
    const childLease = queue.lease("worker", 1000);
    expect(childLease?.task.taskId).toBe(child.taskId);
    queue.complete({
      taskId: childLease?.task.taskId ?? "",
      generation: childLease?.generation ?? 0,
      leaseToken: childLease?.leaseToken ?? "",
    });
    expect(queue.task(child.taskId)?.state).toBe("succeeded");
    expect(queue.supersedePacket("org-alpha", "packet-one", 2)).toEqual([
      child.taskId,
    ]);
    expect(queue.task(child.taskId)).toMatchObject({
      state: "superseded",
      supersededByRevision: 2,
    });
  });

  it("keeps provider unknown outcomes literal until observed reconciliation", () => {
    const queue = new InMemoryDurableTaskQueue();
    const enqueued = queue.enqueue(task("provider-unknown")).task;
    const lease = queue.lease("worker", 1000);
    queue.markUnknown(
      {
        taskId: lease?.task.taskId ?? "",
        generation: lease?.generation ?? 0,
        leaseToken: lease?.leaseToken ?? "",
      },
      hash("provider-reconcile-key"),
    );
    expect(queue.task(enqueued.taskId)?.state).toBe("unknown");
    expect(queue.lease("worker", 1000)).toBeUndefined();
    expect(
      queue.reconcileUnknown(
        enqueued.taskId,
        hash("provider-reconcile-key"),
        "retry",
      ),
    ).toBe(true);
    expect(queue.task(enqueued.taskId)?.state).toBe("retry_wait");
  });
});

describe("thin worker harness", () => {
  it("runs handlers, records checkpoints and commits a fenced result", async () => {
    const queue = new InMemoryDurableTaskQueue();
    queue.enqueue(task("worker-success"));
    await expect(
      runWorkerCycle({
        queue,
        workerId: "worker-one",
        leaseDurationMs: 1000,
        handlers: new Map([
          [
            "safe_proxy.create",
            ({ checkpoint }) => {
              checkpoint({
                name: "proxy.persisted",
                artifactRefs: ["proxy-one"],
              });
              return Promise.resolve({ resultArtifactId: "proxy-one" });
            },
          ],
        ]),
      }),
    ).resolves.toBe("succeeded");
    expect(queue.tasks()[0]).toMatchObject({
      state: "succeeded",
      resultArtifactId: "proxy-one",
    });
    expect(queue.events().map(({ eventType }) => eventType)).toEqual(
      expect.arrayContaining(["tool.requested", "tool.started", "tool.result"]),
    );
  });

  it("routes retryable, unknown and unhandled errors to explicit states", async () => {
    for (const [key, error, expected] of [
      [
        "retry",
        new RetryableTaskError("temporary_decoder_failure"),
        "retry_wait",
      ],
      ["unknown", new UnknownTaskOutcome(hash("provider-key")), "unknown"],
      ["terminal", new Error("unsafe detail"), "dead_letter"],
    ] as const) {
      const queue = new InMemoryDurableTaskQueue();
      queue.enqueue(task(key));
      await runWorkerCycle({
        queue,
        workerId: "worker-one",
        leaseDurationMs: 1000,
        handlers: new Map([["safe_proxy.create", () => Promise.reject(error)]]),
      });
      expect(queue.tasks()[0]?.state).toBe(expected);
    }
  });

  it("heartbeats long handlers and records unknown outcomes even after the original lease expires", async () => {
    const queue = new InMemoryDurableTaskQueue();
    queue.enqueue(task("long-handler"));
    await expect(
      runWorkerCycle({
        queue,
        workerId: "worker-heartbeat",
        leaseDurationMs: 1000,
        heartbeatIntervalMs: 100,
        handlers: new Map([
          [
            "safe_proxy.create",
            async ({ assertLease }) => {
              await new Promise((resolve) => setTimeout(resolve, 1100));
              assertLease();
              return {};
            },
          ],
        ]),
      }),
    ).resolves.toBe("succeeded");

    let now = new Date("2026-07-15T00:00:00.000Z");
    const delayed = new InMemoryDurableTaskQueue(() => now);
    const enqueued = delayed.enqueue(task("delayed-unknown")).task;
    await expect(
      runWorkerCycle({
        queue: delayed,
        workerId: "worker-delayed",
        leaseDurationMs: 1000,
        handlers: new Map([
          [
            "safe_proxy.create",
            () => {
              now = new Date(now.getTime() + 2000);
              return Promise.reject(new UnknownTaskOutcome(hash("observed")));
            },
          ],
        ]),
      }),
    ).resolves.toBe("unknown");
    expect(delayed.task(enqueued.taskId)).toMatchObject({
      state: "unknown",
      unknownReconciliationHash: hash("observed"),
    });
    expect(delayed.lease("worker-replacement", 1000)).toBeUndefined();
  });
});
