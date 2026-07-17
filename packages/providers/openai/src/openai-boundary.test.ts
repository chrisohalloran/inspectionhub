import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  assertPreparedAiRequest,
  DeterministicOpenAiFake,
  prepareOpenAiRequest,
  type MinimizedAiPacket,
  type SafeProxyProvenancePort,
} from "./index.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function packet(): MinimizedAiPacket {
  return {
    opaqueJobId: "job_opaque_123456",
    packetId: "packet-one",
    packetHash: hash("packet-one"),
    packetRevision: 1,
    modules: [{ module: "building", moduleId: "module-building" }],
    findingCandidates: [
      {
        findingCandidateId: "candidate-one",
        module: "building",
        moduleId: "module-building",
        sourceArtifactIds: ["original-one"],
        sourceObservationIds: ["observation-one"],
      },
    ],
    selectedSafeProxies: [
      {
        artifactId: "proxy-one",
        parentArtifactId: "original-one",
        contentHash: hash("safe-proxy"),
        storageKey: "safe/org/job/proxy-one.jpg",
        trustState: "safe_proxy",
      },
    ],
    redactedSources: [
      {
        kind: "artifact",
        sourceId: "original-one",
        safeSummary: { artifactKind: "photo" },
      },
      {
        kind: "observation",
        sourceId: "observation-one",
        safeSummary: { text: "Cracked tiles were observed." },
      },
    ],
    redactedContradictions: [],
    redactedUnknowns: ["Concealed construction was not confirmed."],
    promptVersion: "draft-v1",
    skillVersions: ["building-v1"],
  };
}

function provenance(
  overrides: Partial<{
    organizationId: string;
    jobId: string;
    opaqueJobId: string;
  }> = {},
): SafeProxyProvenancePort {
  const canonical = packet().selectedSafeProxies[0]!;
  return {
    resolveVerifiedSafeProxy: (input) =>
      Promise.resolve(
        input.organizationId === (overrides.organizationId ?? "org-alpha") &&
          input.jobId === (overrides.jobId ?? "job-alpha") &&
          input.opaqueJobId ===
            (overrides.opaqueJobId ?? "job_opaque_123456") &&
          input.artifactId === canonical.artifactId
          ? {
              ...canonical,
              mediaType: "image/jpeg" as const,
              base64Data: Buffer.from("safe-proxy").toString("base64"),
            }
          : undefined,
      ),
  };
}

const boundary = (selectedPacket = packet()) => ({
  model: "synthetic-model",
  organizationId: "org-alpha",
  jobId: "job-alpha",
  packet: selectedPacket,
  provenance: provenance(),
});

describe("OpenAI privacy and provenance boundary", () => {
  it("sends only tenant/job-verified safe proxies with store false", async () => {
    const request = await prepareOpenAiRequest(boundary());
    expect(request.store).toBe(false);
    expect(request.traceMode).toBe("disabled_sensitive_payloads");
    expect(request.payloadManifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(request.input.safeProxyImages[0]).toMatchObject({
      contentHash: hash("safe-proxy"),
      mediaType: "image/jpeg",
      detail: "high",
    });
    expect(request.input.safeProxyImages[0]?.dataUrl).toMatch(
      /^data:image\/jpeg;base64,/u,
    );
    expect(JSON.stringify(request)).not.toMatch(/client|@|street address/i);
  });

  it("rejects direct fields, PII values, original paths, forged safe DTOs and cross-job selections", async () => {
    await expect(
      prepareOpenAiRequest(
        boundary({ ...packet(), propertyAddress: "1 Example Street" } as never),
      ),
    ).rejects.toThrow(/prohibited field/);
    await expect(
      prepareOpenAiRequest(
        boundary({
          ...packet(),
          redactedSources: packet().redactedSources.map((source) =>
            source.kind === "observation"
              ? {
                  ...source,
                  safeSummary: {
                    text: "Contact buyer@example.com at 12 Example Street",
                  },
                }
              : source,
          ),
        }),
      ),
    ).rejects.toThrow(/unredacted personal or property data/);
    await expect(
      prepareOpenAiRequest(
        boundary({
          ...packet(),
          selectedSafeProxies: [
            {
              ...packet().selectedSafeProxies[0]!,
              storageKey: "quarantine/org/job/original.jpg",
            },
          ],
        }),
      ),
    ).rejects.toThrow(/provenance/);
    await expect(
      prepareOpenAiRequest(
        boundary({
          ...packet(),
          selectedSafeProxies: [
            {
              ...packet().selectedSafeProxies[0]!,
              contentHash: hash("forged-safe-proxy"),
            },
          ],
        }),
      ),
    ).rejects.toThrow(/not verified/);
    await expect(
      prepareOpenAiRequest({
        ...boundary(),
        jobId: "job-beta",
      }),
    ).rejects.toThrow(/not verified/);
  });

  it("rejects a copied or tampered prepared request before provider execution", async () => {
    const request = await prepareOpenAiRequest(boundary());
    expect(() => assertPreparedAiRequest(request)).not.toThrow();
    const copied = {
      ...request,
      payloadManifestSha256: hash("tampered"),
    };
    expect(() => assertPreparedAiRequest(copied)).toThrow(
      /server-produced PreparedAiRequest/,
    );
    const provider = new DeterministicOpenAiFake();
    await expect(
      provider.execute({
        idempotencyKey: "tampered-run",
        requestFingerprint: hash("tampered-run"),
        request: copied,
      }),
    ).rejects.toThrow(/server-produced PreparedAiRequest/);
  });

  it("records replay and unknown outcomes without exposing packet content", async () => {
    const request = await prepareOpenAiRequest(boundary());
    const provider = new DeterministicOpenAiFake("unknown");
    const call = {
      idempotencyKey: "ai-run-one",
      requestFingerprint: hash(request.payloadManifestSha256),
      request,
    };
    await expect(provider.execute(call)).resolves.toMatchObject({
      state: "unknown",
      replayed: false,
    });
    await expect(provider.execute(call)).resolves.toMatchObject({
      state: "unknown",
      replayed: true,
    });
    await expect(
      provider.execute({ ...call, requestFingerprint: hash("changed") }),
    ).rejects.toThrow(/diverged/);
  });
});
