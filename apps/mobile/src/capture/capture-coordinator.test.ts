import { describe, expect, it } from "vitest";

import { InMemoryCaptureLedger } from "../storage/in-memory-capture-ledger.js";
import type { DurableFilePort } from "../storage/ports.js";
import { createCaptureCoordinator } from "./capture-coordinator.js";
import type { CaptureRequest } from "./types.js";

const request: CaptureRequest = {
  areaId: "area-main-bathroom",
  capturedAt: "2026-07-14T08:00:00.000Z",
  deviceId: "device-field-01",
  jobId: "job-demo",
  kind: "photo",
  permission: "granted",
  sequence: 12,
  sourceUri: "file:///temporary/photo-12.jpg",
};

function successfulFilePort(): DurableFilePort {
  return {
    persistCapture: ({ captureId }) =>
      Promise.resolve({
        byteLength: 2048,
        captureId,
        directorySync: "synced",
        fileUri: `file:///durable/${captureId}.capture`,
        immutable: true,
        ok: true,
        sha256: "a".repeat(64),
        storageBoundaryVersion: 1,
      }),
  };
}

describe("capture coordinator", () => {
  it("acknowledges only after the immutable file and ledger queue transaction exist", async () => {
    const ledger = new InMemoryCaptureLedger();
    const coordinator = createCaptureCoordinator({
      durableFiles: successfulFilePort(),
      idFactory: () => "capture-photo-12",
      ledger,
    });

    const result = await coordinator.capture(request);

    expect(result).toMatchObject({
      captureId: "capture-photo-12",
      kind: "acknowledged",
    });
    expect(ledger.getArtifact("capture-photo-12")).toMatchObject({
      immutable: true,
      queueLane: "photo_upload",
      sha256: "a".repeat(64),
    });
    expect(ledger.getQueue("capture-photo-12")).toMatchObject({
      lane: "photo_upload",
      state: "pending",
    });
  });

  it("records local durable-save latency from native persistence through ledger commit", async () => {
    const clockValues = [100, 640];
    const coordinator = createCaptureCoordinator({
      durableFiles: successfulFilePort(),
      idFactory: () => "capture-timed",
      ledger: new InMemoryCaptureLedger(),
      monotonicClock: () => clockValues.shift() ?? 640,
    });

    await expect(coordinator.capture(request)).resolves.toMatchObject({
      captureId: "capture-timed",
      kind: "acknowledged",
      localDurableSaveMs: 540,
    });
  });

  it("does not acknowledge when the native durability boundary fails", async () => {
    const ledger = new InMemoryCaptureLedger();
    const coordinator = createCaptureCoordinator({
      durableFiles: {
        persistCapture: ({ captureId }) =>
          Promise.resolve({
            captureId,
            error: {
              artifactState: "partial_preserved_debug",
              code: "PARTIAL_SYNC_FAILED",
              message: "injected",
              retryable: true,
              stage: "partial_sync",
            },
            ok: false,
            storageBoundaryVersion: 1,
          }),
      },
      idFactory: () => "capture-native-failure",
      ledger,
    });

    const result = await coordinator.capture(request);

    expect(result).toMatchObject({
      captureId: "capture-native-failure",
      fallback: "manual_note",
      kind: "failed",
      residue: "partial_possible",
    });
    expect(ledger.getArtifact("capture-native-failure")).toBeUndefined();
    expect(ledger.getQueue("capture-native-failure")).toBeUndefined();
    expect(ledger.getIntent("capture-native-failure")?.state).toBe("failed");
  });

  it("does not acknowledge when directory durability is unsupported", async () => {
    const ledger = new InMemoryCaptureLedger();
    const coordinator = createCaptureCoordinator({
      durableFiles: {
        persistCapture: ({ captureId }) =>
          Promise.resolve({
            byteLength: 2048,
            captureId,
            directorySync: "unsupported",
            fileUri: `file:///durable/${captureId}.capture`,
            immutable: true,
            ok: true,
            sha256: "a".repeat(64),
            storageBoundaryVersion: 1,
          }),
      },
      idFactory: () => "capture-directory-unsupported",
      ledger,
    });

    await expect(coordinator.capture(request)).resolves.toMatchObject({
      captureId: "capture-directory-unsupported",
      kind: "failed",
      reason: "native_durability_failed",
      residue: "final_without_artifact_ledger",
    });
    expect(ledger.getArtifact("capture-directory-unsupported")).toBeUndefined();
  });

  it("leaves a recoverable final-only boundary and no acknowledgement when the ledger commit fails", async () => {
    const ledger = new InMemoryCaptureLedger({ failNextCommit: true });
    const coordinator = createCaptureCoordinator({
      durableFiles: successfulFilePort(),
      idFactory: () => "capture-final-only",
      ledger,
    });

    const result = await coordinator.capture(request);

    expect(result).toMatchObject({
      captureId: "capture-final-only",
      kind: "failed",
      residue: "final_without_artifact_ledger",
    });
    expect(ledger.getArtifact("capture-final-only")).toBeUndefined();
    expect(ledger.getQueue("capture-final-only")).toBeUndefined();
    expect(ledger.getIntent("capture-final-only")?.state).toBe("pending");
  });

  it("keeps the committed identity recoverable when termination is injected after SQLite", async () => {
    const ledger = new InMemoryCaptureLedger();
    const coordinator = createCaptureCoordinator({
      boundaryHook: (boundary) => {
        if (boundary === "after_sqlite_commit") {
          throw new Error("simulated process termination");
        }
      },
      durableFiles: successfulFilePort(),
      idFactory: () => "capture-after-sqlite",
      ledger,
    });

    await expect(coordinator.capture(request)).rejects.toThrow(
      "simulated process termination",
    );
    expect(ledger.getArtifact("capture-after-sqlite")).toBeDefined();
    expect(ledger.getQueue("capture-after-sqlite")?.state).toBe("pending");
    expect(ledger.getIntent("capture-after-sqlite")?.state).toBe("durable");
  });

  it("exposes SQLite and acknowledgement boundaries in strict order", async () => {
    const boundaries: string[] = [];
    const ledger = new InMemoryCaptureLedger();
    const coordinator = createCaptureCoordinator({
      boundaryHook: (boundary) => {
        boundaries.push(boundary);
      },
      durableFiles: successfulFilePort(),
      idFactory: () => "capture-boundary-order",
      ledger,
    });

    await coordinator.capture(request);
    expect(boundaries).toEqual([
      "after_sqlite_commit",
      "after_acknowledgement",
    ]);
    expect(ledger.getIntent("capture-boundary-order")?.state).toBe(
      "acknowledged",
    );
  });

  it("treats a rejected native bridge call as an unknown residue that startup must reconcile", async () => {
    const ledger = new InMemoryCaptureLedger();
    const coordinator = createCaptureCoordinator({
      durableFiles: {
        persistCapture: () => Promise.reject(new Error("native process ended")),
      },
      idFactory: () => "capture-native-rejection",
      ledger,
    });

    const result = await coordinator.capture(request);

    expect(result).toMatchObject({
      captureId: "capture-native-rejection",
      kind: "failed",
      residue: "native_state_unknown",
    });
    expect(ledger.getArtifact("capture-native-rejection")).toBeUndefined();
    expect(ledger.getIntent("capture-native-rejection")).toMatchObject({
      failureCode: "NATIVE_BRIDGE_REJECTED",
      state: "failed",
    });
  });

  it("keeps photo and voice work independent while the first photo uploads", async () => {
    const ledger = new InMemoryCaptureLedger();
    const ids = ["capture-photo", "capture-voice"];
    const coordinator = createCaptureCoordinator({
      durableFiles: successfulFilePort(),
      idFactory: () => ids.shift() ?? "unexpected-id",
      ledger,
    });

    await coordinator.capture({ ...request, kind: "photo" });
    await ledger.applyQueueEvent("capture-photo", "begin_upload");
    await coordinator.capture({
      ...request,
      kind: "voice",
      sequence: 13,
      sourceUri: "file:///temporary/voice-13.m4a",
    });

    expect(ledger.listQueue("photo_upload")).toEqual([
      {
        captureId: "capture-photo",
        lane: "photo_upload",
        state: "uploading",
      },
    ]);
    expect(ledger.listQueue("voice_upload")).toEqual([
      {
        captureId: "capture-voice",
        lane: "voice_upload",
        state: "pending",
      },
    ]);
  });

  it("writes redacted append-only events without media paths or contents", async () => {
    const ledger = new InMemoryCaptureLedger();
    const coordinator = createCaptureCoordinator({
      durableFiles: successfulFilePort(),
      idFactory: () => "capture-redacted-events",
      ledger,
    });

    await coordinator.capture(request);

    expect(ledger.listEvents().map((event) => event.type)).toEqual([
      "capture_intent_reserved",
      "artifact_committed",
      "queue_enqueued",
      "capture_intent_state_changed",
    ]);
    expect(JSON.stringify(ledger.listEvents())).not.toContain(
      request.sourceUri,
    );
  });

  it("records ordinary photographs as private coverage without classification", async () => {
    const ledger = new InMemoryCaptureLedger();
    const coordinator = createCaptureCoordinator({
      durableFiles: successfulFilePort(),
      idFactory: () => "capture-private-coverage",
      ledger,
    });

    await coordinator.capture(request);

    expect(ledger.getIntent("capture-private-coverage")).toMatchObject({
      areaId: request.areaId,
      capturedAt: request.capturedAt,
      deviceId: request.deviceId,
      evidenceRole: "private_coverage",
      jobId: request.jobId,
      sequence: request.sequence,
    });
    expect(ledger.getIntent("capture-private-coverage")).not.toHaveProperty(
      "classification",
    );
  });

  it("blocks capture on a revoked device and offers a manual note on permission failure", async () => {
    const ledger = new InMemoryCaptureLedger();
    const coordinator = createCaptureCoordinator({
      durableFiles: successfulFilePort(),
      idFactory: () => "capture-blocked",
      ledger,
    });

    await expect(
      coordinator.capture({
        ...request,
        deviceState: "revoked",
      }),
    ).resolves.toMatchObject({ kind: "blocked", reason: "device_revoked" });
    await expect(
      coordinator.capture({
        ...request,
        permission: "denied",
      }),
    ).resolves.toMatchObject({
      fallback: "manual_note",
      kind: "blocked",
      reason: "camera_permission_denied",
    });
    expect(ledger.listIntents()).toHaveLength(0);
  });
});
