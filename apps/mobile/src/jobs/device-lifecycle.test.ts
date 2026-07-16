import { describe, expect, it } from "vitest";

import {
  applyObservedDeviceAuthority,
  planReplacementHydration,
} from "./device-lifecycle.js";

describe("field device lifecycle", () => {
  it("fails closed when a server revocation wins the reconnect race", () => {
    expect(
      applyObservedDeviceAuthority({
        localDeviceState: "enrolled",
        observedServerState: "revoked",
        pendingCaptureIds: ["photo-local", "voice-local"],
      }),
    ).toEqual({
      captureAllowed: false,
      deviceState: "revoked",
      evidenceAtRisk: ["photo-local", "voice-local"],
      remoteWipe: "best_effort_requested",
      syncAllowed: false,
    });
  });

  it("recovers only server-durable identities onto a replacement device", () => {
    expect(
      planReplacementHydration({
        localOnlyCaptureIds: ["lost-offline-photo"],
        serverDurableCaptureIds: ["photo-1", "voice-1"],
      }),
    ).toEqual({
      evidenceAtRisk: ["lost-offline-photo"],
      recoverableCaptureIds: ["photo-1", "voice-1"],
    });
  });
});
