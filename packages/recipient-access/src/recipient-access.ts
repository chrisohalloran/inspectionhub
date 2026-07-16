import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  RecipientAccessDeniedError,
  RecipientConflictError,
  RecipientInputError,
} from "./errors.js";
import type {
  AuthorisationRequest,
  DeliveredReportVersion,
  InvitationView,
  MailboxChallenge,
  MailboxSession,
  RecipientAccessEvent,
  RecipientAction,
  RecipientGrant,
  RecipientModule,
  ShareInvitation,
  ShareInvitationState,
} from "./types.js";

type Clock = () => Date;
type TokenFactory = (prefix: string) => string;

export type RecipientAccessOptions = Readonly<{
  secret: string;
  clock?: Clock;
  tokenFactory?: TokenFactory;
  otpFactory?: () => string;
}>;

export type OwnerGrantInput = Readonly<{
  organizationId: string;
  jobId: string;
  principalId: string;
  verifiedEmail: string;
  reportVersionId: string;
  permittedModules: readonly RecipientModule[];
  permittedActions: readonly RecipientAction[];
  issuedBy: string;
  expiresAt: string;
}>;

export type ShareInvitationInput = Readonly<{
  inviterGrantId: string;
  inviterSession: MailboxSession;
  intendedEmail: string;
  permittedModules: readonly RecipientModule[];
  permittedActions: readonly RecipientAction[];
  expiresAt: string;
}>;

export type IssuedInvitation = Readonly<{
  invitation: InvitationView;
  token: string;
}>;

function defaultTokenFactory(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

function canonicalEmail(email: string): string {
  const canonical = email.trim().toLocaleLowerCase("en-AU");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(canonical)) {
    throw new RecipientInputError("A valid mailbox address is required");
  }
  return canonical;
}

function assertFuture(iso: string, now: Date, field: string): void {
  const time = Date.parse(iso);
  if (!Number.isFinite(time) || time <= now.getTime()) {
    throw new RecipientInputError(`${field} must be a future timestamp`);
  }
}

function isSubset<T>(requested: readonly T[], allowed: readonly T[]): boolean {
  const allowlist = new Set(allowed);
  return requested.every((item) => allowlist.has(item));
}

function unique<T>(items: readonly T[]): readonly T[] {
  return [...new Set(items)];
}

export class RecipientAccessService {
  readonly #secret: string;
  readonly #clock: Clock;
  readonly #tokenFactory: TokenFactory;
  readonly #otpFactory: () => string;
  readonly #grants = new Map<string, RecipientGrant>();
  readonly #invitations = new Map<string, ShareInvitation>();
  readonly #challenges = new Map<string, MailboxChallenge>();
  readonly #deliveredVersions = new Map<string, DeliveredReportVersion>();
  readonly #events: RecipientAccessEvent[] = [];

  constructor(options: RecipientAccessOptions) {
    if (options.secret.length < 16) {
      throw new RecipientInputError(
        "Recipient access token hashing requires at least a 16-character secret",
      );
    }
    this.#secret = options.secret;
    this.#clock = options.clock ?? (() => new Date());
    this.#tokenFactory = options.tokenFactory ?? defaultTokenFactory;
    this.#otpFactory =
      options.otpFactory ??
      (() => String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0"));
  }

  registerDeliveredVersion(
    version: Omit<DeliveredReportVersion, "withdrawnModules">,
  ): DeliveredReportVersion {
    const key = this.#versionKey(version);
    const existing = this.#deliveredVersions.get(key);
    if (existing !== undefined) {
      if (
        JSON.stringify(existing.modules) !==
        JSON.stringify(unique(version.modules))
      ) {
        throw new RecipientConflictError(
          "A delivered report version cannot be rewritten with another module set",
        );
      }
      return existing;
    }
    const delivered = Object.freeze({
      ...version,
      modules: Object.freeze(unique(version.modules)),
      withdrawnModules: Object.freeze([] as RecipientModule[]),
    });
    this.#deliveredVersions.set(key, delivered);
    this.#appendEvent("version_delivered", {
      reportVersionId: delivered.reportVersionId,
    });
    return delivered;
  }

  withdrawModule(input: {
    organizationId: string;
    jobId: string;
    reportVersionId: string;
    module: RecipientModule;
  }): DeliveredReportVersion {
    const key = this.#versionKey(input);
    const delivered = this.#deliveredVersions.get(key);
    if (delivered === undefined || !delivered.modules.includes(input.module)) {
      throw new RecipientConflictError(
        "Delivered module version was not found",
      );
    }
    const next = Object.freeze({
      ...delivered,
      withdrawnModules: Object.freeze(
        unique([...delivered.withdrawnModules, input.module]),
      ),
    });
    this.#deliveredVersions.set(key, next);
    this.#appendEvent("module_withdrawn", {
      reportVersionId: input.reportVersionId,
      safeReason: input.module,
    });
    return next;
  }

  beginMailboxAuthentication(email: string): {
    challengeId: string;
    otp: string;
    expiresAt: string;
  } {
    const now = this.#clock();
    const challengeId = this.#tokenFactory("challenge");
    const otp = this.#otpFactory();
    if (!/^\d{6}$/u.test(otp)) {
      throw new RecipientInputError("OTP factory must return six digits");
    }
    const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
    this.#challenges.set(
      challengeId,
      Object.freeze({
        challengeId,
        email: canonicalEmail(email),
        otpDigest: this.#digest(`otp:${challengeId}:${otp}`),
        issuedAt: now.toISOString(),
        expiresAt,
        failedAttempts: 0,
        consumedAt: null,
      }),
    );
    this.#appendEvent("mailbox_challenge_issued", {});
    return { challengeId, otp, expiresAt };
  }

  verifyMailboxAuthentication(input: {
    challengeId: string;
    otp: string;
    principalId: string;
  }): MailboxSession {
    const now = this.#clock();
    const challenge = this.#challenges.get(input.challengeId);
    if (
      challenge === undefined ||
      challenge.consumedAt !== null ||
      Date.parse(challenge.expiresAt) <= now.getTime() ||
      challenge.failedAttempts >= 5
    ) {
      throw new RecipientAccessDeniedError();
    }
    const actual = this.#digest(`otp:${challenge.challengeId}:${input.otp}`);
    if (!this.#safeEqual(actual, challenge.otpDigest)) {
      this.#challenges.set(
        challenge.challengeId,
        Object.freeze({
          ...challenge,
          failedAttempts: challenge.failedAttempts + 1,
        }),
      );
      throw new RecipientAccessDeniedError();
    }
    const verifiedAt = now.toISOString();
    this.#challenges.set(
      challenge.challengeId,
      Object.freeze({ ...challenge, consumedAt: verifiedAt }),
    );
    const session = Object.freeze({
      sessionId: this.#tokenFactory("session"),
      principalId: input.principalId,
      email: challenge.email,
      mailboxVerifiedAt: verifiedAt,
      authenticatedAt: verifiedAt,
      expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
      active: true,
    });
    this.#appendEvent("mailbox_verified", {
      principalId: session.principalId,
    });
    return session;
  }

  issueOwnerGrant(input: OwnerGrantInput): RecipientGrant {
    const now = this.#clock();
    assertFuture(input.expiresAt, now, "Grant expiry");
    this.#requireDelivered(
      input.organizationId,
      input.jobId,
      input.reportVersionId,
      input.permittedModules,
    );
    if (
      input.permittedModules.length === 0 ||
      input.permittedActions.length === 0
    ) {
      throw new RecipientInputError(
        "A grant needs at least one module and one action",
      );
    }
    const grant = this.#storeGrant({
      ...input,
      verifiedEmail: canonicalEmail(input.verifiedEmail),
      permittedModules: unique(input.permittedModules),
      permittedActions: unique(input.permittedActions),
      parentGrantId: null,
    });
    return grant;
  }

  createShareInvitation(input: ShareInvitationInput): IssuedInvitation {
    const now = this.#clock();
    const inviter = this.#requireGrant(input.inviterGrantId);
    this.authorise(input.inviterSession, inviter.grantId, {
      organizationId: inviter.organizationId,
      jobId: inviter.jobId,
      reportVersionId: inviter.reportVersionId,
      module: inviter.permittedModules[0] ?? "building",
      action: "invite_recipient",
    });
    assertFuture(input.expiresAt, now, "Invitation expiry");
    if (Date.parse(input.expiresAt) > Date.parse(inviter.expiresAt)) {
      throw new RecipientAccessDeniedError();
    }
    if (
      input.permittedModules.length === 0 ||
      input.permittedActions.length === 0 ||
      !isSubset(input.permittedModules, inviter.permittedModules) ||
      !isSubset(input.permittedActions, inviter.permittedActions) ||
      input.permittedActions.includes("invite_recipient")
    ) {
      throw new RecipientAccessDeniedError();
    }
    const token = this.#tokenFactory("invite");
    const invitationId = this.#tokenFactory("invitation");
    const invitation: ShareInvitation = Object.freeze({
      invitationId,
      inviterGrantId: inviter.grantId,
      intendedEmail: canonicalEmail(input.intendedEmail),
      organizationId: inviter.organizationId,
      jobId: inviter.jobId,
      reportVersionId: inviter.reportVersionId,
      permittedModules: Object.freeze(unique(input.permittedModules)),
      permittedActions: Object.freeze(unique(input.permittedActions)),
      issuedBy: input.inviterSession.principalId,
      sentAt: now.toISOString(),
      expiresAt: input.expiresAt,
      tokenDigest: this.#digest(`invite:${token}`),
      state: "sent",
      redeemedAt: null,
      redeemedByPrincipalId: null,
      revokedAt: null,
      revokedBy: null,
    });
    this.#invitations.set(invitationId, invitation);
    this.#appendEvent("invitation_sent", {
      principalId: input.inviterSession.principalId,
      grantId: inviter.grantId,
      invitationId,
      reportVersionId: inviter.reportVersionId,
    });
    return { invitation: this.#invitationView(invitation), token };
  }

  redeemInvitation(token: string, session: MailboxSession): RecipientGrant {
    this.#assertSession(session);
    const now = this.#clock();
    const tokenDigest = this.#digest(`invite:${token}`);
    const invitation = [...this.#invitations.values()].find((candidate) =>
      this.#safeEqual(candidate.tokenDigest, tokenDigest),
    );
    if (
      invitation === undefined ||
      this.#invitationState(invitation) !== "sent" ||
      invitation.intendedEmail !== canonicalEmail(session.email)
    ) {
      throw new RecipientAccessDeniedError();
    }
    const inviter = this.#requireGrant(invitation.inviterGrantId);
    this.#assertGrantLineageActive(inviter);
    if (
      inviter.status !== "active" ||
      Date.parse(inviter.expiresAt) <= now.getTime()
    ) {
      throw new RecipientAccessDeniedError();
    }
    const redeemedAt = now.toISOString();
    const redeemed = Object.freeze({
      ...invitation,
      state: "redeemed" as const,
      redeemedAt,
      redeemedByPrincipalId: session.principalId,
    });
    this.#invitations.set(invitation.invitationId, redeemed);
    const grant = this.#storeGrant({
      organizationId: invitation.organizationId,
      jobId: invitation.jobId,
      principalId: session.principalId,
      verifiedEmail: invitation.intendedEmail,
      reportVersionId: invitation.reportVersionId,
      permittedModules: invitation.permittedModules,
      permittedActions: invitation.permittedActions,
      issuedBy: invitation.issuedBy,
      issuedAt: redeemedAt,
      expiresAt: invitation.expiresAt,
      parentGrantId: inviter.grantId,
    });
    this.#appendEvent("invitation_redeemed", {
      principalId: session.principalId,
      grantId: grant.grantId,
      invitationId: invitation.invitationId,
      reportVersionId: grant.reportVersionId,
    });
    return grant;
  }

  invitation(invitationId: string): InvitationView {
    const invitation = this.#invitations.get(invitationId);
    if (invitation === undefined) {
      throw new RecipientAccessDeniedError();
    }
    return this.#invitationView(invitation);
  }

  revokeInvitation(
    invitationId: string,
    actorSession: MailboxSession,
  ): InvitationView {
    this.#assertSession(actorSession);
    const invitation = this.#invitations.get(invitationId);
    if (
      invitation === undefined ||
      invitation.issuedBy !== actorSession.principalId ||
      invitation.state !== "sent"
    ) {
      throw new RecipientAccessDeniedError();
    }
    const revokedAt = this.#clock().toISOString();
    const revoked = Object.freeze({
      ...invitation,
      state: "revoked" as const,
      revokedAt,
      revokedBy: actorSession.principalId,
    });
    this.#invitations.set(invitationId, revoked);
    this.#appendEvent("invitation_revoked", {
      principalId: actorSession.principalId,
      grantId: invitation.inviterGrantId,
      invitationId,
      reportVersionId: invitation.reportVersionId,
    });
    return this.#invitationView(revoked);
  }

  revokeGrant(input: {
    grantId: string;
    revokedBy: string;
    reason: string;
  }): RecipientGrant {
    const grant = this.#requireGrant(input.grantId);
    if (grant.status === "revoked") {
      return grant;
    }
    if (input.reason.trim().length === 0) {
      throw new RecipientInputError("A revocation reason is required");
    }
    const revoked = Object.freeze({
      ...grant,
      status: "revoked" as const,
      revision: grant.revision + 1,
      revokedAt: this.#clock().toISOString(),
      revokedBy: input.revokedBy,
      revocationReason: input.reason.trim(),
    });
    this.#grants.set(grant.grantId, revoked);
    this.#appendEvent("grant_revoked", {
      principalId: grant.principalId,
      grantId: grant.grantId,
      reportVersionId: grant.reportVersionId,
    });
    return revoked;
  }

  authorise(
    session: MailboxSession,
    grantId: string,
    request: AuthorisationRequest,
  ): RecipientGrant {
    try {
      this.#assertSession(session);
      const grant = this.#requireGrant(grantId);
      this.#assertGrantLineageActive(grant);
      const delivered = this.#requireDelivered(
        request.organizationId,
        request.jobId,
        request.reportVersionId,
        [request.module],
      );
      if (
        grant.status !== "active" ||
        grant.principalId !== session.principalId ||
        grant.verifiedEmail !== canonicalEmail(session.email) ||
        Date.parse(grant.expiresAt) <= this.#clock().getTime() ||
        grant.organizationId !== request.organizationId ||
        grant.jobId !== request.jobId ||
        grant.reportVersionId !== request.reportVersionId ||
        !grant.permittedModules.includes(request.module) ||
        !grant.permittedActions.includes(request.action) ||
        delivered.withdrawnModules.includes(request.module)
      ) {
        throw new RecipientAccessDeniedError();
      }
      this.#appendEvent("request_authorised", {
        principalId: session.principalId,
        grantId,
        reportVersionId: request.reportVersionId,
        safeReason: `${request.module}:${request.action}`,
      });
      return grant;
    } catch (error) {
      this.#appendEvent("request_denied", {
        principalId: session.principalId,
        grantId,
        reportVersionId: request.reportVersionId,
        safeReason: "capability_check_failed",
      });
      if (error instanceof RecipientAccessDeniedError) {
        throw error;
      }
      throw new RecipientAccessDeniedError();
    }
  }

  async withAuthorisedRequest<T>(
    session: MailboxSession,
    grantId: string,
    request: AuthorisationRequest,
    operation: () => Promise<T>,
  ): Promise<T> {
    const before = this.authorise(session, grantId, request);
    const result = await operation();
    const after = this.authorise(session, grantId, request);
    if (after.revision !== before.revision || after.status !== "active") {
      throw new RecipientAccessDeniedError();
    }
    return result;
  }

  events(): readonly RecipientAccessEvent[] {
    return Object.freeze([...this.#events]);
  }

  grant(grantId: string): RecipientGrant {
    return this.#requireGrant(grantId);
  }

  #storeGrant(
    input: OwnerGrantInput & {
      parentGrantId: string | null;
      issuedAt?: string;
    },
  ): RecipientGrant {
    const now = this.#clock();
    const grant: RecipientGrant = Object.freeze({
      grantId: this.#tokenFactory("grant"),
      organizationId: input.organizationId,
      jobId: input.jobId,
      principalId: input.principalId,
      verifiedEmail: canonicalEmail(input.verifiedEmail),
      reportVersionId: input.reportVersionId,
      permittedModules: Object.freeze(unique(input.permittedModules)),
      permittedActions: Object.freeze(unique(input.permittedActions)),
      issuedBy: input.issuedBy,
      issuedAt: input.issuedAt ?? now.toISOString(),
      expiresAt: input.expiresAt,
      status: "active",
      revision: 1,
      parentGrantId: input.parentGrantId,
      revokedAt: null,
      revokedBy: null,
      revocationReason: null,
    });
    this.#grants.set(grant.grantId, grant);
    this.#appendEvent("grant_issued", {
      principalId: grant.principalId,
      grantId: grant.grantId,
      reportVersionId: grant.reportVersionId,
    });
    return grant;
  }

  #assertSession(session: MailboxSession): void {
    if (
      !session.active ||
      Date.parse(session.expiresAt) <= this.#clock().getTime() ||
      Date.parse(session.mailboxVerifiedAt) > this.#clock().getTime()
    ) {
      throw new RecipientAccessDeniedError();
    }
  }

  #requireGrant(grantId: string): RecipientGrant {
    const grant = this.#grants.get(grantId);
    if (grant === undefined) {
      throw new RecipientAccessDeniedError();
    }
    return grant;
  }

  #assertGrantLineageActive(grant: RecipientGrant): void {
    const seen = new Set([grant.grantId]);
    let parentGrantId = grant.parentGrantId;
    while (parentGrantId !== null) {
      if (seen.has(parentGrantId)) {
        throw new RecipientAccessDeniedError();
      }
      seen.add(parentGrantId);
      const parent = this.#requireGrant(parentGrantId);
      if (
        parent.status !== "active" ||
        Date.parse(parent.expiresAt) <= this.#clock().getTime()
      ) {
        throw new RecipientAccessDeniedError();
      }
      parentGrantId = parent.parentGrantId;
    }
  }

  #requireDelivered(
    organizationId: string,
    jobId: string,
    reportVersionId: string,
    modules: readonly RecipientModule[],
  ): DeliveredReportVersion {
    const delivered = this.#deliveredVersions.get(
      this.#versionKey({ organizationId, jobId, reportVersionId }),
    );
    if (
      delivered === undefined ||
      modules.length === 0 ||
      !isSubset(modules, delivered.modules)
    ) {
      throw new RecipientAccessDeniedError();
    }
    return delivered;
  }

  #versionKey(input: {
    organizationId: string;
    jobId: string;
    reportVersionId: string;
  }): string {
    return `${input.organizationId}:${input.jobId}:${input.reportVersionId}`;
  }

  #digest(value: string): string {
    return createHmac("sha256", this.#secret).update(value).digest("hex");
  }

  #safeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  #invitationState(invitation: ShareInvitation): ShareInvitationState {
    if (
      invitation.state === "sent" &&
      Date.parse(invitation.expiresAt) <= this.#clock().getTime()
    ) {
      return "expired";
    }
    return invitation.state;
  }

  #invitationView(invitation: ShareInvitation): InvitationView {
    return Object.freeze({
      invitationId: invitation.invitationId,
      intendedEmail: invitation.intendedEmail,
      reportVersionId: invitation.reportVersionId,
      permittedModules: invitation.permittedModules,
      permittedActions: invitation.permittedActions,
      sentAt: invitation.sentAt,
      expiresAt: invitation.expiresAt,
      state: this.#invitationState(invitation),
    });
  }

  #appendEvent(
    type: RecipientAccessEvent["type"],
    fields: Partial<
      Pick<
        RecipientAccessEvent,
        | "principalId"
        | "grantId"
        | "invitationId"
        | "reportVersionId"
        | "safeReason"
      >
    >,
  ): void {
    this.#events.push(
      Object.freeze({
        eventId: this.#tokenFactory("access_event"),
        occurredAt: this.#clock().toISOString(),
        type,
        principalId: fields.principalId ?? null,
        grantId: fields.grantId ?? null,
        invitationId: fields.invitationId ?? null,
        reportVersionId: fields.reportVersionId ?? null,
        safeReason: fields.safeReason ?? null,
      }),
    );
  }
}
