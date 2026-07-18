import { theme } from "@inspection/theme/tokens";
import type {
  InvestigationDraftingDisposition,
  InvestigationModuleLink,
} from "@inspection/domain/inspection/mobile";

import {
  investigationCompletionVoiceBlock,
  type VoiceControlState,
} from "./field-shell-contract";

export const investigationFinishOptions = {
  findingCandidates: {
    label: "Create finding candidate",
    hint: "Select Building, Timber Pest, or both; the inspector reviews each module separately",
    minimumTargetSize: theme.target.minimum,
  },
  noReportableFinding: {
    label: "No reportable finding",
    hint: "Closes the investigation without creating a finding or implying the whole area is defect-free",
    minimumTargetSize: theme.target.minimum,
  },
  finishNow: {
    label: "Finish now",
    hint: "Closes the thread immediately; optional AI drafting runs later and never blocks field capture",
    minimumTargetSize: theme.target.minimum,
  },
} as const;

export type FinishInvestigationChoice =
  | {
      readonly outcome: "no_reportable_finding";
      readonly draftingDisposition: "manual_only";
      readonly moduleLinks: readonly [];
    }
  | {
      readonly outcome: "finding_candidates";
      readonly draftingDisposition: InvestigationDraftingDisposition;
      readonly moduleLinks: readonly InvestigationModuleLink[];
    };

export type InvestigationFinishActionView = Readonly<{
  blockedReason: string | null;
  finishDisabled: boolean;
  noReportableFindingDisabled: boolean;
  saveFindingCandidateDisabled: boolean;
}>;

export function deriveInvestigationFinishActionView(input: {
  readonly busy: boolean;
  readonly voiceState: VoiceControlState;
}): InvestigationFinishActionView {
  const blockedReason = investigationCompletionVoiceBlock(input.voiceState);
  const disabled = input.busy || blockedReason !== null;
  return {
    blockedReason,
    finishDisabled: disabled,
    noReportableFindingDisabled: disabled,
    saveFindingCandidateDisabled: disabled,
  };
}

export function createNoReportableFindingChoice(): FinishInvestigationChoice {
  return {
    outcome: "no_reportable_finding",
    draftingDisposition: "manual_only",
    moduleLinks: [],
  };
}

export function createFindingCandidateChoice(input: {
  readonly useAiWhenAvailable: boolean;
  readonly moduleLinks: readonly InvestigationModuleLink[];
}): FinishInvestigationChoice {
  return {
    outcome: "finding_candidates",
    draftingDisposition: input.useAiWhenAvailable
      ? "queue_ai_asynchronously"
      : "manual_only",
    moduleLinks: input.moduleLinks,
  };
}
