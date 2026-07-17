"use client";

import { useState } from "react";

import styles from "./report.module.css";
import { recipientMutationFailureMessage } from "./recipient-mutation-feedback";

type ContactRequest = Readonly<{
  contactRequestId: string;
  findingReference: string | null;
  recordedAt: number;
  state: "recorded";
}>;
const contactFailure =
  "The question reference could not be recorded. Refresh and try again.";

export function ContactInspector({
  availableModules,
  initialRequests,
}: Readonly<{
  availableModules: readonly ("building" | "timber_pest")[];
  initialRequests: readonly ContactRequest[];
}>) {
  const [requests, setRequests] = useState(initialRequests);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function recordRequest(form: HTMLFormElement) {
    setBusy(true);
    setError(null);
    try {
      const data = new FormData(form);
      const response = await fetch("/reports/demo/access/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          findingReference: data.get("findingReference"),
          message: data.get("message"),
        }),
      });
      if (!response.ok) {
        setError(
          (await recipientMutationFailureMessage(response, "question")) ??
            contactFailure,
        );
        return;
      }
      const result = (await response.json()) as {
        contactRequest: ContactRequest;
      };
      setRequests((current) => [result.contactRequest, ...current]);
      form.reset();
    } catch {
      setError(contactFailure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="contact-heading">
      <h3 id="contact-heading">Contact the inspector</h3>
      <p>
        The handoff identifies report version 2 and, if selected, one finding.
        Report content and evidence are not copied into the notification.
      </p>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void recordRequest(event.currentTarget);
        }}
      >
        <label htmlFor="finding-reference">Finding reference (optional)</label>
        <select id="finding-reference" name="findingReference">
          <option value="">Whole report</option>
          {availableModules.includes("building") ? (
            <option value="finding_cracked_tiles">
              Cracked shower and bathroom floor tiles
            </option>
          ) : null}
          {availableModules.includes("timber_pest") ? (
            <option value="finding_garden_bed">
              Garden bed against external wall
            </option>
          ) : null}
        </select>
        <label htmlFor="contact-message">Your question</label>
        <textarea id="contact-message" name="message" required />
        <button disabled={busy} type="submit">
          Record question reference
        </button>
      </form>
      {error !== null ? (
        <p className={styles.status} role="alert">
          {error}
        </p>
      ) : null}
      {requests.length > 0 ? (
        <p className={styles.status} role="status">
          Question reference recorded in the synthetic portal. No notification
          was sent and no report content was copied. Reference{" "}
          {requests[0]?.contactRequestId}.
        </p>
      ) : null}
    </section>
  );
}
