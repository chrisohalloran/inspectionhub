"use client";

import { useEffect, useState } from "react";

import styles from "./report.module.css";
import { recipientMutationFailureMessage } from "./recipient-mutation-feedback";

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
const invitationFailure =
  "The invitation could not be changed. Refresh and try again.";

export function ShareAccess({
  initialInvitations,
  proposedExpiry,
}: Readonly<{
  initialInvitations: readonly Invitation[];
  proposedExpiry: number;
}>) {
  const [invitations, setInvitations] = useState(initialInvitations);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expiry = dateFormatter.format(proposedExpiry);

  useEffect(() => {
    setHydrated(true);
  }, []);

  async function recordInvitation(email: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/reports/demo/access/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, expiresAt: proposedExpiry }),
      });
      if (!response.ok) {
        setError(
          (await recipientMutationFailureMessage(response, "invitation")) ??
            invitationFailure,
        );
        return;
      }
      const result = (await response.json()) as { invitation: Invitation };
      setInvitations((current) => [result.invitation, ...current]);
    } catch {
      setError(invitationFailure);
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvitation(invitationId: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/reports/demo/access/share", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invitationId }),
      });
      if (!response.ok) {
        setError(
          (await recipientMutationFailureMessage(response, "invitation")) ??
            invitationFailure,
        );
        return;
      }
      const result = (await response.json()) as { invitation: Invitation };
      setInvitations((current) =>
        current.map((invitation) =>
          invitation.invitationId === result.invitation.invitationId
            ? result.invitation
            : invitation,
        ),
      );
    } catch {
      setError(invitationFailure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="share-heading">
      <h3 id="share-heading">Share report access</h3>
      <p>
        Create access for one named person. They can only open the same report
        version and modules available to you.
      </p>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          const email = new FormData(event.currentTarget).get("email");
          if (typeof email === "string") void recordInvitation(email);
        }}
      >
        <label htmlFor="share-email">Recipient email address</label>
        <input
          id="share-email"
          name="email"
          placeholder="buyer@example.com"
          required
          type="email"
        />
        <p>For this public demo, use an email ending in @example.com.</p>
        <p>
          <strong>Access expiry:</strong> {expiry}. The invitation cannot extend
          your access or module scope.
        </p>
        <button disabled={!hydrated || busy} type="submit">
          {busy ? "Creating invitation" : "Create access invitation"}
        </button>
      </form>
      {error !== null ? (
        <p className={styles.status} role="alert">
          {error}
        </p>
      ) : null}
      <h4>Access invitations</h4>
      {invitations.length === 0 ? (
        <p>No access invitations have been created.</p>
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
                  Revoke invitation
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
