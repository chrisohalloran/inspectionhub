import { demoJob } from "@inspection/test-fixtures";
import { theme } from "@inspection/theme/tokens";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { CameraView, useCameraPermissions } from "expo-camera";
import {
  CryptoDigestAlgorithm,
  digestStringAsync,
  randomUUID,
} from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as Haptics from "expo-haptics";
import { useNetworkState } from "expo-network";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { fieldControls } from "./src/accessibility/field-shell-contract";
import { createCaptureCoordinator } from "./src/capture/capture-coordinator";
import { recordManualFallback } from "./src/capture/manual-note";
import type {
  CaptureKind,
  CaptureRequest,
  FieldSessionSnapshot,
  FieldWorkflowSnapshot,
} from "./src/capture/types";
import { authoriseFieldOperation } from "./src/jobs/field-access";
import { deviceCredentialStore } from "./src/jobs/expo-device-credential-store";
import { InvestigationControlDock } from "./src/investigations/investigation-controls";
import { ModuleCompletionDock } from "./src/completion/module-completion-dock";
import { projectCompletion } from "./src/completion/completion-state";
import { DeliveryStatusCard } from "./src/delivery/delivery-status-card";
import {
  fieldDeliveryStatus,
  type FieldDeliveryState,
} from "./src/delivery/delivery-status";
import { InvestigationReviewCard } from "./src/review/investigation-review-card";
import { createSyntheticReviewItems } from "./src/review/demo-review-items";
import {
  acceptReviewItem,
  editReviewItem,
  recordExactReverification,
  rejectReviewItem,
  type InvestigationReviewItem,
} from "./src/review/investigation-review";
import {
  attachInvestigationEvidence,
  changeInvestigationArea,
  finishInvestigation as completeInvestigation,
  pauseInvestigation,
  recordInvestigationObservation,
  resumeInvestigation,
  startInvestigation,
  type Investigation,
  type InvestigationStatus,
} from "@inspection/domain/inspection/mobile";
import {
  expoCaptureResidueInventory,
  expoDurableFilePort,
} from "./src/storage/expo-durable-file-port";
import { terminateProcessForDurabilityOracle } from "./modules/expo-durable-file";
import type { CaptureLedger } from "./src/storage/ports";
import {
  assessCapturePreflight,
  type CapturePreflightResult,
} from "./src/storage/capture-preflight";
import { readCapturePreflightSignals } from "./src/storage/device-signals";
import { openFieldPersistence } from "./src/storage/open-capture-ledger";
import { runStartupCaptureRecovery } from "./src/storage/startup-recovery";
import {
  cloneFieldWorkflow,
  initialFieldWorkflow,
  reconcileInvestigationStatus,
} from "./src/storage/field-workflow";
import type { LocalInspectionRepository } from "./src/investigations/local-inspection-repository";

type VoiceState = "idle" | "recording" | "saving" | "unavailable";
type InvestigationShellStatus = InvestigationStatus | "none";
type DebugFailurePoint = NonNullable<CaptureRequest["debugFailurePoint"]>;

const areas = [
  { id: "area-main-bathroom", label: "Second floor / Main bathroom" },
  { id: "area-adjacent-bedroom", label: "Second floor / Adjacent bedroom" },
  { id: "area-external-east", label: "Exterior / East elevation" },
] as const;

const demoMode =
  __DEV__ || process.env.EXPO_PUBLIC_INSPECTION_DEMO_MODE === "1";
// Destructive durability-oracle controls are compiled only into development
// artifacts and require an explicit E2E flag.
const e2eMode = __DEV__ && process.env.EXPO_PUBLIC_MOBILE_E2E_MODE === "1";

function initialDemoSession(deviceId: string): FieldSessionSnapshot {
  const updatedAt = new Date().toISOString();
  return {
    areaId: areas[0].id,
    cachedAssignedJobIds: [demoJob.id],
    deviceId,
    deviceState: "enrolled",
    jobId: demoJob.id,
    nextSequence: 1,
    session: "valid",
    updatedAt,
    workflow: initialFieldWorkflow(
      demoMode ? createSyntheticReviewItems() : [],
      updatedAt,
    ),
  };
}

function deleteTemporarySource(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // The immutable app-owned original is already committed; cache cleanup is best effort.
  }
}

function syntheticSource(captureId: string, kind: CaptureKind): string {
  const file = new File(
    Paths.cache,
    `${captureId}.${kind === "photo" ? "jpg" : "m4a"}`,
  );
  file.create({ intermediates: true, overwrite: true });
  file.write(`synthetic-${kind}-${captureId}`);
  return file.uri;
}

function preflightText(result: CapturePreflightResult | undefined): string {
  if (result === undefined) return "Checking local storage and battery.";
  const messages: Record<CapturePreflightResult["reason"], string> = {
    battery_and_thermal_warning:
      "Low battery and elevated device temperature — local capture remains available.",
    battery_warning: "Low battery — local capture remains available.",
    ready: "Local storage and battery ready.",
    storage_critical:
      "Local storage critically low — media capture blocked; manual notes remain available.",
    storage_warning:
      "Local storage is running low — capture remains available.",
    thermal_critical:
      "Device temperature critical — media capture paused; manual notes remain available.",
    thermal_warning:
      "Device temperature elevated — local capture remains available.",
  };
  return messages[result.reason];
}

function nextRenderedFrame(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.requestAnimationFrame(() => {
      resolve();
    });
  });
}

export default function App() {
  const camera = useRef<CameraView>(null);
  const inspectionRepositoryRef = useRef<LocalInspectionRepository | undefined>(
    undefined,
  );
  const nextSequence = useRef(1);
  const sessionRef = useRef<FieldSessionSnapshot | undefined>(undefined);
  const sessionWrites = useRef<Promise<void>>(Promise.resolve());
  const workflowRef = useRef<FieldWorkflowSnapshot | undefined>(undefined);
  const voiceStartLatency = useRef<number | undefined>(undefined);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const network = useNetworkState();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [ledger, setLedger] = useState<CaptureLedger>();
  const [session, setSession] = useState<FieldSessionSnapshot>();
  const [startupState, setStartupState] = useState<
    "loading" | "ready" | "terminal"
  >("loading");
  const [preflight, setPreflight] = useState<CapturePreflightResult>();
  const [lastAction, setLastAction] = useState(
    "Preparing protected local capture storage.",
  );
  const [photoSaving, setPhotoSaving] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [queueCounts, setQueueCounts] = useState({
    manualNotes: 0,
    photos: 0,
    voiceNotes: 0,
  });
  const [manualNoteOpen, setManualNoteOpen] = useState(false);
  const [manualNote, setManualNote] = useState("");
  const [investigationStatus, setInvestigationStatus] =
    useState<InvestigationShellStatus>("none");
  const [finishChoiceOpen, setFinishChoiceOpen] = useState(false);
  const [networkOverride, setNetworkOverride] = useState<
    "available" | "unavailable"
  >();
  const [nextDebugFailure, setNextDebugFailure] =
    useState<DebugFailurePoint>("none");
  const [nextCoordinatorTermination, setNextCoordinatorTermination] = useState<
    "after_acknowledgement" | "after_sqlite_commit" | "none"
  >("none");
  const [workflowView, setWorkflowView] = useState<"capture" | "review">(
    "capture",
  );
  const [reviewItems, setReviewItems] = useState<
    readonly InvestigationReviewItem[]
  >(() => (demoMode ? createSyntheticReviewItems() : []));
  const [approvedModules, setApprovedModules] = useState<
    readonly ("building" | "timber_pest")[]
  >([]);
  const [editingReviewId, setEditingReviewId] = useState<string>();
  const [editObservation, setEditObservation] = useState("");
  const [editOpinion, setEditOpinion] = useState("");
  const [deliveryState, setDeliveryState] = useState<FieldDeliveryState>(
    "waiting_for_approval",
  );

  useEffect(() => {
    let mounted = true;
    async function initialise(): Promise<void> {
      try {
        const persistence = await openFieldPersistence();
        const openedLedger = persistence.captureLedger;
        const recovery = await runStartupCaptureRecovery({
          inventory: expoCaptureResidueInventory,
          ledger: openedLedger,
        });
        const credential = await deviceCredentialStore.load();
        const storedSession = openedLedger.getFieldSession();
        let restored: FieldSessionSnapshot;
        if (storedSession === undefined) {
          if (!demoMode && credential === undefined) {
            throw new Error(
              "No enrolled device credential or cached assigned job is available.",
            );
          }
          restored = initialDemoSession(
            credential?.deviceId ?? "device-synthetic-build-week",
          );
          await openedLedger.saveFieldSession(restored);
        } else {
          restored = storedSession;
        }
        let restoredWorkflow = restored.workflow;
        if (restoredWorkflow === undefined) {
          restoredWorkflow = initialFieldWorkflow(
            demoMode ? createSyntheticReviewItems() : [],
          );
          restored = {
            ...restored,
            workflow: restoredWorkflow,
          };
          await openedLedger.saveFieldSession(restored);
        }
        const investigationId =
          restored.activeInvestigationId ?? restored.lastInvestigationId;
        if (investigationId !== undefined) {
          const durableInvestigation =
            await persistence.inspectionRepository.loadInvestigation(
              investigationId,
            );
          if (durableInvestigation === null) {
            throw new Error(
              "The field-session investigation pointer has no checksum-verified local aggregate.",
            );
          }
          const reconciledWorkflow = reconcileInvestigationStatus(
            restoredWorkflow,
            durableInvestigation.status,
          );
          if (reconciledWorkflow !== restoredWorkflow) {
            restoredWorkflow = reconciledWorkflow;
            restored = {
              ...restored,
              updatedAt: reconciledWorkflow.updatedAt,
              workflow: reconciledWorkflow,
            };
            await openedLedger.saveFieldSession(restored);
          }
        }
        const signals = assessCapturePreflight(
          await readCapturePreflightSignals(),
        );
        if (!mounted) return;
        setLedger(openedLedger);
        inspectionRepositoryRef.current = persistence.inspectionRepository;
        nextSequence.current = restored.nextSequence;
        sessionRef.current = restored;
        workflowRef.current = cloneFieldWorkflow(restoredWorkflow);
        setSession(restored);
        setInvestigationStatus(restoredWorkflow.investigationStatus);
        setReviewItems(restoredWorkflow.reviewItems);
        setApprovedModules(restoredWorkflow.approvedModules);
        setDeliveryState(restoredWorkflow.deliveryState);
        setPreflight(signals);
        refreshQueue(openedLedger);
        setStartupState("ready");
        setLastAction(
          recovery.actions.length === 0
            ? "Protected local storage ready."
            : `Recovery checked ${recovery.actions.length} interrupted capture ${recovery.actions.length === 1 ? "boundary" : "boundaries"}.`,
        );
      } catch (error) {
        if (!mounted) return;
        setStartupState("terminal");
        setLastAction(
          error instanceof Error
            ? `Local capture unavailable — ${error.message}`
            : "Local capture unavailable — protected storage could not start.",
        );
      }
    }
    void initialise();
    return () => {
      mounted = false;
    };
  }, []);

  function refreshQueue(activeLedger: CaptureLedger = ledger as CaptureLedger) {
    if (activeLedger === undefined) return;
    const pendingCount = (lane: Parameters<CaptureLedger["listQueue"]>[0]) =>
      activeLedger
        .listQueue(lane)
        .filter((item) => item.state !== "server_durable").length;
    setQueueCounts({
      manualNotes: pendingCount("manual_note_sync"),
      photos: pendingCount("photo_upload"),
      voiceNotes: pendingCount("voice_upload"),
    });
  }

  async function saveSession(next: FieldSessionSnapshot): Promise<void> {
    if (ledger === undefined) return;
    const normalised = {
      ...next,
      nextSequence: Math.max(next.nextSequence, nextSequence.current),
    };
    nextSequence.current = normalised.nextSequence;
    sessionRef.current = normalised;
    setSession(normalised);
    const write = sessionWrites.current.then(() =>
      ledger.saveFieldSession(normalised),
    );
    sessionWrites.current = write.catch(() => undefined);
    await write;
  }

  async function saveWorkflow(
    patch: Partial<
      Pick<
        FieldWorkflowSnapshot,
        | "approvedModules"
        | "deliveryState"
        | "investigationStatus"
        | "packageManifestSha256"
        | "reviewItems"
      >
    >,
    lastTransition: FieldWorkflowSnapshot["lastTransition"],
  ): Promise<FieldWorkflowSnapshot> {
    const currentSession = sessionRef.current;
    const currentWorkflow = workflowRef.current;
    if (
      ledger === undefined ||
      currentSession === undefined ||
      currentWorkflow === undefined
    ) {
      throw new Error("The field workflow is not ready.");
    }
    const nextWorkflow: FieldWorkflowSnapshot = {
      ...currentWorkflow,
      ...patch,
      lastTransition,
      revision: currentWorkflow.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await saveSession({
      ...currentSession,
      updatedAt: nextWorkflow.updatedAt,
      workflow: nextWorkflow,
    });
    workflowRef.current = cloneFieldWorkflow(nextWorkflow);
    setInvestigationStatus(nextWorkflow.investigationStatus);
    setReviewItems(nextWorkflow.reviewItems);
    setApprovedModules(nextWorkflow.approvedModules);
    setDeliveryState(nextWorkflow.deliveryState);
    return nextWorkflow;
  }

  async function loadActiveInvestigation(): Promise<Investigation | null> {
    const repository = inspectionRepositoryRef.current;
    const investigationId = sessionRef.current?.activeInvestigationId;
    if (repository === undefined || investigationId === undefined) return null;
    const investigation = await repository.loadInvestigation(investigationId);
    if (investigation === null) {
      throw new Error(
        "The active investigation could not be restored from protected storage.",
      );
    }
    return investigation;
  }

  async function saveInvestigationTransition(
    investigation: Investigation,
    priorRevision: number | null,
    eventType:
      | "investigation.area_changed"
      | "investigation.completed"
      | "investigation.evidence_attached"
      | "investigation.observation_recorded"
      | "investigation.paused"
      | "investigation.resumed"
      | "investigation.started",
    safeMetadata: Readonly<Record<string, boolean | number | string | null>>,
  ): Promise<void> {
    const repository = inspectionRepositoryRef.current;
    if (repository === undefined) {
      throw new Error("Protected investigation storage is not ready.");
    }
    const occurredAt = new Date().toISOString();
    await repository.saveInvestigation({
      event: {
        eventId: randomUUID(),
        eventType,
        occurredAt,
        safeMetadataJson: JSON.stringify(safeMetadata),
      },
      expectedStoredRevision: priorRevision,
      investigation,
      updatedAt: occurredAt,
    });
  }

  async function attachCaptureToActiveInvestigation(
    captureId: string,
  ): Promise<boolean> {
    const active = await loadActiveInvestigation();
    if (active === null || active.status !== "active" || ledger === undefined) {
      return false;
    }
    const intent = ledger.getIntent(captureId);
    const artifact = ledger.getArtifact(captureId);
    if (intent === undefined || artifact === undefined) {
      throw new Error("Durable capture identity is unavailable for linking.");
    }
    const next = attachInvestigationEvidence(active, {
      artifacts: [
        {
          artifactId: captureId,
          artifactKind: intent.kind === "photo" ? "photo" : "voice_note",
          captureAreaId: intent.areaId,
          capturedAt: intent.capturedAt,
          captureSequence: intent.sequence,
          jobId: intent.jobId,
        },
      ],
      attachedAt: new Date().toISOString(),
      expectedRevision: active.revision,
      inspectorId: "actor_inspector_demo",
      source: "captured_during_investigation",
    });
    await saveInvestigationTransition(
      next,
      active.revision,
      "investigation.evidence_attached",
      { artifactCount: 1, source: "captured_during_investigation" },
    );
    return true;
  }

  async function reserveSequence(): Promise<number> {
    const currentSession = sessionRef.current;
    if (ledger === undefined || currentSession === undefined) {
      throw new Error("The open assigned job is not ready.");
    }
    const sequence = nextSequence.current;
    nextSequence.current += 1;
    const snapshot = {
      ...currentSession,
      nextSequence: nextSequence.current,
      updatedAt: new Date().toISOString(),
    };
    await saveSession(snapshot);
    return sequence;
  }

  async function checkCaptureAllowed(): Promise<boolean> {
    if (
      ledger === undefined ||
      session === undefined ||
      startupState !== "ready"
    ) {
      setLastAction("Local capture is not ready.");
      return false;
    }
    const authorisation = authoriseFieldOperation(
      {
        cachedAssignedJobIds: session.cachedAssignedJobIds,
        deviceState: session.deviceState,
        openJobId: session.jobId,
        session: session.session,
      },
      { jobId: session.jobId, kind: "capture_existing_job" },
    );
    if (!authorisation.allowed) {
      setLastAction(
        `Capture blocked — ${authorisation.reason.replaceAll("_", " ")}.`,
      );
      return false;
    }
    const result = assessCapturePreflight(await readCapturePreflightSignals());
    setPreflight(result);
    if (!result.allowMediaCapture) {
      setLastAction(preflightText(result));
      setManualNoteOpen(true);
      return false;
    }
    return true;
  }

  async function persistMedia(input: {
    captureId: string;
    interactionLatencyMs: number;
    interactionType: "shutter_acknowledgement" | "voice_start";
    kind: CaptureKind;
    permission: "granted" | "denied" | "unavailable";
    sequence: number;
    sourceUri: string;
  }): Promise<void> {
    if (ledger === undefined || session === undefined) return;
    const coordinator = createCaptureCoordinator({
      boundaryHook: (boundary) => {
        if (boundary === nextCoordinatorTermination) {
          return terminateProcessForDurabilityOracle();
        }
      },
      durableFiles: expoDurableFilePort,
      idFactory: randomUUID,
      ledger,
    });
    const result = await coordinator.capture({
      areaId: session.areaId,
      captureId: input.captureId,
      capturedAt: new Date().toISOString(),
      debugFailurePoint: nextDebugFailure,
      deviceId: session.deviceId,
      deviceState: session.deviceState,
      jobId: session.jobId,
      kind: input.kind,
      permission: input.permission,
      sequence: input.sequence,
      sourceUri: input.sourceUri,
    });
    setNextDebugFailure("none");
    setNextCoordinatorTermination("none");
    refreshQueue(ledger);
    if (result.kind === "acknowledged") {
      try {
        await ledger.recordPerformanceSample({
          captureId: result.captureId,
          interactionLatencyMs: input.interactionLatencyMs,
          interactionType: input.interactionType,
          kind: input.kind,
          localDurableSaveMs: result.localDurableSaveMs,
          recordedAt: new Date().toISOString(),
        });
      } catch {
        // Evidence is already durable. Benchmark instrumentation cannot revoke it.
      }
      let linkedToInvestigation = false;
      let investigationLinkFailed = false;
      try {
        linkedToInvestigation = await attachCaptureToActiveInvestigation(
          result.captureId,
        );
      } catch {
        investigationLinkFailed = true;
      }
      deleteTemporarySource(input.sourceUri);
      setLastAction(
        investigationLinkFailed
          ? `${input.kind === "photo" ? "Photo" : "Voice note"} saved locally, but its investigation link needs attention before completion.`
          : linkedToInvestigation
            ? `${input.kind === "photo" ? "Photo" : "Voice note"} saved locally and linked to the active investigation — queued for sync.`
            : input.kind === "photo"
              ? "Photo saved locally as private coverage evidence — queued for sync."
              : "Voice note saved locally — queued independently for sync.",
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }
    setLastAction(
      result.kind === "blocked"
        ? `Capture blocked — ${result.reason.replaceAll("_", " ")}. Add a manual note if needed.`
        : `Capture not acknowledged — ${result.reason.replaceAll("_", " ")}. The same identity will be checked on restart.`,
    );
    setManualNoteOpen(true);
  }

  async function takePhoto(): Promise<void> {
    const interactionStartedAt = globalThis.performance.now();
    if (photoSaving || !(await checkCaptureAllowed())) return;
    setPhotoSaving(true);
    try {
      setLastAction("Capturing photo — local durability is not confirmed yet.");
      void Haptics.selectionAsync();
      const captureId = randomUUID();
      const sequence = await reserveSequence();
      let sourceUri: string;
      if (e2eMode) {
        sourceUri = syntheticSource(captureId, "photo");
      } else {
        if (cameraPermission?.granted !== true) {
          const permission = await requestCameraPermission();
          if (!permission.granted) {
            setLastAction(
              "Camera permission denied — photo capture unavailable; add a manual note.",
            );
            setManualNoteOpen(true);
            return;
          }
        }
        const picture = await camera.current?.takePictureAsync({ quality: 1 });
        if (picture === undefined)
          throw new Error("Camera did not return a local file.");
        sourceUri = picture.uri;
      }
      await nextRenderedFrame();
      const interactionLatencyMs = Math.max(
        0,
        globalThis.performance.now() - interactionStartedAt,
      );
      await persistMedia({
        captureId,
        interactionLatencyMs,
        interactionType: "shutter_acknowledgement",
        kind: "photo",
        permission: "granted",
        sequence,
        sourceUri,
      });
    } catch (error) {
      setLastAction(
        error instanceof Error
          ? `Photo not acknowledged — ${error.message}`
          : "Photo not acknowledged — local capture failed.",
      );
      setManualNoteOpen(true);
    } finally {
      setPhotoSaving(false);
    }
  }

  async function toggleVoice(): Promise<void> {
    if (voiceState === "saving" || voiceState === "unavailable") return;
    if (voiceState === "recording") {
      setVoiceState("saving");
      try {
        const captureId = randomUUID();
        const sequence = await reserveSequence();
        let sourceUri: string;
        if (e2eMode) {
          sourceUri = syntheticSource(captureId, "voice");
        } else {
          await recorder.stop();
          if (recorder.uri === null) {
            throw new Error("Recorder did not return a local file.");
          }
          sourceUri = recorder.uri;
        }
        await persistMedia({
          captureId,
          interactionLatencyMs: voiceStartLatency.current ?? 0,
          interactionType: "voice_start",
          kind: "voice",
          permission: "granted",
          sequence,
          sourceUri,
        });
        voiceStartLatency.current = undefined;
        setVoiceState("idle");
      } catch (error) {
        voiceStartLatency.current = undefined;
        setVoiceState("idle");
        setLastAction(
          error instanceof Error
            ? `Voice note not acknowledged — ${error.message}`
            : "Voice note not acknowledged — local capture failed.",
        );
        setManualNoteOpen(true);
      }
      return;
    }

    const interactionStartedAt = globalThis.performance.now();
    if (!(await checkCaptureAllowed())) return;
    if (e2eMode) {
      setVoiceState("recording");
      voiceStartLatency.current = Math.max(
        0,
        globalThis.performance.now() - interactionStartedAt,
      );
      setLastAction("Voice note recording — photo capture remains available.");
      return;
    }
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setVoiceState("unavailable");
      setLastAction(
        "Microphone permission denied — voice capture unavailable; add a manual note.",
      );
      setManualNoteOpen(true);
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setVoiceState("recording");
    voiceStartLatency.current = Math.max(
      0,
      globalThis.performance.now() - interactionStartedAt,
    );
    setLastAction("Voice note recording — photo capture remains available.");
  }

  async function saveManualNote(): Promise<void> {
    if (
      ledger === undefined ||
      session === undefined ||
      manualNote.trim().length === 0
    ) {
      setLastAction("Enter an observation before saving the manual note.");
      return;
    }
    const observationText = manualNote.trim();
    await recordManualFallback({
      areaId: session.areaId,
      idFactory: randomUUID,
      jobId: session.jobId,
      ledger,
      recordedAt: new Date().toISOString(),
      text: observationText,
    });
    let linkedToInvestigation = false;
    const active = await loadActiveInvestigation();
    if (active?.status === "active") {
      const next = recordInvestigationObservation(active, {
        expectedRevision: active.revision,
        observation: {
          areaId: session.areaId,
          observationId: randomUUID(),
          recordedAt: new Date().toISOString(),
          recordedByInspectorId: "actor_inspector_demo",
          text: observationText,
        },
      });
      await saveInvestigationTransition(
        next,
        active.revision,
        "investigation.observation_recorded",
        { areaId: session.areaId },
      );
      linkedToInvestigation = true;
    }
    setManualNote("");
    setManualNoteOpen(false);
    refreshQueue(ledger);
    setLastAction(
      linkedToInvestigation
        ? "Manual observation saved and linked to the active investigation — queued for sync."
        : "Manual observation saved locally — queued for sync.",
    );
  }

  async function changeArea(): Promise<void> {
    if (session === undefined) return;
    const currentIndex = areas.findIndex((area) => area.id === session.areaId);
    const nextArea = areas[(currentIndex + 1) % areas.length] ?? areas[0];
    const active = await loadActiveInvestigation();
    if (active?.status === "paused") {
      setLastAction("Resume the investigation before changing its area.");
      return;
    }
    if (active?.status === "active") {
      const moved = changeInvestigationArea(active, {
        areaId: nextArea.id,
        enteredAt: new Date().toISOString(),
        expectedRevision: active.revision,
      });
      await saveInvestigationTransition(
        moved,
        active.revision,
        "investigation.area_changed",
        { areaId: nextArea.id },
      );
    }
    await saveSession({
      ...session,
      areaId: nextArea.id,
      updatedAt: new Date().toISOString(),
    });
    setLastAction(
      `${nextArea.label} selected${session.activeInvestigationId === undefined ? "." : " — active investigation retained."}`,
    );
  }

  async function changeInvestigationState(): Promise<void> {
    if (session === undefined) return;
    if (
      investigationStatus === "none" ||
      investigationStatus === "completed_findings" ||
      investigationStatus === "completed_no_reportable_finding"
    ) {
      const activeInvestigationId = randomUUID();
      const startedAt = new Date().toISOString();
      const started = startInvestigation({
        areaId: session.areaId,
        commissionedModules: [
          { module: "building", moduleId: "module-building-demo" },
          { module: "timber_pest", moduleId: "module-timber-pest-demo" },
        ],
        inspectorId: "actor_inspector_demo",
        investigationId: activeInvestigationId,
        jobId: session.jobId,
        organizationId: "organization-synthetic-build-week",
        startedAt,
      });
      await saveInvestigationTransition(
        started,
        null,
        "investigation.started",
        { areaId: session.areaId, status: "active" },
      );
      await saveSession({
        ...session,
        activeInvestigationId,
        updatedAt: startedAt,
      });
      await saveWorkflow(
        { investigationStatus: "active" },
        "investigation_started",
      );
      setLastAction(
        "Investigation started — capture remains private until inspector review.",
      );
    } else if (investigationStatus === "active") {
      const active = await loadActiveInvestigation();
      if (active === null) throw new Error("Active investigation is missing.");
      const paused = pauseInvestigation(active, {
        expectedRevision: active.revision,
        pausedAt: new Date().toISOString(),
      });
      await saveInvestigationTransition(
        paused,
        active.revision,
        "investigation.paused",
        { status: "paused" },
      );
      await saveWorkflow(
        { investigationStatus: "paused" },
        "investigation_paused",
      );
      setLastAction(
        "Investigation paused — ordinary coverage capture remains available.",
      );
    } else {
      const active = await loadActiveInvestigation();
      if (active === null) throw new Error("Paused investigation is missing.");
      const resumed = resumeInvestigation(active, {
        expectedRevision: active.revision,
        resumedAt: new Date().toISOString(),
      });
      await saveInvestigationTransition(
        resumed,
        active.revision,
        "investigation.resumed",
        { status: "active" },
      );
      await saveWorkflow(
        { investigationStatus: "active" },
        "investigation_resumed",
      );
      setLastAction("Investigation resumed.");
    }
  }

  async function finishInvestigation(
    result: "candidate" | "no_finding",
  ): Promise<void> {
    if (session === undefined) return;
    const active = await loadActiveInvestigation();
    if (active === null) throw new Error("Active investigation is missing.");
    const completedAt = new Date().toISOString();
    const completed = completeInvestigation(active, {
      completedAt,
      draftingDisposition:
        result === "candidate" ? "queue_ai_asynchronously" : "manual_only",
      expectedRevision: active.revision,
      inspectorId: "actor_inspector_demo",
      moduleLinks:
        result === "candidate"
          ? [
              {
                findingCandidateId: randomUUID(),
                module: "building",
                moduleId: "module-building-demo",
                sourceArtifactIds: active.evidence.map(
                  (evidence) => evidence.artifactId,
                ),
              },
            ]
          : [],
      outcome:
        result === "candidate" ? "finding_candidates" : "no_reportable_finding",
    });
    await saveInvestigationTransition(
      completed,
      active.revision,
      "investigation.completed",
      {
        draftingDisposition: completed.completion?.draftingDisposition ?? null,
        outcome: completed.completion?.outcome ?? null,
      },
    );
    setFinishChoiceOpen(false);
    const { activeInvestigationId: _removed, ...withoutInvestigation } =
      session;
    void _removed;
    await saveSession({
      ...withoutInvestigation,
      lastInvestigationId: active.investigationId,
      updatedAt: completedAt,
    });
    await saveWorkflow(
      {
        investigationStatus:
          result === "candidate"
            ? "completed_findings"
            : "completed_no_reportable_finding",
      },
      "investigation_completed",
    );
    setLastAction(
      result === "candidate"
        ? "Investigation candidate saved locally — drafting waits for evidence sync and an exact source packet."
        : "Investigation closed with no reportable finding; evidence remains private.",
    );
  }

  async function replaceReviewItem(
    next: InvestigationReviewItem,
  ): Promise<void> {
    const current = workflowRef.current;
    if (current === undefined) throw new Error("Review workflow is not ready.");
    await saveWorkflow(
      {
        approvedModules: current.approvedModules.filter(
          (module) => module !== next.module,
        ),
        deliveryState: "waiting_for_approval",
        packageManifestSha256: null,
        reviewItems: current.reviewItems.map((item) =>
          item.reviewId === next.reviewId ? next : item,
        ),
      },
      "review_changed",
    );
  }

  function beginReviewEdit(item: InvestigationReviewItem): void {
    setEditingReviewId(item.reviewId);
    setEditObservation(item.finding.content.observation);
    setEditOpinion(item.finding.content.qualifiedOpinion);
  }

  async function saveReviewEdit(
    item: InvestigationReviewItem,
    pathway: "convert_to_human" | "reverify_ai",
  ): Promise<void> {
    const content = {
      ...item.finding.content,
      observation: editObservation.trim(),
      qualifiedOpinion: editOpinion.trim(),
    };
    if (
      content.observation.length === 0 ||
      content.qualifiedOpinion.length === 0
    ) {
      setLastAction("Observation and qualified opinion are required.");
      return;
    }
    const newContentHash = await digestStringAsync(
      CryptoDigestAlgorithm.SHA256,
      JSON.stringify(content),
    );
    await replaceReviewItem(
      editReviewItem(item, {
        content,
        newVersionId: randomUUID(),
        newContentHash,
        pathway,
      }),
    );
    setEditingReviewId(undefined);
    setLastAction(
      pathway === "convert_to_human"
        ? "Inspector edit saved as a new human-authored version — accept it when satisfied."
        : "AI-assisted edit saved as a new version — exact reverification is required.",
    );
  }

  async function acceptReview(item: InvestigationReviewItem): Promise<void> {
    try {
      await replaceReviewItem(acceptReviewItem(item));
      setLastAction(
        `${item.module === "building" ? "Building" : "Timber Pest"} finding accepted for this exact version.`,
      );
    } catch (error) {
      setLastAction(
        error instanceof Error
          ? error.message
          : "Finding could not be accepted.",
      );
    }
  }

  async function rejectReview(item: InvestigationReviewItem): Promise<void> {
    await replaceReviewItem(
      rejectReviewItem(item, "Inspector rejected the synthetic suggestion."),
    );
    setLastAction(
      "AI suggestion rejected — it cannot enter a report snapshot.",
    );
  }

  async function reverifyReview(item: InvestigationReviewItem): Promise<void> {
    if (!demoMode) {
      setLastAction(
        "Exact reverification is queued; capture and manual editing remain available.",
      );
      return;
    }
    await replaceReviewItem(
      recordExactReverification(item, {
        status: "passed",
        draftVersionId: item.finding.versionId,
        contentHash: item.finding.contentHash,
        verifierVersion: "deterministic-verifier-v1",
        verifiedAt: new Date().toISOString(),
      }),
    );
    setLastAction("Synthetic verifier passed the exact edited version.");
  }

  async function continueReviewAsHuman(
    item: InvestigationReviewItem,
  ): Promise<void> {
    setEditObservation(item.finding.content.observation);
    setEditOpinion(item.finding.content.qualifiedOpinion);
    const content = item.finding.content;
    const newContentHash = await digestStringAsync(
      CryptoDigestAlgorithm.SHA256,
      JSON.stringify(content),
    );
    await replaceReviewItem(
      editReviewItem(item, {
        content,
        newVersionId: randomUUID(),
        newContentHash,
        pathway: "convert_to_human",
      }),
    );
    setLastAction(
      "Finding converted to a new inspector-authored version — accept it when satisfied.",
    );
  }

  async function approveModule(
    module: "building" | "timber_pest",
  ): Promise<void> {
    if (session === undefined) return;
    const authorization = authoriseFieldOperation(
      {
        cachedAssignedJobIds: session.cachedAssignedJobIds,
        deviceState: session.deviceState,
        openJobId: session.jobId,
        session: session.session,
      },
      { kind: "approve" },
    );
    const moduleItems = reviewItems.filter((item) => item.module === module);
    if (!authorization.allowed) {
      setLastAction(
        `Approval blocked — ${authorization.reason.replaceAll("_", " ")}.`,
      );
      return;
    }
    if (
      moduleItems.length === 0 ||
      moduleItems.some((item) => item.status !== "accepted")
    ) {
      setLastAction(
        "Approve only after every current module finding is accepted.",
      );
      return;
    }
    const current = workflowRef.current;
    if (current === undefined) return;
    await saveWorkflow(
      {
        approvedModules: current.approvedModules.includes(module)
          ? current.approvedModules
          : [...current.approvedModules, module],
        deliveryState: "waiting_for_approval",
        packageManifestSha256: null,
      },
      "module_approved",
    );
    setLastAction(
      `${module === "building" ? "Building" : "Timber Pest"} approved independently for the current accepted versions.`,
    );
  }

  async function confirmDeliveryPackage(): Promise<void> {
    if (session === undefined) return;
    const authorization = authoriseFieldOperation(
      {
        cachedAssignedJobIds: session.cachedAssignedJobIds,
        deviceState: session.deviceState,
        openJobId: session.jobId,
        session: session.session,
      },
      { kind: "package" },
    );
    if (!authorization.allowed) {
      setLastAction(
        `Package confirmation blocked — ${authorization.reason.replaceAll("_", " ")}.`,
      );
      return;
    }
    const current = workflowRef.current;
    if (
      current === undefined ||
      demoJob.commissionedModules.some(
        (module) => !current.approvedModules.includes(module),
      )
    ) {
      setLastAction(
        "Package confirmation blocked — every commissioned module requires its own current approval.",
      );
      return;
    }
    const packageManifestSha256 = await digestStringAsync(
      CryptoDigestAlgorithm.SHA256,
      JSON.stringify({
        jobId: session.jobId,
        modules: [...demoJob.commissionedModules].sort(),
        reviewVersions: current.reviewItems
          .filter((item) => item.status === "accepted")
          .map((item) => ({
            contentHash: item.finding.contentHash,
            module: item.module,
            reviewId: item.reviewId,
            versionId: item.finding.versionId,
          }))
          .sort((left, right) => left.reviewId.localeCompare(right.reviewId)),
      }),
    );
    const evidencePending =
      queueCounts.photos + queueCounts.voiceNotes + queueCounts.manualNotes > 0;
    await saveWorkflow(
      {
        deliveryState: evidencePending ? "waiting_for_evidence" : "queued",
        packageManifestSha256,
      },
      "package_confirmed",
    );
    setLastAction(
      evidencePending
        ? "Approved package manifest saved locally — server delivery waits for evidence durability."
        : "Approved package manifest saved locally — server queue confirmation is still required.",
    );
  }

  const currentArea =
    areas.find((area) => area.id === session?.areaId) ?? areas[0];
  const networkAvailable =
    networkOverride === undefined
      ? network.isConnected !== false
      : networkOverride === "available";
  const captureEnabled = startupState === "ready" && session !== undefined;
  const completionProjection = projectCompletion({
    commissionedModules: demoJob.commissionedModules,
    aiAvailable: demoMode,
    modules: demoJob.commissionedModules.map((module) => {
      const moduleItems = reviewItems.filter((item) => item.module === module);
      const reviewComplete =
        moduleItems.length > 0 &&
        moduleItems.every((item) => item.status === "accepted");
      const approved = approvedModules.includes(module);
      return {
        module,
        label: module === "building" ? "Building" : "Timber Pest",
        reviewComplete,
        approvalState: approved
          ? ("approved" as const)
          : reviewComplete
            ? ("ready" as const)
            : ("not_ready" as const),
        snapshotRevision: reviewComplete ? 1 : null,
        approvalSnapshotRevision: approved ? 1 : null,
        unresolvedChecks: moduleItems.reduce(
          (total, item) =>
            total +
            item.checks.filter(
              (check) =>
                check.severity === "blocking" && check.state === "open",
            ).length,
          0,
        ),
      };
    }),
  });

  return (
    <SafeAreaView style={styles.safeArea} testID="field-shell">
      <StatusBar style="dark" />
      <View style={styles.shell}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          style={styles.scroll}
        >
          <Text accessibilityRole="header" style={styles.eyebrow}>
            {demoMode ? "Synthetic assigned inspection" : "Open inspection"}
          </Text>
          <Text accessibilityRole="header" style={styles.heading}>
            {demoJob.propertyLabel}
          </Text>

          <View
            accessibilityLabel="Inspection workflow"
            style={styles.workflowTabs}
          >
            <SmallControl
              label="Capture"
              onPress={() => {
                setWorkflowView("capture");
              }}
            />
            <SmallControl
              label="Review & complete"
              onPress={() => {
                setWorkflowView("review");
              }}
            />
          </View>

          {workflowView === "capture" ? (
            <>
              {e2eMode ? (
                <View
                  accessibilityLabel="Development test controls"
                  style={styles.testPanel}
                >
                  <Text style={styles.metadataLabel}>
                    Development test controls
                  </Text>
                  <View style={styles.wrapRow}>
                    <SmallControl
                      label={
                        networkAvailable
                          ? "Test: go offline"
                          : "Test: reconnect"
                      }
                      onPress={() => {
                        setNetworkOverride(
                          networkAvailable ? "unavailable" : "available",
                        );
                        setLastAction(
                          networkAvailable
                            ? "Offline — local capture remains available."
                            : "Connection restored — pending identities are ready to reconcile.",
                        );
                      }}
                    />
                    <SmallControl
                      label="Test: expire session"
                      onPress={() => {
                        if (session !== undefined) {
                          void saveSession({
                            ...session,
                            session: "expired",
                            updatedAt: new Date().toISOString(),
                          });
                        }
                        setLastAction(
                          "Session expired — the open cached job can still capture; sync and approval require sign-in.",
                        );
                      }}
                    />
                    <SmallControl
                      label="Test: terminate after copy"
                      onPress={() => {
                        setNextDebugFailure("terminate_after_copy");
                        setLastAction(
                          "Next synthetic capture will terminate after the temporary copy.",
                        );
                      }}
                    />
                    <SmallControl
                      label="Test: terminate after durable sync"
                      onPress={() => {
                        setNextDebugFailure("terminate_after_partial_sync");
                        setLastAction(
                          "Next synthetic capture will terminate after durable file synchronisation.",
                        );
                      }}
                    />
                    <SmallControl
                      label="Test: terminate after hash"
                      onPress={() => {
                        setNextDebugFailure("terminate_after_hash");
                        setLastAction(
                          "Next synthetic capture will terminate after hashing.",
                        );
                      }}
                    />
                    <SmallControl
                      label="Test: terminate after rename"
                      onPress={() => {
                        setNextDebugFailure("terminate_after_atomic_rename");
                        setLastAction(
                          "Next synthetic capture will terminate after atomic rename.",
                        );
                      }}
                    />
                    <SmallControl
                      label="Test: terminate after SQLite"
                      onPress={() => {
                        setNextCoordinatorTermination("after_sqlite_commit");
                        setLastAction(
                          "Next synthetic capture will terminate after the ledger transaction.",
                        );
                      }}
                    />
                    <SmallControl
                      label="Test: terminate after acknowledgement"
                      onPress={() => {
                        setNextCoordinatorTermination("after_acknowledgement");
                        setLastAction(
                          "Next synthetic capture will terminate at the acknowledgement boundary.",
                        );
                      }}
                    />
                  </View>
                </View>
              ) : null}

              {e2eMode ? (
                <View
                  accessible
                  accessibilityLabel="Synthetic camera preview"
                  style={styles.cameraPlaceholder}
                >
                  <Text style={styles.cameraPlaceholderText}>
                    Synthetic camera preview
                  </Text>
                </View>
              ) : cameraPermission?.granted === true ? (
                <CameraView
                  accessibilityElementsHidden
                  facing="back"
                  ref={camera}
                  style={styles.camera}
                />
              ) : (
                <View style={styles.cameraPlaceholder}>
                  <Text style={styles.cameraPlaceholderText}>
                    Camera permission is required during device preflight.
                  </Text>
                  <SmallControl
                    label="Enable camera"
                    onPress={() => {
                      void requestCameraPermission();
                    }}
                  />
                </View>
              )}

              <View style={styles.areaCard}>
                <Text style={styles.metadataLabel}>Current area</Text>
                <Text style={styles.areaName}>{currentArea.label}</Text>
                <Text style={styles.body}>
                  {session?.activeInvestigationId === undefined
                    ? "No active investigation"
                    : `Investigation ${investigationStatus}`}
                </Text>
                <SmallControl
                  label="Change area"
                  onPress={() => {
                    void changeArea();
                  }}
                />
              </View>

              <View accessibilityLiveRegion="polite" style={styles.statusList}>
                <StatusCard
                  detail={lastAction}
                  label={
                    startupState === "ready"
                      ? "Local capture ready"
                      : startupState === "loading"
                        ? "Local storage loading"
                        : "Local capture unavailable"
                  }
                />
                <StatusCard
                  detail={
                    networkAvailable
                      ? "Pending evidence may synchronise after authorisation."
                      : "Photos, voice notes, and manual notes continue saving locally."
                  }
                  label={
                    networkAvailable
                      ? "Connection available"
                      : "Offline — local capture available"
                  }
                />
                <StatusCard
                  detail={
                    session?.session === "expired"
                      ? "Only this open cached assigned job may capture. New jobs, sync, approval, package and delivery are blocked."
                      : "Open assigned job capture and foreground sync are authorised."
                  }
                  label={
                    session?.session === "expired"
                      ? "Session expired"
                      : "Session active"
                  }
                />
                <StatusCard
                  detail={preflightText(preflight)}
                  label="Device preflight"
                />
              </View>

              <View accessible style={styles.queueCard}>
                <Text style={styles.metadataLabel}>Local queue</Text>
                <Text style={styles.queueCount}>
                  {queueCounts.photos} photos · {queueCounts.voiceNotes} voice
                  notes · {queueCounts.manualNotes} manual notes
                </Text>
                <Text style={styles.body}>
                  A local count does not indicate inspection coverage or
                  condition.
                </Text>
              </View>

              <Pressable
                accessibilityHint={fieldControls.manualNote.hint}
                accessibilityRole="button"
                disabled={!captureEnabled}
                onPress={() => {
                  setManualNoteOpen((current) => !current);
                }}
                style={({ pressed }) => [
                  styles.secondaryAction,
                  pressed && styles.pressed,
                  !captureEnabled && styles.disabled,
                ]}
              >
                <Text style={styles.secondaryActionLabel}>
                  {fieldControls.manualNote.label}
                </Text>
              </Pressable>

              {manualNoteOpen ? (
                <View style={styles.noteCard}>
                  <Text accessibilityRole="header" style={styles.sectionTitle}>
                    Manual observation
                  </Text>
                  <TextInput
                    accessibilityLabel="Manual observation"
                    multiline
                    onChangeText={setManualNote}
                    placeholder="Record what you observed and where."
                    placeholderTextColor={theme.color.inkMuted}
                    style={styles.noteInput}
                    value={manualNote}
                  />
                  <SmallControl
                    label="Save manual observation"
                    onPress={() => {
                      void saveManualNote();
                    }}
                  />
                </View>
              ) : null}

              {finishChoiceOpen ? (
                <View
                  accessibilityLiveRegion="assertive"
                  style={styles.noteCard}
                >
                  <Text accessibilityRole="header" style={styles.sectionTitle}>
                    Finish investigation
                  </Text>
                  <Text style={styles.body}>
                    Choose the inspector-owned outcome. Evidence remains
                    available either way.
                  </Text>
                  <View style={styles.wrapRow}>
                    <SmallControl
                      label="Candidate finding"
                      onPress={() => {
                        void finishInvestigation("candidate");
                      }}
                    />
                    <SmallControl
                      label="No reportable finding"
                      onPress={() => {
                        void finishInvestigation("no_finding");
                      }}
                    />
                  </View>
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.reviewStack}>
              <StatusCard detail={lastAction} label="Review status" />
              <View accessible style={styles.reviewNotice}>
                <Text style={styles.sectionTitle}>Inspector review</Text>
                <Text style={styles.body}>
                  AI text is provisional. Accept, edit or reject each exact
                  version; Building and Timber Pest approvals remain separate.
                </Text>
                {demoMode ? (
                  <Text style={styles.body}>
                    This is a seeded synthetic packet from a previously
                    completed investigation. New field captures do not enter it
                    until evidence sync and packet construction complete.
                  </Text>
                ) : null}
              </View>
              {reviewItems.length === 0 ? (
                <StatusCard
                  detail="No current review packet is available. Continue capture or complete findings manually."
                  label="No suggestions"
                />
              ) : null}
              {reviewItems.map((item) => (
                <View key={item.reviewId} style={styles.reviewItem}>
                  <InvestigationReviewCard
                    item={item}
                    onAccept={() => {
                      void acceptReview(item);
                    }}
                    onContinueHuman={() => {
                      void continueReviewAsHuman(item);
                    }}
                    onEdit={() => {
                      beginReviewEdit(item);
                    }}
                    onReject={() => {
                      void rejectReview(item);
                    }}
                    onReverify={() => {
                      void reverifyReview(item);
                    }}
                  />
                  {editingReviewId === item.reviewId ? (
                    <View style={styles.noteCard}>
                      <Text
                        accessibilityRole="header"
                        style={styles.sectionTitle}
                      >
                        Edit finding
                      </Text>
                      <Text style={styles.metadataLabel}>Observation</Text>
                      <TextInput
                        accessibilityLabel="Finding observation"
                        multiline
                        onChangeText={setEditObservation}
                        style={styles.noteInput}
                        value={editObservation}
                      />
                      <Text style={styles.metadataLabel}>
                        Qualified opinion
                      </Text>
                      <TextInput
                        accessibilityLabel="Finding qualified opinion"
                        multiline
                        onChangeText={setEditOpinion}
                        style={styles.noteInput}
                        value={editOpinion}
                      />
                      <View style={styles.wrapRow}>
                        <SmallControl
                          label="Save & reverify AI"
                          onPress={() => {
                            void saveReviewEdit(item, "reverify_ai");
                          }}
                        />
                        <SmallControl
                          label="Save as inspector-authored"
                          onPress={() => {
                            void saveReviewEdit(item, "convert_to_human");
                          }}
                        />
                        <SmallControl
                          label="Cancel edit"
                          onPress={() => {
                            setEditingReviewId(undefined);
                          }}
                        />
                      </View>
                    </View>
                  ) : null}
                </View>
              ))}
              <DeliveryStatusCard status={fieldDeliveryStatus(deliveryState)} />
              {e2eMode && deliveryState !== "sent" ? (
                <SmallControl
                  label="Test: provider confirms sent"
                  onPress={() => {
                    void saveWorkflow(
                      { deliveryState: "sent" },
                      "delivery_state_changed",
                    ).then(() => {
                      setLastAction(
                        "Synthetic provider fixture confirmed the package was sent; this is not live-provider proof.",
                      );
                    });
                  }}
                />
              ) : null}
            </View>
          )}
        </ScrollView>

        {workflowView === "capture" ? (
          <InvestigationControlDock
            currentAreaLabel={currentArea.label}
            investigationStatus={investigationStatus}
            operationStatus={lastAction}
            onAttachRecent={() => {
              setLastAction(
                `${queueCounts.photos} recent local photos available to attach without changing their original metadata.`,
              );
            }}
            onChangeArea={() => {
              void changeArea();
            }}
            onFinish={() => {
              setFinishChoiceOpen(true);
            }}
            onInvestigationAction={() => {
              void changeInvestigationState();
            }}
            onPhoto={() => {
              void takePhoto();
            }}
            onVoice={() => {
              void toggleVoice();
            }}
            recentCaptureCount={queueCounts.photos}
            voiceState={voiceState}
          />
        ) : (
          <ModuleCompletionDock
            onApproveModule={(module) => {
              void approveModule(module);
            }}
            onConfirmPackage={() => {
              void confirmDeliveryPackage();
            }}
            projection={completionProjection}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function SmallControl(props: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={({ pressed }) => [styles.smallControl, pressed && styles.pressed]}
    >
      <Text style={styles.smallControlLabel}>{props.label}</Text>
    </Pressable>
  );
}

function StatusCard(props: { detail: string; label: string }) {
  return (
    <View
      accessible
      accessibilityLabel={`${props.label}. ${props.detail}`}
      style={styles.statusCard}
    >
      <Text style={styles.statusLabel}>{props.label}</Text>
      <Text style={styles.statusDetail}>{props.detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  areaCard: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    gap: theme.space[2],
    marginTop: theme.space[4],
    padding: theme.space[4],
  },
  areaName: {
    color: theme.color.ink,
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 26,
  },
  body: { color: theme.color.inkMuted, fontSize: 16, lineHeight: 25 },
  camera: {
    borderRadius: theme.radius.medium,
    height: 220,
    marginTop: theme.space[4],
    overflow: "hidden",
  },
  cameraPlaceholder: {
    alignItems: "center",
    backgroundColor: theme.color.ink,
    borderRadius: theme.radius.medium,
    gap: theme.space[3],
    justifyContent: "center",
    marginTop: theme.space[4],
    minHeight: 180,
    padding: theme.space[4],
  },
  cameraPlaceholderText: {
    color: theme.color.surface,
    fontSize: 16,
    lineHeight: 25,
    textAlign: "center",
  },
  disabled: { opacity: 0.55 },
  eyebrow: {
    color: theme.color.action,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: theme.space[2],
  },
  heading: {
    color: theme.color.ink,
    fontSize: 30,
    fontWeight: "700",
    lineHeight: 36,
  },
  metadataLabel: {
    color: theme.color.inkMuted,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 21,
  },
  noteCard: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    gap: theme.space[3],
    marginTop: theme.space[4],
    padding: theme.space[4],
  },
  noteInput: {
    borderColor: theme.color.outline,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    color: theme.color.ink,
    fontSize: 16,
    lineHeight: 25,
    minHeight: 112,
    padding: theme.space[3],
    textAlignVertical: "top",
  },
  pressed: { backgroundColor: theme.color.canvas },
  queueCard: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    gap: theme.space[2],
    marginTop: theme.space[4],
    padding: theme.space[4],
  },
  queueCount: {
    color: theme.color.ink,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 24,
  },
  reviewItem: { gap: theme.space[3] },
  reviewNotice: {
    backgroundColor: theme.color.limitationContainer,
    borderRadius: theme.radius.medium,
    gap: theme.space[2],
    padding: theme.space[4],
  },
  reviewStack: { gap: theme.space[4], marginTop: theme.space[4] },
  safeArea: { backgroundColor: theme.color.canvas, flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: theme.space[4], paddingBottom: theme.space[6] },
  secondaryAction: {
    alignItems: "center",
    backgroundColor: theme.color.surface,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.large,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: theme.space[4],
    minHeight: theme.target.minimum,
    padding: theme.space[3],
  },
  secondaryActionLabel: {
    color: theme.color.ink,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  sectionTitle: {
    color: theme.color.ink,
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 26,
  },
  shell: { flex: 1 },
  smallControl: {
    alignItems: "center",
    backgroundColor: theme.color.surface,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.large,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: theme.target.minimum,
    minWidth: 132,
    padding: theme.space[3],
  },
  smallControlLabel: {
    color: theme.color.ink,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  statusCard: {
    backgroundColor: theme.color.surface,
    borderLeftColor: theme.color.action,
    borderLeftWidth: 4,
    padding: theme.space[4],
  },
  statusDetail: {
    color: theme.color.inkMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: theme.space[1],
  },
  statusLabel: {
    color: theme.color.ink,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 24,
  },
  statusList: {
    borderColor: theme.color.outline,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    gap: 1,
    marginTop: theme.space[4],
    overflow: "hidden",
  },
  testPanel: {
    backgroundColor: theme.color.buildingContainer,
    borderColor: theme.color.building,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    gap: theme.space[3],
    marginTop: theme.space[4],
    padding: theme.space[3],
  },
  workflowTabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.space[2],
    marginTop: theme.space[4],
  },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.space[3] },
});
