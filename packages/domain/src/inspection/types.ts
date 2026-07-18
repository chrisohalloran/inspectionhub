import type { ModuleType } from "@inspection/contracts";

export type InvestigationStatus =
  | "active"
  | "paused"
  | "completed_findings"
  | "completed_no_reportable_finding";

export type ProfessionalModuleReference = {
  readonly module: ModuleType;
  readonly moduleId: string;
};

export type InvestigationDraftingDisposition =
  "manual_only" | "queue_ai_asynchronously";

export type InvestigationArtifactKind = "manual_note" | "photo" | "voice_note";

export type AreaAssignmentChange = {
  readonly areaId: string;
  readonly assignedAt: string;
  readonly assignedByInspectorId: string;
  readonly reason: "capture_context" | "inspector_correction";
};

export type InvestigationEvidence = {
  readonly artifactId: string;
  readonly artifactKind: InvestigationArtifactKind;
  readonly captureAreaId: string;
  readonly capturedAt: string;
  readonly captureSequence: number;
  readonly currentAreaId: string;
  readonly areaAssignmentHistory: readonly AreaAssignmentChange[];
  readonly attachedAt: string;
  readonly attachedByInspectorId: string;
  readonly linkOrdinal: number;
  readonly source: "attached_recent" | "captured_during_investigation";
};

export type InvestigationMeasurementKind =
  "crack_width" | "length" | "level_variation" | "moisture_reading" | "other";

export type InvestigationMeasurementUnit =
  "millimetres" | "percent" | "relative_scale" | "metres" | "other";

export type InvestigationMeasurement = {
  readonly areaId: string;
  readonly measuredAt: string;
  readonly measuredByInspectorId: string;
  readonly measurementId: string;
  readonly kind: InvestigationMeasurementKind;
  readonly value: number;
  readonly unit: InvestigationMeasurementUnit;
  readonly note: string | null;
};

export type InvestigationObservation = {
  readonly areaId: string;
  readonly observationId: string;
  readonly recordedAt: string;
  readonly recordedByInspectorId: string;
  readonly text: string;
};

export type InvestigationAreaVisit = {
  readonly areaId: string;
  readonly enteredAt: string;
  readonly ordinal: number;
};

export type InvestigationTimelineEntry =
  | {
      readonly type: "area_entered";
      readonly ordinal: number;
      readonly occurredAt: string;
      readonly areaId: string;
    }
  | {
      readonly type: "evidence_linked";
      readonly ordinal: number;
      readonly occurredAt: string;
      readonly artifactId: string;
      readonly areaId: string;
    }
  | {
      readonly type: "measurement_recorded";
      readonly ordinal: number;
      readonly occurredAt: string;
      readonly measurementId: string;
      readonly areaId: string;
    }
  | {
      readonly type: "observation_recorded";
      readonly ordinal: number;
      readonly occurredAt: string;
      readonly observationId: string;
      readonly areaId: string;
    }
  | {
      readonly type: "paused" | "resumed";
      readonly ordinal: number;
      readonly occurredAt: string;
      readonly areaId: string;
    };

export type InvestigationModuleLink = {
  readonly findingCandidateId: string;
  readonly module: ModuleType;
  readonly moduleId: string;
  readonly sourceArtifactIds: readonly string[];
  readonly sourceObservationIds: readonly string[];
};

export type InvestigationCompletion = {
  readonly completedAt: string;
  readonly completedByInspectorId: string;
  readonly draftingDisposition: InvestigationDraftingDisposition;
  readonly moduleLinks: readonly InvestigationModuleLink[];
  readonly outcome: "finding_candidates" | "no_reportable_finding";
};

export type Investigation = {
  readonly investigationId: string;
  readonly organizationId: string;
  readonly jobId: string;
  readonly commissionedModules: readonly ProfessionalModuleReference[];
  readonly startedAt: string;
  readonly startedByInspectorId: string;
  readonly status: InvestigationStatus;
  readonly revision: number;
  readonly currentAreaId: string;
  readonly areaVisits: readonly InvestigationAreaVisit[];
  readonly evidence: readonly InvestigationEvidence[];
  readonly measurements: readonly InvestigationMeasurement[];
  readonly observations: readonly InvestigationObservation[];
  readonly timeline: readonly InvestigationTimelineEntry[];
  readonly completion: InvestigationCompletion | null;
};

export type EvidenceAttachmentInput = {
  readonly artifactId: string;
  readonly artifactKind: InvestigationArtifactKind;
  readonly captureAreaId: string;
  readonly capturedAt: string;
  readonly captureSequence: number;
  readonly jobId: string;
};

export type AreaCoverageState =
  | "access_limited"
  | "inaccessible"
  | "inspected"
  | "not_applicable"
  | "revisit";

export type InspectionArea = {
  readonly areaId: string;
  readonly label: string;
  readonly applicableModules: readonly ModuleType[];
};

export type CoverageEntry = {
  readonly areaId: string;
  readonly coverageEntryId: string;
  readonly module: ModuleType;
  readonly moduleId: string;
  readonly state: AreaCoverageState;
  readonly detail: string | null;
  readonly recordedAt: string;
  readonly recordedByInspectorId: string;
  readonly revision: number;
};

export type CoverageLimitation = {
  readonly areaId: string;
  readonly limitationId: string;
  readonly module: ModuleType;
  readonly moduleId: string;
  readonly description: string;
  readonly material: boolean;
  readonly recordedAt: string;
  readonly status: "active" | "superseded";
  readonly supersededAt: string | null;
};

export type CoverageRevisitItem = {
  readonly areaId: string;
  readonly module: ModuleType;
  readonly moduleId: string;
  readonly reason: string;
  readonly revisitItemId: string;
  readonly openedAt: string;
  readonly status: "open" | "resolved";
  readonly resolvedAt: string | null;
};

export type CoverageLedger = {
  readonly organizationId: string;
  readonly jobId: string;
  readonly commissionedModules: readonly ProfessionalModuleReference[];
  readonly areas: readonly InspectionArea[];
  readonly revision: number;
  readonly entries: readonly CoverageEntry[];
  readonly limitations: readonly CoverageLimitation[];
  readonly revisitItems: readonly CoverageRevisitItem[];
};

export type CoverageCompletionIssue = {
  readonly areaId: string;
  readonly module: ModuleType;
  readonly moduleId: string;
  readonly reason: "coverage_not_recorded" | "revisit_open";
};

export type InvestigationTranscriptSpan = {
  readonly correctedText: string;
  readonly correctionOrigin: "inspector" | "transcription_provider";
  readonly endMilliseconds: number;
  readonly spanId: string;
  readonly startMilliseconds: number;
  readonly voiceArtifactId: string;
};

export type InvestigationContradiction = {
  readonly contradictionId: string;
  readonly description: string;
  readonly resolution: string | null;
  readonly sourceArtifactIds: readonly string[];
  readonly status: "resolved" | "unresolved";
};

export type InvestigationInspectorFeedback = {
  readonly feedbackId: string;
  readonly modules: readonly ModuleType[];
  readonly text: string;
};

export type InvestigationModuleSchemaReference = ProfessionalModuleReference & {
  readonly schemaVersion: string;
};

export type InvestigationPacketVersionPins = {
  readonly model: string;
  readonly promptVersion: string;
  readonly skillVersions: readonly string[];
};

export type InvestigationPacket = {
  readonly schemaVersion: 1;
  readonly packetId: string;
  readonly packetRevision: number;
  readonly canonicalHash: string;
  readonly organizationId: string;
  readonly jobId: string;
  readonly investigationId: string;
  readonly investigationRevision: number;
  readonly modules: readonly ProfessionalModuleReference[];
  readonly findingCandidates: readonly InvestigationModuleLink[];
  readonly moduleSchemas: readonly InvestigationModuleSchemaReference[];
  readonly versionPins: InvestigationPacketVersionPins;
  readonly areaHistory: readonly InvestigationAreaVisit[];
  readonly evidence: readonly InvestigationEvidence[];
  readonly measurements: readonly InvestigationMeasurement[];
  readonly observations: readonly InvestigationObservation[];
  readonly transcriptSpans: readonly InvestigationTranscriptSpan[];
  readonly contradictions: readonly InvestigationContradiction[];
  readonly priorInspectorFeedback: readonly InvestigationInspectorFeedback[];
  readonly coverage: readonly CoverageEntry[];
  readonly limitations: readonly CoverageLimitation[];
  readonly unknowns: readonly string[];
  readonly createdAt: string;
};
