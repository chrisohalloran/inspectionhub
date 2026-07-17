import { demoJob } from "@inspection/test-fixtures";
import { domainFixtureIds } from "@inspection/test-fixtures/domain";
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
  AccessibilityInfo,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { fieldControls } from "./src/accessibility/field-shell-contract";
import {
  AreaCloseoutCard,
  type AreaCloseoutSelection,
} from "./src/areas/area-closeout-card";
import { closeOutArea } from "./src/areas/area-closeout";
import { areaCoverageSummary } from "./src/areas/coverage-options";
import { createCaptureCoordinator } from "./src/capture/capture-coordinator";
import { recordManualFallback } from "./src/capture/manual-note";
import type {
  CaptureKind,
  CaptureRequest,
  FieldSessionSnapshot,
  FieldWorkflowSnapshot,
  ModuleApprovalBinding,
} from "./src/capture/types";
import { authoriseFieldOperation } from "./src/jobs/field-access";
import { deviceCredentialStore } from "./src/jobs/expo-device-credential-store";
import { InvestigationControlDock } from "./src/investigations/investigation-controls";
import {
  durabilityAnnouncement,
  type DockOperationState,
} from "./src/investigations/field-shell-contract";
import { EvidenceAreaCard } from "./src/investigations/evidence-area-card";
import {
  createFindingCandidateLinks,
  isAttachableCaptureState,
  selectAttachableRecentCaptures,
} from "./src/investigations/field-actions";
import {
  MeasurementEntryCard,
  type MeasurementEntry,
} from "./src/measurements/measurement-entry-card";
import { ModuleCompletionDock } from "./src/completion/module-completion-dock";
import { projectCompletion } from "./src/completion/completion-state";
import {
  approvalBindingMatches,
  approvalReviewVersions,
  approvalSnapshotPayload,
  deliveryPackageManifestPayload,
  findingContentPayload,
  moduleCoverageRevision,
  verifyAcceptedReviewContentHashes,
  verifyApprovalBinding,
} from "./src/completion/approval-binding";
import { invalidateProfessionalModulesForCandidates } from "./src/completion/professional-state";
import { DeliveryStatusCard } from "./src/delivery/delivery-status-card";
import {
  fieldDeliveryStatus,
  syntheticProviderDeliveryPath,
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
  coverageCompletionIssues,
  createCoverageLedger,
  finishInvestigation as completeInvestigation,
  pauseInvestigation,
  reassignInvestigationEvidenceArea,
  recordInvestigationMeasurement,
  recordInvestigationObservation,
  resumeInvestigation,
  startInvestigation,
  type CoverageLedger,
  type EvidenceAttachmentInput,
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
import { syntheticServerDurabilityPath } from "./src/sync/queue-machine";
import {
  assertInvestigationMatchesFieldSession,
  cloneFieldSession,
  cloneFieldWorkflow,
  initialFieldWorkflow,
  reconcileDurableProfessionalState,
  reconcileFieldSessionInvestigation,
} from "./src/storage/field-workflow";
import type { LocalInspectionRepository } from "./src/investigations/local-inspection-repository";

type VoiceState = "idle" | "recording" | "saving" | "unavailable";
type InvestigationShellStatus = InvestigationStatus | "none";
type DebugFailurePoint = NonNullable<CaptureRequest["debugFailurePoint"]>;

const areas = [
  { id: "area-main-bathroom", label: "Second floor / Main bathroom" },
  { id: "area-adjacent-bedroom", label: "Second floor / Adjacent bedroom" },
  { id: "area-external-east", label: "Exterior / East elevation" },
  { id: "area-roof-void", label: "Roof void" },
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
    cachedAssignedJobIds: [domainFixtureIds.jobId],
    commissionedModules: [
      {
        module: "building",
        moduleId: domainFixtureIds.buildingModuleId,
      },
      {
        module: "timber_pest",
        moduleId: domainFixtureIds.timberPestModuleId,
      },
    ],
    deviceId,
    deviceState: "enrolled",
    jobId: domainFixtureIds.jobId,
    nextSequence: 1,
    organizationId: domainFixtureIds.organizationId,
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

function currentAreaLabel(areaId: string): string {
  return areas.find((area) => area.id === areaId)?.label ?? areaId;
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
  const fieldActionInFlight = useRef(false);
  const lastDurabilityAnnouncement = useRef<string | undefined>(undefined);
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
  const [dockOperationState, setDockOperationState] =
    useState<DockOperationState>("field_status");
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
  const [investigation, setInvestigation] = useState<Investigation | null>(
    null,
  );
  const [coverageLedger, setCoverageLedger] = useState<CoverageLedger>();
  const [areaPickerOpen, setAreaPickerOpen] = useState(false);
  const [coverageCloseoutOpen, setCoverageCloseoutOpen] = useState(false);
  const [coverageCloseoutModule, setCoverageCloseoutModule] = useState<
    "building" | "timber_pest"
  >("building");
  const [measurementOpen, setMeasurementOpen] = useState(false);
  const [evidenceAreasOpen, setEvidenceAreasOpen] = useState(false);
  const [finishChoiceOpen, setFinishChoiceOpen] = useState(false);
  const [fieldActionBusy, setFieldActionBusy] = useState(false);
  const [findingModules, setFindingModules] = useState<
    readonly ("building" | "timber_pest")[]
  >([]);
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
  const [moduleApprovalBindings, setModuleApprovalBindings] = useState<
    readonly ModuleApprovalBinding[]
  >([]);
  const [editingReviewId, setEditingReviewId] = useState<string>();
  const [editObservation, setEditObservation] = useState("");
  const [editOpinion, setEditOpinion] = useState("");
  const [deliveryState, setDeliveryState] = useState<FieldDeliveryState>(
    "waiting_for_approval",
  );

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const announcement = durabilityAnnouncement(dockOperationState, lastAction);
    if (
      announcement === null ||
      announcement === lastDurabilityAnnouncement.current
    ) {
      return;
    }
    const timer = globalThis.setTimeout(() => {
      if (announcement === lastDurabilityAnnouncement.current) return;
      lastDurabilityAnnouncement.current = announcement;
      AccessibilityInfo.announceForAccessibility(announcement);
    }, 100);
    return () => globalThis.clearTimeout(timer);
  }, [dockOperationState, lastAction]);

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
        let durableInvestigation: Investigation | null = null;
        if (restored.activeInvestigationId !== undefined) {
          durableInvestigation =
            await persistence.inspectionRepository.loadInvestigation(
              restored.activeInvestigationId,
            );
          if (durableInvestigation === null) {
            throw new Error(
              "The field-session investigation pointer has no checksum-verified local aggregate.",
            );
          }
        } else {
          durableInvestigation =
            await persistence.inspectionRepository.findOpenInvestigationForJob(
              restored.jobId,
            );
          if (
            durableInvestigation === null &&
            restored.lastInvestigationId !== undefined
          ) {
            durableInvestigation =
              await persistence.inspectionRepository.loadInvestigation(
                restored.lastInvestigationId,
              );
          }
        }
        if (durableInvestigation !== null) {
          const reconciled = reconcileDurableProfessionalState(
            restored,
            durableInvestigation,
          );
          if (reconciled.session !== restored) {
            restored = reconciled.session;
            restoredWorkflow = reconciled.workflow;
            await openedLedger.saveFieldSession(restored);
          }
        }
        let durableCoverage =
          await persistence.inspectionRepository.loadCoverage(restored.jobId);
        if (durableCoverage === null) {
          durableCoverage = createCoverageLedger({
            areas: areas.map((area) => ({
              applicableModules: ["building", "timber_pest"] as const,
              areaId: area.id,
              label: area.label,
            })),
            commissionedModules: [
              {
                module: "building",
                moduleId: domainFixtureIds.buildingModuleId,
              },
              {
                module: "timber_pest",
                moduleId: domainFixtureIds.timberPestModuleId,
              },
            ],
            jobId: restored.jobId,
            organizationId: domainFixtureIds.organizationId,
          });
          const initialisedAt = new Date().toISOString();
          await persistence.inspectionRepository.saveCoverage({
            coverage: durableCoverage,
            event: {
              eventId: randomUUID(),
              eventType: "area.coverage_initialized",
              occurredAt: initialisedAt,
              safeMetadataJson: JSON.stringify({ status: "initialized" }),
            },
            expectedStoredRevision: null,
            updatedAt: initialisedAt,
          });
        }
        const restoredReviewItems = restoredWorkflow.reviewItems;
        const bindingValidity = await Promise.all(
          restoredWorkflow.moduleApprovalBindings.map((binding) =>
            verifyApprovalBinding({
              binding,
              coverage: durableCoverage,
              digest: (payload) =>
                digestStringAsync(CryptoDigestAlgorithm.SHA256, payload),
              jobId: restored.jobId,
              module: binding.module,
              reviewItems: restoredReviewItems,
            }),
          ),
        );
        const validBindings = restoredWorkflow.moduleApprovalBindings.filter(
          (_binding, index) => bindingValidity[index],
        );
        const validApprovedModules = restoredWorkflow.approvedModules.filter(
          (module) =>
            validBindings.some((binding) => binding.module === module),
        );
        let packageManifestValid =
          restoredWorkflow.packageManifestSha256 === null;
        if (
          restoredWorkflow.packageManifestSha256 !== null &&
          demoJob.commissionedModules.every(
            (module) =>
              validApprovedModules.includes(module) &&
              validBindings.some((binding) => binding.module === module),
          )
        ) {
          const expectedPackageSha256 = await digestStringAsync(
            CryptoDigestAlgorithm.SHA256,
            deliveryPackageManifestPayload({
              approvalBindings: validBindings,
              commissionedModules: demoJob.commissionedModules,
              jobId: restored.jobId,
              reviewItems: restoredReviewItems,
            }),
          );
          packageManifestValid =
            expectedPackageSha256 === restoredWorkflow.packageManifestSha256;
        }
        if (
          validBindings.length !==
            restoredWorkflow.moduleApprovalBindings.length ||
          validApprovedModules.length !==
            restoredWorkflow.approvedModules.length ||
          !packageManifestValid
        ) {
          restoredWorkflow = cloneFieldWorkflow({
            ...restoredWorkflow,
            approvedModules: validApprovedModules,
            deliveryState: "waiting_for_approval",
            lastTransition: "professional_state_changed",
            moduleApprovalBindings: validBindings,
            packageManifestSha256: null,
            revision: restoredWorkflow.revision + 1,
            updatedAt: new Date().toISOString(),
          });
          restored = {
            ...restored,
            updatedAt: restoredWorkflow.updatedAt,
            workflow: restoredWorkflow,
          };
          await openedLedger.saveFieldSession(restored);
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
        setInvestigation(durableInvestigation);
        setCoverageLedger(durableCoverage);
        setInvestigationStatus(restoredWorkflow.investigationStatus);
        setReviewItems(restoredWorkflow.reviewItems);
        setApprovedModules(restoredWorkflow.approvedModules);
        setModuleApprovalBindings(restoredWorkflow.moduleApprovalBindings);
        setDeliveryState(restoredWorkflow.deliveryState);
        setPreflight(signals);
        refreshQueue(openedLedger);
        setStartupState("ready");
        setDockOperationState("ready");
        setLastAction(
          recovery.actions.length === 0
            ? "Protected local storage ready."
            : `Recovery checked ${recovery.actions.length} interrupted capture ${recovery.actions.length === 1 ? "boundary" : "boundaries"}.`,
        );
      } catch (error) {
        if (!mounted) return;
        setStartupState("terminal");
        setDockOperationState("needs_review");
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
    const write = sessionWrites.current.then(() =>
      ledger.saveFieldSession(normalised),
    );
    sessionWrites.current = write.catch(() => undefined);
    await write;
    nextSequence.current = normalised.nextSequence;
    sessionRef.current = normalised;
    setSession(normalised);
  }

  async function saveWorkflow(
    patch: Partial<
      Pick<
        FieldWorkflowSnapshot,
        | "approvedModules"
        | "deliveryState"
        | "investigationStatus"
        | "moduleApprovalBindings"
        | "packageManifestSha256"
        | "processedFindingCandidateIds"
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
    setModuleApprovalBindings(nextWorkflow.moduleApprovalBindings);
    setDeliveryState(nextWorkflow.deliveryState);
    return nextWorkflow;
  }

  async function loadActiveInvestigation(): Promise<Investigation | null> {
    const repository = inspectionRepositoryRef.current;
    const currentSession = sessionRef.current;
    const investigationId = currentSession?.activeInvestigationId;
    if (
      repository === undefined ||
      currentSession === undefined ||
      investigationId === undefined
    ) {
      return null;
    }
    const investigation = await repository.loadInvestigation(investigationId);
    if (investigation === null) {
      throw new Error(
        "The active investigation could not be restored from protected storage.",
      );
    }
    assertInvestigationMatchesFieldSession(currentSession, investigation);
    return investigation;
  }

  async function reloadProfessionalState(): Promise<void> {
    const repository = inspectionRepositoryRef.current;
    const durableSession = ledger?.getFieldSession();
    if (
      repository === undefined ||
      durableSession === undefined ||
      durableSession.workflow === undefined
    ) {
      return;
    }
    let durableInvestigation: Investigation | null = null;
    if (durableSession.activeInvestigationId !== undefined) {
      durableInvestigation = await repository.loadInvestigation(
        durableSession.activeInvestigationId,
      );
    }
    durableInvestigation ??= await repository.findOpenInvestigationForJob(
      durableSession.jobId,
    );
    let reconciledWorkflow = durableSession.workflow;
    let reconciledSession = durableSession;
    if (durableInvestigation !== null) {
      const reconciled = reconcileDurableProfessionalState(
        durableSession,
        durableInvestigation,
      );
      reconciledSession = reconciled.session;
      reconciledWorkflow = reconciled.workflow;
    } else if (
      reconciledWorkflow.investigationStatus === "active" ||
      reconciledWorkflow.investigationStatus === "paused"
    ) {
      throw new Error(
        "Durable workflow references an open investigation that cannot be restored.",
      );
    }
    if (
      reconciledSession !== durableSession ||
      reconciledWorkflow !== durableSession.workflow
    ) {
      await saveSession({
        ...reconciledSession,
        updatedAt: reconciledWorkflow.updatedAt,
        workflow: reconciledWorkflow,
      });
    } else {
      sessionRef.current = cloneFieldSession(reconciledSession);
      setSession(cloneFieldSession(reconciledSession));
    }
    workflowRef.current = cloneFieldWorkflow(reconciledWorkflow);
    setInvestigation(durableInvestigation);
    setInvestigationStatus(reconciledWorkflow.investigationStatus);
    setReviewItems(reconciledWorkflow.reviewItems);
    setApprovedModules(reconciledWorkflow.approvedModules);
    setModuleApprovalBindings(reconciledWorkflow.moduleApprovalBindings);
    setDeliveryState(reconciledWorkflow.deliveryState);
    const durableCoverage = await repository.loadCoverage(durableSession.jobId);
    if (durableCoverage !== null) setCoverageLedger(durableCoverage);
  }

  async function runFieldAction(
    action: () => Promise<void>,
    options: { readonly propagateFailure?: boolean } = {},
  ): Promise<void> {
    if (fieldActionInFlight.current) return;
    fieldActionInFlight.current = true;
    setFieldActionBusy(true);
    try {
      await action();
    } catch (cause) {
      try {
        await reloadProfessionalState();
      } catch {
        // Preserve the original action failure as the inspector-facing state.
      }
      setLastAction(
        cause instanceof Error
          ? `Field action not completed — ${cause.message}. Durable state reloaded; review and retry.`
          : "Field action not completed. Durable state reloaded; review and retry.",
      );
      setDockOperationState("needs_review");
      if (options.propagateFailure === true) throw cause;
    } finally {
      fieldActionInFlight.current = false;
      setFieldActionBusy(false);
    }
  }

  async function invalidateModuleApproval(
    module: "building" | "timber_pest",
  ): Promise<void> {
    const current = workflowRef.current;
    if (
      current === undefined ||
      (!current.approvedModules.includes(module) &&
        !current.moduleApprovalBindings.some(
          (binding) => binding.module === module,
        ) &&
        current.packageManifestSha256 === null)
    ) {
      return;
    }
    await saveWorkflow(
      {
        approvedModules: current.approvedModules.filter(
          (approved) => approved !== module,
        ),
        deliveryState: "waiting_for_approval",
        moduleApprovalBindings: current.moduleApprovalBindings.filter(
          (binding) => binding.module !== module,
        ),
        packageManifestSha256: null,
      },
      "professional_state_changed",
    );
  }

  function closeInvestigationPanels(): void {
    setAreaPickerOpen(false);
    setCoverageCloseoutOpen(false);
    setMeasurementOpen(false);
    setEvidenceAreasOpen(false);
    setFinishChoiceOpen(false);
  }

  async function saveInvestigationTransition(
    investigation: Investigation,
    priorRevision: number | null,
    eventType:
      | "investigation.area_changed"
      | "investigation.completed"
      | "investigation.evidence_attached"
      | "investigation.evidence_area_reassigned"
      | "investigation.measurement_recorded"
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
    setInvestigation(investigation);
  }

  async function saveCoverageTransition(
    coverage: CoverageLedger,
    priorRevision: number,
    safeMetadata: Readonly<Record<string, boolean | number | string | null>>,
  ): Promise<void> {
    const repository = inspectionRepositoryRef.current;
    if (repository === undefined) {
      throw new Error("Protected coverage storage is not ready.");
    }
    const occurredAt = new Date().toISOString();
    await repository.saveCoverage({
      coverage,
      event: {
        eventId: randomUUID(),
        eventType: "area.coverage_recorded",
        occurredAt,
        safeMetadataJson: JSON.stringify(safeMetadata),
      },
      expectedStoredRevision: priorRevision,
      updatedAt: occurredAt,
    });
    setCoverageLedger(coverage);
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

  function durableCaptureInputs(): readonly EvidenceAttachmentInput[] {
    if (ledger === undefined) return [];
    return ledger
      .listIntents()
      .filter(
        (intent) =>
          isAttachableCaptureState(intent.state) &&
          ledger.getArtifact(intent.captureId) !== undefined,
      )
      .map((intent) => ({
        artifactId: intent.captureId,
        artifactKind:
          intent.kind === "photo"
            ? ("photo" as const)
            : ("voice_note" as const),
        captureAreaId: intent.areaId,
        capturedAt: intent.capturedAt,
        captureSequence: intent.sequence,
        jobId: intent.jobId,
      }));
  }

  function attachableRecentCaptures(
    active: Investigation | null = investigation,
  ): readonly EvidenceAttachmentInput[] {
    if (active === null || active.status !== "active") return [];
    return selectAttachableRecentCaptures({
      beforeOrAt: new Date().toISOString(),
      captures: durableCaptureInputs(),
      investigation: active,
      limit: 3,
    });
  }

  async function attachRecentCaptures(): Promise<void> {
    const active = await loadActiveInvestigation();
    if (active === null || active.status !== "active") {
      setLastAction(
        "Resume or start an investigation before attaching recent evidence.",
      );
      return;
    }
    const captures = attachableRecentCaptures(active);
    if (captures.length === 0) {
      setLastAction(
        "No unattached recent captures are available for this job.",
      );
      return;
    }
    const next = attachInvestigationEvidence(active, {
      artifacts: captures,
      attachedAt: new Date().toISOString(),
      expectedRevision: active.revision,
      inspectorId: "actor_inspector_demo",
      source: "attached_recent",
    });
    await saveInvestigationTransition(
      next,
      active.revision,
      "investigation.evidence_attached",
      { artifactCount: captures.length, source: "attached_recent" },
    );
    setLastAction(
      `${captures.length} recent ${captures.length === 1 ? "capture" : "captures"} attached in original capture order.`,
    );
  }

  async function saveMeasurement(entry: MeasurementEntry): Promise<void> {
    const active = await loadActiveInvestigation();
    const currentSession = sessionRef.current;
    if (
      active === null ||
      active.status !== "active" ||
      currentSession === undefined
    ) {
      throw new Error(
        "Resume or start an investigation before adding a measurement.",
      );
    }
    const next = recordInvestigationMeasurement(active, {
      expectedRevision: active.revision,
      measurement: {
        areaId: currentSession.areaId,
        kind: entry.kind,
        measuredAt: new Date().toISOString(),
        measuredByInspectorId: "actor_inspector_demo",
        measurementId: randomUUID(),
        note: entry.note,
        unit: entry.unit,
        value: entry.value,
      },
    });
    await saveInvestigationTransition(
      next,
      active.revision,
      "investigation.measurement_recorded",
      { areaId: currentSession.areaId, measurementKind: entry.kind },
    );
    setMeasurementOpen(false);
    setLastAction(
      `Measurement saved locally in ${currentAreaLabel(currentSession.areaId)}.`,
    );
  }

  async function assignEvidenceArea(
    artifactId: string,
    targetAreaId: string,
  ): Promise<void> {
    const active = await loadActiveInvestigation();
    const targetArea = areas.find((area) => area.id === targetAreaId);
    if (
      active === null ||
      active.status !== "active" ||
      targetArea === undefined
    ) {
      setLastAction(
        "Resume the investigation before correcting evidence areas.",
      );
      return;
    }
    const next = reassignInvestigationEvidenceArea(active, {
      areaId: targetArea.id,
      artifactId,
      assignedAt: new Date().toISOString(),
      expectedRevision: active.revision,
      inspectorId: "actor_inspector_demo",
    });
    await saveInvestigationTransition(
      next,
      active.revision,
      "investigation.evidence_area_reassigned",
      { areaId: targetArea.id, status: "reassigned" },
    );
    setLastAction(
      `Evidence assigned to ${targetArea.label}; original capture area retained and the active inspection location did not change.`,
    );
  }

  async function saveAreaCoverage(
    selection: AreaCloseoutSelection,
  ): Promise<void> {
    const currentSession = sessionRef.current;
    const currentCoverage = coverageLedger;
    if (currentSession === undefined || currentCoverage === undefined) {
      throw new Error("Protected coverage storage is not ready.");
    }
    const result = closeOutArea(currentCoverage, {
      areaId: currentSession.areaId,
      coverageEntryId: randomUUID(),
      inspectorId: "actor_inspector_demo",
      material: true,
      module: selection.module,
      recordedAt: new Date().toISOString(),
      state: selection.state,
      ...(selection.detail.length === 0 ? {} : { detail: selection.detail }),
      ...(selection.state === "access_limited" ||
      selection.state === "inaccessible"
        ? { limitationId: randomUUID() }
        : {}),
      ...(selection.state === "revisit" ? { revisitItemId: randomUUID() } : {}),
    });
    // Invalidate first: if the subsequent coverage write fails, the app is
    // safely over-invalidated instead of retaining approval for unseen data.
    await invalidateModuleApproval(selection.module);
    await saveCoverageTransition(result.ledger, currentCoverage.revision, {
      areaId: currentSession.areaId,
      coverageState: selection.state,
      module: selection.module,
    });
    setCoverageCloseoutOpen(false);
    setLastAction(result.announcement);
  }

  async function completeCoverageForTest(): Promise<void> {
    if (!e2eMode) return;
    let current = coverageLedger;
    if (current === undefined) {
      throw new Error("Protected coverage storage is not ready.");
    }
    for (const issue of coverageCompletionIssues(current)) {
      if (issue.reason !== "coverage_not_recorded") continue;
      const result = closeOutArea(current, {
        areaId: issue.areaId,
        coverageEntryId: randomUUID(),
        inspectorId: "actor_inspector_demo",
        module: issue.module,
        recordedAt: new Date().toISOString(),
        state: "inspected",
      });
      await invalidateModuleApproval(issue.module);
      await saveCoverageTransition(result.ledger, current.revision, {
        areaId: issue.areaId,
        coverageState: "inspected",
        module: issue.module,
      });
      current = result.ledger;
    }
    setLastAction(
      "Synthetic test coverage completed for every commissioned area and module.",
    );
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
      setDockOperationState("needs_review");
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
      setDockOperationState("saved");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }
    setLastAction(
      result.kind === "blocked"
        ? `Capture blocked — ${result.reason.replaceAll("_", " ")}. Add a manual note if needed.`
        : `Capture not acknowledged — ${result.reason.replaceAll("_", " ")}. The same identity will be checked on restart.`,
    );
    setDockOperationState(
      result.kind === "blocked" ? "needs_review" : "not_saved",
    );
    setManualNoteOpen(true);
  }

  async function takePhoto(): Promise<void> {
    const interactionStartedAt = globalThis.performance.now();
    if (photoSaving || !(await checkCaptureAllowed())) return;
    setPhotoSaving(true);
    try {
      setDockOperationState("saving");
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
            setDockOperationState("needs_review");
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
      setDockOperationState("not_saved");
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
      setDockOperationState("saving");
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
        setDockOperationState("not_saved");
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
      setDockOperationState("recording");
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
      setDockOperationState("needs_review");
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
    setDockOperationState("recording");
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
    setDockOperationState("saving");
    let noteDurable = false;
    let linkedToInvestigation = false;
    try {
      await recordManualFallback({
        areaId: session.areaId,
        idFactory: randomUUID,
        jobId: session.jobId,
        ledger,
        recordedAt: new Date().toISOString(),
        text: observationText,
      });
      noteDurable = true;
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
    } catch (error) {
      if (noteDurable) {
        setManualNote("");
        setManualNoteOpen(false);
        refreshQueue(ledger);
        setDockOperationState("needs_review");
        setLastAction(
          "Manual observation saved locally, but its investigation link needs attention before completion.",
        );
      } else {
        setDockOperationState("not_saved");
        setLastAction(
          error instanceof Error
            ? `Manual observation not saved — ${error.message}`
            : "Manual observation not saved — protected storage failed.",
        );
      }
      return;
    }
    setManualNote("");
    setManualNoteOpen(false);
    refreshQueue(ledger);
    setDockOperationState("saved");
    setLastAction(
      linkedToInvestigation
        ? "Manual observation saved and linked to the active investigation — queued for sync."
        : "Manual observation saved locally — queued for sync.",
    );
  }

  async function selectArea(nextAreaId: string): Promise<void> {
    if (session === undefined) return;
    const nextArea = areas.find((area) => area.id === nextAreaId);
    if (nextArea === undefined || nextArea.id === session.areaId) {
      setAreaPickerOpen(false);
      return;
    }
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
    setAreaPickerOpen(false);
    setCoverageCloseoutOpen(false);
    setMeasurementOpen(false);
    setEvidenceAreasOpen(false);
    setFinishChoiceOpen(false);
    setLastAction(
      `${nextArea.label} selected${session.activeInvestigationId === undefined ? "." : " — active investigation retained."}`,
    );
  }

  async function openCoverageChecklistItem(
    areaId: string,
    module: "building" | "timber_pest",
  ): Promise<void> {
    const currentSession = sessionRef.current;
    if (currentSession === undefined) return;
    if (investigationStatus === "active" || investigationStatus === "paused") {
      setWorkflowView("capture");
      setLastAction(
        "Finish the open investigation before resolving remaining area coverage.",
      );
      return;
    }
    const nextArea = areas.find((area) => area.id === areaId);
    if (nextArea === undefined) {
      throw new Error("Coverage checklist area is not part of this job.");
    }
    if (currentSession.areaId !== areaId) {
      await saveSession({
        ...currentSession,
        areaId,
        updatedAt: new Date().toISOString(),
      });
    }
    setCoverageCloseoutModule(module);
    setCoverageCloseoutOpen(true);
    setAreaPickerOpen(false);
    setMeasurementOpen(false);
    setEvidenceAreasOpen(false);
    setFinishChoiceOpen(false);
    setWorkflowView("capture");
    setLastAction(
      `${nextArea.label} opened for ${module === "building" ? "Building" : "Timber Pest"} coverage close-out.`,
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
          {
            module: "building",
            moduleId: domainFixtureIds.buildingModuleId,
          },
          {
            module: "timber_pest",
            moduleId: domainFixtureIds.timberPestModuleId,
          },
        ],
        inspectorId: "actor_inspector_demo",
        investigationId: activeInvestigationId,
        jobId: session.jobId,
        organizationId: domainFixtureIds.organizationId,
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
        {
          deliveryState: "waiting_for_approval",
          investigationStatus: "active",
          packageManifestSha256: null,
        },
        "investigation_started",
      );
      setFindingModules([]);
      closeInvestigationPanels();
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
      closeInvestigationPanels();
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

  function toggleFindingModule(module: "building" | "timber_pest"): void {
    setFindingModules((current) =>
      current.includes(module)
        ? current.filter((candidate) => candidate !== module)
        : [...current, module],
    );
  }

  async function finishInvestigation(
    result: "candidate" | "no_finding",
  ): Promise<void> {
    if (session === undefined) return;
    const active = await loadActiveInvestigation();
    if (active === null) throw new Error("Active investigation is missing.");
    if (result === "candidate" && findingModules.length === 0) {
      setLastAction(
        "Select at least one commissioned module for the finding candidate.",
      );
      return;
    }
    const completedAt = new Date().toISOString();
    const moduleLinks =
      result === "candidate"
        ? createFindingCandidateLinks({
            idFactory: randomUUID,
            investigation: active,
            modules: findingModules,
          })
        : [];
    const completed = completeInvestigation(active, {
      completedAt,
      draftingDisposition:
        result === "candidate" ? "queue_ai_asynchronously" : "manual_only",
      expectedRevision: active.revision,
      inspectorId: "actor_inspector_demo",
      moduleLinks,
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
    if (result === "candidate") {
      const current = workflowRef.current;
      if (current === undefined)
        throw new Error("Review workflow is not ready.");
      await saveWorkflow(
        invalidateProfessionalModulesForCandidates({
          candidates: moduleLinks,
          investigationId: completed.investigationId,
          recordedAt: completedAt,
          workflow: current,
        }),
        "professional_state_changed",
      );
    }
    setFinishChoiceOpen(false);
    setMeasurementOpen(false);
    setEvidenceAreasOpen(false);
    setFindingModules([]);
    const currentSession = sessionRef.current;
    if (currentSession === undefined) {
      throw new Error("The durable field session is unavailable.");
    }
    await saveSession(
      reconcileFieldSessionInvestigation(
        currentSession,
        completed,
        completedAt,
      ),
    );
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
        moduleApprovalBindings: current.moduleApprovalBindings.filter(
          (binding) => binding.module !== next.module,
        ),
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
      findingContentPayload(content),
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
      findingContentPayload(content),
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
    const moduleCoverageIssues =
      coverageLedger === undefined
        ? 1
        : coverageCompletionIssues(coverageLedger).filter(
            (issue) => issue.module === module,
          ).length;
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
    if (moduleCoverageIssues > 0) {
      setLastAction(
        `Approval blocked — ${moduleCoverageIssues} ${module === "building" ? "Building" : "Timber Pest"} coverage item(s) remain incomplete.`,
      );
      return;
    }
    const current = workflowRef.current;
    const currentCoverage = coverageLedger;
    if (current === undefined || currentCoverage === undefined) return;
    const contentHashesValid = await verifyAcceptedReviewContentHashes({
      digest: (payload) =>
        digestStringAsync(CryptoDigestAlgorithm.SHA256, payload),
      module,
      reviewItems,
    });
    if (!contentHashesValid) {
      setLastAction(
        "Approval blocked — a finding content hash does not match its exact professional content.",
      );
      return;
    }
    const reviewVersions = approvalReviewVersions(reviewItems, module);
    const coverageRevision = moduleCoverageRevision(currentCoverage, module);
    const snapshotSha256 = await digestStringAsync(
      CryptoDigestAlgorithm.SHA256,
      approvalSnapshotPayload({
        coverage: currentCoverage,
        jobId: session.jobId,
        module,
        reviewItems,
      }),
    );
    const binding: ModuleApprovalBinding = {
      coverageRevision,
      module,
      reviewVersions,
      snapshotSha256,
    };
    await saveWorkflow(
      {
        approvedModules: current.approvedModules.includes(module)
          ? current.approvedModules
          : [...current.approvedModules, module],
        deliveryState: "waiting_for_approval",
        moduleApprovalBindings: [
          ...current.moduleApprovalBindings.filter(
            (existing) => existing.module !== module,
          ),
          binding,
        ],
        packageManifestSha256: null,
      },
      "module_approved",
    );
    setLastAction(
      `${module === "building" ? "Building" : "Timber Pest"} approved independently for the current accepted versions and module coverage.`,
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
    const outstandingCoverage =
      coverageLedger === undefined
        ? 1
        : coverageCompletionIssues(coverageLedger).length;
    if (outstandingCoverage > 0) {
      setLastAction(
        `Package confirmation blocked — ${outstandingCoverage} coverage item(s) remain incomplete.`,
      );
      return;
    }
    if (investigationStatus === "active" || investigationStatus === "paused") {
      setLastAction(
        "Package confirmation blocked — finish the open investigation first.",
      );
      return;
    }
    const current = workflowRef.current;
    const currentCoverage = coverageLedger;
    const allApprovalsCurrent =
      current !== undefined &&
      currentCoverage !== undefined &&
      (
        await Promise.all(
          demoJob.commissionedModules.map((module) =>
            verifyApprovalBinding({
              binding: current.moduleApprovalBindings.find(
                (candidate) => candidate.module === module,
              ),
              coverage: currentCoverage,
              digest: (payload) =>
                digestStringAsync(CryptoDigestAlgorithm.SHA256, payload),
              jobId: session.jobId,
              module,
              reviewItems: current.reviewItems,
            }),
          ),
        )
      ).every(Boolean);
    if (
      current === undefined ||
      !allApprovalsCurrent ||
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
      deliveryPackageManifestPayload({
        approvalBindings: current.moduleApprovalBindings,
        commissionedModules: demoJob.commissionedModules,
        jobId: session.jobId,
        reviewItems: current.reviewItems,
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

  async function confirmSyntheticEvidenceDurability(): Promise<void> {
    const current = workflowRef.current;
    if (
      ledger === undefined ||
      current === undefined ||
      current.packageManifestSha256 === null ||
      current.deliveryState !== "waiting_for_evidence"
    ) {
      throw new Error(
        "Synthetic evidence confirmation requires a hash-bound package waiting for evidence",
      );
    }
    for (const item of ledger.listQueue()) {
      for (const event of syntheticServerDurabilityPath(item.state)) {
        await ledger.applyQueueEvent(item.captureId, event);
      }
    }
    refreshQueue(ledger);
    await saveWorkflow({ deliveryState: "queued" }, "delivery_state_changed");
    setLastAction(
      "Synthetic server fixture checksum-confirmed every queued evidence original; this is not live-server proof.",
    );
  }

  const currentArea =
    areas.find((area) => area.id === session?.areaId) ?? areas[0];
  const currentCoverageSummaries =
    coverageLedger === undefined
      ? []
      : areaCoverageSummary(coverageLedger, currentArea.id);
  const recentCaptures = attachableRecentCaptures();
  const networkAvailable =
    networkOverride === undefined
      ? network.isConnected !== false
      : networkOverride === "available";
  const captureEnabled = startupState === "ready" && session !== undefined;
  const coverageIssues =
    coverageLedger === undefined
      ? []
      : coverageCompletionIssues(coverageLedger);
  const professionalWorkOpen =
    investigationStatus === "active" || investigationStatus === "paused";
  const completionProjection = projectCompletion({
    commissionedModules: demoJob.commissionedModules,
    aiAvailable: demoMode,
    professionalWorkOpen,
    modules: demoJob.commissionedModules.map((module) => {
      const moduleItems = reviewItems.filter((item) => item.module === module);
      const reviewComplete =
        moduleItems.length > 0 &&
        moduleItems.every((item) => item.status === "accepted");
      const approved =
        approvedModules.includes(module) &&
        approvalBindingMatches({
          binding: moduleApprovalBindings.find(
            (candidate) => candidate.module === module,
          ),
          coverageRevision:
            coverageLedger === undefined
              ? undefined
              : moduleCoverageRevision(coverageLedger, module),
          module,
          reviewItems,
        });
      const moduleCoverageIssues = coverageIssues.filter(
        (issue) => issue.module === module,
      ).length;
      return {
        module,
        label: module === "building" ? "Building" : "Timber Pest",
        reviewComplete,
        approvalState: approved
          ? ("approved" as const)
          : reviewComplete && moduleCoverageIssues === 0
            ? ("ready" as const)
            : ("not_ready" as const),
        snapshotRevision:
          reviewComplete && coverageLedger !== undefined
            ? moduleCoverageRevision(coverageLedger, module)
            : null,
        approvalSnapshotRevision: approved
          ? (moduleApprovalBindings.find(
              (candidate) => candidate.module === module,
            )?.coverageRevision ?? null)
          : null,
        coverageIssues: moduleCoverageIssues,
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
    <SafeAreaProvider>
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
                        busy={fieldActionBusy}
                        label="Test: complete coverage"
                        onPress={() => {
                          void runFieldAction(completeCoverageForTest);
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
                        label="Test: return after partial sync"
                        onPress={() => {
                          setNextDebugFailure("return_after_partial_sync");
                          setLastAction(
                            "Next synthetic capture will return before local durability is complete.",
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
                          setNextCoordinatorTermination(
                            "after_acknowledgement",
                          );
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
                  {currentCoverageSummaries.length === 0 ? (
                    <Text style={styles.body}>
                      No coverage judgement recorded for this area.
                    </Text>
                  ) : (
                    currentCoverageSummaries.map((summary) => (
                      <Text key={summary} style={styles.body}>
                        {summary}
                      </Text>
                    ))
                  )}
                  <View style={styles.wrapRow}>
                    <SmallControl
                      label="Change area"
                      onPress={() => {
                        setAreaPickerOpen((current) => !current);
                      }}
                    />
                    <SmallControl
                      label="Close out area"
                      onPress={() => {
                        setCoverageCloseoutModule("building");
                        setCoverageCloseoutOpen(true);
                        setAreaPickerOpen(false);
                        setMeasurementOpen(false);
                        setEvidenceAreasOpen(false);
                        setFinishChoiceOpen(false);
                      }}
                    />
                    {investigationStatus === "active" &&
                    recentCaptures.length > 0 ? (
                      <SmallControl
                        busy={fieldActionBusy}
                        label={`Attach recent (${recentCaptures.length})`}
                        onPress={() => {
                          void runFieldAction(attachRecentCaptures);
                        }}
                      />
                    ) : null}
                    {investigationStatus === "active" ? (
                      <>
                        <SmallControl
                          label="Add measurement"
                          onPress={() => {
                            setMeasurementOpen(true);
                            setAreaPickerOpen(false);
                            setCoverageCloseoutOpen(false);
                            setEvidenceAreasOpen(false);
                            setFinishChoiceOpen(false);
                          }}
                        />
                        <SmallControl
                          label="Review evidence areas"
                          onPress={() => {
                            setEvidenceAreasOpen(true);
                            setAreaPickerOpen(false);
                            setCoverageCloseoutOpen(false);
                            setMeasurementOpen(false);
                            setFinishChoiceOpen(false);
                          }}
                        />
                        <SmallControl
                          label="Finish investigation"
                          onPress={() => {
                            setFinishChoiceOpen(true);
                            setAreaPickerOpen(false);
                            setCoverageCloseoutOpen(false);
                            setMeasurementOpen(false);
                            setEvidenceAreasOpen(false);
                          }}
                        />
                      </>
                    ) : null}
                  </View>
                </View>

                {areaPickerOpen ? (
                  <View style={styles.noteCard}>
                    <Text
                      accessibilityRole="header"
                      style={styles.sectionTitle}
                    >
                      Select area
                    </Text>
                    <Text style={styles.body}>
                      Changing area keeps one ordered investigation and
                      preserves every artifact’s original capture area.
                    </Text>
                    <View style={styles.wrapRow}>
                      {areas.map((area) => (
                        <SmallControl
                          busy={fieldActionBusy}
                          key={area.id}
                          label={`${area.label}${area.id === currentArea.id ? " — current" : ""}`}
                          onPress={() => {
                            void runFieldAction(() => selectArea(area.id));
                          }}
                        />
                      ))}
                    </View>
                  </View>
                ) : null}

                {coverageCloseoutOpen ? (
                  <AreaCloseoutCard
                    areaLabel={currentArea.label}
                    initialModule={coverageCloseoutModule}
                    key={`${currentArea.id}:${coverageCloseoutModule}`}
                    onCancel={() => setCoverageCloseoutOpen(false)}
                    onSave={(selection) =>
                      runFieldAction(() => saveAreaCoverage(selection), {
                        propagateFailure: true,
                      })
                    }
                    summaries={currentCoverageSummaries}
                  />
                ) : null}

                {measurementOpen ? (
                  <MeasurementEntryCard
                    areaLabel={currentArea.label}
                    onCancel={() => setMeasurementOpen(false)}
                    onSave={(entry) =>
                      runFieldAction(() => saveMeasurement(entry), {
                        propagateFailure: true,
                      })
                    }
                  />
                ) : null}

                {evidenceAreasOpen && investigation !== null ? (
                  <EvidenceAreaCard
                    areaLabel={currentAreaLabel}
                    areas={areas}
                    busy={fieldActionBusy}
                    evidence={investigation.evidence}
                    onAssign={(artifactId, areaId) => {
                      void runFieldAction(() =>
                        assignEvidenceArea(artifactId, areaId),
                      );
                    }}
                    onClose={() => setEvidenceAreasOpen(false)}
                    previewFor={(artifactId) => {
                      const artifact = ledger?.getArtifact(artifactId);
                      return artifact === undefined
                        ? undefined
                        : { fileUri: artifact.fileUri };
                    }}
                  />
                ) : null}

                {finishChoiceOpen && investigationStatus === "active" ? (
                  <View
                    accessibilityLiveRegion="assertive"
                    style={styles.noteCard}
                  >
                    <Text
                      accessibilityRole="header"
                      style={styles.sectionTitle}
                    >
                      Finish investigation
                    </Text>
                    <Text style={styles.body}>
                      Choose the inspector-owned outcome. AI work remains
                      asynchronous and evidence stays available either way.
                    </Text>
                    <Text style={styles.body}>
                      Every selected module candidate uses the evidence attached
                      to this issue thread. Use a separate investigation when
                      the source evidence differs by module.
                    </Text>
                    <Text style={styles.metadataLabel}>
                      Finding candidate modules
                    </Text>
                    <View style={styles.wrapRow}>
                      <SmallControl
                        label={`Building candidate — ${findingModules.includes("building") ? "selected" : "not selected"}`}
                        onPress={() => toggleFindingModule("building")}
                      />
                      <SmallControl
                        label={`Timber Pest candidate — ${findingModules.includes("timber_pest") ? "selected" : "not selected"}`}
                        onPress={() => toggleFindingModule("timber_pest")}
                      />
                    </View>
                    <View style={styles.wrapRow}>
                      <SmallControl
                        busy={fieldActionBusy}
                        label="Save finding candidate"
                        onPress={() =>
                          void runFieldAction(() =>
                            finishInvestigation("candidate"),
                          )
                        }
                      />
                      <SmallControl
                        busy={fieldActionBusy}
                        label="No reportable finding"
                        onPress={() =>
                          void runFieldAction(() =>
                            finishInvestigation("no_finding"),
                          )
                        }
                      />
                      <SmallControl
                        label="Cancel finish"
                        onPress={() => setFinishChoiceOpen(false)}
                      />
                    </View>
                  </View>
                ) : null}

                <View
                  accessibilityLiveRegion="polite"
                  style={styles.statusList}
                >
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
                    <Text
                      accessibilityRole="header"
                      style={styles.sectionTitle}
                    >
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
                        void runFieldAction(saveManualNote);
                      }}
                    />
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
                      completed investigation. New field captures do not enter
                      it until evidence sync and packet construction complete.
                    </Text>
                  ) : null}
                </View>
                <View style={styles.checklistCard}>
                  <Text accessibilityRole="header" style={styles.sectionTitle}>
                    Completion checklist
                  </Text>
                  {completionProjection.canConfirmPackage ? (
                    <Text style={styles.body}>
                      Coverage, review and independent module approvals are
                      current. The exact delivery package can be confirmed
                      below.
                    </Text>
                  ) : null}
                  {professionalWorkOpen ? (
                    <Pressable
                      accessibilityHint="Returns to the current field area and active investigation controls"
                      accessibilityRole="button"
                      onPress={() => {
                        setWorkflowView("capture");
                        setLastAction(
                          "Active investigation opened — finish or resume it before approval.",
                        );
                      }}
                      style={({ pressed }) => [
                        styles.checklistAction,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.checklistItem}>
                        Inspection · Finish the open investigation before
                        approval or packaging.
                      </Text>
                    </Pressable>
                  ) : null}
                  {completionProjection.modules.map((module) => {
                    const moduleCoverage = coverageIssues.filter(
                      (issue) => issue.module === module.module,
                    );
                    const moduleBlockers = completionProjection.blockers
                      .filter(
                        (blocker) =>
                          blocker.startsWith(`${module.label}:`) &&
                          !blocker.includes("coverage item(s) incomplete"),
                      )
                      .map((blocker) => blocker.slice(module.label.length + 2));
                    return (
                      <View key={module.module} style={styles.checklistModule}>
                        <Text style={styles.moduleChecklistLabel}>
                          {module.label}
                        </Text>
                        {moduleCoverage.map((issue) => {
                          const areaLabel =
                            areas.find((area) => area.id === issue.areaId)
                              ?.label ?? issue.areaId;
                          return (
                            <Pressable
                              accessibilityHint={`Opens ${areaLabel} with ${module.label} selected for coverage close-out`}
                              accessibilityRole="button"
                              key={`${issue.moduleId}:${issue.areaId}:${issue.reason}`}
                              onPress={() => {
                                void runFieldAction(() =>
                                  openCoverageChecklistItem(
                                    issue.areaId,
                                    issue.module,
                                  ),
                                );
                              }}
                              style={({ pressed }) => [
                                styles.checklistAction,
                                pressed && styles.pressed,
                              ]}
                            >
                              <Text style={styles.checklistItem}>
                                {areaLabel} ·{" "}
                                {issue.reason === "revisit_open"
                                  ? "revisit remains open"
                                  : "record coverage"}
                              </Text>
                            </Pressable>
                          );
                        })}
                        {moduleBlockers.map((blocker) => (
                          <Text key={blocker} style={styles.checklistItem}>
                            {blocker}
                          </Text>
                        ))}
                        {moduleCoverage.length === 0 &&
                        moduleBlockers.length === 0 ? (
                          <Text style={styles.checklistComplete}>
                            Complete and independently approved
                          </Text>
                        ) : null}
                      </View>
                    );
                  })}
                  {professionalWorkOpen || coverageIssues.length > 0 ? (
                    <SmallControl
                      label="Continue field work"
                      onPress={() => setWorkflowView("capture")}
                    />
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
                        void runFieldAction(() => acceptReview(item));
                      }}
                      onContinueHuman={() => {
                        void runFieldAction(() => continueReviewAsHuman(item));
                      }}
                      onEdit={() => {
                        beginReviewEdit(item);
                      }}
                      onReject={() => {
                        void runFieldAction(() => rejectReview(item));
                      }}
                      onReverify={() => {
                        void runFieldAction(() => reverifyReview(item));
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
                              void runFieldAction(() =>
                                saveReviewEdit(item, "reverify_ai"),
                              );
                            }}
                          />
                          <SmallControl
                            label="Save as inspector-authored"
                            onPress={() => {
                              void runFieldAction(() =>
                                saveReviewEdit(item, "convert_to_human"),
                              );
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
                <DeliveryStatusCard
                  status={fieldDeliveryStatus(deliveryState)}
                />
                {e2eMode &&
                workflowRef.current?.packageManifestSha256 != null &&
                deliveryState === "waiting_for_evidence" ? (
                  <SmallControl
                    busy={fieldActionBusy}
                    label="Test: confirm evidence durable"
                    onPress={() => {
                      void runFieldAction(confirmSyntheticEvidenceDurability);
                    }}
                  />
                ) : null}
                {e2eMode &&
                workflowRef.current?.packageManifestSha256 != null &&
                deliveryState === "queued" ? (
                  <SmallControl
                    busy={fieldActionBusy}
                    label="Test: provider confirms sent"
                    onPress={() => {
                      void runFieldAction(async () => {
                        const current = workflowRef.current;
                        if (current === undefined) {
                          throw new Error("Delivery workflow is unavailable.");
                        }
                        for (const nextState of syntheticProviderDeliveryPath({
                          packageManifestSha256: current.packageManifestSha256,
                          state: current.deliveryState,
                        })) {
                          await saveWorkflow(
                            { deliveryState: nextState },
                            "delivery_state_changed",
                          );
                        }
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
              captureEnabled={captureEnabled}
              currentAreaLabel={currentArea.label}
              investigationStatus={investigationStatus}
              investigationActionBusy={fieldActionBusy}
              operationStatus={lastAction}
              operationState={dockOperationState}
              onInvestigationAction={() => {
                void runFieldAction(changeInvestigationState);
              }}
              onPhoto={() => {
                void takePhoto();
              }}
              onVoice={() => {
                void toggleVoice();
              }}
              photoBusy={photoSaving}
              recentCaptureCount={recentCaptures.length}
              voiceState={voiceState}
            />
          ) : (
            <ModuleCompletionDock
              busy={fieldActionBusy}
              onApproveModule={(module) => {
                void runFieldAction(() => approveModule(module));
              }}
              onConfirmPackage={() => {
                void runFieldAction(confirmDeliveryPackage);
              }}
              packageConfirmed={
                workflowRef.current?.packageManifestSha256 != null
              }
              projection={completionProjection}
            />
          )}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function SmallControl(props: {
  busy?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  const disabled = props.busy === true || props.disabled === true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: props.busy, disabled }}
      disabled={disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.smallControl,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
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
  checklistCard: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    gap: theme.space[3],
    padding: theme.space[4],
  },
  checklistAction: {
    backgroundColor: theme.color.canvas,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: theme.target.minimum,
    padding: theme.space[3],
  },
  checklistComplete: {
    color: theme.color.action,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 22,
  },
  checklistItem: {
    color: theme.color.major,
    fontSize: 15,
    lineHeight: 22,
  },
  checklistModule: {
    borderTopColor: theme.color.outline,
    borderTopWidth: 1,
    gap: theme.space[2],
    paddingTop: theme.space[3],
  },
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
  moduleChecklistLabel: {
    color: theme.color.ink,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 24,
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
