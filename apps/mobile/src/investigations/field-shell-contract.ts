import { theme } from "@inspection/theme/tokens";
import type { InvestigationStatus } from "@inspection/domain/inspection/types";

export type VoiceControlState = "idle" | "recording" | "saving" | "unavailable";

export const investigationFieldControls = {
  photo: {
    label: "Take photo",
    hint: "Saves a private coverage photo locally; it can be attached to an investigation now or later",
    minimumTargetSize: theme.target.minimum,
    position: "primary_thumb_zone",
  },
  voice: {
    label: "Record voice note",
    activeLabel: "Stop voice note",
    hint: "Tap to start or stop a voice note without changing camera mode",
    minimumTargetSize: theme.target.minimum,
    position: "primary_thumb_zone",
  },
  investigation: {
    label: "Start investigation",
    hint: "Starts an evidence thread in one action at the current area",
    minimumTargetSize: theme.target.minimum,
    position: "primary_thumb_zone",
    activationActions: 1,
  },
  attachRecent: {
    label: "Attach recent",
    hint: "Selects recent captures from this job without changing their original metadata",
    minimumTargetSize: theme.target.minimum,
    position: "secondary_thumb_zone",
  },
  changeArea: {
    label: "Change area",
    hint: "Changes capture location while keeping the current investigation active",
    minimumTargetSize: theme.target.minimum,
    position: "secondary_thumb_zone",
  },
  pause: {
    label: "Pause investigation",
    resumeLabel: "Resume investigation",
    hint: "Pauses or resumes this investigation without closing its evidence thread",
    minimumTargetSize: theme.target.minimum,
    position: "secondary_thumb_zone",
  },
  finish: {
    label: "Finish investigation",
    hint: "Finishes the evidence thread without waiting for AI processing",
    minimumTargetSize: theme.target.minimum,
    position: "secondary_thumb_zone",
  },
} as const;

export const investigationShellAccessibilityContract = {
  maximumSupportedTextScale: 2,
  minimumTargetSize: theme.target.minimum,
  primaryControlsRemainInSingleCaptureShell: true,
  statusUsesText: true,
  supportsDynamicType: true,
  controlsMayWrapAtLargeText: true,
  voiceRecordingBlocksPhotoShutter: false,
} as const;

export type InvestigationShellView = {
  readonly currentAreaLabel: string;
  readonly investigationStatusLabel: string;
  readonly photoEnabled: boolean;
  readonly voiceLabel: string;
  readonly voiceStateLabel: string;
  readonly investigationActionLabel: string;
  readonly attachRecentLabel: string | null;
  readonly finishAvailable: boolean;
};

export function deriveInvestigationShellView(input: {
  readonly currentAreaLabel: string;
  readonly investigationStatus: InvestigationStatus | "none";
  readonly recentCaptureCount: number;
  readonly voiceState: VoiceControlState;
}): InvestigationShellView {
  const activeOrPaused =
    input.investigationStatus === "active" ||
    input.investigationStatus === "paused";
  return {
    currentAreaLabel: input.currentAreaLabel,
    investigationStatusLabel: statusLabel(input.investigationStatus),
    photoEnabled: true,
    voiceLabel:
      input.voiceState === "recording"
        ? investigationFieldControls.voice.activeLabel
        : investigationFieldControls.voice.label,
    voiceStateLabel: voiceStateLabel(input.voiceState),
    investigationActionLabel:
      input.investigationStatus === "paused"
        ? investigationFieldControls.pause.resumeLabel
        : input.investigationStatus === "active"
          ? investigationFieldControls.pause.label
          : investigationFieldControls.investigation.label,
    attachRecentLabel:
      activeOrPaused && input.recentCaptureCount > 0
        ? `${investigationFieldControls.attachRecent.label} (${input.recentCaptureCount})`
        : null,
    finishAvailable: input.investigationStatus === "active",
  };
}

function statusLabel(status: InvestigationStatus | "none"): string {
  switch (status) {
    case "none":
      return "No active investigation";
    case "active":
      return "Investigation active";
    case "paused":
      return "Investigation paused";
    case "completed_findings":
      return "Investigation finished with finding candidates";
    case "completed_no_reportable_finding":
      return "Investigation finished with no reportable finding";
  }
}

function voiceStateLabel(state: VoiceControlState): string {
  switch (state) {
    case "idle":
      return "Voice note ready";
    case "recording":
      return "Voice note recording; photo capture remains available";
    case "saving":
      return "Voice note saving locally; photo capture remains available";
    case "unavailable":
      return "Voice note unavailable; add a manual note instead";
  }
}
