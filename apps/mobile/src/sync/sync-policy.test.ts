import { describe, expect, it } from "vitest";

import { assessEvidenceRisk, planForegroundSync } from "./sync-policy.js";

describe("local sync policy", () => {
  it("schedules photo and voice independently only while foregrounded and authorised", () => {
    expect(
      planForegroundSync({
        appState: "foreground",
        deviceState: "enrolled",
        network: "available",
        pending: [
          { captureId: "photo-1", lane: "photo_upload" },
          { captureId: "voice-1", lane: "voice_upload" },
        ],
        session: "valid",
      }),
    ).toEqual({
      claim: "foreground_attempt_only",
      lanes: {
        photo_upload: ["photo-1"],
        voice_upload: ["voice-1"],
      },
    });
  });

  it("makes no background-delivery guarantee and waits safely offline or after expiry", () => {
    expect(
      planForegroundSync({
        appState: "background",
        deviceState: "enrolled",
        network: "available",
        pending: [{ captureId: "photo-1", lane: "photo_upload" }],
        session: "valid",
      }),
    ).toMatchObject({
      blockedBy: "app_not_foreground",
      claim: "not_scheduled",
    });
    expect(
      planForegroundSync({
        appState: "foreground",
        deviceState: "enrolled",
        network: "unavailable",
        pending: [{ captureId: "photo-1", lane: "photo_upload" }],
        session: "valid",
      }),
    ).toMatchObject({ blockedBy: "offline", claim: "not_scheduled" });
  });

  it("uses evidence_at_risk for unsynchronised evidence on a revoked or lost device", () => {
    expect(
      assessEvidenceRisk({
        deviceState: "lost",
        unsynchronisedCaptureIds: ["photo-1", "voice-1"],
      }),
    ).toEqual({
      captureIds: ["photo-1", "voice-1"],
      state: "evidence_at_risk",
    });
    expect(
      assessEvidenceRisk({
        deviceState: "lost",
        unsynchronisedCaptureIds: [],
      }),
    ).toEqual({ captureIds: [], state: "server_durable" });
  });

  it("retains the same identities through a twenty-minute offline interval and reconnect", () => {
    const pending = [
      { captureId: "photo-offline-1", lane: "photo_upload" as const },
      { captureId: "voice-offline-1", lane: "voice_upload" as const },
    ];
    expect(
      planForegroundSync({
        appState: "foreground",
        deviceState: "enrolled",
        network: "unavailable",
        pending,
        session: "valid",
      }),
    ).toMatchObject({ blockedBy: "offline", claim: "not_scheduled" });

    // Elapsed time does not mint replacement identities or imply background work.
    const afterTwentyMinutes = planForegroundSync({
      appState: "foreground",
      deviceState: "enrolled",
      network: "available",
      pending,
      session: "valid",
    });
    expect(afterTwentyMinutes).toEqual({
      claim: "foreground_attempt_only",
      lanes: {
        photo_upload: ["photo-offline-1"],
        voice_upload: ["voice-offline-1"],
      },
    });
  });
});
