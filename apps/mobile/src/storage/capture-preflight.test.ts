import { describe, expect, it } from "vitest";

import { assessCapturePreflight } from "./capture-preflight.js";

describe("capture preflight", () => {
  it("blocks media capture before storage exhaustion but keeps manual notes available", () => {
    expect(
      assessCapturePreflight({
        availableBytes: 64 * 1024 * 1024,
        batteryLevel: 0.8,
        lowPowerMode: false,
        thermalState: "nominal",
      }),
    ).toEqual({
      allowMediaCapture: false,
      manualNoteAvailable: true,
      reason: "storage_critical",
      severity: "terminal",
    });
  });

  it("keeps capture available with literal battery and thermal warnings", () => {
    expect(
      assessCapturePreflight({
        availableBytes: 2 * 1024 * 1024 * 1024,
        batteryLevel: 0.08,
        lowPowerMode: true,
        thermalState: "serious",
      }),
    ).toEqual({
      allowMediaCapture: true,
      manualNoteAvailable: true,
      reason: "battery_and_thermal_warning",
      severity: "warning",
    });
  });

  it("fails closed on critical thermal pressure", () => {
    expect(
      assessCapturePreflight({
        availableBytes: 2 * 1024 * 1024 * 1024,
        batteryLevel: 0.8,
        lowPowerMode: false,
        thermalState: "critical",
      }),
    ).toMatchObject({
      allowMediaCapture: false,
      manualNoteAvailable: true,
      reason: "thermal_critical",
    });
  });
});
