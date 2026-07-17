import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

import type {
  AuthoritySession,
  DemoContactRequest,
  DemoGrant,
  DemoRecipientAction,
  DemoRecipientModule,
  DemoShareInvitation,
  PortalState,
  RecipientStateAuthority,
} from "./recipient-authority";
import {
  canonicalReservedDemoEmail,
  DEMO_CONTACT_REQUEST_LIMIT,
  DEMO_REPORT_CONTACT_WINDOW_LIMIT,
  DEMO_REPORT_MUTATION_WINDOW_MS,
  DEMO_REPORT_SHARE_WINDOW_LIMIT,
  DEMO_SHARE_REQUEST_LIMIT,
} from "./recipient-demo-policy";
import { RecipientMutationLimitError } from "./recipient-mutation-error";

export type {
  DemoContactRequest,
  DemoGrant,
  DemoRecipientAction,
  DemoRecipientModule,
  DemoShareInvitation,
} from "./recipient-authority";

type InvitationClaimedEvent = Readonly<{
  eventId: string;
  type: "invitation.claimed";
  occurredAt: number;
  invitationDigest: string;
  challengeId: string;
  intendedEmail: string;
  expiresAt: number;
}>;

type DemoEvent =
  | InvitationClaimedEvent
  | Readonly<{
      eventId: string;
      type: "grant.issued";
      occurredAt: number;
      challengeId: string;
      grant: DemoGrant;
    }>
  | Readonly<{
      eventId: string;
      type: "grant.revoked";
      occurredAt: number;
      grantId: string;
      revision: number;
      safeReason: string;
    }>
  | Readonly<{
      eventId: string;
      type: "module.withdrawn" | "module.restored";
      occurredAt: number;
      module: DemoRecipientModule;
    }>
  | Readonly<{
      eventId: string;
      type: "share.recorded";
      occurredAt: number;
      invitation: DemoShareInvitation;
    }>
  | Readonly<{
      eventId: string;
      type: "share.revoked";
      occurredAt: number;
      invitationId: string;
      grantId: string;
    }>
  | Readonly<{
      eventId: string;
      type: "contact.recorded";
      occurredAt: number;
      request: DemoContactRequest;
    }>;

type Projection = Readonly<{
  invitationClaims: ReadonlyMap<string, InvitationClaimedEvent>;
  challenges: ReadonlyMap<string, InvitationClaimedEvent>;
  completedChallenges: ReadonlySet<string>;
  grants: ReadonlyMap<string, DemoGrant>;
  withdrawnModules: ReadonlySet<DemoRecipientModule>;
  invitations: ReadonlyMap<string, DemoShareInvitation>;
  contactRequests: readonly DemoContactRequest[];
}>;

export class DemoRecipientStateError extends Error {
  constructor(message = "Demo recipient state is unavailable") {
    super(message);
    this.name = "DemoRecipientStateError";
  }
}

/**
 * Synthetic, signed JSONL adapter used only by the local E2E harness.
 *
 * Every mutation takes an exclusive process-shared file claim and fails closed
 * on contention. Public deployments must use the Supabase RPC authority.
 */
export class DemoRecipientStateStore implements RecipientStateAuthority {
  readonly #filePath: string;
  readonly #secret: string;

  constructor(input: Readonly<{ filePath: string; secret: string }>) {
    if (input.secret.length < 32 || !isAbsolute(input.filePath)) {
      throw new DemoRecipientStateError("Demo state configuration is invalid");
    }
    this.#filePath = input.filePath;
    this.#secret = input.secret;
  }

  static fromEnvironment(): DemoRecipientStateStore {
    const configuredPath = process.env.RECIPIENT_DEMO_STATE_FILE?.trim();
    return new DemoRecipientStateStore({
      filePath:
        configuredPath && configuredPath.length > 0
          ? configuredPath
          : join(tmpdir(), "inspectionhub-recipient-demo-state-v2.jsonl"),
      secret: recipientDemoStateSecret(),
    });
  }

  async claimInvitation(input: {
    invitationToken: string;
    intendedEmail: string;
    now?: number;
  }) {
    await Promise.resolve();
    return this.#mutate((projection) => {
      const now = input.now ?? Date.now();
      const invitationDigest = this.#digest(
        `invitation:${input.invitationToken}`,
      );
      if (projection.invitationClaims.has(invitationDigest)) {
        throw new DemoRecipientStateError();
      }
      const event: InvitationClaimedEvent = {
        eventId: randomUUID(),
        type: "invitation.claimed",
        occurredAt: now,
        invitationDigest,
        challengeId: `demo_challenge_${randomUUID()}`,
        intendedEmail: input.intendedEmail,
        expiresAt: now + 10 * 60_000,
      };
      this.#append(event);
      return event;
    });
  }

  async issueGrant(input: {
    challengeId: string;
    invitationDigest: string;
    intendedEmail: string;
    now?: number;
  }): Promise<DemoGrant> {
    await Promise.resolve();
    return this.#mutate((projection) => {
      const now = input.now ?? Date.now();
      const challenge = projection.challenges.get(input.challengeId);
      if (
        challenge === undefined ||
        challenge.expiresAt <= now ||
        challenge.intendedEmail !== input.intendedEmail ||
        !safeEqual(challenge.invitationDigest, input.invitationDigest) ||
        projection.completedChallenges.has(input.challengeId)
      ) {
        throw new DemoRecipientStateError();
      }
      const grant: DemoGrant = Object.freeze({
        grantId: `demo_grant_${randomUUID()}`,
        principalId: "principal_demo_recipient",
        verifiedEmail: challenge.intendedEmail,
        organizationId: "org_demo",
        jobId: "job_demo_cracked_tile",
        reportVersionId: "report_demo_v2",
        modules: Object.freeze(["building", "timber_pest"] as const),
        actions: Object.freeze([
          "read_report",
          "download_pdf",
          "view_curated_media",
          "view_history",
          "contact_inspector",
          "invite_recipient",
        ] as const),
        issuedAt: now,
        expiresAt: now + 60 * 60_000,
        revision: 1,
        status: "active",
      });
      this.#append({
        eventId: randomUUID(),
        type: "grant.issued",
        occurredAt: now,
        challengeId: input.challengeId,
        grant,
      });
      return grant;
    });
  }

  async authorise(
    session: AuthoritySession,
    request: Readonly<{
      reportVersionId: string;
      module: DemoRecipientModule;
      action: DemoRecipientAction;
    }>,
    now = Date.now(),
  ): Promise<DemoGrant> {
    await Promise.resolve();
    const projection = this.#project();
    const grant = grantForSession(projection, session, now);
    if (
      grant.reportVersionId !== request.reportVersionId ||
      !grant.modules.includes(request.module) ||
      !grant.actions.includes(request.action) ||
      projection.withdrawnModules.has(request.module)
    ) {
      throw new DemoRecipientStateError();
    }
    return grant;
  }

  async portalState(
    session: AuthoritySession,
    now = Date.now(),
  ): Promise<PortalState> {
    await Promise.resolve();
    const projection = this.#project();
    const grant = grantForSession(projection, session, now);
    const buildingWithdrawn = projection.withdrawnModules.has("building");
    const timberPestWithdrawn = projection.withdrawnModules.has("timber_pest");
    const activeModule = grant.modules.some(
      (module) => !projection.withdrawnModules.has(module),
    );
    if (!grant.actions.includes("read_report") || !activeModule) {
      throw new DemoRecipientStateError();
    }
    return {
      buildingWithdrawn,
      timberPestWithdrawn,
      shareInvitations: invitationsFor(projection, grant.grantId, now),
      contactRequests: contactsFor(projection, grant.grantId),
    };
  }

  async revokeGrant(session: AuthoritySession): Promise<void> {
    await Promise.resolve();
    this.#mutate((projection) => {
      const grant = grantForSession(projection, session, Date.now());
      this.#append({
        eventId: randomUUID(),
        type: "grant.revoked",
        occurredAt: Date.now(),
        grantId: grant.grantId,
        revision: grant.revision + 1,
        safeReason: "recipient_session_ended",
      });
    });
  }

  async recordShareInvitation(input: {
    session: AuthoritySession;
    email: string;
    expiresAt: number;
  }): Promise<DemoShareInvitation> {
    await Promise.resolve();
    return this.#mutate((projection) => {
      const now = Date.now();
      const grant = grantForSession(projection, input.session, now);
      let email: string;
      try {
        email = canonicalReservedDemoEmail(input.email);
      } catch {
        throw new DemoRecipientStateError();
      }
      let grantShareCount = 0;
      let reportShareWindowCount = 0;
      for (const invitation of projection.invitations.values()) {
        if (invitation.grantId === grant.grantId) grantShareCount += 1;
        if (
          invitation.recordedAt >= now - DEMO_REPORT_MUTATION_WINDOW_MS &&
          projection.grants.get(invitation.grantId)?.reportVersionId ===
            grant.reportVersionId
        ) {
          reportShareWindowCount += 1;
        }
        if (
          grantShareCount >= DEMO_SHARE_REQUEST_LIMIT &&
          reportShareWindowCount >= DEMO_REPORT_SHARE_WINDOW_LIMIT
        ) {
          break;
        }
      }
      if (
        !grant.actions.includes("invite_recipient") ||
        input.expiresAt <= now ||
        input.expiresAt > grant.expiresAt ||
        !grant.modules.some(
          (module) => !projection.withdrawnModules.has(module),
        )
      ) {
        throw new DemoRecipientStateError();
      }
      if (grantShareCount >= DEMO_SHARE_REQUEST_LIMIT) {
        throw new RecipientMutationLimitError("grant_mutation_limit_reached");
      }
      if (reportShareWindowCount >= DEMO_REPORT_SHARE_WINDOW_LIMIT) {
        throw new RecipientMutationLimitError("report_mutation_window_reached");
      }
      const invitation: DemoShareInvitation = Object.freeze({
        invitationId: `demo_share_${randomUUID()}`,
        grantId: grant.grantId,
        email,
        recordedAt: now,
        expiresAt: input.expiresAt,
        state: "recorded",
      });
      this.#append({
        eventId: randomUUID(),
        type: "share.recorded",
        occurredAt: now,
        invitation,
      });
      return invitation;
    });
  }

  async revokeShareInvitation(input: {
    session: AuthoritySession;
    invitationId: string;
  }): Promise<DemoShareInvitation> {
    await Promise.resolve();
    return this.#mutate((projection) => {
      const now = Date.now();
      const grant = grantForSession(projection, input.session, now);
      const invitation = projection.invitations.get(input.invitationId);
      if (
        !grant.actions.includes("invite_recipient") ||
        invitation === undefined ||
        invitation.grantId !== grant.grantId ||
        invitation.state !== "recorded" ||
        invitation.expiresAt <= now
      ) {
        throw new DemoRecipientStateError();
      }
      this.#append({
        eventId: randomUUID(),
        type: "share.revoked",
        occurredAt: now,
        invitationId: input.invitationId,
        grantId: grant.grantId,
      });
      return { ...invitation, state: "revoked" };
    });
  }

  async recordContactRequest(input: {
    session: AuthoritySession;
    findingReference: string | null;
    module: DemoRecipientModule | null;
  }): Promise<DemoContactRequest> {
    await Promise.resolve();
    return this.#mutate((projection) => {
      const now = Date.now();
      const grant = grantForSession(projection, input.session, now);
      const activeModule =
        input.module === null
          ? grant.modules.some(
              (module) => !projection.withdrawnModules.has(module),
            )
          : grant.modules.includes(input.module) &&
            !projection.withdrawnModules.has(input.module);
      let grantContactCount = 0;
      let reportContactWindowCount = 0;
      for (const request of projection.contactRequests) {
        if (request.grantId === grant.grantId) grantContactCount += 1;
        if (
          request.recordedAt >= now - DEMO_REPORT_MUTATION_WINDOW_MS &&
          projection.grants.get(request.grantId)?.reportVersionId ===
            grant.reportVersionId
        ) {
          reportContactWindowCount += 1;
        }
        if (
          grantContactCount >= DEMO_CONTACT_REQUEST_LIMIT &&
          reportContactWindowCount >= DEMO_REPORT_CONTACT_WINDOW_LIMIT
        ) {
          break;
        }
      }
      if (!grant.actions.includes("contact_inspector") || !activeModule) {
        throw new DemoRecipientStateError();
      }
      if (grantContactCount >= DEMO_CONTACT_REQUEST_LIMIT) {
        throw new RecipientMutationLimitError("grant_mutation_limit_reached");
      }
      if (reportContactWindowCount >= DEMO_REPORT_CONTACT_WINDOW_LIMIT) {
        throw new RecipientMutationLimitError("report_mutation_window_reached");
      }
      const request: DemoContactRequest = Object.freeze({
        contactRequestId: `demo_contact_${randomUUID()}`,
        grantId: grant.grantId,
        findingReference: input.findingReference,
        recordedAt: now,
        state: "recorded",
      });
      this.#append({
        eventId: randomUUID(),
        type: "contact.recorded",
        occurredAt: now,
        request,
      });
      return request;
    });
  }

  /** Test-only transition; public code has no route to this method. */
  async setModuleWithdrawn(
    module: DemoRecipientModule,
    withdrawn: boolean,
  ): Promise<void> {
    await Promise.resolve();
    this.#mutate(() => {
      this.#append({
        eventId: randomUUID(),
        type: withdrawn ? "module.withdrawn" : "module.restored",
        occurredAt: Date.now(),
        module,
      });
    });
  }

  async isModuleWithdrawn(module: DemoRecipientModule): Promise<boolean> {
    await Promise.resolve();
    return this.#project().withdrawnModules.has(module);
  }

  async listShareInvitations(
    grantId: string,
    now = Date.now(),
  ): Promise<readonly DemoShareInvitation[]> {
    await Promise.resolve();
    return invitationsFor(this.#project(), grantId, now);
  }

  async listContactRequests(
    grantId: string,
  ): Promise<readonly DemoContactRequest[]> {
    await Promise.resolve();
    return contactsFor(this.#project(), grantId);
  }

  destroy(): void {
    rmSync(this.#filePath, { force: true });
    rmSync(`${this.#filePath}.authority.lock`, { force: true });
  }

  #mutate<T>(operation: (projection: Projection) => T): T {
    mkdirSync(dirname(this.#filePath), { recursive: true, mode: 0o700 });
    const lockPath = `${this.#filePath}.authority.lock`;
    try {
      writeFileSync(lockPath, this.#digest("authority-lock"), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch {
      throw new DemoRecipientStateError();
    }
    try {
      return operation(this.#project());
    } finally {
      rmSync(lockPath, { force: true });
    }
  }

  #append(event: DemoEvent): void {
    const encoded = JSON.stringify(event);
    appendFileSync(
      this.#filePath,
      `${JSON.stringify({
        event,
        signature: this.#digest(`event:${encoded}`),
      })}\n`,
      { encoding: "utf8", flag: "a", mode: 0o600 },
    );
  }

  #project(): Projection {
    const invitationClaims = new Map<string, InvitationClaimedEvent>();
    const challenges = new Map<string, InvitationClaimedEvent>();
    const completedChallenges = new Set<string>();
    const grants = new Map<string, DemoGrant>();
    const withdrawnModules = new Set<DemoRecipientModule>();
    const invitations = new Map<string, DemoShareInvitation>();
    const contactRequests: DemoContactRequest[] = [];
    for (const event of this.#readEvents()) {
      switch (event.type) {
        case "invitation.claimed":
          invitationClaims.set(event.invitationDigest, event);
          challenges.set(event.challengeId, event);
          break;
        case "grant.issued":
          completedChallenges.add(event.challengeId);
          grants.set(event.grant.grantId, event.grant);
          break;
        case "grant.revoked": {
          const current = grants.get(event.grantId);
          if (current) {
            grants.set(event.grantId, {
              ...current,
              revision: event.revision,
              status: "revoked",
            });
          }
          break;
        }
        case "module.withdrawn":
          withdrawnModules.add(event.module);
          break;
        case "module.restored":
          withdrawnModules.delete(event.module);
          break;
        case "share.recorded":
          invitations.set(event.invitation.invitationId, event.invitation);
          break;
        case "share.revoked": {
          const invitation = invitations.get(event.invitationId);
          if (invitation?.grantId === event.grantId) {
            invitations.set(event.invitationId, {
              ...invitation,
              state: "revoked",
            });
          }
          break;
        }
        case "contact.recorded":
          contactRequests.push(event.request);
          break;
      }
    }
    return {
      invitationClaims,
      challenges,
      completedChallenges,
      grants,
      withdrawnModules,
      invitations,
      contactRequests,
    };
  }

  #readEvents(): readonly DemoEvent[] {
    let contents: string;
    try {
      contents = readFileSync(this.#filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw new DemoRecipientStateError();
    }
    const events: DemoEvent[] = [];
    for (const line of contents.split("\n")) {
      if (!line) continue;
      try {
        const record = JSON.parse(line) as {
          event: DemoEvent;
          signature: string;
        };
        const encoded = JSON.stringify(record.event);
        if (
          !safeEqual(record.signature, this.#digest(`event:${encoded}`)) ||
          !isDemoEvent(record.event)
        ) {
          throw new DemoRecipientStateError();
        }
        events.push(record.event);
      } catch {
        throw new DemoRecipientStateError();
      }
    }
    return events;
  }

  #digest(value: string): string {
    return createHmac("sha256", this.#secret).update(value).digest("base64url");
  }
}

function grantForSession(
  projection: Projection,
  session: AuthoritySession,
  now: number,
): DemoGrant {
  const grant = projection.grants.get(session.grantId);
  if (
    grant === undefined ||
    grant.status !== "active" ||
    grant.revision !== session.grantRevision ||
    grant.principalId !== session.principalId ||
    grant.verifiedEmail !== session.verifiedEmail ||
    grant.organizationId !== session.organizationId ||
    grant.jobId !== session.jobId ||
    grant.reportVersionId !== session.reportVersionId ||
    grant.expiresAt <= now ||
    session.expiresAt <= now
  ) {
    throw new DemoRecipientStateError();
  }
  return grant;
}

function invitationsFor(
  projection: Projection,
  grantId: string,
  now: number,
): readonly DemoShareInvitation[] {
  return [...projection.invitations.values()]
    .filter((invitation) => invitation.grantId === grantId)
    .map((invitation) =>
      invitation.state === "recorded" && invitation.expiresAt <= now
        ? { ...invitation, state: "expired" as const }
        : invitation,
    )
    .toSorted((left, right) => right.recordedAt - left.recordedAt);
}

function contactsFor(
  projection: Projection,
  grantId: string,
): readonly DemoContactRequest[] {
  return projection.contactRequests
    .filter((request) => request.grantId === grantId)
    .toSorted((left, right) => right.recordedAt - left.recordedAt);
}

function recipientDemoStateSecret(): string {
  const secret = process.env.RECIPIENT_SESSION_SECRET;
  if (secret !== undefined && secret.length >= 32) return secret;
  if (process.env.APP_ENV === "test") {
    return "local-only-recipient-session-secret-do-not-deploy";
  }
  throw new DemoRecipientStateError();
}

function isDemoEvent(value: unknown): value is DemoEvent {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  return [
    "invitation.claimed",
    "grant.issued",
    "grant.revoked",
    "module.withdrawn",
    "module.restored",
    "share.recorded",
    "share.revoked",
    "contact.recorded",
  ].includes(String(value.type));
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
