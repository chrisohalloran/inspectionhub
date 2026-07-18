import type { ModuleType } from "@inspection/contracts";

import { DomainConflictError } from "../errors.js";
import { deepFreeze } from "../freeze.js";
import type {
  EvidenceAttachmentInput,
  Investigation,
  InvestigationDraftingDisposition,
  InvestigationEvidence,
  InvestigationMeasurement,
  InvestigationModuleLink,
  InvestigationObservation,
  InvestigationTimelineEntry,
} from "./types.js";

type StartInvestigation = {
  readonly investigationId: string;
  readonly organizationId: string;
  readonly jobId: string;
  readonly commissionedModules: Investigation["commissionedModules"];
  readonly areaId: string;
  readonly startedAt: string;
  readonly inspectorId: string;
};

export function startInvestigation(command: StartInvestigation): Investigation {
  if (command.commissionedModules.length === 0) {
    throw new DomainConflictError(
      "investigation_has_no_module",
      "An investigation must belong to at least one commissioned professional module",
    );
  }
  if (
    new Set(command.commissionedModules.map((reference) => reference.module))
      .size !== command.commissionedModules.length ||
    new Set(command.commissionedModules.map((reference) => reference.moduleId))
      .size !== command.commissionedModules.length
  ) {
    throw new DomainConflictError(
      "duplicate_commissioned_module",
      "Commissioned professional modules must be unique",
    );
  }
  return freezeInvestigation({
    investigationId: command.investigationId,
    organizationId: command.organizationId,
    jobId: command.jobId,
    commissionedModules: [...command.commissionedModules],
    startedAt: command.startedAt,
    startedByInspectorId: command.inspectorId,
    status: "active",
    revision: 0,
    currentAreaId: command.areaId,
    areaVisits: [
      { areaId: command.areaId, enteredAt: command.startedAt, ordinal: 1 },
    ],
    evidence: [],
    measurements: [],
    observations: [],
    timeline: [
      {
        type: "area_entered",
        areaId: command.areaId,
        occurredAt: command.startedAt,
        ordinal: 1,
      },
    ],
    completion: null,
  });
}

export function changeInvestigationArea(
  state: Investigation,
  command: {
    readonly expectedRevision: number;
    readonly areaId: string;
    readonly enteredAt: string;
  },
): Investigation {
  assertWritable(state, command.expectedRevision);
  if (state.currentAreaId === command.areaId) {
    throw new DomainConflictError(
      "area_already_current",
      "The selected area is already current for this investigation",
    );
  }
  const visitOrdinal = state.areaVisits.length + 1;
  return advance(state, {
    currentAreaId: command.areaId,
    areaVisits: [
      ...state.areaVisits,
      {
        areaId: command.areaId,
        enteredAt: command.enteredAt,
        ordinal: visitOrdinal,
      },
    ],
    timeline: [
      ...state.timeline,
      timelineEntry(state.timeline, {
        type: "area_entered",
        areaId: command.areaId,
        occurredAt: command.enteredAt,
      }),
    ],
  });
}

export function attachInvestigationEvidence(
  state: Investigation,
  command: {
    readonly expectedRevision: number;
    readonly artifacts: readonly EvidenceAttachmentInput[];
    readonly attachedAt: string;
    readonly inspectorId: string;
    readonly source: InvestigationEvidence["source"];
  },
): Investigation {
  assertWritable(state, command.expectedRevision);
  if (command.artifacts.length === 0) {
    throw new DomainConflictError(
      "no_evidence_selected",
      "Select at least one recent or current artifact to attach",
    );
  }
  const existingIds = new Set(state.evidence.map((item) => item.artifactId));
  const commandIds = new Set<string>();
  for (const artifact of command.artifacts) {
    if (artifact.jobId !== state.jobId) {
      throw new DomainConflictError(
        "wrong_job_evidence",
        "Evidence from another job cannot enter this investigation",
        { artifactId: artifact.artifactId },
      );
    }
    if (
      existingIds.has(artifact.artifactId) ||
      commandIds.has(artifact.artifactId)
    ) {
      throw new DomainConflictError(
        "evidence_already_attached",
        "An immutable original may be linked only once to an investigation",
        { artifactId: artifact.artifactId },
      );
    }
    commandIds.add(artifact.artifactId);
  }

  const orderedInputs = [...command.artifacts].sort(compareCaptureOrder);
  const additions: InvestigationEvidence[] = orderedInputs.map(
    (artifact, index) => ({
      artifactId: artifact.artifactId,
      artifactKind: artifact.artifactKind,
      captureAreaId: artifact.captureAreaId,
      capturedAt: artifact.capturedAt,
      captureSequence: artifact.captureSequence,
      currentAreaId: artifact.captureAreaId,
      areaAssignmentHistory: [
        {
          areaId: artifact.captureAreaId,
          assignedAt: artifact.capturedAt,
          assignedByInspectorId: command.inspectorId,
          reason: "capture_context",
        },
      ],
      attachedAt: command.attachedAt,
      attachedByInspectorId: command.inspectorId,
      linkOrdinal: state.evidence.length + index + 1,
      source: command.source,
    }),
  );
  const newTimeline = additions.map((evidence, index) => ({
    type: "evidence_linked" as const,
    areaId: evidence.currentAreaId,
    artifactId: evidence.artifactId,
    occurredAt: command.attachedAt,
    ordinal: state.timeline.length + index + 1,
  }));
  return advance(state, {
    evidence: [...state.evidence, ...additions],
    timeline: [...state.timeline, ...newTimeline],
  });
}

export function reassignInvestigationEvidenceArea(
  state: Investigation,
  command: {
    readonly expectedRevision: number;
    readonly artifactId: string;
    readonly areaId: string;
    readonly assignedAt: string;
    readonly inspectorId: string;
  },
): Investigation {
  assertWritable(state, command.expectedRevision);
  const evidence = state.evidence.find(
    (item) => item.artifactId === command.artifactId,
  );
  if (evidence === undefined) {
    throw new DomainConflictError(
      "evidence_not_attached",
      "Only evidence already attached to this investigation can be reassigned",
    );
  }
  if (evidence.currentAreaId === command.areaId) {
    throw new DomainConflictError(
      "evidence_area_unchanged",
      "The evidence is already assigned to that area",
    );
  }
  return advance(state, {
    evidence: state.evidence.map((item) =>
      item.artifactId === command.artifactId
        ? {
            ...item,
            currentAreaId: command.areaId,
            areaAssignmentHistory: [
              ...item.areaAssignmentHistory,
              {
                areaId: command.areaId,
                assignedAt: command.assignedAt,
                assignedByInspectorId: command.inspectorId,
                reason: "inspector_correction" as const,
              },
            ],
          }
        : item,
    ),
  });
}

export function recordInvestigationMeasurement(
  state: Investigation,
  command: {
    readonly expectedRevision: number;
    readonly measurement: InvestigationMeasurement;
  },
): Investigation {
  assertWritable(state, command.expectedRevision);
  const validationError = investigationMeasurementValidationError(
    command.measurement,
  );
  if (validationError !== null) {
    throw new DomainConflictError("invalid_measurement", validationError);
  }
  if (
    state.measurements.some(
      (item) => item.measurementId === command.measurement.measurementId,
    )
  ) {
    throw new DomainConflictError(
      "measurement_already_recorded",
      "Measurement identity must be unique within an investigation",
    );
  }
  return advance(state, {
    measurements: [...state.measurements, command.measurement],
    timeline: [
      ...state.timeline,
      timelineEntry(state.timeline, {
        type: "measurement_recorded",
        areaId: command.measurement.areaId,
        measurementId: command.measurement.measurementId,
        occurredAt: command.measurement.measuredAt,
      }),
    ],
  });
}

const measurementUnits = {
  crack_width: ["millimetres"],
  length: ["millimetres", "metres"],
  level_variation: ["millimetres"],
  moisture_reading: ["percent", "relative_scale"],
  other: ["millimetres", "metres", "percent", "relative_scale", "other"],
} as const satisfies Readonly<
  Record<
    InvestigationMeasurement["kind"],
    readonly InvestigationMeasurement["unit"][]
  >
>;

export function investigationMeasurementValidationError(
  measurement: Pick<InvestigationMeasurement, "kind" | "unit" | "value">,
): string | null {
  if (!Number.isFinite(measurement.value)) {
    return "A measurement value must be finite";
  }
  if (!measurementUnits[measurement.kind].includes(measurement.unit as never)) {
    return "A measurement unit must match its measurement type";
  }
  if (
    (measurement.kind === "crack_width" ||
      measurement.kind === "length" ||
      measurement.kind === "level_variation" ||
      (measurement.kind === "moisture_reading" &&
        measurement.unit === "relative_scale")) &&
    measurement.value < 0
  ) {
    return "A physical measurement cannot be negative";
  }
  if (
    measurement.kind === "moisture_reading" &&
    measurement.unit === "percent" &&
    (measurement.value < 0 || measurement.value > 100)
  ) {
    return "A percentage moisture reading must be between 0 and 100";
  }
  return null;
}

export function recordInvestigationObservation(
  state: Investigation,
  command: {
    readonly expectedRevision: number;
    readonly observation: InvestigationObservation;
  },
): Investigation {
  assertWritable(state, command.expectedRevision);
  if (command.observation.text.trim().length === 0) {
    throw new DomainConflictError(
      "empty_observation",
      "An inspector observation cannot be blank",
    );
  }
  if (
    state.observations.some(
      (item) => item.observationId === command.observation.observationId,
    )
  ) {
    throw new DomainConflictError(
      "observation_already_recorded",
      "Observation identity must be unique within an investigation",
    );
  }
  return advance(state, {
    observations: [
      ...state.observations,
      { ...command.observation, text: command.observation.text.trim() },
    ],
    timeline: [
      ...state.timeline,
      timelineEntry(state.timeline, {
        type: "observation_recorded",
        areaId: command.observation.areaId,
        observationId: command.observation.observationId,
        occurredAt: command.observation.recordedAt,
      }),
    ],
  });
}

export function pauseInvestigation(
  state: Investigation,
  command: { readonly expectedRevision: number; readonly pausedAt: string },
): Investigation {
  assertExpectedRevision(state, command.expectedRevision);
  if (state.status !== "active") {
    throw new DomainConflictError(
      "investigation_not_active",
      "Only an active investigation can be paused",
    );
  }
  return advance(state, {
    status: "paused",
    timeline: [
      ...state.timeline,
      timelineEntry(state.timeline, {
        type: "paused",
        areaId: state.currentAreaId,
        occurredAt: command.pausedAt,
      }),
    ],
  });
}

export function resumeInvestigation(
  state: Investigation,
  command: { readonly expectedRevision: number; readonly resumedAt: string },
): Investigation {
  assertExpectedRevision(state, command.expectedRevision);
  if (state.status !== "paused") {
    throw new DomainConflictError(
      "investigation_not_paused",
      "Only a paused investigation can be resumed",
    );
  }
  return advance(state, {
    status: "active",
    timeline: [
      ...state.timeline,
      timelineEntry(state.timeline, {
        type: "resumed",
        areaId: state.currentAreaId,
        occurredAt: command.resumedAt,
      }),
    ],
  });
}

export function finishInvestigation(
  state: Investigation,
  command: {
    readonly expectedRevision: number;
    readonly completedAt: string;
    readonly inspectorId: string;
    readonly draftingDisposition: InvestigationDraftingDisposition;
    readonly outcome: "finding_candidates" | "no_reportable_finding";
    readonly moduleLinks?: readonly InvestigationModuleLink[];
  },
): Investigation {
  assertWritable(state, command.expectedRevision);
  const moduleLinks = command.moduleLinks ?? [];
  if (command.outcome === "no_reportable_finding" && moduleLinks.length > 0) {
    throw new DomainConflictError(
      "no_finding_has_module_links",
      "A no-reportable-finding closure cannot also create finding candidates",
    );
  }
  if (command.outcome === "finding_candidates") {
    if (moduleLinks.length === 0) {
      throw new DomainConflictError(
        "finding_modules_required",
        "A finding-candidate closure must name at least one professional module",
      );
    }
    if (
      state.evidence.length === 0 &&
      state.measurements.length === 0 &&
      state.observations.length === 0
    ) {
      throw new DomainConflictError(
        "finding_has_no_source",
        "A finding candidate must retain at least one source artifact, measurement, or inspector observation",
      );
    }
  }
  validateModuleLinks(state, moduleLinks);
  return advance(state, {
    status:
      command.outcome === "finding_candidates"
        ? "completed_findings"
        : "completed_no_reportable_finding",
    completion: {
      completedAt: command.completedAt,
      completedByInspectorId: command.inspectorId,
      draftingDisposition: command.draftingDisposition,
      moduleLinks: [...moduleLinks],
      outcome: command.outcome,
    },
  });
}

export function orderedInvestigationEvidence(
  state: Investigation,
): readonly InvestigationEvidence[] {
  return [...state.evidence].sort(compareEvidenceOrder);
}

function validateModuleLinks(
  state: Investigation,
  links: readonly InvestigationModuleLink[],
): void {
  const seenModules = new Set<ModuleType>();
  const evidenceIds = new Set(state.evidence.map((item) => item.artifactId));
  const observationIds = new Set(
    state.observations.map((item) => item.observationId),
  );
  for (const link of links) {
    if (
      !state.commissionedModules.some(
        (reference) =>
          reference.module === link.module &&
          reference.moduleId === link.moduleId,
      )
    ) {
      throw new DomainConflictError(
        "module_not_commissioned",
        "An investigation cannot create a finding for an uncommissioned module",
        { module: link.module },
      );
    }
    if (seenModules.has(link.module)) {
      throw new DomainConflictError(
        "duplicate_module_link",
        "An investigation closure may create at most one candidate per professional module",
      );
    }
    seenModules.add(link.module);
    if (link.sourceArtifactIds.length === 0) {
      throw new DomainConflictError(
        "finding_artifact_required",
        "A finding candidate must select at least one source artifact",
      );
    }
    if (
      new Set(link.sourceArtifactIds).size !== link.sourceArtifactIds.length
    ) {
      throw new DomainConflictError(
        "duplicate_finding_source",
        "A finding candidate cannot repeat a source artifact",
      );
    }
    for (const artifactId of link.sourceArtifactIds) {
      if (!evidenceIds.has(artifactId)) {
        throw new DomainConflictError(
          "finding_source_not_attached",
          "A finding candidate can reference only evidence attached to its investigation",
          { artifactId },
        );
      }
    }
    if (link.sourceObservationIds.length === 0) {
      throw new DomainConflictError(
        "finding_observation_required",
        "A finding candidate must select at least one source observation",
      );
    }
    if (
      new Set(link.sourceObservationIds).size !==
      link.sourceObservationIds.length
    ) {
      throw new DomainConflictError(
        "duplicate_finding_observation",
        "A finding candidate cannot repeat a source observation",
      );
    }
    for (const observationId of link.sourceObservationIds) {
      if (!observationIds.has(observationId)) {
        throw new DomainConflictError(
          "finding_observation_not_attached",
          "A finding candidate can reference only observations recorded in its investigation",
          { observationId },
        );
      }
    }
  }
}

function assertWritable(state: Investigation, expectedRevision: number): void {
  assertExpectedRevision(state, expectedRevision);
  if (state.status !== "active") {
    throw new DomainConflictError(
      "investigation_not_writable",
      `A ${state.status} investigation cannot accept this change`,
    );
  }
}

function assertExpectedRevision(
  state: Investigation,
  expectedRevision: number,
): void {
  if (state.revision !== expectedRevision) {
    throw new DomainConflictError(
      "revision_conflict",
      "Investigation changed on another screen or device; refresh and compare before retrying",
      { expectedRevision, currentRevision: state.revision },
    );
  }
}

type InvestigationAdvance = Partial<
  Pick<
    Investigation,
    | "areaVisits"
    | "completion"
    | "currentAreaId"
    | "evidence"
    | "measurements"
    | "observations"
    | "status"
    | "timeline"
  >
>;

function advance(
  state: Investigation,
  patch: InvestigationAdvance,
): Investigation {
  return freezeInvestigation({
    ...state,
    ...patch,
    revision: state.revision + 1,
  });
}

function freezeInvestigation(state: Investigation): Investigation {
  return deepFreeze(state);
}

type TimelineInput =
  | Omit<
      Extract<InvestigationTimelineEntry, { type: "area_entered" }>,
      "ordinal"
    >
  | Omit<
      Extract<InvestigationTimelineEntry, { type: "evidence_linked" }>,
      "ordinal"
    >
  | Omit<
      Extract<InvestigationTimelineEntry, { type: "measurement_recorded" }>,
      "ordinal"
    >
  | Omit<
      Extract<InvestigationTimelineEntry, { type: "observation_recorded" }>,
      "ordinal"
    >
  | Omit<
      Extract<InvestigationTimelineEntry, { type: "paused" | "resumed" }>,
      "ordinal"
    >;

function timelineEntry(
  timeline: readonly InvestigationTimelineEntry[],
  input: TimelineInput,
): InvestigationTimelineEntry {
  return {
    ...input,
    ordinal: timeline.length + 1,
  };
}

function compareCaptureOrder(
  a: EvidenceAttachmentInput,
  b: EvidenceAttachmentInput,
): number {
  return (
    a.capturedAt.localeCompare(b.capturedAt) ||
    a.captureSequence - b.captureSequence ||
    a.artifactId.localeCompare(b.artifactId)
  );
}

function compareEvidenceOrder(
  a: InvestigationEvidence,
  b: InvestigationEvidence,
): number {
  return (
    a.capturedAt.localeCompare(b.capturedAt) ||
    a.captureSequence - b.captureSequence ||
    a.linkOrdinal - b.linkOrdinal
  );
}
