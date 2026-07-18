import {
  parseCoverageLedgerSnapshot,
  parseInvestigationSnapshot,
  type CoverageLedger,
  type Investigation,
} from "@inspection/domain/inspection/mobile";

export type LocalInspectionAggregate = CoverageLedger | Investigation;
export type LocalInspectionAggregateKind = "coverage" | "investigation";

export type LocalInspectionSnapshotRecord = {
  readonly aggregateId: string;
  readonly aggregateKind: LocalInspectionAggregateKind;
  readonly aggregateRevision: number;
  readonly jobId: string | null;
  readonly schemaVersion: 1;
  readonly snapshotJson: string;
  readonly snapshotSha256: string;
  readonly updatedAt: string;
};

export type LocalInspectionEventRecord = {
  readonly aggregateId: string;
  readonly aggregateKind: LocalInspectionAggregateKind;
  readonly aggregateRevision: number;
  readonly eventId: string;
  readonly eventType:
    | "area.coverage_initialized"
    | "area.coverage_recorded"
    | "investigation.area_changed"
    | "investigation.completed"
    | "investigation.evidence_attached"
    | "investigation.evidence_area_reassigned"
    | "investigation.measurement_recorded"
    | "investigation.observation_recorded"
    | "investigation.paused"
    | "investigation.resumed"
    | "investigation.started";
  readonly occurredAt: string;
  readonly safeMetadataJson: string;
  readonly snapshotSha256: string;
};

export interface LocalInspectionSnapshotPort {
  listSnapshotsForJob(
    aggregateKind: LocalInspectionAggregateKind,
    jobId: string,
  ): Promise<readonly LocalInspectionSnapshotRecord[]>;
  readSnapshot(
    aggregateKind: LocalInspectionAggregateKind,
    aggregateId: string,
  ): Promise<LocalInspectionSnapshotRecord | null>;
  readEventHistory(
    aggregateKind: LocalInspectionAggregateKind,
    aggregateId: string,
  ): Promise<
    readonly Readonly<{
      aggregateRevision: number;
      snapshotSha256: string;
    }>[]
  >;
  compareAndSet(input: {
    readonly expectedStoredRevision: number | null;
    readonly snapshot: LocalInspectionSnapshotRecord;
    readonly event: LocalInspectionEventRecord;
  }): Promise<"saved" | "revision_conflict">;
}

export interface LocalInspectionDigestPort {
  sha256(value: string): Promise<string>;
}

export type LocalInspectionRepository = ReturnType<
  typeof createLocalInspectionRepository
>;

export class LocalInspectionCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalInspectionCorruptionError";
  }
}

export class LocalInspectionRevisionConflictError extends Error {
  constructor() {
    super("Local inspection state changed; reload and compare before retrying");
    this.name = "LocalInspectionRevisionConflictError";
  }
}

export function createLocalInspectionRepository(dependencies: {
  readonly digest: LocalInspectionDigestPort;
  readonly storage: LocalInspectionSnapshotPort;
}) {
  return {
    async findOpenInvestigationForJob(
      jobId: string,
    ): Promise<Investigation | null> {
      const records = await dependencies.storage.listSnapshotsForJob(
        "investigation",
        jobId,
      );
      const open: Investigation[] = [];
      for (const record of records) {
        const investigation = await loadCheckedSnapshot<Investigation>(
          record,
          dependencies.digest,
          { aggregateId: record.aggregateId, kind: "investigation" },
          dependencies.storage,
        );
        if (
          investigation.jobId === jobId &&
          (investigation.status === "active" ||
            investigation.status === "paused")
        ) {
          open.push(investigation);
        }
      }
      if (open.length > 1) {
        throw new LocalInspectionCorruptionError(
          "Multiple open investigations exist for the assigned job",
        );
      }
      return open[0] ?? null;
    },
    async loadInvestigation(
      investigationId: string,
    ): Promise<Investigation | null> {
      const record = await dependencies.storage.readSnapshot(
        "investigation",
        investigationId,
      );
      return record === null
        ? null
        : loadCheckedSnapshot<Investigation>(
            record,
            dependencies.digest,
            {
              aggregateId: investigationId,
              kind: "investigation",
            },
            dependencies.storage,
          );
    },
    async loadCoverage(jobId: string): Promise<CoverageLedger | null> {
      const record = await dependencies.storage.readSnapshot("coverage", jobId);
      return record === null
        ? null
        : loadCheckedSnapshot<CoverageLedger>(
            record,
            dependencies.digest,
            { aggregateId: jobId, kind: "coverage" },
            dependencies.storage,
          );
    },
    async saveInvestigation(input: {
      readonly investigation: Investigation;
      readonly expectedStoredRevision: number | null;
      readonly event: Omit<
        LocalInspectionEventRecord,
        "aggregateId" | "aggregateKind" | "aggregateRevision" | "snapshotSha256"
      >;
      readonly updatedAt: string;
    }): Promise<void> {
      await saveAggregate(dependencies, {
        aggregate: input.investigation,
        aggregateId: input.investigation.investigationId,
        aggregateKind: "investigation",
        expectedStoredRevision: input.expectedStoredRevision,
        event: input.event,
        updatedAt: input.updatedAt,
      });
    },
    async saveCoverage(input: {
      readonly coverage: CoverageLedger;
      readonly expectedStoredRevision: number | null;
      readonly event: Omit<
        LocalInspectionEventRecord,
        "aggregateId" | "aggregateKind" | "aggregateRevision" | "snapshotSha256"
      >;
      readonly updatedAt: string;
    }): Promise<void> {
      await saveAggregate(dependencies, {
        aggregate: input.coverage,
        aggregateId: input.coverage.jobId,
        aggregateKind: "coverage",
        expectedStoredRevision: input.expectedStoredRevision,
        event: input.event,
        updatedAt: input.updatedAt,
      });
    },
  };
}

async function saveAggregate(
  dependencies: {
    readonly digest: LocalInspectionDigestPort;
    readonly storage: LocalInspectionSnapshotPort;
  },
  input: {
    readonly aggregate: LocalInspectionAggregate;
    readonly aggregateId: string;
    readonly aggregateKind: LocalInspectionAggregateKind;
    readonly expectedStoredRevision: number | null;
    readonly event: Omit<
      LocalInspectionEventRecord,
      "aggregateId" | "aggregateKind" | "aggregateRevision" | "snapshotSha256"
    >;
    readonly updatedAt: string;
  },
): Promise<void> {
  const requiredRevision =
    input.expectedStoredRevision === null
      ? 0
      : input.expectedStoredRevision + 1;
  if (input.aggregate.revision !== requiredRevision) {
    throw new LocalInspectionRevisionConflictError();
  }
  assertSafeMetadata(input.event.eventType, input.event.safeMetadataJson);
  const snapshotJson = JSON.stringify(input.aggregate);
  const snapshotSha256 = await dependencies.digest.sha256(snapshotJson);
  const snapshot: LocalInspectionSnapshotRecord = {
    aggregateId: input.aggregateId,
    aggregateKind: input.aggregateKind,
    aggregateRevision: input.aggregate.revision,
    jobId: input.aggregate.jobId,
    schemaVersion: 1,
    snapshotJson,
    snapshotSha256,
    updatedAt: input.updatedAt,
  };
  const result = await dependencies.storage.compareAndSet({
    expectedStoredRevision: input.expectedStoredRevision,
    snapshot,
    event: {
      ...input.event,
      aggregateId: input.aggregateId,
      aggregateKind: input.aggregateKind,
      aggregateRevision: input.aggregate.revision,
      snapshotSha256,
    },
  });
  if (result === "revision_conflict") {
    throw new LocalInspectionRevisionConflictError();
  }
}

async function loadCheckedSnapshot<T extends LocalInspectionAggregate>(
  record: LocalInspectionSnapshotRecord,
  digest: LocalInspectionDigestPort,
  expected: {
    readonly aggregateId: string;
    readonly kind: LocalInspectionAggregateKind;
  },
  storage: LocalInspectionSnapshotPort,
): Promise<T> {
  if (
    record.schemaVersion !== 1 ||
    record.aggregateId !== expected.aggregateId ||
    record.aggregateKind !== expected.kind ||
    record.jobId === null
  ) {
    throw new LocalInspectionCorruptionError(
      "Local inspection snapshot identity or schema is invalid",
    );
  }
  const actualHash = await digest.sha256(record.snapshotJson);
  if (actualHash !== record.snapshotSha256) {
    throw new LocalInspectionCorruptionError(
      "Local inspection snapshot checksum does not match",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.snapshotJson) as unknown;
  } catch {
    throw new LocalInspectionCorruptionError(
      "Local inspection snapshot is not valid JSON",
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("revision" in parsed) ||
    parsed.revision !== record.aggregateRevision
  ) {
    throw new LocalInspectionCorruptionError(
      "Local inspection snapshot revision does not match its ledger record",
    );
  }
  const eventHistory = await storage.readEventHistory(
    expected.kind,
    expected.aggregateId,
  );
  if (
    eventHistory.length !== record.aggregateRevision + 1 ||
    eventHistory.some((event, index) => event.aggregateRevision !== index) ||
    eventHistory.at(-1)?.snapshotSha256 !== record.snapshotSha256
  ) {
    throw new LocalInspectionCorruptionError(
      "Local inspection event history does not match its snapshot revision",
    );
  }
  let aggregate: LocalInspectionAggregate;
  try {
    aggregate =
      expected.kind === "investigation"
        ? parseInvestigationSnapshot(parsed)
        : parseCoverageLedgerSnapshot(parsed);
  } catch {
    throw new LocalInspectionCorruptionError(
      "Local inspection snapshot does not match the required aggregate schema",
    );
  }
  const identityKey =
    expected.kind === "investigation" ? "investigationId" : "jobId";
  const parsedRecord = parsed as Record<string, unknown>;
  if (
    parsedRecord[identityKey] !== expected.aggregateId ||
    parsedRecord.jobId !== record.jobId
  ) {
    throw new LocalInspectionCorruptionError(
      "Local inspection snapshot payload identity does not match its ledger record",
    );
  }
  return aggregate as T;
}

function assertSafeMetadata(
  eventType: LocalInspectionEventRecord["eventType"],
  value: string,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new TypeError(
      "Local inspection event safe metadata must be valid JSON",
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(
      "Local inspection event safe metadata must be an object",
    );
  }
  const allowedKeys = metadataKeysByEvent[eventType];
  for (const [key, item] of Object.entries(parsed)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(
        "Local inspection event metadata contains a non-allowlisted key",
      );
    }
    if (
      item !== null &&
      typeof item !== "string" &&
      typeof item !== "number" &&
      typeof item !== "boolean"
    ) {
      throw new TypeError(
        "Local inspection event metadata values must be primitive",
      );
    }
    if (
      (typeof item === "string" &&
        (item.length > 200 || /(?:file:|\/private\/|\\)/iu.test(item))) ||
      (typeof item === "number" && !Number.isFinite(item))
    ) {
      throw new TypeError("Local inspection event metadata value is unsafe");
    }
    if (!metadataValueAllowed(key, item)) {
      throw new TypeError(
        "Local inspection event metadata value is not allowed for its key",
      );
    }
  }
}

const metadataKeysByEvent: Readonly<
  Record<LocalInspectionEventRecord["eventType"], ReadonlySet<string>>
> = {
  "area.coverage_initialized": new Set(["status"]),
  "area.coverage_recorded": new Set(["areaId", "coverageState", "module"]),
  "investigation.area_changed": new Set(["areaId"]),
  "investigation.completed": new Set(["draftingDisposition", "outcome"]),
  "investigation.evidence_attached": new Set(["artifactCount", "source"]),
  "investigation.evidence_area_reassigned": new Set(["areaId", "status"]),
  "investigation.measurement_recorded": new Set(["areaId", "measurementKind"]),
  "investigation.observation_recorded": new Set(["areaId"]),
  "investigation.paused": new Set(["status"]),
  "investigation.resumed": new Set(["status"]),
  "investigation.started": new Set(["areaId", "status"]),
};

function metadataValueAllowed(key: string, value: unknown): boolean {
  if (key === "areaId" || key === "moduleId") {
    return (
      typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,199}$/iu.test(value)
    );
  }
  if (key === "artifactCount") {
    return (
      Number.isInteger(value) &&
      (value as number) >= 1 &&
      (value as number) <= 1000
    );
  }
  const allowed = metadataEnumValues[key];
  return (
    allowed !== undefined && typeof value === "string" && allowed.has(value)
  );
}

const metadataEnumValues: Readonly<Record<string, ReadonlySet<string>>> = {
  coverageState: new Set([
    "access_limited",
    "inaccessible",
    "inspected",
    "not_applicable",
    "revisit",
  ]),
  draftingDisposition: new Set(["manual_only", "queue_ai_asynchronously"]),
  measurementKind: new Set([
    "crack_width",
    "length",
    "level_variation",
    "moisture_reading",
    "other",
  ]),
  module: new Set(["building", "timber_pest"]),
  outcome: new Set(["finding_candidates", "no_reportable_finding"]),
  source: new Set(["attached_recent", "captured_during_investigation"]),
  status: new Set(["active", "initialized", "paused", "reassigned"]),
};
