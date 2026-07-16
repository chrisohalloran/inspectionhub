import {
  ContentQuarantinePipeline,
  DeterministicSandboxDecoder,
  EvidenceSyncService,
  InMemoryPrivateObjectStore,
  InMemorySyncRepository,
  InMemoryUploadIntentStore,
  reconcileEvidence,
  sha256,
  type UploadDescriptor,
} from "../../packages/storage/src/index.js";
import {
  InMemoryDurableTaskQueue,
  runWorkerCycle,
  type TaskHandler,
} from "../../packages/task-queue/src/index.js";
import { describe, expect, it } from "vitest";

const organizationId = "soak-org";
const jobId = "soak-job";
const principal = {
  organizationId,
  actorId: "soak-inspector",
  assignedJobIds: new Set([jobId]),
};

function photo(index: number): Uint8Array {
  const width = 600 + (index % 100);
  const height = 400 + (index % 100);
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >>> 8) & 0xff,
    height & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0xff,
    0xd9,
  ]);
}

function audio(index: number): Uint8Array {
  const dataLength = 10 + index;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  bytes.set(Buffer.from("RIFF", "ascii"), 0);
  view.setUint32(4, 36 + dataLength, true);
  bytes.set(Buffer.from("WAVEfmt ", "ascii"), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 1000, true);
  view.setUint32(28, 1000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  bytes.set(Buffer.from("data", "ascii"), 36);
  view.setUint32(40, dataLength, true);
  return bytes;
}

describe("U6 deterministic 300-photo / 30-audio soak", () => {
  it("survives airplane capture, app restarts, boundary retries and worker loss without missing or duplicate identities", async () => {
    const offlineLedger: Array<{
      descriptor: UploadDescriptor;
      bytes: number[];
    }> = [];
    for (let index = 0; index < 330; index += 1) {
      const isPhoto = index < 300;
      const bytes = isPhoto ? photo(index) : audio(index - 300);
      offlineLedger.push({
        descriptor: {
          artifactId: `artifact-${String(index).padStart(3, "0")}`,
          captureId: `capture-${String(index).padStart(3, "0")}`,
          organizationId,
          jobId,
          captureSequence: index + 1,
          capturedAt: new Date(
            Date.UTC(2026, 6, 15, 0, 0, index),
          ).toISOString(),
          mediaType: isPhoto ? "image/jpeg" : "audio/wav",
          byteLength: bytes.byteLength,
          sha256: sha256(bytes),
        },
        bytes: [...bytes],
      });
    }

    // Airplane mode: all captures are durable in the simulated local ledger,
    // and no server object exists. JSON rehydration represents an app kill.
    const restoredLedger = JSON.parse(
      JSON.stringify(offlineLedger),
    ) as typeof offlineLedger;
    expect(restoredLedger).toHaveLength(330);

    let now = new Date("2026-07-15T01:00:00.000Z");
    const store = new InMemoryPrivateObjectStore();
    const queue = new InMemoryDurableTaskQueue(() => now);
    const repository = new InMemorySyncRepository(
      () => now,
      (input) => {
        const result = queue.enqueue(input);
        return { taskId: result.task.taskId, replayed: result.replayed };
      },
    );
    const intents = new InMemoryUploadIntentStore();
    const makeSyncAfterRestart = (afterObjectPut?: () => void) =>
      new EvidenceSyncService({
        store,
        repository,
        intents,
        ...(afterObjectPut === undefined ? {} : { afterObjectPut }),
      });

    for (const [index, local] of restoredLedger.entries()) {
      let sync = makeSyncAfterRestart();
      const intent = sync.issueUploadIntent(principal, local.descriptor);
      if (index % 3 === 0) sync = makeSyncAfterRestart(); // crash after intent
      const bytes = Uint8Array.from(local.bytes);
      if (index % 3 === 1) {
        await expect(
          makeSyncAfterRestart(() => {
            throw new Error("injected loss after object commit");
          }).upload(
            intent.intentId,
            intent.uploadToken,
            bytes,
            local.descriptor.mediaType,
          ),
        ).rejects.toThrow(/injected loss/);
        sync = makeSyncAfterRestart();
      }
      await sync.upload(
        intent.intentId,
        intent.uploadToken,
        bytes,
        local.descriptor.mediaType,
      );
      const committed = await sync.finalize(
        principal,
        intent.intentId,
        intent.uploadToken,
      );
      expect(committed.state).toBe("recorded");
      if (index % 3 === 2) {
        sync = makeSyncAfterRestart(); // response lost after commit
        const replay = await sync.finalize(
          principal,
          intent.intentId,
          intent.uploadToken,
        );
        expect(replay.state).toBe("duplicate_attempt");
      }
    }

    const pipeline = new ContentQuarantinePipeline({
      store,
      repository,
      decoder: new DeterministicSandboxDecoder(),
      now: () => now,
    });
    expect(queue.tasks()).toHaveLength(330);
    const handler: TaskHandler = async ({ task, checkpoint, assertLease }) => {
      const assessment = await pipeline.process(task.aggregateId, {
        assertLease,
      });
      checkpoint({
        name: "content.proxy_persisted",
        artifactRefs: [
          task.aggregateId,
          ...(assessment.safeProxyArtifactId === undefined
            ? []
            : [assessment.safeProxyArtifactId]),
        ],
      });
      return assessment.safeProxyArtifactId === undefined
        ? {}
        : { resultArtifactId: assessment.safeProxyArtifactId };
    };
    const handlers = new Map([["content.validate_and_proxy", handler]]);

    // Lose one worker after lease. The recreated worker recovers it under a
    // higher generation; the stale holder never commits.
    const lostLease = queue.lease("worker-before-restart", 1000);
    expect(lostLease).toBeDefined();
    now = new Date(now.getTime() + 1001);

    let completed = 0;
    while (completed < 330) {
      const result = await runWorkerCycle({
        queue,
        workerId: `worker-restart-${Math.floor(completed / 25)}`,
        leaseDurationMs: 1000,
        handlers,
      });
      expect(result).toBe("succeeded");
      completed += 1;
    }
    expect(
      queue.complete({
        taskId: lostLease?.task.taskId ?? "",
        generation: lostLease?.generation ?? 0,
        leaseToken: lostLease?.leaseToken ?? "",
      }),
    ).toBe(false);

    expect(repository.artifacts()).toHaveLength(330);
    expect(
      new Set(repository.artifacts().map(({ artifactId }) => artifactId)).size,
    ).toBe(330);
    expect(
      repository
        .artifacts()
        .every(({ artifactId }) => repository.hasDurabilityReceipt(artifactId)),
    ).toBe(true);
    expect(repository.proxies()).toHaveLength(330);
    expect(
      new Set(repository.proxies().map(({ artifactId }) => artifactId)).size,
    ).toBe(330);
    expect(queue.tasks().every(({ state }) => state === "succeeded")).toBe(
      true,
    );
    const reconciliation = await reconcileEvidence({
      organizationId,
      store,
      repository,
    });
    expect(
      reconciliation.filter(
        ({ state }) => state !== "consistent" && state !== "duplicate_attempt",
      ),
    ).toEqual([]);
    expect(
      reconciliation.filter(({ state }) => state === "consistent"),
    ).toHaveLength(330);
  }, 30_000);
});
