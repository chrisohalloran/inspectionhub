import type { DeviceState } from "../capture/types";

export type FieldAccessContext = {
  cachedAssignedJobIds: readonly string[];
  deviceState: DeviceState;
  openJobId?: string;
  session: "expired" | "valid";
};

export type FieldOperation =
  | { jobId: string; kind: "capture_existing_job" }
  | { kind: "approve" | "deliver" | "open_new_job" | "package" | "sync" };

export type FieldAuthorisation =
  | {
      allowed: false;
      reason:
        | "device_lost"
        | "device_revoked"
        | "job_not_open_assignment"
        | "open_cached_job_only"
        | "session_refresh_required";
    }
  | { allowed: true; reason: "authenticated" | "cached_job_capture_only" };

export function authoriseFieldOperation(
  context: FieldAccessContext,
  operation: FieldOperation,
): FieldAuthorisation {
  if (context.deviceState !== "enrolled") {
    return {
      allowed: false,
      reason:
        context.deviceState === "revoked" ? "device_revoked" : "device_lost",
    };
  }

  if (context.session === "valid") {
    if (
      operation.kind === "capture_existing_job" &&
      (operation.jobId !== context.openJobId ||
        !context.cachedAssignedJobIds.includes(operation.jobId))
    ) {
      return { allowed: false, reason: "job_not_open_assignment" };
    }
    return { allowed: true, reason: "authenticated" };
  }

  if (operation.kind !== "capture_existing_job") {
    return { allowed: false, reason: "session_refresh_required" };
  }

  const isOpenCachedAssignment =
    operation.jobId === context.openJobId &&
    context.cachedAssignedJobIds.includes(operation.jobId);
  return isOpenCachedAssignment
    ? { allowed: true, reason: "cached_job_capture_only" }
    : { allowed: false, reason: "open_cached_job_only" };
}
