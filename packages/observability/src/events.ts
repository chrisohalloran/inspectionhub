import {
  assertTelemetryContainsNoSensitivePayload,
  type RedactedValue,
} from "@inspection/security";

export type OperationalCategory =
  | "agent"
  | "task"
  | "provider"
  | "delivery"
  | "access"
  | "device"
  | "lifecycle"
  | "restore";

export type OperationalState =
  | "queued"
  | "running"
  | "retry_wait"
  | "unknown"
  | "failed"
  | "succeeded"
  | "revoked"
  | "blocked"
  | "reconciled";

export type SafeOperationalEvent = {
  readonly eventId: string;
  readonly category: OperationalCategory;
  readonly state: OperationalState;
  readonly aggregateIdHash: string;
  readonly organizationHash: string;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly safeMetadata: Readonly<Record<string, RedactedValue>>;
};

const SAFE_METADATA_KEYS = new Set([
  "attempt",
  "count",
  "durationMs",
  "errorCode",
  "fencingGeneration",
  "provider",
  "queue",
  "reasonCode",
  "revision",
  "taskType",
  "verifierVersion",
]);

const NUMERIC_METADATA_KEYS = new Set([
  "attempt",
  "count",
  "durationMs",
  "fencingGeneration",
  "revision",
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH_METADATA_KEYS = new Set(["errorCode", "reasonCode"]);
const CODE_METADATA_VALUES: Readonly<Record<string, ReadonlySet<string>>> = {
  provider: new Set([
    "fake",
    "google_calendar",
    "internal",
    "openai",
    "resend",
    "stripe",
    "test",
  ]),
  queue: new Set([
    "agent",
    "delivery",
    "evidence",
    "outbox",
    "provider_reconciliation",
    "sync",
  ]),
  taskType: new Set([
    "agent_draft",
    "delivery_dispatch",
    "evidence_durability",
    "provider_reconciliation",
    "report_render",
    "transcription",
  ]),
  verifierVersion: new Set([
    "deterministic_v1",
    "restore_sql_v1",
    "source_grounding_v1",
  ]),
};
const CATEGORIES = new Set<OperationalCategory>([
  "agent",
  "task",
  "provider",
  "delivery",
  "access",
  "device",
  "lifecycle",
  "restore",
]);
const STATES = new Set<OperationalState>([
  "queued",
  "running",
  "retry_wait",
  "unknown",
  "failed",
  "succeeded",
  "revoked",
  "blocked",
  "reconciled",
]);

export class SafeTelemetryRecorder {
  readonly #events: SafeOperationalEvent[] = [];

  record(
    input: Omit<SafeOperationalEvent, "safeMetadata"> & {
      readonly metadata?: Readonly<Record<string, unknown>>;
    },
  ): SafeOperationalEvent {
    requireOpaqueIdentifier(input.eventId, "eventId");
    requireOpaqueIdentifier(input.correlationId, "correlationId");
    requireDigest(input.aggregateIdHash, "aggregateIdHash");
    requireDigest(input.organizationHash, "organizationHash");
    requireTimestamp(input.occurredAt, "occurredAt");
    if (!CATEGORIES.has(input.category) || !STATES.has(input.state)) {
      throw new Error(
        "Operational event category and state must be allowlisted",
      );
    }
    const safeMetadata = Object.fromEntries(
      Object.entries(input.metadata ?? {})
        .filter(([key]) => SAFE_METADATA_KEYS.has(key))
        .map(([key, value]) => [key, requireSafeMetadataValue(key, value)]),
    );
    const event = Object.freeze({
      eventId: input.eventId,
      category: input.category,
      state: input.state,
      aggregateIdHash: input.aggregateIdHash,
      organizationHash: input.organizationHash,
      correlationId: input.correlationId,
      occurredAt: input.occurredAt,
      safeMetadata: Object.freeze(safeMetadata),
    });
    assertTelemetryContainsNoSensitivePayload(event);
    this.#events.push(event);
    return event;
  }

  read(): readonly SafeOperationalEvent[] {
    return Object.freeze([...this.#events]);
  }
}

function requireDigest(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a one-way SHA-256 digest`);
  }
}

function requireOpaqueIdentifier(value: string, label: string): void {
  if (!UUID_PATTERN.test(value) && !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a UUID or one-way SHA-256 digest`);
  }
}

function requireTimestamp(value: string, label: string): void {
  if (value.length > 64 || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a valid bounded date-time`);
  }
}

function requireSafeMetadataValue(key: string, value: unknown): RedactedValue {
  if (NUMERIC_METADATA_KEYS.has(key)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`${key} telemetry must be a finite non-negative number`);
    }
    return value;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} telemetry must be a safe string code`);
  }
  if (HASH_METADATA_KEYS.has(key)) {
    if (!SHA256_PATTERN.test(value)) {
      throw new Error(`${key} telemetry must be a one-way SHA-256 digest`);
    }
    return value;
  }
  if (!CODE_METADATA_VALUES[key]?.has(value)) {
    throw new Error(`${key} telemetry must use a fixed allowlisted code`);
  }
  return value;
}
