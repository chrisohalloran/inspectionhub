import { describe, expect, it } from "vitest";

import {
  AuthorizationDeniedError,
  DurableRateLimiter,
  DualKeyRing,
  RestoreRuntimeEgressGuard,
  assertTelemetryContainsNoSensitivePayload,
  authorizePrivilegedAction,
  authorizeReportCapability,
  buildSecurityHeaders,
  constantTimeEqualSha256,
  encodeHtmlText,
  isRestoreEgressEnabled,
  normalizeReportPlainText,
  redactTelemetry,
  requirePrivilegedAction,
  requireRestoreEgressEnabled,
  requireTrustedMutationOrigin,
  safeDownloadFilename,
  type PrivilegedSessionEvidence,
} from "./index.js";

describe("privileged authorization", () => {
  it("allows an exact tenant, active, eligible, AAL2, recently stepped-up inspector", () => {
    expect(
      authorizePrivilegedAction({
        action: "approve_module",
        organizationId: "organization-1",
        session: eligibleSession(),
        now: "2026-07-15T08:10:00.000+10:00",
      }),
    ).toMatchObject({ allowed: true, action: "approve_module" });
  });

  it.each([
    [{ organizationId: "organization-2" }, "wrong_tenant"],
    [{ membershipStatus: "suspended" }, "membership_inactive"],
    [{ professionalEligibility: "ineligible" }, "professional_ineligible"],
    [{ aal: "aal1" }, "aal2_required"],
    [
      { mfaVerifiedAt: "2026-07-15T07:00:00.000+10:00" },
      "recent_auth_required",
    ],
    [
      { lastActivityAt: "2026-07-15T07:00:00.000+10:00" },
      "session_idle_expired",
    ],
    [{ issuedAt: "2026-07-14T08:00:00.000+10:00" }, "session_absolute_expired"],
    [{ expiresAt: "2026-07-15T08:09:00.000+10:00" }, "session_expired"],
    [{ revokedAt: "2026-07-15T08:05:00.000+10:00" }, "session_revoked"],
  ] as const)("denies invalid session evidence %o", (override, code) => {
    expect(
      authorizePrivilegedAction({
        action: "approve_module",
        organizationId: "organization-1",
        session: { ...eligibleSession(), ...override },
        now: "2026-07-15T08:10:00.000+10:00",
      }),
    ).toEqual({ allowed: false, code });
  });

  it("globally denies a revoked or mismatched device", () => {
    const revoked = eligibleSession();
    expect(
      authorizePrivilegedAction({
        action: "deliver_report",
        organizationId: "organization-1",
        session: {
          ...revoked,
          device: {
            ...revoked.device,
            revokedAt: "2026-07-15T08:05:00.000+10:00",
          },
        },
        now: "2026-07-15T08:10:00.000+10:00",
      }),
    ).toEqual({ allowed: false, code: "device_revoked" });
  });

  it("throws a generic client-safe denial without leaking which credential failed", () => {
    expect(() =>
      requirePrivilegedAction({
        action: "approve_module",
        organizationId: "organization-1",
        session: { ...eligibleSession(), aal: "aal1" },
        now: "2026-07-15T08:10:00.000+10:00",
      }),
    ).toThrowError(AuthorizationDeniedError);
  });

  it.each(["enable_restore_egress", "disable_restore_egress"] as const)(
    "reserves %s for an AAL2 administrator",
    (action) => {
      expect(
        authorizePrivilegedAction({
          action,
          organizationId: "organization-1",
          session: { ...eligibleSession(), role: "administrator" },
          now: "2026-07-15T08:10:00.000+10:00",
        }),
      ).toMatchObject({ allowed: true, action });
      expect(
        authorizePrivilegedAction({
          action,
          organizationId: "organization-1",
          session: eligibleSession(),
          now: "2026-07-15T08:10:00.000+10:00",
        }),
      ).toEqual({ allowed: false, code: "role_not_allowed" });
    },
  );
});

describe("report capability and request boundaries", () => {
  const capability = {
    grantId: "grant-1",
    organizationId: "organization-1",
    actorId: "recipient-1",
    reportVersionId: "report-v1",
    moduleIds: ["module-building"],
    actions: ["view_html", "view_pdf"] as const,
    expiresAt: "2026-07-16T08:00:00.000+10:00",
    revokedAt: null,
    roleActive: true,
    canDelegate: false,
  };

  it("authorizes only exact version, module, actor and action capability", () => {
    expect(
      authorizeReportCapability({
        capability,
        organizationId: "organization-1",
        actorId: "recipient-1",
        reportVersionId: "report-v1",
        moduleId: "module-building",
        action: "view_pdf",
        now: "2026-07-15T08:00:00.000+10:00",
      }),
    ).toBe(true);
    expect(
      authorizeReportCapability({
        capability,
        organizationId: "organization-1",
        actorId: "recipient-1",
        reportVersionId: "report-v2",
        moduleId: "module-building",
        action: "view_pdf",
        now: "2026-07-15T08:00:00.000+10:00",
      }),
    ).toBe(false);
    expect(
      authorizeReportCapability({
        capability: { ...capability, expiresAt: "not-a-date" },
        organizationId: "organization-1",
        actorId: "recipient-1",
        reportVersionId: "report-v1",
        moduleId: "module-building",
        action: "view_pdf",
        now: "2026-07-15T08:00:00.000+10:00",
      }),
    ).toBe(false);
    expect(
      authorizeReportCapability({
        capability,
        organizationId: "organization-1",
        actorId: "recipient-1",
        reportVersionId: "report-v1",
        moduleId: "module-building",
        action: "view_pdf",
        now: "not-a-date",
      }),
    ).toBe(false);
  });

  it("requires an exact allowlisted mutation Origin", () => {
    expect(
      requireTrustedMutationOrigin({
        origin: "https://inspectionhub.co",
        configuredOrigins: ["https://inspectionhub.co"],
      }),
    ).toBe("https://inspectionhub.co");
    expect(() =>
      requireTrustedMutationOrigin({
        origin: "https://attacker.example",
        configuredOrigins: ["https://inspectionhub.co"],
      }),
    ).toThrow("not allowlisted");
  });
});

describe("browser, content and abuse controls", () => {
  it("builds a restrictive CSP and essential headers without unsafe script execution", () => {
    const headers = buildSecurityHeaders({
      production: true,
      connectOrigins: ["https://project.supabase.co"],
    });
    const policy = headers.find(
      (header) => header.key === "Content-Security-Policy",
    )?.value;

    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain("unsafe-eval");
    expect(headers).toEqual(
      expect.arrayContaining([
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
      ]),
    );
  });

  it("rejects insecure production connect origins", () => {
    expect(() =>
      buildSecurityHeaders({
        production: true,
        connectOrigins: ["http://project.supabase.co"],
      }),
    ).toThrow("must use HTTPS");
  });

  it("normalizes plain text and safely encodes stored-XSS fixtures", () => {
    expect(normalizeReportPlainText("  observed\r\ncondition\u0000  ")).toBe(
      "observed\ncondition",
    );
    expect(encodeHtmlText('<img src=x onerror="alert(1)"> & finding')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; finding",
    );
  });

  it("uses only opaque server-generated identifiers in download filenames", () => {
    expect(
      safeDownloadFilename({
        opaqueReportId: "wN4x90_H4SH6pQ2f",
        version: 2,
      }),
    ).toBe("inspection-report-wN4x90_H4SH6pQ2f-v2.pdf");
    expect(() =>
      safeDownloadFilename({ opaqueReportId: "../../client-name", version: 1 }),
    ).toThrow("opaque");
  });

  it("delegates fixed policies and one-way keys to a durable shared store", async () => {
    const key = "a".repeat(64);
    const seen: unknown[] = [];
    const limiter = new DurableRateLimiter({
      consume: async (input) => {
        seen.push(input);
        await Promise.resolve();
        return { allowed: true, remaining: 29, retryAfterSeconds: 0 };
      },
    });

    await expect(
      limiter.consume({ policy: "recipient_access", opaqueKey: key }),
    ).resolves.toEqual({
      allowed: true,
      remaining: 29,
      retryAfterSeconds: 0,
    });
    expect(seen).toEqual([{ policy: "recipient_access", opaqueKey: key }]);
    await expect(
      new DurableRateLimiter({
        consume: async () => {
          await Promise.resolve();
          return { allowed: true, remaining: 299, retryAfterSeconds: 0 };
        },
      }).consume({ policy: "recipient_demo_global", opaqueKey: key }),
    ).resolves.toEqual({
      allowed: true,
      remaining: 299,
      retryAfterSeconds: 0,
    });
    await expect(
      limiter.consume({
        policy: "provider_callback",
        opaqueKey: "raw-ip-address",
      }),
    ).rejects.toThrow("one-way digests");
  });

  it("fails closed when a durable rate-limit store returns malformed state", async () => {
    const limiter = new DurableRateLimiter({
      consume: async () => {
        await Promise.resolve();
        return { allowed: true, remaining: -1, retryAfterSeconds: 0 };
      },
    });

    await expect(
      limiter.consume({
        policy: "booking_quote",
        opaqueKey: "b".repeat(64),
      }),
    ).rejects.toThrow("invalid durable state");
    await expect(
      limiter.consume({
        policy: "caller_selected" as never,
        opaqueKey: "b".repeat(64),
      }),
    ).rejects.toThrow("fixed policy");
  });

  it("does not expose a production process-local rate limiter", async () => {
    const security = await import("./index.js");
    expect(security).not.toHaveProperty("InMemoryFixedWindowRateLimiter");
  });

  it("redacts headers, credentials, report content and mailbox values", () => {
    expect(
      redactTelemetry({
        authorization: "Bearer abc.def",
        mailbox: "buyer@example.com",
        report: "cracked tiles",
        state: "failed",
      }),
    ).toEqual({
      authorization: "[REDACTED]",
      mailbox: "[REDACTED]",
      report: "[REDACTED]",
      state: "failed",
    });
  });

  it("rejects sensitive telemetry on every repeated assertion", () => {
    for (const email of [
      "first@example.com",
      "second@example.com",
      "third@example.com",
    ]) {
      expect(() =>
        assertTelemetryContainsNoSensitivePayload({ value: email }),
      ).toThrow("sensitive");
    }
  });
});

describe("secrets and restore isolation", () => {
  it("supports one active and one decrypt-only environment-bound key", () => {
    let now = "2026-07-15T00:00:00.000Z";
    const ring = new DualKeyRing({
      environment: "production",
      purpose: "recipient-token",
      clock: () => now,
      keys: [
        {
          keyId: "key-current",
          environment: "production",
          purpose: "recipient-token",
          status: "active",
          activatedAt: "2026-07-15T00:00:00.000Z",
          decryptOnlyStartedAt: null,
          decryptOnlyUntil: null,
        },
        {
          keyId: "key-prior",
          environment: "production",
          purpose: "recipient-token",
          status: "decrypt_only",
          activatedAt: "2026-06-15T00:00:00.000Z",
          decryptOnlyStartedAt: "2026-07-15T00:00:00.000Z",
          decryptOnlyUntil: "2026-07-15T01:00:00.000Z",
        },
        {
          keyId: "key-preview",
          environment: "preview",
          purpose: "recipient-token",
          status: "active",
          activatedAt: "2026-07-15T00:00:00.000Z",
          decryptOnlyStartedAt: null,
          decryptOnlyUntil: null,
        },
      ],
    });

    expect(ring.encryptionKey().keyId).toBe("key-current");
    now = "2026-07-15T00:59:59.999Z";
    expect(ring.canDecrypt("key-prior")).toBe(true);
    now = "2026-07-15T01:00:00.000Z";
    expect(ring.canDecrypt("key-prior")).toBe(false);
    expect(ring.canDecrypt("key-preview")).toBe(false);
  });

  it("rejects an unbounded decrypt-only application key", () => {
    expect(
      () =>
        new DualKeyRing({
          environment: "production",
          purpose: "recipient-token",
          clock: () => "2026-07-15T00:00:00.000Z",
          keys: [
            {
              keyId: "key-current",
              environment: "production",
              purpose: "recipient-token",
              status: "active",
              activatedAt: "2026-07-15T00:00:00.000Z",
              decryptOnlyStartedAt: null,
              decryptOnlyUntil: null,
            },
            {
              keyId: "key-prior",
              environment: "production",
              purpose: "recipient-token",
              status: "decrypt_only",
              activatedAt: "2026-06-15T00:00:00.000Z",
              decryptOnlyStartedAt: "2026-07-15T00:00:00.000Z",
              decryptOnlyUntil: null,
            },
          ],
        }),
    ).toThrow("bounded expiry");
  });

  it("owns decryption time in the harness and caps overlap at thirty days", () => {
    expect(
      () =>
        new DualKeyRing({
          environment: "production",
          purpose: "recipient-token",
          clock: () => "2026-07-15T00:00:00.000Z",
          keys: [
            {
              keyId: "key-current",
              environment: "production",
              purpose: "recipient-token",
              status: "active",
              activatedAt: "2026-07-15T00:00:00.000Z",
              decryptOnlyStartedAt: null,
              decryptOnlyUntil: null,
            },
            {
              keyId: "key-prior",
              environment: "production",
              purpose: "recipient-token",
              status: "decrypt_only",
              activatedAt: "2026-06-15T00:00:00.000Z",
              decryptOnlyStartedAt: "2026-07-15T00:00:00.000Z",
              decryptOnlyUntil: "2026-08-14T00:00:00.001Z",
            },
          ],
        }),
    ).toThrow("thirty days");
  });

  it("accepts only the complete audited Postgres restore-egress projection", () => {
    const names = [
      "artifact_checksums",
      "event_replay",
      "recipient_grants",
      "deletion_suppressions",
      "session_revocations",
      "package_pointers",
      "provider_truth",
      "secret_environment",
    ] as const;
    const checkedEvidence = names.map((name, index) => ({
      name,
      evidenceHash: (index + 1).toString(16).repeat(64),
    }));
    const projection = {
      source: "postgres_restore_egress_state_v2" as const,
      organizationId: "organization-1",
      restoreSessionId: "restore-1",
      environment: "production" as const,
      restoreGeneration: 2,
      verificationRun: 1,
      state: "enabled" as const,
      eventVersion: 1,
      eventId: "12345678-1234-4123-8123-123456789abc",
      checkedEvidence,
      projectionHash: "f".repeat(64),
    };
    const expected = {
      organizationId: "organization-1",
      restoreSessionId: "restore-1",
      environment: "production" as const,
      projectionHash: "f".repeat(64),
    };

    expect(isRestoreEgressEnabled(null, expected)).toBe(false);
    expect(
      isRestoreEgressEnabled({ ...projection, state: "blocked" }, expected),
    ).toBe(false);
    expect(
      isRestoreEgressEnabled(
        { ...projection, checkedEvidence: checkedEvidence.slice(1) },
        expected,
      ),
    ).toBe(false);
    expect(
      isRestoreEgressEnabled(projection, {
        ...expected,
        projectionHash: "e".repeat(64),
      }),
    ).toBe(false);
    expect(isRestoreEgressEnabled(projection, expected)).toBe(true);
    expect(
      isRestoreEgressEnabled(projection, {
        ...expected,
        organizationId: "organization-2",
      }),
    ).toBe(false);
    expect(
      isRestoreEgressEnabled(projection, {
        ...expected,
        restoreSessionId: "restore-2",
      }),
    ).toBe(false);
    expect(
      isRestoreEgressEnabled(projection, {
        ...expected,
        environment: "preview",
      }),
    ).toBe(false);
    expect(constantTimeEqualSha256("f".repeat(64), "f".repeat(64))).toBe(true);
    expect(constantTimeEqualSha256("f".repeat(64), "e".repeat(64))).toBe(false);
    expect(() =>
      requireRestoreEgressEnabled(
        { ...projection, state: "blocked" },
        expected,
      ),
    ).toThrow("stays disabled");
  });

  it("guards adapter egress with the exact active tenant projection", async () => {
    const projection = restoreProjection();
    const guard = new RestoreRuntimeEgressGuard(
      {
        read: async () => {
          await Promise.resolve();
          return {
            projection,
            trustedProjectionHash: projection.projectionHash,
          };
        },
      },
      (organizationId) =>
        organizationId === projection.organizationId
          ? {
              organizationId,
              restoreSessionId: projection.restoreSessionId,
              environment: projection.environment,
            }
          : null,
    );
    await expect(
      guard.requireEgress({
        organizationId: projection.organizationId,
        boundary: "delivery_provider",
      }),
    ).resolves.toBeUndefined();
    await expect(
      guard.requireEgress({
        organizationId: "organization-2",
        boundary: "delivery_provider",
      }),
    ).rejects.toThrow("no active tenant generation");
  });
});

function restoreProjection() {
  return {
    source: "postgres_restore_egress_state_v2" as const,
    organizationId: "organization-1",
    restoreSessionId: "restore-1",
    environment: "production" as const,
    restoreGeneration: 2,
    verificationRun: 1,
    state: "enabled" as const,
    eventVersion: 1,
    eventId: "12345678-1234-4123-8123-123456789abc",
    checkedEvidence: [
      "artifact_checksums",
      "event_replay",
      "recipient_grants",
      "deletion_suppressions",
      "session_revocations",
      "package_pointers",
      "provider_truth",
      "secret_environment",
    ].map((name, index) => ({
      name: name as
        | "artifact_checksums"
        | "event_replay"
        | "recipient_grants"
        | "deletion_suppressions"
        | "session_revocations"
        | "package_pointers"
        | "provider_truth"
        | "secret_environment",
      evidenceHash: (index + 1).toString(16).repeat(64),
    })),
    projectionHash: "f".repeat(64),
  };
}

function eligibleSession(): PrivilegedSessionEvidence {
  return {
    actorId: "actor-1",
    organizationId: "organization-1",
    role: "inspector",
    membershipStatus: "active",
    professionalEligibility: "eligible",
    aal: "aal2",
    issuedAt: "2026-07-15T08:00:00.000+10:00",
    expiresAt: "2026-07-15T20:00:00.000+10:00",
    lastActivityAt: "2026-07-15T08:09:00.000+10:00",
    mfaVerifiedAt: "2026-07-15T08:05:00.000+10:00",
    revokedAt: null,
    device: {
      deviceId: "device-1",
      registeredOrganizationId: "organization-1",
      registeredActorId: "actor-1",
      revokedAt: null,
    },
  };
}
