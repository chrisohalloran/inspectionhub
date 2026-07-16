import type { InvestigationPacket } from "@inspection/domain";
import type { PreparedAiRequest } from "@inspection/provider-openai";

import type { InspectionDraft } from "../schemas.js";

export type DraftModelUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly requests: number;
};

export type DraftModelResult = {
  readonly draft: InspectionDraft;
  readonly model: string;
  readonly latencyMilliseconds: number;
  readonly usage: DraftModelUsage;
  readonly estimatedCostUsd: number;
  readonly loadedSkillVersions: readonly string[];
};

export type DeterministicDraftModelInput = {
  readonly packet: InvestigationPacket;
  readonly signal: AbortSignal;
  readonly maxTurns: number;
};

export type PreparedDraftModelInput = {
  readonly request: PreparedAiRequest;
  readonly signal: AbortSignal;
  readonly maxTurns: number;
};

/** @deprecated Use DeterministicDraftModelInput for fixture-only models. */
export type DraftModelInput = DeterministicDraftModelInput;

export interface PreparedAiDraftModel {
  readonly architecture: "agents_sdk" | "thin_responses";
  generate(input: PreparedDraftModelInput): Promise<DraftModelResult>;
}

export interface DeterministicFixtureDraftModel {
  readonly architecture: "deterministic_fixture";
  generate(input: DeterministicDraftModelInput): Promise<DraftModelResult>;
}

export type DraftModel = PreparedAiDraftModel | DeterministicFixtureDraftModel;

export type ModelPricing = {
  readonly version: string;
  readonly inputUsdPerMillionTokens: number;
  readonly outputUsdPerMillionTokens: number;
};

export function estimateCostUsd(
  usage: DraftModelUsage,
  pricing: ModelPricing,
): number {
  return (
    (usage.inputTokens * pricing.inputUsdPerMillionTokens +
      usage.outputTokens * pricing.outputUsdPerMillionTokens) /
    1_000_000
  );
}
