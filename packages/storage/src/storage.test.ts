import { describe, expect, it } from "vitest";

import {
  ContentQuarantinePipeline,
  DeterministicSandboxDecoder,
  EvidenceSyncService,
  InMemoryPrivateObjectStore,
  InMemorySyncRepository,
  reconcileEvidence,
  sha256,
  type ImmutableObjectStore,
  type SyncPrincipal,
  type UploadDescriptor,
} from "./index.js";

const organizationId = "org-alpha";
const jobId = "job-one";
const principal: SyncPrincipal = {
  organizationId,
  actorId: "inspector-one",
  assignedJobIds: new Set([jobId]),
};

function jpeg(width = 640, height = 480, trailer = ""): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe1,
    0x00,
    0x0a,
    ...Buffer.from("ExifGPS!", "ascii"),
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
    ...Buffer.from(trailer, "latin1"),
  ]);
}

function wav(durationMs = 10): Uint8Array {
  const dataLength = durationMs;
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

function descriptor(
  artifactId: string,
  captureId: string,
  bytes: Uint8Array,
  overrides: Partial<UploadDescriptor> = {},
): UploadDescriptor {
  return {
    artifactId,
    captureId,
    organizationId,
    jobId,
    captureSequence: 1,
    capturedAt: "2026-07-15T00:00:00.000Z",
    mediaType: "image/jpeg",
    byteLength: bytes.byteLength,
    sha256: sha256(bytes),
    ...overrides,
  };
}

async function durableFixture(
  artifactId = "artifact-one",
  captureId = "capture-one",
  bytes = jpeg(),
  overrides: Partial<UploadDescriptor> = {},
) {
  const store = new InMemoryPrivateObjectStore();
  const repository = new InMemorySyncRepository();
  const sync = new EvidenceSyncService({ store, repository });
  const intent = sync.issueUploadIntent(
    principal,
    descriptor(artifactId, captureId, bytes, overrides),
  );
  await sync.upload(
    intent.intentId,
    intent.uploadToken,
    bytes,
    overrides.mediaType ?? "image/jpeg",
  );
  const result = await sync.finalize(
    principal,
    intent.intentId,
    intent.uploadToken,
  );
  return { store, repository, sync, intent, result, bytes };
}

describe("tenant-scoped evidence sync", () => {
  it("stages into an immutable tenant/job key and independently verifies read, length and hash", async () => {
    const bytes = jpeg();
    const store = new InMemoryPrivateObjectStore();
    const repository = new InMemorySyncRepository();
    const sync = new EvidenceSyncService({ store, repository });
    const intent = sync.issueUploadIntent(
      principal,
      descriptor("artifact-one", "capture-one", bytes),
    );
    expect(intent.storageKey).toBe(
      "quarantine/org-alpha/job-one/capture-one/artifact-one.jpg",
    );
    await sync.upload(intent.intentId, intent.uploadToken, bytes, "image/jpeg");
    await expect(
      sync.finalize(principal, intent.intentId, intent.uploadToken),
    ).resolves.toMatchObject({ state: "recorded" });
    expect(repository.events()).toEqual([
      expect.objectContaining({ eventType: "artifact.durability_verified" }),
    ]);
    expect(repository.outbox()).toEqual([
      expect.objectContaining({
        action: "content.validate_and_proxy",
        state: "pending_dispatch",
        observedResult: "task_sink_unbound",
      }),
    ]);
    expect(JSON.stringify(repository.events())).not.toContain("ExifGPS");
  });

  it("fails wrong tenant, job, token, MIME, byte length, divergent overwrite and mutation", async () => {
    const bytes = jpeg();
    const store = new InMemoryPrivateObjectStore();
    const repository = new InMemorySyncRepository();
    const sync = new EvidenceSyncService({ store, repository });
    expect(() =>
      sync.issueUploadIntent(
        { ...principal, organizationId: "org-beta" },
        descriptor("artifact-one", "capture-one", bytes),
      ),
    ).toThrow(/scope denied/);
    expect(() =>
      sync.issueUploadIntent(principal, {
        ...descriptor("artifact-unsupported", "capture-unsupported", bytes),
        mediaType: "text/plain",
      } as never),
    ).toThrow(/not supported/);
    expect(() =>
      sync.issueUploadIntent(
        { ...principal, assignedJobIds: new Set() },
        descriptor("artifact-one", "capture-one", bytes),
      ),
    ).toThrow(/scope denied/);
    const intent = sync.issueUploadIntent(
      principal,
      descriptor("artifact-one", "capture-one", bytes),
    );
    await expect(
      sync.upload(intent.intentId, "wrong", bytes, "image/jpeg"),
    ).rejects.toThrow(/token/);
    await expect(
      sync.upload(intent.intentId, intent.uploadToken, bytes, "audio/wav"),
    ).rejects.toThrow(/media type/);
    await expect(
      sync.upload(
        intent.intentId,
        intent.uploadToken,
        bytes.slice(1),
        "image/jpeg",
      ),
    ).rejects.toThrow(/byte length/);
    const changed = Uint8Array.from(bytes);
    changed[changed.length - 1] = 7;
    await expect(
      sync.upload(intent.intentId, intent.uploadToken, changed, "image/jpeg"),
    ).rejects.toThrow(/checksum/);
    await sync.upload(intent.intentId, intent.uploadToken, bytes, "image/jpeg");
    const replayedUpload = await sync.upload(
      intent.intentId,
      intent.uploadToken,
      bytes,
      "image/jpeg",
    );
    expect(replayedUpload.objectVersion).toEqual(expect.any(String));
    await expect(
      store.putImmutable(intent.storageKey, bytes, "image/jpeg"),
    ).rejects.toThrow(/already exists/);
    store.corruptForTest(intent.storageKey, changed);
    await expect(
      sync.finalize(principal, intent.intentId, intent.uploadToken),
    ).rejects.toThrow(/verification failed/);
  });

  it("adopts an exact immutable object after a crash between object commit and intent state", async () => {
    const bytes = jpeg();
    const store = new InMemoryPrivateObjectStore();
    const repository = new InMemorySyncRepository();
    let crashOnce = true;
    const sync = new EvidenceSyncService({
      store,
      repository,
      afterObjectPut: () => {
        if (crashOnce) {
          crashOnce = false;
          throw new Error("injected process loss after object commit");
        }
      },
    });
    const intent = sync.issueUploadIntent(
      principal,
      descriptor("artifact-boundary", "capture-boundary", bytes),
    );

    await expect(
      sync.upload(intent.intentId, intent.uploadToken, bytes, "image/jpeg"),
    ).rejects.toThrow(/injected process loss/);
    expect(await store.head(intent.storageKey)).toBeDefined();
    const adoptedUpload = await sync.upload(
      intent.intentId,
      intent.uploadToken,
      bytes,
      "image/jpeg",
    );
    expect(adoptedUpload.objectVersion).toEqual(expect.any(String));
    await expect(
      sync.finalize(principal, intent.intentId, intent.uploadToken),
    ).resolves.toMatchObject({ state: "recorded" });
  });

  it("keeps artifact identity distinct from hash and quarantines capture-ID divergence", async () => {
    const bytes = jpeg();
    const store = new InMemoryPrivateObjectStore();
    const repository = new InMemorySyncRepository();
    const sync = new EvidenceSyncService({ store, repository });
    for (const [artifactId, captureId] of [
      ["artifact-one", "capture-one"],
      ["artifact-two", "capture-two"],
    ] as const) {
      const intent = sync.issueUploadIntent(
        principal,
        descriptor(artifactId, captureId, bytes),
      );
      await sync.upload(
        intent.intentId,
        intent.uploadToken,
        bytes,
        "image/jpeg",
      );
      await sync.finalize(principal, intent.intentId, intent.uploadToken);
    }
    expect(repository.artifacts()).toHaveLength(2);
    expect(repository.outbox()).toHaveLength(2);
    expect(
      new Set(repository.artifacts().map(({ sha256 }) => sha256)),
    ).toHaveProperty("size", 1);

    const retry = sync.issueUploadIntent(
      principal,
      descriptor("artifact-retry", "capture-one", bytes),
    );
    await sync.upload(retry.intentId, retry.uploadToken, bytes, "image/jpeg");
    await expect(
      sync.finalize(principal, retry.intentId, retry.uploadToken),
    ).resolves.toMatchObject({ state: "duplicate_attempt" });
    expect(repository.artifacts()).toHaveLength(2);

    const changed = jpeg(641, 480);
    const divergent = sync.issueUploadIntent(
      principal,
      descriptor("artifact-divergent", "capture-one", changed),
    );
    await sync.upload(
      divergent.intentId,
      divergent.uploadToken,
      changed,
      "image/jpeg",
    );
    await expect(
      sync.finalize(principal, divergent.intentId, divergent.uploadToken),
    ).resolves.toMatchObject({ state: "hash_divergence" });
    expect(repository.artifacts()).toHaveLength(2);
  });

  it("lets finalisation recover after the short-lived upload capability expires", async () => {
    let now = new Date("2026-07-15T00:00:00.000Z");
    const bytes = jpeg();
    const store = new InMemoryPrivateObjectStore(() => now);
    const repository = new InMemorySyncRepository(() => now);
    const sync = new EvidenceSyncService({
      store,
      repository,
      now: () => now,
      intentTtlMs: 1000,
    });
    const intent = sync.issueUploadIntent(
      principal,
      descriptor("artifact-one", "capture-one", bytes),
    );
    await sync.upload(intent.intentId, intent.uploadToken, bytes, "image/jpeg");
    now = new Date("2026-07-15T00:00:02.000Z");
    await expect(
      sync.finalize(principal, intent.intentId, intent.uploadToken),
    ).resolves.toMatchObject({ state: "recorded" });
  });
});

describe("quarantine and safe proxies", () => {
  it("keeps the original quarantined, strips metadata and exposes only the re-encoded proxy", async () => {
    const fixture = await durableFixture();
    expect(fixture.repository.trustedProxyFor("artifact-one")).toBeUndefined();
    const pipeline = new ContentQuarantinePipeline({
      store: fixture.store,
      repository: fixture.repository,
      decoder: new DeterministicSandboxDecoder(),
    });
    await expect(pipeline.process("artifact-one")).resolves.toMatchObject({
      state: "accepted",
      width: 640,
      height: 480,
    });
    const proxy = fixture.repository.trustedProxyFor("artifact-one");
    expect(proxy).toMatchObject({
      parentArtifactId: "artifact-one",
      trustState: "safe_proxy",
    });
    const proxyBytes = await fixture.store.read(proxy?.storageKey ?? "");
    expect(Buffer.from(proxyBytes ?? []).toString("latin1")).not.toContain(
      "Exif",
    );
    expect(proxy?.sha256).not.toBe(fixture.result.artifact.sha256);
  });

  it.each([
    ["MIME/magic mismatch", wav(), "mime_magic_mismatch"],
    [
      "active/polyglot JPEG",
      jpeg(640, 480, "<script>alert(1)</script>"),
      "active_or_polyglot_format",
    ],
    [
      "malformed parser input",
      Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 50, 1]),
      "sandbox_decoder_failed",
    ],
  ])(
    "rejects %s while preserving the durable original",
    async (_name, bytes, reasonCode) => {
      const fixture = await durableFixture(
        "artifact-one",
        "capture-one",
        bytes,
      );
      const pipeline = new ContentQuarantinePipeline({
        store: fixture.store,
        repository: fixture.repository,
        decoder: new DeterministicSandboxDecoder(),
      });
      await expect(pipeline.process("artifact-one")).resolves.toMatchObject({
        state: "rejected",
        reasonCode,
      });
      expect(fixture.repository.artifact("artifact-one")).toBeDefined();
      expect(
        fixture.repository.trustedProxyFor("artifact-one"),
      ).toBeUndefined();
    },
  );

  it("fences both terminal rejection and accepted trust commits", async () => {
    const invalid = await durableFixture(
      "artifact-rejected-fence",
      "capture-rejected-fence",
      wav(),
    );
    const rejectionPipeline = new ContentQuarantinePipeline({
      store: invalid.store,
      repository: invalid.repository,
      decoder: new DeterministicSandboxDecoder(),
    });
    await expect(
      rejectionPipeline.process("artifact-rejected-fence", {
        assertLease: () => {
          throw new Error("stale lease");
        },
      }),
    ).rejects.toThrow(/stale lease/);
    expect(
      invalid.repository.assessment("artifact-rejected-fence"),
    ).toBeUndefined();

    const accepted = await durableFixture(
      "artifact-proxy-observation",
      "capture-proxy-observation",
    );
    const corruptingStore: ImmutableObjectStore = {
      head: (key) => accepted.store.head(key),
      read: (key) => accepted.store.read(key),
      list: (prefix) => accepted.store.list(prefix),
      putImmutable: async (key, bytes, mediaType) => {
        const metadata = await accepted.store.putImmutable(
          key,
          bytes,
          mediaType,
        );
        if (key.startsWith("safe/"))
          accepted.store.corruptForTest(key, jpeg(1, 1));
        return metadata;
      },
    };
    const acceptancePipeline = new ContentQuarantinePipeline({
      store: corruptingStore,
      repository: accepted.repository,
      decoder: new DeterministicSandboxDecoder(),
    });
    await expect(
      acceptancePipeline.process("artifact-proxy-observation"),
    ).rejects.toThrow(/durability verification/);
    expect(
      accepted.repository.assessment("artifact-proxy-observation"),
    ).toBeUndefined();
  });

  it("rejects dimension and duration bombs using configured policy", async () => {
    const image = await durableFixture(
      "image-bomb",
      "capture-image",
      jpeg(500, 500),
    );
    const imagePipeline = new ContentQuarantinePipeline({
      store: image.store,
      repository: image.repository,
      decoder: new DeterministicSandboxDecoder(),
      policy: {
        maxImageBytes: 1000,
        maxAudioBytes: 1000,
        maxImageWidth: 100,
        maxImageHeight: 100,
        maxImagePixels: 10_000,
        maxAudioDurationMs: 100,
      },
    });
    await expect(imagePipeline.process("image-bomb")).resolves.toMatchObject({
      state: "rejected",
      reasonCode: "dimension_limit_exceeded",
    });

    const audioBytes = wav(200);
    const audio = await durableFixture(
      "audio-bomb",
      "capture-audio",
      audioBytes,
    );
    // The helper describes JPEG; construct a separate audio fixture explicitly.
    const audioStore = new InMemoryPrivateObjectStore();
    const audioRepository = new InMemorySyncRepository();
    const audioSync = new EvidenceSyncService({
      store: audioStore,
      repository: audioRepository,
    });
    const intent = audioSync.issueUploadIntent(
      principal,
      descriptor("audio-bomb-2", "capture-audio-2", audioBytes, {
        mediaType: "audio/wav",
      }),
    );
    await audioSync.upload(
      intent.intentId,
      intent.uploadToken,
      audioBytes,
      "audio/wav",
    );
    await audioSync.finalize(principal, intent.intentId, intent.uploadToken);
    const audioPipeline = new ContentQuarantinePipeline({
      store: audioStore,
      repository: audioRepository,
      decoder: new DeterministicSandboxDecoder(),
      policy: {
        maxImageBytes: 1000,
        maxAudioBytes: 1000,
        maxImageWidth: 100,
        maxImageHeight: 100,
        maxImagePixels: 10_000,
        maxAudioDurationMs: 100,
      },
    });
    await expect(audioPipeline.process("audio-bomb-2")).resolves.toMatchObject({
      state: "rejected",
      reasonCode: "duration_limit_exceeded",
    });
    expect(audio.repository.artifact("audio-bomb")).toBeDefined();
  });

  it("probes HEIC and M4A containers through the sandbox adapter before proxying", async () => {
    const heic = new Uint8Array(32);
    heic.set(Buffer.from("ftypheic", "ascii"), 4);
    heic.set(Buffer.from("ispe", "ascii"), 12);
    new DataView(heic.buffer).setUint32(20, 4032, false);
    new DataView(heic.buffer).setUint32(24, 3024, false);
    const image = await durableFixture("heic-one", "capture-heic", heic, {
      mediaType: "image/heic",
    });
    const imagePipeline = new ContentQuarantinePipeline({
      store: image.store,
      repository: image.repository,
      decoder: new DeterministicSandboxDecoder(),
    });
    await expect(imagePipeline.process("heic-one")).resolves.toMatchObject({
      state: "accepted",
      width: 4032,
      height: 3024,
    });

    const m4a = new Uint8Array(44);
    m4a.set(Buffer.from("ftypM4A ", "ascii"), 4);
    m4a.set(Buffer.from("mvhd", "ascii"), 16);
    const m4aView = new DataView(m4a.buffer);
    m4aView.setUint32(32, 1000, false);
    m4aView.setUint32(36, 5000, false);
    const audioFixture = await durableFixture("m4a-one", "capture-m4a", m4a, {
      mediaType: "audio/m4a",
    });
    const audioPipeline = new ContentQuarantinePipeline({
      store: audioFixture.store,
      repository: audioFixture.repository,
      decoder: new DeterministicSandboxDecoder(),
    });
    await expect(audioPipeline.process("m4a-one")).resolves.toMatchObject({
      state: "accepted",
      durationMs: 5000,
    });
  });
});

describe("evidence reconciliation", () => {
  it("independently detects missing and divergent accepted safe proxies", async () => {
    const missing = await durableFixture("original-missing", "capture-missing");
    const missingPipeline = new ContentQuarantinePipeline({
      store: missing.store,
      repository: missing.repository,
      decoder: new DeterministicSandboxDecoder(),
    });
    await missingPipeline.process("original-missing");
    const missingProxy = missing.repository.trustedProxyFor("original-missing");
    missing.store.removeForTest(missingProxy?.storageKey ?? "");
    await expect(
      reconcileEvidence({
        organizationId,
        store: missing.store,
        repository: missing.repository,
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "missing_object",
          artifactId: missingProxy?.artifactId,
        }),
      ]),
    );

    const divergent = await durableFixture(
      "original-divergent",
      "capture-divergent",
    );
    const divergentPipeline = new ContentQuarantinePipeline({
      store: divergent.store,
      repository: divergent.repository,
      decoder: new DeterministicSandboxDecoder(),
    });
    await divergentPipeline.process("original-divergent");
    const divergentProxy =
      divergent.repository.trustedProxyFor("original-divergent");
    divergent.store.corruptForTest(
      divergentProxy?.storageKey ?? "",
      jpeg(1, 1),
    );
    await expect(
      reconcileEvidence({
        organizationId,
        store: divergent.store,
        repository: divergent.repository,
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "divergent_checksum",
          artifactId: divergentProxy?.artifactId,
        }),
      ]),
    );
  });

  it("makes object, row, missing, divergent, duplicate, unknown, quarantine and suppression states literal", async () => {
    const fixture = await durableFixture();
    const secondBytes = jpeg(320, 240);
    const second = fixture.sync.issueUploadIntent(
      principal,
      descriptor("artifact-two", "capture-two", secondBytes),
    );
    await fixture.sync.upload(
      second.intentId,
      second.uploadToken,
      secondBytes,
      "image/jpeg",
    );
    await fixture.sync.finalize(principal, second.intentId, second.uploadToken);
    fixture.repository.removeReceiptForTest("artifact-two");

    const thirdBytes = jpeg(800, 600);
    const third = fixture.sync.issueUploadIntent(
      principal,
      descriptor("artifact-three", "capture-three", thirdBytes),
    );
    await fixture.sync.upload(
      third.intentId,
      third.uploadToken,
      thirdBytes,
      "image/jpeg",
    );
    await fixture.sync.finalize(principal, third.intentId, third.uploadToken);

    const duplicate = fixture.sync.issueUploadIntent(
      principal,
      descriptor("artifact-retry", "capture-one", fixture.bytes),
    );
    await fixture.sync.upload(
      duplicate.intentId,
      duplicate.uploadToken,
      fixture.bytes,
      "image/jpeg",
    );
    await fixture.sync.finalize(
      principal,
      duplicate.intentId,
      duplicate.uploadToken,
    );
    fixture.repository.recordUnknownProvider("provider/openai/run-one");

    const orphanKey = "quarantine/org-alpha/job-one/orphan/orphan.jpg";
    await fixture.store.putImmutable(orphanKey, jpeg(10, 10), "image/jpeg");
    const suppressedKey = "quarantine/org-alpha/job-one/deleted/deleted.jpg";
    await fixture.store.putImmutable(suppressedKey, jpeg(10, 10), "image/jpeg");
    fixture.repository.suppressDeletion(suppressedKey);

    fixture.store.corruptForTest(fixture.intent.storageKey, jpeg(1, 1));
    const states = (
      await reconcileEvidence({
        organizationId,
        store: fixture.store,
        repository: fixture.repository,
      })
    ).map(({ state }) => state);
    expect(states).toEqual(
      expect.arrayContaining([
        "divergent_checksum",
        "row_only",
        "object_only",
        "deletion_suppression",
        "duplicate_attempt",
        "unknown_provider",
        "content_quarantine",
      ]),
    );

    fixture.store.removeForTest(second.storageKey);
    const afterRemoval = await reconcileEvidence({
      organizationId,
      store: fixture.store,
      repository: fixture.repository,
    });
    expect(afterRemoval).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: "missing_object" }),
      ]),
    );
  });
});
