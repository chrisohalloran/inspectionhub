import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { safePathSegment, sha256, sha256Pattern } from "./hash.js";
import type { InMemorySyncRepository } from "./repository.js";
import type {
  DurabilityCommitResult,
  ImmutableObjectStore,
  SyncPrincipal,
  UploadDescriptor,
  UploadIntent,
} from "./types.js";
import { acceptedUploadMediaTypes } from "./types.js";

export interface PersistedUploadIntent extends Omit<
  UploadIntent,
  "uploadToken"
> {
  readonly tokenDigest: Uint8Array;
  uploaded: boolean;
  quarantineReasonCode?: "existing_object_divergence";
}

export interface UploadIntentPersistence {
  get(intentId: string): PersistedUploadIntent | undefined;
  save(intent: PersistedUploadIntent): void;
}

export class InMemoryUploadIntentStore implements UploadIntentPersistence {
  readonly #intents = new Map<string, PersistedUploadIntent>();

  get(intentId: string): PersistedUploadIntent | undefined {
    return this.#intents.get(intentId);
  }

  save(intent: PersistedUploadIntent): void {
    this.#intents.set(intent.intentId, intent);
  }
}

export class EvidenceSyncService {
  readonly #store: ImmutableObjectStore;
  readonly #repository: InMemorySyncRepository;
  readonly #intents: UploadIntentPersistence;
  readonly #now: () => Date;
  readonly #intentTtlMs: number;
  readonly #afterObjectPut: (() => void | Promise<void>) | undefined;

  constructor(options: {
    store: ImmutableObjectStore;
    repository: InMemorySyncRepository;
    now?: () => Date;
    intentTtlMs?: number;
    intents?: UploadIntentPersistence;
    /** Deterministic crash-injection seam for the object/intent boundary. */
    afterObjectPut?: () => void | Promise<void>;
  }) {
    this.#store = options.store;
    this.#repository = options.repository;
    this.#now = options.now ?? (() => new Date());
    this.#intentTtlMs = options.intentTtlMs ?? 5 * 60_000;
    this.#intents = options.intents ?? new InMemoryUploadIntentStore();
    this.#afterObjectPut = options.afterObjectPut;
  }

  issueUploadIntent(
    principal: SyncPrincipal,
    descriptor: UploadDescriptor,
  ): UploadIntent {
    validateDescriptor(descriptor);
    assertTenantJobAccess(
      principal,
      descriptor.organizationId,
      descriptor.jobId,
    );
    const intentId = randomUUID();
    const uploadToken = randomBytes(32).toString("base64url");
    const extension = extensionFor(descriptor.mediaType);
    const storageKey = [
      "quarantine",
      safePathSegment(descriptor.organizationId, "organizationId"),
      safePathSegment(descriptor.jobId, "jobId"),
      safePathSegment(descriptor.captureId, "captureId"),
      `${safePathSegment(descriptor.artifactId, "artifactId")}.${extension}`,
    ].join("/");
    const persistedIntent: PersistedUploadIntent = {
      intentId,
      tokenDigest: Buffer.from(sha256(Buffer.from(uploadToken)), "hex"),
      storageKey,
      expiresAt: new Date(
        this.#now().getTime() + this.#intentTtlMs,
      ).toISOString(),
      descriptor: Object.freeze({ ...descriptor }),
      uploaded: false,
    };
    this.#intents.save(persistedIntent);
    return Object.freeze({
      intentId,
      uploadToken,
      storageKey,
      expiresAt: persistedIntent.expiresAt,
      descriptor: persistedIntent.descriptor,
    });
  }

  async upload(
    intentId: string,
    uploadToken: string,
    bytes: Uint8Array,
    claimedMediaType: string,
  ): Promise<{ readonly objectVersion: string }> {
    const intent = this.#authoriseIntent(intentId, uploadToken);
    if (claimedMediaType !== intent.descriptor.mediaType) {
      throw new Error("Upload media type does not match the intent");
    }
    if (bytes.byteLength !== intent.descriptor.byteLength) {
      throw new Error("Upload byte length does not match the intent");
    }
    // The upload boundary performs an early checksum check, but finalisation
    // deliberately performs another independent object read and hash.
    if (sha256(bytes) !== intent.descriptor.sha256) {
      throw new Error("Upload checksum does not match the intent");
    }
    const existing = await this.#store.head(intent.storageKey);
    if (existing !== undefined) {
      const adopted = await this.#observeExactObject(intent);
      intent.uploaded = true;
      return { objectVersion: adopted.version };
    }

    let object;
    try {
      object = await this.#store.putImmutable(
        intent.storageKey,
        bytes,
        claimedMediaType,
      );
    } catch (error) {
      // A concurrent uploader may have won after our head check. Only adopt it
      // after an independent exact-byte observation; all divergence fails shut.
      if ((await this.#store.head(intent.storageKey)) === undefined)
        throw error;
      const adopted = await this.#observeExactObject(intent);
      intent.uploaded = true;
      return { objectVersion: adopted.version };
    }
    await this.#afterObjectPut?.();
    intent.uploaded = true;
    return { objectVersion: object.version };
  }

  async finalize(
    principal: SyncPrincipal,
    intentId: string,
    uploadToken: string,
  ): Promise<DurabilityCommitResult> {
    const intent = this.#authoriseIntent(intentId, uploadToken, true);
    assertTenantJobAccess(
      principal,
      intent.descriptor.organizationId,
      intent.descriptor.jobId,
    );
    const metadata = await this.#observeExactObject(intent);
    intent.uploaded = true;
    const bytes = await this.#store.read(intent.storageKey);
    if (bytes === undefined)
      throw new Error("Uploaded object is not independently readable");
    const observedByteLength = bytes.byteLength;
    const observedSha256 = sha256(bytes);
    return this.#repository.commitVerifiedDurability({
      descriptor: intent.descriptor,
      storageKey: intent.storageKey,
      objectVersion: metadata.version,
      observedSha256,
      observedByteLength,
    });
  }

  async #observeExactObject(
    intent: PersistedUploadIntent,
  ): Promise<NonNullable<Awaited<ReturnType<ImmutableObjectStore["head"]>>>> {
    const metadata = await this.#store.head(intent.storageKey);
    const bytes = await this.#store.read(intent.storageKey);
    if (metadata === undefined || bytes === undefined) {
      throw new Error("Object upload has not completed or is not readable");
    }
    const diverged =
      metadata.key !== intent.storageKey ||
      metadata.mediaType !== intent.descriptor.mediaType ||
      metadata.byteLength !== bytes.byteLength ||
      intent.descriptor.byteLength !== bytes.byteLength ||
      intent.descriptor.sha256 !== sha256(bytes);
    if (diverged) {
      intent.quarantineReasonCode = "existing_object_divergence";
      throw new Error(
        "Independent object verification failed; existing object remains quarantined",
      );
    }
    return metadata;
  }

  #authoriseIntent(
    intentId: string,
    uploadToken: string,
    allowExpiredAfterUpload = false,
  ): PersistedUploadIntent {
    const intent = this.#intents.get(intentId);
    if (intent === undefined) throw new Error("Upload intent was not found");
    const supplied = Buffer.from(sha256(Buffer.from(uploadToken)), "hex");
    if (
      supplied.byteLength !== intent.tokenDigest.byteLength ||
      !timingSafeEqual(supplied, intent.tokenDigest)
    ) {
      throw new Error("Upload intent token is invalid");
    }
    if (
      !allowExpiredAfterUpload &&
      this.#now().getTime() >= Date.parse(intent.expiresAt)
    ) {
      throw new Error("Upload intent has expired");
    }
    return intent;
  }
}

function validateDescriptor(descriptor: UploadDescriptor): void {
  safePathSegment(descriptor.organizationId, "organizationId");
  safePathSegment(descriptor.jobId, "jobId");
  safePathSegment(descriptor.artifactId, "artifactId");
  safePathSegment(descriptor.captureId, "captureId");
  if (!acceptedUploadMediaTypes.includes(descriptor.mediaType)) {
    throw new Error("Upload descriptor media type is not supported");
  }
  if (!sha256Pattern.test(descriptor.sha256)) {
    throw new Error("Upload descriptor sha256 is invalid");
  }
  if (
    !Number.isSafeInteger(descriptor.byteLength) ||
    descriptor.byteLength < 1 ||
    descriptor.byteLength > 250 * 1024 * 1024
  ) {
    throw new Error("Upload descriptor byte length is outside policy");
  }
  if (
    !Number.isSafeInteger(descriptor.captureSequence) ||
    descriptor.captureSequence < 1
  ) {
    throw new Error("Upload capture sequence is invalid");
  }
  if (!Number.isFinite(Date.parse(descriptor.capturedAt))) {
    throw new Error("Upload capturedAt timestamp is invalid");
  }
}

function assertTenantJobAccess(
  principal: SyncPrincipal,
  organizationId: string,
  jobId: string,
): void {
  if (
    principal.organizationId !== organizationId ||
    !principal.assignedJobIds.has(jobId)
  ) {
    throw new Error("Tenant or assigned-job scope denied");
  }
}

function extensionFor(mediaType: UploadDescriptor["mediaType"]): string {
  switch (mediaType) {
    case "image/jpeg":
      return "jpg";
    case "image/heic":
      return "heic";
    case "audio/m4a":
      return "m4a";
    case "audio/wav":
      return "wav";
  }
}
