"use client";

import { useState } from "react";

import styles from "./report.module.css";

export function EndReportAccess() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function endAccess() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/reports/demo/access/session", {
        method: "DELETE",
      });
      if (!response.ok) {
        setError("Report access could not be ended. Refresh and try again.");
        return;
      }
      window.location.assign("/auth/invitation");
    } catch {
      setError("Report access could not be ended. Refresh and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.endAccess}>
      <button
        aria-busy={busy}
        className={styles.secondaryButton}
        disabled={busy}
        onClick={() => void endAccess()}
        type="button"
      >
        {busy ? "Ending access" : "Sign out of this report"}
      </button>
      {error === null ? null : (
        <p className={styles.status} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
