import { describe, expect, it } from "vitest";

import { authoriseFieldOperation } from "./field-access.js";

describe("field access after session expiry and device revocation", () => {
  it("allows capture for the already-open cached assignment after session expiry", () => {
    const context = {
      cachedAssignedJobIds: ["job-open"],
      deviceState: "enrolled" as const,
      openJobId: "job-open",
      session: "expired" as const,
    };

    expect(
      authoriseFieldOperation(context, {
        jobId: "job-open",
        kind: "capture_existing_job",
      }),
    ).toEqual({ allowed: true, reason: "cached_job_capture_only" });
    expect(authoriseFieldOperation(context, { kind: "open_new_job" })).toEqual({
      allowed: false,
      reason: "session_refresh_required",
    });
    expect(authoriseFieldOperation(context, { kind: "sync" })).toEqual({
      allowed: false,
      reason: "session_refresh_required",
    });
    expect(authoriseFieldOperation(context, { kind: "approve" })).toEqual({
      allowed: false,
      reason: "session_refresh_required",
    });
  });

  it("does not extend expired capture authority to another cached or uncached job", () => {
    const context = {
      cachedAssignedJobIds: ["job-open", "job-other"],
      deviceState: "enrolled" as const,
      openJobId: "job-open",
      session: "expired" as const,
    };

    expect(
      authoriseFieldOperation(context, {
        jobId: "job-other",
        kind: "capture_existing_job",
      }),
    ).toEqual({ allowed: false, reason: "open_cached_job_only" });
  });

  it("blocks all server and capture operations once the device is revoked", () => {
    expect(
      authoriseFieldOperation(
        {
          cachedAssignedJobIds: ["job-open"],
          deviceState: "revoked",
          openJobId: "job-open",
          session: "valid",
        },
        { jobId: "job-open", kind: "capture_existing_job" },
      ),
    ).toEqual({ allowed: false, reason: "device_revoked" });
  });

  it("rejects wrong-job capture even while authenticated", () => {
    expect(
      authoriseFieldOperation(
        {
          cachedAssignedJobIds: ["job-open"],
          deviceState: "enrolled",
          openJobId: "job-open",
          session: "valid",
        },
        { jobId: "job-wrong", kind: "capture_existing_job" },
      ),
    ).toEqual({ allowed: false, reason: "job_not_open_assignment" });
  });
});
