import { describe, expect, it } from "vitest";

import { RecipientAccessDeniedError, RecipientAccessService } from "./index.js";
import type { MailboxSession, RecipientGrant } from "./types.js";

const ORG = "org_demo";
const JOB = "job_demo";
const VERSION_ONE = "report_v1";
const VERSION_TWO = "report_v2";

function harness() {
  let now = new Date("2026-07-15T00:00:00.000Z");
  let sequence = 0;
  const service = new RecipientAccessService({
    secret: "recipient-test-secret-at-least-16",
    clock: () => now,
    tokenFactory: (prefix) => `${prefix}_${String(++sequence)}`,
    otpFactory: () => "482913",
  });
  service.registerDeliveredVersion({
    organizationId: ORG,
    jobId: JOB,
    reportVersionId: VERSION_ONE,
    modules: ["building", "timber_pest"],
    deliveredAt: now.toISOString(),
  });

  function authenticate(
    email = "owner@example.com",
    principalId = "principal_owner",
  ): MailboxSession {
    const challenge = service.beginMailboxAuthentication(email);
    return service.verifyMailboxAuthentication({
      challengeId: challenge.challengeId,
      otp: challenge.otp,
      principalId,
    });
  }

  function ownerGrant(
    session: MailboxSession,
    overrides: Partial<{
      reportVersionId: string;
      actions: RecipientGrant["permittedActions"];
    }> = {},
  ): RecipientGrant {
    return service.issueOwnerGrant({
      organizationId: ORG,
      jobId: JOB,
      principalId: session.principalId,
      verifiedEmail: session.email,
      reportVersionId: overrides.reportVersionId ?? VERSION_ONE,
      permittedModules: ["building", "timber_pest"],
      permittedActions: overrides.actions ?? [
        "read_report",
        "download_pdf",
        "view_curated_media",
        "view_history",
        "contact_inspector",
        "invite_recipient",
      ],
      issuedBy: "actor_inspector",
      expiresAt: "2026-07-20T00:00:00.000Z",
    });
  }

  return {
    service,
    authenticate,
    ownerGrant,
    setNow(value: string) {
      now = new Date(value);
    },
  };
}

describe("RecipientAccessService", () => {
  it("keeps invitation delivery separate from fresh mailbox OTP authentication", () => {
    const h = harness();
    const owner = h.authenticate();
    const ownerGrant = h.ownerGrant(owner);
    const issued = h.service.createShareInvitation({
      inviterGrantId: ownerGrant.grantId,
      inviterSession: owner,
      intendedEmail: "Buyer+Reports@example.com",
      permittedModules: ["building"],
      permittedActions: ["read_report", "download_pdf"],
      expiresAt: "2026-07-18T00:00:00.000Z",
    });

    expect(issued.invitation).toMatchObject({
      intendedEmail: "buyer+reports@example.com",
      reportVersionId: VERSION_ONE,
      state: "sent",
      expiresAt: "2026-07-18T00:00:00.000Z",
    });
    expect(issued.invitation).not.toHaveProperty("tokenDigest");

    const recipient = h.authenticate(
      "Buyer+Reports@example.com",
      "principal_recipient",
    );
    const grant = h.service.redeemInvitation(issued.token, recipient);
    expect(grant).toMatchObject({
      parentGrantId: ownerGrant.grantId,
      principalId: "principal_recipient",
      reportVersionId: VERSION_ONE,
      permittedModules: ["building"],
      permittedActions: ["read_report", "download_pdf"],
    });
    expect(h.service.invitation(issued.invitation.invitationId).state).toBe(
      "redeemed",
    );
  });

  it("denies a forwarded invite in the wrong authenticated mailbox and denies replay", () => {
    const h = harness();
    const owner = h.authenticate();
    const ownerGrant = h.ownerGrant(owner);
    const issued = h.service.createShareInvitation({
      inviterGrantId: ownerGrant.grantId,
      inviterSession: owner,
      intendedEmail: "recipient@example.com",
      permittedModules: ["building"],
      permittedActions: ["read_report"],
      expiresAt: "2026-07-18T00:00:00.000Z",
    });
    const wrongMailbox = h.authenticate(
      "forwarded@example.com",
      "principal_forwarded",
    );
    expect(() =>
      h.service.redeemInvitation(issued.token, wrongMailbox),
    ).toThrow(RecipientAccessDeniedError);

    const intended = h.authenticate(
      "recipient@example.com",
      "principal_recipient",
    );
    h.service.redeemInvitation(issued.token, intended);
    expect(() => h.service.redeemInvitation(issued.token, intended)).toThrow(
      RecipientAccessDeniedError,
    );
  });

  it("prevents module/action escalation, extended expiry, and onward sharing", () => {
    const h = harness();
    const owner = h.authenticate();
    const restricted = h.service.issueOwnerGrant({
      organizationId: ORG,
      jobId: JOB,
      principalId: owner.principalId,
      verifiedEmail: owner.email,
      reportVersionId: VERSION_ONE,
      permittedModules: ["building"],
      permittedActions: ["read_report", "invite_recipient"],
      issuedBy: "actor_inspector",
      expiresAt: "2026-07-17T00:00:00.000Z",
    });
    const base = {
      inviterGrantId: restricted.grantId,
      inviterSession: owner,
      intendedEmail: "recipient@example.com",
      permittedModules: ["building"] as const,
      permittedActions: ["read_report"] as const,
      expiresAt: "2026-07-16T00:00:00.000Z",
    };
    expect(() =>
      h.service.createShareInvitation({
        ...base,
        permittedModules: ["timber_pest"],
      }),
    ).toThrow(RecipientAccessDeniedError);
    expect(() =>
      h.service.createShareInvitation({
        ...base,
        permittedActions: ["download_pdf"],
      }),
    ).toThrow(RecipientAccessDeniedError);
    expect(() =>
      h.service.createShareInvitation({
        ...base,
        permittedActions: ["invite_recipient"],
      }),
    ).toThrow(RecipientAccessDeniedError);
    expect(() =>
      h.service.createShareInvitation({
        ...base,
        expiresAt: "2026-07-19T00:00:00.000Z",
      }),
    ).toThrow(RecipientAccessDeniedError);

    const issued = h.service.createShareInvitation(base);
    const recipient = h.authenticate(
      "recipient@example.com",
      "principal_recipient",
    );
    const childGrant = h.service.redeemInvitation(issued.token, recipient);
    expect(() =>
      h.service.createShareInvitation({
        ...base,
        inviterGrantId: childGrant.grantId,
        inviterSession: recipient,
        intendedEmail: "another@example.com",
      }),
    ).toThrow(RecipientAccessDeniedError);
  });

  it("authorises every request against principal, job, exact version, module and action", () => {
    const h = harness();
    const owner = h.authenticate();
    const grant = h.ownerGrant(owner);
    const request = {
      organizationId: ORG,
      jobId: JOB,
      reportVersionId: VERSION_ONE,
      module: "building" as const,
      action: "read_report" as const,
    };
    expect(h.service.authorise(owner, grant.grantId, request).grantId).toBe(
      grant.grantId,
    );
    expect(() =>
      h.service.authorise(owner, grant.grantId, {
        ...request,
        reportVersionId: VERSION_TWO,
      }),
    ).toThrow(RecipientAccessDeniedError);
    expect(() =>
      h.service.authorise(owner, grant.grantId, {
        ...request,
        jobId: "job_other",
      }),
    ).toThrow(RecipientAccessDeniedError);

    const sameEmailOtherPrincipal = {
      ...owner,
      sessionId: "session_other_role",
      principalId: "principal_same_mailbox_other_role",
    };
    expect(() =>
      h.service.authorise(sameEmailOtherPrincipal, grant.grantId, request),
    ).toThrow(RecipientAccessDeniedError);
  });

  it("does not give an old-version grant access to a later amendment until explicitly delivered and granted", () => {
    const h = harness();
    const owner = h.authenticate();
    const oldGrant = h.ownerGrant(owner);
    h.service.registerDeliveredVersion({
      organizationId: ORG,
      jobId: JOB,
      reportVersionId: VERSION_TWO,
      modules: ["building", "timber_pest"],
      deliveredAt: "2026-07-15T01:00:00.000Z",
    });
    expect(() =>
      h.service.authorise(owner, oldGrant.grantId, {
        organizationId: ORG,
        jobId: JOB,
        reportVersionId: VERSION_TWO,
        module: "building",
        action: "read_report",
      }),
    ).toThrow(RecipientAccessDeniedError);
  });

  it("fails a media/range response closed when its grant is revoked in flight", async () => {
    const h = harness();
    const owner = h.authenticate();
    const grant = h.ownerGrant(owner);
    const request = {
      organizationId: ORG,
      jobId: JOB,
      reportVersionId: VERSION_ONE,
      module: "building" as const,
      action: "view_curated_media" as const,
    };
    await expect(
      h.service.withAuthorisedRequest(owner, grant.grantId, request, () => {
        h.service.revokeGrant({
          grantId: grant.grantId,
          revokedBy: "actor_inspector",
          reason: "Recipient removed",
        });
        return Promise.resolve(Buffer.from("partial-range"));
      }),
    ).rejects.toThrow(RecipientAccessDeniedError);
  });

  it("denies a redeemed child grant as soon as its parent grant is revoked", () => {
    const h = harness();
    const owner = h.authenticate();
    const parentGrant = h.ownerGrant(owner);
    const issued = h.service.createShareInvitation({
      inviterGrantId: parentGrant.grantId,
      inviterSession: owner,
      intendedEmail: "recipient@example.com",
      permittedModules: ["building"],
      permittedActions: ["read_report"],
      expiresAt: "2026-07-18T00:00:00.000Z",
    });
    const recipient = h.authenticate(
      "recipient@example.com",
      "principal_recipient",
    );
    const childGrant = h.service.redeemInvitation(issued.token, recipient);
    const request = {
      organizationId: ORG,
      jobId: JOB,
      reportVersionId: VERSION_ONE,
      module: "building" as const,
      action: "read_report" as const,
    };
    expect(
      h.service.authorise(recipient, childGrant.grantId, request).grantId,
    ).toBe(childGrant.grantId);

    h.service.revokeGrant({
      grantId: parentGrant.grantId,
      revokedBy: "actor_inspector",
      reason: "Owner access withdrawn",
    });
    expect(() =>
      h.service.authorise(recipient, childGrant.grantId, request),
    ).toThrow(RecipientAccessDeniedError);
  });

  it("denies withdrawn modules while retaining other module capability", () => {
    const h = harness();
    const owner = h.authenticate();
    const grant = h.ownerGrant(owner);
    h.service.withdrawModule({
      organizationId: ORG,
      jobId: JOB,
      reportVersionId: VERSION_ONE,
      module: "building",
    });
    expect(() =>
      h.service.authorise(owner, grant.grantId, {
        organizationId: ORG,
        jobId: JOB,
        reportVersionId: VERSION_ONE,
        module: "building",
        action: "read_report",
      }),
    ).toThrow(RecipientAccessDeniedError);
    expect(
      h.service.authorise(owner, grant.grantId, {
        organizationId: ORG,
        jobId: JOB,
        reportVersionId: VERSION_ONE,
        module: "timber_pest",
        action: "read_report",
      }).grantId,
    ).toBe(grant.grantId);
  });

  it("shows expired and revoked invitation states without revealing token material", () => {
    const h = harness();
    const owner = h.authenticate();
    const grant = h.ownerGrant(owner);
    const first = h.service.createShareInvitation({
      inviterGrantId: grant.grantId,
      inviterSession: owner,
      intendedEmail: "one@example.com",
      permittedModules: ["building"],
      permittedActions: ["read_report"],
      expiresAt: "2026-07-16T00:00:00.000Z",
    });
    const second = h.service.createShareInvitation({
      inviterGrantId: grant.grantId,
      inviterSession: owner,
      intendedEmail: "two@example.com",
      permittedModules: ["building"],
      permittedActions: ["read_report"],
      expiresAt: "2026-07-17T00:00:00.000Z",
    });
    h.service.revokeInvitation(second.invitation.invitationId, owner);
    h.setNow("2026-07-16T00:00:00.001Z");
    expect(h.service.invitation(first.invitation.invitationId).state).toBe(
      "expired",
    );
    expect(h.service.invitation(second.invitation.invitationId).state).toBe(
      "revoked",
    );
    expect(
      JSON.stringify(h.service.invitation(first.invitation.invitationId)),
    ).not.toContain(first.token);
  });

  it("bounds OTP retries, consumes the challenge once, and denies inactive sessions", () => {
    const h = harness();
    const challenge = h.service.beginMailboxAuthentication(
      "recipient@example.com",
    );
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(() =>
        h.service.verifyMailboxAuthentication({
          challengeId: challenge.challengeId,
          otp: "000000",
          principalId: "principal_recipient",
        }),
      ).toThrow(RecipientAccessDeniedError);
    }
    expect(() =>
      h.service.verifyMailboxAuthentication({
        challengeId: challenge.challengeId,
        otp: challenge.otp,
        principalId: "principal_recipient",
      }),
    ).toThrow(RecipientAccessDeniedError);

    const owner = h.authenticate();
    const grant = h.ownerGrant(owner);
    expect(() =>
      h.service.authorise({ ...owner, active: false }, grant.grantId, {
        organizationId: ORG,
        jobId: JOB,
        reportVersionId: VERSION_ONE,
        module: "building",
        action: "read_report",
      }),
    ).toThrow(RecipientAccessDeniedError);
  });

  it("records safe append-only metadata without mailbox addresses or report text", () => {
    const h = harness();
    const owner = h.authenticate();
    const grant = h.ownerGrant(owner);
    h.service.authorise(owner, grant.grantId, {
      organizationId: ORG,
      jobId: JOB,
      reportVersionId: VERSION_ONE,
      module: "building",
      action: "read_report",
    });
    const serialised = JSON.stringify(h.service.events());
    expect(serialised).not.toContain(owner.email);
    expect(serialised).not.toContain("property");
    expect(h.service.events().map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        "version_delivered",
        "mailbox_verified",
        "grant_issued",
        "request_authorised",
      ]),
    );
  });
});
