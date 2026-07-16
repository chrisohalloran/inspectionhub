import * as Battery from "expo-battery";
import { Paths } from "expo-file-system";

import { getThermalState } from "../../modules/expo-durable-file";

import type { CapturePreflightSignals } from "./capture-preflight";

export async function readCapturePreflightSignals(): Promise<CapturePreflightSignals> {
  const [power, thermalState] = await Promise.all([
    Battery.getPowerStateAsync(),
    getThermalState(),
  ]);
  return {
    availableBytes: Paths.availableDiskSpace,
    batteryLevel: power.batteryLevel < 0 ? 1 : power.batteryLevel,
    lowPowerMode: power.lowPowerMode,
    thermalState,
  };
}
