"use client";

import { useState } from "react";

import styles from "./report.module.css";

type Invitation = Readonly<{
  invitationId: string;
  email: string;
  recordedAt: number;
  expiresAt: number;
  state: "recorded" | "redeemed" | "expired" | "revoked";
}>;

const dateFormatter = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Australia/Brisbane",
});

export function ShareAccess({
  initialInvitations,
  proposedExpiry,
}: Readonly<{
  initialInvitations: readonly Invitation[];
  proposedExpiry: number;
}>) {
  const [invitations, setInvitations] = useState(initialInvitations);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const expiry = dateFormatter.format(proposedExpiry);

  async function recordInvitation() {
    setBusy(true);
    setError(false);
    try {
      const response = await fetch("/reports/demo/access/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, expiresAt: proposedExpiry }),
      });
      if (!response.ok) throw new Error();
      const result = (await response.json()) as { invitation: Invitation };
      setInvitations((current) => [result.invitation, ...current]);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvitation(invitationId: string) {
    setBusy(true);
    setError(false);
    try {
      const response = await fetch("/reports/demo/access/share", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invitationId }),
      });
      if (!response.ok) throw new Error();
      const result = (await response.json()) as { invitation: Invitation };
      setInvitations((current) =>
        current.map((invitation) =>
          invitation.invitationId === result.invitation.invitationId
            ? result.invitation
            : invitation,
        ),
      );
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="share-heading">
      <h3 id="share-heading">Record a named access request</h3>
      <p>
        This synthetic demo records the intended recipient and scope. It does
        not send an email or create a provider delivery claim.
      </p>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void recordInvitation();
        }}
      >
        <label htmlFor="share-email">Recipient email address</label>
        <input
          id="share-email"
          onChange={(event) => setEmail(event.currentTarget.value)}
          required
          type="email"
          value={email}
        />
        <p>
          <strong>Access expiry:</strong> {expiry}. The invitation cannot extend
          your access or module scope.
        </p>
        <label className={styles.checkbox}>
          <input required type="checkbox" />
          <span>
            I confirm the named recipient and expiry before recording.
          </span>
        </label>
        <button disabled={busy} type="submit">
          Record named access request
        </button>
      </form>
      {error ? (
        <p className={styles.status} role="alert">
          The invitation could not be changed. Refresh and try again.
        </p>
      ) : null}
      <h4>Invitation activity</h4>
      {invitations.length === 0 ? (
        <p>No named access requests have been recorded from this grant.</p>
      ) : (
        <ul className={styles.statusList} aria-label="Invitation activity">
          {invitations.map((invitation) => (
            <li key={invitation.invitationId}>
              <span role="status">
                Access request for {invitation.email}:{" "}
                <strong>{invitation.state}</strong>. Expires{" "}
                {dateFormatter.format(invitation.expiresAt)}.
              </span>
              {invitation.state === "recorded" ? (
                <button
                  className={styles.secondaryButton}
                  disabled={busy}
                  onClick={() => void revokeInvitation(invitation.invitationId)}
                  type="button"
                >
                  Revoke recorded request
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
