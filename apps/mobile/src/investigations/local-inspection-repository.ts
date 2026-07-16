import type {
  CoverageLedger,
  Investigation,
} from "@inspection/domain/inspection/mobile";

export type LocalInspectionAggregate = CoverageLedger | Investigation;
export type LocalInspectionAggregateKind = "coverage" | "investigation";

export type LocalInspectionSnapshotRecord = {
  readonly aggregateId: string;
  readonly aggregateKind: LocalInspectionAggregateKind;
  readonly aggregateRevision: number;
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
  readSnapshot(
    aggregateKind: LocalInspectionAggregateKind,
    aggregateId: string,
  ): Promise<LocalInspectionSnapshotRecord | null>;
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
    async loadInvestigation(
      investigationId: string,
    ): Promise<Investigation | null> {
      const record = await dependencies.storage.readSnapshot(
        "investigation",
        investigationId,
      );
      return record === null
        ? null
        : loadCheckedSnapshot<Investigation>(record, dependencies.digest, {
            aggregateId: investigationId,
            kind: "investigation",
          });
    },
    async loadCoverage(jobId: string): Promise<CoverageLedger | null> {
      const record = await dependencies.storage.readSnapshot("coverage", jobId);
      return record === null
        ? null
        : loadCheckedSnapshot<CoverageLedger>(record, dependencies.digest, {
            aggregateId: jobId,
            kind: "coverage",
          });
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
  assertSafeMetadata(input.event.safeMetadataJson);
  const snapshotJson = JSON.stringify(input.aggregate);
  const snapshotSha256 = await dependencies.digest.sha256(snapshotJson);
  const snapshot: LocalInspectionSnapshotRecord = {
    aggregateId: input.aggregateId,
    aggregateKind: input.aggregateKind,
    aggregateRevision: input.aggregate.revision,
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
): Promise<T> {
  if (
    record.schemaVersion !== 1 ||
    record.aggregateId !== expected.aggregateId ||
    record.aggregateKind !== expected.kind
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
  assertAggregateShape(parsed, expected.kind);
  const identityKey =
    expected.kind === "investigation" ? "investigationId" : "jobId";
  const parsedRecord = parsed as Record<string, unknown>;
  if (parsedRecord[identityKey] !== expected.aggregateId) {
    throw new LocalInspectionCorruptionError(
      "Local inspection snapshot payload identity does not match its ledger record",
    );
  }
  return parsed as T;
}

function assertAggregateShape(
  value: object,
  kind: LocalInspectionAggregateKind,
): void {
  const record = value as Record<string, unknown>;
  const requiredArrays =
    kind === "investigation"
      ? ["areaVisits", "evidence", "measurements", "observations", "timeline"]
      : ["areas", "entries", "limitations", "revisitItems"];
  if (
    typeof record.organizationId !== "string" ||
    typeof record.jobId !== "string" ||
    !Number.isInteger(record.revision) ||
    requiredArrays.some((key) => !Array.isArray(record[key]))
  ) {
    throw new LocalInspectionCorruptionError(
      "Local inspection snapshot does not match the required aggregate shape",
    );
  }
  if (
    kind === "investigation" &&
    ![
      "active",
      "paused",
      "completed_findings",
      "completed_no_reportable_finding",
    ].includes(String(record.status))
  ) {
    throw new LocalInspectionCorruptionError(
      "Local investigation snapshot has an invalid lifecycle state",
    );
  }
}

function assertSafeMetadata(value: string): void {
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
  const allowedKeys = new Set([
    "areaId",
    "artifactCount",
    "coverageState",
    "draftingDisposition",
    "measurementKind",
    "module",
    "moduleId",
    "outcome",
    "source",
    "status",
  ]);
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
  }
}
