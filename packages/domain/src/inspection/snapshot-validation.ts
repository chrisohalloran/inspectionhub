import { deepFreeze } from "../freeze.js";
import { investigationMeasurementValidationError } from "./investigation.js";
import type {
  CoverageEntry,
  CoverageLedger,
  CoverageLimitation,
  CoverageRevisitItem,
  Investigation,
  InvestigationAreaVisit,
  InvestigationCompletion,
  InvestigationEvidence,
  InvestigationMeasurement,
  InvestigationObservation,
  InvestigationTimelineEntry,
  ProfessionalModuleReference,
} from "./types.js";

const modules = new Set(["building", "timber_pest"]);
const coverageStates = new Set([
  "access_limited",
  "inaccessible",
  "inspected",
  "not_applicable",
  "revisit",
]);

export function parseCoverageLedgerSnapshot(value: unknown): CoverageLedger {
  const record = asRecord(value);
  const commissionedModules = asArray(record?.commissionedModules);
  const areas = asArray(record?.areas);
  const entries = asArray(record?.entries);
  const limitations = asArray(record?.limitations);
  const revisitItems = asArray(record?.revisitItems);
  if (
    record === null ||
    !isText(record.organizationId) ||
    !isText(record.jobId) ||
    !isNonNegativeInteger(record.revision) ||
    commissionedModules === null ||
    commissionedModules.length === 0 ||
    !commissionedModules.every(isModuleReference) ||
    areas === null ||
    areas.length === 0 ||
    !areas.every(isInspectionArea) ||
    entries === null ||
    !entries.every(isCoverageEntry) ||
    limitations === null ||
    !limitations.every(isCoverageLimitation) ||
    revisitItems === null ||
    !revisitItems.every(isCoverageRevisitItem)
  ) {
    throw new TypeError("Stored coverage snapshot is invalid");
  }
  const ledger = value as CoverageLedger;
  assertUniqueModules(ledger.commissionedModules);
  assertUnique(ledger.areas.map((area) => area.areaId));
  assertUnique(ledger.entries.map((entry) => entry.coverageEntryId));
  assertUnique(ledger.limitations.map((item) => item.limitationId));
  assertUnique(ledger.revisitItems.map((item) => item.revisitItemId));
  if (ledger.revision !== ledger.entries.length) {
    throw new TypeError("Stored coverage revision history is invalid");
  }
  const moduleByType = new Map(
    ledger.commissionedModules.map((reference) => [
      reference.module,
      reference,
    ]),
  );
  const areaById = new Map(ledger.areas.map((area) => [area.areaId, area]));
  for (const area of ledger.areas) {
    if (
      area.applicableModules.length === 0 ||
      new Set(area.applicableModules).size !== area.applicableModules.length ||
      area.applicableModules.some((module) => !moduleByType.has(module))
    ) {
      throw new TypeError("Stored coverage area modules are invalid");
    }
  }
  const entryHistory = new Map<string, CoverageEntry[]>();
  for (const entry of ledger.entries) {
    assertCoverageReference(
      areaById,
      moduleByType,
      entry.areaId,
      entry.module,
      entry.moduleId,
    );
    if (
      !areaById.get(entry.areaId)?.applicableModules.includes(entry.module) &&
      entry.state !== "not_applicable"
    ) {
      throw new TypeError("Stored coverage applicability is invalid");
    }
    if (
      ["access_limited", "inaccessible", "not_applicable", "revisit"].includes(
        entry.state,
      ) &&
      !isText(entry.detail)
    ) {
      throw new TypeError("Stored coverage detail is invalid");
    }
    const key = coverageKey(entry.areaId, entry.moduleId);
    const history = entryHistory.get(key) ?? [];
    history.push(entry);
    entryHistory.set(key, history);
  }
  for (const history of entryHistory.values()) {
    if (history.some((entry, index) => entry.revision !== index + 1)) {
      throw new TypeError("Stored coverage entry revisions are invalid");
    }
  }
  for (const limitation of ledger.limitations) {
    assertCoverageReference(
      areaById,
      moduleByType,
      limitation.areaId,
      limitation.module,
      limitation.moduleId,
    );
    if (
      !areaById
        .get(limitation.areaId)
        ?.applicableModules.includes(limitation.module) ||
      !entryHistory.has(coverageKey(limitation.areaId, limitation.moduleId))
    ) {
      throw new TypeError("Stored coverage limitation area is invalid");
    }
  }
  for (const item of ledger.revisitItems) {
    assertCoverageReference(
      areaById,
      moduleByType,
      item.areaId,
      item.module,
      item.moduleId,
    );
    if (
      !areaById.get(item.areaId)?.applicableModules.includes(item.module) ||
      !entryHistory.has(coverageKey(item.areaId, item.moduleId))
    ) {
      throw new TypeError("Stored coverage revisit area is invalid");
    }
  }
  for (const [key, history] of entryHistory) {
    const current = history.at(-1)!;
    const activeLimitations = ledger.limitations.filter(
      (item) =>
        coverageKey(item.areaId, item.moduleId) === key &&
        item.status === "active",
    );
    const openRevisits = ledger.revisitItems.filter(
      (item) =>
        coverageKey(item.areaId, item.moduleId) === key &&
        item.status === "open",
    );
    const limited =
      current.state === "access_limited" || current.state === "inaccessible";
    if (
      (limited && activeLimitations.length !== 1) ||
      (!limited && activeLimitations.length !== 0) ||
      (current.state === "revisit" && openRevisits.length !== 1) ||
      (current.state !== "revisit" && openRevisits.length !== 0)
    ) {
      throw new TypeError("Stored coverage limitation state is invalid");
    }
  }
  return deepFreeze(ledger);
}

export function parseInvestigationSnapshot(value: unknown): Investigation {
  const record = asRecord(value);
  const commissionedModules = asArray(record?.commissionedModules);
  const areaVisits = asArray(record?.areaVisits);
  const evidence = asArray(record?.evidence);
  const measurements = asArray(record?.measurements);
  const observations = asArray(record?.observations);
  const timeline = asArray(record?.timeline);
  if (
    record === null ||
    !isText(record.investigationId) ||
    !isText(record.organizationId) ||
    !isText(record.jobId) ||
    !isTimestamp(record.startedAt) ||
    !isText(record.startedByInspectorId) ||
    !isText(record.currentAreaId) ||
    ![
      "active",
      "paused",
      "completed_findings",
      "completed_no_reportable_finding",
    ].includes(String(record.status)) ||
    !isNonNegativeInteger(record.revision) ||
    commissionedModules === null ||
    commissionedModules.length === 0 ||
    !commissionedModules.every(isModuleReference) ||
    areaVisits === null ||
    areaVisits.length === 0 ||
    !areaVisits.every(isAreaVisit) ||
    evidence === null ||
    !evidence.every(isEvidence) ||
    measurements === null ||
    !measurements.every(isMeasurement) ||
    observations === null ||
    !observations.every(isObservation) ||
    timeline === null ||
    timeline.length === 0 ||
    !timeline.every(isTimelineEntry) ||
    !(
      record.completion === null || isInvestigationCompletion(record.completion)
    )
  ) {
    throw new TypeError("Stored investigation snapshot is invalid");
  }
  const investigation = value as Investigation;
  assertUniqueModules(investigation.commissionedModules);
  assertUnique(investigation.evidence.map((item) => item.artifactId));
  assertUnique(investigation.measurements.map((item) => item.measurementId));
  assertUnique(investigation.observations.map((item) => item.observationId));
  assertOrdinals(investigation.areaVisits.map((item) => item.ordinal));
  assertOrdinals(investigation.evidence.map((item) => item.linkOrdinal));
  assertOrdinals(investigation.timeline.map((item) => item.ordinal));
  if (investigation.currentAreaId !== investigation.areaVisits.at(-1)?.areaId) {
    throw new TypeError("Stored investigation current area is invalid");
  }
  for (const item of investigation.evidence) {
    if (
      item.areaAssignmentHistory.length === 0 ||
      item.currentAreaId !== item.areaAssignmentHistory.at(-1)?.areaId ||
      item.captureAreaId !== item.areaAssignmentHistory[0]?.areaId ||
      item.areaAssignmentHistory[0]?.reason !== "capture_context"
    ) {
      throw new TypeError("Stored investigation evidence history is invalid");
    }
  }
  const evidenceIds = new Set(
    investigation.evidence.map((item) => item.artifactId),
  );
  const measurementIds = new Set(
    investigation.measurements.map((item) => item.measurementId),
  );
  const observationIds = new Set(
    investigation.observations.map((item) => item.observationId),
  );
  for (const item of investigation.timeline) {
    if (
      (item.type === "evidence_linked" && !evidenceIds.has(item.artifactId)) ||
      (item.type === "measurement_recorded" &&
        !measurementIds.has(item.measurementId)) ||
      (item.type === "observation_recorded" &&
        !observationIds.has(item.observationId))
    ) {
      throw new TypeError("Stored investigation timeline reference is invalid");
    }
  }
  assertTimelineProjection(investigation);
  assertCompletion(investigation, evidenceIds);
  assertInvestigationRevisionFloor(investigation);
  return deepFreeze(investigation);
}

function assertInvestigationRevisionFloor(investigation: Investigation): void {
  const evidenceAttachmentCommands = new Set(
    investigation.evidence.map(
      (item) => `${item.attachedAt}\u0000${item.source}`,
    ),
  ).size;
  const evidenceAreaCorrections = investigation.evidence.reduce(
    (count, item) => count + Math.max(0, item.areaAssignmentHistory.length - 1),
    0,
  );
  const pauseResumeCommands = investigation.timeline.filter(
    (item) => item.type === "paused" || item.type === "resumed",
  ).length;
  const minimumRevision =
    Math.max(0, investigation.areaVisits.length - 1) +
    evidenceAttachmentCommands +
    evidenceAreaCorrections +
    investigation.measurements.length +
    investigation.observations.length +
    pauseResumeCommands +
    (investigation.completion === null ? 0 : 1);
  if (investigation.revision < minimumRevision) {
    throw new TypeError("Stored investigation revision history is invalid");
  }
}

function assertCompletion(
  investigation: Investigation,
  evidenceIds: ReadonlySet<string>,
): void {
  const open =
    investigation.status === "active" || investigation.status === "paused";
  if (open && investigation.completion !== null) {
    throw new TypeError("Open investigation cannot contain completion state");
  }
  if (!open && investigation.completion === null) {
    throw new TypeError("Completed investigation requires completion state");
  }
  const completion = investigation.completion;
  if (completion === null) return;
  const findingOutcome = completion.outcome === "finding_candidates";
  if (
    (findingOutcome &&
      (investigation.status !== "completed_findings" ||
        completion.moduleLinks.length === 0 ||
        completion.draftingDisposition !== "queue_ai_asynchronously" ||
        (investigation.evidence.length === 0 &&
          investigation.measurements.length === 0 &&
          investigation.observations.length === 0))) ||
    (!findingOutcome &&
      (investigation.status !== "completed_no_reportable_finding" ||
        completion.moduleLinks.length !== 0 ||
        completion.draftingDisposition !== "manual_only"))
  ) {
    throw new TypeError("Stored investigation completion outcome is invalid");
  }
  assertUnique(completion.moduleLinks.map((link) => link.findingCandidateId));
  assertUnique(completion.moduleLinks.map((link) => link.module));
  for (const link of completion.moduleLinks) {
    const reference = investigation.commissionedModules.find(
      (item) => item.module === link.module,
    );
    if (
      reference?.moduleId !== link.moduleId ||
      new Set(link.sourceArtifactIds).size !== link.sourceArtifactIds.length ||
      link.sourceArtifactIds.some((artifactId) => !evidenceIds.has(artifactId))
    ) {
      throw new TypeError("Stored investigation module link is invalid");
    }
  }
}

function assertTimelineProjection(investigation: Investigation): void {
  const areaEntries = investigation.timeline.filter(
    (item) => item.type === "area_entered",
  );
  const evidenceEntries = investigation.timeline.filter(
    (item) => item.type === "evidence_linked",
  );
  const measurementEntries = investigation.timeline.filter(
    (item) => item.type === "measurement_recorded",
  );
  const observationEntries = investigation.timeline.filter(
    (item) => item.type === "observation_recorded",
  );
  if (
    areaEntries.length !== investigation.areaVisits.length ||
    evidenceEntries.length !== investigation.evidence.length ||
    measurementEntries.length !== investigation.measurements.length ||
    observationEntries.length !== investigation.observations.length ||
    investigation.areaVisits.some((visit, index) => {
      const entry = areaEntries[index];
      return (
        entry?.areaId !== visit.areaId || entry.occurredAt !== visit.enteredAt
      );
    }) ||
    investigation.evidence.some((evidence) =>
      evidenceEntries.every(
        (entry) =>
          entry.artifactId !== evidence.artifactId ||
          entry.areaId !== evidence.captureAreaId ||
          entry.occurredAt !== evidence.attachedAt,
      ),
    ) ||
    investigation.measurements.some((measurement) =>
      measurementEntries.every(
        (entry) =>
          entry.measurementId !== measurement.measurementId ||
          entry.areaId !== measurement.areaId ||
          entry.occurredAt !== measurement.measuredAt,
      ),
    ) ||
    investigation.observations.some((observation) =>
      observationEntries.every(
        (entry) =>
          entry.observationId !== observation.observationId ||
          entry.areaId !== observation.areaId ||
          entry.occurredAt !== observation.recordedAt,
      ),
    )
  ) {
    throw new TypeError("Stored investigation timeline projection is invalid");
  }
}

function assertCoverageReference(
  areas: ReadonlyMap<string, CoverageLedger["areas"][number]>,
  moduleByType: ReadonlyMap<
    ProfessionalModuleReference["module"],
    ProfessionalModuleReference
  >,
  areaId: string,
  module: ProfessionalModuleReference["module"],
  moduleId: string,
): void {
  const area = areas.get(areaId);
  const reference = moduleByType.get(module);
  if (area === undefined || reference?.moduleId !== moduleId) {
    throw new TypeError("Stored coverage reference is invalid");
  }
}

function assertUniqueModules(
  references: readonly ProfessionalModuleReference[],
): void {
  assertUnique(references.map((item) => item.module));
  assertUnique(references.map((item) => item.moduleId));
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError("Stored aggregate identities are not unique");
  }
}

function assertOrdinals(values: readonly number[]): void {
  if (values.some((value, index) => value !== index + 1)) {
    throw new TypeError("Stored aggregate ordinals are invalid");
  }
}

function coverageKey(areaId: string, moduleId: string): string {
  return JSON.stringify([areaId, moduleId]);
}

function isModuleReference(
  value: unknown,
): value is ProfessionalModuleReference {
  const record = asRecord(value);
  return (
    record !== null &&
    modules.has(String(record.module)) &&
    isText(record.moduleId)
  );
}

function isInspectionArea(
  value: unknown,
): value is CoverageLedger["areas"][number] {
  const record = asRecord(value);
  const applicableModules = asArray(record?.applicableModules);
  return (
    record !== null &&
    isText(record.areaId) &&
    isText(record.label) &&
    applicableModules !== null &&
    applicableModules.every((module) => modules.has(String(module)))
  );
}

function isCoverageEntry(value: unknown): value is CoverageEntry {
  const record = asRecord(value);
  return (
    record !== null &&
    isText(record.areaId) &&
    isText(record.coverageEntryId) &&
    modules.has(String(record.module)) &&
    isText(record.moduleId) &&
    coverageStates.has(String(record.state)) &&
    (record.detail === null || isText(record.detail)) &&
    isTimestamp(record.recordedAt) &&
    isText(record.recordedByInspectorId) &&
    isPositiveInteger(record.revision)
  );
}

function isCoverageLimitation(value: unknown): value is CoverageLimitation {
  const record = asRecord(value);
  return (
    record !== null &&
    isText(record.areaId) &&
    isText(record.limitationId) &&
    modules.has(String(record.module)) &&
    isText(record.moduleId) &&
    isText(record.description) &&
    typeof record.material === "boolean" &&
    isTimestamp(record.recordedAt) &&
    ["active", "superseded"].includes(String(record.status)) &&
    ((record.status === "active" && record.supersededAt === null) ||
      (record.status === "superseded" && isTimestamp(record.supersededAt)))
  );
}

function isCoverageRevisitItem(value: unknown): value is CoverageRevisitItem {
  const record = asRecord(value);
  return (
    record !== null &&
    isText(record.areaId) &&
    modules.has(String(record.module)) &&
    isText(record.moduleId) &&
    isText(record.reason) &&
    isText(record.revisitItemId) &&
    isTimestamp(record.openedAt) &&
    ["open", "resolved"].includes(String(record.status)) &&
    ((record.status === "open" && record.resolvedAt === null) ||
      (record.status === "resolved" && isTimestamp(record.resolvedAt)))
  );
}

function isAreaVisit(value: unknown): value is InvestigationAreaVisit {
  const record = asRecord(value);
  return (
    record !== null &&
    isText(record.areaId) &&
    isTimestamp(record.enteredAt) &&
    isPositiveInteger(record.ordinal)
  );
}

function isEvidence(value: unknown): value is InvestigationEvidence {
  const record = asRecord(value);
  const history = asArray(record?.areaAssignmentHistory);
  return (
    record !== null &&
    isText(record.artifactId) &&
    ["manual_note", "photo", "voice_note"].includes(
      String(record.artifactKind),
    ) &&
    isText(record.captureAreaId) &&
    isTimestamp(record.capturedAt) &&
    isNonNegativeInteger(record.captureSequence) &&
    isText(record.currentAreaId) &&
    history !== null &&
    history.every((change) => {
      const item = asRecord(change);
      return (
        item !== null &&
        isText(item.areaId) &&
        isTimestamp(item.assignedAt) &&
        isText(item.assignedByInspectorId) &&
        ["capture_context", "inspector_correction"].includes(
          String(item.reason),
        )
      );
    }) &&
    isTimestamp(record.attachedAt) &&
    isText(record.attachedByInspectorId) &&
    isPositiveInteger(record.linkOrdinal) &&
    ["attached_recent", "captured_during_investigation"].includes(
      String(record.source),
    )
  );
}

function isMeasurement(value: unknown): value is InvestigationMeasurement {
  const record = asRecord(value);
  if (
    record === null ||
    !isText(record.areaId) ||
    !isTimestamp(record.measuredAt) ||
    !isText(record.measuredByInspectorId) ||
    !isText(record.measurementId) ||
    ![
      "crack_width",
      "length",
      "level_variation",
      "moisture_reading",
      "other",
    ].includes(String(record.kind)) ||
    typeof record.value !== "number" ||
    !["millimetres", "percent", "relative_scale", "metres", "other"].includes(
      String(record.unit),
    ) ||
    !(record.note === null || isText(record.note))
  ) {
    return false;
  }
  return (
    investigationMeasurementValidationError(
      value as InvestigationMeasurement,
    ) === null
  );
}

function isObservation(value: unknown): value is InvestigationObservation {
  const record = asRecord(value);
  return (
    record !== null &&
    isText(record.areaId) &&
    isText(record.observationId) &&
    isTimestamp(record.recordedAt) &&
    isText(record.recordedByInspectorId) &&
    isText(record.text)
  );
}

function isTimelineEntry(value: unknown): value is InvestigationTimelineEntry {
  const record = asRecord(value);
  if (
    record === null ||
    ![
      "area_entered",
      "evidence_linked",
      "measurement_recorded",
      "observation_recorded",
      "paused",
      "resumed",
    ].includes(String(record.type)) ||
    !isPositiveInteger(record.ordinal) ||
    !isTimestamp(record.occurredAt) ||
    !isText(record.areaId)
  ) {
    return false;
  }
  if (record.type === "evidence_linked") return isText(record.artifactId);
  if (record.type === "measurement_recorded")
    return isText(record.measurementId);
  if (record.type === "observation_recorded")
    return isText(record.observationId);
  return true;
}

function isInvestigationCompletion(
  value: unknown,
): value is InvestigationCompletion {
  const record = asRecord(value);
  const moduleLinks = asArray(record?.moduleLinks);
  return (
    record !== null &&
    isTimestamp(record.completedAt) &&
    isText(record.completedByInspectorId) &&
    ["manual_only", "queue_ai_asynchronously"].includes(
      String(record.draftingDisposition),
    ) &&
    moduleLinks !== null &&
    moduleLinks.every((link) => {
      const item = asRecord(link);
      const sourceArtifactIds = asArray(item?.sourceArtifactIds);
      return (
        item !== null &&
        isText(item.findingCandidateId) &&
        modules.has(String(item.module)) &&
        isText(item.moduleId) &&
        sourceArtifactIds !== null &&
        sourceArtifactIds.every(isText)
      );
    }) &&
    ["finding_candidates", "no_reportable_finding"].includes(
      String(record.outcome),
    )
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? (value as readonly unknown[]) : null;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTimestamp(value: unknown): value is string {
  return isText(value) && Number.isFinite(Date.parse(value));
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
