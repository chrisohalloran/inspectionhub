import type { InvestigationPacket } from "@inspection/domain";
import { sha256 } from "@inspection/domain";
import {
  assertPreparedAiRequest,
  type PreparedAiRequest,
  type RedactedAiPacketSource,
} from "@inspection/provider-openai";

export type PacketSourceKind =
  | "artifact"
  | "transcript_span"
  | "observation"
  | "measurement"
  | "limitation"
  | "coverage";

export type PacketSourceSummary = {
  readonly kind: PacketSourceKind;
  readonly sourceId: string;
  readonly safeSummary: Readonly<
    Record<string, string | number | boolean | null>
  >;
};

export class PacketBoundEvidenceTool {
  readonly #packet: InvestigationPacket;

  constructor(input: {
    readonly packet: InvestigationPacket;
    readonly organizationId: string;
    readonly packetHash: string;
  }) {
    if (
      input.packet.organizationId !== input.organizationId ||
      input.packet.canonicalHash !== input.packetHash
    ) {
      throw new Error(
        "Evidence tool must be bound to the exact authorised packet",
      );
    }
    this.#packet = input.packet;
  }

  manifest(): Readonly<{
    packetId: string;
    packetHash: string;
    packetRevision: number;
    modules: InvestigationPacket["modules"];
    findingCandidates: InvestigationPacket["findingCandidates"];
    sourceCounts: Readonly<Record<PacketSourceKind, number>>;
  }> {
    return Object.freeze({
      packetId: this.#packet.packetId,
      packetHash: this.#packet.canonicalHash,
      packetRevision: this.#packet.packetRevision,
      modules: this.#packet.modules,
      findingCandidates: this.#packet.findingCandidates,
      sourceCounts: {
        artifact: this.#packet.evidence.length,
        transcript_span: this.#packet.transcriptSpans.length,
        observation: this.#packet.observations.length,
        measurement: this.#packet.measurements.length,
        limitation: this.#packet.limitations.length,
        coverage: this.#packet.coverage.length,
      },
    });
  }

  list(kind?: PacketSourceKind): readonly PacketSourceSummary[] {
    const sources = this.#allSources();
    return Object.freeze(
      kind === undefined
        ? sources
        : sources.filter((source) => source.kind === kind),
    );
  }

  read(kind: PacketSourceKind, sourceId: string): PacketSourceSummary {
    const source = this.#allSources().find(
      (candidate) => candidate.kind === kind && candidate.sourceId === sourceId,
    );
    if (source === undefined) {
      throw new Error("Requested evidence is not present in the frozen packet");
    }
    return source;
  }

  contextDigest(): string {
    return sha256({ manifest: this.manifest(), sources: this.#allSources() });
  }

  #allSources(): readonly PacketSourceSummary[] {
    return [
      ...this.#packet.evidence.map((source) => ({
        kind: "artifact" as const,
        sourceId: source.artifactId,
        safeSummary: {
          artifactKind: source.artifactKind,
          captureAreaId: source.captureAreaId,
          currentAreaId: source.currentAreaId,
          areaAssignmentCount: source.areaAssignmentHistory.length,
          lastAreaAssignmentReason:
            source.areaAssignmentHistory.at(-1)?.reason ?? null,
          lastAreaAssignedAt:
            source.areaAssignmentHistory.at(-1)?.assignedAt ?? null,
          capturedAt: source.capturedAt,
          sequence: source.captureSequence,
        },
      })),
      ...this.#packet.transcriptSpans.map((source) => ({
        kind: "transcript_span" as const,
        sourceId: source.spanId,
        safeSummary: {
          voiceArtifactId: source.voiceArtifactId,
          correctedText: source.correctedText,
          correctionOrigin: source.correctionOrigin,
          startMilliseconds: source.startMilliseconds,
          endMilliseconds: source.endMilliseconds,
        },
      })),
      ...this.#packet.observations.map((source) => ({
        kind: "observation" as const,
        sourceId: source.observationId,
        safeSummary: { areaId: source.areaId, text: source.text },
      })),
      ...this.#packet.measurements.map((source) => ({
        kind: "measurement" as const,
        sourceId: source.measurementId,
        safeSummary: {
          areaId: source.areaId,
          kind: source.kind,
          value: source.value,
          unit: source.unit,
          note: source.note,
        },
      })),
      ...this.#packet.limitations.map((source) => ({
        kind: "limitation" as const,
        sourceId: source.limitationId,
        safeSummary: {
          areaId: source.areaId,
          module: source.module,
          description: source.description,
          material: source.material,
        },
      })),
      ...this.#packet.coverage.map((source) => ({
        kind: "coverage" as const,
        sourceId: source.coverageEntryId,
        safeSummary: {
          areaId: source.areaId,
          module: source.module,
          state: source.state,
          detail: source.detail,
        },
      })),
    ];
  }
}

export class PreparedPacketEvidenceTool {
  readonly #request: PreparedAiRequest;

  constructor(request: PreparedAiRequest) {
    assertPreparedAiRequest(request);
    this.#request = request;
  }

  manifest(): Readonly<{
    packetId: string;
    packetHash: string;
    packetRevision: number;
    modules: PreparedAiRequest["input"]["modules"];
    findingCandidates: PreparedAiRequest["input"]["findingCandidates"];
    sourceCount: number;
    imageCount: number;
  }> {
    return Object.freeze({
      packetId: this.#request.input.packetId,
      packetHash: this.#request.input.packetHash,
      packetRevision: this.#request.input.packetRevision,
      modules: this.#request.input.modules,
      findingCandidates: this.#request.input.findingCandidates,
      sourceCount: this.#request.input.redactedSources.length,
      imageCount: this.#request.input.safeProxyImages.length,
    });
  }

  list(): readonly RedactedAiPacketSource[] {
    return this.#request.input.redactedSources;
  }

  read(kind: PacketSourceKind, sourceId: string): RedactedAiPacketSource {
    const source = this.#request.input.redactedSources.find(
      (candidate) => candidate.kind === kind && candidate.sourceId === sourceId,
    );
    if (source === undefined) {
      throw new Error(
        "Requested evidence is not present in the prepared request",
      );
    }
    return source;
  }
}
