import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import {
  recipientStateAuthority,
  type DemoContactRequest,
  type DemoRecipientAction,
  type DemoRecipientModule,
  type DemoShareInvitation,
} from "./recipient-authority";

export const RECIPIENT_SESSION_COOKIE = "inspection_recipient_session";
export const RECIPIENT_PENDING_COOKIE = "inspection_recipient_pending";

export type PortalSession = Readonly<{
  kind: "recipient_session";
  sessionId: string;
  grantId: string;
  principalId: string;
  verifiedEmail: string;
  organizationId: "org_demo";
  jobId: "job_demo_cracked_tile";
  reportVersionId: "report_demo_v2";
  modules: readonly DemoRecipientModule[];
  actions: readonly DemoRecipientAction[];
  issuedAt: number;
  expiresAt: number;
  grantRevision: number;
}>;

type PendingSession = Readonly<{
  kind: "pending_mailbox_verification";
  challengeId: string;
  invitationDigest: string;
  intendedEmail: string;
  issuedAt: number;
  expiresAt: number;
}>;

export class DemoRecipientAuthError extends Error {
  constructor() {
    super("This invitation is unavailable or no longer valid");
    this.name = "DemoRecipientAuthError";
  }
}

export function demoRecipientAuthEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return (
    process.env.BUILD_WEEK_FIXTURES_ENABLED === "true" &&
    process.env.RECIPIENT_DEMO_ACCESS_ENABLED === "true"
  );
}

export async function beginDemoInvitation(input: {
  invitationToken: string;
  email: string;
}): Promise<string> {
  if (!demoRecipientAuthEnabled()) {
    throw new DemoRecipientAuthError();
  }
  const token = input.invitationToken.trim();
  const email = input.email.trim().toLocaleLowerCase("en-AU");
  if (
    !token.startsWith("demo-invite-") ||
    token.length < 18 ||
    email !== "recipient@example.com"
  ) {
    throw new DemoRecipientAuthError();
  }
  try {
    const now = Date.now();
    const claimed = await recipientStateAuthority().claimInvitation({
      invitationToken: token,
      intendedEmail: email,
      now,
    });
    return sign({
      kind: "pending_mailbox_verification",
      challengeId: claimed.challengeId,
      invitationDigest: claimed.invitationDigest,
      intendedEmail: email,
      issuedAt: now,
      expiresAt: claimed.expiresAt,
    } satisfies PendingSession);
  } catch {
    throw new DemoRecipientAuthError();
  }
}

export async function completeDemoOtp(
  pendingToken: string,
  otp: string,
): Promise<string> {
  const pending = verify<PendingSession>(pendingToken);
  const configuredOtp = process.env.RECIPIENT_DEMO_OTP;
  const expectedOtp =
    configuredOtp ?? (process.env.NODE_ENV === "production" ? "" : "482913");
  if (
    pending?.kind !== "pending_mailbox_verification" ||
    pending.expiresAt <= Date.now() ||
    expectedOtp.length !== 6 ||
    !safeEqual(otp.trim(), expectedOtp)
  ) {
    throw new DemoRecipientAuthError();
  }
  try {
    const grant = await recipientStateAuthority().issueGrant({
      challengeId: pending.challengeId,
      invitationDigest: pending.invitationDigest,
      intendedEmail: pending.intendedEmail,
    });
    return sign({
      kind: "recipient_session",
      sessionId: `demo_session_${grant.grantId}`,
      grantId: grant.grantId,
      principalId: grant.principalId,
      verifiedEmail: grant.verifiedEmail,
      organizationId: grant.organizationId,
      jobId: grant.jobId,
      reportVersionId: grant.reportVersionId,
      modules: grant.modules,
      actions: grant.actions,
      issuedAt: grant.issuedAt,
      expiresAt: grant.expiresAt,
      grantRevision: grant.revision,
    } satisfies PortalSession);
  } catch {
    throw new DemoRecipientAuthError();
  }
}

export async function readPendingSessionToken(): Promise<string | null> {
  return (await cookies()).get(RECIPIENT_PENDING_COOKIE)?.value ?? null;
}

export async function readPortalSession(): Promise<PortalSession | null> {
  if (!demoRecipientAuthEnabled()) return null;
  const value = (await cookies()).get(RECIPIENT_SESSION_COOKIE)?.value;
  if (value === undefined) {
    return null;
  }
  const session = verify<PortalSession>(value);
  if (
    session?.kind !== "recipient_session" ||
    session.expiresAt <= Date.now()
  ) {
    return null;
  }
  return session;
}

export async function authorisePortalRequest(
  session: PortalSession | null,
  request: Readonly<{
    reportVersionId: string;
    module: DemoRecipientModule;
    action: DemoRecipientAction;
  }>,
): Promise<PortalSession> {
  if (
    !demoRecipientAuthEnabled() ||
    session === null ||
    typeof session.grantId !== "string" ||
    session.organizationId !== "org_demo" ||
    session.jobId !== "job_demo_cracked_tile" ||
    session.reportVersionId !== request.reportVersionId ||
    !session.modules.includes(request.module) ||
    !session.actions.includes(request.action) ||
    session.expiresAt <= Date.now()
  ) {
    throw new DemoRecipientAuthError();
  }
  try {
    await recipientStateAuthority().authorise(session, request);
    return session;
  } catch {
    throw new DemoRecipientAuthError();
  }
}

export async function demoPortalState(session: PortalSession): Promise<
  Readonly<{
    buildingWithdrawn: boolean;
    shareInvitations: readonly DemoShareInvitation[];
    contactRequests: readonly DemoContactRequest[];
  }>
> {
  return recipientStateAuthority().portalState(session);
}

export async function revokeCurrentDemoGrant(
  session: PortalSession,
): Promise<void> {
  await recipientStateAuthority().revokeGrant(session);
}

export function recipientCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

function sign(payload: PortalSession | PendingSession): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

function verify<T extends PortalSession | PendingSession>(
  token: string,
): T | null {
  const [encoded, suppliedSignature, ...extra] = token.split(".");
  if (
    encoded === undefined ||
    suppliedSignature === undefined ||
    extra.length > 0 ||
    !safeEqual(signature(encoded), suppliedSignature)
  ) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function signature(value: string): string {
  return createHmac("sha256", recipientSessionSecret())
    .update(value)
    .digest("base64url");
}

function recipientSessionSecret(): string {
  const configured = process.env.RECIPIENT_SESSION_SECRET;
  if (configured !== undefined && configured.length >= 32) {
    return configured;
  }
  if (process.env.NODE_ENV !== "production") {
    return "local-only-recipient-session-secret-do-not-deploy";
  }
  throw new Error(
    "RECIPIENT_SESSION_SECRET must be configured before recipient access is enabled",
  );
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
