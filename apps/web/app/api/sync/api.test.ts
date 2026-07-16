import { sha256 } from "@inspection/storage";
import { runWorkerCycle, type TaskHandler } from "@inspection/task-queue";
import { describe, expect, it } from "vitest";

import { POST as finalize } from "./finalize/route.js";
import { POST as issue } from "./intents/route.js";
import { PUT as upload } from "./objects/[intentId]/route.js";
import { POST as reconcile } from "./reconcile/route.js";
import { getSyncRuntime } from "./_shared/runtime.js";

const headers = {
  "x-sync-test-actor": "inspector-one",
  "x-organization-id": "org-api",
  "x-assigned-job-ids": "job-api",
};

function jpeg(): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x01,
    0x01, 0xff, 0xd9,
  ]);
}

describe("sync API boundary", () => {
  it("requires an authenticated tenant/job scope", async () => {
    const response = await issue(
      new Request("http://local/api/sync/intents", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
  });

  it("runs intent, staged upload, independent finalisation and reconciliation", async () => {
    const bytes = jpeg();
    const intentResponse = await issue(
      new Request("http://local/api/sync/intents", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          artifactId: "artifact-api",
          captureId: "capture-api",
          organizationId: "org-api",
          jobId: "job-api",
          captureSequence: 1,
          capturedAt: "2026-07-15T00:00:00.000Z",
          mediaType: "image/jpeg",
          byteLength: bytes.byteLength,
          sha256: sha256(bytes),
        }),
      }),
    );
    expect(intentResponse.status).toBe(201);
    const { intent } = (await intentResponse.json()) as {
      intent: { intentId: string; uploadToken: string };
    };
    const uploadResponse = await upload(
      new Request(`http://local/api/sync/objects/${intent.intentId}`, {
        method: "PUT",
        headers: {
          "content-type": "image/jpeg",
          "x-upload-token": intent.uploadToken,
        },
        body: Buffer.from(bytes),
      }),
      { params: Promise.resolve({ intentId: intent.intentId }) },
    );
    expect(uploadResponse.status).toBe(201);
    const finalResponse = await finalize(
      new Request("http://local/api/sync/finalize", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(intent),
      }),
    );
    expect(finalResponse.status).toBe(200);
    await expect(finalResponse.json()).resolves.toMatchObject({
      result: { state: "recorded" },
      contentState: "durable_pending_quarantine_validation",
    });
    const runtime = getSyncRuntime();
    expect(runtime.queue.tasks()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          aggregateId: "artifact-api",
          taskType: "content.validate_and_proxy",
          state: "queued",
        }),
      ]),
    );
    const handler: TaskHandler = async ({ task, assertLease, checkpoint }) => {
      const assessment = await runtime.content.process(task.aggregateId, {
        assertLease,
      });
      checkpoint({
        name: "content.safe_proxy_persisted",
        artifactRefs: [
          assessment.artifactId,
          ...(assessment.safeProxyArtifactId === undefined
            ? []
            : [assessment.safeProxyArtifactId]),
        ],
      });
      return assessment.safeProxyArtifactId === undefined
        ? {}
        : { resultArtifactId: assessment.safeProxyArtifactId };
    };
    await expect(
      runWorkerCycle({
        queue: runtime.queue,
        workerId: "api-test-worker",
        leaseDurationMs: 1000,
        handlers: new Map([["content.validate_and_proxy", handler]]),
      }),
    ).resolves.toBe("succeeded");
    const reconciliation = await reconcile(
      new Request("http://local/api/sync/reconcile", {
        method: "POST",
        headers,
      }),
    );
    await expect(reconciliation.json()).resolves.toMatchObject({
      findings: [expect.objectContaining({ state: "consistent" })],
    });
  });
});
