import { createHash } from "node:crypto";

export type AiPacketSourceKind =
  | "artifact"
  | "transcript_span"
  | "observation"
  | "measurement"
  | "limitation"
  | "coverage";

export interface SelectedSafeProxy {
  readonly artifactId: string;
  readonly parentArtifactId: string;
  readonly contentHash: string;
  readonly storageKey: string;
  readonly trustState: "safe_proxy";
}

export interface VerifiedSafeProxyContent extends SelectedSafeProxy {
  readonly mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  readonly base64Data: string;
}

export interface SafeProxyProvenancePort {
  /**
   * Trusted server-side resolver. Implementations must verify tenant/job
   * ownership, accepted assessment + derivation provenance, and independently
   * read immutable bytes before returning the canonical safe proxy.
   */
  resolveVerifiedSafeProxy(input: {
    readonly organizationId: string;
    readonly jobId: string;
    readonly opaqueJobId: string;
    readonly artifactId: string;
  }): Promise<VerifiedSafeProxyContent | undefined>;
}

export interface RedactedAiPacketSource {
  readonly kind: AiPacketSourceKind;
  readonly sourceId: string;
  readonly safeSummary: Readonly<
    Record<string, string | number | boolean | null>
  >;
}

export interface MinimizedAiPacket {
  readonly opaqueJobId: string;
  readonly packetId: string;
  readonly packetHash: string;
  readonly packetRevision: number;
  readonly modules: readonly Readonly<{
    module: "building" | "timber_pest";
    moduleId: string;
  }>[];
  readonly findingCandidates: readonly Readonly<{
    findingCandidateId: string;
    module: "building" | "timber_pest";
    moduleId: string;
    sourceArtifactIds: readonly string[];
    sourceObservationIds: readonly string[];
  }>[];
  readonly selectedSafeProxies: readonly SelectedSafeProxy[];
  readonly redactedSources: readonly RedactedAiPacketSource[];
  readonly redactedContradictions: readonly string[];
  readonly redactedUnknowns: readonly string[];
  readonly promptVersion: string;
  readonly skillVersions: readonly string[];
}

export interface PreparedSafeProxyImage {
  readonly artifactId: string;
  readonly contentHash: string;
  readonly mediaType: VerifiedSafeProxyContent["mediaType"];
  readonly dataUrl: string;
  readonly detail: "high";
}

export interface PreparedAiPacket extends Omit<
  MinimizedAiPacket,
  "selectedSafeProxies"
> {
  readonly safeProxyImages: readonly PreparedSafeProxyImage[];
}

/**
 * This value is deliberately constructible only through prepareOpenAiRequest.
 * The runtime brand is held in this module as well as the canonical payload
 * hash, so copied, deserialised, or tampered request objects fail closed.
 */
export interface PreparedAiRequest {
  readonly preparationVersion: "prepared-ai-request-v2";
  readonly model: string;
  readonly store: false;
  readonly traceMode: "disabled_sensitive_payloads";
  readonly input: PreparedAiPacket;
  readonly payloadManifestSha256: string;
}

type PreparedAiRequestBody = Omit<PreparedAiRequest, "payloadManifestSha256">;

/** @deprecated Use PreparedAiRequest. */
export type PreparedOpenAiRequest = PreparedAiRequest;

export type OpenAiObservedResult =
  | Readonly<{
      state: "accepted";
      responseArtifactRef: string;
      responseManifestSha256: string;
      replayed: boolean;
    }>
  | Readonly<{
      state: "failed";
      code: string;
      retryable: boolean;
      replayed: boolean;
    }>
  | Readonly<{
      state: "unknown";
      reconciliationKeyHash: string;
      replayed: boolean;
    }>;

export interface OpenAiProviderPort {
  execute(input: {
    readonly idempotencyKey: string;
    readonly requestFingerprint: string;
    readonly request: PreparedAiRequest;
  }): Promise<OpenAiObservedResult>;
}

const sha256Pattern = /^[0-9a-f]{64}$/u;
const dataUrlPattern =
  /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/u;
const MAX_SAFE_PROXY_BYTES = 20 * 1024 * 1024;
const MAX_SAFE_PROXY_COUNT = 20;
const preparedRequestBrand = new WeakSet<object>();

export async function prepareOpenAiRequest(input: {
  readonly model: string;
  readonly organizationId: string;
  readonly jobId: string;
  readonly packet: MinimizedAiPacket;
  readonly provenance: SafeProxyProvenancePort;
}): Promise<PreparedAiRequest> {
  validateMinimizedPacket(input.packet);
  if (input.packet.selectedSafeProxies.length > MAX_SAFE_PROXY_COUNT) {
    throw new Error("AI packet contains too many selected safe proxies");
  }

  const verifiedImages: PreparedSafeProxyImage[] = [];
  for (const proxy of input.packet.selectedSafeProxies) {
    validateProxyManifest(proxy);
    const verified = await input.provenance.resolveVerifiedSafeProxy({
      organizationId: input.organizationId,
      jobId: input.jobId,
      opaqueJobId: input.packet.opaqueJobId,
      artifactId: proxy.artifactId,
    });
    if (!sameProxyManifest(proxy, verified)) {
      throw new Error(
        "AI proxy was not verified for the tenant, job and immutable provenance",
      );
    }
    const bytes = decodeCanonicalBase64(verified.base64Data);
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > MAX_SAFE_PROXY_BYTES ||
      hashBytes(bytes) !== verified.contentHash
    ) {
      throw new Error("AI safe proxy bytes do not match verified provenance");
    }
    verifiedImages.push(
      Object.freeze({
        artifactId: verified.artifactId,
        contentHash: verified.contentHash,
        mediaType: verified.mediaType,
        dataUrl: `data:${verified.mediaType};base64,${verified.base64Data}`,
        detail: "high" as const,
      }),
    );
  }

  assertNoPersonalOrPropertyData(input.packet);
  const preparedPacket: PreparedAiPacket = deepFreezePacket({
    opaqueJobId: input.packet.opaqueJobId,
    packetId: input.packet.packetId,
    packetHash: input.packet.packetHash,
    packetRevision: input.packet.packetRevision,
    modules: input.packet.modules,
    findingCandidates: input.packet.findingCandidates,
    safeProxyImages: verifiedImages,
    redactedSources: input.packet.redactedSources,
    redactedContradictions: input.packet.redactedContradictions,
    redactedUnknowns: input.packet.redactedUnknowns,
    promptVersion: input.packet.promptVersion,
    skillVersions: input.packet.skillVersions,
  });
  const requestBody = preparedAiRequestBody({
    preparationVersion: "prepared-ai-request-v2",
    model: input.model,
    store: false,
    traceMode: "disabled_sensitive_payloads",
    input: preparedPacket,
  });
  const request: PreparedAiRequest = Object.freeze({
    ...requestBody,
    payloadManifestSha256: hash(canonicalJson(requestBody)),
  });
  preparedRequestBrand.add(request);
  return request;
}

export function assertPreparedAiRequest(
  candidate: PreparedAiRequest,
): asserts candidate is PreparedAiRequest {
  if (!preparedRequestBrand.has(candidate)) {
    throw new Error(
      "AI provider accepts only a server-produced PreparedAiRequest",
    );
  }
  if (
    candidate.preparationVersion !== "prepared-ai-request-v2" ||
    candidate.store !== false ||
    candidate.traceMode !== "disabled_sensitive_payloads"
  ) {
    throw new Error("Prepared AI request privacy policy is invalid");
  }
  validateMinimizedPacket({
    ...candidate.input,
    selectedSafeProxies: [],
  });
  for (const image of candidate.input.safeProxyImages) {
    const match = dataUrlPattern.exec(image.dataUrl);
    if (
      match === null ||
      match[1] !== image.mediaType ||
      image.detail !== "high" ||
      !sha256Pattern.test(image.contentHash)
    ) {
      throw new Error("Prepared AI request contains an invalid image input");
    }
    const bytes = decodeCanonicalBase64(match[2] ?? "");
    if (hashBytes(bytes) !== image.contentHash) {
      throw new Error("Prepared AI request image hash is invalid");
    }
  }
  assertNoPersonalOrPropertyData(candidate.input);
  const requestBody = preparedAiRequestBody(candidate);
  if (hash(canonicalJson(requestBody)) !== candidate.payloadManifestSha256) {
    throw new Error("Prepared AI request payload manifest is invalid");
  }
}

function preparedAiRequestBody(
  request: PreparedAiRequestBody,
): PreparedAiRequestBody {
  return {
    preparationVersion: request.preparationVersion,
    model: request.model,
    store: request.store,
    traceMode: request.traceMode,
    input: request.input,
  };
}

export function preparedRequestTextPayload(
  request: PreparedAiRequest,
): Readonly<
  Omit<PreparedAiPacket, "safeProxyImages"> & {
    safeProxyImageManifest: readonly Readonly<{
      artifactId: string;
      contentHash: string;
      mediaType: PreparedSafeProxyImage["mediaType"];
    }>[];
  }
> {
  assertPreparedAiRequest(request);
  const { safeProxyImages, ...packet } = request.input;
  return Object.freeze({
    ...packet,
    safeProxyImageManifest: Object.freeze(
      safeProxyImages.map(({ artifactId, contentHash, mediaType }) =>
        Object.freeze({ artifactId, contentHash, mediaType }),
      ),
    ),
  });
}

export class DeterministicOpenAiFake implements OpenAiProviderPort {
  readonly #results = new Map<
    string,
    { readonly fingerprint: string; readonly result: OpenAiObservedResult }
  >();
  #mode: "accepted" | "retryable_failure" | "unknown";

  constructor(mode: "accepted" | "retryable_failure" | "unknown" = "accepted") {
    this.#mode = mode;
  }

  setMode(mode: "accepted" | "retryable_failure" | "unknown"): void {
    this.#mode = mode;
  }

  async execute(input: {
    readonly idempotencyKey: string;
    readonly requestFingerprint: string;
    readonly request: PreparedAiRequest;
  }): Promise<OpenAiObservedResult> {
    await Promise.resolve();
    assertPreparedAiRequest(input.request);
    if (!sha256Pattern.test(input.requestFingerprint)) {
      throw new Error("OpenAI request fingerprint is invalid");
    }
    const prior = this.#results.get(input.idempotencyKey);
    if (prior !== undefined) {
      if (prior.fingerprint !== input.requestFingerprint) {
        throw new Error("OpenAI idempotency key fingerprint diverged");
      }
      return { ...prior.result, replayed: true };
    }
    const result: OpenAiObservedResult =
      this.#mode === "unknown"
        ? {
            state: "unknown",
            reconciliationKeyHash: hash(`reconcile:${input.idempotencyKey}`),
            replayed: false,
          }
        : this.#mode === "retryable_failure"
          ? {
              state: "failed",
              code: "openai_temporarily_unavailable",
              retryable: true,
              replayed: false,
            }
          : {
              state: "accepted",
              responseArtifactRef: `protected-response-${hash(input.idempotencyKey).slice(0, 16)}`,
              responseManifestSha256: hash(
                `${input.request.payloadManifestSha256}:synthetic-response`,
              ),
              replayed: false,
            };
    this.#results.set(input.idempotencyKey, {
      fingerprint: input.requestFingerprint,
      result,
    });
    return result;
  }
}

function validateMinimizedPacket(packet: MinimizedAiPacket): void {
  if (!/^job_[A-Za-z0-9_-]{6,120}$/u.test(packet.opaqueJobId)) {
    throw new Error("AI packet must use an opaque job identifier");
  }
  if (
    packet.packetId.trim().length === 0 ||
    !sha256Pattern.test(packet.packetHash) ||
    !Number.isSafeInteger(packet.packetRevision) ||
    packet.packetRevision < 1 ||
    packet.modules.length === 0 ||
    packet.redactedSources.length === 0
  ) {
    throw new Error("AI packet identity or structured sources are invalid");
  }
  const sourceKeys = new Set<string>();
  for (const source of packet.redactedSources) {
    const key = `${source.kind}:${source.sourceId}`;
    if (source.sourceId.trim().length === 0 || sourceKeys.has(key)) {
      throw new Error("AI packet contains an invalid or duplicate source");
    }
    sourceKeys.add(key);
  }
  const moduleIds = new Map(
    packet.modules.map((module) => [module.module, module.moduleId]),
  );
  const candidateIds = new Set<string>();
  const candidateModules = new Set<string>();
  for (const candidate of packet.findingCandidates) {
    if (
      candidate.findingCandidateId.trim().length === 0 ||
      candidateIds.has(candidate.findingCandidateId) ||
      candidateModules.has(candidate.module) ||
      moduleIds.get(candidate.module) !== candidate.moduleId ||
      new Set(candidate.sourceArtifactIds).size !==
        candidate.sourceArtifactIds.length ||
      new Set(candidate.sourceObservationIds).size !==
        candidate.sourceObservationIds.length ||
      candidate.sourceArtifactIds.some(
        (sourceId) => !sourceKeys.has(`artifact:${sourceId}`),
      ) ||
      candidate.sourceObservationIds.some(
        (sourceId) => !sourceKeys.has(`observation:${sourceId}`),
      )
    ) {
      throw new Error("AI packet contains an invalid finding candidate scope");
    }
    candidateIds.add(candidate.findingCandidateId);
    candidateModules.add(candidate.module);
  }
}

function validateProxyManifest(proxy: SelectedSafeProxy): void {
  if (proxy.trustState !== "safe_proxy") {
    throw new Error(
      "Original or untrusted evidence cannot cross the AI boundary",
    );
  }
  if (
    !sha256Pattern.test(proxy.contentHash) ||
    !proxy.storageKey.startsWith("safe/")
  ) {
    throw new Error("AI proxy provenance is invalid");
  }
}

function sameProxyManifest(
  selected: SelectedSafeProxy,
  verified: VerifiedSafeProxyContent | undefined,
): verified is VerifiedSafeProxyContent {
  return (
    verified !== undefined &&
    verified.artifactId === selected.artifactId &&
    verified.parentArtifactId === selected.parentArtifactId &&
    verified.contentHash === selected.contentHash &&
    verified.storageKey === selected.storageKey &&
    verified.trustState === "safe_proxy"
  );
}

function assertNoPersonalOrPropertyData(value: unknown): void {
  const prohibitedKey =
    /^(client(Name)?|contact|email|phone|propertyAddress|streetAddress|address)$/iu;
  const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
  const phone = /(?:\+?61|0)[2-478](?:[ -]?\d){8}\b/u;
  const streetAddress =
    /\b\d{1,6}[A-Za-z]?\s+(?:[A-Za-z][A-Za-z'-]*\s+){0,5}(?:street|st|road|rd|avenue|ave|drive|dr|court|ct|lane|ln|place|pl|crescent|cres|terrace|tce|highway|hwy)\b/iu;
  const visit = (candidate: unknown): void => {
    if (typeof candidate === "string") {
      if (
        email.test(candidate) ||
        phone.test(candidate) ||
        streetAddress.test(candidate)
      ) {
        throw new Error(
          "AI packet contains unredacted personal or property data",
        );
      }
      return;
    }
    if (candidate === null || typeof candidate !== "object") return;
    for (const [key, child] of Object.entries(candidate)) {
      if (prohibitedKey.test(key)) {
        throw new Error(`AI packet contains prohibited field: ${key}`);
      }
      visit(child);
    }
  };
  visit(value);
}

function decodeCanonicalBase64(value: string): Buffer {
  if (value.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw new Error("AI safe proxy bytes are not canonical base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    throw new Error("AI safe proxy bytes are not canonical base64");
  }
  return bytes;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreezePacket(packet: PreparedAiPacket): PreparedAiPacket {
  return Object.freeze({
    ...packet,
    modules: Object.freeze(
      packet.modules.map((module) => Object.freeze({ ...module })),
    ),
    findingCandidates: Object.freeze(
      packet.findingCandidates.map((candidate) =>
        Object.freeze({
          ...candidate,
          sourceArtifactIds: Object.freeze([...candidate.sourceArtifactIds]),
          sourceObservationIds: Object.freeze([
            ...candidate.sourceObservationIds,
          ]),
        }),
      ),
    ),
    safeProxyImages: Object.freeze(
      packet.safeProxyImages.map((image) => Object.freeze({ ...image })),
    ),
    redactedSources: Object.freeze(
      packet.redactedSources.map((source) =>
        Object.freeze({
          ...source,
          safeSummary: Object.freeze({ ...source.safeSummary }),
        }),
      ),
    ),
    redactedContradictions: Object.freeze([...packet.redactedContradictions]),
    redactedUnknowns: Object.freeze([...packet.redactedUnknowns]),
    skillVersions: Object.freeze([...packet.skillVersions]),
  });
}

function hashBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
