import { createHmac } from "node:crypto";

import { DemoRecipientStateStore } from "./recipient-demo-store";

export type DemoRecipientModule = "building" | "timber_pest";
export type DemoRecipientAction =
  | "read_report"
  | "download_pdf"
  | "view_curated_media"
  | "view_history"
  | "contact_inspector"
  | "invite_recipient";

export type DemoGrant = Readonly<{
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
  revision: number;
  status: "active" | "revoked";
}>;

export type DemoShareInvitation = Readonly<{
  invitationId: string;
  grantId: string;
  email: string;
  recordedAt: number;
  expiresAt: number;
  state: "recorded" | "redeemed" | "expired" | "revoked";
}>;

export type DemoContactRequest = Readonly<{
  contactRequestId: string;
  grantId: string;
  findingReference: string | null;
  recordedAt: number;
  state: "recorded";
}>;

export type AuthoritySession = Readonly<{
  grantId: string;
  grantRevision: number;
  principalId: string;
  verifiedEmail: string;
  organizationId: string;
  jobId: string;
  reportVersionId: string;
  expiresAt: number;
}>;

export type PortalState = Readonly<{
  buildingWithdrawn: boolean;
  shareInvitations: readonly DemoShareInvitation[];
  contactRequests: readonly DemoContactRequest[];
}>;

export interface RecipientStateAuthority {
  claimInvitation(input: {
    invitationToken: string;
    intendedEmail: string;
    now?: number;
  }): Promise<
    Readonly<{
      challengeId: string;
      invitationDigest: string;
      intendedEmail: string;
      expiresAt: number;
    }>
  >;
  issueGrant(input: {
    challengeId: string;
    invitationDigest: string;
    intendedEmail: string;
    now?: number;
  }): Promise<DemoGrant>;
  authorise(
    session: AuthoritySession,
    request: Readonly<{
      reportVersionId: string;
      module: DemoRecipientModule;
      action: DemoRecipientAction;
    }>,
    _now?: number,
  ): Promise<DemoGrant>;
  portalState(session: AuthoritySession, now?: number): Promise<PortalState>;
  revokeGrant(session: AuthoritySession): Promise<void>;
  recordShareInvitation(input: {
    session: AuthoritySession;
    email: string;
    expiresAt: number;
  }): Promise<DemoShareInvitation>;
  revokeShareInvitation(input: {
    session: AuthoritySession;
    invitationId: string;
  }): Promise<DemoShareInvitation>;
  recordContactRequest(input: {
    session: AuthoritySession;
    findingReference: string | null;
    module: DemoRecipientModule | null;
  }): Promise<DemoContactRequest>;
}

export class RecipientAuthorityError extends Error {
  constructor(message = "Recipient authority is unavailable") {
    super(message);
    this.name = "RecipientAuthorityError";
  }
}

type RpcFetch = (
  input: string,
  init: RequestInit,
) => Promise<Readonly<{ ok: boolean; json(): Promise<unknown> }>>;

export class SupabaseRecipientStateAuthority implements RecipientStateAuthority {
  readonly #endpoint: string;
  readonly #serviceRoleKey: string;
  readonly #hashSecret: string;
  readonly #fetcher: RpcFetch;

  constructor(
    input: Readonly<{
      supabaseUrl: string;
      serviceRoleKey: string;
      hashSecret: string;
      fetcher?: RpcFetch;
    }>,
  ) {
    if (!/^https?:\/\//u.test(input.supabaseUrl)) {
      throw new RecipientAuthorityError("Recipient authority URL is invalid");
    }
    if (input.serviceRoleKey.length < 16 || input.hashSecret.length < 32) {
      throw new RecipientAuthorityError(
        "Recipient authority credentials are invalid",
      );
    }
    this.#endpoint = `${input.supabaseUrl.replace(/\/+$/u, "")}/rest/v1/rpc`;
    this.#serviceRoleKey = input.serviceRoleKey;
    this.#hashSecret = input.hashSecret;
    this.#fetcher = input.fetcher ?? fetch;
  }

  async claimInvitation(input: {
    invitationToken: string;
    intendedEmail: string;
    now?: number;
  }) {
    const row = await this.#rpc("command_recipient_demo_claim_invitation", {
      target_intended_email: input.intendedEmail,
      target_invitation_digest: this.#digest(
        `invitation:${input.invitationToken}`,
      ),
    });
    return parseChallenge(row);
  }

  async issueGrant(input: {
    challengeId: string;
    invitationDigest: string;
    intendedEmail: string;
    now?: number;
  }): Promise<DemoGrant> {
    return parseGrant(
      await this.#rpc("command_recipient_demo_issue_grant", {
        target_challenge_id: input.challengeId,
        target_intended_email: input.intendedEmail,
        target_invitation_digest: input.invitationDigest,
      }),
    );
  }

  async authorise(
    session: AuthoritySession,
    request: Readonly<{
      reportVersionId: string;
      module: DemoRecipientModule;
      action: DemoRecipientAction;
    }>,
  ): Promise<DemoGrant> {
    return parseGrant(
      await this.#rpc("command_recipient_demo_authorise", {
        ...sessionEnvelope(session),
        target_action: request.action,
        target_module: request.module,
        target_report_version_id: request.reportVersionId,
      }),
    );
  }

  async portalState(session: AuthoritySession): Promise<PortalState> {
    const row = record(
      await this.#rpc("command_recipient_demo_portal_state", {
        ...sessionEnvelope(session),
      }),
    );
    if (
      typeof row.buildingWithdrawn !== "boolean" ||
      !Array.isArray(row.shareInvitations) ||
      !Array.isArray(row.contactRequests)
    ) {
      throw new RecipientAuthorityError();
    }
    return {
      buildingWithdrawn: row.buildingWithdrawn,
      shareInvitations: row.shareInvitations.map(parseInvitation),
      contactRequests: row.contactRequests.map(parseContactRequest),
    };
  }

  async revokeGrant(session: AuthoritySession): Promise<void> {
    await this.#rpc("command_recipient_demo_revoke_grant", {
      ...sessionEnvelope(session),
    });
  }

  async recordShareInvitation(input: {
    session: AuthoritySession;
    email: string;
    expiresAt: number;
  }): Promise<DemoShareInvitation> {
    return parseInvitation(
      await this.#rpc("command_recipient_demo_record_share", {
        ...sessionEnvelope(input.session),
        target_email: input.email,
        target_share_expires_at: new Date(input.expiresAt).toISOString(),
      }),
    );
  }

  async revokeShareInvitation(input: {
    session: AuthoritySession;
    invitationId: string;
  }): Promise<DemoShareInvitation> {
    return parseInvitation(
      await this.#rpc("command_recipient_demo_revoke_share", {
        ...sessionEnvelope(input.session),
        target_invitation_id: input.invitationId,
      }),
    );
  }

  async recordContactRequest(input: {
    session: AuthoritySession;
    findingReference: string | null;
    module: DemoRecipientModule | null;
  }): Promise<DemoContactRequest> {
    return parseContactRequest(
      await this.#rpc("command_recipient_demo_record_contact", {
        ...sessionEnvelope(input.session),
        target_finding_reference: input.findingReference,
        target_module: input.module,
      }),
    );
  }

  async #rpc(command: string, body: Readonly<Record<string, unknown>>) {
    let response: Awaited<ReturnType<RpcFetch>>;
    try {
      response = await this.#fetcher(`${this.#endpoint}/${command}`, {
        body: JSON.stringify(body),
        cache: "no-store",
        headers: {
          apikey: this.#serviceRoleKey,
          authorization: `Bearer ${this.#serviceRoleKey}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
    } catch {
      throw new RecipientAuthorityError();
    }
    if (!response.ok) throw new RecipientAuthorityError();
    try {
      return await response.json();
    } catch {
      throw new RecipientAuthorityError();
    }
  }

  #digest(value: string): string {
    return createHmac("sha256", this.#hashSecret)
      .update(value)
      .digest("base64url");
  }
}

export function recipientStateAuthority(): RecipientStateAuthority {
  const adapter = process.env.RECIPIENT_AUTHORITY_ADAPTER?.trim() || "supabase";
  if (adapter === "fixture") {
    if (
      process.env.APP_ENV !== "test" ||
      process.env.BUILD_WEEK_FIXTURES_ENABLED !== "true" ||
      process.env.RECIPIENT_DEMO_ACCESS_ENABLED !== "true"
    ) {
      throw new RecipientAuthorityError(
        "The filesystem recipient fixture is restricted to the test harness",
      );
    }
    return DemoRecipientStateStore.fromEnvironment();
  }
  if (adapter !== "supabase") {
    throw new RecipientAuthorityError(
      "RECIPIENT_AUTHORITY_ADAPTER must be supabase outside the test harness",
    );
  }
  return new SupabaseRecipientStateAuthority({
    supabaseUrl: firstEnvironment(
      "SUPABASE_API_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
    ),
    serviceRoleKey: requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    hashSecret: requiredEnvironment("RECIPIENT_SESSION_SECRET"),
  });
}

function firstEnvironment(primary: string, fallback: string): string {
  const value =
    process.env[primary]?.trim() || process.env[fallback]?.trim() || "";
  if (!value) {
    throw new RecipientAuthorityError(`Missing ${primary} or ${fallback}`);
  }
  return value;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new RecipientAuthorityError(`Missing ${name}`);
  return value;
}

function sessionEnvelope(session: AuthoritySession) {
  return {
    target_grant_id: session.grantId,
    target_grant_revision: session.grantRevision,
    target_job_id: session.jobId,
    target_organization_id: session.organizationId,
    target_principal_id: session.principalId,
    target_report_version_id: session.reportVersionId,
    target_verified_email: session.verifiedEmail,
  };
}

function parseChallenge(value: unknown) {
  const row = record(value);
  const challengeId = textField(row, "challengeId");
  const invitationDigest = textField(row, "invitationDigest");
  const intendedEmail = textField(row, "intendedEmail");
  return {
    challengeId,
    invitationDigest,
    intendedEmail,
    expiresAt: dateField(row, "expiresAt"),
  };
}

function parseGrant(value: unknown): DemoGrant {
  const row = record(value);
  const modules = stringArray(row.modules);
  const actions = stringArray(row.actions);
  if (
    row.organizationId !== "org_demo" ||
    row.jobId !== "job_demo_cracked_tile" ||
    row.reportVersionId !== "report_demo_v2" ||
    !modules.every(isModule) ||
    !actions.every(isAction) ||
    (row.status !== "active" && row.status !== "revoked")
  ) {
    throw new RecipientAuthorityError();
  }
  return {
    grantId: textField(row, "grantId"),
    principalId: textField(row, "principalId"),
    verifiedEmail: textField(row, "verifiedEmail"),
    organizationId: row.organizationId,
    jobId: row.jobId,
    reportVersionId: row.reportVersionId,
    modules,
    actions,
    issuedAt: dateField(row, "issuedAt"),
    expiresAt: dateField(row, "expiresAt"),
    revision: integerField(row, "revision"),
    status: row.status,
  };
}

function parseInvitation(value: unknown): DemoShareInvitation {
  const row = record(value);
  if (
    row.state !== "recorded" &&
    row.state !== "redeemed" &&
    row.state !== "expired" &&
    row.state !== "revoked"
  ) {
    throw new RecipientAuthorityError();
  }
  return {
    invitationId: textField(row, "invitationId"),
    grantId: textField(row, "grantId"),
    email: textField(row, "email"),
    recordedAt: dateField(row, "recordedAt"),
    expiresAt: dateField(row, "expiresAt"),
    state: row.state,
  };
}

function parseContactRequest(value: unknown): DemoContactRequest {
  const row = record(value);
  if (row.state !== "recorded") throw new RecipientAuthorityError();
  return {
    contactRequestId: textField(row, "contactRequestId"),
    grantId: textField(row, "grantId"),
    findingReference:
      row.findingReference === null ? null : textField(row, "findingReference"),
    recordedAt: dateField(row, "recordedAt"),
    state: row.state,
  };
}

function record(value: unknown): Record<string, unknown> {
  const candidate: unknown = Array.isArray(value)
    ? (value as readonly unknown[])[0]
    : value;
  if (typeof candidate !== "object" || candidate === null) {
    throw new RecipientAuthorityError();
  }
  return candidate as Record<string, unknown>;
}

function textField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new RecipientAuthorityError();
  }
  return value;
}

function dateField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  const timestamp =
    typeof value === "number" ? value : Date.parse(textField(row, key));
  if (!Number.isFinite(timestamp)) throw new RecipientAuthorityError();
  return timestamp;
}

function integerField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new RecipientAuthorityError();
  }
  return value as number;
}

function stringArray(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new RecipientAuthorityError();
  }
  return value;
}

function isModule(value: string): value is DemoRecipientModule {
  return value === "building" || value === "timber_pest";
}

function isAction(value: string): value is DemoRecipientAction {
  return [
    "read_report",
    "download_pdf",
    "view_curated_media",
    "view_history",
    "contact_inspector",
    "invite_recipient",
  ].includes(value);
}
