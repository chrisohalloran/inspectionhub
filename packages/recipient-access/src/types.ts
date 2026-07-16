export type RecipientModule = "building" | "timber_pest";

export type RecipientAction =
  | "read_report"
  | "download_pdf"
  | "view_curated_media"
  | "view_history"
  | "contact_inspector"
  | "invite_recipient";

export type MailboxSession = Readonly<{
  sessionId: string;
  principalId: string;
  email: string;
  mailboxVerifiedAt: string;
  authenticatedAt: string;
  expiresAt: string;
  active: boolean;
}>;

export type RecipientGrant = Readonly<{
  grantId: string;
  organizationId: string;
  jobId: string;
  principalId: string;
  verifiedEmail: string;
  reportVersionId: string;
  permittedModules: readonly RecipientModule[];
  permittedActions: readonly RecipientAction[];
  issuedBy: string;
  issuedAt: string;
  expiresAt: string;
  status: "active" | "revoked";
  revision: number;
  parentGrantId: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revocationReason: string | null;
}>;

export type ShareInvitationState = "sent" | "redeemed" | "expired" | "revoked";

export type ShareInvitation = Readonly<{
  invitationId: string;
  inviterGrantId: string;
  intendedEmail: string;
  organizationId: string;
  jobId: string;
  reportVersionId: string;
  permittedModules: readonly RecipientModule[];
  permittedActions: readonly RecipientAction[];
  issuedBy: string;
  sentAt: string;
  expiresAt: string;
  tokenDigest: string;
  state: Exclude<ShareInvitationState, "expired">;
  redeemedAt: string | null;
  redeemedByPrincipalId: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
}>;

export type InvitationView = Readonly<{
  invitationId: string;
  intendedEmail: string;
  reportVersionId: string;
  permittedModules: readonly RecipientModule[];
  permittedActions: readonly RecipientAction[];
  sentAt: string;
  expiresAt: string;
  state: ShareInvitationState;
}>;

export type AuthorisationRequest = Readonly<{
  organizationId: string;
  jobId: string;
  reportVersionId: string;
  module: RecipientModule;
  action: RecipientAction;
}>;

export type MailboxChallenge = Readonly<{
  challengeId: string;
  email: string;
  otpDigest: string;
  issuedAt: string;
  expiresAt: string;
  failedAttempts: number;
  consumedAt: string | null;
}>;

export type DeliveredReportVersion = Readonly<{
  organizationId: string;
  jobId: string;
  reportVersionId: string;
  modules: readonly RecipientModule[];
  deliveredAt: string;
  withdrawnModules: readonly RecipientModule[];
}>;

export type RecipientAccessEvent = Readonly<{
  eventId: string;
  occurredAt: string;
  type:
    | "mailbox_challenge_issued"
    | "mailbox_verified"
    | "grant_issued"
    | "grant_revoked"
    | "invitation_sent"
    | "invitation_redeemed"
    | "invitation_revoked"
    | "request_authorised"
    | "request_denied"
    | "version_delivered"
    | "module_withdrawn";
  principalId: string | null;
  grantId: string | null;
  invitationId: string | null;
  reportVersionId: string | null;
  safeReason: string | null;
}>;
