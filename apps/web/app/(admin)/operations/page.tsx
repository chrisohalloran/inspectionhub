import type { Metadata } from "next";
import { notFound } from "next/navigation";

import styles from "./operations.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Operations · InspectionHub",
  robots: { index: false, follow: false },
};

const SAFE_SYNTHETIC_OPERATIONS = [
  { label: "Queue waiting", value: "2", detail: "Oldest 18 seconds" },
  { label: "Provider unknown", value: "1", detail: "Reconciliation required" },
  { label: "Delivery exceptions", value: "0", detail: "No content is logged" },
  { label: "Revoked access", value: "3", detail: "Last 24 hours" },
] as const;

export default function OperationsPage() {
  if (
    process.env.APP_ENV === "production" ||
    process.env.OPERATIONS_DEMO_MODE !== "true"
  ) {
    notFound();
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className="eyebrow">Synthetic operations</p>
          <h1>Recovery queue</h1>
        </div>
        <p className={styles.notice} role="status">
          Demo-only projection. Report text, media, mailbox details and provider
          payloads are never displayed here.
        </p>
      </header>
      <section className={styles.grid} aria-label="Operational state summary">
        {SAFE_SYNTHETIC_OPERATIONS.map((item) => (
          <article className={styles.card} key={item.label}>
            <h2>{item.label}</h2>
            <p className={styles.value}>{item.value}</p>
            <p>{item.detail}</p>
          </article>
        ))}
      </section>
      <section className={styles.blocked} aria-labelledby="restore-heading">
        <div>
          <h2 id="restore-heading">Restore egress</h2>
          <p>
            Blocked until checksums, event replay, grants, deletions, sessions,
            package pointers, provider truth and environment-bound secrets
            reconcile.
          </p>
        </div>
        <strong>Blocked</strong>
      </section>
    </main>
  );
}
