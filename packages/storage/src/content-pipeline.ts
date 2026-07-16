import { randomUUID } from "node:crypto";

import { sha256 } from "./hash.js";
import type { InMemorySyncRepository } from "./repository.js";
import type {
  ContentAssessment,
  DurableArtifactRecord,
  ImmutableObjectStore,
  SafeProxyRecord,
  UploadMediaType,
} from "./types.js";

export interface DecodedMedia {
  readonly observedMediaType: UploadMediaType;
  readonly width?: number;
  readonly height?: number;
  readonly durationMs?: number;
  readonly proxyMediaType: "image/jpeg" | "audio/wav";
  readonly proxyBytes: Uint8Array;
}

export interface SandboxedMediaDecoder {
  readonly version: string;
  probeAndReencode(
    bytes: Uint8Array,
    claimedMediaType: UploadMediaType,
  ): Promise<DecodedMedia>;
}

export interface ContentPolicy {
  readonly maxImageBytes: number;
  readonly maxAudioBytes: number;
  readonly maxImageWidth: number;
  readonly maxImageHeight: number;
  readonly maxImagePixels: number;
  readonly maxAudioDurationMs: number;
}

export const launchContentPolicy: ContentPolicy = Object.freeze({
  maxImageBytes: 50 * 1024 * 1024,
  maxAudioBytes: 250 * 1024 * 1024,
  maxImageWidth: 20_000,
  maxImageHeight: 20_000,
  maxImagePixels: 100_000_000,
  maxAudioDurationMs: 2 * 60 * 60 * 1000,
});

export class ContentQuarantinePipeline {
  readonly #store: ImmutableObjectStore;
  readonly #repository: InMemorySyncRepository;
  readonly #decoder: SandboxedMediaDecoder;
  readonly #policy: ContentPolicy;
  readonly #now: () => Date;

  constructor(options: {
    store: ImmutableObjectStore;
    repository: InMemorySyncRepository;
    decoder: SandboxedMediaDecoder;
    policy?: ContentPolicy;
    now?: () => Date;
  }) {
    this.#store = options.store;
    this.#repository = options.repository;
    this.#decoder = options.decoder;
    this.#policy = options.policy ?? launchContentPolicy;
    this.#now = options.now ?? (() => new Date());
  }

  async process(
    artifactId: string,
    options: { readonly assertLease?: () => void } = {},
  ): Promise<ContentAssessment> {
    const original = this.#repository.artifact(artifactId);
    if (original === undefined)
      throw new Error("Durable artifact was not found");
    const existing = this.#repository.assessment(artifactId);
    if (existing !== undefined) return existing;
    const reject = (
      reasonCode: string,
      observedMediaType?: UploadMediaType,
      decoded?: DecodedMedia,
    ) =>
      this.#reject(
        original,
        reasonCode,
        observedMediaType,
        decoded,
        options.assertLease,
      );
    const bytes = await this.#store.read(original.storageKey);
    if (bytes === undefined) {
      return reject("missing_original_object");
    }
    const magic = detectMediaType(bytes);
    if (magic === undefined || magic !== original.mediaType) {
      return reject("mime_magic_mismatch", magic);
    }
    if (containsActiveOrPolyglotSignature(bytes)) {
      return reject("active_or_polyglot_format", magic);
    }
    if (exceedsBytePolicy(original, this.#policy)) {
      return reject("byte_limit_exceeded", magic);
    }

    let decoded: DecodedMedia;
    try {
      decoded = await this.#decoder.probeAndReencode(bytes, original.mediaType);
    } catch {
      return reject("sandbox_decoder_failed", magic);
    }
    if (decoded.observedMediaType !== original.mediaType) {
      return reject("decoder_media_mismatch", decoded.observedMediaType);
    }
    const policyFailure = dimensionsOrDurationFailure(decoded, this.#policy);
    if (policyFailure !== undefined) {
      return reject(policyFailure, decoded.observedMediaType, decoded);
    }
    if (
      decoded.proxyBytes.byteLength < 8 ||
      containsActiveOrPolyglotSignature(decoded.proxyBytes) ||
      detectMediaType(decoded.proxyBytes) !== decoded.proxyMediaType
    ) {
      return reject("unsafe_proxy_output", decoded.observedMediaType, decoded);
    }

    const proxyArtifactId = randomUUID();
    const extension = decoded.proxyMediaType === "image/jpeg" ? "jpg" : "wav";
    const storageKey = `safe/${original.organizationId}/${original.jobId}/${proxyArtifactId}.${extension}`;
    options.assertLease?.();
    const metadata = await this.#store.putImmutable(
      storageKey,
      decoded.proxyBytes,
      decoded.proxyMediaType,
    );
    const observedMetadata = await this.#store.head(storageKey);
    const observedBytes = await this.#store.read(storageKey);
    const expectedProxyHash = sha256(decoded.proxyBytes);
    if (
      observedMetadata === undefined ||
      observedBytes === undefined ||
      observedMetadata.version !== metadata.version ||
      observedMetadata.mediaType !== decoded.proxyMediaType ||
      observedMetadata.byteLength !== observedBytes.byteLength ||
      observedBytes.byteLength !== decoded.proxyBytes.byteLength ||
      sha256(observedBytes) !== expectedProxyHash
    ) {
      throw new Error("Safe proxy durability verification failed");
    }
    const proxy: SafeProxyRecord = Object.freeze({
      artifactId: proxyArtifactId,
      organizationId: original.organizationId,
      jobId: original.jobId,
      parentArtifactId: original.artifactId,
      parentSha256: original.sha256,
      storageKey,
      objectVersion: metadata.version,
      mediaType: decoded.proxyMediaType,
      byteLength: decoded.proxyBytes.byteLength,
      sha256: expectedProxyHash,
      transformation: "safe_proxy",
      transformationVersion: this.#decoder.version,
      trustState: "safe_proxy",
      createdAt: this.#now().toISOString(),
    });
    const assessment = assessmentFor(
      original,
      this.#decoder.version,
      "accepted",
      decoded,
      undefined,
      proxyArtifactId,
      this.#now,
    );
    // The assessment is the trust-conferring commit. A stale worker may leave a
    // generation-scoped object-only derivative, but cannot make it selectable.
    options.assertLease?.();
    this.#repository.recordAssessment(assessment, proxy);
    return assessment;
  }

  #reject(
    original: DurableArtifactRecord,
    reasonCode: string,
    observedMediaType?: UploadMediaType,
    decoded?: DecodedMedia,
    assertLease?: () => void,
  ): ContentAssessment {
    const assessment = assessmentFor(
      original,
      this.#decoder.version,
      "rejected",
      decoded,
      reasonCode,
      undefined,
      this.#now,
      observedMediaType,
    );
    assertLease?.();
    this.#repository.recordAssessment(assessment);
    return assessment;
  }
}

export class DeterministicSandboxDecoder implements SandboxedMediaDecoder {
  readonly version = "deterministic-sandbox-v1";

  async probeAndReencode(
    bytes: Uint8Array,
    claimedMediaType: UploadMediaType,
  ): Promise<DecodedMedia> {
    await Promise.resolve();
    switch (claimedMediaType) {
      case "image/jpeg": {
        const dimensions = jpegDimensions(bytes);
        return {
          observedMediaType: claimedMediaType,
          ...dimensions,
          proxyMediaType: "image/jpeg",
          proxyBytes: canonicalJpeg(dimensions.width, dimensions.height),
        };
      }
      case "image/heic": {
        const dimensions = heicDimensions(bytes);
        return {
          observedMediaType: claimedMediaType,
          ...dimensions,
          proxyMediaType: "image/jpeg",
          proxyBytes: canonicalJpeg(dimensions.width, dimensions.height),
        };
      }
      case "audio/wav": {
        const durationMs = wavDuration(bytes);
        return {
          observedMediaType: claimedMediaType,
          durationMs,
          proxyMediaType: "audio/wav",
          proxyBytes: canonicalWav(durationMs),
        };
      }
      case "audio/m4a": {
        const durationMs = m4aDuration(bytes);
        return {
          observedMediaType: claimedMediaType,
          durationMs,
          proxyMediaType: "audio/wav",
          proxyBytes: canonicalWav(durationMs),
        };
      }
    }
  }
}

export function detectMediaType(
  bytes: Uint8Array,
): UploadMediaType | undefined {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  const ascii = Buffer.from(bytes).toString("latin1");
  if (
    bytes.length >= 12 &&
    ascii.slice(0, 4) === "RIFF" &&
    ascii.slice(8, 12) === "WAVE"
  ) {
    return "audio/wav";
  }
  if (bytes.length >= 12 && ascii.slice(4, 8) === "ftyp") {
    const brand = ascii.slice(8, 12);
    if (["heic", "heix", "mif1", "msf1"].includes(brand)) return "image/heic";
    if (["M4A ", "mp42", "isom"].includes(brand)) return "audio/m4a";
  }
  return undefined;
}

export function containsActiveOrPolyglotSignature(bytes: Uint8Array): boolean {
  const sample = Buffer.from(bytes).toString("latin1").toLowerCase();
  return [
    "<script",
    "<!doctype html",
    "<html",
    "<?xml",
    "%pdf-",
    "pk\u0003\u0004",
    "javascript:",
    "<svg",
  ].some((signature) => sample.includes(signature));
}

function exceedsBytePolicy(
  original: DurableArtifactRecord,
  policy: ContentPolicy,
): boolean {
  return original.mediaType.startsWith("image/")
    ? original.byteLength > policy.maxImageBytes
    : original.byteLength > policy.maxAudioBytes;
}

function dimensionsOrDurationFailure(
  decoded: DecodedMedia,
  policy: ContentPolicy,
): string | undefined {
  if (decoded.width !== undefined || decoded.height !== undefined) {
    if (decoded.width === undefined || decoded.height === undefined)
      return "missing_dimensions";
    if (
      decoded.width < 1 ||
      decoded.height < 1 ||
      decoded.width > policy.maxImageWidth ||
      decoded.height > policy.maxImageHeight ||
      decoded.width * decoded.height > policy.maxImagePixels
    ) {
      return "dimension_limit_exceeded";
    }
  }
  if (
    decoded.durationMs !== undefined &&
    (decoded.durationMs <= 0 || decoded.durationMs > policy.maxAudioDurationMs)
  ) {
    return "duration_limit_exceeded";
  }
  return undefined;
}

function assessmentFor(
  original: DurableArtifactRecord,
  decoderVersion: string,
  state: ContentAssessment["state"],
  decoded: DecodedMedia | undefined,
  reasonCode: string | undefined,
  safeProxyArtifactId: string | undefined,
  now: () => Date,
  observedMediaType = decoded?.observedMediaType,
): ContentAssessment {
  return Object.freeze({
    assessmentId: randomUUID(),
    artifactId: original.artifactId,
    organizationId: original.organizationId,
    state,
    ...(reasonCode === undefined ? {} : { reasonCode }),
    ...(observedMediaType === undefined ? {} : { observedMediaType }),
    ...(decoded?.width === undefined ? {} : { width: decoded.width }),
    ...(decoded?.height === undefined ? {} : { height: decoded.height }),
    ...(decoded?.durationMs === undefined
      ? {}
      : { durationMs: decoded.durationMs }),
    decoderVersion,
    createdAt: now().toISOString(),
    ...(safeProxyArtifactId === undefined ? {} : { safeProxyArtifactId }),
  });
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  for (let offset = 2; offset + 8 < bytes.length;) {
    if (bytes[offset] !== 0xff) throw new Error("Malformed JPEG marker stream");
    const marker = bytes[offset + 1];
    if (marker === undefined) throw new Error("Malformed JPEG marker");
    if (marker === 0xd9 || marker === 0xda) break;
    const length = readU16(bytes, offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length)
      throw new Error("Malformed JPEG segment");
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      return {
        height: readU16(bytes, offset + 5),
        width: readU16(bytes, offset + 7),
      };
    }
    offset += 2 + length;
  }
  throw new Error("JPEG dimensions were not decoded");
}

function heicDimensions(bytes: Uint8Array): { width: number; height: number } {
  const index = Buffer.from(bytes).indexOf(Buffer.from("ispe"));
  if (index < 0 || index + 16 > bytes.length)
    throw new Error("HEIC ispe box missing");
  return {
    width: readU32(bytes, index + 8),
    height: readU32(bytes, index + 12),
  };
}

function wavDuration(bytes: Uint8Array): number {
  if (bytes.length < 44) throw new Error("WAV header is incomplete");
  const byteRate = readU32LE(bytes, 28);
  const dataLength = readU32LE(bytes, 40);
  if (byteRate < 1 || dataLength < 1 || 44 + dataLength > bytes.length) {
    throw new Error("WAV payload is malformed");
  }
  return Math.max(1, Math.round((dataLength / byteRate) * 1000));
}

function m4aDuration(bytes: Uint8Array): number {
  const index = Buffer.from(bytes).indexOf(Buffer.from("mvhd"));
  if (index < 0 || index + 24 > bytes.length)
    throw new Error("M4A mvhd box missing");
  const version = bytes[index + 4];
  if (version !== 0)
    throw new Error("Only bounded M4A v0 fixtures are supported");
  const timescale = readU32(bytes, index + 16);
  const duration = readU32(bytes, index + 20);
  if (timescale < 1 || duration < 1) throw new Error("M4A duration is invalid");
  return Math.round((duration / timescale) * 1000);
}

function canonicalJpeg(width: number, height: number): Uint8Array {
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

function canonicalWav(durationMs: number): Uint8Array {
  const sampleRate = 1000;
  const dataLength = Math.max(1, Math.ceil(durationMs));
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(bytes, 8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, dataLength, true);
  return bytes;
}

function readU16(bytes: Uint8Array, offset: number): number {
  const first = bytes[offset];
  const second = bytes[offset + 1];
  if (first === undefined || second === undefined)
    throw new Error("Out-of-range read");
  return (first << 8) | second;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(offset, false);
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(offset, true);
}

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  bytes.set(Buffer.from(text, "ascii"), offset);
}
