import type { InvestigationPacket } from "@inspection/domain";
import { sha256 } from "@inspection/domain";
import {
  assertPreparedAiRequest,
  type PreparedAiRequest,
} from "@inspection/provider-openai";

import type {
  AgentRunEventStore,
  AgentRunEventType,
  SafeEventValue,
} from "./events.js";
import { runDeterministicDraftGuard } from "./guards.js";
import type { DraftModel } from "./models/types.js";
import type {
  CurrentPacketRepository,
  ProvisionalDraftRecord,
  ProvisionalDraftRepository,
} from "./repository.js";
import { StalePacketError } from "./repository.js";
import { InspectionDraftSchema } from "./schemas.js";
import type { ReadOnlyDraftVerifier } from "./verifier/deterministic-verifier.js";

export type AgentRunnerBudgets = {
  readonly maxTurns: number;
  readonly timeoutMilliseconds: number;
  readonly maxEstimatedCostUsd: number;
};

export type AgentRunOutcome =
  | { readonly status: "verified"; readonly record: ProvisionalDraftRecord }
  | { readonly status: "rejected"; readonly record: ProvisionalDraftRecord }
  | {
      readonly status: "superseded";
      readonly record: ProvisionalDraftRecord | null;
    }
  | { readonly status: "manual_required"; readonly reason: string };

export type RunnerFaultCheckpoint =
  "after_draft" | "after_guard" | "after_verifier";

export class InspectionDraftRunner {
  readonly #model: DraftModel;
  readonly #events: AgentRunEventStore;
  readonly #packets: CurrentPacketRepository;
  readonly #drafts: ProvisionalDraftRepository;
  readonly #verifier: ReadOnlyDraftVerifier;
  readonly #budgets: AgentRunnerBudgets;
  readonly #nowIso: () => string;
  readonly #eventId: () => string;

  constructor(input: {
    readonly model: DraftModel;
    readonly events: AgentRunEventStore;
    readonly packets: CurrentPacketRepository;
    readonly drafts: ProvisionalDraftRepository;
    readonly verifier: ReadOnlyDraftVerifier;
    readonly budgets: AgentRunnerBudgets;
    readonly nowIso?: () => string;
    readonly eventId?: () => string;
  }) {
    if (
      input.budgets.maxTurns < 1 ||
      input.budgets.timeoutMilliseconds < 1 ||
      input.budgets.maxEstimatedCostUsd <= 0
    ) {
      throw new Error("Agent runner budgets must be positive and bounded");
    }
    this.#model = input.model;
    this.#events = input.events;
    this.#packets = input.packets;
    this.#drafts = input.drafts;
    this.#verifier = input.verifier;
    this.#budgets = input.budgets;
    this.#nowIso = input.nowIso ?? (() => new Date().toISOString());
    this.#eventId = input.eventId ?? (() => crypto.randomUUID());
  }

  async run(input: {
    readonly runId: string;
    readonly attempt: number;
    readonly packet: InvestigationPacket;
    readonly preparedRequest?: PreparedAiRequest;
    readonly signal?: AbortSignal;
    readonly manualFallbackOnProviderFailure?: boolean;
    readonly faultAfter?: RunnerFaultCheckpoint;
  }): Promise<AgentRunOutcome> {
    let record = await this.#drafts.bindAndGet({
      runId: input.runId,
      organizationId: input.packet.organizationId,
      jobId: input.packet.jobId,
      packetId: input.packet.packetId,
      packetHash: input.packet.canonicalHash,
    });
    await this.#append(input, "run.started", {
      architecture: this.#model.architecture,
      packetHash: input.packet.canonicalHash,
    });
    await this.#append(input, "attempt.started", { attempt: input.attempt });
    await this.#append(input, "packet.loaded", {
      packetHash: input.packet.canonicalHash,
      packetRevision: input.packet.packetRevision,
    });

    try {
      if (!(await this.#isPacketCurrent(input.packet))) {
        throw new StalePacketError();
      }
      if (record === null) {
        record = await this.#generateAndPersist(input);
      }
      if (input.faultAfter === "after_draft" && !record.deterministicChecked) {
        throw new SimulatedRunnerCrash("after_draft");
      }
      if (!record.deterministicChecked) {
        const deterministicResult = runDeterministicDraftGuard(
          input.packet,
          record.draft,
        );
        record = await this.#drafts.updateIfCurrent({
          runId: record.runId,
          expectedDraftHash: record.draftHash,
          packetRepository: this.#packets,
          update: (current) => ({ ...current, deterministicChecked: true }),
        });
        await this.#append(input, "deterministic_check.completed", {
          draftHash: record.draftHash,
          passed: deterministicResult.passed,
          criticalIssueCount: deterministicResult.issues.filter(
            (issue) => issue.severity === "critical",
          ).length,
        });
      }
      if (input.faultAfter === "after_guard" && record.verification === null) {
        throw new SimulatedRunnerCrash("after_guard");
      }
      if (record.verification === null) {
        await this.#append(input, "verifier.requested", {
          draftHash: record.draftHash,
        });
        const verification = this.#verifier.verify({
          packet: input.packet,
          draft: record.draft,
          verifiedAt: this.#nowIso(),
        });
        record = await this.#drafts.updateIfCurrent({
          runId: record.runId,
          expectedDraftHash: record.draftHash,
          packetRepository: this.#packets,
          update: (current) => ({
            ...current,
            verification,
            status: verification.passed ? "verified" : "rejected",
          }),
        });
        await this.#append(input, "verifier.completed", {
          draftHash: record.draftHash,
          passed: verification.passed,
          criticalIssueCount: verification.issues.filter(
            (issue) => issue.severity === "critical",
          ).length,
        });
      }
      if (input.faultAfter === "after_verifier") {
        throw new SimulatedRunnerCrash("after_verifier");
      }
      await this.#appendOnce(input, "run.completed", {
        draftHash: record.draftHash,
        status: record.status,
      });
      return record.status === "verified"
        ? { status: "verified", record }
        : { status: "rejected", record };
    } catch (error) {
      if (error instanceof SimulatedRunnerCrash) {
        throw error;
      }
      if (error instanceof StalePacketError) {
        if (record !== null) {
          record = await this.#drafts.markStale({
            runId: record.runId,
            expectedDraftHash: record.draftHash,
          });
        }
        await this.#appendOnce(input, "run.superseded", {
          packetHash: input.packet.canonicalHash,
        });
        return { status: "superseded", record };
      }
      const reason = safeErrorReason(error);
      await this.#append(input, "run.failed", { reason });
      if (input.manualFallbackOnProviderFailure === true) {
        await this.#append(input, "run.manual_fallback", { reason });
        return { status: "manual_required", reason };
      }
      throw error;
    }
  }

  async #generateAndPersist(input: {
    readonly runId: string;
    readonly attempt: number;
    readonly packet: InvestigationPacket;
    readonly preparedRequest?: PreparedAiRequest;
    readonly signal?: AbortSignal;
  }): Promise<ProvisionalDraftRecord> {
    await this.#append(input, "model.requested", {
      architecture: this.#model.architecture,
      packetHash: input.packet.canonicalHash,
    });
    const timeoutSignal = AbortSignal.timeout(
      this.#budgets.timeoutMilliseconds,
    );
    const signal =
      input.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([input.signal, timeoutSignal]);
    const result =
      this.#model.architecture === "deterministic_fixture"
        ? await this.#model.generate({
            packet: input.packet,
            signal,
            maxTurns: this.#budgets.maxTurns,
          })
        : await this.#model.generate({
            request: requiredPreparedRequest(
              input.preparedRequest,
              input.packet,
            ),
            signal,
            maxTurns: this.#budgets.maxTurns,
          });
    if (result.estimatedCostUsd > this.#budgets.maxEstimatedCostUsd) {
      throw new Error(
        "Model result exceeded the configured per-run cost budget",
      );
    }
    const draft = InspectionDraftSchema.parse(result.draft);
    assertDraftPins(input.packet, draft, result.model);
    if (this.#model.architecture === "agents_sdk") {
      assertLoadedSkillPins(
        input.packet.versionPins.skillVersions,
        result.loadedSkillVersions,
      );
    }
    const draftHash = sha256(draft);
    for (const skillVersion of result.loadedSkillVersions) {
      await this.#append(input, "skill.loaded", { skillVersion });
    }
    await this.#append(input, "model.completed", {
      model: result.model,
      latencyMilliseconds: result.latencyMilliseconds,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estimatedCostUsd: result.estimatedCostUsd,
    });
    const record = await this.#drafts.insertIfCurrent({
      packetRepository: this.#packets,
      record: {
        runId: input.runId,
        attempt: input.attempt,
        organizationId: input.packet.organizationId,
        jobId: input.packet.jobId,
        packetId: input.packet.packetId,
        packetHash: input.packet.canonicalHash,
        draftHash,
        draft,
        deterministicChecked: false,
        verification: null,
        status: "provisional",
      },
    });
    await this.#append(input, "draft.persisted", { draftHash });
    return record;
  }

  async #isPacketCurrent(packet: InvestigationPacket): Promise<boolean> {
    return this.#packets.isCurrent({
      organizationId: packet.organizationId,
      packetId: packet.packetId,
      packetHash: packet.canonicalHash,
    });
  }

  async #append(
    input: { readonly runId: string; readonly attempt: number },
    type: AgentRunEventType,
    safeMetadata: Readonly<Record<string, SafeEventValue>>,
  ): Promise<void> {
    await this.#events.append({
      eventId: this.#eventId(),
      runId: input.runId,
      attempt: input.attempt,
      type,
      occurredAt: this.#nowIso(),
      safeMetadata,
    });
  }

  async #appendOnce(
    input: { readonly runId: string; readonly attempt: number },
    type: AgentRunEventType,
    safeMetadata: Readonly<Record<string, SafeEventValue>>,
  ): Promise<void> {
    const events = await this.#events.read(input.runId);
    if (!events.some((event) => event.type === type)) {
      await this.#append(input, type, safeMetadata);
    }
  }
}

function requiredPreparedRequest(
  request: PreparedAiRequest | undefined,
  packet: InvestigationPacket,
): PreparedAiRequest {
  if (request === undefined) {
    throw new Error("A real model run requires a PreparedAiRequest");
  }
  assertPreparedAiRequest(request);
  if (
    request.input.packetId !== packet.packetId ||
    request.input.packetHash !== packet.canonicalHash ||
    request.input.packetRevision !== packet.packetRevision ||
    request.model !== packet.versionPins.model ||
    request.input.promptVersion !== packet.versionPins.promptVersion
  ) {
    throw new Error("PreparedAiRequest does not match the exact frozen packet");
  }
  return request;
}

function assertLoadedSkillPins(
  expected: readonly string[],
  loaded: readonly string[],
): void {
  if (
    loaded.length !== expected.length ||
    loaded.some((version) => !expected.includes(version))
  ) {
    throw new Error(
      "Agents SDK planner did not load every exact packet-pinned skill",
    );
  }
}

function assertDraftPins(
  packet: InvestigationPacket,
  draft: ReturnType<typeof InspectionDraftSchema.parse>,
  model: string,
): void {
  if (draft.origin !== "ai") {
    throw new Error(
      "A model runner may persist only explicitly AI-origin provisional drafts",
    );
  }
  if (
    draft.packetId !== packet.packetId ||
    draft.packetHash !== packet.canonicalHash ||
    draft.packetRevision !== packet.packetRevision ||
    draft.model !== model ||
    draft.promptVersion !== packet.versionPins.promptVersion ||
    draft.model !== packet.versionPins.model
  ) {
    throw new Error(
      "Draft identity and model/prompt pins must match the exact packet",
    );
  }
  if (
    draft.skillVersions.length !== packet.versionPins.skillVersions.length ||
    draft.skillVersions.some(
      (version) => !packet.versionPins.skillVersions.includes(version),
    )
  ) {
    throw new Error("Draft skill versions must match the frozen packet pins");
  }
}

function safeErrorReason(error: unknown): string {
  if (error instanceof Error) {
    return error.name.slice(0, 200);
  }
  return "UnknownError";
}

export class SimulatedRunnerCrash extends Error {
  constructor(checkpoint: RunnerFaultCheckpoint) {
    super(`Simulated runner crash ${checkpoint}`);
    this.name = "SimulatedRunnerCrash";
  }
}
