import type { CaptureResult } from "../capture/types";
import type { createCaptureCoordinator } from "../capture/capture-coordinator";

type CaptureCoordinator = ReturnType<typeof createCaptureCoordinator>;

export async function captureVoiceNote(
  coordinator: CaptureCoordinator,
  request: Omit<Parameters<CaptureCoordinator["capture"]>[0], "kind">,
): Promise<CaptureResult> {
  return coordinator.capture({ ...request, kind: "voice" });
}
