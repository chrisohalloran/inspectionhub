import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DemoRecipientStateError,
  DemoRecipientStateStore,
  type DemoGrant,
} from "./recipient-demo-store";

const stores: DemoRecipientStateStore[] = [];
const files: string[] = [];

afterEach(() => {
  for (const store of stores) store.destroy();
  for (const file of files) rmSync(`${file}.authority.lock`, { force: true });
  stores.length = 0;
  files.length = 0;
});

describe("test-only recipient state adapter", () => {
  it("rejects invitation replay across independent handler instances", async () => {
    const [first, second] = runtimes();
    await first.claimInvitation({
      invitationToken: "demo-invite-cross-runtime-replay",
      intendedEmail: "recipient@example.com",
    });

    await expect(
      second.claimInvitation({
        invitationToken: "demo-invite-cross-runtime-replay",
        intendedEmail: "recipient@example.com",
      }),
    ).rejects.toThrow(DemoRecipientStateError);
  });

  it("denies an already-issued cookie grant after another runtime revokes it", async () => {
    const [issuer, authoriser] = runtimes();
    const grant = await issueGrant(issuer, "revocation");
    const session = sessionFor(grant);
    await expect(
      issuer.authorise(session, {
        reportVersionId: "report_demo_v2",
        module: "building",
        action: "download_pdf",
      }),
    ).resolves.toMatchObject({ grantId: grant.grantId });

    await authoriser.revokeGrant(session);

    await expect(
      issuer.authorise(session, {
        reportVersionId: "report_demo_v2",
        module: "building",
        action: "download_pdf",
      }),
    ).rejects.toThrow(DemoRecipientStateError);
  });

  it("takes withdrawal only from signed server events and retains the other module", async () => {
    const [writer, reader] = runtimes();
    const grant = await issueGrant(writer, "withdrawal");
    const session = sessionFor(grant);

    const forgedQuery = new URL(
      "https://example.test/reports/demo?view=withdrawn",
    );
    expect(forgedQuery.searchParams.get("view")).toBe("withdrawn");
    await expect(reader.isModuleWithdrawn("building")).resolves.toBe(false);

    await writer.setModuleWithdrawn("building", true);
    await expect(reader.isModuleWithdrawn("building")).resolves.toBe(true);
    await expect(
      reader.authorise(session, {
        reportVersionId: "report_demo_v2",
        module: "building",
        action: "read_report",
      }),
    ).rejects.toThrow(DemoRecipientStateError);
    await expect(
      reader.authorise(session, {
        reportVersionId: "report_demo_v2",
        module: "timber_pest",
        action: "read_report",
      }),
    ).resolves.toMatchObject({ grantId: grant.grantId });
  });

  it("records share and contact transitions without claiming provider egress", async () => {
    const [writer, reader] = runtimes();
    const grant = await issueGrant(writer, "transitions");
    const session = sessionFor(grant);
    await expect(
      writer.recordShareInvitation({
        session,
        email: "overbroad@example.com",
        expiresAt: grant.expiresAt + 1,
      }),
    ).rejects.toThrow(DemoRecipientStateError);
    const invitation = await writer.recordShareInvitation({
      session,
      email: "buyer@example.com",
      expiresAt: Date.now() + 60_000,
    });
    await writer.recordContactRequest({
      session,
      findingReference: "finding_cracked_tiles",
      module: "building",
    });

    await expect(reader.listShareInvitations(grant.grantId)).resolves.toEqual([
      expect.objectContaining({
        email: "buyer@example.com",
        state: "recorded",
      }),
    ]);
    await expect(reader.listContactRequests(grant.grantId)).resolves.toEqual([
      expect.objectContaining({
        findingReference: "finding_cracked_tiles",
        state: "recorded",
      }),
    ]);

    await reader.revokeShareInvitation({
      session,
      invitationId: invitation.invitationId,
    });
    await expect(writer.listShareInvitations(grant.grantId)).resolves.toEqual([
      expect.objectContaining({ state: "revoked" }),
    ]);
  });

  it("fails closed on a contended mutation claim and after module withdrawal", async () => {
    const [writer] = runtimes();
    const grant = await issueGrant(writer, "atomic-contention");
    const session = sessionFor(grant);
    const filePath = files.at(-1)!;
    writeFileSync(`${filePath}.authority.lock`, "held", { flag: "wx" });
    await expect(
      writer.recordContactRequest({
        session,
        findingReference: "finding_cracked_tiles",
        module: "building",
      }),
    ).rejects.toThrow(DemoRecipientStateError);
    rmSync(`${filePath}.authority.lock`, { force: true });

    await writer.setModuleWithdrawn("building", true);
    await expect(
      writer.recordContactRequest({
        session,
        findingReference: "finding_cracked_tiles",
        module: "building",
      }),
    ).rejects.toThrow(DemoRecipientStateError);
    await writer.setModuleWithdrawn("timber_pest", true);
    await expect(
      writer.recordShareInvitation({
        session,
        email: "buyer@example.com",
        expiresAt: Date.now() + 60_000,
      }),
    ).rejects.toThrow(DemoRecipientStateError);
  });
});

function runtimes(): [DemoRecipientStateStore, DemoRecipientStateStore] {
  const filePath = join(
    tmpdir(),
    `inspection-recipient-store-${randomUUID()}.jsonl`,
  );
  const options = {
    filePath,
    secret: "recipient-store-test-secret-at-least-32-chars",
  };
  const result = [
    new DemoRecipientStateStore(options),
    new DemoRecipientStateStore(options),
  ] as const;
  stores.push(...result);
  files.push(filePath);
  return [...result];
}

async function issueGrant(
  store: DemoRecipientStateStore,
  suffix: string,
): Promise<DemoGrant> {
  const claimed = await store.claimInvitation({
    invitationToken: `demo-invite-${suffix}`,
    intendedEmail: "recipient@example.com",
  });
  return store.issueGrant({
    challengeId: claimed.challengeId,
    invitationDigest: claimed.invitationDigest,
    intendedEmail: claimed.intendedEmail,
  });
}

function sessionFor(grant: DemoGrant) {
  return {
    grantId: grant.grantId,
    grantRevision: grant.revision,
    principalId: grant.principalId,
    verifiedEmail: grant.verifiedEmail,
    organizationId: grant.organizationId,
    jobId: grant.jobId,
    reportVersionId: grant.reportVersionId,
    expiresAt: grant.expiresAt,
  };
}
