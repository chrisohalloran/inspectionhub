import type {
  DurableCaptureInput,
  DurableCaptureResult,
} from "../../modules/expo-durable-file";
import type {
  CaptureIntent,
  CaptureIntentState,
  CaptureQueueItem,
  CapturePerformanceSample,
  DurableArtifact,
  FieldSessionSnapshot,
  LocalCaptureEvent,
  ManualNote,
  QueueLane,
} from "../capture/types";
import type { QueueEvent } from "../sync/queue-machine";

export interface DurableFilePort {
  persistCapture(input: DurableCaptureInput): Promise<DurableCaptureResult>;
}

export interface CaptureLedger {
  beginIntent(intent: CaptureIntent): Promise<void>;
  commitDurableCapture(
    captureId: string,
    artifact: DurableArtifact,
  ): Promise<void>;
  getArtifact(captureId: string): DurableArtifact | undefined;
  getFieldSession(): FieldSessionSnapshot | undefined;
  getIntent(captureId: string): CaptureIntent | undefined;
  getQueue(captureId: string): CaptureQueueItem | undefined;
  listArtifacts(): readonly DurableArtifact[];
  listEvents(): readonly LocalCaptureEvent[];
  listIntents(): readonly CaptureIntent[];
  listPerformanceSamples(): readonly CapturePerformanceSample[];
  listQueue(lane?: QueueLane): readonly CaptureQueueItem[];
  applyQueueEvent(captureId: string, event: QueueEvent): Promise<void>;
  markIntent(
    captureId: string,
    state: CaptureIntentState,
    failureCode?: string,
  ): Promise<void>;
  recordManualNote(note: ManualNote): Promise<void>;
  recordPerformanceSample(sample: CapturePerformanceSample): Promise<void>;
  saveFieldSession(snapshot: FieldSessionSnapshot): Promise<void>;
}
