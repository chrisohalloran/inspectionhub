import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  recipientStateAuthority,
  RecipientAuthorityError,
  SupabaseRecipientStateAuthority,
  type AuthoritySession,
} from "./recipient-authority";
import { RecipientMutationLimitError } from "./recipient-mutation-error";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Supabase recipient authority boundary", () => {
  it("sends only an opaque invitation digest to the service-only command", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const authority = boundary(requests, challengeResponse());
    await authority.claimInvitation({
      invitationToken: "demo-invite-sensitive-value",
      intendedEmail: "recipient@example.com",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toMatch(
      /\/rest\/v1\/rpc\/command_recipient_demo_claim_invitation$/u,
    );
    expect(JSON.stringify(requests[0]?.body)).not.toContain(
      "demo-invite-sensitive-value",
    );
    expect(requests[0]?.body.target_invitation_digest).toBe(
      createHmac("sha256", HASH_SECRET)
        .update("invitation:demo-invite-sensitive-value")
        .digest("base64url"),
    );
  });

  it("makes share authorization and recording one atomic RPC", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const authority = boundary(requests, invitationResponse());
    await authority.recordShareInvitation({
      session: SESSION,
      email: "buyer@example.com",
      expiresAt: SESSION.expiresAt - 1_000,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toMatch(
      /\/rest\/v1\/rpc\/command_recipient_demo_record_share$/u,
    );
    expect(requests[0]?.body).toMatchObject({
      target_grant_id: SESSION.grantId,
      target_grant_revision: SESSION.grantRevision,
      target_email: "buyer@example.com",
      target_report_version_id: SESSION.reportVersionId,
    });
  });

  it("makes module-aware contact authorization and recording one atomic RPC", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const authority = boundary(requests, contactResponse());
    await authority.recordContactRequest({
      session: SESSION,
      findingReference: "finding_cracked_tiles",
      module: "building",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toMatch(
      /\/rest\/v1\/rpc\/command_recipient_demo_record_contact$/u,
    );
    expect(requests[0]?.body).toMatchObject({
      target_finding_reference: "finding_cracked_tiles",
      target_module: "building",
    });
  });

  it("returns independent Building and Timber Pest withdrawal state", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const authority = boundary(requests, {
      buildingWithdrawn: false,
      timberPestWithdrawn: true,
      shareInvitations: [],
      contactRequests: [],
    });

    await expect(authority.portalState(SESSION)).resolves.toMatchObject({
      buildingWithdrawn: false,
      timberPestWithdrawn: true,
    });
    expect(requests[0]?.url).toMatch(
      /\/rest\/v1\/rpc\/command_recipient_demo_portal_state$/u,
    );
  });

  it("preserves a typed SQL mutation-limit outcome", async () => {
    const authority = new SupabaseRecipientStateAuthority({
      supabaseUrl: "https://example.supabase.co",
      serviceRoleKey: "service-role-key-long-enough",
      hashSecret: HASH_SECRET,
      fetcher: () =>
        Promise.resolve({
          ok: false,
          json: () =>
            Promise.resolve({
              code: "P0001",
              message: "grant_mutation_limit_reached",
            }),
        }),
    });

    await expect(
      authority.recordContactRequest({
        session: SESSION,
        findingReference: null,
        module: null,
      }),
    ).rejects.toBeInstanceOf(RecipientMutationLimitError);
  });

  it("round-trips a SQL microsecond expiry without making it grant identity", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const sqlGrant = grantResponse("2026-07-16T02:34:56.123456+00:00");
    const authority = boundary(requests, sqlGrant);
    const grant = await authority.issueGrant({
      challengeId: "2ab3652c-f2ea-4d83-90cf-87bb4f4bf345",
      invitationDigest: "opaque-digest",
      intendedEmail: "recipient@example.com",
    });
    expect(new Date(grant.expiresAt).toISOString()).toBe(
      "2026-07-16T02:34:56.123Z",
    );

    await authority.authorise(
      {
        grantId: grant.grantId,
        grantRevision: grant.revision,
        principalId: grant.principalId,
        verifiedEmail: grant.verifiedEmail,
        organizationId: grant.organizationId,
        jobId: grant.jobId,
        reportVersionId: grant.reportVersionId,
        expiresAt: grant.expiresAt,
      },
      {
        action: "read_report",
        module: "building",
        reportVersionId: grant.reportVersionId,
      },
    );

    expect(requests).toHaveLength(2);
    expect(requests[1]?.body).not.toHaveProperty("target_expires_at");
    expect(requests[1]?.body).toMatchObject({
      target_grant_id: grant.grantId,
      target_grant_revision: 1,
      target_report_version_id: "report_demo_v2",
    });
  });

  it("fails closed instead of selecting the filesystem fixture outside test", () => {
    vi.stubEnv("RECIPIENT_AUTHORITY_ADAPTER", "fixture");
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("BUILD_WEEK_FIXTURES_ENABLED", "true");
    vi.stubEnv("RECIPIENT_DEMO_ACCESS_ENABLED", "true");
    expect(() => recipientStateAuthority()).toThrow(RecipientAuthorityError);
  });

  it("fails closed when the canonical database configuration is absent", () => {
    vi.stubEnv("RECIPIENT_AUTHORITY_ADAPTER", "supabase");
    vi.stubEnv("SUPABASE_API_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(() => recipientStateAuthority()).toThrow(RecipientAuthorityError);
  });

  it("fails closed on an unknown authority adapter", () => {
    vi.stubEnv("RECIPIENT_AUTHORITY_ADAPTER", "process-memory");
    expect(() => recipientStateAuthority()).toThrow(RecipientAuthorityError);
  });
});

const HASH_SECRET = "recipient-authority-test-hash-secret-at-least-32";
const SESSION: AuthoritySession = {
  grantId: "4ef55799-5ec0-4da4-8ec2-90514b46f554",
  grantRevision: 1,
  principalId: "principal_demo_recipient",
  verifiedEmail: "recipient@example.com",
  organizationId: "org_demo",
  jobId: "job_demo_cracked_tile",
  reportVersionId: "report_demo_v2",
  expiresAt: Date.now() + 3_600_000,
};

function boundary(
  requests: Array<{ url: string; body: Record<string, unknown> }>,
  response: unknown,
) {
  return new SupabaseRecipientStateAuthority({
    supabaseUrl: "https://example.supabase.co",
    serviceRoleKey: "service-role-key-long-enough",
    hashSecret: HASH_SECRET,
    fetcher: (url, init) => {
      if (typeof init.body !== "string") {
        throw new Error("Expected a JSON request body");
      }
      requests.push({
        url,
        body: JSON.parse(init.body) as Record<string, unknown>,
      });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(response),
      });
    },
  });
}

function challengeResponse() {
  return {
    challengeId: "2ab3652c-f2ea-4d83-90cf-87bb4f4bf345",
    invitationDigest: "digest",
    intendedEmail: "recipient@example.com",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
}

function invitationResponse() {
  return {
    invitationId: "81517e83-6dcb-4ab4-9378-d68b3d10b8db",
    grantId: SESSION.grantId,
    email: "buyer@example.com",
    recordedAt: new Date().toISOString(),
    expiresAt: new Date(SESSION.expiresAt - 1_000).toISOString(),
    state: "recorded",
  };
}

function contactResponse() {
  return {
    contactRequestId: "ca1252a8-0133-48f6-b6ce-829a84e4ef01",
    grantId: SESSION.grantId,
    findingReference: "finding_cracked_tiles",
    recordedAt: new Date().toISOString(),
    state: "recorded",
  };
}

function grantResponse(expiresAt: string) {
  return {
    grantId: SESSION.grantId,
    principalId: SESSION.principalId,
    verifiedEmail: SESSION.verifiedEmail,
    organizationId: SESSION.organizationId,
    jobId: SESSION.jobId,
    reportVersionId: SESSION.reportVersionId,
    modules: ["building", "timber_pest"],
    actions: ["read_report", "contact_inspector", "invite_recipient"],
    issuedAt: "2026-07-16T01:34:56.123456+00:00",
    expiresAt,
    revision: 1,
    status: "active",
  };
}
