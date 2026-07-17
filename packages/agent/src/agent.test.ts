import { createHash } from "node:crypto";

import type { InvestigationPacket } from "@inspection/domain";
import { describe, expect, it } from "vitest";

import { InMemoryAgentRunEventStore } from "./events.js";
import {
  packetAuthorizesSource,
  runDeterministicDraftGuard,
} from "./guards.js";
import { agentsSdkRuntimePolicy } from "./models/agents-sdk.js";
import { thinResponsesRequestPolicy } from "./models/thin-responses.js";
import type {
  DeterministicFixtureDraftModel,
  DraftModel,
  DraftModelInput,
  DraftModelResult,
} from "./models/types.js";
import {
  InMemoryCurrentPacketRepository,
  InMemoryProvisionalDraftRepository,
  RunIdentityConflictError,
} from "./repository.js";
import { InspectionDraftRunner, SimulatedRunnerCrash } from "./runner.js";
import type { InspectionDraft } from "./schemas.js";
import { InspectionDraftSchema } from "./schemas.js";
import { prepareInvestigationAiRequest } from "./prepared-request.js";
import { AllowlistedSkillRegistry } from "./skills.js";
import { cleanCrackedTileDraft, crackedTilePacket } from "./test-fixtures.js";
import { PacketBoundEvidenceTool } from "./tools/packet-tools.js";
import { transcriptionRequestPolicy } from "./transcription.js";
import { ReadOnlyDraftVerifier } from "./verifier/deterministic-verifier.js";

describe("inspection drafting authority and grounding", () => {
  it("accepts a fully sourced, qualified draft without critical issues", () => {
    const result = runDeterministicDraftGuard(
      crackedTilePacket(),
      cleanCrackedTileDraft(),
    );

    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it.each([
    ["You should not buy this property.", "transaction_advice"],
    ["Budget $20,000 for repairs.", "cost_or_valuation_advice"],
    [
      "Delay settlement until repairs are complete.",
      "legal_or_settlement_advice",
    ],
    ["The membrane damage is guaranteed.", "guarantee_or_certification"],
    ["Visible termite activity was found.", "module_taxonomy_leakage"],
  ])("rejects the prohibited statement %s", (text, expectedCode) => {
    const draft = cleanCrackedTileDraft();
    draft.modules[0]!.findings[0]!.observation.text = text;

    const result = runDeterministicDraftGuard(crackedTilePacket(), draft);

    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(expectedCode);
  });

  it("rejects unauthorized sources, lost qualification, and autonomous classification", () => {
    const draft = cleanCrackedTileDraft();
    const finding = draft.modules[0]!.findings[0]!;
    finding.reasoning[0]!.qualification = "observed";
    finding.observation.sourceRefs = [
      { kind: "artifact", sourceId: "unselected-photo" },
    ];
    finding.inspectorClassification = {
      value: "safety_hazard",
      attributedTo: "inspector",
      sourceRefs: [
        { kind: "observation", sourceId: "observation-cracked-tiles" },
      ],
    };

    const result = runDeterministicDraftGuard(crackedTilePacket(), draft);

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "lost_qualification",
        "unauthorized_provenance",
        "autonomous_classification",
      ]),
    );
  });

  it("rejects an invented candidate identity even when its sources are packet-authorised", () => {
    const draft = cleanCrackedTileDraft();
    draft.modules[0]!.findings[0]!.findingCandidateId = "invented-candidate";

    const result = runDeterministicDraftGuard(crackedTilePacket(), draft);

    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "finding_candidate_identity_mismatch",
        "finding_candidate_missing",
      ]),
    );
  });

  it("rejects a globally packet-authorised observation outside the candidate scope", () => {
    const base = crackedTilePacket();
    const packet: InvestigationPacket = {
      ...base,
      observations: [
        ...base.observations,
        {
          areaId: "roof-void",
          observationId: "observation-other-candidate",
          recordedAt: "2026-07-14T08:02:20.000+10:00",
          recordedByInspectorId: "inspector-1",
          text: "A separate roof-void observation.",
        },
      ],
    };
    const draft = cleanCrackedTileDraft();
    draft.modules[0]!.findings[0]!.observation.sourceRefs = [
      { kind: "observation", sourceId: "observation-other-candidate" },
    ];

    const result = runDeterministicDraftGuard(packet, draft);

    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(
      "candidate_unauthorized_provenance",
    );
  });

  it("blocks absolute and unbounded Timber Pest absence claims", () => {
    const { packet, draft } = pestNoEvidenceFixture(
      "No termites were found and no visible evidence was observed.",
    );

    const result = runDeterministicDraftGuard(packet, draft);

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "absolute_no_pest_claim",
        "unbounded_no_evidence_claim",
        "no_evidence_without_coverage",
      ]),
    );
  });

  it("allows only exact packet source identities and transcript parents", () => {
    const packet = crackedTilePacket();
    expect(
      packetAuthorizesSource(packet, {
        kind: "transcript_span",
        sourceId: "span-cracked-tiles",
        voiceArtifactId: "voice-cracked-tiles",
      }),
    ).toBe(true);
    expect(
      packetAuthorizesSource(packet, {
        kind: "transcript_span",
        sourceId: "span-cracked-tiles",
        voiceArtifactId: "other-voice",
      }),
    ).toBe(false);
  });

  it("rejects an invented material fact even when it cites an authorised source", () => {
    const packet = crackedTilePacket();
    const draft = cleanCrackedTileDraft();
    draft.modules[0]!.findings[0]!.observation.text =
      "The roof framing has extensive structural decay.";

    const verification = new ReadOnlyDraftVerifier().verify({
      packet,
      draft,
      verifiedAt: "2026-07-15T00:00:00.000+10:00",
    });

    expect(verification.passed).toBe(false);
    expect(verification.issues.map((issue) => issue.code)).toContain(
      "unsupported_material_fact",
    );
  });
});

describe("packet tools and lazy skills", () => {
  it("exposes the complete authorised context and rejects a foreign source", () => {
    const packet = crackedTilePacket();
    const tool = new PacketBoundEvidenceTool({
      packet,
      organizationId: packet.organizationId,
      packetHash: packet.canonicalHash,
    });

    expect(tool.manifest().sourceCounts).toEqual({
      artifact: 2,
      transcript_span: 1,
      observation: 2,
      measurement: 0,
      limitation: 0,
      coverage: 1,
    });
    expect(tool.contextDigest()).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => tool.read("artifact", "private-coverage-photo")).toThrow(
      "not present in the frozen packet",
    );
  });

  it("loads only allowlisted, verified, version-pinned, module-compatible skills", async () => {
    const registry = new AllowlistedSkillRegistry({
      "building-inspection": () => ({
        name: "building-inspection",
        version: "1.0.0",
        compatibleModules: ["building"],
        sourceStatus: "verified",
        instructions: "Keep assumptions qualified.",
      }),
      "unverified-pest": () => ({
        name: "unverified-pest",
        version: "1.0.0",
        compatibleModules: ["timber_pest"],
        sourceStatus: "draft_unverified",
        instructions: "Not approved.",
      }),
    });

    await expect(
      registry.load({
        name: "building-inspection",
        allowedModules: ["building"],
        requiredVersion: "1.0.0",
      }),
    ).resolves.toMatchObject({ version: "1.0.0" });
    await expect(
      registry.load({
        name: "unverified-pest",
        allowedModules: ["timber_pest"],
      }),
    ).rejects.toThrow("not approved");
    await expect(
      registry.load({ name: "missing", allowedModules: ["building"] }),
    ).rejects.toThrow("not allowlisted");
  });
});

describe("application-owned runner", () => {
  it("persists, verifies, and completes one exact provisional draft", async () => {
    const harness = runnerHarness(
      new FixtureDraftModel(cleanCrackedTileDraft()),
    );

    const outcome = await harness.runner.run({
      runId: "run-1",
      attempt: 1,
      packet: harness.packet,
    });

    expect(outcome.status).toBe("verified");
    expect(harness.modelCalls()).toBe(1);
    expect(harness.events.read("run-1").map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "packet.loaded",
        "draft.persisted",
        "deterministic_check.completed",
        "verifier.completed",
        "run.completed",
      ]),
    );
  });

  it.each(["after_draft", "after_guard", "after_verifier"] as const)(
    "replays from the durable %s checkpoint without another model call",
    async (faultAfter) => {
      const harness = runnerHarness(
        new FixtureDraftModel(cleanCrackedTileDraft()),
      );
      await expect(
        harness.runner.run({
          runId: `run-${faultAfter}`,
          attempt: 1,
          packet: harness.packet,
          faultAfter,
        }),
      ).rejects.toBeInstanceOf(SimulatedRunnerCrash);

      const outcome = await harness.runner.run({
        runId: `run-${faultAfter}`,
        attempt: 2,
        packet: harness.packet,
      });

      expect(outcome.status).toBe("verified");
      expect(harness.modelCalls()).toBe(1);
    },
  );

  it("rejects a reused run ID from another tenant, job, or packet without exposing the prior draft", async () => {
    const harness = runnerHarness(
      new FixtureDraftModel(cleanCrackedTileDraft()),
    );
    await expect(
      harness.runner.run({
        runId: "run-context-bound",
        attempt: 1,
        packet: harness.packet,
        faultAfter: "after_draft",
      }),
    ).rejects.toBeInstanceOf(SimulatedRunnerCrash);
    const eventCount = harness.events.read("run-context-bound").length;
    const foreignPackets: readonly InvestigationPacket[] = [
      { ...harness.packet, organizationId: "organization-foreign" },
      { ...harness.packet, jobId: "job-foreign" },
      { ...harness.packet, packetId: "packet-foreign" },
      { ...harness.packet, canonicalHash: "b".repeat(64) },
    ];
    for (const foreignPacket of foreignPackets) {
      harness.packets.setCurrent(
        foreignPacket.organizationId,
        foreignPacket.packetId,
        foreignPacket.canonicalHash,
      );
      await expect(
        harness.runner.run({
          runId: "run-context-bound",
          attempt: 1,
          packet: foreignPacket,
        }),
      ).rejects.toBeInstanceOf(RunIdentityConflictError);
    }

    expect(harness.events.read("run-context-bound")).toHaveLength(eventCount);
    expect(harness.modelCalls()).toBe(1);
    harness.packets.setCurrent(
      harness.packet.organizationId,
      harness.packet.packetId,
      harness.packet.canonicalHash,
    );
    await expect(
      harness.runner.run({
        runId: "run-context-bound",
        attempt: 2,
        packet: harness.packet,
      }),
    ).resolves.toMatchObject({ status: "verified" });
    expect(harness.modelCalls()).toBe(1);
  });

  it("supersedes a persisted result when the packet changes before verification", async () => {
    const harness = runnerHarness(
      new FixtureDraftModel(cleanCrackedTileDraft()),
    );
    await expect(
      harness.runner.run({
        runId: "run-stale",
        attempt: 1,
        packet: harness.packet,
        faultAfter: "after_draft",
      }),
    ).rejects.toBeInstanceOf(SimulatedRunnerCrash);
    harness.packets.setCurrent(
      harness.packet.organizationId,
      harness.packet.packetId,
      "b".repeat(64),
    );

    const outcome = await harness.runner.run({
      runId: "run-stale",
      attempt: 2,
      packet: harness.packet,
    });

    expect(outcome.status).toBe("superseded");
    if (outcome.status !== "superseded") {
      throw new Error("Expected a superseded outcome");
    }
    expect(outcome.record?.status).toBe("stale");
  });

  it("fails closed to an explicit manual path during a provider outage", async () => {
    const harness = runnerHarness(new FailingDraftModel());

    const outcome = await harness.runner.run({
      runId: "run-outage",
      attempt: 1,
      packet: harness.packet,
      manualFallbackOnProviderFailure: true,
    });

    expect(outcome).toEqual({
      status: "manual_required",
      reason: "ProviderUnavailableError",
    });
    expect(harness.events.read("run-outage").at(-1)?.type).toBe(
      "run.manual_fallback",
    );
  });

  it("stores redacted hash-chained events rather than packet content", async () => {
    const harness = runnerHarness(
      new FixtureDraftModel(cleanCrackedTileDraft()),
    );
    await harness.runner.run({
      runId: "run-safe-log",
      attempt: 1,
      packet: harness.packet,
    });
    const events = harness.events.read("run-safe-log");

    expect(events[1]?.previousEventHash).toBe(events[0]?.eventHash);
    expect(JSON.stringify(events)).not.toContain("shower-base");
    expect(
      events.every((event) => /^[a-f0-9]{64}$/u.test(event.eventHash)),
    ).toBe(true);
  });
});

describe("OpenAI privacy and model policies", () => {
  it("pins Responses, no storage, low reasoning, and redacted SDK tracing", () => {
    expect(thinResponsesRequestPolicy()).toMatchObject({
      model: "gpt-5.6",
      store: false,
      reasoning: { effort: "low" },
    });
    expect(agentsSdkRuntimePolicy()).toEqual({
      model: "gpt-5.6",
      store: false,
      reasoningEffort: "low",
      tracingDisabled: true,
      traceIncludeSensitiveData: false,
      useResponses: true,
    });
  });

  it("uses Australian English transcription with token confidence and no invented timestamp contract", () => {
    const policy = transcriptionRequestPolicy();
    expect(policy).toMatchObject({
      model: "gpt-4o-transcribe",
      language: "en",
      response_format: "json",
      include: ["logprobs"],
    });
    expect(policy).not.toHaveProperty("timestamp_granularities");
  });

  it("schema rejects a module with a contradictory no-finding state", () => {
    const draft = cleanCrackedTileDraft();
    draft.modules[0]!.noReportableFinding = true;
    expect(InspectionDraftSchema.safeParse(draft).success).toBe(false);
  });

  it("redacts PII before preparing hash-verified multimodal model input", async () => {
    const basePacket = crackedTilePacket();
    const packet: InvestigationPacket = {
      ...basePacket,
      observations: basePacket.observations.map((observation, index) =>
        index === 0
          ? {
              ...observation,
              text: "Cracked tiles at 12 Example Street. Contact buyer@example.com or 0412 345 678.",
            }
          : observation,
      ),
    };
    const bytes = Buffer.from("verified-safe-image");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const selected = {
      artifactId: "proxy-one",
      parentArtifactId: "photo-cracked-tiles",
      contentHash,
      storageKey: "safe/organization-1/job-1/proxy-one.jpg",
      trustState: "safe_proxy" as const,
    };
    const request = await prepareInvestigationAiRequest({
      packet,
      selectedSafeProxies: [selected],
      provenance: {
        resolveVerifiedSafeProxy: () =>
          Promise.resolve({
            ...selected,
            mediaType: "image/jpeg" as const,
            base64Data: bytes.toString("base64"),
          }),
      },
    });

    const rendered = JSON.stringify(request);
    expect(rendered).not.toContain("buyer@example.com");
    expect(rendered).not.toContain("12 Example Street");
    expect(rendered).not.toContain("0412 345 678");
    expect(rendered).toContain("[redacted-email]");
    expect(request.input.safeProxyImages[0]?.dataUrl).toMatch(
      /^data:image\/jpeg;base64,/u,
    );
  });
});

class FixtureDraftModel implements DeterministicFixtureDraftModel {
  readonly architecture = "deterministic_fixture" as const;
  calls = 0;
  readonly #draft: InspectionDraft;

  constructor(draft: InspectionDraft) {
    this.#draft = draft;
  }

  async generate(input: DraftModelInput): Promise<DraftModelResult> {
    this.calls += 1;
    if (input.signal.aborted) {
      throw new Error("aborted");
    }
    return Promise.resolve({
      draft: structuredClone(this.#draft),
      model: "gpt-5.6",
      latencyMilliseconds: 100,
      usage: { inputTokens: 100, outputTokens: 50, requests: 1 },
      estimatedCostUsd: 0.01,
      loadedSkillVersions: [...this.#draft.skillVersions],
    });
  }
}

class FailingDraftModel implements DeterministicFixtureDraftModel {
  readonly architecture = "deterministic_fixture" as const;

  async generate(input: DraftModelInput): Promise<DraftModelResult> {
    void input;
    return Promise.reject(new ProviderUnavailableError());
  }
}

class ProviderUnavailableError extends Error {
  constructor() {
    super("Provider unavailable");
    this.name = "ProviderUnavailableError";
  }
}

function runnerHarness(model: DraftModel) {
  const packet = crackedTilePacket();
  const packets = new InMemoryCurrentPacketRepository();
  packets.setCurrent(
    packet.organizationId,
    packet.packetId,
    packet.canonicalHash,
  );
  const events = new InMemoryAgentRunEventStore();
  let eventNumber = 0;
  const runner = new InspectionDraftRunner({
    model,
    events,
    packets,
    drafts: new InMemoryProvisionalDraftRepository(),
    verifier: new ReadOnlyDraftVerifier(),
    budgets: {
      maxTurns: 6,
      timeoutMilliseconds: 10_000,
      maxEstimatedCostUsd: 0.5,
    },
    nowIso: () => "2026-07-15T00:00:00.000+10:00",
    eventId: () => `event-${++eventNumber}`,
  });
  return {
    packet,
    packets,
    events,
    runner,
    modelCalls: () => (model instanceof FixtureDraftModel ? model.calls : 0),
  };
}

function pestNoEvidenceFixture(text: string): {
  packet: InvestigationPacket;
  draft: InspectionDraft;
} {
  const buildingPacket = crackedTilePacket();
  const packet: InvestigationPacket = {
    ...buildingPacket,
    modules: [{ module: "timber_pest", moduleId: "module-pest" }],
    findingCandidates: [],
    moduleSchemas: [
      {
        module: "timber_pest",
        moduleId: "module-pest",
        schemaVersion: "timber-pest-finding-v1",
      },
    ],
    coverage: buildingPacket.coverage.map((coverage) => ({
      ...coverage,
      module: "timber_pest",
      moduleId: "module-pest",
    })),
  };
  const sourceRefs = [
    { kind: "observation" as const, sourceId: "observation-cracked-tiles" },
  ];
  return {
    packet,
    draft: {
      ...cleanCrackedTileDraft(),
      modules: [
        {
          module: "timber_pest",
          moduleId: "module-pest",
          findings: [],
          limitations: [],
          conclusion: {
            clauseId: "pest-conclusion",
            kind: "conclusion",
            text,
            qualification: "observed",
            sourceRefs,
          },
          noReportableFinding: true,
        },
      ],
    },
  };
}
