export const PRIVILEGED_ACTIONS = [
  "approve_module",
  "deliver_report",
  "share_report",
  "revoke_access",
  "withdraw_report",
  "create_amendment",
  "export_protected_data",
  "place_lifecycle_hold",
  "revoke_device",
  "rotate_secret",
  "enable_restore_egress",
  "disable_restore_egress",
] as const;

export type PrivilegedAction = (typeof PRIVILEGED_ACTIONS)[number];

export type PrivilegedRole = "administrator" | "inspector" | "support";

export type PrivilegedSessionEvidence = {
  readonly actorId: string;
  readonly organizationId: string;
  readonly role: PrivilegedRole;
  readonly membershipStatus: "active" | "suspended" | "revoked";
  readonly professionalEligibility:
    "eligible" | "ineligible" | "not_applicable";
  readonly aal: "aal1" | "aal2";
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly lastActivityAt: string;
  readonly mfaVerifiedAt: string | null;
  readonly revokedAt: string | null;
  readonly device: {
    readonly deviceId: string;
    readonly registeredOrganizationId: string;
    readonly registeredActorId: string;
    readonly revokedAt: string | null;
  };
};

export type AuthorizationDenialCode =
  | "wrong_tenant"
  | "membership_inactive"
  | "role_not_allowed"
  | "professional_ineligible"
  | "aal2_required"
  | "recent_auth_required"
  | "session_expired"
  | "session_idle_expired"
  | "session_absolute_expired"
  | "session_revoked"
  | "device_mismatch"
  | "device_revoked";

export type PrivilegedAuthorizationDecision =
  | {
      readonly allowed: true;
      readonly actorId: string;
      readonly organizationId: string;
      readonly action: PrivilegedAction;
      readonly stepUpAgeSeconds: number;
    }
  | {
      readonly allowed: false;
      readonly code: AuthorizationDenialCode;
    };

export const DEFAULT_SESSION_POLICY = Object.freeze({
  recentAuthMilliseconds: 15 * 60 * 1_000,
  idleMilliseconds: 30 * 60 * 1_000,
  absoluteMilliseconds: 12 * 60 * 60 * 1_000,
});

const ACTION_ROLES: Readonly<
  Record<PrivilegedAction, readonly PrivilegedRole[]>
> = {
  approve_module: ["inspector"],
  deliver_report: ["inspector", "administrator"],
  share_report: ["inspector", "administrator"],
  revoke_access: ["inspector", "administrator", "support"],
  withdraw_report: ["inspector"],
  create_amendment: ["inspector"],
  export_protected_data: ["administrator"],
  place_lifecycle_hold: ["administrator"],
  revoke_device: ["administrator", "support"],
  rotate_secret: ["administrator"],
  enable_restore_egress: ["administrator"],
  disable_restore_egress: ["administrator"],
};

export function authorizePrivilegedAction(input: {
  readonly action: PrivilegedAction;
  readonly organizationId: string;
  readonly session: PrivilegedSessionEvidence;
  readonly now: string;
  readonly policy?: typeof DEFAULT_SESSION_POLICY;
}): PrivilegedAuthorizationDecision {
  const policy = input.policy ?? DEFAULT_SESSION_POLICY;
  const now = timestamp(input.now);
  const session = input.session;
  if (session.organizationId !== input.organizationId) {
    return denial("wrong_tenant");
  }
  if (session.membershipStatus !== "active") {
    return denial("membership_inactive");
  }
  if (!ACTION_ROLES[input.action].includes(session.role)) {
    return denial("role_not_allowed");
  }
  if (
    ["approve_module", "create_amendment", "withdraw_report"].includes(
      input.action,
    ) &&
    session.professionalEligibility !== "eligible"
  ) {
    return denial("professional_ineligible");
  }
  if (session.revokedAt !== null) {
    return denial("session_revoked");
  }
  if (timestamp(session.expiresAt) <= now) {
    return denial("session_expired");
  }
  if (now - timestamp(session.lastActivityAt) > policy.idleMilliseconds) {
    return denial("session_idle_expired");
  }
  if (now - timestamp(session.issuedAt) > policy.absoluteMilliseconds) {
    return denial("session_absolute_expired");
  }
  if (session.aal !== "aal2") {
    return denial("aal2_required");
  }
  if (session.mfaVerifiedAt === null) {
    return denial("recent_auth_required");
  }
  const stepUpAge = now - timestamp(session.mfaVerifiedAt);
  if (stepUpAge < 0 || stepUpAge > policy.recentAuthMilliseconds) {
    return denial("recent_auth_required");
  }
  if (
    session.device.registeredOrganizationId !== session.organizationId ||
    session.device.registeredActorId !== session.actorId
  ) {
    return denial("device_mismatch");
  }
  if (session.device.revokedAt !== null) {
    return denial("device_revoked");
  }
  return Object.freeze({
    allowed: true,
    actorId: session.actorId,
    organizationId: session.organizationId,
    action: input.action,
    stepUpAgeSeconds: Math.floor(stepUpAge / 1_000),
  });
}

export function requirePrivilegedAction(
  input: Parameters<typeof authorizePrivilegedAction>[0],
): Extract<PrivilegedAuthorizationDecision, { readonly allowed: true }> {
  const decision = authorizePrivilegedAction(input);
  if (!decision.allowed) {
    throw new AuthorizationDeniedError(decision.code);
  }
  return decision;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Security timestamps must be valid ISO date-time values");
  }
  return parsed;
}

function denial(
  code: AuthorizationDenialCode,
): PrivilegedAuthorizationDecision {
  return Object.freeze({ allowed: false, code });
}

export class AuthorizationDeniedError extends Error {
  readonly code: AuthorizationDenialCode;

  constructor(code: AuthorizationDenialCode) {
    super("Privileged action requires a current authorised session");
    this.name = "AuthorizationDeniedError";
    this.code = code;
  }
}
