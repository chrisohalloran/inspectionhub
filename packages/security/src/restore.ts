export const RESTORE_CHECK_NAMES = [
  "artifact_checksums",
  "event_replay",
  "recipient_grants",
  "deletion_suppressions",
  "session_revocations",
  "package_pointers",
  "provider_truth",
  "secret_environment",
] as const;

export type RestoreCheckName = (typeof RESTORE_CHECK_NAMES)[number];
export type RestoreEnvironment =
  "development" | "test" | "preview" | "production";

export type RestoreEgressProjection = {
  readonly source: "postgres_restore_egress_state_v2";
  readonly organizationId: string;
  readonly restoreSessionId: string;
  readonly environment: RestoreEnvironment;
  readonly restoreGeneration: number;
  readonly verificationRun: number;
  readonly state: "blocked" | "enabled";
  readonly eventVersion: number;
  readonly eventId: string | null;
  readonly checkedEvidence: readonly {
    readonly name: RestoreCheckName;
    readonly evidenceHash: string;
  }[];
  readonly projectionHash: string;
};

export type RestoreEgressExpectation = Readonly<{
  organizationId: string;
  restoreSessionId: string;
  environment: RestoreEnvironment;
  projectionHash: string;
}>;

export type RestoreEgressScope = Omit<
  RestoreEgressExpectation,
  "projectionHash"
>;

export type TrustedRestoreProjection = Readonly<{
  projection: RestoreEgressProjection | null;
  /** Obtained from the trusted database RPC result, never from request input. */
  trustedProjectionHash: string;
}>;

export interface RestoreEgressProjectionReader {
  read(scope: RestoreEgressScope): Promise<TrustedRestoreProjection>;
}

export interface ExternalEgressGuard {
  requireEgress(
    input: Readonly<{
      organizationId: string;
      boundary:
        | "delivery_provider"
        | "notification_provider"
        | "calendar_provider"
        | "payment_provider"
        | "model_provider"
        | "recipient_access"
        | "worker_dispatch"
        | "callback";
    }>,
  ): Promise<void>;
}

/**
 * Guard used only inside an isolated restored runtime. The resolver must return
 * the coordinator-owned active generation for the requested tenant. Postgres
 * independently rejects an old generation, while this boundary binds the exact
 * tenant/session/environment and trusted projection hash before any adapter runs.
 */
export class RestoreRuntimeEgressGuard implements ExternalEgressGuard {
  constructor(
    private readonly reader: RestoreEgressProjectionReader,
    private readonly resolveActiveScope: (
      organizationId: string,
    ) => RestoreEgressScope | null,
  ) {}

  async requireEgress(
    input: Readonly<{
      organizationId: string;
      boundary:
        | "delivery_provider"
        | "notification_provider"
        | "calendar_provider"
        | "payment_provider"
        | "model_provider"
        | "recipient_access"
        | "worker_dispatch"
        | "callback";
    }>,
  ): Promise<void> {
    const scope = this.resolveActiveScope(input.organizationId);
    if (scope === null || scope.organizationId !== input.organizationId) {
      throw new Error(
        "Restored runtime egress has no active tenant generation",
      );
    }
    const trusted = await this.reader.read(scope);
    requireRestoreEgressEnabled(trusted.projection, {
      ...scope,
      projectionHash: trusted.trustedProjectionHash,
    });
  }
}

/**
 * Normal (non-restore) deployments must opt in explicitly. There is no default
 * allow guard, preventing a missing restore configuration from becoming egress.
 */
export function createNormalRuntimeEgressGuard(
  runtimeKind: "normal",
): ExternalEgressGuard {
  if (runtimeKind !== "normal") {
    throw new Error("Only an explicit normal runtime may construct this guard");
  }
  return Object.freeze({
    async requireEgress(): Promise<void> {
      await Promise.resolve();
    },
  });
}

export function isRestoreEgressEnabled(
  projection: RestoreEgressProjection | null,
  expected: RestoreEgressExpectation,
): boolean {
  if (projection === null || projection.state !== "enabled") return false;
  if (
    projection.source !== "postgres_restore_egress_state_v2" ||
    projection.organizationId !== expected.organizationId ||
    projection.restoreSessionId !== expected.restoreSessionId ||
    projection.environment !== expected.environment ||
    !Number.isInteger(projection.restoreGeneration) ||
    projection.restoreGeneration < 1 ||
    !Number.isInteger(projection.verificationRun) ||
    projection.verificationRun < 1 ||
    !Number.isInteger(projection.eventVersion) ||
    projection.eventVersion < 1 ||
    projection.eventId === null ||
    !UUID_PATTERN.test(projection.eventId) ||
    !constantTimeEqualSha256(projection.projectionHash, expected.projectionHash)
  ) {
    return false;
  }
  const checks = new Map(
    projection.checkedEvidence.map((check) => [check.name, check.evidenceHash]),
  );
  return (
    checks.size === RESTORE_CHECK_NAMES.length &&
    projection.checkedEvidence.length === RESTORE_CHECK_NAMES.length &&
    RESTORE_CHECK_NAMES.every((name) =>
      SHA256_PATTERN.test(checks.get(name) ?? ""),
    )
  );
}

export function requireRestoreEgressEnabled(
  projection: RestoreEgressProjection | null,
  expected: RestoreEgressExpectation,
): asserts projection is RestoreEgressProjection {
  if (!isRestoreEgressEnabled(projection, expected)) {
    throw new Error(
      "Restore egress stays disabled until the exact active generation has a trusted reconciled enable projection",
    );
  }
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Fixed-length comparison avoids content-dependent early return for digests. */
export function constantTimeEqualSha256(left: string, right: string): boolean {
  const leftValid = SHA256_PATTERN.test(left);
  const rightValid = SHA256_PATTERN.test(right);
  let difference = left.length ^ right.length;
  for (let index = 0; index < 64; index += 1) {
    difference |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return leftValid && rightValid && difference === 0;
}
