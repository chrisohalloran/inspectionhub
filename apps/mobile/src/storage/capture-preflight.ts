export type ThermalState =
  "critical" | "fair" | "nominal" | "serious" | "unknown";

export type CapturePreflightSignals = {
  availableBytes: number;
  batteryLevel: number;
  lowPowerMode: boolean;
  thermalState: ThermalState;
};

export type CapturePreflightResult = {
  allowMediaCapture: boolean;
  manualNoteAvailable: true;
  reason:
    | "battery_and_thermal_warning"
    | "battery_warning"
    | "ready"
    | "storage_critical"
    | "storage_warning"
    | "thermal_critical"
    | "thermal_warning";
  severity: "ready" | "terminal" | "warning";
};

export const captureStoragePolicy = {
  criticalAvailableBytes: 128 * 1024 * 1024,
  warningAvailableBytes: 512 * 1024 * 1024,
} as const;

export function assessCapturePreflight(
  signals: CapturePreflightSignals,
): CapturePreflightResult {
  if (signals.availableBytes < captureStoragePolicy.criticalAvailableBytes) {
    return {
      allowMediaCapture: false,
      manualNoteAvailable: true,
      reason: "storage_critical",
      severity: "terminal",
    };
  }
  if (signals.thermalState === "critical") {
    return {
      allowMediaCapture: false,
      manualNoteAvailable: true,
      reason: "thermal_critical",
      severity: "terminal",
    };
  }

  const batteryWarning = signals.batteryLevel <= 0.1 || signals.lowPowerMode;
  const thermalWarning = signals.thermalState === "serious";
  if (batteryWarning && thermalWarning) {
    return {
      allowMediaCapture: true,
      manualNoteAvailable: true,
      reason: "battery_and_thermal_warning",
      severity: "warning",
    };
  }
  if (batteryWarning) {
    return {
      allowMediaCapture: true,
      manualNoteAvailable: true,
      reason: "battery_warning",
      severity: "warning",
    };
  }
  if (thermalWarning) {
    return {
      allowMediaCapture: true,
      manualNoteAvailable: true,
      reason: "thermal_warning",
      severity: "warning",
    };
  }
  if (signals.availableBytes < captureStoragePolicy.warningAvailableBytes) {
    return {
      allowMediaCapture: true,
      manualNoteAvailable: true,
      reason: "storage_warning",
      severity: "warning",
    };
  }
  return {
    allowMediaCapture: true,
    manualNoteAvailable: true,
    reason: "ready",
    severity: "ready",
  };
}
