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
import { randomUUID } from "expo-crypto";
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
import { fieldJobContext } from "./src/jobs/field-job-context";
import { describeFieldActionFailure } from "./src/investigations/field-action-recovery";
import { InvestigationControlDock } from "./src/investigations/investigation-controls";
import {
  durabilityAnnouncement,
  investigationCompletionVoiceBlock,
  type DockOperationState,
  type VoiceControlState,
} from "./src/investigations/field-shell-contract";
import { deriveInvestigationFinishActionView } from "./src/investigations/finish-options";
import { EvidenceAreaCard } from "./src/investigations/evidence-area-card";
import {
  confirmFindingCandidateSourceSelection,
  createFindingCandidateLinks,
  type FindingCandidateModuleSelection,
  type RevisionBoundFindingCandidateModuleSelection,
  isAttachableCaptureState,
  selectAttachableRecentCaptures,
  toggleFindingCandidateSource,
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
import { resolveApprovingInspectorAuthority } from "./src/completion/approving-inspector-authority";
import {
  findingCandidateAtRiskSourceIds,
  invalidateProfessionalStateForEvidenceRisk,
} from "./src/completion/evidence-risk";
import { DeliveryStatusCard } from "./src/delivery/delivery-status-card";
import {
  fieldDeliveryStatus,
  syntheticProviderDeliveryPath,
  type FieldDeliveryState,
} from "./src/delivery/delivery-status";
import { InvestigationReviewCard } from "./src/review/investigation-review-card";
import { createSyntheticReviewFixture } from "./src/review/demo-review-items";
import {
  createSeededInvestigationReview,
  SEEDED_CRACKED_TILE_OBSERVATION_TEXT,
  SEEDED_CRACKED_TILE_SCENARIO_ID,
} from "./src/review/seeded-vertical-slice";
import { verifyExactSourcePacket } from "./src/review/source-packet";
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
import {
  SerializedFieldSessionWriter,
  type FieldSessionMutation,
} from "./src/storage/field-session-writer";
import type { LocalInspectionRepository } from "./src/investigations/local-inspection-repository";
import { expoInspectionDigest } from "./src/investigations/expo-inspection-digest";
import {
  createRecipientPackageSnapshot,
  projectRecipientOverview,
  verifyRecipientPackageSnapshot,
} from "./src/recipient/recipient-overview";

type VoiceState = VoiceControlState;
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

const digestFieldPayload = (value: string) =>
  expoInspectionDigest.sha256(value);

async function createInitialDemoWorkflow(
  updatedAt: string = new Date().toISOString(),
): Promise<FieldWorkflowSnapshot> {
  if (!demoMode) return initialFieldWorkflow([], updatedAt);
  const fixture = await createSyntheticReviewFixture(digestFieldPayload);
  return initialFieldWorkflow(
    fixture.reviewItems,
    updatedAt,
    fixture.sourcePackets,
  );
}

async function initialDemoSession(
  deviceId: string,
): Promise<FieldSessionSnapshot> {
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
    propertyLabel: demoJob.propertyLabel,
    session: "valid",
    updatedAt,
    workflow: await createInitialDemoWorkflow(updatedAt),
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
  const investigationCompletionInFlight = useRef(false);
  const fieldActionInFlight = useRef(false);
  const lastDurabilityAnnouncement = useRef<string | undefined>(undefined);
  const sessionRef = useRef<FieldSessionSnapshot | undefined>(undefined);
  const sessionWriterRef = useRef<SerializedFieldSessionWriter | undefined>(
    undefined,
  );
  const workflowRef = useRef<FieldWorkflowSnapshot | undefined>(undefined);
  const voiceStartLatency = useRef<number | undefined>(undefined);
  const voiceStateRef = useRef<VoiceState>("idle");
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
  const [findingEvidenceSelections, setFindingEvidenceSelections] = useState<
    readonly RevisionBoundFindingCandidateModuleSelection[]
  >([]);
  const [findingSourceDrafts, setFindingSourceDrafts] = useState<
    readonly FindingCandidateModuleSelection[]
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
  >([]);
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
          if (!demoMode) {
            throw new Error(
              "No cached assigned job is available for this enrolled device.",
            );
          }
          restored = await initialDemoSession(
            credential?.deviceId ?? "device-synthetic-build-week",
          );
          await openedLedger.saveFieldSession(restored);
        } else {
          restored = storedSession;
        }
        let restoredWorkflow = restored.workflow;
        if (restoredWorkflow === undefined) {
          restoredWorkflow = await createInitialDemoWorkflow();
          restored = {
            ...restored,
            workflow: restoredWorkflow,
          };
          await openedLedger.saveFieldSession(restored);
        } else if (
          demoMode &&
          restoredWorkflow.reviewItems.length === 0 &&
          restoredWorkflow.sourcePackets.length === 0
        ) {
          const fixture =
            await createSyntheticReviewFixture(digestFieldPayload);
          restoredWorkflow = cloneFieldWorkflow({
            ...restoredWorkflow,
            lastTransition: "review_changed",
            reviewItems: fixture.reviewItems,
            sourcePackets: fixture.sourcePackets,
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
        const evidenceRiskInvalidation =
          invalidateProfessionalStateForEvidenceRisk({
            captureIds: recovery.evidenceAtRisk,
            recordedAt: new Date().toISOString(),
            workflow: restoredWorkflow,
          });
        if (evidenceRiskInvalidation !== undefined) {
          restoredWorkflow = cloneFieldWorkflow({
            ...restoredWorkflow,
            ...evidenceRiskInvalidation,
            lastTransition: "professional_state_changed",
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
        const restoredJob = fieldJobContext(restored);
        let durableCoverage =
          await persistence.inspectionRepository.loadCoverage(restored.jobId);
        if (durableCoverage === null) {
          durableCoverage = createCoverageLedger({
            areas: areas.map((area) => ({
              applicableModules: restoredJob.commissionedModuleTypes,
              areaId: area.id,
              label: area.label,
            })),
            commissionedModules: restoredJob.commissionedModules,
            jobId: restoredJob.jobId,
            organizationId: restoredJob.organizationId,
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
        const completedCandidateLink =
          durableInvestigation?.status === "completed_findings" &&
          durableInvestigation.completion?.outcome === "finding_candidates" &&
          durableInvestigation.completion.moduleLinks.length === 1
            ? durableInvestigation.completion.moduleLinks[0]
            : undefined;
        const completedCandidateObservation =
          completedCandidateLink === undefined
            ? undefined
            : durableInvestigation?.observations.find(({ observationId }) =>
                completedCandidateLink.sourceObservationIds.includes(
                  observationId,
                ),
              );
        const recoveryBlockedCandidateSourceIds =
          findingCandidateAtRiskSourceIds({
            captureIds: recovery.evidenceAtRisk,
            moduleLinks:
              completedCandidateLink === undefined
                ? []
                : [completedCandidateLink],
          });
        if (
          demoMode &&
          durableInvestigation?.status === "completed_findings" &&
          completedCandidateLink?.module === "building" &&
          completedCandidateLink.sourceObservationIds.length === 1 &&
          recoveryBlockedCandidateSourceIds.length === 0 &&
          completedCandidateObservation?.text ===
            SEEDED_CRACKED_TILE_OBSERVATION_TEXT &&
          !restoredWorkflow.processedFindingCandidateIds.includes(
            completedCandidateLink.findingCandidateId,
          )
        ) {
          const regenerated = await createSeededInvestigationReview({
            scenarioId: SEEDED_CRACKED_TILE_SCENARIO_ID,
            investigation: durableInvestigation,
            coverage: durableCoverage,
            artifactHash: (artifactId) =>
              openedLedger.getArtifact(artifactId)?.sha256 ??
              openedLedger.getManualNote(artifactId)?.contentHash,
            areaLabel: currentAreaLabel,
            createdAt: new Date().toISOString(),
            digest: digestFieldPayload,
            idFactory: randomUUID,
          });
          const processed = invalidateProfessionalModulesForCandidates({
            candidates: [completedCandidateLink],
            investigationId: durableInvestigation.investigationId,
            recordedAt:
              durableInvestigation.completion?.completedAt ??
              new Date().toISOString(),
            workflow: restoredWorkflow,
          });
          restoredWorkflow = cloneFieldWorkflow({
            ...restoredWorkflow,
            ...processed,
            lastTransition: "review_changed",
            reviewItems: [
              ...processed.reviewItems.filter(
                (item) => item.module !== completedCandidateLink.module,
              ),
              ...regenerated.reviewItems,
            ],
            sourcePackets: [
              ...restoredWorkflow.sourcePackets,
              regenerated.packet,
            ],
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
        const sourcePacketValidity = await Promise.all(
          restoredWorkflow.sourcePackets.map((packet) =>
            verifyExactSourcePacket(packet, digestFieldPayload),
          ),
        );
        if (!sourcePacketValidity.every(Boolean)) {
          throw new Error(
            "Stored AI source packet identity failed integrity verification.",
          );
        }
        const restoredReviewItems = restoredWorkflow.reviewItems;
        const bindingValidity = await Promise.all(
          restoredWorkflow.moduleApprovalBindings.map((binding) =>
            verifyApprovalBinding({
              binding,
              coverage: durableCoverage,
              digest: digestFieldPayload,
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
          restoredJob.commissionedModuleTypes.every(
            (module) =>
              validApprovedModules.includes(module) &&
              validBindings.some((binding) => binding.module === module),
          )
        ) {
          const recipientPackage = restoredWorkflow.recipientPackage;
          if (recipientPackage !== null) {
            packageManifestValid = await verifyRecipientPackageSnapshot(
              recipientPackage,
              digestFieldPayload,
            );
            if (packageManifestValid) {
              try {
                projectRecipientOverview({
                  packageSnapshot: recipientPackage,
                  reviewItems: restoredReviewItems,
                });
              } catch {
                packageManifestValid = false;
              }
            }
            if (packageManifestValid) {
              const expectedPackageSha256 = await digestFieldPayload(
                deliveryPackageManifestPayload({
                  approvalBindings: validBindings,
                  commissionedModules: restoredJob.commissionedModuleTypes,
                  jobId: restoredJob.jobId,
                  recipientPackageHash: recipientPackage.canonicalHash,
                  reviewItems: restoredReviewItems,
                }),
              );
              packageManifestValid =
                expectedPackageSha256 ===
                restoredWorkflow.packageManifestSha256;
            }
          } else {
            packageManifestValid = false;
          }
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
            recipientPackage: null,
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
        sessionRef.current = restored;
        sessionWriterRef.current = new SerializedFieldSessionWriter({
          initial: restored,
          persist: (snapshot) => openedLedger.saveFieldSession(snapshot),
          onCommitted: (snapshot) => {
            sessionRef.current = cloneFieldSession(snapshot);
            setSession(cloneFieldSession(snapshot));
            const committedWorkflow = snapshot.workflow;
            if (
              committedWorkflow !== undefined &&
              workflowRef.current?.revision !== committedWorkflow.revision
            ) {
              workflowRef.current = cloneFieldWorkflow(committedWorkflow);
              setInvestigationStatus(committedWorkflow.investigationStatus);
              setReviewItems(committedWorkflow.reviewItems);
              setApprovedModules(committedWorkflow.approvedModules);
              setModuleApprovalBindings(
                committedWorkflow.moduleApprovalBindings,
              );
              setDeliveryState(committedWorkflow.deliveryState);
            }
          },
        });
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
          recoveryBlockedCandidateSourceIds.length > 0
            ? `Recovery blocked draft regeneration because ${recoveryBlockedCandidateSourceIds.length} selected evidence ${recoveryBlockedCandidateSourceIds.length === 1 ? "source is" : "sources are"} missing or corrupt. The candidate remains saved and unprocessed; no draft was created. Manual inspection follow-up is required.`
            : recovery.actions.length === 0
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
    let manualNotes = 0;
    let photos = 0;
    let voiceNotes = 0;
    for (const item of activeLedger.listQueue()) {
      if (item.state === "server_durable") continue;
      if (item.lane === "manual_note_sync") manualNotes += 1;
      if (item.lane === "photo_upload") photos += 1;
      if (item.lane === "voice_upload") voiceNotes += 1;
    }
    setQueueCounts((current) =>
      current.manualNotes === manualNotes &&
      current.photos === photos &&
      current.voiceNotes === voiceNotes
        ? current
        : { manualNotes, photos, voiceNotes },
    );
  }

  async function saveSession(
    mutate: FieldSessionMutation,
  ): Promise<FieldSessionSnapshot> {
    const writer = sessionWriterRef.current;
    if (writer === undefined) {
      throw new Error("The durable field session writer is not ready.");
    }
    return writer.update(mutate);
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
        | "recipientPackage"
        | "reviewItems"
        | "sourcePackets"
      >
    >,
    lastTransition: FieldWorkflowSnapshot["lastTransition"],
  ): Promise<FieldWorkflowSnapshot> {
    const committed = await saveSession((currentSession) => {
      const currentWorkflow = currentSession.workflow;
      if (currentWorkflow === undefined) {
        throw new Error("The field workflow is not ready.");
      }
      const nextWorkflow: FieldWorkflowSnapshot = {
        ...currentWorkflow,
        ...patch,
        ...((patch.packageManifestSha256 === null ||
          (patch.packageManifestSha256 === undefined &&
            currentWorkflow.packageManifestSha256 === null)) && {
          recipientPackage: null,
        }),
        lastTransition,
        revision: currentWorkflow.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      return {
        ...currentSession,
        updatedAt: nextWorkflow.updatedAt,
        workflow: nextWorkflow,
      };
    });
    const nextWorkflow = committed.workflow;
    if (nextWorkflow === undefined) {
      throw new Error("The committed field workflow is unavailable.");
    }
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
      throw new Error("protected professional state is unavailable");
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
      await saveSession(() => ({
        ...reconciledSession,
        updatedAt: reconciledWorkflow.updatedAt,
        workflow: reconciledWorkflow,
      }));
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
    if (startupState !== "ready") {
      setLastAction(
        "Professional actions are blocked until protected local state is ready. Restart the app if recovery was blocked.",
      );
      setDockOperationState("needs_review");
      return;
    }
    if (fieldActionInFlight.current) return;
    fieldActionInFlight.current = true;
    setFieldActionBusy(true);
    try {
      await action();
    } catch (cause) {
      let reloadFailure: unknown;
      try {
        await reloadProfessionalState();
      } catch (reloadCause) {
        reloadFailure = reloadCause;
      }
      const failure = describeFieldActionFailure(cause, reloadFailure);
      if (failure.recoveryBlocked) setStartupState("terminal");
      setLastAction(failure.message);
      setDockOperationState("needs_review");
      if (options.propagateFailure === true) {
        if (reloadFailure !== undefined) {
          throw new AggregateError(
            [cause, reloadFailure],
            "Field action and durable recovery both failed",
            { cause },
          );
        }
        throw cause;
      }
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
    setFindingEvidenceSelections([]);
    setFindingSourceDrafts([]);
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
    let sequence: number | undefined;
    await saveSession((currentSession) => {
      sequence = currentSession.nextSequence;
      return {
        ...currentSession,
        nextSequence: currentSession.nextSequence + 1,
        updatedAt: new Date().toISOString(),
      };
    });
    if (sequence === undefined) {
      throw new Error("The open assigned job is not ready.");
    }
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

  function updateVoiceState(nextState: VoiceState): void {
    voiceStateRef.current = nextState;
    setVoiceState(nextState);
  }

  async function toggleVoice(): Promise<void> {
    const currentVoiceState = voiceStateRef.current;
    if (currentVoiceState === "recording") {
      updateVoiceState("saving");
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
      } catch (error) {
        setDockOperationState("not_saved");
        setLastAction(
          error instanceof Error
            ? `Voice note not acknowledged — ${error.message}`
            : "Voice note not acknowledged — local capture failed.",
        );
        setManualNoteOpen(true);
      } finally {
        voiceStartLatency.current = undefined;
        updateVoiceState("idle");
      }
      return;
    }
    if (
      currentVoiceState === "starting" ||
      currentVoiceState === "saving" ||
      currentVoiceState === "unavailable"
    ) {
      return;
    }
    if (investigationCompletionInFlight.current) {
      setLastAction(
        "Voice capture waits until investigation completion is saved locally.",
      );
      return;
    }

    const interactionStartedAt = globalThis.performance.now();
    updateVoiceState("starting");
    try {
      if (!(await checkCaptureAllowed())) {
        updateVoiceState("idle");
        return;
      }
      if (e2eMode) {
        updateVoiceState("recording");
        setDockOperationState("recording");
        voiceStartLatency.current = Math.max(
          0,
          globalThis.performance.now() - interactionStartedAt,
        );
        setLastAction(
          "Voice note recording — photo capture remains available.",
        );
        return;
      }
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        updateVoiceState("unavailable");
        setDockOperationState("needs_review");
        setLastAction(
          "Microphone permission denied — voice capture unavailable; add a manual note.",
        );
        setManualNoteOpen(true);
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      updateVoiceState("recording");
      setDockOperationState("recording");
      voiceStartLatency.current = Math.max(
        0,
        globalThis.performance.now() - interactionStartedAt,
      );
      setLastAction("Voice note recording — photo capture remains available.");
    } catch (error) {
      voiceStartLatency.current = undefined;
      updateVoiceState("idle");
      setDockOperationState("not_saved");
      setLastAction(
        error instanceof Error
          ? `Voice note could not start — ${error.message}`
          : "Voice note could not start — microphone preparation failed.",
      );
      setManualNoteOpen(true);
    }
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
    const recordedAt = new Date().toISOString();
    setDockOperationState("saving");
    let noteDurable = false;
    let linkedToInvestigation = false;
    try {
      const recorded = await recordManualFallback({
        areaId: session.areaId,
        digest: digestFieldPayload,
        idFactory: randomUUID,
        jobId: session.jobId,
        ledger,
        recordedAt,
        text: observationText,
      });
      noteDurable = true;
      if (
        ledger.getManualNote(recorded.noteId)?.contentHash !==
        recorded.contentHash
      ) {
        throw new Error("Durable manual-note identity could not be verified");
      }
      const active = await loadActiveInvestigation();
      if (active?.status === "active") {
        const attached = attachInvestigationEvidence(active, {
          artifacts: [
            {
              artifactId: recorded.noteId,
              artifactKind: "manual_note",
              captureAreaId: session.areaId,
              capturedAt: recordedAt,
              captureSequence:
                Math.max(
                  0,
                  ...active.evidence.map(
                    ({ captureSequence }) => captureSequence,
                  ),
                ) + 1,
              jobId: session.jobId,
            },
          ],
          attachedAt: recordedAt,
          expectedRevision: active.revision,
          inspectorId: "actor_inspector_demo",
          source: "captured_during_investigation",
        });
        await saveInvestigationTransition(
          attached,
          active.revision,
          "investigation.evidence_attached",
          { artifactCount: 1, source: "captured_during_investigation" },
        );
        const observed = recordInvestigationObservation(attached, {
          expectedRevision: attached.revision,
          observation: {
            areaId: session.areaId,
            observationId: recorded.noteId,
            recordedAt,
            recordedByInspectorId: "actor_inspector_demo",
            text: observationText,
          },
        });
        await saveInvestigationTransition(
          observed,
          attached.revision,
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
    await saveSession((currentSession) => ({
      ...currentSession,
      areaId: nextArea.id,
      updatedAt: new Date().toISOString(),
    }));
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
      await saveSession((latestSession) => ({
        ...latestSession,
        areaId,
        updatedAt: new Date().toISOString(),
      }));
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
      const job = fieldJobContext(session);
      const started = startInvestigation({
        areaId: session.areaId,
        commissionedModules: job.commissionedModules,
        inspectorId: "actor_inspector_demo",
        investigationId: activeInvestigationId,
        jobId: job.jobId,
        organizationId: job.organizationId,
        startedAt,
      });
      await saveInvestigationTransition(
        started,
        null,
        "investigation.started",
        { areaId: session.areaId, status: "active" },
      );
      await saveSession((currentSession) => ({
        ...currentSession,
        activeInvestigationId,
        updatedAt: startedAt,
      }));
      await saveWorkflow(
        {
          deliveryState: "waiting_for_approval",
          investigationStatus: "active",
          packageManifestSha256: null,
        },
        "investigation_started",
      );
      setFindingModules([]);
      setFindingSourceDrafts([]);
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
    setFindingEvidenceSelections((current) =>
      current.filter((selection) => selection.module !== module),
    );
    setFindingModules((current) =>
      current.includes(module)
        ? current.filter((candidate) => candidate !== module)
        : [...current, module],
    );
    setFindingSourceDrafts((current) =>
      current.filter((draft) => draft.module !== module),
    );
  }

  function toggleFindingSource(
    module: "building" | "timber_pest",
    sourceType: "artifact" | "observation",
    sourceId: string,
  ): void {
    setFindingEvidenceSelections((current) =>
      current.filter((selection) => selection.module !== module),
    );
    setFindingSourceDrafts((current) =>
      toggleFindingCandidateSource(current, {
        module,
        sourceId,
        sourceType,
      }),
    );
  }

  async function confirmFindingEvidence(
    module: "building" | "timber_pest",
  ): Promise<void> {
    const active = await loadActiveInvestigation();
    if (
      active === null ||
      active.status !== "active" ||
      !findingModules.includes(module)
    ) {
      throw new Error(
        "Select the module and keep the investigation active before confirming its sources.",
      );
    }
    const selection = confirmFindingCandidateSourceSelection({
      drafts: findingSourceDrafts,
      investigation: active,
      module,
    });
    setFindingEvidenceSelections((current) => [
      ...current.filter((candidate) => candidate.module !== module),
      selection,
    ]);
    setLastAction(
      `${module === "building" ? "Building" : "Timber Pest"} candidate sources confirmed: ${selection.sourceArtifactIds.length} evidence ${selection.sourceArtifactIds.length === 1 ? "item" : "items"} and ${selection.sourceObservationIds.length} inspector ${selection.sourceObservationIds.length === 1 ? "observation" : "observations"}.`,
    );
  }

  function openFinishInvestigation(): void {
    const voiceBlock = investigationCompletionVoiceBlock(voiceStateRef.current);
    if (voiceBlock !== null) {
      setLastAction(voiceBlock);
      return;
    }
    setFinishChoiceOpen(true);
    setAreaPickerOpen(false);
    setCoverageCloseoutOpen(false);
    setMeasurementOpen(false);
    setEvidenceAreasOpen(false);
  }

  async function finishInvestigation(
    result: "candidate" | "no_finding",
  ): Promise<void> {
    const voiceBlock = investigationCompletionVoiceBlock(voiceStateRef.current);
    if (voiceBlock !== null) {
      setLastAction(voiceBlock);
      return;
    }
    if (investigationCompletionInFlight.current) return;
    investigationCompletionInFlight.current = true;
    try {
      await finishInvestigationAfterVoiceSettled(result);
    } finally {
      investigationCompletionInFlight.current = false;
    }
  }

  async function finishInvestigationAfterVoiceSettled(
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
    const confirmedSelections = findingModules.map((module) =>
      findingEvidenceSelections.find(
        (selection) => selection.module === module,
      ),
    );
    if (
      result === "candidate" &&
      confirmedSelections.some(
        (selection) =>
          selection === undefined ||
          selection.investigationRevision !== active.revision,
      )
    ) {
      setLastAction(
        "Confirm the exact evidence and observation sources for every selected module after the latest investigation change.",
      );
      return;
    }
    const completedAt = new Date().toISOString();
    const moduleLinks =
      result === "candidate"
        ? createFindingCandidateLinks({
            idFactory: randomUUID,
            investigation: active,
            moduleSelections: confirmedSelections.map((selection) => {
              if (selection === undefined) {
                throw new Error("A selected module has no confirmed sources");
              }
              return {
                module: selection.module,
                sourceArtifactIds: selection.sourceArtifactIds,
                sourceObservationIds: selection.sourceObservationIds,
              };
            }),
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
    let draftPersisted = false;
    if (result === "candidate") {
      const current = workflowRef.current;
      if (current === undefined)
        throw new Error("Review workflow is not ready.");
      const invalidation = invalidateProfessionalModulesForCandidates({
        candidates: moduleLinks,
        investigationId: completed.investigationId,
        markProcessed: false,
        recordedAt: completedAt,
        workflow: current,
      });
      const invalidatedWorkflow = await saveWorkflow(
        invalidation,
        "professional_state_changed",
      );
      const selectedObservation = completed.observations.find(
        ({ observationId }) =>
          moduleLinks[0]?.sourceObservationIds.includes(observationId),
      );
      const seededScenarioSelected =
        moduleLinks.length === 1 &&
        moduleLinks[0]?.module === "building" &&
        moduleLinks[0].sourceObservationIds.length === 1 &&
        selectedObservation?.text === SEEDED_CRACKED_TILE_OBSERVATION_TEXT;
      const seeded =
        demoMode &&
        seededScenarioSelected &&
        coverageLedger !== undefined &&
        ledger !== undefined
          ? await createSeededInvestigationReview({
              scenarioId: SEEDED_CRACKED_TILE_SCENARIO_ID,
              investigation: completed,
              coverage: coverageLedger,
              artifactHash: (artifactId) =>
                ledger.getArtifact(artifactId)?.sha256 ??
                ledger.getManualNote(artifactId)?.contentHash,
              areaLabel: currentAreaLabel,
              createdAt: completedAt,
              digest: digestFieldPayload,
              idFactory: randomUUID,
            })
          : null;
      const affectedModules = new Set(moduleLinks.map(({ module }) => module));
      if (seeded !== null) {
        const processed = invalidateProfessionalModulesForCandidates({
          candidates: moduleLinks,
          investigationId: completed.investigationId,
          recordedAt: completedAt,
          workflow: invalidatedWorkflow,
        });
        await saveWorkflow(
          {
            ...processed,
            reviewItems: [
              ...processed.reviewItems.filter(
                (item) => !affectedModules.has(item.module),
              ),
              ...seeded.reviewItems,
            ],
            sourcePackets: [
              ...invalidatedWorkflow.sourcePackets,
              seeded.packet,
            ],
          },
          "review_changed",
        );
        draftPersisted = true;
      }
    }
    setFinishChoiceOpen(false);
    setMeasurementOpen(false);
    setEvidenceAreasOpen(false);
    setFindingModules([]);
    setFindingEvidenceSelections([]);
    setFindingSourceDrafts([]);
    await saveSession((currentSession) =>
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
        ? draftPersisted
          ? "Investigation candidate saved locally — deterministic synthetic draft ready from the exact source packet."
          : "Investigation candidate saved locally — drafting waits for evidence sync and an exact source packet."
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
    const newContentHash = await digestFieldPayload(
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
    const newContentHash = await digestFieldPayload(
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
      digest: digestFieldPayload,
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
    const approvingInspector = resolveApprovingInspectorAuthority({
      allowSyntheticFixture: demoMode,
      confirmedAt: new Date().toISOString(),
      module,
      syntheticInspectorId: domainFixtureIds.inspectorId,
    });
    if (approvingInspector === undefined) {
      setLastAction(
        "Approval blocked — a verified inspector profile is required outside the synthetic demo.",
      );
      return;
    }
    const snapshotSha256 = await digestFieldPayload(
      approvalSnapshotPayload({
        approvingInspector,
        coverage: currentCoverage,
        jobId: session.jobId,
        module,
        reviewItems,
      }),
    );
    const binding: ModuleApprovalBinding = {
      approvingInspector,
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
    const job = fieldJobContext(session);
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
          job.commissionedModuleTypes.map((module) =>
            verifyApprovalBinding({
              binding: current.moduleApprovalBindings.find(
                (candidate) => candidate.module === module,
              ),
              coverage: currentCoverage,
              digest: digestFieldPayload,
              jobId: job.jobId,
              module,
              reviewItems: current.reviewItems,
            }),
          ),
        )
      ).every(Boolean);
    if (
      current === undefined ||
      currentCoverage === undefined ||
      !allApprovalsCurrent ||
      job.commissionedModuleTypes.some(
        (module) => !current.approvedModules.includes(module),
      )
    ) {
      setLastAction(
        "Package confirmation blocked — every commissioned module requires its own current approval.",
      );
      return;
    }
    const evidencePending =
      queueCounts.photos + queueCounts.voiceNotes + queueCounts.manualNotes > 0;
    const issuedAt = new Date().toISOString();
    const recipientPackage = await createRecipientPackageSnapshot({
      approvalBindings: current.moduleApprovalBindings,
      commissionedModules: job.commissionedModuleTypes,
      coverage: currentCoverage,
      digest: digestFieldPayload,
      issuedAt,
      jobId: job.jobId,
      organizationId: job.organizationId,
      propertyLabel: job.propertyLabel,
      reportVersionId: randomUUID(),
      reviewItems: current.reviewItems,
    });
    projectRecipientOverview({
      packageSnapshot: recipientPackage,
      reviewItems: current.reviewItems,
    });
    const packageManifestSha256 = await digestFieldPayload(
      deliveryPackageManifestPayload({
        approvalBindings: current.moduleApprovalBindings,
        commissionedModules: job.commissionedModuleTypes,
        jobId: job.jobId,
        recipientPackageHash: recipientPackage.canonicalHash,
        reviewItems: current.reviewItems,
      }),
    );
    await saveWorkflow(
      {
        deliveryState: evidencePending ? "waiting_for_evidence" : "queued",
        packageManifestSha256,
        recipientPackage,
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
  const recipientOverview =
    workflowView === "review"
      ? (() => {
          const packageSnapshot = workflowRef.current?.recipientPackage;
          if (packageSnapshot === null || packageSnapshot === undefined) {
            return null;
          }
          try {
            return projectRecipientOverview({ packageSnapshot, reviewItems });
          } catch {
            return null;
          }
        })()
      : null;
  const currentCoverageSummaries =
    coverageLedger === undefined
      ? []
      : areaCoverageSummary(coverageLedger, currentArea.id);
  const recentCaptures =
    workflowView === "capture" ? attachableRecentCaptures() : [];
  const networkAvailable =
    networkOverride === undefined
      ? network.isConnected !== false
      : networkOverride === "available";
  const captureEnabled = startupState === "ready" && session !== undefined;
  const finishActionView = deriveInvestigationFinishActionView({
    busy: fieldActionBusy,
    voiceState,
  });
  const coverageIssues =
    coverageLedger === undefined
      ? []
      : coverageCompletionIssues(coverageLedger);
  const professionalWorkOpen =
    investigationStatus === "active" || investigationStatus === "paused";
  const activeJob =
    session === undefined ? undefined : fieldJobContext(session);
  const commissionedModuleTypes = activeJob?.commissionedModuleTypes ?? [];
  const completionProjection = projectCompletion({
    commissionedModules: commissionedModuleTypes,
    aiAvailable: demoMode,
    professionalWorkOpen,
    modules: commissionedModuleTypes.map((module) => {
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
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            style={styles.scroll}
          >
            <Text accessibilityRole="header" style={styles.eyebrow}>
              {demoMode ? "Synthetic assigned inspection" : "Open inspection"}
            </Text>
            <Text accessibilityRole="header" style={styles.heading}>
              {activeJob?.propertyLabel ?? "Loading inspection"}
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
                            void saveSession((currentSession) => ({
                              ...currentSession,
                              session: "expired",
                              updatedAt: new Date().toISOString(),
                            }));
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
                          disabled={finishActionView.finishDisabled}
                          label="Finish investigation"
                          onPress={openFinishInvestigation}
                          testID="finish-investigation-control"
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
                      Select a module, then confirm the exact evidence and
                      inspector observations that support that candidate.
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
                    {findingModules.map((module) => {
                      const selection = findingEvidenceSelections.find(
                        (candidate) => candidate.module === module,
                      );
                      const draft = findingSourceDrafts.find(
                        (candidate) => candidate.module === module,
                      );
                      const currentRevision = investigation?.revision;
                      const confirmed =
                        selection !== undefined &&
                        selection.investigationRevision === currentRevision;
                      const moduleLabel =
                        module === "building" ? "Building" : "Timber Pest";
                      return (
                        <View
                          key={`candidate-sources-${module}`}
                          style={styles.candidateSourceGroup}
                        >
                          <Text style={styles.moduleChecklistLabel}>
                            {moduleLabel} candidate sources
                          </Text>
                          <Text style={styles.metadataLabel}>
                            Select supporting evidence
                          </Text>
                          {investigation?.evidence.map((source, index) => (
                            <CandidateSourceControl
                              key={`${module}-artifact-${source.artifactId}`}
                              label={`Evidence ${index + 1}: ${source.artifactKind.replaceAll("_", " ")} · ${currentAreaLabel(source.currentAreaId)}`}
                              onPress={() =>
                                toggleFindingSource(
                                  module,
                                  "artifact",
                                  source.artifactId,
                                )
                              }
                              selected={
                                draft?.sourceArtifactIds.includes(
                                  source.artifactId,
                                ) ?? false
                              }
                              testID={`candidate-${module}-evidence-${index}`}
                            />
                          ))}
                          <Text style={styles.metadataLabel}>
                            Select supporting inspector observations
                          </Text>
                          {investigation?.observations.map(
                            (observation, index) => (
                              <CandidateSourceControl
                                key={`${module}-observation-${observation.observationId}`}
                                label={`Observation ${index + 1}: ${observation.text} · ${currentAreaLabel(observation.areaId)}`}
                                onPress={() =>
                                  toggleFindingSource(
                                    module,
                                    "observation",
                                    observation.observationId,
                                  )
                                }
                                selected={
                                  draft?.sourceObservationIds.includes(
                                    observation.observationId,
                                  ) ?? false
                                }
                                testID={`candidate-${module}-observation-${index}`}
                              />
                            ),
                          )}
                          <SmallControl
                            label={
                              confirmed
                                ? `${moduleLabel} sources confirmed — ${selection.sourceArtifactIds.length} evidence ${selection.sourceArtifactIds.length === 1 ? "item" : "items"}, ${selection.sourceObservationIds.length} ${selection.sourceObservationIds.length === 1 ? "observation" : "observations"}`
                                : `Confirm ${moduleLabel} candidate sources`
                            }
                            onPress={() => {
                              void runFieldAction(() =>
                                confirmFindingEvidence(module),
                              );
                            }}
                          />
                        </View>
                      );
                    })}
                    {finishActionView.blockedReason !== null ? (
                      <Text
                        accessibilityLiveRegion="assertive"
                        style={styles.body}
                      >
                        {finishActionView.blockedReason}
                      </Text>
                    ) : null}
                    <View style={styles.wrapRow}>
                      <SmallControl
                        busy={fieldActionBusy}
                        disabled={finishActionView.saveFindingCandidateDisabled}
                        label="Save finding candidate"
                        onPress={() =>
                          void runFieldAction(() =>
                            finishInvestigation("candidate"),
                          )
                        }
                        testID="save-finding-candidate-control"
                      />
                      <SmallControl
                        busy={fieldActionBusy}
                        disabled={finishActionView.noReportableFindingDisabled}
                        label="No reportable finding"
                        onPress={() =>
                          void runFieldAction(() =>
                            finishInvestigation("no_finding"),
                          )
                        }
                        testID="no-reportable-finding-control"
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
                      accessibilityLabel="Manual observation input"
                      multiline
                      onChangeText={setManualNote}
                      placeholder="Record what you observed and where."
                      placeholderTextColor={theme.color.inkMuted}
                      style={styles.noteInput}
                      testID="manual-observation-input"
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
                {recipientOverview !== null ? (
                  <View
                    accessibilityLabel="Recipient overview preview"
                    style={styles.reviewNotice}
                    testID="recipient-overview-preview"
                  >
                    <Text style={styles.metadataLabel}>Recipient preview</Text>
                    <Text
                      accessibilityRole="header"
                      style={styles.sectionTitle}
                    >
                      Condition overview
                    </Text>
                    {recipientOverview.modules.map((module) => {
                      const sourceCount = module.findings.reduce(
                        (count, finding) => count + finding.evidenceSourceCount,
                        0,
                      );
                      return (
                        <View key={module.module} style={styles.checklistCard}>
                          <Text style={styles.moduleChecklistLabel}>
                            {module.module === "building"
                              ? "Building report"
                              : "Timber Pest report"}
                          </Text>
                          <View
                            accessibilityLabel={`${module.module === "building" ? "Building" : "Timber Pest"} inspector authority`}
                            style={styles.recipientInspectorCard}
                            testID={`recipient-${module.module}-inspector-authority`}
                          >
                            <Text style={styles.metadataLabel}>
                              Inspector authority
                            </Text>
                            <Text style={styles.moduleChecklistLabel}>
                              {module.inspector.displayName}
                            </Text>
                            <Text style={styles.body}>
                              {module.inspector.credential}
                            </Text>
                            <Text style={styles.metadataLabel}>
                              {module.inspector.authority === "verified_profile"
                                ? "Verified inspector profile"
                                : "Synthetic fixture authority"}
                            </Text>
                          </View>
                          {module.materialLimitations.length > 0 ? (
                            <View
                              accessibilityLabel={`${module.module === "building" ? "Building" : "Timber Pest"} material limitations`}
                              style={styles.recipientLimitationCard}
                              testID={`recipient-${module.module}-material-limitations`}
                            >
                              <Text style={styles.recipientLimitationTitle}>
                                Active material limitations
                              </Text>
                              {module.materialLimitations.map(
                                (limitation, limitationIndex) => (
                                  <Text
                                    key={`${module.module}-limitation-${limitationIndex}`}
                                    style={styles.recipientLimitationText}
                                  >
                                    {limitation.areaLabel}:{" "}
                                    {limitation.description}
                                  </Text>
                                ),
                              )}
                            </View>
                          ) : null}
                          {module.findings.map((finding, findingIndex) => (
                            <View
                              key={`${module.module}-finding-${findingIndex}`}
                              style={styles.recipientFinding}
                            >
                              <Text style={styles.body}>
                                {finding.location} ·{" "}
                                {finding.classification.replaceAll("_", " ")}
                              </Text>
                              <Text style={styles.body}>
                                {finding.observation}
                              </Text>
                            </View>
                          ))}
                          <Text style={styles.metadataLabel}>
                            {sourceCount} inspector-selected evidence{" "}
                            {sourceCount === 1
                              ? "source reference"
                              : "source references"}
                            ; private evidence identities are not shown.
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
                <View accessible style={styles.reviewNotice}>
                  <Text style={styles.sectionTitle}>Inspector review</Text>
                  <Text style={styles.body}>
                    AI text is provisional. Accept, edit or reject each exact
                    version; Building and Timber Pest approvals remain separate.
                  </Text>
                  {demoMode ? (
                    <Text style={styles.body}>
                      Demo review can include a current field-linked Building
                      packet and separately seeded synthetic fixture packets.
                      Check each module's source disclosure before acceptance.
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
              busy={fieldActionBusy || startupState !== "ready"}
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
  testID?: string;
}) {
  const disabled = props.busy === true || props.disabled === true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: props.busy, disabled }}
      disabled={disabled}
      onPress={props.onPress}
      testID={props.testID}
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

function CandidateSourceControl(props: {
  label: string;
  onPress: () => void;
  selected: boolean;
  testID: string;
}) {
  const selectionLabel = props.selected ? "selected" : "not selected";
  return (
    <Pressable
      accessibilityHint="Toggles whether this exact source supports the selected professional module"
      accessibilityLabel={`${props.label}, ${selectionLabel}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: props.selected }}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.checklistAction,
        props.selected && styles.candidateSourceSelected,
        pressed && styles.pressed,
      ]}
      testID={props.testID}
    >
      <Text style={styles.checklistItem}>
        {props.label} — {selectionLabel}
      </Text>
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
    ...theme.typography.headlineMd,
    color: theme.color.ink,
  },
  body: { ...theme.typography.bodyMd, color: theme.color.inkMuted },
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
    ...theme.typography.bodyMd,
    color: theme.color.action,
    fontWeight: "600",
  },
  checklistItem: {
    ...theme.typography.bodyMd,
    color: theme.color.major,
  },
  checklistModule: {
    borderTopColor: theme.color.outline,
    borderTopWidth: 1,
    gap: theme.space[2],
    paddingTop: theme.space[3],
  },
  candidateSourceGroup: {
    gap: theme.space[2],
  },
  candidateSourceSelected: {
    borderColor: theme.color.action,
    borderWidth: 2,
  },
  camera: {
    borderRadius: theme.radius.medium,
    height: theme.component.cameraHeight,
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
    minHeight: theme.component.cameraPlaceholderMinimumHeight,
    padding: theme.space[4],
  },
  cameraPlaceholderText: {
    ...theme.typography.bodyMd,
    color: theme.color.surface,
    textAlign: "center",
  },
  disabled: { opacity: 0.55 },
  eyebrow: {
    ...theme.typography.labelSm,
    color: theme.color.action,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: theme.space[2],
  },
  heading: {
    ...theme.typography.display,
    color: theme.color.ink,
  },
  metadataLabel: {
    ...theme.typography.bodySm,
    color: theme.color.inkMuted,
    fontWeight: "600",
  },
  moduleChecklistLabel: {
    ...theme.typography.labelLg,
    color: theme.color.ink,
    fontWeight: "700",
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
    ...theme.typography.bodyMd,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    color: theme.color.ink,
    minHeight: theme.component.detailInputMinimumHeight,
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
    ...theme.typography.labelLg,
    color: theme.color.ink,
    fontWeight: "700",
  },
  reviewItem: { gap: theme.space[3] },
  recipientFinding: {
    borderTopColor: theme.color.outline,
    borderTopWidth: 1,
    gap: theme.space[1],
    paddingTop: theme.space[3],
  },
  recipientInspectorCard: {
    backgroundColor: theme.color.canvas,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.small,
    borderWidth: 1,
    gap: theme.space[1],
    padding: theme.space[3],
  },
  recipientLimitationCard: {
    backgroundColor: theme.color.limitationContainer,
    borderColor: theme.color.limitation,
    borderRadius: theme.radius.small,
    borderWidth: 1,
    gap: theme.space[2],
    padding: theme.space[3],
  },
  recipientLimitationText: {
    ...theme.typography.bodyMd,
    color: theme.color.limitation,
  },
  recipientLimitationTitle: {
    ...theme.typography.labelLg,
    color: theme.color.limitation,
    fontWeight: "700",
  },
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
    ...theme.typography.labelLg,
    color: theme.color.ink,
    textAlign: "center",
  },
  sectionTitle: {
    ...theme.typography.headlineMd,
    color: theme.color.ink,
    fontWeight: "700",
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
    minWidth: theme.component.fieldControlMinimumWidth,
    padding: theme.space[3],
  },
  smallControlLabel: {
    ...theme.typography.labelLg,
    color: theme.color.ink,
    textAlign: "center",
  },
  statusCard: {
    backgroundColor: theme.color.surface,
    borderLeftColor: theme.color.action,
    borderLeftWidth: 4,
    padding: theme.space[4],
  },
  statusDetail: {
    ...theme.typography.bodySm,
    color: theme.color.inkMuted,
    marginTop: theme.space[1],
  },
  statusLabel: {
    ...theme.typography.labelLg,
    color: theme.color.ink,
    fontWeight: "700",
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
