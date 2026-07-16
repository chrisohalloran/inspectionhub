import type { InvestigationPacket } from "@inspection/domain";
import { sha256 } from "@inspection/domain";
import {
  prepareOpenAiRequest,
  type MinimizedAiPacket,
  type PreparedAiRequest,
  type SafeProxyProvenancePort,
  type SelectedSafeProxy,
} from "@inspection/provider-openai";

import { PacketBoundEvidenceTool } from "./tools/packet-tools.js";

export async function prepareInvestigationAiRequest(input: {
  readonly packet: InvestigationPacket;
  readonly selectedSafeProxies: readonly SelectedSafeProxy[];
  readonly provenance: SafeProxyProvenancePort;
}): Promise<PreparedAiRequest> {
  const packet = input.packet;
  const evidence = new PacketBoundEvidenceTool({
    packet,
    organizationId: packet.organizationId,
    packetHash: packet.canonicalHash,
  });
  const minimized: MinimizedAiPacket = {
    opaqueJobId: `job_${sha256({
      organizationId: packet.organizationId,
      jobId: packet.jobId,
    }).slice(0, 32)}`,
    packetId: packet.packetId,
    packetHash: packet.canonicalHash,
    packetRevision: packet.packetRevision,
    modules: packet.modules,
    selectedSafeProxies: input.selectedSafeProxies,
    redactedSources: evidence.list().map((source) => ({
      ...source,
      safeSummary: redactSafeSummary(source.safeSummary),
    })),
    redactedContradictions: packet.contradictions.map((item) =>
      redactSensitiveText(item.description),
    ),
    redactedUnknowns: packet.unknowns.map(redactSensitiveText),
    promptVersion: packet.versionPins.promptVersion,
    skillVersions: packet.versionPins.skillVersions,
  };
  return prepareOpenAiRequest({
    model: packet.versionPins.model,
    organizationId: packet.organizationId,
    jobId: packet.jobId,
    packet: minimized,
    provenance: input.provenance,
  });
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[redacted-email]")
    .replace(/(?:\+?61|0)[2-478](?:[ -]?\d){8}\b/gu, "[redacted-phone]")
    .replace(
      /\b\d{1,6}[A-Za-z]?\s+(?:[A-Za-z][A-Za-z'-]*\s+){0,5}(?:street|st|road|rd|avenue|ave|drive|dr|court|ct|lane|ln|place|pl|crescent|cres|terrace|tce|highway|hwy)\b/giu,
      "[redacted-address]",
    );
}

function redactSafeSummary(
  summary: Readonly<Record<string, string | number | boolean | null>>,
): Readonly<Record<string, string | number | boolean | null>> {
  return Object.fromEntries(
    Object.entries(summary).map(([key, value]) => [
      key,
      typeof value === "string" ? redactSensitiveText(value) : value,
    ]),
  );
}
