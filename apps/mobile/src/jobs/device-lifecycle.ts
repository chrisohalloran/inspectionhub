import type { DeviceState } from "../capture/types";

export type ServerDeviceState = "enrolled" | "revoked";

export function applyObservedDeviceAuthority(input: {
  localDeviceState: DeviceState;
  observedServerState: ServerDeviceState;
  pendingCaptureIds: readonly string[];
}): {
  captureAllowed: boolean;
  deviceState: DeviceState;
  evidenceAtRisk: readonly string[];
  remoteWipe: "best_effort_not_needed" | "best_effort_requested";
  syncAllowed: boolean;
} {
  const revoked =
    input.localDeviceState !== "enrolled" ||
    input.observedServerState === "revoked";
  if (revoked) {
    return {
      captureAllowed: false,
      deviceState: input.localDeviceState === "lost" ? "lost" : "revoked",
      evidenceAtRisk: [...input.pendingCaptureIds],
      remoteWipe: "best_effort_requested",
      syncAllowed: false,
    };
  }
  return {
    captureAllowed: true,
    deviceState: "enrolled",
    evidenceAtRisk: [],
    remoteWipe: "best_effort_not_needed",
    syncAllowed: true,
  };
}

export function planReplacementHydration(input: {
  localOnlyCaptureIds: readonly string[];
  serverDurableCaptureIds: readonly string[];
}): {
  evidenceAtRisk: readonly string[];
  recoverableCaptureIds: readonly string[];
} {
  return {
    evidenceAtRisk: [...new Set(input.localOnlyCaptureIds)],
    recoverableCaptureIds: [...new Set(input.serverDurableCaptureIds)],
  };
}
