import { describe, expect, it } from "vitest";

import {
  compactOperationStatus,
  deriveInvestigationShellView,
  durabilityAnnouncement,
  investigationFieldControls,
  investigationShellAccessibilityContract,
} from "./field-shell-contract.js";
import { selectRecentJobCaptures } from "./recent-captures.js";

describe("single capture shell investigation contract", () => {
  it("keeps concise visible durability status without hiding the full area path", () => {
    expect(compactOperationStatus("saved")).toBe("Saved locally");
    expect(compactOperationStatus("needs_review")).toBe("Needs review");
    expect(compactOperationStatus("not_saved")).toBe("Not saved — retry");
  });

  it("builds one explicit announcement for saved and failed durability states", () => {
    expect(durabilityAnnouncement("ready", "Storage ready.")).toBeNull();
    expect(
      durabilityAnnouncement(
        "not_saved",
        "Photo not acknowledged — retry capture.",
      ),
    ).toBe("Not saved — retry. Photo not acknowledged — retry capture.");
  });

  it("starts an investigation in one action and keeps all primary targets at least 48 pixels", () => {
    expect(investigationFieldControls.investigation.activationActions).toBe(1);
    for (const control of Object.values(investigationFieldControls)) {
      expect(control.minimumTargetSize).toBeGreaterThanOrEqual(48);
      expect(control.label.length).toBeGreaterThan(0);
      expect(control.hint.length).toBeGreaterThan(0);
    }
  });

  it("keeps the photo shutter enabled while voice recording or saving", () => {
    for (const voiceState of ["recording", "saving"] as const) {
      const view = deriveInvestigationShellView({
        currentAreaLabel: "Second floor / Main bathroom",
        investigationStatus: "active",
        recentCaptureCount: 3,
        voiceState,
      });
      expect(view.photoEnabled).toBe(true);
      expect(view.voiceStateLabel).toContain("photo capture remains available");
    }
    expect(
      investigationShellAccessibilityContract.voiceRecordingBlocksPhotoShutter,
    ).toBe(false);
  });

  it("exposes explicit pause, resume, attach-recent, finish, and no-finding status text", () => {
    expect(
      deriveInvestigationShellView({
        currentAreaLabel: "Main bathroom",
        investigationStatus: "active",
        recentCaptureCount: 3,
        voiceState: "idle",
      }),
    ).toMatchObject({
      investigationActionLabel: "Pause investigation",
      attachRecentLabel: "Attach recent (3)",
      finishAvailable: true,
    });
    expect(
      deriveInvestigationShellView({
        currentAreaLabel: "Main bathroom",
        investigationStatus: "paused",
        recentCaptureCount: 0,
        voiceState: "idle",
      }).investigationActionLabel,
    ).toBe("Resume investigation");
    expect(
      deriveInvestigationShellView({
        currentAreaLabel: "Main bathroom",
        investigationStatus: "completed_no_reportable_finding",
        recentCaptureCount: 0,
        voiceState: "idle",
      }).investigationStatusLabel,
    ).toBe("Investigation finished with no reportable finding");
  });

  it("supports 200 percent text scaling with wrapping rather than hiding primary controls", () => {
    expect(
      investigationShellAccessibilityContract.maximumSupportedTextScale,
    ).toBe(2);
    expect(
      investigationShellAccessibilityContract.controlsMayWrapAtLargeText,
    ).toBe(true);
    expect(
      investigationShellAccessibilityContract.primaryControlsRemainInSingleCaptureShell,
    ).toBe(true);
  });

  it("selects only recent captures from the current job and returns chronological attach order", () => {
    const captures = [
      capture("job-current", "photo-2", 2, "2026-07-14T08:00:02.000+10:00"),
      capture("job-other", "wrong-job", 4, "2026-07-14T08:00:04.000+10:00"),
      capture("job-current", "future", 5, "2026-07-14T08:00:05.000+10:00"),
      capture("job-current", "photo-1", 1, "2026-07-14T08:00:01.000+10:00"),
      capture("job-current", "photo-3", 3, "2026-07-14T08:00:03.000+10:00"),
    ];

    expect(
      selectRecentJobCaptures({
        captures,
        jobId: "job-current",
        beforeOrAt: "2026-07-14T08:00:04.000+10:00",
        limit: 3,
      }).map((item) => item.artifactId),
    ).toEqual(["photo-1", "photo-2", "photo-3"]);
  });
});

function capture(
  jobId: string,
  artifactId: string,
  captureSequence: number,
  capturedAt: string,
) {
  return {
    artifactId,
    artifactKind: "photo" as const,
    captureAreaId: "main-bathroom",
    capturedAt,
    captureSequence,
    jobId,
  };
}
